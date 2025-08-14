import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InactivityService } from '../services/inactivity.service';
import { RatingService } from '../services/rating.service';
import { Player } from '@prisma/client';

// Mock конфигурации
vi.mock('../config', () => ({
  CONFIG: {
    RATING_IDLE_ENABLED: true,
    RATING_IDLE_LAMBDA: 0.35,
    RATING_IDLE_PERIOD_DAYS: 7,
    RATING_SIGMA0: 8.333,
    RATING_SIGMA_FLOOR: 1.0,
    RATING_MVP_ENABLED: true,
    RATING_MVP_MU_BONUS: 0.6,
    RATING_MVP_SIGMA_MULT: 1.0,
  }
}));

vi.mock('../utils/database', () => ({
  prisma: {
    player: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    ratingEvent: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  }
}));

describe('TrueSkill Improvements', () => {
  let inactivityService: InactivityService;
  let ratingService: RatingService;

  const createMockPlayer = (overrides: Partial<Player> = {}): Player => ({
    id: 1,
    telegramId: BigInt(123),
    username: 'testuser',
    firstName: 'Test User',
    tsMu: 25.0,
    tsSigma: 8.333,
    isAdmin: false,
    lastPlayedAt: null,
    firstPlayedAt: null,
    gamesPlayed: 0,
    mvpCount: 0,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  });

  beforeEach(() => {
    inactivityService = new InactivityService();
    ratingService = new RatingService();
    vi.clearAllMocks();
  });

  describe('InactivityService', () => {
    it('should not inflate sigma for players with 0 games', () => {
      const player = createMockPlayer({ gamesPlayed: 0 });
      const result = inactivityService.inflateForPlayer(player, 4); // 4 недели неактивности
      
      expect(result.tsSigma).toBe(player.tsSigma); // Не должно измениться
    });

    it('should inflate sigma for inactive experienced players', () => {
      const player = createMockPlayer({ 
        gamesPlayed: 5, 
        tsSigma: 2.0 // Опытный игрок с низкой неопределенностью
      });
      
      const result = inactivityService.inflateForPlayer(player, 4); // 4 недели неактивности
      
      expect(result.tsSigma).toBeGreaterThan(2.0); // Должно увеличиться
      expect(result.tsSigma).toBeLessThanOrEqual(8.333); // Не выше sigma0
    });

    it('should cap sigma inflation at sigma0', () => {
      const player = createMockPlayer({ 
        gamesPlayed: 5, 
        tsSigma: 1.0 
      });
      
      const result = inactivityService.inflateForPlayer(player, 100); // Очень долгая неактивность
      
      expect(result.tsSigma).toBeLessThanOrEqual(8.333); // Не выше sigma0
    });

    it('should calculate weeks between dates correctly', () => {
      const player = createMockPlayer({ 
        gamesPlayed: 5,
        lastPlayedAt: new Date('2024-01-01')
      });
      
      const currentDate = new Date('2024-01-29'); // 4 недели спустя
      const { weeksInactive } = inactivityService.calculateInflation(player, currentDate);
      
      expect(weeksInactive).toBe(4);
    });
  });

  describe('RatingService MVP validation', () => {
    it('should validate maximum 2 MVP players', async () => {
      const winners = [1, 2, 3, 4];
      const losers = [5, 6, 7, 8];
      const mvpIds = [1, 2, 3]; // Слишком много MVP
      
      await expect(
        ratingService.updateTrueSkill(winners, losers, { mvpIds })
      ).rejects.toThrow('maximum 2 MVP players allowed');
    });

    it('should validate MVP belongs to match participants', async () => {
      const winners = [1, 2, 3, 4];
      const losers = [5, 6, 7, 8];
      const mvpIds = [9]; // Не участвует в матче
      
      await expect(
        ratingService.updateTrueSkill(winners, losers, { mvpIds })
      ).rejects.toThrow('MVP player 9 not in match');
    });

    it('should validate maximum 1 MVP per team', async () => {
      const winners = [1, 2, 3, 4];
      const losers = [5, 6, 7, 8];
      const mvpIds = [1, 2]; // Оба из команды победителей
      
      await expect(
        ratingService.updateTrueSkill(winners, losers, { mvpIds })
      ).rejects.toThrow('maximum 1 MVP per team allowed');
    });
  });

  describe('Exponential sigma inflation formula', () => {
    it('should use correct exponential formula', () => {
      const player = createMockPlayer({ 
        gamesPlayed: 5, 
        tsSigma: 2.0 
      });
      
      const weeks = 2;
      const lambda = 0.35;
      const sigma0 = 8.333;
      
      const result = inactivityService.inflateForPlayer(player, weeks);
      
      // Ручная проверка формулы: σ_new^2 = σ_old^2 + (σ0^2 - σ_old^2) * (1 - exp(-λ * Δw))
      const s2 = 2.0 * 2.0;
      const s02 = sigma0 * sigma0;
      const expected_s2 = s2 + (s02 - s2) * (1 - Math.exp(-lambda * weeks));
      const expectedSigma = Math.sqrt(expected_s2);
      
      expect(result.tsSigma).toBeCloseTo(expectedSigma, 3);
    });

    it('should be monotonic (never decrease sigma)', () => {
      const player = createMockPlayer({ 
        gamesPlayed: 5, 
        tsSigma: 5.0 
      });
      
      const result = inactivityService.inflateForPlayer(player, 1);
      
      expect(result.tsSigma).toBeGreaterThanOrEqual(5.0);
    });
  });
});