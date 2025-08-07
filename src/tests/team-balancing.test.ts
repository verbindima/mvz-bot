import 'reflect-metadata';
import { describe, it, expect, beforeAll } from 'vitest';
import { container } from 'tsyringe';
import { TeamService } from '../services/team.service';
import { Player } from '@prisma/client';

describe('Team Balancing Algorithm', () => {
  let teamService: TeamService;
  
  beforeAll(() => {
    teamService = container.resolve(TeamService);
  });

  const createMockPlayers = (count: number = 16): Player[] => {
    const players: Player[] = [];
    
    for (let i = 0; i < count; i++) {
      players.push({
        id: i + 1,
        telegramId: BigInt(i + 1),
        username: `player${i + 1}`,
        firstName: `Player ${i + 1}`,
        skillSelf: Math.floor(Math.random() * 5) + 1, // 1-5
        skillCaptain: Math.floor(Math.random() * 10), // 0-10
        tsMu: 20 + Math.random() * 10, // 20-30 (realistic TrueSkill range)
        tsSigma: 6 + Math.random() * 4, // 6-10
        isAdmin: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Player);
    }
    
    return players;
  };

  it('should balance teams with self rating scheme', () => {
    process.env.SCHEME = 'self';
    const players = createMockPlayers(16);
    
    const balance = teamService.generateBalancedTeams(players);
    
    expect(balance.teamA.players).toHaveLength(8);
    expect(balance.teamB.players).toHaveLength(8);
    expect(balance.difference).toBeLessThan(1.5); // Requirement from spec
    
    console.log('Self Scheme Balance:');
    console.log(`Team A: ${balance.teamA.totalRating.toFixed(2)}`);
    console.log(`Team B: ${balance.teamB.totalRating.toFixed(2)}`);
    console.log(`Difference: ${balance.difference.toFixed(2)}`);
    console.log(`Win Probability: ${balance.winProbability.toFixed(1)}%`);
  });

  it('should balance teams with captain rating scheme', () => {
    process.env.SCHEME = 'captain';
    const players = createMockPlayers(16);
    
    const balance = teamService.generateBalancedTeams(players);
    
    expect(balance.teamA.players).toHaveLength(8);
    expect(balance.teamB.players).toHaveLength(8);
    expect(balance.difference).toBeLessThan(1.5);
    
    console.log('Captain Scheme Balance:');
    console.log(`Team A: ${balance.teamA.totalRating.toFixed(2)}`);
    console.log(`Team B: ${balance.teamB.totalRating.toFixed(2)}`);
    console.log(`Difference: ${balance.difference.toFixed(2)}`);
    console.log(`Win Probability: ${balance.winProbability.toFixed(1)}%`);
  });

  it('should balance teams with TrueSkill rating scheme', () => {
    process.env.SCHEME = 'ts';
    const players = createMockPlayers(16);
    
    const balance = teamService.generateBalancedTeams(players);
    
    expect(balance.teamA.players).toHaveLength(8);
    expect(balance.teamB.players).toHaveLength(8);
    expect(balance.difference).toBeLessThan(1.5);
    
    console.log('TrueSkill Scheme Balance:');
    console.log(`Team A: ${balance.teamA.totalRating.toFixed(2)}`);
    console.log(`Team B: ${balance.teamB.totalRating.toFixed(2)}`);
    console.log(`Difference: ${balance.difference.toFixed(2)}`);
    console.log(`Win Probability: ${balance.winProbability.toFixed(1)}%`);
  });

  it('should test with extreme skill differences', () => {
    process.env.SCHEME = 'self';
    const players: Player[] = [];
    
    // Create 8 high-skill players (5) and 8 low-skill players (1)
    for (let i = 0; i < 8; i++) {
      players.push({
        id: i + 1,
        telegramId: BigInt(i + 1),
        username: `highskill${i + 1}`,
        firstName: `High Skill ${i + 1}`,
        skillSelf: 5,
        skillCaptain: 10,
        tsMu: 30,
        tsSigma: 6,
        isAdmin: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Player);
    }
    
    for (let i = 0; i < 8; i++) {
      players.push({
        id: i + 9,
        telegramId: BigInt(i + 9),
        username: `lowskill${i + 1}`,
        firstName: `Low Skill ${i + 1}`,
        skillSelf: 1,
        skillCaptain: 0,
        tsMu: 15,
        tsSigma: 8,
        isAdmin: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Player);
    }
    
    const balance = teamService.generateBalancedTeams(players);
    
    expect(balance.difference).toBeLessThan(1.5);
    
    console.log('Extreme Differences Test:');
    console.log(`Team A: ${balance.teamA.totalRating.toFixed(2)} (avg: ${balance.teamA.averageRating.toFixed(2)})`);
    console.log(`Team B: ${balance.teamB.totalRating.toFixed(2)} (avg: ${balance.teamB.averageRating.toFixed(2)})`);
    console.log(`Difference: ${balance.difference.toFixed(2)}`);
    
    // Each team should have mix of high and low skill players
    const teamASkills = balance.teamA.players.map(p => p.skillSelf);
    const teamBSkills = balance.teamB.players.map(p => p.skillSelf);
    
    console.log(`Team A skills: [${teamASkills.join(', ')}]`);
    console.log(`Team B skills: [${teamBSkills.join(', ')}]`);
  });

  it('should demonstrate Snake Draft algorithm', () => {
    const players = createMockPlayers(16);
    // Sort by skill for demonstration
    players.sort((a, b) => b.skillSelf - a.skillSelf);
    
    console.log('Snake Draft Demonstration:');
    console.log('Original sorted order (by skill):');
    players.forEach((p, i) => {
      console.log(`${i + 1}. ${p.firstName} (skill: ${p.skillSelf})`);
    });
    
    const balance = teamService.generateBalancedTeams(players);
    
    console.log('\\nTeam A:');
    balance.teamA.players.forEach((p, i) => {
      console.log(`${i + 1}. ${p.firstName} (skill: ${p.skillSelf})`);
    });
    
    console.log('\\nTeam B:');
    balance.teamB.players.forEach((p, i) => {
      console.log(`${i + 1}. ${p.firstName} (skill: ${p.skillSelf})`);
    });
  });
});