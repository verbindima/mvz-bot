import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import { TeamService } from '../services/team.service';
import { Player } from '@prisma/client';

describe('TeamService', () => {
  let teamService: TeamService;
  let mockPlayers: Player[];

  beforeEach(() => {
    teamService = new TeamService();
    
    mockPlayers = Array.from({ length: 16 }, (_, i) => ({
      id: i + 1,
      telegramId: BigInt(1000 + i),
      username: `user${i + 1}`,
      firstName: `Player${i + 1}`,
      skillCaptain: Math.random() * 10,
      tsMu: 20 + Math.random() * 10,
      tsSigma: 8.333,
      isAdmin: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
  });

  it('should generate balanced teams with 8 players each', () => {
    const result = teamService.generateBalancedTeams(mockPlayers);

    expect(result.teamA.players).toHaveLength(8);
    expect(result.teamB.players).toHaveLength(8);
    expect(result.teamA.players.length + result.teamB.players.length).toBe(16);
  });

  it('should not have duplicate players across teams', () => {
    const result = teamService.generateBalancedTeams(mockPlayers);
    
    const teamAIds = result.teamA.players.map(p => p.id);
    const teamBIds = result.teamB.players.map(p => p.id);
    
    const intersection = teamAIds.filter(id => teamBIds.includes(id));
    expect(intersection).toHaveLength(0);
  });

  it('should include all original players', () => {
    const result = teamService.generateBalancedTeams(mockPlayers);
    
    const allTeamPlayers = [...result.teamA.players, ...result.teamB.players];
    const allTeamIds = allTeamPlayers.map(p => p.id).sort();
    const originalIds = mockPlayers.map(p => p.id).sort();
    
    expect(allTeamIds).toEqual(originalIds);
  });

  it('should calculate team totals correctly using TrueSkill', () => {
    const result = teamService.generateBalancedTeams(mockPlayers);
    
    const expectedTeamATotal = result.teamA.players.reduce((sum, p) => sum + p.tsMu, 0);
    const expectedTeamBTotal = result.teamB.players.reduce((sum, p) => sum + p.tsMu, 0);
    
    expect(result.teamA.totalRating).toBe(expectedTeamATotal);
    expect(result.teamB.totalRating).toBe(expectedTeamBTotal);
    expect(result.teamA.averageRating).toBe(expectedTeamATotal / 8);
    expect(result.teamB.averageRating).toBe(expectedTeamBTotal / 8);
  });

  it('should have reasonable balance between teams', () => {
    const results: number[] = [];
    
    for (let i = 0; i < 10; i++) {
      const result = teamService.generateBalancedTeams(mockPlayers);
      results.push(result.difference);
    }
    
    const averageDifference = results.reduce((sum, diff) => sum + diff, 0) / results.length;
    expect(averageDifference).toBeLessThan(2.5);
  });

  it('should throw error for incorrect number of players', () => {
    const wrongNumberOfPlayers = mockPlayers.slice(0, 10);
    
    expect(() => {
      teamService.generateBalancedTeams(wrongNumberOfPlayers);
    }).toThrowError('Exactly 16 players are required for team generation');
  });

  it('should format team message correctly', () => {
    const result = teamService.generateBalancedTeams(mockPlayers);
    const message = teamService.formatTeamsMessage(result);
    
    expect(message).toContain('🔴');
    expect(message).toContain('🔵');
    expect(message).toContain('Разница:');
    expect(message).toContain('Вероятность победы красных:');
    expect(message).toContain('%');
    
    result.teamA.players.forEach(player => {
      expect(message).toContain(player.firstName);
    });
    
    result.teamB.players.forEach(player => {
      expect(message).toContain(player.firstName);
    });
  });

  it('should handle players with equal skills', () => {
    const equalSkillPlayers = mockPlayers.map(p => ({
      ...p,
      skillCaptain: 5.0,
      tsMu: 25.0,
    }));
    
    const result = teamService.generateBalancedTeams(equalSkillPlayers);
    
    expect(result.difference).toBeLessThanOrEqual(1);
    expect(result.winProbability).toBeCloseTo(50, 0);
  });
});