import { container } from 'tsyringe';
import { BotContext } from '../bot';
import { StatisticsService } from '../services/statistics.service';
import { PairService } from '../services/pair.service';
import { escapeHtml } from '../utils/html';
import { safeEditOrReply } from '../utils/safe-edit';
import { CONFIG } from '../config';

const generateStatsMessage = async (ctx: BotContext, telegramId: number) => {
  const statisticsService = container.resolve(StatisticsService);
  const stats = await statisticsService.getPlayerStatistics(telegramId);

  if (!stats) {
    return {
      message: '❌ Статистика не найдена. Возможно, вы не зарегистрированы в системе.',
      keyboard: [
        [{ text: '🔙 К информации', callback_data: 'refresh_info' }, { text: '❎ Закрыть', callback_data: 'close_menu' }],
      ],
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

  if (stats.mvpCount > 0) {
    message += `⭐ <b>MVP:</b> ${stats.mvpCount}\n`;
  }

  if (stats.gamesPlayed > 0) {
    message += `📈 <b>Процент побед:</b> ${stats.winRate.toFixed(1)}%\n`;
    if (stats.mvpCount > 0) {
      message += `🌟 <b>Процент MVP:</b> ${stats.mvpRate.toFixed(1)}%\n`;
    }
    message += `\n`;
  } else {
    message += `\n`;
  }

  // Рейтинги
  message += `🧮 <b>TrueSkill:</b> ${stats.currentTSRating}\n\n`;

  // TRI статистика (если есть)
  if (stats.triStats && stats.triStats.triGamesPlayed > 0) {
    message += `🏆 <b>Легендарный турнир МВЗ:</b>\n`;
    message += `🎮 <b>Турниров:</b> ${stats.triStats.triGamesPlayed}\n`;
    message += `🔥 <b>Мини-матчи:</b> ${stats.triStats.miniMatchesWon}/${stats.triStats.miniMatchesPlayed}`;
    
    if (stats.triStats.miniMatchesDrawn > 0) {
      message += ` (+${stats.triStats.miniMatchesDrawn} ничьих)`;
    }
    
    if (stats.triStats.miniMatchesPlayed > 0) {
      const triWinRate = (stats.triStats.miniMatchesWon / stats.triStats.miniMatchesPlayed) * 100;
      message += `\n📊 <b>Процент побед в мини:</b> ${triWinRate.toFixed(1)}%\n`;
    }

    // Последние TRI игры
    if (stats.triStats.recentTriMatches.length > 0) {
      message += `\n📚 <b>Последние турниры:</b>\n`;
      stats.triStats.recentTriMatches.forEach((game) => {
        const date = game.date.toLocaleDateString('ru-RU', {
          day: '2-digit',
          month: '2-digit',
        });
        const winRate = game.matchesInGame > 0 ? (game.wonMatches / game.matchesInGame * 100).toFixed(0) : '0';
        message += `⚽ ${date} - ${game.wonMatches}/${game.matchesInGame} (${winRate}%)\n`;
      });
    }
    message += `\n`;
  }

  // История последних игр (обычный режим)
  if (stats.ratingHistory.length > 0) {
    message += `📚 <b>Последние игры (2×8):</b>\n`;
    stats.ratingHistory.slice(0, 5).forEach((game, index) => {
      const date = game.date.toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
      });
      const deltaSymbol = game.delta > 0 ? '📈' : game.delta < 0 ? '📉' : '➡️';
      message += `${deltaSymbol} ${date} vs ${game.opponent}\n`;
    });
  }

  // Pair statistics (if enabled and player has games)
  if (CONFIG.SYNERGY_ENABLED && stats.gamesPlayed > 0) {
    try {
      const pairService = container.resolve(PairService);
      const pairStats = await pairService.getPlayerPairStats(stats.player.id);
      
      if (pairStats) {
        if (pairStats.bestSynergies.length > 0) {
          message += `\n🤝 <b>Лучшие связки:</b>\n`;
          pairStats.bestSynergies.forEach((synergy) => {
            const escapedPartner = escapeHtml(synergy.partnerName);
            message += `   • ${escapedPartner} (${synergy.togetherGames} игр, ${(synergy.winRate * 100).toFixed(1)}%)\n`;
          });
        }
        
        if (pairStats.worstCounters.length > 0) {
          message += `\n🎯 <b>Сложные противники:</b>\n`;
          pairStats.worstCounters.forEach((counter) => {
            const escapedOpponent = escapeHtml(counter.opponentName);
            message += `   • ${escapedOpponent} (${counter.vsGames} игр, ${(counter.winRate * 100).toFixed(1)}%)\n`;
          });
        }
      }
    } catch (error) {
      // Ignore pair stats errors - they're not critical
      console.warn('Failed to load pair statistics:', error);
    }
  }

  if (stats.gamesPlayed === 0) {
    message += `\n🎯 <b>Сыграйте несколько игр, чтобы увидеть подробную статистику!</b>`;
  }

  const keyboard = [
    [{ text: '🏆 Топ игроков', callback_data: 'top_players' }],
    [{ text: '🔙 К информации', callback_data: 'refresh_info' }],
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

    const { message, keyboard } = await generateStatsMessage(ctx, ctx.from!.id);

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
      const emptyMessage = '📊 <b>Топ игроков</b>\n\n' +
        '❌ Пока нет игроков с достаточным количеством игр для составления рейтинга.\n\n' +
        'Необходимо минимум 3 сыгранные игры.\n\n' +
        `🕐 <i>Обновлено: ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</i>`;
      
      try {
        await ctx.editMessageText(emptyMessage, {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 Назад к статистике', callback_data: 'refresh_stats' }],
              [{ text: '❎ Закрыть', callback_data: 'close_menu' }],
            ],
          },
        });
      } catch (editError: any) {
        // Игнорируем ошибку "message is not modified"
        if (!editError.description?.includes('message is not modified')) {
          throw editError;
        }
      }
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

    message += `\n💡 <i>Рейтинг учитывает игроков с минимум 3 играми</i>\n`;
    message += `🕐 <i>Обновлено: ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</i>`;

    try {
      await ctx.editMessageText(message, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔙 Назад к статистике', callback_data: 'refresh_stats' }],
            [{ text: '❎ Закрыть', callback_data: 'close_menu' }],
          ],
        },
      });
    } catch (editError: any) {
      // Игнорируем ошибку "message is not modified"
      if (!editError.description?.includes('message is not modified')) {
        throw editError;
      }
    }
    await ctx.answerCbQuery();

  } catch (error) {
    console.error('Error in top players command:', error);
    await ctx.answerCbQuery('Произошла ошибка при получении топа игроков', { show_alert: true });
  }
};