import { injectable, container } from 'tsyringe';
import { Player } from '@prisma/client';
import { prisma } from '../utils/database';
import { logger } from '../utils/logger';
import { CONFIG } from '../config';
import { InactivityService } from './inactivity.service';

interface UpdateTrueSkillOptions {
  matchPlayedAt?: Date;
  mvpIds?: number[];
  applyIdleInflation?: boolean;
}

@injectable()
export class RatingService {
  /**
   * Обновление рейтингов в стиле TrueSkill для двух команд с улучшениями:
   * - Инфляция σ при неактивности
   * - MVP бонусы
   * - Корректно суммирует неопределённости (σ^2) команд
   * - Использует v/w-функции для апдейта μ и σ каждого игрока
   * - Обновляет всех игроков батчем внутри транзакции
   */
  async updateTrueSkill(
    winnerIds: number[],
    loserIds: number[],
    options: UpdateTrueSkillOptions = {}
  ): Promise<void> {
    const {
      matchPlayedAt = new Date(),
      mvpIds = [],
      applyIdleInflation = true
    } = options;
    // --- базовая валидация входа ---
    if (!winnerIds?.length || !loserIds?.length) {
      throw new Error('updateTrueSkill: teams must be non-empty');
    }
    // убираем дубли, проверяем пересечения
    const wSet = new Set(winnerIds);
    const lSet = new Set(loserIds);
    for (const id of wSet) {
      if (lSet.has(id)) throw new Error('updateTrueSkill: winners and losers overlap');
    }

    // Валидация MVP
    if (mvpIds.length > 2) {
      throw new Error('updateTrueSkill: maximum 2 MVP players allowed');
    }
    for (const mvpId of mvpIds) {
      if (!wSet.has(mvpId) && !lSet.has(mvpId)) {
        throw new Error(`updateTrueSkill: MVP player ${mvpId} not in match`);
      }
    }
    // Проверяем, что MVP не более одного на команду
    const mvpInWinners = mvpIds.filter(id => wSet.has(id)).length;
    const mvpInLosers = mvpIds.filter(id => lSet.has(id)).length;
    if (mvpInWinners > 1 || mvpInLosers > 1) {
      throw new Error('updateTrueSkill: maximum 1 MVP per team allowed');
    }

    // --- загружаем всех игроков одним запросом ---
    const allIds = [...wSet, ...lSet];
    const players = await prisma.player.findMany({
      where: { id: { in: allIds } },
    });
    if (players.length !== allIds.length) {
      const found = new Set(players.map(p => p.id));
      const missing = allIds.filter(id => !found.has(id));
      throw new Error(`updateTrueSkill: missing player ids: ${missing.join(', ')}`);
    }
    const byId = new Map(players.map(p => [p.id, p]));
    const winners = [...wSet].map(id => byId.get(id)!);
    const losers = [...lSet].map(id => byId.get(id)!);

    // --- применяем инфляцию неактивности ---
    let inflatedCount = 0;
    if (applyIdleInflation && CONFIG.RATING_IDLE_ENABLED) {
      const inactivityService = container.resolve(InactivityService);

      for (const player of players) {
        const { tsSigma, weeksInactive } = inactivityService.calculateInflation(player, matchPlayedAt);
        if (Math.abs(tsSigma - player.tsSigma) > 0.001) {
          player.tsSigma = tsSigma;
          inflatedCount++;

          // Создаем событие для истории (опционально)
          await prisma.ratingEvent.create({
            data: {
              playerId: player.id,
              muBefore: player.tsMu,
              muAfter: player.tsMu,
              sigmaBefore: tsSigma, // Исходное значение до инфляции
              sigmaAfter: tsSigma,
              reason: 'idle',
              meta: {
                weeksInactive,
                lambda: CONFIG.RATING_IDLE_LAMBDA
              }
            }
          });
        }
      }
    }

    // --- параметры TrueSkill (дефолты Microsoft) ---
    const beta = 25 / 6;        // skill-to-performance
    const tau = 25 / 300;      // динамика/шум процесса (малый)
    const sigmaFloor = 1;       // нижний порог σ, как и было ранее

    // --- агрегаты команд ---
    const sum = (arr: number[]) => arr.reduce((s, x) => s + x, 0);
    const muW = sum(winners.map(p => p.tsMu));
    const muL = sum(losers.map(p => p.tsMu));
    const s2W = sum(winners.map(p => p.tsSigma * p.tsSigma));
    const s2L = sum(losers.map(p => p.tsSigma * p.tsSigma));

    const c = Math.sqrt(s2W + s2L + 2 * beta * beta);
    // защита от вырождения
    if (!isFinite(c) || c <= 0) throw new Error('updateTrueSkill: invalid c');

    const t = (muW - muL) / c;

    // --- v(t), w(t) со стабильностями ---
    const phi = (x: number) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
    const Phi = (x: number) => 0.5 * (1 + this.erf(x / Math.SQRT2));

    // избегаем деления на ноль, когда Phi(t) ≈ 0
    const eps = 1e-12;
    const Phi_t = Math.max(Phi(t), eps);
    const v = phi(t) / Phi_t;
    const w = v * (v + t);

    // --- функция апдейта одного игрока ---
    const updateOne = (p: Player, sign: 1 | -1) => {
      const s2 = p.tsSigma * p.tsSigma;
      const muNew = p.tsMu + sign * (s2 / c) * v;
      const sigma2New = s2 * (1 - (s2 / (c * c)) * w) + tau * tau;
      const sigmaNew = Math.max(sigmaFloor, Math.sqrt(Math.max(sigma2New, 0)));
      return { id: p.id, tsMu: muNew, tsSigma: sigmaNew };
    };

    let updates = [
      ...winners.map(p => updateOne(p, +1)),
      ...losers.map(p => updateOne(p, -1)),
    ];

    // --- применяем MVP бонусы ---
    if (CONFIG.RATING_MVP_ENABLED && mvpIds.length > 0) {
      const mvpUpdates = new Map();

      for (const mvpId of mvpIds) {
        const updateIndex = updates.findIndex(u => u.id === mvpId);
        if (updateIndex !== -1) {
          const originalUpdate = updates[updateIndex];
          const mvpUpdate = {
            ...originalUpdate,
            tsMu: originalUpdate.tsMu + CONFIG.RATING_MVP_MU_BONUS,
            tsSigma: Math.max(CONFIG.RATING_SIGMA_FLOOR, originalUpdate.tsSigma * CONFIG.RATING_MVP_SIGMA_MULT)
          };
          updates[updateIndex] = mvpUpdate;
          mvpUpdates.set(mvpId, CONFIG.RATING_MVP_MU_BONUS);
        }
      }

      // Логируем MVP бонусы
      if (mvpUpdates.size > 0) {
        logger.info(`Applied MVP bonuses: ${Array.from(mvpUpdates.entries()).map(([id, bonus]) => `player ${id}: +${bonus}`).join(', ')}`);
      }
    }

    // --- атомарное применение апдейтов ---
    const transactionOperations = [
      ...updates.map(u =>
        prisma.player.update({
          where: { id: u.id },
          data: {
            tsMu: u.tsMu,
            tsSigma: u.tsSigma,
            lastPlayedAt: matchPlayedAt,
            gamesPlayed: { increment: 1 }
          },
        }),
      ),
      // Обновляем счетчик MVP для MVP игроков
      ...(CONFIG.RATING_MVP_ENABLED && mvpIds.length > 0
        ? mvpIds.map(mvpId =>
            prisma.player.update({
              where: { id: mvpId },
              data: { mvpCount: { increment: 1 } }
            })
          )
        : []
      ),
      // Создаем события матча в истории
      ...updates.map(u => {
        const originalPlayer = byId.get(u.id)!;
        return prisma.ratingEvent.create({
          data: {
            playerId: u.id,
            muBefore: originalPlayer.tsMu,
            muAfter: u.tsMu,
            sigmaBefore: originalPlayer.tsSigma,
            sigmaAfter: u.tsSigma,
            reason: 'match',
            meta: {
              isWinner: wSet.has(u.id),
              isMVP: mvpIds.includes(u.id),
              mvpBonus: mvpIds.includes(u.id) ? CONFIG.RATING_MVP_MU_BONUS : 0
            }
          }
        });
      })
    ];

    // Также создаем отдельные события для MVP бонусов
    if (CONFIG.RATING_MVP_ENABLED && mvpIds.length > 0) {
      transactionOperations.push(
        ...mvpIds.map(mvpId => {
          const update = updates.find(u => u.id === mvpId)!;
          const originalPlayer = byId.get(mvpId)!;
          return prisma.ratingEvent.create({
            data: {
              playerId: mvpId,
              muBefore: update.tsMu - CONFIG.RATING_MVP_MU_BONUS, // До MVP бонуса
              muAfter: update.tsMu, // После MVP бонуса
              sigmaBefore: originalPlayer.tsSigma,
              sigmaAfter: update.tsSigma,
              reason: 'mvp',
              meta: {
                bonus: CONFIG.RATING_MVP_MU_BONUS,
                sigmaMult: CONFIG.RATING_MVP_SIGMA_MULT
              }
            }
          });
        })
      );
    }

    await prisma.$transaction(transactionOperations);

    // лог: усреднённые сдвиги для контроля
    const avgDeltaW =
      sum(updates.filter(u => wSet.has(u.id)).map((u, i) => u.tsMu - winners[i].tsMu)) /
      winners.length;
    const avgDeltaL =
      sum(updates.filter(u => lSet.has(u.id)).map((u, i) => u.tsMu - losers[i].tsMu)) /
      losers.length;

    logger.info(
      `TrueSkill updated: winners=${winners.length}, losers=${losers.length}, t=${t.toFixed(
        3,
      )}, avgΔμ(w)=${avgDeltaW.toFixed(2)}, avgΔμ(l)=${avgDeltaL.toFixed(2)}, inflated=${inflatedCount}, mvp=${mvpIds.length}`,
    );
  }

  private cdf(x: number): number {
    return 0.5 * (1 + this.erf(x / Math.sqrt(2)));
  }

  private erf(x: number): number {
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const sign = x >= 0 ? 1 : -1;
    const ax = Math.abs(x);

    const t = 1.0 / (1.0 + p * ax);
    const y =
      1.0 -
      (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-ax * ax);

    return sign * y;
  }


  async getPlayerStats(telegramId: number): Promise<{
    player: Player;
    gamesPlayed: number;
    avgRating: number;
    recentRatings: number[];
  } | null> {
    try {
      const player = await prisma.player.findUnique({
        where: { telegramId: BigInt(telegramId) },
        include: {
          ratings: {
            orderBy: { createdAt: 'desc' },
            take: 10,
          },
        },
      });

      if (!player) return null;

      const gamesPlayed = await prisma.weekEntry.count({
        where: { playerId: player.id },
      });

      const avgRating =
        player.ratings.length > 0
          ? player.ratings.reduce((sum, r) => sum + r.delta, 0) /
          player.ratings.length
          : 0;

      return {
        player,
        gamesPlayed,
        avgRating,
        recentRatings: player.ratings.map((r) => r.delta),
      };
    } catch (error) {
      logger.error('Error getting player stats:', error);
      throw error;
    }
  }
}
