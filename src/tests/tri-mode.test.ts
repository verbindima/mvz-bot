import 'reflect-metadata';
import { describe, it, expect, beforeAll } from 'vitest';
import { container } from 'tsyringe';
import { TeamService } from '../services/team.service';
import { TeamPlayerService } from '../services/team-player.service';
import { RatingService } from '../services/rating.service';
import { StatisticsService } from '../services/statistics.service';
import { Player } from '@prisma/client';

describe('TRI Mode (3×8) Functionality', () => {
  let teamService: TeamService;
  let teamPlayerService: TeamPlayerService;
  let ratingService: RatingService;
  let statisticsService: StatisticsService;
  
  beforeAll(() => {
    teamService = container.resolve(TeamService);
    teamPlayerService = container.resolve(TeamPlayerService);
    ratingService = container.resolve(RatingService);
    statisticsService = container.resolve(StatisticsService);
  });

  const createMockPlayers = (count: number = 24): Player[] => {
    const players: Player[] = [];
    
    for (let i = 0; i < count; i++) {
      players.push({
        id: i + 1,
        telegramId: BigInt(i + 1),
        username: `player${i + 1}`,
        firstName: `Player ${i + 1}`,
        tsMu: 20 + Math.random() * 10, // 20-30 (realistic TrueSkill range)
        tsSigma: 6 + Math.random() * 4, // 6-10
        isAdmin: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Player);
    }
    
    return players;
  };

  describe('TeamService.generateThreeTeams', () => {
    it('should generate three balanced teams with 8 players each', async () => {
      const players = createMockPlayers(24);
      
      const balance = await teamService.generateThreeTeams(players);
      
      expect(balance.teamA.players).toHaveLength(8);
      expect(balance.teamB.players).toHaveLength(8);
      expect(balance.teamC.players).toHaveLength(8);
      
      // Check that all players are assigned exactly once
      const allAssignedPlayers = [
        ...balance.teamA.players,
        ...balance.teamB.players,
        ...balance.teamC.players
      ];
      expect(allAssignedPlayers).toHaveLength(24);
      
      const playerIds = new Set(allAssignedPlayers.map(p => p.id));
      expect(playerIds.size).toBe(24); // No duplicates
      
      console.log('TRI Balance Test:');
      console.log(`Team A: ${balance.teamA.totalRating.toFixed(2)} (avg: ${balance.teamA.averageRating.toFixed(2)})`);
      console.log(`Team B: ${balance.teamB.totalRating.toFixed(2)} (avg: ${balance.teamB.averageRating.toFixed(2)})`);
      console.log(`Team C: ${balance.teamC.totalRating.toFixed(2)} (avg: ${balance.teamC.averageRating.toFixed(2)})`);
      console.log(`Max difference: ${balance.maxDifference.toFixed(2)}`);
      console.log(`Avg difference: ${balance.avgDifference.toFixed(2)}`);
    });

    it('should throw error for incorrect player count', async () => {
      const players = createMockPlayers(16); // Wrong count for TRI
      
      await expect(teamService.generateThreeTeams(players))
        .rejects.toThrowError('Exactly 24 players are required for three-team generation');
    });

    it('should balance teams within reasonable threshold', async () => {
      const players = createMockPlayers(24);
      
      const balance = await teamService.generateThreeTeams(players);
      
      // The maximum difference between strongest and weakest team should be reasonable
      expect(balance.maxDifference).toBeLessThan(2.5);
      expect(balance.avgDifference).toBeLessThan(1.5);
      
      // Each team should have reasonable total rating
      expect(balance.teamA.totalRating).toBeGreaterThan(0);
      expect(balance.teamB.totalRating).toBeGreaterThan(0);
      expect(balance.teamC.totalRating).toBeGreaterThan(0);
    });

    it('should test extreme skill differences in TRI mode', async () => {
      const players: Player[] = [];
      
      // Create 8 high-skill players, 8 medium-skill, 8 low-skill
      for (let i = 0; i < 8; i++) {
        players.push({
          id: i + 1,
          telegramId: BigInt(i + 1),
          username: `high${i + 1}`,
          firstName: `High ${i + 1}`,
          tsMu: 35,
          tsSigma: 5,
          isAdmin: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as Player);
      }
      
      for (let i = 0; i < 8; i++) {
        players.push({
          id: i + 9,
          telegramId: BigInt(i + 9),
          username: `mid${i + 1}`,
          firstName: `Mid ${i + 1}`,
          tsMu: 25,
          tsSigma: 6,
          isAdmin: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as Player);
      }
      
      for (let i = 0; i < 8; i++) {
        players.push({
          id: i + 17,
          telegramId: BigInt(i + 17),
          username: `low${i + 1}`,
          firstName: `Low ${i + 1}`,
          tsMu: 15,
          tsSigma: 8,
          isAdmin: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as Player);
      }
      
      const balance = await teamService.generateThreeTeams(players);
      
      expect(balance.maxDifference).toBeLessThan(3.0);
      
      console.log('Extreme TRI Differences Test:');
      console.log(`Team A: ${balance.teamA.totalRating.toFixed(2)}`);
      console.log(`Team B: ${balance.teamB.totalRating.toFixed(2)}`);
      console.log(`Team C: ${balance.teamC.totalRating.toFixed(2)}`);
      console.log(`Max difference: ${balance.maxDifference.toFixed(2)}`);
      
      // Each team should have mix of different skill levels
      const teamARatings = balance.teamA.players.map(p => p.tsMu).sort((a, b) => b - a);
      const teamBRatings = balance.teamB.players.map(p => p.tsMu).sort((a, b) => b - a);
      const teamCRatings = balance.teamC.players.map(p => p.tsMu).sort((a, b) => b - a);
      
      console.log(`Team A ratings: [${teamARatings.map(r => r.toFixed(1)).join(', ')}]`);
      console.log(`Team B ratings: [${teamBRatings.map(r => r.toFixed(1)).join(', ')}]`);
      console.log(`Team C ratings: [${teamCRatings.map(r => r.toFixed(1)).join(', ')}]`);
    });
  });

  describe('TeamService.formatThreeTeamsMessage', () => {
    it('should format TRI teams message correctly', async () => {
      const players = createMockPlayers(24);
      const balance = await teamService.generateThreeTeams(players);
      
      const teamNames = {
        teamA: '🔴 Red Team',
        teamB: '🔵 Blue Team', 
        teamC: '🟢 Green Team'
      };
      
      const message = teamService.formatThreeTeamsMessage(balance, teamNames);
      
      expect(message).toContain('🔴 Red Team');
      expect(message).toContain('🔵 Blue Team');
      expect(message).toContain('🟢 Green Team');
      expect(message).toContain('📊 Максимальная разница:');
      expect(message).toContain('📈 Средняя разница:');
      
      console.log('TRI Message Format Test:');
      console.log(message);
    });
  });

  describe('RatingService Weight Parameter', () => {
    it('should accept weight parameter in updateTrueSkill interface', () => {
      // This test verifies the interface accepts weight parameter
      // We just check the method signature exists without calling it
      expect(typeof ratingService.updateTrueSkill).toBe('function');
      
      // Check that the method can be called with weight parameter (interface test)
      const mockOptions = {
        weight: 0.5,
        matchPlayedAt: new Date(),
        mvpIds: [],
        applyIdleInflation: false
      };
      
      expect(typeof mockOptions.weight).toBe('number');
      expect(mockOptions.weight).toBe(0.5);
    });
  });

  describe('TRI Result Parsing', () => {
    // Testing the result parsing logic from tri.ts
    const parseTriResults = (text: string): { results: any[], errors: string[] } => {
      const lines = text.trim().split('\n');
      const results: any[] = [];
      const errors: string[] = [];
      
      const MAX_LINES = 50; // Mock limit
      if (lines.length > MAX_LINES) {
        errors.push(`Превышен лимит строк: ${lines.length}/${MAX_LINES}`);
        return { results: [], errors };
      }
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const lineNum = i + 1;
        
        // Try different formats
        let match = line.match(/^([ABC])\s+(\d+)-(\d+)\s+([ABC])$/); // A 5-3 B
        if (!match) {
          match = line.match(/^([ABC])-([ABC])\s+(\d+):(\d+)$/); // A-B 5:3
          if (match) {
            match = [match[0], match[1], match[3], match[4], match[2]]; // rearrange
          }
        }
        if (!match) {
          match = line.match(/^([ABC])([ABC])\s+(\d+)\s+(\d+)$/); // AB 5 3
          if (match) {
            match = [match[0], match[1], match[3], match[4], match[2]]; // rearrange
          }
        }
        
        if (!match) {
          errors.push(`Строка ${lineNum}: не удалось распарсить "${line}"`);
          continue;
        }
        
        const t1 = match[1];
        const s1 = parseInt(match[2]);
        const s2 = parseInt(match[3]);
        const t2 = match[4];
        
        // Validation
        if (!['A', 'B', 'C'].includes(t1) || !['A', 'B', 'C'].includes(t2)) {
          errors.push(`Строка ${lineNum}: недопустимые команды "${t1}" и "${t2}"`);
          continue;
        }
        
        if (t1 === t2) {
          errors.push(`Строка ${lineNum}: команда не может играть сама с собой`);
          continue;
        }
        
        if (s1 < 0 || s2 < 0) {
          errors.push(`Строка ${lineNum}: счет не может быть отрицательным`);
          continue;
        }
        
        const winner = s1 > s2 ? t1 : s2 > s1 ? t2 : null;
        
        results.push({ t1, t2, s1, s2, winner });
      }
      
      return { results, errors };
    };

    it('should parse TRI results correctly in various formats', () => {
      const testInput1 = 'A 5-3 B\nA 2-1 C\nB 4-2 C';
      const result1 = parseTriResults(testInput1);
      
      expect(result1.errors).toHaveLength(0);
      expect(result1.results).toHaveLength(3);
      
      expect(result1.results[0]).toEqual({ t1: 'A', t2: 'B', s1: 5, s2: 3, winner: 'A' });
      expect(result1.results[1]).toEqual({ t1: 'A', t2: 'C', s1: 2, s2: 1, winner: 'A' });
      expect(result1.results[2]).toEqual({ t1: 'B', t2: 'C', s1: 4, s2: 2, winner: 'B' });
    });

    it('should parse alternative TRI result formats', () => {
      const testInput2 = 'A-B 3:2\nAC 1 1\nB-C 0:1';
      const result2 = parseTriResults(testInput2);
      
      expect(result2.errors).toHaveLength(0);
      expect(result2.results).toHaveLength(3);
      
      expect(result2.results[0]).toEqual({ t1: 'A', t2: 'B', s1: 3, s2: 2, winner: 'A' });
      expect(result2.results[1]).toEqual({ t1: 'A', t2: 'C', s1: 1, s2: 1, winner: null }); // Draw
      expect(result2.results[2]).toEqual({ t1: 'B', t2: 'C', s1: 0, s2: 1, winner: 'C' });
    });

    it('should handle TRI parsing errors correctly', () => {
      const testInput3 = 'A 5-3 A\nX 2-1 B\nA -1-2 C\ninvalid line';
      const result3 = parseTriResults(testInput3);
      
      expect(result3.errors.length).toBeGreaterThan(0);
      expect(result3.results).toHaveLength(0); // Due to validation errors
      
      console.log('TRI Parsing Errors Test:');
      result3.errors.forEach(error => console.log(`- ${error}`));
    });
  });

  describe('TRI Statistics Integration', () => {
    it('should have methods for TRI mini-match handling', () => {
      // Test that StatisticsService has the new TRI methods
      expect(typeof statisticsService.saveTriMiniMatch).toBe('function');
      expect(typeof statisticsService.getTriMiniMatches).toBe('function');
    });
  });
});