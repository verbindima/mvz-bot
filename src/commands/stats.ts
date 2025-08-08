import { container } from 'tsyringe';
import { BotContext } from '../bot';
import { StatisticsService } from '../services/statistics.service';
import { escapeHtml } from '../utils/html';
import { safeEditOrReply } from '../utils/safe-edit';

const generateStatsMessage = async (ctx: BotContext, playerId: number) => {
  const statisticsService = container.resolve(StatisticsService);
  const stats = await statisticsService.getPlayerStatistics(playerId);

  if (!stats) {
    return {
      message: '❌ Статистика не найдена. Возможно, вы не зарегистрированы в системе.',
      keyboard: [[{ text: '❎ Закрыть', callback_data: 'close_menu' }]],
    };
  }

  const escapedName = escapeHtml(stats.player.firstName);
  const username = stats.player.username ? `@${stats.player.username}` : '';

  let message = `📊 <b>Статистика игрока</b>\n\n`;
  message += `👤 <b>Игрок:</b> ${escapedName} ${username}\n\n`;

  // Основная статистика
  message += `🎮 <b>Игры:</b> ${stats.gamesPlayed}\n`;
  message += `🏆 <b>Победы:</b> ${stats.wins}\n`;
  message += `💔 <b>Поражения:</b> ${stats.losses}\n`;
  
  if (stats.draws > 0) {
    message += `🤝 <b>Ничьи:</b> ${stats.draws}\n`;
  }

  if (stats.gamesPlayed > 0) {
    message += `📈 <b>Процент побед:</b> ${stats.winRate.toFixed(1)}%\n\n`;
  } else {
    message += `\n`;
  }

  // Рейтинги
  message += `🧮 <b>TrueSkill:</b> ${stats.currentTSRating}\n\n`;

  // История последних игр
  if (stats.ratingHistory.length > 0) {
    message += `📚 <b>Последние игры:</b>\n`;
    stats.ratingHistory.slice(0, 5).forEach((game, index) => {
      const date = game.date.toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
      });
      const deltaSymbol = game.delta > 0 ? '📈' : game.delta < 0 ? '📉' : '➡️';
      message += `${deltaSymbol} ${date} vs ${game.opponent}\n`;
    });
  }

  if (stats.gamesPlayed === 0) {
    message += `\n🎯 <b>Сыграйте несколько игр, чтобы увидеть подробную статистику!</b>`;
  }

  const keyboard = [
    [{ text: '🏆 Топ игроков', callback_data: 'top_players' }],
    [{ text: '🔄 Обновить', callback_data: 'refresh_stats' }, { text: '❎ Закрыть', callback_data: 'close_menu' }],
  ];

  return { message, keyboard };
};

export const statsCommand = async (ctx: BotContext): Promise<void> => {
  try {
    const player = await ctx.playerService.getPlayer(ctx.from!.id);

    if (!player) {
      await ctx.reply(
        '❌ Вы не зарегистрированы в системе.\n\n' +
        'Используйте /start для регистрации.',
        {
          reply_markup: {
            inline_keyboard: [[{ text: '🚀 Начать регистрацию', callback_data: 'start_registration' }]],
          },
        }
      );
      return;
    }

    const { message, keyboard } = await generateStatsMessage(ctx, player.id);

    await safeEditOrReply(ctx, message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: keyboard,
      },
    });

  } catch (error) {
    console.error('Error in stats command:', error);
    await ctx.reply(
      '❌ Произошла ошибка при получении статистики.\n\n' +
      'Попробуйте позже или обратитесь к администратору.'
    );
  }
};

export const topPlayersCommand = async (ctx: BotContext): Promise<void> => {
  try {
    const statisticsService = container.resolve(StatisticsService);
    const topPlayers = await statisticsService.getTopPlayers(10);

    if (topPlayers.length === 0) {
      await ctx.editMessageText(
        '📊 <b>Топ игроков</b>\n\n' +
        '❌ Пока нет игроков с достаточным количеством игр для составления рейтинга.\n\n' +
        'Необходимо минимум 3 сыгранные игры.',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 Назад к статистике', callback_data: 'refresh_stats' }],
              [{ text: '❎ Закрыть', callback_data: 'close_menu' }],
            ],
          },
        }
      );
      await ctx.answerCbQuery();
      return;
    }

    let message = `🏆 <b>Топ игроков по TrueSkill</b>\n\n`;

    topPlayers.forEach((playerStat, index) => {
      const escapedName = escapeHtml(playerStat.player.firstName);
      const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
      
      message += `${medal} ${escapedName}\n`;
      message += `   🧮 ${playerStat.tsRating.toFixed(1)} | `;
      message += `🎮 ${playerStat.gamesPlayed} игр | `;
      message += `📈 ${playerStat.winRate.toFixed(1)}%\n\n`;
    });

    message += `\n💡 <i>Рейтинг учитывает игроков с минимум 3 играми</i>`;

    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Назад к статистике', callback_data: 'refresh_stats' }],
          [{ text: '❎ Закрыть', callback_data: 'close_menu' }],
        ],
      },
    });
    await ctx.answerCbQuery();

  } catch (error) {
    console.error('Error in top players command:', error);
    await ctx.answerCbQuery('Произошла ошибка при получении топа игроков', { show_alert: true });
  }
};