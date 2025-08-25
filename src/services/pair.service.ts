import { injectable } from 'tsyringe';
import { PlayerPair, Player } from '@prisma/client';
import { prisma } from '../utils/database';
import { logger } from '../utils/logger';
import { CONFIG } from '../config';

export interface PairMatrix {
  [pairKey: string]: {
    synergyMu: number;
    synergySigma: number;
    counterMu: number;
    counterSigma: number;
  };
}

export interface PlayerPairStats {
  playerId: number;
  bestSynergies: Array<{
    partnerId: number;
    partnerName: string;
    synergyMu: number;
    togetherGames: number;
    winRate: number;
  }>;
  worstCounters: Array<{
    opponentId: number;
    opponentName: string;
    counterMu: number;
    vsGames: number;
    winRate: number;
  }>;
}

@injectable()
export class PairService {
  private generatePairKey(playerAId: number, playerBId: number): string {
    const [minId, maxId] = [Math.min(playerAId, playerBId), Math.max(playerAId, playerBId)];
    return `${minId}-${maxId}`;
  }

  private calculateConfidence(games: number): number {
    return Math.min(1, games / CONFIG.PAIR_GAMES_FOR_CONF);
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  private calculateDecay(lastGameAt: Date | null, currentDate: Date): number {
    if (!lastGameAt) return 1;
    
    const daysDiff = (currentDate.getTime() - lastGameAt.getTime()) / (1000 * 60 * 60 * 24);
    const weeksDiff = daysDiff / 7;
    
    if (weeksDiff <= CONFIG.PAIR_DECAY_HALF_LIFE_WEEKS) return 1;
    
    const halfLives = weeksDiff / CONFIG.PAIR_DECAY_HALF_LIFE_WEEKS;
    return Math.pow(CONFIG.PAIR_DECAY_FACTOR, halfLives);
  }

  private calculatePairRating(
    wins: number,
    games: number,
    scale: number,
    lastGameAt: Date | null,
    currentDate: Date
  ): { mu: number; sigma: number } {
    if (games === 0) {
      return { mu: 0, sigma: 1 };
    }

    // Beta(1,1) prior
    const pWin = (wins + 1) / (games + 2);
    
    // Center around 0.5 and scale
    let mu = (pWin - 0.5) * scale;
    mu = this.clamp(mu, -CONFIG.PAIR_CAP, CONFIG.PAIR_CAP);
    
    // Apply time decay
    const decayFactor = this.calculateDecay(lastGameAt, currentDate);
    mu *= decayFactor;
    
    // Calculate uncertainty
    const confidence = this.calculateConfidence(games);
    const sigma = Math.max(0, 1 - confidence);
    
    return { mu, sigma };
  }

  private async getOrCreatePair(playerAId: number, playerBId: number): Promise<PlayerPair> {
    const [minId, maxId] = [Math.min(playerAId, playerBId), Math.max(playerAId, playerBId)];
    
    let pair = await prisma.playerPair.findUnique({
      where: {
        playerAId_playerBId: {
          playerAId: minId,
          playerBId: maxId
        }
      }
    });

    if (!pair) {
      pair = await prisma.playerPair.create({
        data: {
          playerAId: minId,
          playerBId: maxId
        }
      });
    }

    return pair;
  }

  async updateAfterMatch(winnerIds: number[], loserIds: number[], matchDate: Date = new Date()): Promise<void> {
    if (!CONFIG.SYNERGY_ENABLED) {
      logger.info('Pair synergy system disabled, skipping pair updates');
      return;
    }

    const allPlayers = [...winnerIds, ...loserIds];
    logger.info(`Updating pair statistics for match with players: ${allPlayers.join(', ')}`);

    try {
      const updates: Array<{
        playerAId: number;
        playerBId: number;
        togetherGamesIncrement: number;
        togetherWinsIncrement: number;
        vsGamesIncrement: number;
        vsWinsIncrement: number;
      }> = [];

      // Update together stats for winners
      for (let i = 0; i < winnerIds.length; i++) {
        for (let j = i + 1; j < winnerIds.length; j++) {
          const [minId, maxId] = [Math.min(winnerIds[i], winnerIds[j]), Math.max(winnerIds[i], winnerIds[j])];
          updates.push({
            playerAId: minId,
            playerBId: maxId,
            togetherGamesIncrement: 1,
            togetherWinsIncrement: 1,
            vsGamesIncrement: 0,
            vsWinsIncrement: 0
          });
        }
      }

      // Update together stats for losers
      for (let i = 0; i < loserIds.length; i++) {
        for (let j = i + 1; j < loserIds.length; j++) {
          const [minId, maxId] = [Math.min(loserIds[i], loserIds[j]), Math.max(loserIds[i], loserIds[j])];
          updates.push({
            playerAId: minId,
            playerBId: maxId,
            togetherGamesIncrement: 1,
            togetherWinsIncrement: 0,
            vsGamesIncrement: 0,
            vsWinsIncrement: 0
          });
        }
      }

      // Update vs stats between teams
      for (const winnerId of winnerIds) {
        for (const loserId of loserIds) {
          const [minId, maxId] = [Math.min(winnerId, loserId), Math.max(winnerId, loserId)];
          const existingUpdate = updates.find(u => u.playerAId === minId && u.playerBId === maxId);
          
          if (existingUpdate) {
            existingUpdate.vsGamesIncrement += 1;
            // Winner gets credit for vs win if they are playerA, otherwise playerB gets credit
            existingUpdate.vsWinsIncrement += winnerId === minId ? 1 : 0;
          } else {
            updates.push({
              playerAId: minId,
              playerBId: maxId,
              togetherGamesIncrement: 0,
              togetherWinsIncrement: 0,
              vsGamesIncrement: 1,
              vsWinsIncrement: winnerId === minId ? 1 : 0
            });
          }
        }
      }

      // Apply all updates in a transaction
      await prisma.$transaction(
        updates.map(update => {
          return prisma.playerPair.upsert({
            where: {
              playerAId_playerBId: {
                playerAId: update.playerAId,
                playerBId: update.playerBId
              }
            },
            create: {
              playerAId: update.playerAId,
              playerBId: update.playerBId,
              togetherGames: update.togetherGamesIncrement,
              togetherWins: update.togetherWinsIncrement,
              vsGames: update.vsGamesIncrement,
              vsWins: update.vsWinsIncrement,
              lastGameAt: matchDate
            },
            update: {
              togetherGames: { increment: update.togetherGamesIncrement },
              togetherWins: { increment: update.togetherWinsIncrement },
              vsGames: { increment: update.vsGamesIncrement },
              vsWins: { increment: update.vsWinsIncrement },
              lastGameAt: matchDate
            }
          });
        })
      );

      // Recalculate mu/sigma for all affected pairs
      await this.recalculatePairRatings(updates.map(u => ({ playerAId: u.playerAId, playerBId: u.playerBId })), matchDate);

      logger.info(`Updated ${updates.length} player pairs after match`);
    } catch (error) {
      logger.error('Error updating pair statistics:', error);
      throw error;
    }
  }

  private async recalculatePairRatings(pairs: Array<{ playerAId: number; playerBId: number }>, currentDate: Date): Promise<void> {
    const pairData = await prisma.playerPair.findMany({
      where: {
        OR: pairs.map(p => ({
          playerAId: p.playerAId,
          playerBId: p.playerBId
        }))
      }
    });

    const updates = pairData.map(pair => {
      const synergyRating = this.calculatePairRating(
        pair.togetherWins,
        pair.togetherGames,
        CONFIG.PAIR_SCALE_SAME,
        pair.lastGameAt,
        currentDate
      );

      const counterRating = this.calculatePairRating(
        pair.vsWins,
        pair.vsGames,
        CONFIG.PAIR_SCALE_VS,
        pair.lastGameAt,
        currentDate
      );

      return prisma.playerPair.update({
        where: { id: pair.id },
        data: {
          synergyMu: synergyRating.mu,
          synergySigma: synergyRating.sigma,
          counterMu: counterRating.mu,
          counterSigma: counterRating.sigma
        }
      });
    });

    await prisma.$transaction(updates);
  }

  async loadMatrixFor(playerIds: number[]): Promise<PairMatrix> {
    if (!CONFIG.SYNERGY_ENABLED) {
      return {};
    }

    const pairs: Array<{ playerAId: number; playerBId: number }> = [];
    
    for (let i = 0; i < playerIds.length; i++) {
      for (let j = i + 1; j < playerIds.length; j++) {
        const [minId, maxId] = [Math.min(playerIds[i], playerIds[j]), Math.max(playerIds[i], playerIds[j])];
        pairs.push({ playerAId: minId, playerBId: maxId });
      }
    }

    const pairData = await prisma.playerPair.findMany({
      where: {
        OR: pairs.map(p => ({
          playerAId: p.playerAId,
          playerBId: p.playerBId
        }))
      }
    });

    const matrix: PairMatrix = {};
    
    for (const pair of pairs) {
      const pairKey = this.generatePairKey(pair.playerAId, pair.playerBId);
      const data = pairData.find(p => p.playerAId === pair.playerAId && p.playerBId === pair.playerBId);
      
      if (data) {
        matrix[pairKey] = {
          synergyMu: data.synergyMu,
          synergySigma: data.synergySigma,
          counterMu: data.counterMu,
          counterSigma: data.counterSigma
        };
      } else {
        // Default values for pairs with no history
        matrix[pairKey] = {
          synergyMu: 0,
          synergySigma: 1,
          counterMu: 0,
          counterSigma: 1
        };
      }
    }

    return matrix;
  }

  async getPlayerPairStats(playerId: number): Promise<PlayerPairStats | null> {
    const player = await prisma.player.findUnique({
      where: { id: playerId }
    });

    if (!player) return null;

    // Get pairs where player is involved
    const [pairsAsA, pairsAsB] = await Promise.all([
      prisma.playerPair.findMany({
        where: { playerAId: playerId },
        include: { playerB: true }
      }),
      prisma.playerPair.findMany({
        where: { playerBId: playerId },
        include: { playerA: true }
      })
    ]);

    // Best synergies (playing together)
    const allSynergies = [
      ...pairsAsA
        .filter(p => p.togetherGames >= CONFIG.PAIR_MIN_SAME_GAMES)
        .map(p => ({
          partnerId: p.playerBId,
          partnerName: p.playerB.firstName,
          synergyMu: p.synergyMu,
          togetherGames: p.togetherGames,
          winRate: p.togetherGames > 0 ? p.togetherWins / p.togetherGames : 0
        })),
      ...pairsAsB
        .filter(p => p.togetherGames >= CONFIG.PAIR_MIN_SAME_GAMES)
        .map(p => ({
          partnerId: p.playerAId,
          partnerName: p.playerA.firstName,
          synergyMu: p.synergyMu,
          togetherGames: p.togetherGames,
          winRate: p.togetherGames > 0 ? p.togetherWins / p.togetherGames : 0
        }))
    ];

    // Worst counters (playing against)
    const allCounters = [
      ...pairsAsA
        .filter(p => p.vsGames >= CONFIG.PAIR_MIN_VS_GAMES)
        .map(p => ({
          opponentId: p.playerBId,
          opponentName: p.playerB.firstName,
          counterMu: p.counterMu, // Advantage of playerA vs playerB
          vsGames: p.vsGames,
          winRate: p.vsGames > 0 ? p.vsWins / p.vsGames : 0
        })),
      ...pairsAsB
        .filter(p => p.vsGames >= CONFIG.PAIR_MIN_VS_GAMES)
        .map(p => ({
          opponentId: p.playerAId,
          opponentName: p.playerA.firstName,
          counterMu: -p.counterMu, // Reverse advantage for playerB vs playerA
          vsGames: p.vsGames,
          winRate: p.vsGames > 0 ? (p.vsGames - p.vsWins) / p.vsGames : 0 // Wins for playerB
        }))
    ];

    return {
      playerId,
      bestSynergies: allSynergies
        .sort((a, b) => b.synergyMu - a.synergyMu)
        .slice(0, 3),
      worstCounters: allCounters
        .sort((a, b) => a.counterMu - b.counterMu) // Worst counter means negative advantage
        .slice(0, 3)
    };
  }
}