import { container } from 'tsyringe';
import { BotContext } from '../bot';
import { KEYBOARDS } from '../config';
import { TeamService } from '../services/team.service';
import { TeamPlayerService } from '../services/team-player.service';
import { checkAdminPrivateOnly } from '../utils/chat';
import { prisma } from '../utils/database';
import { getCurrentWeek } from '../utils/week';

export const teamsCommand = async (ctx: BotContext): Promise<void> => {
  try {
    if (!await checkAdminPrivateOnly(ctx)) {
      return;
    }

    // Если вызвано из callback query, не обрабатываем дополнительные параметры
    let query = '';
    if (ctx.message && 'text' in ctx.message) {
      query = ctx.message.text?.replace('/teams', '').trim() || '';
    }

    const { main } = await ctx.gameService.getWeekPlayers();

    if (main.length < 16) {
      const errorMessage = `❌ Недостаточно игроков для формирования команд (${main.length}/16)`;
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery(errorMessage, { show_alert: true });
      } else {
        await ctx.reply(errorMessage);
      }
      return;
    }

    const teamService = container.resolve(TeamService);
    const balance = teamService.generateBalancedTeams(main);

    let teamNames = { teamA: '🔴', teamB: '🔵' };

    if (query) {
      if (query.toLowerCase() === 'ai') {
        await ctx.reply('🤖 Генерирую названия команд...');
        const response = await ctx.aiService.generateResponse(
          'Придумай два смешных и классных названия футбольных команд. Ответь в формате "Название1;Название2" без лишнего текста.'
        );
        const parts = response.split(/;|\n|,|\|/).map(p => p.trim()).filter(Boolean);
        if (parts.length >= 2) {
          teamNames = { teamA: parts[0], teamB: parts[1] };
        }
      } else {
        const parts = query.split(/;|,|\n/).map(p => p.trim()).filter(Boolean);
        if (parts.length >= 2) {
          teamNames = { teamA: parts[0], teamB: parts[1] };
        }
      }
    }

    // Если используются стандартные названия, случайным образом выбираем цвет
    if (!query && Math.random() < 0.5) {
      teamNames = { teamA: '🔵', teamB: '🔴' };
    }

    // Сохраняем составы команд в базу данных
    const { week, year } = getCurrentWeek();
    
    const gameSession = await prisma.gameSession.upsert({
      where: { week_year: { week, year } },
      update: {
        teamA: teamNames.teamA,
        teamB: teamNames.teamB,
      },
      create: {
        week,
        year,
        teamA: teamNames.teamA,
        teamB: teamNames.teamB,
      },
    });

    // Сохраняем составы команд через TeamPlayerService
    const teamPlayerService = container.resolve(TeamPlayerService);
    await teamPlayerService.saveTeamComposition(
      gameSession.id,
      balance.teamA.players,
      balance.teamB.players
    );

    const message = teamService.formatTeamsMessage(balance, teamNames);

    // Если это callback query, редактируем сообщение, иначе отправляем новое
    if (ctx.callbackQuery) {
      await ctx.editMessageText(message, {
        reply_markup: {
          inline_keyboard: KEYBOARDS.ADMIN_TEAMS,
        },
        parse_mode: 'HTML',
      });
      await ctx.answerCbQuery('♻️ Команды пересчитаны');
    } else {
      await ctx.reply(message, {
        reply_markup: {
          inline_keyboard: KEYBOARDS.ADMIN_TEAMS,
        },
        parse_mode: 'HTML',
      });
    }
  } catch (error) {
    console.error('Error in teams command:', error);
    const errorMessage = 'Произошла ошибка при генерации команд.';
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery(errorMessage, { show_alert: true });
    } else {
      await ctx.reply(errorMessage);
    }
  }
};