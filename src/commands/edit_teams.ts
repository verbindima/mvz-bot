import { BotContext } from '@/bot';
import { prisma } from '@/utils/database';
import { getCurrentWeek } from '@/utils/week';
import { escapeHtml } from '@/utils/html';
import { CONFIG } from '@/config';
import { TeamService } from '@/services/team.service';
import { container } from 'tsyringe';

export const editTeamsCommand = async (ctx: BotContext): Promise<void> => {
  try {
    const { week, year } = getCurrentWeek();

    // Получаем сохраненные составы
    const gameSession = await prisma.gameSession.findUnique({
      where: { week_year: { week, year } },
    });

    if (!gameSession || !gameSession.teamAPlayers || !gameSession.teamBPlayers) {
      await ctx.editMessageText('❌ Составы команд не найдены. Сначала сгенерируйте команды.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '↩️ Назад', callback_data: 'regenerate_teams' }]
          ]
        }
      });
      return;
    }

    const teamAIds = JSON.parse(gameSession.teamAPlayers) as number[];
    const teamBIds = JSON.parse(gameSession.teamBPlayers) as number[];

    // Получаем игроков
    const teamAPlayers = await prisma.player.findMany({
      where: { id: { in: teamAIds } },
      orderBy: { firstName: 'asc' }
    });

    const teamBPlayers = await prisma.player.findMany({
      where: { id: { in: teamBIds } },
      orderBy: { firstName: 'asc' }
    });

    // Форматируем сообщение для редактирования
    const formatTeamForEdit = (players: any[], teamName: string, teamLetter: 'A' | 'B'): string => {
      return players.map((p, i) => {
        const escapedName = escapeHtml(p.firstName);
        const usernameStr = p.username ? ` (@${p.username})` : '';
        return `${i + 1}. ${escapedName}${usernameStr}`;
      }).join('\n');
    };

    const teamAStr = formatTeamForEdit(teamAPlayers, '🔴', 'A');
    const teamBStr = formatTeamForEdit(teamBPlayers, '🔵', 'B');

    const message = `✏️ <b>Ручная правка команд</b>\n\n` +
      `<b>🔴 Команда A:</b>\n${teamAStr}\n\n` +
      `<b>🔵 Команда B:</b>\n${teamBStr}\n\n` +
      `Выберите игрока для перемещения:`;

    // Создаем кнопки для каждого игрока
    const keyboard: any[][] = [];

    // Игроки команды A
    teamAPlayers.forEach((player, i) => {
      keyboard.push([{
        text: `🔴→🔵 ${player.firstName}`,
        callback_data: `move_player_A_${player.id}`
      }]);
    });

    // Игроки команды B
    teamBPlayers.forEach((player, i) => {
      keyboard.push([{
        text: `🔵→🔴 ${player.firstName}`,
        callback_data: `move_player_B_${player.id}`
      }]);
    });

    // Кнопки управления
    keyboard.push([
      { text: '🔄 Обновить баланс', callback_data: 'recalculate_balance' },
      { text: '↩️ Назад к командам', callback_data: 'regenerate_teams' }
    ]);
    keyboard.push([
      { text: '❎ Закрыть', callback_data: 'close_admin_menu' }
    ]);

    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });

  } catch (error) {
    console.error('Error in edit teams command:', error);
    await ctx.reply('Произошла ошибка при загрузке редактора команд.');
  }
};

export const movePlayerCommand = async (ctx: BotContext, fromTeam: 'A' | 'B', playerId: number): Promise<void> => {
  try {
    if (!CONFIG.ADMINS.includes(ctx.from!.id)) {
      await ctx.answerCbQuery('🚫 У вас нет доступа к этой команде');
      return;
    }

    const { week, year } = getCurrentWeek();

    const gameSession = await prisma.gameSession.findUnique({
      where: { week_year: { week, year } },
    });

    if (!gameSession || !gameSession.teamAPlayers || !gameSession.teamBPlayers) {
      await ctx.answerCbQuery('❌ Составы команд не найдены');
      return;
    }

    let teamAIds = JSON.parse(gameSession.teamAPlayers) as number[];
    let teamBIds = JSON.parse(gameSession.teamBPlayers) as number[];

    // Перемещаем игрока
    if (fromTeam === 'A') {
      teamAIds = teamAIds.filter(id => id !== playerId);
      teamBIds.push(playerId);
    } else {
      teamBIds = teamBIds.filter(id => id !== playerId);
      teamAIds.push(playerId);
    }

    // Обновляем в базе данных
    await prisma.gameSession.update({
      where: { week_year: { week, year } },
      data: {
        teamAPlayers: JSON.stringify(teamAIds),
        teamBPlayers: JSON.stringify(teamBIds),
      },
    });

    await ctx.answerCbQuery('✅ Игрок перемещен!');

    // Обновляем сообщение
    await editTeamsCommand(ctx);

  } catch (error) {
    console.error('Error in move player command:', error);
    await ctx.answerCbQuery('❌ Ошибка при перемещении игрока');
  }
};

export const recalculateBalanceCommand = async (ctx: BotContext): Promise<void> => {
  try {
    if (!CONFIG.ADMINS.includes(ctx.from!.id)) {
      await ctx.answerCbQuery('🚫 У вас нет доступа к этой команде');
      return;
    }

    const { week, year } = getCurrentWeek();

    const gameSession = await prisma.gameSession.findUnique({
      where: { week_year: { week, year } },
    });

    if (!gameSession || !gameSession.teamAPlayers || !gameSession.teamBPlayers) {
      await ctx.answerCbQuery('❌ Составы команд не найдены');
      return;
    }

    const teamAIds = JSON.parse(gameSession.teamAPlayers) as number[];
    const teamBIds = JSON.parse(gameSession.teamBPlayers) as number[];

    // Получаем игроков
    const teamAPlayers = await prisma.player.findMany({
      where: { id: { in: teamAIds } },
    });

    const teamBPlayers = await prisma.player.findMany({
      where: { id: { in: teamBIds } },
    });

    const teamService = container.resolve(TeamService);

    // Пересчитываем баланс для текущих составов
    const teamAWeight = teamAPlayers.reduce((sum, player) => sum + teamService.getPlayerWeight(player), 0);
    const teamBWeight = teamBPlayers.reduce((sum, player) => sum + teamService.getPlayerWeight(player), 0);
    const difference = Math.abs(teamAWeight - teamBWeight);

    const balance = {
      teamA: { players: teamAPlayers, totalRating: teamAWeight, averageRating: teamAWeight / teamAPlayers.length },
      teamB: { players: teamBPlayers, totalRating: teamBWeight, averageRating: teamBWeight / teamBPlayers.length },
      difference,
      winProbability: teamService.calculateWinProbability(teamAWeight, teamBWeight),
    };

    const message = teamService.formatTeamsMessage(balance);

    await ctx.editMessageText(message + '\n\n✅ <i>Составы обновлены с учетом ваших изменений</i>', {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Принять', callback_data: 'confirm_teams' },
            { text: '✏️ Продолжить правку', callback_data: 'edit_teams' }
          ],
          [{ text: '♻️ Пересчитать заново', callback_data: 'regenerate_teams' }],
          [{ text: '❎ Закрыть', callback_data: 'close_admin_menu' }]
        ]
      }
    });

    await ctx.answerCbQuery('🔄 Баланс команд пересчитан!');

  } catch (error) {
    console.error('Error in recalculate balance command:', error);
    await ctx.answerCbQuery('❌ Ошибка при пересчете баланса');
  }
};