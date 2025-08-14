import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GameService } from '../services/game.service';

vi.mock('../utils/database', () => ({
  prisma: {
    player: {
      findUnique: vi.fn(),
    },
    weekEntry: {
      findUnique: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
      delete: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    gameSession: {
      upsert: vi.fn(),
    },
  },
}));

vi.mock('../utils/week', () => ({
  getCurrentWeek: vi.fn(() => ({ week: 32, year: 2024 })),
}));

const mockPrisma = vi.mocked(await import('../utils/database')).prisma;

describe('GameService', () => {
  let gameService: GameService;
  const mockPlayer = {
    id: 1,
    telegramId: BigInt(12345),
    username: 'testuser',
    firstName: 'Test',
    tsMu: 25.0,
    tsSigma: 8.333,
    isAdmin: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    gameService = new GameService();
    vi.clearAllMocks();
  });

  describe('joinGame', () => {
    it('should successfully join game when player exists and not already joined', async () => {
      mockPrisma.player.findUnique.mockResolvedValue(mockPlayer);
      mockPrisma.weekEntry.findUnique.mockResolvedValue(null);
      mockPrisma.weekEntry.count.mockResolvedValue(10);
      mockPrisma.weekEntry.create.mockResolvedValue({
        id: 1,
        week: 32,
        year: 2024,
        playerId: 1,
        state: 'MAIN',
        createdAt: new Date(),
      });

      const result = await gameService.joinGame(12345);

      expect(result.success).toBe(true);
      expect(result.position).toBe(11);
      expect(mockPrisma.weekEntry.create).toHaveBeenCalledWith({
        data: {
          week: 32,
          year: 2024,
          playerId: 1,
          state: 'MAIN',
        },
      });
    });

    it('should join waiting list when main squad is full', async () => {
      mockPrisma.player.findUnique.mockResolvedValue(mockPlayer);
      mockPrisma.weekEntry.findUnique.mockResolvedValue(null);
      mockPrisma.weekEntry.count.mockResolvedValue(16);
      mockPrisma.weekEntry.create.mockResolvedValue({
        id: 1,
        week: 32,
        year: 2024,
        playerId: 1,
        state: 'WAIT',
        createdAt: new Date(),
      });

      const result = await gameService.joinGame(12345);

      expect(result.success).toBe(true);
      expect(result.position).toBe(17);
      expect(mockPrisma.weekEntry.create).toHaveBeenCalledWith({
        data: {
          week: 32,
          year: 2024,
          playerId: 1,
          state: 'WAIT',
        },
      });
    });

    it('should fail when player not found', async () => {
      mockPrisma.player.findUnique.mockResolvedValue(null);

      const result = await gameService.joinGame(12345);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Игрок не найден. Выполните /start для регистрации.');
    });

    it('should fail when player already joined', async () => {
      mockPrisma.player.findUnique.mockResolvedValue(mockPlayer);
      mockPrisma.weekEntry.findUnique.mockResolvedValue({
        id: 1,
        week: 32,
        year: 2024,
        playerId: 1,
        state: 'MAIN',
        createdAt: new Date(),
      });

      const result = await gameService.joinGame(12345);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Вы уже записаны на эту игру!');
    });
  });

  describe('leaveGame', () => {
    it('should successfully leave game and promote waiting player', async () => {
      const mockEntry = {
        id: 1,
        week: 32,
        year: 2024,
        playerId: 1,
        state: 'MAIN',
        createdAt: new Date(),
      };

      const mockWaitingEntry = {
        id: 2,
        week: 32,
        year: 2024,
        playerId: 2,
        state: 'WAIT',
        createdAt: new Date(),
      };

      mockPrisma.player.findUnique.mockResolvedValue(mockPlayer);
      mockPrisma.weekEntry.findUnique.mockResolvedValue(mockEntry);
      mockPrisma.weekEntry.delete.mockResolvedValue(mockEntry);
      mockPrisma.weekEntry.findFirst.mockResolvedValue(mockWaitingEntry);
      mockPrisma.weekEntry.update.mockResolvedValue({
        ...mockWaitingEntry,
        state: 'MAIN',
      });

      const result = await gameService.leaveGame(12345);

      expect(result.success).toBe(true);
      expect(mockPrisma.weekEntry.delete).toHaveBeenCalledWith({ where: { id: 1 } });
      expect(mockPrisma.weekEntry.update).toHaveBeenCalledWith({
        where: { id: 2 },
        data: { state: 'MAIN' },
      });
    });

    it('should fail when player not in game', async () => {
      mockPrisma.player.findUnique.mockResolvedValue(mockPlayer);
      mockPrisma.weekEntry.findUnique.mockResolvedValue(null);

      const result = await gameService.leaveGame(12345);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Вы не записаны на игру.');
    });
  });

  describe('getWeekPlayers', () => {
    it('should return main and waiting players', async () => {
      const mockEntries = [
        {
          state: 'MAIN',
          player: { ...mockPlayer, id: 1 },
          id: 1,
          week: 32,
          year: 2024,
          playerId: 1,
          createdAt: new Date(),
        },
        {
          state: 'WAIT',
          player: { ...mockPlayer, id: 2, telegramId: BigInt(67890) },
          id: 2,
          week: 32,
          year: 2024,
          playerId: 2,
          createdAt: new Date(),
        },
      ];

      mockPrisma.weekEntry.findMany.mockResolvedValue(mockEntries);

      const result = await gameService.getWeekPlayers();

      expect(result.main).toHaveLength(1);
      expect(result.waiting).toHaveLength(1);
      expect(result.main[0].id).toBe(1);
      expect(result.waiting[0].id).toBe(2);
    });
  });
});