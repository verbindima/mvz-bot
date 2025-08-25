import { container } from 'tsyringe';
import { BotContext } from '../bot';
import { KEYBOARDS, CONFIG } from '../config';
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
    
    // Получаем информацию о текущей игре для определения формата
    const { week, year } = getCurrentWeek();
    const existingSession = await prisma.gameSession.findUnique({
      where: { week_year: { week, year } }
    });
    
    const requiredPlayers = existingSession?.format === 'TRI' ? 24 : 16;
    const formatName = existingSession?.format === 'TRI' ? 'TRI команд (3×8)' : 'команд (2×8)';

    if (main.length < requiredPlayers) {
      const errorMessage = `❌ Недостаточно игроков для формирования ${formatName} (${main.length}/${requiredPlayers})`;
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery(errorMessage, { show_alert: true });
      } else {
        await ctx.reply(errorMessage);
      }
      return;
    }

    const teamService = container.resolve(TeamService);
    
    // Проверяем, нужно ли генерировать TRI команды
    if (existingSession?.format === 'TRI') {
      // Генерируем три команды
      const threeTeamBalance = await teamService.generateThreeTeams(main);
      
      let threeTeamNames = { teamA: '🔴 Красная', teamB: '🔵 Синяя', teamC: '🟢 Зелёная' };
      
      if (query) {
        if (query.toLowerCase() === 'ai') {
          await ctx.reply('🤖 Генерирую названия для трёх команд...');
          const response = await ctx.aiService.generateResponse(
            'Придумай три смешных и классных названия футбольных команд. Ответь в формате "Название1;Название2;Название3" без лишнего текста.'
          );
          const parts = response.split(/;|\n|,|\|/).map(p => p.trim()).filter(Boolean);
          if (parts.length >= 3) {
            threeTeamNames = { teamA: parts[0], teamB: parts[1], teamC: parts[2] };
          }
        } else {
          const parts = query.split(/;|,|\n/).map(p => p.trim()).filter(Boolean);
          if (parts.length >= 3) {
            threeTeamNames = { teamA: parts[0], teamB: parts[1], teamC: parts[2] };
          }
        }
      }
      
      // Обновляем сессию с названиями команд
      const gameSession = await prisma.gameSession.update({
        where: { week_year: { week, year } },
        data: {
          teamA: threeTeamNames.teamA,
          teamB: threeTeamNames.teamB,
          teamC: threeTeamNames.teamC,
          isInitialized: true,
          isConfirmed: false
        }
      });
      
      // Сохраняем составы команд через TeamPlayerService
      const teamPlayerService = container.resolve(TeamPlayerService);
      await teamPlayerService.saveThreeTeamComposition(
        gameSession.id,
        threeTeamBalance.teamA.players,
        threeTeamBalance.teamB.players,
        threeTeamBalance.teamC.players
      );
      
      const message = teamService.formatThreeTeamsMessage(threeTeamBalance, threeTeamNames);
      
      // Отправляем сообщение с TRI командами
      if (ctx.callbackQuery) {
        await ctx.editMessageText(
          `⚽ <b>TRI команды сгенерированы!</b>\n\n${message}\n\n💡 Используйте /tri_confirm для подтверждения составов`,
          {
            parse_mode: 'HTML'
          }
        );
        await ctx.answerCbQuery('♻️ TRI команды пересчитаны');
      } else {
        await ctx.reply(
          `⚽ <b>TRI команды сгенерированы!</b>\n\n${message}\n\n💡 Используйте /tri_confirm для подтверждения составов`,
          { parse_mode: 'HTML' }
        );
      }
      return;
    }
    
    // Обычные две команды
    const balance = await teamService.generateBalancedTeams(main);

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

    // Сохраняем составы команд в базу данных (обычные две команды)
    const gameSession = await prisma.gameSession.upsert({
      where: { week_year: { week, year } },
      update: {
        teamA: teamNames.teamA,
        teamB: teamNames.teamB,
        format: 'DUO', // Явно устанавливаем формат DUO
      },
      create: {
        week,
        year,
        format: 'DUO',
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
          inline_keyboard: KEYBOARDS.ADMIN_TEAMS(CONFIG.SYNERGY_ENABLED),
        },
        parse_mode: 'HTML',
      });
      await ctx.answerCbQuery('♻️ Команды пересчитаны');
    } else {
      await ctx.reply(message, {
        reply_markup: {
          inline_keyboard: KEYBOARDS.ADMIN_TEAMS(CONFIG.SYNERGY_ENABLED),
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