import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { container } from 'tsyringe';
import { TeamService } from '../services/team.service';
import { PairService, PairMatrix } from '../services/pair.service';
import { Player } from '@prisma/client';

vi.mock('../services/pair.service');
vi.mock('../config', () => ({
  CONFIG: {
    SYNERGY_ENABLED: true,
    SYNERGY_WEIGHT_SAME: 0.6,
    SYNERGY_WEIGHT_VS: 0.4,
    MAX_BASE_DIFF: 2.0,
    SCHEME: 'ts'
  }
}));

describe('TeamService with Chemistry', () => {
  let teamService: TeamService;
  let mockPairService: PairService;
  let players: Player[];

  beforeEach(() => {
    container.clearInstances();
    teamService = new TeamService();
    mockPairService = {
      loadMatrixFor: vi.fn()
    } as any;
    container.registerInstance(PairService, mockPairService);
    
    // Create 16 test players with balanced ratings
    players = Array.from({ length: 16 }, (_, i) => ({
      id: i + 1,
      telegramId: BigInt(i + 1),
      username: `user${i + 1}`,
      firstName: `Player${i + 1}`,
      tsMu: 25.0 + (i % 4) * 2, // Ratings from 25-31, distributed evenly
      tsSigma: 8.333,
      isAdmin: false,
      lastPlayedAt: new Date(),
      firstPlayedAt: new Date(),
      gamesPlayed: 10,
      mvpCount: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    }));
    
    vi.clearAllMocks();
  });

  describe('generateBalancedTeams', () => {
    it('should generate teams without synergy when disabled', async () => {
      vi.doMock('../config', () => ({
        CONFIG: {
          SYNERGY_ENABLED: false,
          SCHEME: 'ts'
        }
      }));
      
      const result = await teamService.generateBalancedTeams(players);
      
      expect(result.teamA.players).toHaveLength(8);
      expect(result.teamB.players).toHaveLength(8);
      expect(result.synergyEnabled).toBe(false);
      expect(result.effectiveDifference).toBeUndefined();
      expect(mockPairService.loadMatrixFor).not.toHaveBeenCalled();
    });

    it('should load pair matrix when synergy is enabled', async () => {
      const mockMatrix: PairMatrix = {
        '1-2': { synergyMu: 0.5, synergySigma: 0.2, counterMu: 0, counterSigma: 1 }
      };
      
      vi.mocked(mockPairService.loadMatrixFor).mockResolvedValue(mockMatrix);
      
      const result = await teamService.generateBalancedTeams(players);
      
      expect(mockPairService.loadMatrixFor).toHaveBeenCalledWith(
        players.map(p => p.id)
      );
      expect(result.synergyEnabled).toBe(true);
      expect(result.effectiveDifference).toBeDefined();
    });

    it('should calculate effective difference with synergy', async () => {
      const mockMatrix: PairMatrix = {
        '1-2': { synergyMu: 1.0, synergySigma: 0, counterMu: 0, counterSigma: 1 },
        '3-4': { synergyMu: -1.0, synergySigma: 0, counterMu: 0, counterSigma: 1 }
      };
      
      vi.mocked(mockPairService.loadMatrixFor).mockResolvedValue(mockMatrix);
      
      const result = await teamService.generateBalancedTeams(players);
      
      expect(result.effectiveDifference).toBeDefined();
      expect(result.effectiveDifference).not.toBe(result.difference);
    });

    it('should respect base difference constraint in stochastic improvement', async () => {
      // Create players with very different ratings
      const unevenPlayers = players.map((p, i) => ({
        ...p,
        tsMu: i < 8 ? 30 : 20 // First 8 players much stronger
      }));
      
      const mockMatrix: PairMatrix = {
        '1-9': { synergyMu: 2.0, synergySigma: 0, counterMu: 0, counterSigma: 1 }
      };
      
      vi.mocked(mockPairService.loadMatrixFor).mockResolvedValue(mockMatrix);
      
      const result = await teamService.generateBalancedTeams(unevenPlayers);
      
      // Base difference should be within MAX_BASE_DIFF (2.0)
      expect(result.difference).toBeLessThanOrEqual(2.1); // Small tolerance for rounding
    });
  });

  describe('formatTeamsMessage', () => {
    it('should include chemistry information when enabled', () => {
      const balance = {
        teamA: {
          players: players.slice(0, 8),
          totalRating: 200,
          averageRating: 25
        },
        teamB: {
          players: players.slice(8, 16),
          totalRating: 195,
          averageRating: 24.375
        },
        difference: 5,
        winProbability: 60,
        effectiveDifference: 3.2,
        synergyEnabled: true
      };
      
      const message = teamService.formatTeamsMessage(balance);
      
      expect(message).toContain('📊 Разница в силе: 5.0 μ');
      expect(message).toContain('🧪 С учетом химии: 3.2 μ');
    });

    it('should not include chemistry information when disabled', () => {
      const balance = {
        teamA: {
          players: players.slice(0, 8),
          totalRating: 200,
          averageRating: 25
        },
        teamB: {
          players: players.slice(8, 16),
          totalRating: 195,
          averageRating: 24.375
        },
        difference: 5,
        winProbability: 60,
        synergyEnabled: false
      };
      
      const message = teamService.formatTeamsMessage(balance);
      
      expect(message).toContain('📊 Разница в силе: 5.0 μ');
      expect(message).not.toContain('🧪 С учетом химии');
    });
  });

  describe('private chemistry calculations', () => {
    let teamA: Player[];
    let teamB: Player[];
    let pairMatrix: PairMatrix;

    beforeEach(() => {
      teamA = players.slice(0, 8);
      teamB = players.slice(8, 16);
      
      pairMatrix = {
        '1-2': { synergyMu: 0.5, synergySigma: 0.2, counterMu: 0, counterSigma: 1 },
        '3-4': { synergyMu: -0.3, synergySigma: 0.1, counterMu: 0, counterSigma: 1 },
        '1-9': { synergyMu: 0, synergySigma: 1, counterMu: 0.4, counterSigma: 0.3 }
      };
    });

    it('should calculate synergy within team correctly', () => {
      const calculateSynergyMethod = (teamService as any).calculateSynergyWithin.bind(teamService);
      
      const synergy = calculateSynergyMethod([players[0], players[1]], pairMatrix);
      
      // Should use pair 1-2 with synergyMu=0.5, synergySigma=0.2
      // confidence = max(0, 1 - 0.2) = 0.8
      // synergy = 0.5 * 0.8 = 0.4
      expect(synergy).toBe(0.4);
    });

    it('should calculate counter effects between teams correctly', () => {
      const calculateCounterMethod = (teamService as any).calculateCounterBetween.bind(teamService);
      
      const counter = calculateCounterMethod([players[0]], [players[8]], pairMatrix);
      
      // Should use pair 1-9 with counterMu=0.4, counterSigma=0.3
      // confidence = max(0, 1 - 0.3) = 0.7
      // advantage for player 1 (smaller ID) = 0.4 * 0.7 = 0.28
      expect(counter).toBeCloseTo(0.28, 2);
    });

    it('should calculate effective strength correctly', () => {
      const calculateEffectiveMethod = (teamService as any).calculateEffectiveStrength.bind(teamService);
      
      const effectiveStrength = calculateEffectiveMethod(
        [players[0], players[1]], // Team with positive synergy
        [players[8]], // Opponent
        pairMatrix
      );
      
      const baseStrength = players[0].tsMu + players[1].tsMu; // 50
      expect(effectiveStrength).toBeGreaterThan(baseStrength);
    });

    it('should apply tanh function to prevent extreme values', () => {
      const extremePairMatrix = {
        '1-2': { synergyMu: 10, synergySigma: 0, counterMu: 0, counterSigma: 1 }
      };
      
      const calculateEffectiveMethod = (teamService as any).calculateEffectiveStrength.bind(teamService);
      
      const effectiveStrength = calculateEffectiveMethod(
        [players[0], players[1]],
        [players[8]],
        extremePairMatrix
      );
      
      const baseStrength = players[0].tsMu + players[1].tsMu;
      const maxSynergyBonus = 0.6 * Math.tanh(10); // Should be close to 0.6
      
      expect(effectiveStrength).toBeLessThan(baseStrength + maxSynergyBonus + 0.1);
    });
  });

  describe('error handling', () => {
    it('should throw error for wrong number of players', async () => {
      await expect(
        teamService.generateBalancedTeams(players.slice(0, 10))
      ).rejects.toThrow('Exactly 16 players are required');
    });

    it('should handle empty pair matrix gracefully', async () => {
      vi.mocked(mockPairService.loadMatrixFor).mockResolvedValue({});
      
      const result = await teamService.generateBalancedTeams(players);
      
      expect(result).toBeDefined();
      expect(result.teamA.players).toHaveLength(8);
      expect(result.teamB.players).toHaveLength(8);
    });
  });
});