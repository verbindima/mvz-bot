import { BotContext } from '../bot';
import { escapeHtml } from '../utils/html';
import { prisma } from '../utils/database';
import { getCurrentWeek } from '../utils/week';
import { safeEditOrReply } from '../utils/safe-edit';
import { TeamService } from '../services/team.service';
import { TeamPlayerService } from '../services/team-player.service';
import { container } from 'tsyringe';

const generateInfoMessage = async (ctx: BotContext, playerId: number) => {
  const { main, waiting } = await ctx.gameService.getWeekPlayers();

  // Получаем информацию о текущей игре
  const { week, year } = getCurrentWeek();
  const gameSession = await prisma.gameSession.findUnique({
    where: {
      week_year: { week, year },
    },
  });

  // Проверяем, утверждены ли команды
  const teamsConfirmed = gameSession?.isConfirmed || false;

  // Проверяем статус текущего игрока
  let playerStatus = '❌ Вы не записаны на игру';
  let playerPosition = '';

  const teamAName = escapeHtml(gameSession?.teamA || '🔴');
  const teamBName = escapeHtml(gameSession?.teamB || '🔵');

  const playerInMain = main.find(p => p.id === playerId);
  const playerInWaiting = waiting.find(p => p.id === playerId);

  if (playerInMain) {
    if (teamsConfirmed && gameSession) {
      // Если команды утверждены, определяем в какой команде игрок
      const teamPlayerService = container.resolve(TeamPlayerService);
      const playerTeamResult = await teamPlayerService.getPlayerTeam(gameSession.id, playerId);

      if (playerTeamResult === 'A') {
        playerStatus = `🏅 Вы в команде ${teamAName}`;
      } else if (playerTeamResult === 'B') {
        playerStatus = `🏅 Вы в команде ${teamBName}`;
      } else {
        playerStatus = '✅ Вы в основном составе';
      }
    } else {
      const position = main.findIndex(p => p.id === playerId) + 1;
      playerStatus = '✅ Вы в основном составе';
      playerPosition = ` (позиция ${position})`;
    }
  } else if (playerInWaiting) {
    const position = waiting.findIndex(p => p.id === playerId) + 1;
    playerStatus = '⏳ Вы в списке ожидания';
    playerPosition = ` (позиция ${position})`;
  }

  // Формируем отображение игроков
  let mainPlayersText = '';

  if (teamsConfirmed && gameSession) {
    // Если команды утверждены, показываем составы команд
    const teamPlayerService = container.resolve(TeamPlayerService);
    const teamComposition = await teamPlayerService.getTeamComposition(gameSession.id);

    if (!teamComposition) {
      mainPlayersText = '<i>Команды не найдены</i>';
    } else {
      // Получаем дополнительную информацию о записях игроков
      const teamAPlayersWithEntries = await prisma.player.findMany({
        where: { id: { in: teamComposition.teamA.map(p => p.id) } },
        include: {
          weekEntries: {
            where: { week, year },
            take: 1
          }
        }
      });

      const teamBPlayersWithEntries = await prisma.player.findMany({
        where: { id: { in: teamComposition.teamB.map(p => p.id) } },
        include: {
          weekEntries: {
            where: { week, year },
            take: 1
          }
        }
      });

      // Получаем TeamService для расчета рейтингов
      const teamService = container.resolve(TeamService);

      // Форматируем команду A
      const teamAStr = teamAPlayersWithEntries.map((p, i) => {
        const escapedName = escapeHtml(p.firstName);
        const paymentIcon = p.weekEntries[0]?.isPaid ? ' ✅' : '';
        const rating = teamService.getPlayerWeight(p).toFixed(1);
        return `${i + 1}. ${escapedName} — ${rating}${paymentIcon}`;
      }).join('\n');

      // Форматируем команду B
      const teamBStr = teamBPlayersWithEntries.map((p, i) => {
        const escapedName = escapeHtml(p.firstName);
        const paymentIcon = p.weekEntries[0]?.isPaid ? ' ✅' : '';
        const rating = teamService.getPlayerWeight(p).toFixed(1);
        return `${i + 1}. ${escapedName} — ${rating}${paymentIcon}`;
      }).join('\n');

      // Рассчитываем баланс команд
      const teamAWeight = teamComposition.teamA.reduce((sum, p) => sum + teamService.getPlayerWeight(p), 0);
      const teamBWeight = teamComposition.teamB.reduce((sum, p) => sum + teamService.getPlayerWeight(p), 0);
      const difference = Math.abs(teamAWeight - teamBWeight);
      const winProbability = teamService.calculateWinProbability(teamAWeight, teamBWeight);

      mainPlayersText =
        `<b>${teamAName}</b> (${teamAWeight.toFixed(1)}):\n${teamAStr}\n\n` +
        `<b>${teamBName}</b> (${teamBWeight.toFixed(1)}):\n${teamBStr}\n\n` +
        `📊 Разница в силе: ${difference.toFixed(2)} μ | 🎯 Шансы на победу ${teamAName}: ${winProbability.toFixed(1)}% vs ${teamBName}: ${(100 - winProbability).toFixed(1)}%`;
    }
  } else {
    // Обычный список если команды не утверждены
    if (main.length > 0) {
      mainPlayersText = main
        .slice(0, 16)
        .map((p, i) => {
          const escapedName = escapeHtml(p.firstName);
          // Добавляем иконку оплаты если есть информация
          const paymentIcon = p.weekEntry?.isPaid ? ' ✅' : '';
          return `${i + 1}. ${escapedName}${paymentIcon}`;
        })
        .join('\n');
    } else {
      mainPlayersText = '<i>Пока никого нет</i>';
    }
  }

  // Формируем сообщение
  let message = `⚽ <b>Игра на этой неделе</b>\n\n`;

  // Показываем информацию о игре если инициализирована
  if (gameSession?.isInitialized && gameSession.gameDate) {
    const formatDate = (date: Date): string => {
      return date.toLocaleString('ru-RU', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    };

    message += `📅 <b>Дата:</b> ${formatDate(gameSession.gameDate)}\n`;
    if (gameSession.gameLocation) {
      message += `📍 <b>Место:</b> ${gameSession.gameLocation}\n`;
    }
    message += `\n`;
  }

  if (teamsConfirmed && gameSession) {
    // Если команды утверждены, показываем их
    message += `🏆 <b>Утвержденные команды:</b>\n\n`;
    message += `${mainPlayersText}\n\n`;

    if (waiting.length > 0) {
      message += `⏳ <b>Список ожидания:</b> ${waiting.length} чел.\n\n`;
    }

    message += `📊 <b>Ваш статус:</b>\n`;
    message += `${playerStatus}${playerPosition}\n\n`;

    message += `✅ <b>Команды готовы к игре!</b>`;
  } else {
    // Обычное отображение до утверждения команд
    message += `👥 <b>Основной состав (${main.length}/16):</b>\n`;
    message += `${mainPlayersText}\n\n`;

    if (waiting.length > 0) {
      message += `⏳ <b>Список ожидания:</b> ${waiting.length} чел.\n\n`;
    }

    message += `📊 <b>Ваш статус:</b>\n`;
    message += `${playerStatus}${playerPosition}\n\n`;

    if (main.length < 16) {
      const needed = 16 - main.length;
      message += `🎯 <b>Нужно еще:</b> ${needed} игроков для полного состава`;
    } else {
      message += `🔥 <b>Основной состав полный!</b> Можно формировать команды`;
    }
  }

  // Выбираем кнопки в зависимости от статуса игрока
  let keyboard;
  if (playerInMain || playerInWaiting) {
    keyboard = [
      [{ text: '❌ Передумал', callback_data: 'leave' }],
      [{ text: '📊 Статистика', callback_data: 'stats' }, { text: '🔄 Обновить', callback_data: 'refresh_info' }],
      [{ text: '💳 Оплата', callback_data: 'payment_info' }, { text: '⚖️ Баланс команд', callback_data: 'rating_info' }],
      [{ text: '❎ Закрыть', callback_data: 'close_menu' }],
    ];
  } else {
    keyboard = [
      [{ text: '⚽ Я играю', callback_data: 'join' }],
      [{ text: '📊 Статистика', callback_data: 'stats' }, { text: '🔄 Обновить', callback_data: 'refresh_info' }],
      [{ text: '💳 Оплата', callback_data: 'payment_info' }, { text: '⚖️ Баланс команд', callback_data: 'rating_info' }],
      [{ text: '❎ Закрыть', callback_data: 'close_menu' }],
    ];
  }

  return { message, keyboard };
};

export const infoCommand = async (ctx: BotContext): Promise<void> => {
  try {
    const player = await ctx.playerService.getPlayer(ctx.from!.id);

    if (!player) {
      const method = ctx.callbackQuery ? 'editMessageText' : 'reply';
      const options: any = {
        reply_markup: {
          inline_keyboard: [[{ text: '🚀 Начать регистрацию', callback_data: 'start_registration' }]],
        },
      };

      if (ctx.callbackQuery) {
        options.parse_mode = 'HTML';
      }

      await ctx[method](
        '❌ Вы не зарегистрированы в системе.\n\n' +
        'Используйте /start для регистрации.',
        options
      );
      return;
    }

    const { message, keyboard } = await generateInfoMessage(ctx, player.id);

    await safeEditOrReply(ctx, message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: keyboard,
      },
    });

  } catch (error) {
    console.error('Error in info command:', error);
    await ctx.reply(
      '❌ Произошла ошибка при получении информации об игре.\n\n' +
      'Попробуйте позже или обратитесь к администратору.'
    );
  }
};