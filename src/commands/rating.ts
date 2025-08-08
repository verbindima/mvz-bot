import { container } from 'tsyringe';
import { BotContext } from '../bot';
import { CONFIG, MESSAGES, setScheme } from '../config';
import { RatingService } from '../services/rating.service';
import { TeamPlayerService } from '../services/team-player.service';
import { prisma } from '../utils/database';

export const rateCommand = async (ctx: BotContext): Promise<void> => {
  try {
    if (!CONFIG.ADMINS.includes(ctx.from!.id)) {
      await ctx.reply(MESSAGES.ACCESS_DENIED);
      return;
    }

    const args = ('text' in ctx.message! && ctx.message.text) ? ctx.message.text.split(' ') : [];
    if (!args || args.length !== 3) {
      await ctx.reply(MESSAGES.INVALID_RATING);
      return;
    }

    const username = args[1].replace('@', '');
    const delta = parseInt(args[2]);

    if (isNaN(delta) || delta < -1 || delta > 1) {
      await ctx.reply(MESSAGES.INVALID_RATING);
      return;
    }

    const player = await prisma.player.findFirst({
      where: { username },
    });

    if (!player) {
      await ctx.reply(MESSAGES.PLAYER_NOT_FOUND);
      return;
    }

    await ctx.reply('❌ Команда /rate больше не поддерживается. Captain рейтинг удален из системы.');
  } catch (error) {
    console.error('Error in rate command:', error);
    await ctx.reply('Произошла ошибка при обновлении рейтинга.');
  }
};

export const schemeCommand = async (ctx: BotContext): Promise<void> => {
  try {
    if (!CONFIG.ADMINS.includes(ctx.from!.id)) {
      await ctx.reply(MESSAGES.ACCESS_DENIED);
      return;
    }

    const args = ('text' in ctx.message! && ctx.message.text) ? ctx.message.text.split(' ') : [];
    if (!args || args.length !== 2) {
      await ctx.reply('Использование: /scheme <self|ts>');
      return;
    }

    const scheme = args[1] as 'self' | 'ts';
    if (!['self', 'ts'].includes(scheme)) {
      await ctx.reply('Доступные схемы: self, ts');
      return;
    }

    const ratingService = container.resolve(RatingService);
    await ratingService.setRatingScheme(scheme);

    setScheme(scheme);

    await ctx.reply(`✅ Схема рейтинга изменена на: ${scheme}`);
  } catch (error) {
    console.error('Error in scheme command:', error);
    await ctx.reply('Произошла ошибка при изменении схемы рейтинга.');
  }
};

export const resultCommand = async (ctx: BotContext): Promise<void> => {
  try {
    if (!CONFIG.ADMINS.includes(ctx.from!.id)) {
      await ctx.reply(MESSAGES.ACCESS_DENIED);
      return;
    }

    const text = ('text' in ctx.message! && ctx.message.text) ? ctx.message.text.replace('/result ', '') : '';
    const match = text.match(/^([AB])\s+(\d+)-(\d+)\s+([AB])$/);
    
    if (!match) {
      await ctx.reply('Использование: /result A 5-3 B');
      return;
    }

    const [, team1, score1Str, score2Str, team2] = match;
    const score1 = parseInt(score1Str);
    const score2 = parseInt(score2Str);

    if (team1 === team2) {
      await ctx.reply('Команды должны быть разными (A или B)');
      return;
    }

    const { week, year } = require('../utils/week').getCurrentWeek();
    const gameSession = await prisma.gameSession.findUnique({
      where: { week_year: { week, year } },
    });

    if (!gameSession || !gameSession.isConfirmed) {
      await ctx.reply('Нет активной утвержденной игры');
      return;
    }

    const teamPlayerService = container.resolve(TeamPlayerService);
    const teamComposition = await teamPlayerService.getTeamComposition(gameSession.id);

    if (!teamComposition) {
      await ctx.reply('Составы команд не найдены');
      return;
    }

    const teamAPlayers = teamComposition.teamA.map(p => p.id);
    const teamBPlayers = teamComposition.teamB.map(p => p.id);

    const ratingService = container.resolve(RatingService);

    if (score1 > score2) {
      const winners = team1 === 'A' ? teamAPlayers : teamBPlayers;
      const losers = team1 === 'A' ? teamBPlayers : teamAPlayers;
      await ratingService.updateTrueSkill(winners, losers);
    } else if (score2 > score1) {
      const winners = team2 === 'A' ? teamAPlayers : teamBPlayers;
      const losers = team2 === 'A' ? teamBPlayers : teamAPlayers;
      await ratingService.updateTrueSkill(winners, losers);
    }

    await ctx.reply(`✅ Результат матча обработан: ${team1} ${score1}-${score2} ${team2}`);
  } catch (error) {
    console.error('Error in result command:', error);
    await ctx.reply('Произошла ошибка при обработке результата.');
  }
};

export const finishGameCommand = async (ctx: BotContext): Promise<void> => {
  try {
    if (!CONFIG.ADMINS.includes(ctx.from!.id)) {
      await ctx.reply(MESSAGES.ACCESS_DENIED);
      return;
    }

    const { week, year } = require('../utils/week').getCurrentWeek();
    
    // Проверяем есть ли активная сессия
    const gameSession = await prisma.gameSession.findUnique({
      where: { week_year: { week, year } },
    });

    if (!gameSession || !gameSession.isInitialized) {
      await ctx.reply('❌ Нет активной игры для завершения');
      return;
    }

    // Предварительное подтверждение
    const confirmMessage = `⚠️ Вы уверены, что хотите завершить игру и сбросить сессию?\n\n` +
      `Это действие:\n` +
      `• Сбросит утвержденные команды\n` +
      `• Очистит список записанных игроков\n` +
      `• Деактивирует текущую сессию\n\n` +
      `Для подтверждения отправьте: /finish_game confirm`;

    const args = ('text' in ctx.message! && ctx.message.text) ? ctx.message.text.split(' ') : [];
    
    if (args.length < 2 || args[1] !== 'confirm') {
      await ctx.reply(confirmMessage);
      return;
    }

    // Очищаем составы команд через TeamPlayerService
    const teamPlayerService = container.resolve(TeamPlayerService);
    await teamPlayerService.clearTeamComposition(gameSession.id);

    // Выполняем сброс сессии
    await prisma.gameSession.update({
      where: { week_year: { week, year } },
      data: {
        isConfirmed: false,
        isInitialized: false,
        teamA: '',
        teamB: '',
      },
    });

    // Удаляем записи игроков на эту неделю
    await prisma.weekEntry.deleteMany({
      where: { week, year },
    });

    await ctx.reply(`✅ Игра завершена и сессия сброшена!\n\n` +
      `Теперь можно начинать новый набор командой /init_week`);
      
  } catch (error) {
    console.error('Error in finish_game command:', error);
    await ctx.reply('Произошла ошибка при завершении игры.');
  }
};