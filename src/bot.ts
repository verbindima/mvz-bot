import 'reflect-metadata';
import { Telegraf, Context } from 'telegraf';
import { container } from 'tsyringe';
import { CONFIG, MESSAGES } from './config';
import { logger } from './utils/logger';
import { connectDatabase, disconnectDatabase } from './utils/database';
import { PlayerService } from './services/player.service';
import { GameService } from './services/game.service';
import { AIService } from './services/ai.service';
import { startCommand } from './commands/start';
import { joinCommand, leaveCommand } from './commands/game';
import { teamsCommand } from './commands/teams';
import { rateCommand, schemeCommand, resultCommand, finishGameCommand } from './commands/rating';
import { mvpCommand } from './commands/mvp';
import { playersCommand, exportCommand, migrateTriHistoryCommand } from './commands/admin';
import { statsCommand, topPlayersCommand } from './commands/stats';
import { helpCommand } from './commands/help';
import { add16Command, clearAndAdd16Command, resetWeekCommand, addPlayerCommand } from './commands/bulk';
import { registerPlayerCommand, bulkRegisterCommand, editPlayerCommand, linkPlayerCommand } from './commands/register';
import { addHistoryCommand, bulkRateCommand } from './commands/history';
import { aiCommand } from './commands/ai';
import { removeFromGameCommand } from './commands/remove';
import { infoCommand } from './commands/info';
import { ratingInfoCommand } from './commands/rating_info';
import { trueskillDetailsCommand } from './commands/trueskill_details';
import { ratingSettingsCommand } from './commands/rating_settings';
import { initWeekCommand } from './commands/init_week';
import { paymentInfoCommand } from './commands/payment_info';
import { confirmPlayerPaymentCommand, paymentStatusCommand } from './commands/admin_payment';
import { editTeamsCommand, movePlayerCommand, recalculateBalanceCommand } from './commands/edit_teams';
import { migratePairsCommand } from './commands/migrate_pairs';
import { triInitCommand, triConfirmCommand, triCancelCommand, triResultsCommand, triBulkAddCommand, triEditCommand, triMvpCommand, triStatusCommand, handleTriMove, executeTriPlayerMove, handleTriAutoBalance, handleTriRecalculate, refreshTriEditInterface } from './commands/tri';

export interface BotContext extends Context {
  playerService: PlayerService;
  gameService: GameService;
  aiService: AIService;
}

const bot = new Telegraf<BotContext>(CONFIG.BOT_TOKEN);

bot.use(async (ctx, next) => {
  ctx.playerService = container.resolve(PlayerService);
  ctx.gameService = container.resolve(GameService);
  ctx.aiService = container.resolve(AIService);
  await next();
});

bot.command('start', startCommand);
bot.command('join', joinCommand);
bot.command('leave', leaveCommand);
bot.command('teams', teamsCommand);
bot.command('rate', rateCommand);
bot.command('scheme', schemeCommand);
bot.command('result', resultCommand);
bot.command('mvp', mvpCommand);
bot.command('finish_game', finishGameCommand);
bot.command('players', playersCommand);
bot.command('export', exportCommand);
bot.command('stats', statsCommand);
bot.command('help', helpCommand);
bot.command('add16', add16Command);
bot.command('clear_and_add16', clearAndAdd16Command);
bot.command('reset_week', resetWeekCommand);
bot.command('add', addPlayerCommand);
bot.command('register', registerPlayerCommand);
bot.command('bulk_register', bulkRegisterCommand);
bot.command('edit_player', editPlayerCommand);
bot.command('link_player', linkPlayerCommand);
bot.command('add_history', addHistoryCommand);
bot.command('bulk_rate', bulkRateCommand);
bot.command('ai', aiCommand);
bot.command('remove_from_game', removeFromGameCommand);
bot.command('info', infoCommand);
bot.command('rating_info', ratingInfoCommand);
bot.command('init_week', initWeekCommand);
bot.command('payment_info', paymentInfoCommand);
bot.command('confirm_player_payment', confirmPlayerPaymentCommand);
bot.command('payment_status', paymentStatusCommand);
bot.command('migrate_pairs', migratePairsCommand);
bot.command('tri_init', triInitCommand);
bot.command('tri_confirm', triConfirmCommand);
bot.command('tri_cancel', triCancelCommand);
bot.command('tri_results', triResultsCommand);
bot.command('tri_bulk_add', triBulkAddCommand);
bot.command('tri_edit', triEditCommand);
bot.command('tri_mvp', triMvpCommand);
bot.command('tri_status', triStatusCommand);
bot.command('migrate_tri_history', migrateTriHistoryCommand);


bot.action('join', async (ctx) => {
  await ctx.answerCbQuery('⚠️ Запись на игру временно недоступна через эту кнопку.\n\nИспользуйте команду /join или кнопки в других разделах.', { show_alert: true });
});

bot.action('leave', async (ctx) => {
  await ctx.answerCbQuery('⚠️ Отмена записи временно недоступна через эту кнопку.\n\nИспользуйте команду /leave или кнопки в других разделах.', { show_alert: true });
});

bot.action('confirm_teams', async (ctx) => {
  if (!CONFIG.ADMINS.includes(ctx.from.id)) {
    await ctx.answerCbQuery(MESSAGES.ACCESS_DENIED);
    return;
  }

  await ctx.gameService.confirmTeams();
  await ctx.editMessageText(MESSAGES.TEAMS_CONFIRMED);
  await ctx.answerCbQuery();
});

bot.action('regenerate_teams', async (ctx) => {
  if (!CONFIG.ADMINS.includes(ctx.from.id)) {
    await ctx.answerCbQuery(MESSAGES.ACCESS_DENIED);
    return;
  }

  await teamsCommand(ctx);
});

bot.action('toggle_synergy', async (ctx) => {
  if (!CONFIG.ADMINS.includes(ctx.from.id)) {
    await ctx.answerCbQuery(MESSAGES.ACCESS_DENIED);
    return;
  }

  // Toggle the synergy setting
  (CONFIG as any).SYNERGY_ENABLED = !CONFIG.SYNERGY_ENABLED;

  const status = CONFIG.SYNERGY_ENABLED ? 'включена' : 'отключена';
  await ctx.answerCbQuery(`🧪 Химия команд ${status}`, { show_alert: true });

  // Regenerate teams with new setting
  await teamsCommand(ctx);
});

bot.action('edit_teams', async (ctx) => {
  if (!CONFIG.ADMINS.includes(ctx.from.id)) {
    await ctx.answerCbQuery(MESSAGES.ACCESS_DENIED);
    return;
  }

  await editTeamsCommand(ctx);
  await ctx.answerCbQuery();
});

// Обработчик для перемещения игроков между командами
bot.action(/^move_player_([AB])_(\d+)$/, async (ctx) => {
  if (!CONFIG.ADMINS.includes(ctx.from.id)) {
    await ctx.answerCbQuery(MESSAGES.ACCESS_DENIED);
    return;
  }

  const fromTeam = ctx.match[1] as 'A' | 'B';
  const playerId = parseInt(ctx.match[2]);

  await movePlayerCommand(ctx, fromTeam, playerId);
});

bot.action('recalculate_balance', async (ctx) => {
  if (!CONFIG.ADMINS.includes(ctx.from.id)) {
    await ctx.answerCbQuery(MESSAGES.ACCESS_DENIED);
    return;
  }

  await recalculateBalanceCommand(ctx);
});

bot.action('stats', async (ctx) => {
  await statsCommand(ctx);
  await ctx.answerCbQuery();
});

bot.action('refresh_info', async (ctx) => {
  await infoCommand(ctx);
  await ctx.answerCbQuery();
});

bot.action('start_registration', async (ctx) => {
  await startCommand(ctx);
  await ctx.answerCbQuery();
});

bot.action('rating_info', async (ctx) => {
  await ratingInfoCommand(ctx);
  await ctx.answerCbQuery();
});

bot.action('trueskill_details', async (ctx) => {
  await trueskillDetailsCommand(ctx);
  await ctx.answerCbQuery();
});

bot.action('rating_settings', async (ctx) => {
  await ratingSettingsCommand(ctx);
  await ctx.answerCbQuery();
});

bot.action('payment_info', async (ctx) => {
  await paymentInfoCommand(ctx);
  await ctx.answerCbQuery();
});

bot.action('refresh_stats', async (ctx) => {
  await statsCommand(ctx);
  await ctx.answerCbQuery();
});

bot.action('top_players', async (ctx) => {
  await topPlayersCommand(ctx);
});


// Универсальный обработчик закрытия меню
bot.action('close_menu', async (ctx) => {
  try {
    await ctx.deleteMessage();
    await ctx.answerCbQuery();
  } catch (error) {
    // Если не удается удалить сообщение, просто отвечаем
    await ctx.answerCbQuery('Меню закрыто');
  }
});

// Обработчик закрытия админского меню (только для админов)
bot.action('close_admin_menu', async (ctx) => {
  if (!CONFIG.ADMINS.includes(ctx.from.id)) {
    await ctx.answerCbQuery('🚫 Только админы могут закрывать админские меню');
    return;
  }

  try {
    await ctx.deleteMessage();
    await ctx.answerCbQuery();
  } catch (error) {
    await ctx.answerCbQuery('Админское меню закрыто');
  }
});

const gracefulShutdown = async () => {
  logger.info('Shutting down bot...');
  bot.stop();
  await disconnectDatabase();
  process.exit(0);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

const main = async () => {
  try {
    await connectDatabase();

    // TRI Edit обработчики кнопок
    bot.action(/^tri_move_([ABC])_([ABC])$/, async (ctx) => {
      if (!CONFIG.ADMINS.includes(ctx.from.id)) {
        await ctx.answerCbQuery('❌ Доступ запрещен');
        return;
      }
      const match = ctx.match;
      const fromTeam = match[1];
      const toTeam = match[2];
      await handleTriMove(ctx, fromTeam, toTeam);
    });

    bot.action(/^tri_move_player_([ABC])_([ABC])_(\d+)$/, async (ctx) => {
      if (!CONFIG.ADMINS.includes(ctx.from.id)) {
        await ctx.answerCbQuery('❌ Доступ запрещен');
        return;
      }
      const match = ctx.match;
      const fromTeam = match[1];
      const toTeam = match[2];
      const playerId = parseInt(match[3]);
      await executeTriPlayerMove(ctx, fromTeam, toTeam, playerId);
    });

    bot.action('tri_auto_balance', async (ctx) => {
      if (!CONFIG.ADMINS.includes(ctx.from.id)) {
        await ctx.answerCbQuery('❌ Доступ запрещен');
        return;
      }
      await handleTriAutoBalance(ctx);
    });

    bot.action('tri_regenerate', async (ctx) => {
      if (!CONFIG.ADMINS.includes(ctx.from.id)) {
        await ctx.answerCbQuery('❌ Доступ запрещен');
        return;
      }
      await handleTriRecalculate(ctx);
    });

    bot.action('tri_accept_edit', async (ctx) => {
      if (!CONFIG.ADMINS.includes(ctx.from.id)) {
        await ctx.answerCbQuery('❌ Доступ запрещен');
        return;
      }
      await ctx.answerCbQuery('✅ Составы приняты');
      await ctx.editMessageText('✅ <b>TRI составы сохранены!</b>\n\nИспользуйте /tri_confirm для окончательного подтверждения.', {
        parse_mode: 'HTML'
      });
    });

    bot.action('tri_cancel_edit', async (ctx) => {
      if (!CONFIG.ADMINS.includes(ctx.from.id)) {
        await ctx.answerCbQuery('❌ Доступ запрещен');
        return;
      }
      await ctx.answerCbQuery('❌ Редактирование отменено');
      await ctx.editMessageText('❌ Редактирование TRI составов отменено.');
    });

    bot.action('tri_edit_back', async (ctx) => {
      if (!CONFIG.ADMINS.includes(ctx.from.id)) {
        await ctx.answerCbQuery('❌ Доступ запрещен');
        return;
      }
      // Обновляем сообщение вместо создания нового
      await refreshTriEditInterface(ctx);
    });

    container.registerInstance('bot', bot);

    await bot.launch();
    logger.info(`Bot started successfully in ${CONFIG.NODE_ENV} mode`);
  } catch (error) {
    logger.error('Failed to start bot:', error);
    process.exit(1);
  }
};

if (require.main === module) {
  main();
}