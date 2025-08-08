import { BotContext } from '../bot';
import { CONFIG } from '../config';
import { prisma } from '../utils/database';
import { getCurrentWeek } from '../utils/week';

export const removeFromGameCommand = async (ctx: BotContext): Promise<void> => {
  try {
    if (!CONFIG.ADMINS.includes(ctx.from!.id)) {
      await ctx.reply('🚫 У вас нет доступа к этой команде');
      return;
    }

    const text = ('text' in ctx.message! && ctx.message.text) ? ctx.message.text : '';
    const args = text.split(' ').slice(1);
    
    if (args.length !== 1) {
      await ctx.reply(
        `📋 <b>Убрать игрока из текущей игры:</b>\n\n` +
        `/remove_from_game username\n\n` +
        `<b>Пример:</b>\n` +
        `/remove_from_game john_doe`
      , { parse_mode: 'HTML' });
      return;
    }

    const username = args[0].replace('@', '');
    
    // Ищем игрока
    const player = await prisma.player.findFirst({
      where: { username }
    });
    
    if (!player) {
      await ctx.reply(`❌ Игрок @${username} не найден`);
      return;
    }
    
    const { week, year } = getCurrentWeek();
    
    // Ищем запись игрока на текущую неделю
    const entry = await prisma.weekEntry.findFirst({
      where: {
        week,
        year,
        playerId: player.id,
      },
    });
    
    if (!entry) {
      await ctx.reply(`❌ Игрок @${username} не записан на текущую игру`);
      return;
    }
    
    // Удаляем игрока из игры
    await prisma.weekEntry.delete({
      where: { id: entry.id },
    });
    
    // Если игрок был в основном составе, продвигаем первого из списка ожидания
    if (entry.state === 'MAIN') {
      const firstWaitingEntry = await prisma.weekEntry.findFirst({
        where: {
          week,
          year,
          state: 'WAIT',
        },
        orderBy: { createdAt: 'asc' },
      });

      if (firstWaitingEntry) {
        await prisma.weekEntry.update({
          where: { id: firstWaitingEntry.id },
          data: { state: 'MAIN' },
        });
        
        const promotedPlayer = await prisma.player.findUnique({
          where: { id: firstWaitingEntry.playerId }
        });
        
        await ctx.reply(
          `✅ <b>Игрок удален из игры:</b> @${username}\n\n` +
          `📈 <b>Продвинут из списка ожидания:</b> @${promotedPlayer?.username || 'неизвестный'}`
        , { parse_mode: 'HTML' });
      } else {
        await ctx.reply(`✅ <b>Игрок удален из игры:</b> @${username}`, { parse_mode: 'HTML' });
      }
    } else {
      await ctx.reply(`✅ <b>Игрок удален из списка ожидания:</b> @${username}`, { parse_mode: 'HTML' });
    }
    
  } catch (error) {
    console.error('Error in remove from game command:', error);
    await ctx.reply('Произошла ошибка при удалении игрока из игры.');
  }
};