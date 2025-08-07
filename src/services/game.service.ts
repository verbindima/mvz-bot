import { injectable } from 'tsyringe';
import { Player, WeekEntry } from '@prisma/client';
import { prisma } from '@/utils/database';
import { getCurrentWeek } from '@/utils/week';
import { logger } from '@/utils/logger';

export interface GameResult {
  success: boolean;
  error?: string;
  position?: number;
}

@injectable()
export class GameService {
  async joinGame(telegramId: number): Promise<GameResult> {
    try {
      const player = await prisma.player.findUnique({
        where: { telegramId: BigInt(telegramId) },
      });

      if (!player) {
        return { success: false, error: 'Игрок не найден. Выполните /start для регистрации.' };
      }

      const { week, year } = getCurrentWeek();

      const existingEntry = await prisma.weekEntry.findFirst({
        where: {
          week,
          year,
          playerId: player.id,
        },
      });

      if (existingEntry) {
        return { success: false, error: 'Вы уже записаны на эту игру!' };
      }

      const currentEntries = await prisma.weekEntry.count({
        where: { week, year },
      });

      const state = currentEntries < 16 ? 'MAIN' : 'WAIT';

      await prisma.weekEntry.create({
        data: {
          week,
          year,
          playerId: player.id,
          state,
        },
      });

      logger.info(`Player ${telegramId} joined game for week ${year}-${week}, position: ${currentEntries + 1}`);
      
      return {
        success: true,
        position: currentEntries + 1,
      };
    } catch (error) {
      logger.error('Error joining game:', error);
      return { success: false, error: 'Произошла ошибка при записи на игру.' };
    }
  }

  async leaveGame(telegramId: number): Promise<GameResult> {
    try {
      const player = await prisma.player.findUnique({
        where: { telegramId: BigInt(telegramId) },
      });

      if (!player) {
        return { success: false, error: 'Игрок не найден.' };
      }

      const { week, year } = getCurrentWeek();

      const entry = await prisma.weekEntry.findFirst({
        where: {
          week,
          year,
          playerId: player.id,
        },
      });

      if (!entry) {
        return { success: false, error: 'Вы не записаны на игру.' };
      }

      await prisma.weekEntry.delete({
        where: { id: entry.id },
      });

      if (entry.state === 'MAIN') {
        const firstWaitingEntry = await prisma.weekEntry.findFirst({
          where: {
            week,
            year,
            state: 'WAIT',
          },
          orderBy: { createdAt: 'asc' },
        });

        if (firstWaitingEntry) {
          await prisma.weekEntry.update({
            where: { id: firstWaitingEntry.id },
            data: { state: 'MAIN' },
          });
          logger.info(`Player moved from waiting list to main squad: ${firstWaitingEntry.playerId}`);
        }
      }

      logger.info(`Player ${telegramId} left game for week ${year}-${week}`);
      return { success: true };
    } catch (error) {
      logger.error('Error leaving game:', error);
      return { success: false, error: 'Произошла ошибка при выходе из игры.' };
    }
  }

  async getWeekPlayers(week?: number, year?: number): Promise<{
    main: (Player & { weekEntry: WeekEntry })[];
    waiting: (Player & { weekEntry: WeekEntry })[];
  }> {
    try {
      const currentWeek = week || getCurrentWeek().week;
      const currentYear = year || getCurrentWeek().year;

      const entries = await prisma.weekEntry.findMany({
        where: {
          week: currentWeek,
          year: currentYear,
        },
        include: {
          player: true,
        },
        orderBy: { createdAt: 'asc' },
      });

      const main = entries
        .filter(entry => entry.state === 'MAIN')
        .map(entry => ({ ...entry.player, weekEntry: entry }));

      const waiting = entries
        .filter(entry => entry.state === 'WAIT')
        .map(entry => ({ ...entry.player, weekEntry: entry }));

      return { main, waiting };
    } catch (error) {
      logger.error('Error getting week players:', error);
      throw error;
    }
  }

  async confirmTeams(): Promise<void> {
    try {
      const { week, year } = getCurrentWeek();
      
      await prisma.gameSession.upsert({
        where: {
          week_year: { week, year },
        },
        update: {
          isConfirmed: true,
        },
        create: {
          week,
          year,
          teamA: '',
          teamB: '',
          isConfirmed: true,
        },
      });

      logger.info(`Teams confirmed for week ${year}-${week}`);
    } catch (error) {
      logger.error('Error confirming teams:', error);
      throw error;
    }
  }
}