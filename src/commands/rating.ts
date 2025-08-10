import { container } from 'tsyringe';
import { BotContext } from '../bot';
import { CONFIG, MESSAGES } from '../config';
import { RatingService } from '../services/rating.service';
import { TeamPlayerService } from '../services/team-player.service';
import { StatisticsService } from '../services/statistics.service';
import { prisma } from '../utils/database';

export const rateCommand = async (ctx: BotContext): Promise<void> => {
  try {
    await ctx.reply('❌ Команда /rate больше не поддерживается. Система капитанских оценок удалена.');
  } catch (error) {
    console.error('Error in rate command:', error);
    await ctx.reply('Произошла ошибка при обработке команды.');
  }
};

export const schemeCommand = async (ctx: BotContext): Promise<void> => {
  try {
    if (!CONFIG.ADMINS.includes(ctx.from!.id)) {
      await ctx.reply(MESSAGES.ACCESS_DENIED);
      return;
    }

    await ctx.reply('Схема рейтинга фиксирована: используется только TrueSkill.');
  } catch (error) {
    console.error('Error in scheme command:', error);
    await ctx.reply('Произошла ошибка при обработке команды схемы рейтинга.');
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

    // Сохраняем результат матча для статистики
    const statisticsService = container.resolve(StatisticsService);
    const teamAScore = team1 === 'A' ? score1 : score2;
    const teamBScore = team1 === 'A' ? score2 : score1;
    
    await statisticsService.saveMatchResult(gameSession.id, teamAScore, teamBScore);

    // Обновляем TrueSkill рейтинги
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

    await ctx.reply(`✅ Результат матча обработан: ${team1} ${score1}-${score2} ${team2}\n📊 Статистика игроков обновлена`);
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
      `• Сбросит флаги подтверждения и инициализации\n` +
      `• Очистит список записанных игроков (WeekEntry)\n` +
      `• Деактивирует текущую сессию\n` +
      `📊 Составы команд и результаты матчей сохраняются для статистики\n\n` +
      `Для подтверждения отправьте: /finish_game confirm`;

    const args = ('text' in ctx.message! && ctx.message.text) ? ctx.message.text.split(' ') : [];
    
    if (args.length < 2 || args[1] !== 'confirm') {
      await ctx.reply(confirmMessage);
      return;
    }

    // НЕ удаляем составы команд и результаты матчей - оставляем для статистики!
    // Только сбрасываем флаги сессии для начала новой игры
    await prisma.gameSession.update({
      where: { week_year: { week, year } },
      data: {
        isConfirmed: false,
        isInitialized: false,
      },
    });

    // Удаляем записи игроков на эту неделю (WeekEntry)
    await prisma.weekEntry.deleteMany({
      where: { week, year },
    });

    await ctx.reply(`✅ Игра завершена и сессия сброшена!\n\n` +
      `📊 Статистика и результаты матчей сохранены\n` +
      `🎮 Теперь можно начинать новый набор командой /init_week`);
      
  } catch (error) {
    console.error('Error in finish_game command:', error);
    await ctx.reply('Произошла ошибка при завершении игры.');
  }
};