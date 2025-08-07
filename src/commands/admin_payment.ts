import { BotContext } from '@/bot';
import { CONFIG } from '@/config';
import { prisma } from '@/utils/database';
import { getCurrentWeek } from '@/utils/week';

export const confirmPlayerPaymentCommand = async (ctx: BotContext): Promise<void> => {
  try {
    if (!CONFIG.ADMINS.includes(ctx.from!.id)) {
      await ctx.reply('🚫 У вас нет доступа к этой команде');
      return;
    }

    const text = ('text' in ctx.message! && ctx.message.text) ? ctx.message.text : '';
    const args = text.split(' ').slice(1);
    
    if (args.length !== 1) {
      await ctx.reply(
        `💳 <b>Подтверждение оплаты игрока</b>\n\n` +
        `<b>Использование:</b>\n` +
        `/confirm_player_payment @username\n\n` +
        `<b>Пример:</b>\n` +
        `/confirm_player_payment @john_doe`
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
    const weekEntry = await prisma.weekEntry.findFirst({
      where: {
        week,
        year,
        playerId: player.id,
      },
    });
    
    if (!weekEntry) {
      await ctx.reply(`❌ Игрок @${username} не записан на текущую игру`);
      return;
    }

    if (weekEntry.isPaid) {
      await ctx.reply(`✅ Оплата игрока @${username} уже подтверждена`);
      return;
    }

    // Подтверждаем оплату
    await prisma.weekEntry.update({
      where: { id: weekEntry.id },
      data: { isPaid: true },
    });

    await ctx.reply(
      `✅ <b>Оплата подтверждена!</b>\n\n` +
      `👤 Игрок: ${player.firstName} (@${username})\n` +
      `💰 Статус оплаты: подтверждена`
    , { parse_mode: 'HTML' });

    // Уведомляем игрока об подтверждении
    try {
      await ctx.telegram.sendMessage(
        Number(player.telegramId),
        `✅ <b>Ваша оплата подтверждена!</b>\n\n` +
        `Администратор подтвердил получение платежа.\n` +
        `Ваше участие в игре зафиксировано.`,
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      // Игнорируем ошибки отправки игроку
    }

  } catch (error) {
    console.error('Error in confirm player payment command:', error);
    await ctx.reply('Произошла ошибка при подтверждении оплаты.');
  }
};

export const paymentStatusCommand = async (ctx: BotContext): Promise<void> => {
  try {
    if (!CONFIG.ADMINS.includes(ctx.from!.id)) {
      await ctx.reply('🚫 У вас нет доступа к этой команде');
      return;
    }

    const { week, year } = getCurrentWeek();

    // Получаем всех игроков на текущую неделю с информацией об оплате
    const weekEntries = await prisma.weekEntry.findMany({
      where: { week, year },
      include: { player: true },
      orderBy: [
        { state: 'asc' }, // MAIN первые, потом WAIT
        { createdAt: 'asc' } // по времени записи
      ],
    });

    if (weekEntries.length === 0) {
      await ctx.reply('📋 На текущую неделю пока никто не записан');
      return;
    }

    const mainPlayers = weekEntries.filter(entry => entry.state === 'MAIN');
    const waitingPlayers = weekEntries.filter(entry => entry.state === 'WAIT');

    let message = `💳 <b>Статус оплат на эту неделю</b>\n\n`;
    
    message += `👥 <b>Основной состав (${mainPlayers.length}/16):</b>\n`;
    
    if (mainPlayers.length > 0) {
      mainPlayers.forEach((entry, i) => {
        const paymentIcon = entry.isPaid ? '✅' : (entry.paymentTime ? '⏳' : '❌');
        message += `${i + 1}. ${paymentIcon} ${entry.player.firstName}`;
        // Показываем @username только для тех, кто не оплатил
        if (entry.player.username && !entry.isPaid) {
          message += ` (@${entry.player.username})`;
        }
        if (entry.paymentTime && !entry.isPaid) {
          message += ` - ожидает подтверждения`;
        }
        message += `\n`;
      });
    } else {
      message += `<i>Пока никого нет</i>\n`;
    }
    
    if (waitingPlayers.length > 0) {
      message += `\n⏳ <b>Список ожидания (${waitingPlayers.length}):</b>\n`;
      waitingPlayers.forEach((entry, i) => {
        const paymentIcon = entry.isPaid ? '✅' : (entry.paymentTime ? '⏳' : '❌');
        message += `${i + 1}. ${paymentIcon} ${entry.player.firstName}`;
        // Показываем @username только для тех, кто не оплатил
        if (entry.player.username && !entry.isPaid) {
          message += ` (@${entry.player.username})`;
        }
        if (entry.paymentTime && !entry.isPaid) {
          message += ` - ожидает подтверждения`;
        }
        message += `\n`;
      });
    }

    const paidCount = weekEntries.filter(e => e.isPaid).length;
    const pendingCount = weekEntries.filter(e => e.paymentTime && !e.isPaid).length;
    
    message += `\n📊 <b>Статистика:</b>\n`;
    message += `✅ Оплачено: ${paidCount}\n`;
    message += `⏳ Ожидает подтверждения: ${pendingCount}\n`;
    message += `❌ Не оплачено: ${weekEntries.length - paidCount - pendingCount}\n\n`;
    
    message += `<b>Легенда:</b>\n`;
    message += `✅ - оплачено и подтверждено\n`;
    message += `⏳ - ожидает подтверждения админом\n`;
    message += `❌ - не оплачено`;

    await ctx.reply(message, { parse_mode: 'HTML' });

  } catch (error) {
    console.error('Error in payment status command:', error);
    await ctx.reply('Произошла ошибка при получении статуса оплат.');
  }
};