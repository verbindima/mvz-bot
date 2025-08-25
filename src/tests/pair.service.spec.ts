import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { container } from 'tsyringe';
import { PairService } from '../services/pair.service';
import { prisma } from '../utils/database';
import { CONFIG } from '../config';

vi.mock('../utils/database');
vi.mock('../config', () => ({
  CONFIG: {
    SYNERGY_ENABLED: true,
    PAIR_GAMES_FOR_CONF: 8,
    PAIR_CAP: 0.8,
    PAIR_DECAY_HALF_LIFE_WEEKS: 8,
    PAIR_DECAY_FACTOR: 0.9,
    PAIR_SCALE_SAME: 2.0,
    PAIR_SCALE_VS: 2.0,
    PAIR_MIN_SAME_GAMES: 3,
    PAIR_MIN_VS_GAMES: 3
  }
}));

describe('PairService', () => {
  let pairService: PairService;

  beforeEach(() => {
    container.clearInstances();
    pairService = new PairService();
    vi.clearAllMocks();
  });

  describe('updateAfterMatch', () => {
    it('should skip updates when synergy is disabled', async () => {
      vi.mocked(CONFIG).SYNERGY_ENABLED = false;
      
      await pairService.updateAfterMatch([1, 2, 3], [4, 5, 6]);
      
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should update together stats for winning team', async () => {
      const mockUpsert = vi.fn();
      vi.mocked(prisma.playerPair).upsert = mockUpsert;
      vi.mocked(prisma.$transaction).mockResolvedValue([]);

      await pairService.updateAfterMatch([1, 2], [3, 4]);

      // Should create/update pair (1,2) with together win
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            playerAId_playerBId: {
              playerAId: 1,
              playerBId: 2
            }
          },
          update: expect.objectContaining({
            togetherGames: { increment: 1 },
            togetherWins: { increment: 1 }
          }),
          create: expect.objectContaining({
            playerAId: 1,
            playerBId: 2,
            togetherGames: 1,
            togetherWins: 1
          })
        })
      );
    });

    it('should update together stats for losing team', async () => {
      const mockUpsert = vi.fn();
      vi.mocked(prisma.playerPair).upsert = mockUpsert;
      vi.mocked(prisma.$transaction).mockResolvedValue([]);

      await pairService.updateAfterMatch([1, 2], [3, 4]);

      // Should create/update pair (3,4) with together loss
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            playerAId_playerBId: {
              playerAId: 3,
              playerBId: 4
            }
          },
          update: expect.objectContaining({
            togetherGames: { increment: 1 },
            togetherWins: { increment: 0 }
          }),
          create: expect.objectContaining({
            playerAId: 3,
            playerBId: 4,
            togetherGames: 1,
            togetherWins: 0
          })
        })
      );
    });

    it('should update vs stats between teams', async () => {
      const mockUpsert = vi.fn();
      vi.mocked(prisma.playerPair).upsert = mockUpsert;
      vi.mocked(prisma.$transaction).mockResolvedValue([]);

      await pairService.updateAfterMatch([1], [2]);

      // Should create/update pair (1,2) with vs stats (1 wins against 2)
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            playerAId_playerBId: {
              playerAId: 1,
              playerBId: 2
            }
          },
          update: expect.objectContaining({
            vsGames: { increment: 1 },
            vsWins: { increment: 1 } // Player 1 (smaller ID) wins
          }),
          create: expect.objectContaining({
            playerAId: 1,
            playerBId: 2,
            vsGames: 1,
            vsWins: 1
          })
        })
      );
    });

    it('should handle vs stats with correct direction', async () => {
      const mockUpsert = vi.fn();
      vi.mocked(prisma.playerPair).upsert = mockUpsert;
      vi.mocked(prisma.$transaction).mockResolvedValue([]);

      await pairService.updateAfterMatch([2], [1]); // Higher ID wins

      // Should create/update pair (1,2) with vs stats (2 wins against 1, but stored as 0 for player 1)
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            playerAId_playerBId: {
              playerAId: 1,
              playerBId: 2
            }
          },
          update: expect.objectContaining({
            vsGames: { increment: 1 },
            vsWins: { increment: 0 } // Player 2 wins, but we store wins for player 1 (smaller ID)
          }),
          create: expect.objectContaining({
            playerAId: 1,
            playerBId: 2,
            vsGames: 1,
            vsWins: 0
          })
        })
      );
    });
  });

  describe('loadMatrixFor', () => {
    it('should return empty matrix when synergy is disabled', async () => {
      vi.mocked(CONFIG).SYNERGY_ENABLED = false;
      
      const result = await pairService.loadMatrixFor([1, 2, 3]);
      
      expect(result).toEqual({});
    });

    it('should load pair data and create matrix', async () => {
      const mockPairData = [
        {
          playerAId: 1,
          playerBId: 2,
          synergyMu: 0.5,
          synergySigma: 0.2,
          counterMu: -0.3,
          counterSigma: 0.4
        }
      ];
      
      vi.mocked(prisma.playerPair).findMany = vi.fn().mockResolvedValue(mockPairData);
      
      const result = await pairService.loadMatrixFor([1, 2, 3]);
      
      expect(result).toEqual({
        '1-2': {
          synergyMu: 0.5,
          synergySigma: 0.2,
          counterMu: -0.3,
          counterSigma: 0.4
        },
        '1-3': {
          synergyMu: 0,
          synergySigma: 1,
          counterMu: 0,
          counterSigma: 1
        },
        '2-3': {
          synergyMu: 0,
          synergySigma: 1,
          counterMu: 0,
          counterSigma: 1
        }
      });
    });
  });

  describe('getPlayerPairStats', () => {
    it('should return null for non-existent player', async () => {
      vi.mocked(prisma.player).findUnique = vi.fn().mockResolvedValue(null);
      
      const result = await pairService.getPlayerPairStats(999);
      
      expect(result).toBeNull();
    });

    it('should return pair statistics for existing player', async () => {
      const mockPlayer = { id: 1, firstName: 'Test Player' };
      const mockPairsAsA = [
        {
          playerBId: 2,
          playerB: { firstName: 'Partner' },
          togetherGames: 5,
          togetherWins: 4,
          vsGames: 3,
          vsWins: 2,
          synergyMu: 0.6,
          counterMu: 0.3
        }
      ];
      const mockPairsAsB = [];

      vi.mocked(prisma.player).findUnique = vi.fn().mockResolvedValue(mockPlayer);
      vi.mocked(prisma.playerPair).findMany = vi.fn()
        .mockResolvedValueOnce(mockPairsAsA) // pairsAsA
        .mockResolvedValueOnce(mockPairsAsB); // pairsAsB

      const result = await pairService.getPlayerPairStats(1);

      expect(result).toEqual({
        playerId: 1,
        bestSynergies: [
          {
            partnerId: 2,
            partnerName: 'Partner',
            synergyMu: 0.6,
            togetherGames: 5,
            winRate: 0.8
          }
        ],
        worstCounters: [
          {
            opponentId: 2,
            opponentName: 'Partner',
            counterMu: 0.3,
            vsGames: 3,
            winRate: 2/3
          }
        ]
      });
    });
  });

  describe('private methods', () => {
    it('should calculate confidence correctly', () => {
      // Access private method through class instance
      const confidenceMethod = (pairService as any).calculateConfidence.bind(pairService);
      
      expect(confidenceMethod(0)).toBe(0);
      expect(confidenceMethod(4)).toBe(0.5); // 4 / PAIR_GAMES_FOR_CONF (8)
      expect(confidenceMethod(8)).toBe(1);
      expect(confidenceMethod(16)).toBe(1); // Capped at 1
    });

    it('should clamp values correctly', () => {
      const clampMethod = (pairService as any).clamp.bind(pairService);
      
      expect(clampMethod(-1, -0.5, 0.5)).toBe(-0.5);
      expect(clampMethod(0.2, -0.5, 0.5)).toBe(0.2);
      expect(clampMethod(1, -0.5, 0.5)).toBe(0.5);
    });

    it('should calculate decay correctly', () => {
      const calculateDecayMethod = (pairService as any).calculateDecay.bind(pairService);
      const currentDate = new Date('2023-01-01');
      
      // No last game
      expect(calculateDecayMethod(null, currentDate)).toBe(1);
      
      // Recent game (within half-life)
      const recentDate = new Date('2022-12-01'); // 4 weeks ago
      expect(calculateDecayMethod(recentDate, currentDate)).toBe(1);
      
      // Old game (beyond half-life)
      const oldDate = new Date('2022-09-01'); // ~17 weeks ago, > 8 weeks half-life
      const decay = calculateDecayMethod(oldDate, currentDate);
      expect(decay).toBeLessThan(1);
      expect(decay).toBeGreaterThan(0);
    });
  });
});