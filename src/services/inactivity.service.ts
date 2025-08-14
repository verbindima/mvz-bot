import { injectable } from 'tsyringe';
import { Player } from '@prisma/client';
import { prisma } from '../utils/database';
import { CONFIG } from '../config';
import { logger } from '../utils/logger';

@injectable()
export class InactivityService {
  /**
   * Вычисляет количество недель между двумя датами
   */
  private weeksBetween(startDate: Date, endDate: Date): number {
    const timeDiff = endDate.getTime() - startDate.getTime();
    const daysDiff = Math.max(0, Math.floor(timeDiff / (1000 * 60 * 60 * 24)));
    return Math.floor(daysDiff / CONFIG.RATING_IDLE_PERIOD_DAYS);
  }

  /**
   * Применяет инфляцию σ для игрока при неактивности
   */
  inflateForPlayer(player: Player, weeksInactive: number): { tsSigma: number } {
    if (!CONFIG.RATING_IDLE_ENABLED || weeksInactive <= 0 || player.gamesPlayed < 1) {
      return { tsSigma: player.tsSigma };
    }

    const sigmaOld = player.tsSigma;
    const sigma0 = CONFIG.RATING_SIGMA0;
    const lambda = CONFIG.RATING_IDLE_LAMBDA;

    // Экспоненциальное сближение к σ0
    const s2 = sigmaOld * sigmaOld;
    const s02 = sigma0 * sigma0;
    const s2New = s2 + (s02 - s2) * (1 - Math.exp(-lambda * weeksInactive));
    const sigmaNew = Math.min(sigma0, Math.sqrt(Math.max(s2New, s2))); // монотонность и кап

    return { tsSigma: sigmaNew };
  }

  /**
   * Вычисляет инфляцию σ для игрока на основе его последней активности
   */
  calculateInflation(player: Player, currentDate: Date): { tsSigma: number; weeksInactive: number } {
    const lastActivity = player.lastPlayedAt || player.firstPlayedAt || player.createdAt;
    const weeksInactive = this.weeksBetween(lastActivity, currentDate);
    
    const result = this.inflateForPlayer(player, weeksInactive);
    
    return {
      tsSigma: result.tsSigma,
      weeksInactive
    };
  }

  /**
   * Применяет инфляцию неактивности для всех игроков (батчевый режим)
   */
  async applyIdleInflationAll(currentDate = new Date()): Promise<number> {
    if (!CONFIG.RATING_IDLE_ENABLED) {
      return 0;
    }

    const players = await prisma.player.findMany({
      where: {
        gamesPlayed: {
          gte: 1
        }
      }
    });

    const updates: Array<{ id: number; tsSigma: number; weeksInactive: number }> = [];

    for (const player of players) {
      const { tsSigma, weeksInactive } = this.calculateInflation(player, currentDate);
      
      if (Math.abs(tsSigma - player.tsSigma) > 0.001) { // Только если есть изменения
        updates.push({ id: player.id, tsSigma, weeksInactive });
      }
    }

    if (updates.length === 0) {
      return 0;
    }

    // Применяем обновления в транзакции
    await prisma.$transaction([
      ...updates.map(update =>
        prisma.player.update({
          where: { id: update.id },
          data: { tsSigma: update.tsSigma }
        })
      ),
      // Записываем события в историю
      ...updates.map(update =>
        prisma.ratingEvent.create({
          data: {
            playerId: update.id,
            muBefore: 0, // Для idle событий μ не меняется
            muAfter: 0,
            sigmaBefore: players.find(p => p.id === update.id)!.tsSigma,
            sigmaAfter: update.tsSigma,
            reason: 'idle',
            meta: {
              weeksInactive: update.weeksInactive,
              lambda: CONFIG.RATING_IDLE_LAMBDA
            }
          }
        })
      )
    ]);

    logger.info(`Applied idle inflation to ${updates.length} players`);
    return updates.length;
  }
}