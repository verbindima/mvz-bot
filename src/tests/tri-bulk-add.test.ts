import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { container } from 'tsyringe';
import { triBulkAddCommand } from '../commands/tri';
import type { BotContext } from '../bot';
import { prisma } from '../utils/database';
import { getCurrentWeek } from '../utils/week';

// Mock dependencies
vi.mock('../utils/database', () => ({
  prisma: {
    weekEntry: {
      findMany: vi.fn(),
      create: vi.fn()
    },
    player: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn()
    }
  }
}));

vi.mock('../utils/week');

vi.mock('../utils/chat', () => ({
  checkAdminPrivateOnly: vi.fn().mockResolvedValue(true)
}));

vi.mock('../config', () => ({
  CONFIG: {
    TRI_MODE_ENABLED: true,
    ADMINS: [123456789]
  }
}));

vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn()
  }
}));

const mockPrisma = vi.mocked(prisma);
const mockGetCurrentWeek = vi.mocked(getCurrentWeek);

describe('triBulkAddCommand', () => {
  let mockCtx: Partial<BotContext>;
  let mockGameService: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockGameService = {
      getWeekPlayers: vi.fn()
    };

    mockCtx = {
      from: { id: 123456789 },
      message: {
        text: '',
        message_id: 1,
        date: Date.now(),
        chat: { id: 123, type: 'private' }
      },
      chat: { id: 123, type: 'private' },
      reply: vi.fn(),
      gameService: mockGameService
    };

    mockGetCurrentWeek.mockReturnValue({ week: 35, year: 2024 });
  });

  it('should handle empty player list', async () => {
    mockCtx.message = {
      text: '/tri_bulk_add',
      message_id: 1,
      date: Date.now(),
      chat: { id: 123, type: 'private' }
    };

    await triBulkAddCommand(mockCtx as BotContext);

    expect(mockCtx.reply).toHaveBeenCalledWith(
      expect.stringContaining('❌ Не указан список игроков'),
      expect.objectContaining({ parse_mode: 'HTML' })
    );
  });

  it('should reject too many players', async () => {
    const playerList = Array.from({ length: 25 }, (_, i) => `Player ${i + 1}`).join('\n');
    mockCtx.message = {
      text: `/tri_bulk_add\n${playerList}`,
      message_id: 1,
      date: Date.now(),
      chat: { id: 123, type: 'private' }
    };

    await triBulkAddCommand(mockCtx as BotContext);

    expect(mockCtx.reply).toHaveBeenCalledWith(
      expect.stringContaining('❌ Слишком много игроков (25/24)')
    );
  });

  it('should add players by firstName', async () => {
    mockCtx.message = {
      text: '/tri_bulk_add\nИван Петров\nАлексей Смирнов',
      message_id: 1,
      date: Date.now(),
      chat: { id: 123, type: 'private' }
    };

    // Mock existing entries (empty)
    mockPrisma.weekEntry.findMany.mockResolvedValue([]);

    // Mock player searches
    mockPrisma.player.findFirst
      .mockResolvedValueOnce({
        id: 1,
        firstName: 'Иван',
        username: 'ivan_petrov',
        telegramId: BigInt(111111111)
      })
      .mockResolvedValueOnce({
        id: 2,
        firstName: 'Алексей',
        username: 'alex_smirnov',
        telegramId: BigInt(222222222)
      });

    // Mock week entry creation
    mockPrisma.weekEntry.create.mockResolvedValue({} as any);

    // Mock final stats
    mockGameService.getWeekPlayers.mockResolvedValue({
      main: [{ id: 1 }, { id: 2 }]
    });

    await triBulkAddCommand(mockCtx as BotContext);

    expect(mockPrisma.weekEntry.create).toHaveBeenCalledTimes(2);
    expect(mockCtx.reply).toHaveBeenCalledTimes(2);
    
    // Проверяем что финальное сообщение содержит отчет о добавленных игроках
    const finalCall = (mockCtx.reply as any).mock.calls[1];
    expect(finalCall[0]).toContain('✅');
    expect(finalCall[0]).toContain('Добавлено игроков (2)');
    expect(finalCall[0]).toContain('Иван (@ivan_petrov)');
    expect(finalCall[0]).toContain('Алексей (@alex_smirnov)');
    expect(finalCall[1]).toEqual({ parse_mode: 'HTML' });
  });

  it('should add players by username', async () => {
    mockCtx.message = {
      text: '/tri_bulk_add\n@ivan_petrov\n@alex_smirnov',
      message_id: 1,
      date: Date.now(),
      chat: { id: 123, type: 'private' }
    };

    // Mock existing entries (empty)
    mockPrisma.weekEntry.findMany.mockResolvedValue([]);

    // Mock player searches by username
    mockPrisma.player.findFirst
      .mockResolvedValueOnce({
        id: 1,
        firstName: 'Иван',
        username: 'ivan_petrov',
        telegramId: BigInt(111111111)
      })
      .mockResolvedValueOnce({
        id: 2,
        firstName: 'Алексей',
        username: 'alex_smirnov',
        telegramId: BigInt(222222222)
      });

    mockPrisma.weekEntry.create.mockResolvedValue({} as any);

    mockGameService.getWeekPlayers.mockResolvedValue({
      main: [{ id: 1 }, { id: 2 }]
    });

    await triBulkAddCommand(mockCtx as BotContext);

    expect(mockPrisma.player.findFirst).toHaveBeenCalledWith({
      where: { username: 'ivan_petrov' }
    });
    expect(mockPrisma.player.findFirst).toHaveBeenCalledWith({
      where: { username: 'alex_smirnov' }
    });
  });

  it('should add players by telegram ID', async () => {
    mockCtx.message = {
      text: '/tri_bulk_add\n111111111\n222222222',
      message_id: 1,
      date: Date.now(),
      chat: { id: 123, type: 'private' }
    };

    // Mock existing entries (empty)
    mockPrisma.weekEntry.findMany.mockResolvedValue([]);

    // Mock player searches by telegram ID
    mockPrisma.player.findUnique
      .mockResolvedValueOnce({
        id: 1,
        firstName: 'Иван',
        username: 'ivan_petrov',
        telegramId: BigInt(111111111)
      })
      .mockResolvedValueOnce({
        id: 2,
        firstName: 'Алексей',
        username: 'alex_smirnov',
        telegramId: BigInt(222222222)
      });

    mockPrisma.weekEntry.create.mockResolvedValue({} as any);

    mockGameService.getWeekPlayers.mockResolvedValue({
      main: [{ id: 1 }, { id: 2 }]
    });

    await triBulkAddCommand(mockCtx as BotContext);

    expect(mockPrisma.player.findUnique).toHaveBeenCalledWith({
      where: { telegramId: BigInt(111111111) }
    });
    expect(mockPrisma.player.findUnique).toHaveBeenCalledWith({
      where: { telegramId: BigInt(222222222) }
    });
  });

  it('should handle already joined players', async () => {
    mockCtx.message = {
      text: '/tri_bulk_add\nИван Петров',
      message_id: 1,
      date: Date.now(),
      chat: { id: 123, type: 'private' }
    };

    // Mock existing entries (player already joined)
    mockPrisma.weekEntry.findMany.mockResolvedValue([
      {
        player: {
          id: 1,
          firstName: 'Иван',
          username: 'ivan_petrov'
        }
      }
    ] as any);

    // Mock player search
    mockPrisma.player.findFirst.mockResolvedValue({
      id: 1,
      firstName: 'Иван',
      username: 'ivan_petrov',
      telegramId: BigInt(111111111)
    });

    mockGameService.getWeekPlayers.mockResolvedValue({
      main: [{ id: 1 }]
    });

    await triBulkAddCommand(mockCtx as BotContext);

    expect(mockPrisma.weekEntry.create).not.toHaveBeenCalled();
    expect(mockCtx.reply).toHaveBeenCalledTimes(2);
    
    // Проверяем что финальное сообщение содержит информацию об уже записанных игроках
    const finalCall = (mockCtx.reply as any).mock.calls[1];
    expect(finalCall[0]).toContain('✅');
    expect(finalCall[0]).toContain('Уже записаны (1)');
    expect(finalCall[0]).toContain('Иван (@ivan_petrov)');
    expect(finalCall[1]).toEqual({ parse_mode: 'HTML' });
  });

  it('should handle not found players', async () => {
    mockCtx.message = {
      text: '/tri_bulk_add\nНесуществующий Игрок',
      message_id: 1,
      date: Date.now(),
      chat: { id: 123, type: 'private' }
    };

    // Mock existing entries (empty)
    mockPrisma.weekEntry.findMany.mockResolvedValue([]);

    // Mock player not found
    mockPrisma.player.findFirst.mockResolvedValue(null);

    mockGameService.getWeekPlayers.mockResolvedValue({
      main: []
    });

    await triBulkAddCommand(mockCtx as BotContext);

    expect(mockPrisma.weekEntry.create).not.toHaveBeenCalled();
    expect(mockCtx.reply).toHaveBeenCalledTimes(2);
    
    // Проверяем что финальное сообщение содержит информацию о не найденных игроках
    const finalCall = (mockCtx.reply as any).mock.calls[1];
    expect(finalCall[0]).toContain('✅');
    expect(finalCall[0]).toContain('Не найдены (1)');
    expect(finalCall[0]).toContain('Несуществующий Игрок');
    expect(finalCall[1]).toEqual({ parse_mode: 'HTML' });
  });

  it('should show correct stats when TRI composition is full', async () => {
    mockCtx.message = {
      text: '/tri_bulk_add\nИван Петров',
      message_id: 1,
      date: Date.now(),
      chat: { id: 123, type: 'private' }
    };

    mockPrisma.weekEntry.findMany.mockResolvedValue([]);

    mockPrisma.player.findFirst.mockResolvedValue({
      id: 1,
      firstName: 'Иван',
      username: 'ivan_petrov',
      telegramId: BigInt(111111111)
    });

    mockPrisma.weekEntry.create.mockResolvedValue({} as any);

    // Mock 24 players (full TRI composition)
    mockGameService.getWeekPlayers.mockResolvedValue({
      main: Array.from({ length: 24 }, (_, i) => ({ id: i + 1 }))
    });

    await triBulkAddCommand(mockCtx as BotContext);

    expect(mockCtx.reply).toHaveBeenCalledTimes(2);
    
    // Проверяем что финальное сообщение содержит информацию о полном составе
    const finalCall = (mockCtx.reply as any).mock.calls[1];
    expect(finalCall[0]).toContain('✅');
    expect(finalCall[0]).toContain('TRI состав полный! Можно формировать команды');
    expect(finalCall[0]).toContain('24/24');
    expect(finalCall[1]).toEqual({ parse_mode: 'HTML' });
  });

  it('should auto-register new players by username', async () => {
    mockCtx.message = {
      text: '/tri_bulk_add\n@new_player',
      message_id: 1,
      date: Date.now(),
      chat: { id: 123, type: 'private' }
    };

    // Mock existing entries (empty)
    mockPrisma.weekEntry.findMany.mockResolvedValue([]);

    // Mock player not found, then auto-registration
    mockPrisma.player.findFirst.mockResolvedValue(null);
    mockPrisma.player.create.mockResolvedValue({
      id: 100,
      firstName: 'new_player',
      username: 'new_player',
      telegramId: BigInt(0)
    });

    mockPrisma.weekEntry.create.mockResolvedValue({} as any);

    mockGameService.getWeekPlayers.mockResolvedValue({
      main: [{ id: 100 }]
    });

    await triBulkAddCommand(mockCtx as BotContext);

    expect(mockPrisma.player.create).toHaveBeenCalledWith({
      data: {
        telegramId: BigInt(0),
        username: 'new_player',
        firstName: 'new_player',
        tsMu: 25,
        tsSigma: 8.333,
        isAdmin: false
      }
    });

    expect(mockPrisma.weekEntry.create).toHaveBeenCalledTimes(1);
    expect(mockCtx.reply).toHaveBeenCalledTimes(2);
    
    // Проверяем что финальное сообщение содержит информацию об авто-регистрации
    const finalCall = (mockCtx.reply as any).mock.calls[1];
    expect(finalCall[0]).toContain('🆕');
    expect(finalCall[0]).toContain('Автоматически зарегистрированы (1)');
    expect(finalCall[0]).toContain('@new_player (новый игрок)');
    expect(finalCall[1]).toEqual({ parse_mode: 'HTML' });
  });

  it('should auto-register new players by telegram ID', async () => {
    mockCtx.message = {
      text: '/tri_bulk_add\n999888777',
      message_id: 1,
      date: Date.now(),
      chat: { id: 123, type: 'private' }
    };

    // Mock existing entries (empty)
    mockPrisma.weekEntry.findMany.mockResolvedValue([]);

    // Mock player not found, then auto-registration
    mockPrisma.player.findUnique.mockResolvedValue(null);
    mockPrisma.player.create.mockResolvedValue({
      id: 101,
      firstName: 'ID999888777',
      username: null,
      telegramId: BigInt(999888777)
    });

    mockPrisma.weekEntry.create.mockResolvedValue({} as any);

    mockGameService.getWeekPlayers.mockResolvedValue({
      main: [{ id: 101 }]
    });

    await triBulkAddCommand(mockCtx as BotContext);

    expect(mockPrisma.player.create).toHaveBeenCalledWith({
      data: {
        telegramId: BigInt(999888777),
        username: null,
        firstName: 'ID999888777',
        tsMu: 25,
        tsSigma: 8.333,
        isAdmin: false
      }
    });

    expect(mockPrisma.weekEntry.create).toHaveBeenCalledTimes(1);
    expect(mockCtx.reply).toHaveBeenCalledTimes(2);
    
    // Проверяем что финальное сообщение содержит информацию об авто-регистрации
    const finalCall = (mockCtx.reply as any).mock.calls[1];
    expect(finalCall[0]).toContain('🆕');
    expect(finalCall[0]).toContain('Автоматически зарегистрированы (1)');
    expect(finalCall[0]).toContain('ID999888777 (новый игрок)');
    expect(finalCall[1]).toEqual({ parse_mode: 'HTML' });
  });

  it('should not auto-register by firstName', async () => {
    mockCtx.message = {
      text: '/tri_bulk_add\nНовый Игрок',
      message_id: 1,
      date: Date.now(),
      chat: { id: 123, type: 'private' }
    };

    // Mock existing entries (empty)
    mockPrisma.weekEntry.findMany.mockResolvedValue([]);

    // Mock player not found
    mockPrisma.player.findFirst.mockResolvedValue(null);

    mockGameService.getWeekPlayers.mockResolvedValue({
      main: []
    });

    await triBulkAddCommand(mockCtx as BotContext);

    expect(mockPrisma.player.create).not.toHaveBeenCalled();
    expect(mockPrisma.weekEntry.create).not.toHaveBeenCalled();
    expect(mockCtx.reply).toHaveBeenCalledTimes(2);
    
    // Проверяем что игрок остается в списке не найденных
    const finalCall = (mockCtx.reply as any).mock.calls[1];
    expect(finalCall[0]).toContain('❌');
    expect(finalCall[0]).toContain('Не найдены (1)');
    expect(finalCall[0]).toContain('Новый Игрок');
  });
});