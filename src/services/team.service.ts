import { injectable, container } from 'tsyringe';
import { Player } from '@prisma/client';
import { CONFIG } from '../config';
import { logger } from '../utils/logger';
import { escapeHtml } from '../utils/html';
import { PairService, PairMatrix } from './pair.service';

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
  effectiveDifference?: number;
  synergyEnabled?: boolean;
}

@injectable()
export class TeamService {
  public getPlayerWeight(player: Player): number {
    // Теперь используем только TrueSkill рейтинг
    return player.tsMu;
  }

  private calculateTotalWeight(players: Player[]): number {
    return players.reduce((sum, player) => sum + this.getPlayerWeight(player), 0);
  }

  public calculateWinProbability(teamAWeight: number, teamBWeight: number): number {
    // Используем TrueSkill формулу
    const sigma = 8.333;
    const diff = teamBWeight - teamAWeight;
    return 1 / (1 + Math.pow(10, diff / (Math.sqrt(2) * sigma))) * 100;
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

  private confidence(sigma: number): number {
    return Math.max(0, 1 - sigma);
  }

  private calculateSynergyWithin(team: Player[], pairMatrix: PairMatrix): number {
    let synergySum = 0;
    
    for (let i = 0; i < team.length; i++) {
      for (let j = i + 1; j < team.length; j++) {
        const pairKey = this.generatePairKey(team[i].id, team[j].id);
        const pairData = pairMatrix[pairKey];
        
        if (pairData && pairData.synergyMu !== undefined) {
          const confidenceValue = this.confidence(pairData.synergySigma);
          synergySum += pairData.synergyMu * confidenceValue;
        }
      }
    }
    
    return synergySum;
  }

  private calculateCounterBetween(teamA: Player[], teamB: Player[], pairMatrix: PairMatrix): number {
    let counterSum = 0;
    
    for (const playerA of teamA) {
      for (const playerB of teamB) {
        const pairKey = this.generatePairKey(playerA.id, playerB.id);
        const pairData = pairMatrix[pairKey];
        
        if (pairData && pairData.counterMu !== undefined) {
          const confidenceValue = this.confidence(pairData.counterSigma);
          // Apply counter effect based on which player has advantage
          const advantage = playerA.id < playerB.id ? pairData.counterMu : -pairData.counterMu;
          counterSum += advantage * confidenceValue;
        }
      }
    }
    
    return counterSum;
  }

  private generatePairKey(playerAId: number, playerBId: number): string {
    const [minId, maxId] = [Math.min(playerAId, playerBId), Math.max(playerAId, playerBId)];
    return `${minId}-${maxId}`;
  }

  private calculateEffectiveStrength(
    team: Player[],
    opposingTeam: Player[],
    pairMatrix: PairMatrix
  ): number {
    if (!CONFIG.SYNERGY_ENABLED || Object.keys(pairMatrix).length === 0) {
      return this.calculateTotalWeight(team);
    }

    const baseStrength = this.calculateTotalWeight(team);
    const synSame = this.calculateSynergyWithin(team, pairMatrix);
    const synVs = this.calculateCounterBetween(team, opposingTeam, pairMatrix);

    return baseStrength + 
           CONFIG.SYNERGY_WEIGHT_SAME * Math.tanh(synSame) + 
           CONFIG.SYNERGY_WEIGHT_VS * Math.tanh(synVs);
  }

  private stochasticImprovement(teamA: Player[], teamB: Player[], pairMatrix: PairMatrix = {}): void {
    const maxIterations = 500;
    
    let bestObjective: number;
    if (CONFIG.SYNERGY_ENABLED && Object.keys(pairMatrix).length > 0) {
      // Use effective difference when synergy is enabled
      const effA = this.calculateEffectiveStrength(teamA, teamB, pairMatrix);
      const effB = this.calculateEffectiveStrength(teamB, teamA, pairMatrix);
      bestObjective = Math.abs(effA - effB);
    } else {
      // Use base difference when synergy is disabled
      bestObjective = Math.abs(this.calculateTotalWeight(teamA) - this.calculateTotalWeight(teamB));
    }

    for (let i = 0; i < maxIterations && bestObjective > 1; i++) {
      const aIndex = Math.floor(Math.random() * teamA.length);
      const bIndex = Math.floor(Math.random() * teamB.length);

      // Swap players
      [teamA[aIndex], teamB[bIndex]] = [teamB[bIndex], teamA[aIndex]];

      // Check base difference constraint
      const baseDiff = Math.abs(this.calculateTotalWeight(teamA) - this.calculateTotalWeight(teamB));
      if (baseDiff > CONFIG.MAX_BASE_DIFF) {
        // Revert swap if base difference is too large
        [teamA[aIndex], teamB[bIndex]] = [teamB[bIndex], teamA[aIndex]];
        continue;
      }

      // Calculate new objective
      let newObjective: number;
      if (CONFIG.SYNERGY_ENABLED && Object.keys(pairMatrix).length > 0) {
        const effA = this.calculateEffectiveStrength(teamA, teamB, pairMatrix);
        const effB = this.calculateEffectiveStrength(teamB, teamA, pairMatrix);
        newObjective = Math.abs(effA - effB);
      } else {
        newObjective = baseDiff;
      }

      if (newObjective < bestObjective) {
        bestObjective = newObjective;
      } else {
        // Revert swap if no improvement
        [teamA[aIndex], teamB[bIndex]] = [teamB[bIndex], teamA[aIndex]];
      }
    }
  }

  public async generateBalancedTeams(players: Player[]): Promise<TeamBalance> {
    if (players.length !== 16) {
      throw new Error('Exactly 16 players are required for team generation');
    }

    logger.info(`Generating teams using ${CONFIG.SCHEME} rating scheme with synergy ${CONFIG.SYNERGY_ENABLED ? 'enabled' : 'disabled'}`);

    let pairMatrix: PairMatrix = {};
    if (CONFIG.SYNERGY_ENABLED) {
      const pairService = container.resolve(PairService);
      pairMatrix = await pairService.loadMatrixFor(players.map(p => p.id));
    }

    const { teamA: initialTeamA, teamB: initialTeamB } = this.snakeDraft(players);

    this.stochasticImprovement(initialTeamA, initialTeamB, pairMatrix);

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
    
    // Calculate effective difference if synergy is enabled
    let effectiveDifference = difference;
    if (CONFIG.SYNERGY_ENABLED && Object.keys(pairMatrix).length > 0) {
      const effA = this.calculateEffectiveStrength(initialTeamA, initialTeamB, pairMatrix);
      const effB = this.calculateEffectiveStrength(initialTeamB, initialTeamA, pairMatrix);
      effectiveDifference = Math.abs(effA - effB);
    }

    const winProbability = this.calculateWinProbability(teamAWeight, teamBWeight);

    logger.info(`Teams generated. Base difference: ${difference.toFixed(2)}, Effective difference: ${effectiveDifference.toFixed(2)}, Win probability: ${winProbability.toFixed(1)}%`);

    return {
      teamA,
      teamB,
      difference,
      winProbability,
      effectiveDifference,
      synergyEnabled: CONFIG.SYNERGY_ENABLED
    };
  }

  public formatTeamsMessage(
    balance: TeamBalance,
    teamNames: { teamA: string; teamB: string } = { teamA: '🔴', teamB: '🔵' }
  ): string {
    const formatTeam = (team: Team, name: string): string => {
      const playersList = team.players
        .map((p, i) => {
          const escapedName = escapeHtml(p.firstName);
          const usernameStr = p.username ? ` (@${p.username})` : '';
          return `${i + 1}. ${escapedName}${usernameStr} — ${this.getPlayerWeight(p).toFixed(1)}`;
        })
        .join('\n');

      const escapedTeamName = escapeHtml(name);
      return `<b>${escapedTeamName} команда</b> (${team.totalRating.toFixed(1)}):\n${playersList}`;
    };

    const teamAStr = formatTeam(balance.teamA, teamNames.teamA);
    const teamBStr = formatTeam(balance.teamB, teamNames.teamB);

    // Определяем, какая команда сильнее
    const strongerTeamName =
      balance.teamA.totalRating > balance.teamB.totalRating ? teamNames.teamA : teamNames.teamB;
    const weakerTeamName =
      balance.teamA.totalRating > balance.teamB.totalRating ? teamNames.teamB : teamNames.teamA;
    const winProb =
      balance.teamA.totalRating > balance.teamB.totalRating
        ? balance.winProbability
        : 100 - balance.winProbability;

    const escapedStronger = escapeHtml(strongerTeamName);
    const escapedWeaker = escapeHtml(weakerTeamName);
    
    let differenceText = `📊 Разница в силе: ${balance.difference.toFixed(1)} μ`;
    if (balance.synergyEnabled && balance.effectiveDifference !== undefined) {
      differenceText += `\n🧪 С учетом химии: ${balance.effectiveDifference.toFixed(1)} μ`;
    }
    
    return (
      `${teamAStr}\n\n${teamBStr}\n\n` +
      `${differenceText}\n` +
      `🎯 Шансы на победу ${escapedStronger}: ${winProb.toFixed(0)}% vs ${escapedWeaker}: ${(100 - winProb).toFixed(0)}%`
    );
  }
}