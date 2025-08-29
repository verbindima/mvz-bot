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
  mvpCount: number;
  mvpRate: number;
  currentTSRating: string;
  ratingHistory: Array<{
    date: Date;
    tsMu: number;
    delta: number;
    opponent: string;
  }>;
  triStats?: {
    miniMatchesPlayed: number;
    miniMatchesWon: number;
    miniMatchesLost: number;
    miniMatchesDrawn: number;
    triGamesPlayed: number;
    recentTriMatches: Array<{
      date: Date;
      matchesInGame: number;
      wonMatches: number;
    }>;
  };
}

@injectable()
export class StatisticsService {

  async getPlayerStatistics(telegramId: number): Promise<PlayerStats | null> {
    try {
      const player = await prisma.player.findUnique({
        where: { telegramId: BigInt(telegramId) },
      });

      if (!player) {
        logger.info(`Player not found for telegramId: ${telegramId}`);
        return null;
      }

      logger.info(`Player found: ${player.firstName} (ID: ${player.id})`);

      // Получаем все игры игрока через TeamPlayer
      let teamPlayers = [];
      try {
        teamPlayers = await prisma.teamPlayer.findMany({
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
        logger.info(`Found ${teamPlayers.length} team player records`);
      } catch (error) {
        logger.error('Error fetching team players (table may not exist):', error);
        // Возвращаем базовую статистику если таблицы не существуют
        return {
          player,
          gamesPlayed: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          winRate: 0,
          mvpCount: 0,
          mvpRate: 0,
          currentTSRating: `${player.tsMu.toFixed(1)}±${player.tsSigma.toFixed(1)}`,
          ratingHistory: [],
        };
      }

      // Фильтруем только игры с результатами
      const completedGames = teamPlayers.filter(tp => tp.gameSession.matchResult);

      let wins = 0;
      let losses = 0;
      let draws = 0;

      const ratingHistory: PlayerStats['ratingHistory'] = [];

      for (const tp of completedGames) {
        const result = tp.gameSession.matchResult!;

        // Пропускаем TRI матчи из основной статистики
        if (result.winnerTeam === 'TRI' || (result.teamAScore === -1 && result.teamBScore === -1)) {
          continue;
        }

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

      // Исключаем TRI матчи из подсчета обычных игр
      const regularGames = completedGames.filter(tp => {
        const result = tp.gameSession.matchResult!;
        return result.winnerTeam !== 'TRI' && !(result.teamAScore === -1 && result.teamBScore === -1);
      });
      const gamesPlayed = regularGames.length;
      const winRate = gamesPlayed > 0 ? (wins / gamesPlayed) * 100 : 0;
      const mvpCount = player.mvpCount || 0;
      const mvpRate = gamesPlayed > 0 ? (mvpCount / gamesPlayed) * 100 : 0;

      // Собираем TRI статистику
      const triStats = await this.getTriStatistics(player.id);

      return {
        player,
        gamesPlayed,
        wins,
        losses,
        draws,
        winRate,
        mvpCount,
        mvpRate,
        currentTSRating: `${player.tsMu.toFixed(1)}±${player.tsSigma.toFixed(1)}`,
        ratingHistory: ratingHistory.slice(0, 10), // Последние 10 игр
        triStats,
      };

    } catch (error) {
      logger.error('Error getting player statistics:', error);
      throw error;
    }
  }

  private async getTriStatistics(playerId: number): Promise<PlayerStats['triStats']> {
    try {
      // Получаем все TRI сессии через TeamPlayer
      const triTeamPlayers = await prisma.teamPlayer.findMany({
        where: { playerId }
      });

      // Получаем все игровые сессии для этих TeamPlayer записей
      const sessionIds = triTeamPlayers.map(tp => tp.gameSessionId);
      const allSessions = await prisma.gameSession.findMany({
        where: {
          id: { in: sessionIds }
        },
        include: {
          matchResult: true
        }
      });

      // Фильтруем только TRI сессии с результатами
      const triSessions = allSessions.filter(s => 
        s.matchResult && (s.matchResult.winnerTeam === 'TRI' || (s.matchResult.teamAScore === -1 && s.matchResult.teamBScore === -1))
      );

      if (triSessions.length === 0) {
        return undefined;
      }

      let miniMatchesPlayed = 0;
      let miniMatchesWon = 0;
      let miniMatchesLost = 0;
      let miniMatchesDrawn = 0;
      const recentTriMatches: Array<{ date: Date; matchesInGame: number; wonMatches: number; }> = [];

      for (const session of triSessions) {
        // Находим команду игрока в этой сессии
        const playerInSession = triTeamPlayers.find(tp => tp.gameSessionId === session.id);
        if (!playerInSession) continue;

        const playerTeam = playerInSession.team;

        let matchesInThisGame = 0;
        let wonInThisGame = 0;

        // Получаем мини-матчи для этой сессии
        const miniMatches = await prisma.triMiniMatch.findMany({
          where: { sessionId: session.id },
          orderBy: { seq: 'asc' }
        });

        // Считаем мини-матчи для этого игрока
        for (const miniMatch of miniMatches) {
          // Проверяем участвовал ли игрок в этом мини-матче
          if (miniMatch.t1 === playerTeam || miniMatch.t2 === playerTeam) {
            matchesInThisGame++;
            miniMatchesPlayed++;

            if (miniMatch.winner === null) {
              miniMatchesDrawn++;
            } else if (miniMatch.winner === playerTeam) {
              miniMatchesWon++;
              wonInThisGame++;
            } else {
              miniMatchesLost++;
            }
          }
        }

        if (matchesInThisGame > 0 && session.matchResult) {
          recentTriMatches.push({
            date: session.matchResult.createdAt,
            matchesInGame: matchesInThisGame,
            wonMatches: wonInThisGame
          });
        }
      }

      return {
        miniMatchesPlayed,
        miniMatchesWon,
        miniMatchesLost,
        miniMatchesDrawn,
        triGamesPlayed: triSessions.length,
        recentTriMatches: recentTriMatches.slice(0, 5)
      };

    } catch (error) {
      logger.error('Error getting TRI statistics:', error);
      return undefined;
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

  async saveTriMiniMatch(
    sessionId: number,
    t1: string,
    t2: string,
    s1: number,
    s2: number,
    winner: string | null,
    seq: number
  ): Promise<void> {
    try {
      await prisma.triMiniMatch.create({
        data: {
          sessionId,
          seq,
          t1,
          t2,
          s1,
          s2,
          winner,
          ratingApplied: winner !== null
        }
      });

      logger.info(`TRI mini-match saved: ${t1} ${s1}-${s2} ${t2} (seq: ${seq}, winner: ${winner || 'draw'})`);
    } catch (error) {
      logger.error('Error saving TRI mini-match:', error);
      throw error;
    }
  }

  async getTriMiniMatches(sessionId: number): Promise<any[]> {
    try {
      const matches = await prisma.triMiniMatch.findMany({
        where: { sessionId },
        orderBy: { seq: 'asc' }
      });

      return matches;
    } catch (error) {
      logger.error('Error getting TRI mini-matches:', error);
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