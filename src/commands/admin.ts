import { BotContext } from '../bot';
import { CONFIG } from '../config';
import { escapeHtml } from '../utils/html';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { checkAdminPrivateOnly } from '../utils/chat';

export const playersCommand = async (ctx: BotContext): Promise<void> => {
  try {
    if (!await checkAdminPrivateOnly(ctx)) {
      return;
    }

    const players = await ctx.playerService.getAllPlayers();
    const { main, waiting } = await ctx.gameService.getWeekPlayers();

    let message = `👥 <b>Все игроки</b> (${players.length}):\n`;
    message += `<i>Self - самооценка (1-5), TS - TrueSkill μ±σ (навык±неопределенность)</i>\n\n`;

    message += `⚽ <b>Основной состав</b> (${main.length}/16):\n`;
    main.forEach((player, index) => {
      const firstName = escapeHtml(player.firstName);
      const username = player.username ? ` @${player.username}` : '';
      const selfRating = player.skillSelf;
      const tsRating = player.tsMu.toFixed(1);
      const tsSigma = player.tsSigma.toFixed(1);
      message += `${index + 1}. ${firstName}${username} (Self: ${selfRating}, TS: ${tsRating}±${tsSigma})\n`;
    });

    if (waiting.length > 0) {
      message += `\n⏳ <b>Лист ожидания</b> (${waiting.length}):\n`;
      waiting.forEach((player, index) => {
        const firstName = escapeHtml(player.firstName);
        const username = player.username ? ` @${player.username}` : '';
        const selfRating = player.skillSelf;
        const tsRating = player.tsMu.toFixed(1);
        const tsSigma = player.tsSigma.toFixed(1);
        message += `${index + 1}. ${firstName}${username} (Self: ${selfRating}, TS: ${tsRating}±${tsSigma})\n`;
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
        const selfRating = player.skillSelf;
        const tsRating = player.tsMu.toFixed(1);
        const tsSigma = player.tsSigma.toFixed(1);
        message += `• ${firstName}${username} (Self: ${selfRating}, TS: ${tsRating}±${tsSigma})\n`;
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
    
    const csvHeader = 'ID,Telegram ID,Username,First Name,Skill Self,TS Mu,TS Sigma,Is Admin,Created At\n';
    const csvData = players.map(p => 
      `${p.id},${p.telegramId},${p.username || ''},${p.firstName},${p.skillSelf},${p.tsMu},${p.tsSigma},${p.isAdmin},${p.createdAt.toISOString()}`
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
      const avgSkill = main.reduce((sum, p) => sum + p.skillSelf, 0) / main.length;
      message += `📈 Средний уровень игры: ${avgSkill.toFixed(1)}\n`;
    }

    message += `🎯 Активная схема рейтинга: ${CONFIG.SCHEME}\n`;

    await ctx.reply(message, { parse_mode: 'HTML' });
  } catch (error) {
    console.error('Error in stats command:', error);
    await ctx.reply('Произошла ошибка при получении статистики.');
  }
};