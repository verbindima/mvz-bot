import { container } from 'tsyringe';
import { BotContext } from '@/bot';
import { MESSAGES, KEYBOARDS } from '@/config';
import { TeamService } from '@/services/team.service';
import { checkAdminPrivateOnly } from '@/utils/chat';
import { prisma } from '@/utils/database';
import { getCurrentWeek } from '@/utils/week';

export const teamsCommand = async (ctx: BotContext): Promise<void> => {
  try {
    if (!await checkAdminPrivateOnly(ctx)) {
      return;
    }

    const { main } = await ctx.gameService.getWeekPlayers();

    if (main.length < 16) {
      await ctx.reply(`❌ Недостаточно игроков для формирования команд (${main.length}/16)`);
      return;
    }

    const teamService = container.resolve(TeamService);
    const balance = teamService.generateBalancedTeams(main);
    
    // Сохраняем составы команд в базу данных
    const { week, year } = getCurrentWeek();
    const teamAIds = balance.teamA.players.map(p => p.id);
    const teamBIds = balance.teamB.players.map(p => p.id);
    
    await prisma.gameSession.upsert({
      where: { week_year: { week, year } },
      update: {
        teamAPlayers: JSON.stringify(teamAIds),
        teamBPlayers: JSON.stringify(teamBIds),
      },
      create: {
        week,
        year,
        teamA: '',
        teamB: '',
        teamAPlayers: JSON.stringify(teamAIds),
        teamBPlayers: JSON.stringify(teamBIds),
      },
    });

    const message = teamService.formatTeamsMessage(balance);

    await ctx.reply(message, {
      reply_markup: {
        inline_keyboard: KEYBOARDS.ADMIN_TEAMS,
      },
      parse_mode: 'HTML',
    });
  } catch (error) {
    console.error('Error in teams command:', error);
    await ctx.reply('Произошла ошибка при генерации команд.');
  }
};