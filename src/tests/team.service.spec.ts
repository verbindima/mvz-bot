import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { container } from 'tsyringe';
import { TeamService } from '../services/team.service';
import { PairService } from '../services/pair.service';
import { Player } from '@prisma/client';

// Mock PairService
vi.mock('../services/pair.service');

describe('TeamService', () => {
  let teamService: TeamService;
  let mockPlayers: Player[];

  beforeEach(() => {
    container.clearInstances();
    teamService = new TeamService();
    
    // Mock PairService
    const mockPairService = {
      loadMatrixFor: vi.fn().mockResolvedValue({})
    };
    container.registerInstance(PairService, mockPairService as any);
    
    mockPlayers = Array.from({ length: 16 }, (_, i) => ({
      id: i + 1,
      telegramId: BigInt(1000 + i),
      username: `user${i + 1}`,
      firstName: `Player${i + 1}`,
      tsMu: 20 + Math.random() * 10,
      tsSigma: 8.333,
      isAdmin: false,
      lastPlayedAt: new Date(),
      firstPlayedAt: new Date(), 
      gamesPlayed: 0,
      mvpCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
  });

  it('should generate balanced teams with 8 players each', async () => {
    const result = await teamService.generateBalancedTeams(mockPlayers);

    expect(result.teamA.players).toHaveLength(8);
    expect(result.teamB.players).toHaveLength(8);
    expect(result.teamA.players.length + result.teamB.players.length).toBe(16);
  });

  it('should not have duplicate players across teams', async () => {
    const result = await teamService.generateBalancedTeams(mockPlayers);
    
    const teamAIds = result.teamA.players.map(p => p.id);
    const teamBIds = result.teamB.players.map(p => p.id);
    
    const intersection = teamAIds.filter(id => teamBIds.includes(id));
    expect(intersection).toHaveLength(0);
  });

  it('should include all original players', async () => {
    const result = await teamService.generateBalancedTeams(mockPlayers);
    
    const allTeamPlayers = [...result.teamA.players, ...result.teamB.players];
    const allTeamIds = allTeamPlayers.map(p => p.id).sort();
    const originalIds = mockPlayers.map(p => p.id).sort();
    
    expect(allTeamIds).toEqual(originalIds);
  });

  it('should calculate team totals correctly using TrueSkill', async () => {
    const result = await teamService.generateBalancedTeams(mockPlayers);
    
    const expectedTeamATotal = result.teamA.players.reduce((sum, p) => sum + p.tsMu, 0);
    const expectedTeamBTotal = result.teamB.players.reduce((sum, p) => sum + p.tsMu, 0);
    
    expect(result.teamA.totalRating).toBeCloseTo(expectedTeamATotal, 2);
    expect(result.teamB.totalRating).toBeCloseTo(expectedTeamBTotal, 2);
    
    expect(result.teamA.averageRating).toBeCloseTo(expectedTeamATotal / 8, 2);
    expect(result.teamB.averageRating).toBeCloseTo(expectedTeamBTotal / 8, 2);
  });

  it('should have reasonable balance between teams', async () => {
    const runs = 10;
    let totalDifference = 0;

    for (let i = 0; i < runs; i++) {
      const result = await teamService.generateBalancedTeams(mockPlayers);
      totalDifference += result.difference;
    }

    const averageDifference = totalDifference / runs;
    expect(averageDifference).toBeLessThan(2.5);
  });

  it('should throw error for incorrect number of players', async () => {
    await expect(async () => {
      await teamService.generateBalancedTeams(mockPlayers.slice(0, 10));
    }).rejects.toThrow('Exactly 16 players are required');
  });

  it('should format team message correctly', async () => {
    const result = await teamService.generateBalancedTeams(mockPlayers);
    const message = teamService.formatTeamsMessage(result);

    expect(message).toContain('🔴 команда');
    expect(message).toContain('🔵 команда');
    expect(message).toContain('Разница в силе');
    expect(message).toContain('Шансы на победу');
    
    result.teamA.players.forEach(player => {
      expect(message).toContain(player.firstName);
    });
    
    result.teamB.players.forEach(player => {
      expect(message).toContain(player.firstName);
    });
  });

  it('should format message with custom team names', async () => {
    const result = await teamService.generateBalancedTeams(mockPlayers);
    const customNames = { teamA: 'Sharks', teamB: 'Eagles' };
    const message = teamService.formatTeamsMessage(result, customNames);

    expect(message).toContain('Sharks команда');
    expect(message).toContain('Eagles команда');
  });

  it('should handle players with equal skills', async () => {
    const equalSkillPlayers = mockPlayers.map(p => ({ ...p, tsMu: 25.0 }));
    const result = await teamService.generateBalancedTeams(equalSkillPlayers);

    expect(result.difference).toBeLessThan(0.1);
    expect(Math.abs(result.winProbability - 50)).toBeLessThan(1);
  });
});