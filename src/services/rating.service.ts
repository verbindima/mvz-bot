import { injectable } from 'tsyringe';
import { Player } from '@prisma/client';
import { prisma } from '@/utils/database';
import { logger } from '@/utils/logger';

@injectable()
export class RatingService {
  async updateTrueSkill(winnerIds: number[], loserIds: number[]): Promise<void> {
    try {
      const winners = await prisma.player.findMany({
        where: { id: { in: winnerIds } },
      });

      const losers = await prisma.player.findMany({
        where: { id: { in: loserIds } },
      });

      const winnerMu = winners.reduce((sum, p) => sum + p.tsMu, 0) / winners.length;
      const loserMu = losers.reduce((sum, p) => sum + p.tsMu, 0) / losers.length;
      const winnerSigma = Math.sqrt(winners.reduce((sum, p) => sum + p.tsSigma * p.tsSigma, 0) / winners.length);
      const loserSigma = Math.sqrt(losers.reduce((sum, p) => sum + p.tsSigma * p.tsSigma, 0) / losers.length);

      const c = Math.sqrt(winnerSigma * winnerSigma + loserSigma * loserSigma + 2 * 8.333 * 8.333);
      const winProbability = this.cdf((winnerMu - loserMu) / c);
      
      const k = 25;
      const delta = k * (1 - winProbability);

      for (const winner of winners) {
        await prisma.player.update({
          where: { id: winner.id },
          data: {
            tsMu: winner.tsMu + delta,
            tsSigma: Math.max(1, winner.tsSigma * 0.99),
          },
        });
      }

      for (const loser of losers) {
        await prisma.player.update({
          where: { id: loser.id },
          data: {
            tsMu: loser.tsMu - delta,
            tsSigma: Math.max(1, loser.tsSigma * 0.99),
          },
        });
      }

      logger.info(`TrueSkill updated: ${winners.length} winners, ${losers.length} losers, delta: ${delta.toFixed(2)}`);
    } catch (error) {
      logger.error('Error updating TrueSkill:', error);
      throw error;
    }
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
    x = Math.abs(x);

    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

    return sign * y;
  }

  async setRatingScheme(scheme: 'self' | 'captain' | 'ts'): Promise<void> {
    logger.info(`Rating scheme changed to: ${scheme}`);
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

      const avgRating = player.ratings.length > 0
        ? player.ratings.reduce((sum, r) => sum + r.delta, 0) / player.ratings.length
        : 0;

      return {
        player,
        gamesPlayed,
        avgRating,
        recentRatings: player.ratings.map(r => r.delta),
      };
    } catch (error) {
      logger.error('Error getting player stats:', error);
      throw error;
    }
  }
}