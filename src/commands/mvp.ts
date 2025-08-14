import { container } from 'tsyringe';
import { BotContext } from '../bot';
import { CONFIG, MESSAGES } from '../config';
import { RatingService } from '../services/rating.service';
import { TeamPlayerService } from '../services/team-player.service';
import { StatisticsService } from '../services/statistics.service';
import { prisma } from '../utils/database';

export const mvpCommand = async (ctx: BotContext): Promise<void> => {
  try {
    if (!CONFIG.ADMINS.includes(ctx.from!.id)) {
      await ctx.reply(MESSAGES.ACCESS_DENIED);
      return;
    }

    const text = ('text' in ctx.message! && ctx.message.text) ? ctx.message.text.replace('/mvp ', '') : '';
    const args = text.split(' ').filter(Boolean);
    
    if (args.length === 0 || args.length > 2) {
      await ctx.reply(
        'Использование: /mvp @username1 [@username2]\n\n' +
        'Максимум 2 MVP (по одному из каждой команды).\n' +
        'Можно указать одного игрока или двух.'
      );
      return;
    }

    // Получаем текущую игровую сессию
    const { week, year } = require('../utils/week').getCurrentWeek();
    const gameSession = await prisma.gameSession.findUnique({
      where: { week_year: { week, year } },
    });

    if (!gameSession || !gameSession.isConfirmed) {
      await ctx.reply('❌ Нет активной утвержденной игры для назначения MVP');
      return;
    }

    // Проверяем, есть ли уже результат матча
    const matchResult = await prisma.matchResult.findUnique({
      where: { gameSessionId: gameSession.id }
    });

    if (!matchResult) {
      await ctx.reply('❌ Сначала нужно внести результат матча командой /result');
      return;
    }

    // Получаем составы команд
    const teamPlayerService = container.resolve(TeamPlayerService);
    const teamComposition = await teamPlayerService.getTeamComposition(gameSession.id);

    if (!teamComposition) {
      await ctx.reply('❌ Составы команд не найдены');
      return;
    }

    // Находим игроков по username
    const mvpPlayers: { id: number; username: string; team: string }[] = [];
    
    for (const usernameArg of args) {
      const username = usernameArg.replace('@', '');
      
      // Ищем в команде A
      const playerA = teamComposition.teamA.find(p => p.username === username);
      if (playerA) {
        mvpPlayers.push({ id: playerA.id, username, team: 'A' });
        continue;
      }

      // Ищем в команде B
      const playerB = teamComposition.teamB.find(p => p.username === username);
      if (playerB) {
        mvpPlayers.push({ id: playerB.id, username, team: 'B' });
        continue;
      }

      await ctx.reply(`❌ Игрок @${username} не найден в составах команд`);
      return;
    }

    // Проверяем, что не более одного MVP на команду
    const teamAMvp = mvpPlayers.filter(p => p.team === 'A').length;
    const teamBMvp = mvpPlayers.filter(p => p.team === 'B').length;
    
    if (teamAMvp > 1 || teamBMvp > 1) {
      await ctx.reply('❌ Максимум один MVP на команду');
      return;
    }

    // Проверяем, не были ли уже назначены MVP для этого матча
    const existingMvpEvents = await prisma.ratingEvent.findMany({
      where: {
        reason: 'mvp',
        createdAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // За последние 24 часа
        }
      },
      include: {
        player: true
      }
    });

    if (existingMvpEvents.length > 0) {
      const existingMvpNames = existingMvpEvents.map(e => e.player.firstName).join(', ');
      await ctx.reply(`⚠️ MVP уже назначены: ${existingMvpNames}\n\nМожно назначить только один раз за матч.`);
      return;
    }

    // Применяем MVP бонусы
    const mvpIds = mvpPlayers.map(p => p.id);
    
    await prisma.$transaction([
      // Обновляем μ рейтинг MVP игроков
      ...mvpIds.map(id =>
        prisma.player.update({
          where: { id },
          data: {
            tsMu: { increment: CONFIG.RATING_MVP_MU_BONUS },
            mvpCount: { increment: 1 }
          }
        })
      ),
      // Создаем события MVP
      ...mvpIds.map(id => {
        const mvpPlayer = mvpPlayers.find(p => p.id === id)!;
        return prisma.ratingEvent.create({
          data: {
            playerId: id,
            muBefore: 0, // Заполним после получения текущих данных
            muAfter: 0,  // Заполним после получения текущих данных
            sigmaBefore: 0,
            sigmaAfter: 0,
            reason: 'mvp',
            meta: {
              bonus: CONFIG.RATING_MVP_MU_BONUS,
              team: mvpPlayer.team,
              matchId: gameSession.id
            }
          }
        });
      })
    ]);

    const mvpNames = mvpPlayers.map(p => `@${p.username} (команда ${gameSession.teamA && p.team === 'A' ? gameSession.teamA : gameSession.teamB})`).join(', ');
    
    await ctx.reply(
      `🏆 MVP назначены: ${mvpNames}\n\n` +
      `💫 Бонус: +${CONFIG.RATING_MVP_MU_BONUS} к рейтингу каждому`
    );

  } catch (error) {
    console.error('Error in mvp command:', error);
    await ctx.reply('❌ Произошла ошибка при назначении MVP.');
  }
};