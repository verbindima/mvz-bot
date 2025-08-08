import { injectable } from 'tsyringe';
import { Player } from '@prisma/client';
import { prisma } from '../utils/database';
import { logger } from '../utils/logger';

export interface PlayerStats {
  player: Player;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  currentTSRating: string;
  ratingHistory: Array<{
    date: Date;
    tsMu: number;
    delta: number;
    opponent: string;
  }>;
}

@injectable()
export class StatisticsService {

  async getPlayerStatistics(telegramId: number): Promise<PlayerStats | null> {
    try {
      const player = await prisma.player.findUnique({
        where: { telegramId: BigInt(telegramId) },
      });

      if (!player) return null;

      // Получаем все игры игрока через TeamPlayer
      const teamPlayers = await prisma.teamPlayer.findMany({
        where: { playerId: player.id },
        include: {
          gameSession: {
            include: {
              matchResult: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      // Фильтруем только игры с результатами
      const completedGames = teamPlayers.filter(tp => tp.gameSession.matchResult);

      let wins = 0;
      let losses = 0;
      let draws = 0;

      const ratingHistory: PlayerStats['ratingHistory'] = [];

      for (const tp of completedGames) {
        const result = tp.gameSession.matchResult!;
        
        if (result.teamAScore === result.teamBScore) {
          draws++;
        } else if (
          (tp.team === 'A' && result.teamAScore > result.teamBScore) ||
          (tp.team === 'B' && result.teamBScore > result.teamAScore)
        ) {
          wins++;
        } else {
          losses++;
        }

        // Добавляем в историю рейтинга (упрощенно)
        ratingHistory.push({
          date: result.createdAt,
          tsMu: player.tsMu, // Текущий рейтинг (в реальности нужно хранить исторические значения)
          delta: wins - losses, // Упрощенная дельта
          opponent: tp.team === 'A' ? 'Команда B' : 'Команда A',
        });
      }

      const gamesPlayed = completedGames.length;
      const winRate = gamesPlayed > 0 ? (wins / gamesPlayed) * 100 : 0;

      return {
        player,
        gamesPlayed,
        wins,
        losses,
        draws,
        winRate,
        currentTSRating: `${player.tsMu.toFixed(1)}±${player.tsSigma.toFixed(1)}`,
        ratingHistory: ratingHistory.slice(0, 10), // Последние 10 игр
      };

    } catch (error) {
      logger.error('Error getting player statistics:', error);
      throw error;
    }
  }

  async getTopPlayers(limit: number = 10): Promise<Array<{
    player: Player;
    winRate: number;
    gamesPlayed: number;
    tsRating: number;
  }>> {
    try {
      // Получаем всех игроков с их статистикой
      const players = await prisma.player.findMany({
        include: {
          teamPlayers: {
            include: {
              gameSession: {
                include: {
                  matchResult: true,
                },
              },
            },
          },
        },
      });

      const playersWithStats = players
        .map(player => {
          const completedGames = player.teamPlayers.filter(tp => tp.gameSession.matchResult);
          
          let wins = 0;
          for (const tp of completedGames) {
            const result = tp.gameSession.matchResult!;
            if (
              (tp.team === 'A' && result.teamAScore > result.teamBScore) ||
              (tp.team === 'B' && result.teamBScore > result.teamAScore)
            ) {
              wins++;
            }
          }

          const gamesPlayed = completedGames.length;
          const winRate = gamesPlayed > 0 ? (wins / gamesPlayed) * 100 : 0;

          return {
            player,
            winRate,
            gamesPlayed,
            tsRating: player.tsMu,
          };
        })
        .filter(p => p.gamesPlayed >= 3) // Минимум 3 игры для рейтинга
        .sort((a, b) => b.tsRating - a.tsRating) // Сортируем по TS рейтингу
        .slice(0, limit);

      return playersWithStats;

    } catch (error) {
      logger.error('Error getting top players:', error);
      throw error;
    }
  }

  async saveMatchResult(
    gameSessionId: number,
    teamAScore: number,
    teamBScore: number
  ): Promise<void> {
    try {
      const winnerTeam = teamAScore > teamBScore ? 'A' : teamBScore > teamAScore ? 'B' : 'DRAW';
      
      await prisma.matchResult.create({
        data: {
          gameSessionId,
          teamAScore,
          teamBScore,
          winnerTeam,
        },
      });

      logger.info(`Match result saved: ${teamAScore}-${teamBScore}, winner: ${winnerTeam}`);
    } catch (error) {
      logger.error('Error saving match result:', error);
      throw error;
    }
  }
}