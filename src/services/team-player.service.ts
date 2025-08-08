import { injectable } from 'tsyringe';
import { prisma } from '../utils/database';
import { Player } from '@prisma/client';

export interface TeamComposition {
  teamA: Player[];
  teamB: Player[];
}

@injectable()
export class TeamPlayerService {
  
  async saveTeamComposition(gameSessionId: number, teamAPlayers: Player[], teamBPlayers: Player[]): Promise<void> {
    // Удаляем старые записи команд для этой сессии
    await prisma.teamPlayer.deleteMany({
      where: { gameSessionId },
    });

    // Создаем записи для команды A
    const teamARecords = teamAPlayers.map(player => ({
      gameSessionId,
      playerId: player.id,
      team: 'A',
    }));

    // Создаем записи для команды B
    const teamBRecords = teamBPlayers.map(player => ({
      gameSessionId,
      playerId: player.id,
      team: 'B',
    }));

    // Вставляем все записи
    await prisma.teamPlayer.createMany({
      data: [...teamARecords, ...teamBRecords],
    });
  }

  async getTeamComposition(gameSessionId: number): Promise<TeamComposition | null> {
    const teamPlayers = await prisma.teamPlayer.findMany({
      where: { gameSessionId },
      include: { player: true },
      orderBy: { createdAt: 'asc' },
    });

    if (teamPlayers.length === 0) {
      return null;
    }

    const teamA = teamPlayers
      .filter(tp => tp.team === 'A')
      .map(tp => tp.player);

    const teamB = teamPlayers
      .filter(tp => tp.team === 'B')
      .map(tp => tp.player);

    return { teamA, teamB };
  }

  async getPlayerTeam(gameSessionId: number, playerId: number): Promise<'A' | 'B' | null> {
    const teamPlayer = await prisma.teamPlayer.findUnique({
      where: {
        gameSessionId_playerId: {
          gameSessionId,
          playerId,
        },
      },
    });

    return teamPlayer ? (teamPlayer.team as 'A' | 'B') : null;
  }

  async movePlayerToTeam(gameSessionId: number, playerId: number, newTeam: 'A' | 'B'): Promise<void> {
    await prisma.teamPlayer.update({
      where: {
        gameSessionId_playerId: {
          gameSessionId,
          playerId,
        },
      },
      data: { team: newTeam },
    });
  }

  async clearTeamComposition(gameSessionId: number): Promise<void> {
    await prisma.teamPlayer.deleteMany({
      where: { gameSessionId },
    });
  }

  async getTeamIds(gameSessionId: number): Promise<{ teamAIds: number[]; teamBIds: number[] }> {
    const teamPlayers = await prisma.teamPlayer.findMany({
      where: { gameSessionId },
      select: { playerId: true, team: true },
    });

    const teamAIds = teamPlayers
      .filter(tp => tp.team === 'A')
      .map(tp => tp.playerId);

    const teamBIds = teamPlayers
      .filter(tp => tp.team === 'B')
      .map(tp => tp.playerId);

    return { teamAIds, teamBIds };
  }
}