import { injectable } from 'tsyringe';
import { Player } from '@prisma/client';
import { prisma } from '../utils/database';
import { logger } from '../utils/logger';

@injectable()
export class PlayerService {
  async getOrCreatePlayer(telegramId: number, username?: string, firstName?: string): Promise<Player> {
    try {
      let player = await prisma.player.findUnique({
        where: { telegramId: BigInt(telegramId) },
      });

      if (!player) {
        player = await prisma.player.create({
          data: {
            telegramId: BigInt(telegramId),
            username: username || null,
            firstName: firstName || 'Неизвестный',
          },
        });
        logger.info(`New player registered: ${telegramId} (${firstName})`);
      } else if (username && player.username !== username) {
        player = await prisma.player.update({
          where: { id: player.id },
          data: { username },
        });
      }

      return player;
    } catch (error) {
      logger.error('Error in getOrCreatePlayer:', error);
      throw error;
    }
  }


  async getPlayer(telegramId: number): Promise<Player | null> {
    try {
      return await prisma.player.findUnique({
        where: { telegramId: BigInt(telegramId) },
      });
    } catch (error) {
      logger.error('Error getting player:', error);
      throw error;
    }
  }

  async getAllPlayers(): Promise<Player[]> {
    try {
      return await prisma.player.findMany({
        orderBy: { createdAt: 'desc' },
      });
    } catch (error) {
      logger.error('Error getting all players:', error);
      throw error;
    }
  }

  async updatePlayerRating(playerId: number, delta: number, scheme: string): Promise<void> {
    try {
      const player = await prisma.player.findUnique({
        where: { id: playerId }
      });
      
      if (!player) throw new Error('Player not found');

      // Captain rating removed

      await prisma.rating.create({
        data: {
          matchId: Math.floor(Date.now() / 1000), // Используем timestamp в секундах
          playerId: player.id,
          delta,
        },
      });

      logger.info(`Player ${player.username} (ID: ${playerId}) rating updated: ${delta} (${scheme})`);
    } catch (error) {
      logger.error('Error updating player rating:', error);
      throw error;
    }
  }

  async getPlayerByUsername(username: string): Promise<Player | null> {
    try {
      return await prisma.player.findFirst({
        where: { username },
      });
    } catch (error) {
      logger.error('Error getting player by username:', error);
      throw error;
    }
  }

  async linkPlayerToTelegram(playerId: number, telegramId: number, firstName?: string): Promise<void> {
    try {
      const updateData: any = {
        telegramId: BigInt(telegramId),
      };
      
      // Обновляем имя, если передано (может отличаться от того, что ввел админ)
      if (firstName) {
        updateData.firstName = firstName;
      }

      await prisma.player.update({
        where: { id: playerId },
        data: updateData,
      });
      
      logger.info(`Player ${playerId} linked to Telegram ID ${telegramId}`);
    } catch (error) {
      logger.error('Error linking player to telegram:', error);
      throw error;
    }
  }

  async setAdminStatus(telegramId: number, isAdmin: boolean): Promise<void> {
    try {
      await prisma.player.update({
        where: { telegramId: BigInt(telegramId) },
        data: { isAdmin },
      });
      logger.info(`Admin status changed for ${telegramId}: ${isAdmin}`);
    } catch (error) {
      logger.error('Error setting admin status:', error);
      throw error;
    }
  }
}