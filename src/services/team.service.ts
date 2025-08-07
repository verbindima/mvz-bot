import { injectable } from 'tsyringe';
import { Player } from '@prisma/client';
import { CONFIG } from '@/config';
import { logger } from '@/utils/logger';
import { escapeHtml } from '@/utils/html';

export interface Team {
  players: Player[];
  totalRating: number;
  averageRating: number;
}

export interface TeamBalance {
  teamA: Team;
  teamB: Team;
  difference: number;
  winProbability: number;
}

@injectable()
export class TeamService {
  public getPlayerWeight(player: Player): number {
    switch (CONFIG.SCHEME) {
      case 'self':
        return player.skillSelf;
      case 'ts':
        return player.tsMu;
      default:
        return player.skillSelf;
    }
  }

  private calculateTotalWeight(players: Player[]): number {
    return players.reduce((sum, player) => sum + this.getPlayerWeight(player), 0);
  }

  public calculateWinProbability(teamAWeight: number, teamBWeight: number): number {
    if (CONFIG.SCHEME === 'ts') {
      const sigma = 8.333;
      const diff = teamBWeight - teamAWeight;
      return 1 / (1 + Math.pow(10, diff / (Math.sqrt(2) * sigma))) * 100;
    } else {
      const diff = teamBWeight - teamAWeight;
      return Math.max(0, Math.min(100, 50 + (diff * 10)));
    }
  }

  private snakeDraft(players: Player[]): { teamA: Player[]; teamB: Player[] } {
    const sorted = [...players].sort((a, b) => this.getPlayerWeight(b) - this.getPlayerWeight(a));
    const teamA: Player[] = [];
    const teamB: Player[] = [];

    sorted.forEach((player, index) => {
      if (index % 4 === 0 || index % 4 === 3) {
        teamA.push(player);
      } else {
        teamB.push(player);
      }
    });

    return { teamA, teamB };
  }

  private stochasticImprovement(teamA: Player[], teamB: Player[]): void {
    const maxIterations = 500;
    let bestDiff = Math.abs(this.calculateTotalWeight(teamA) - this.calculateTotalWeight(teamB));

    for (let i = 0; i < maxIterations && bestDiff > 1; i++) {
      const aIndex = Math.floor(Math.random() * teamA.length);
      const bIndex = Math.floor(Math.random() * teamB.length);

      [teamA[aIndex], teamB[bIndex]] = [teamB[bIndex], teamA[aIndex]];

      const newDiff = Math.abs(this.calculateTotalWeight(teamA) - this.calculateTotalWeight(teamB));

      if (newDiff < bestDiff) {
        bestDiff = newDiff;
      } else {
        [teamA[aIndex], teamB[bIndex]] = [teamB[bIndex], teamA[aIndex]];
      }
    }
  }

  public generateBalancedTeams(players: Player[]): TeamBalance {
    if (players.length !== 16) {
      throw new Error('Exactly 16 players are required for team generation');
    }

    logger.info(`Generating teams using ${CONFIG.SCHEME} rating scheme`);

    const { teamA: initialTeamA, teamB: initialTeamB } = this.snakeDraft(players);

    this.stochasticImprovement(initialTeamA, initialTeamB);

    const teamAWeight = this.calculateTotalWeight(initialTeamA);
    const teamBWeight = this.calculateTotalWeight(initialTeamB);

    const teamA: Team = {
      players: initialTeamA,
      totalRating: teamAWeight,
      averageRating: teamAWeight / initialTeamA.length,
    };

    const teamB: Team = {
      players: initialTeamB,
      totalRating: teamBWeight,
      averageRating: teamBWeight / initialTeamB.length,
    };

    const difference = Math.abs(teamAWeight - teamBWeight);
    const winProbability = this.calculateWinProbability(teamAWeight, teamBWeight);

    logger.info(`Teams generated. Difference: ${difference.toFixed(2)}, Win probability: ${winProbability.toFixed(1)}%`);

    return {
      teamA,
      teamB,
      difference,
      winProbability,
    };
  }

  public formatTeamsMessage(balance: TeamBalance): string {
    const formatTeam = (team: Team, name: string): string => {
      const playersList = team.players
        .map((p, i) => {
          const escapedName = escapeHtml(p.firstName);
          const usernameStr = p.username ? ` (@${p.username})` : '';
          return `${i + 1}. ${escapedName}${usernameStr} — ${this.getPlayerWeight(p).toFixed(1)}`;
        })
        .join('\n');

      return `<b>${name} команда</b> (${team.totalRating.toFixed(1)}):\n${playersList}`;
    };

    const teamAStr = formatTeam(balance.teamA, '🔴');
    const teamBStr = formatTeam(balance.teamB, '🔵');

    return `${teamAStr}\n\n${teamBStr}\n\n📊 Разница: ${balance.difference.toFixed(2)}\n🎯 Вероятность победы красных: ${balance.winProbability.toFixed(1)}%`;
  }
}