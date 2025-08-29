import { BotContext } from '../bot';
import { CONFIG } from '../config';
import { escapeHtml } from '../utils/html';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { checkAdminPrivateOnly } from '../utils/chat';
import { prisma } from '../utils/database';
import { logger } from '../utils/logger';

export const playersCommand = async (ctx: BotContext): Promise<void> => {
  try {
    if (!await checkAdminPrivateOnly(ctx)) {
      return;
    }

    const players = await ctx.playerService.getAllPlayers();
    const { main, waiting } = await ctx.gameService.getWeekPlayers();

    let message = `👥 <b>Все игроки</b> (${players.length}):\n`;
    message += `<i>TS - TrueSkill μ±σ (навык±неопределенность)</i>\n\n`;

    message += `⚽ <b>Основной состав</b> (${main.length}/16):\n`;
    main.forEach((player, index) => {
      const firstName = escapeHtml(player.firstName);
      const username = player.username ? ` @${player.username}` : '';
      const tsRating = player.tsMu.toFixed(1);
      const tsSigma = player.tsSigma.toFixed(1);
      message += `${index + 1}. ${firstName}${username} (TS: ${tsRating}±${tsSigma})\n`;
    });

    if (waiting.length > 0) {
      message += `\n⏳ <b>Лист ожидания</b> (${waiting.length}):\n`;
      waiting.forEach((player, index) => {
        const firstName = escapeHtml(player.firstName);
        const username = player.username ? ` @${player.username}` : '';
        const tsRating = player.tsMu.toFixed(1);
        const tsSigma = player.tsSigma.toFixed(1);
        message += `${index + 1}. ${firstName}${username} (TS: ${tsRating}±${tsSigma})\n`;
      });
    }

    const notInGame = players.filter(p => 
      !main.some(m => m.id === p.id) && !waiting.some(w => w.id === p.id)
    );

    if (notInGame.length > 0) {
      message += `\n📋 <b>Не в игре</b> (${notInGame.length}):\n`;
      notInGame.slice(0, 10).forEach(player => {
        const firstName = escapeHtml(player.firstName);
        const username = player.username ? ` @${player.username}` : '';
        const tsRating = player.tsMu.toFixed(1);
        const tsSigma = player.tsSigma.toFixed(1);
        message += `• ${firstName}${username} (TS: ${tsRating}±${tsSigma})\n`;
      });
      
      if (notInGame.length > 10) {
        message += `... и еще ${notInGame.length - 10} игроков\n`;
      }
    }

    await ctx.reply(message, { parse_mode: 'HTML' });
  } catch (error) {
    console.error('Error in players command:', error);
    await ctx.reply('Произошла ошибка при получении списка игроков.');
  }
};

export const exportCommand = async (ctx: BotContext): Promise<void> => {
  try {
    if (!await checkAdminPrivateOnly(ctx)) {
      return;
    }

    const players = await ctx.playerService.getAllPlayers();
    
    const csvHeader = 'ID,Telegram ID,Username,First Name,TS Mu,TS Sigma,Is Admin,Created At\n';
    const csvData = players.map(p => 
      `${p.id},${p.telegramId},${p.username || ''},${p.firstName},${p.tsMu},${p.tsSigma},${p.isAdmin},${p.createdAt.toISOString()}`
    ).join('\n');

    const csv = csvHeader + csvData;
    const filename = `players_export_${new Date().toISOString().split('T')[0]}.csv`;
    const filepath = join(process.cwd(), 'data', filename);

    writeFileSync(filepath, csv, 'utf8');

    await ctx.replyWithDocument(
      { source: filepath, filename },
      { caption: `📊 Экспорт данных игроков (${players.length} записей)` }
    );
  } catch (error) {
    console.error('Error in export command:', error);
    await ctx.reply('Произошла ошибка при экспорте данных.');
  }
};

export const statsCommand = async (ctx: BotContext): Promise<void> => {
  try {
    const { main, waiting } = await ctx.gameService.getWeekPlayers();
    const totalPlayers = await ctx.playerService.getAllPlayers();

    let message = `📊 <b>Статистика игры</b>\n\n`;
    message += `⚽ Основной состав: ${main.length}/16\n`;
    message += `⏳ Лист ожидания: ${waiting.length}\n`;
    message += `👥 Всего игроков: ${totalPlayers.length}\n\n`;

    if (main.length > 0) {
      const avgTSRating = main.reduce((sum, p) => sum + p.tsMu, 0) / main.length;
      message += `📈 Средний TrueSkill рейтинг: ${avgTSRating.toFixed(1)}\n`;
    }

    message += `🎯 Активная схема рейтинга: ${CONFIG.SCHEME}\n`;

    await ctx.reply(message, { parse_mode: 'HTML' });
  } catch (error) {
    console.error('Error in stats command:', error);
    await ctx.reply('Произошла ошибка при получении статистики.');
  }
};

export const migrateTriHistoryCommand = async (ctx: BotContext): Promise<void> => {
  try {
    if (!await checkAdminPrivateOnly(ctx)) {
      return;
    }

    await ctx.reply('🔄 Запускаю миграцию TRI истории...');

    try {
      // Находим все TRI сессии с мини-матчами, но без MatchResult
      const triSessions = await prisma.gameSession.findMany({
        where: {
          format: 'TRI',
          matchResult: null,
          triMatches: {
            some: {} // Есть хотя бы один мини-матч
          }
        },
        include: {
          triMatches: true
        }
      });

      if (triSessions.length === 0) {
        await ctx.reply('✅ Все TRI сессии уже имеют записи в истории');
        return;
      }

      let migratedCount = 0;

      for (const session of triSessions) {
        try {
          // Создаем MatchResult запись для TRI сессии
          await prisma.matchResult.create({
            data: {
              gameSessionId: session.id,
              teamAScore: 0,
              teamBScore: 0, 
              winnerTeam: 'TRI', // Специальное значение для TRI формата
              createdAt: session.createdAt
            }
          });

          migratedCount++;
        } catch (error) {
          logger.error(`Error migrating TRI session ${session.id}:`, error);
        }
      }

      await ctx.reply(
        `✅ <b>Миграция завершена!</b>\n\n` +
        `📊 Обработано: ${migratedCount}/${triSessions.length} TRI сессий\n\n` +
        `🏆 Теперь "Легендарный турнир МВЗ" отображается в статистике`,
        { parse_mode: 'HTML' }
      );

    } catch (error) {
      logger.error('Migration error:', error);
      await ctx.reply('❌ Ошибка при миграции TRI истории. Проверьте логи.');
    }

  } catch (error) {
    logger.error('Error in migrate_tri_history command:', error);
    await ctx.reply('❌ Произошла ошибка при выполнении команды.');
  }
};