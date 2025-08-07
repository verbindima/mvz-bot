import { BotContext } from '@/bot';
import { prisma } from '@/utils/database';
import { getCurrentWeek } from '@/utils/week';
import { CONFIG } from '@/config';

export const confirmPaymentCommand = async (ctx: BotContext): Promise<void> => {
  try {
    const player = await ctx.playerService.getPlayer(ctx.from!.id);
    
    if (!player) {
      await ctx.reply('❌ Вы не зарегистрированы в системе. Используйте /start');
      return;
    }

    const { week, year } = getCurrentWeek();

    // Проверяем, записан ли игрок на текущую неделю
    const weekEntry = await prisma.weekEntry.findFirst({
      where: {
        week,
        year,
        playerId: player.id,
      },
    });

    if (!weekEntry) {
      await ctx.reply('❌ Вы не записаны на игру. Сначала запишитесь через /info');
      return;
    }

    if (weekEntry.isPaid) {
      await ctx.reply('✅ Ваша оплата уже подтверждена администратором!');
      return;
    }

    // Отмечаем время отправки подтверждения оплаты
    await prisma.weekEntry.update({
      where: { id: weekEntry.id },
      data: { paymentTime: new Date() },
    });

    await ctx.reply(
      '✅ <b>Подтверждение получено!</b>\n\n' +
      'Ваше сообщение об оплате передано администратору.\n' +
      'Ожидайте подтверждения.',
      { parse_mode: 'HTML' }
    );

    // Уведомляем админов о новом подтверждении оплаты
    const gameSession = await prisma.gameSession.findUnique({
      where: {
        week_year: { week, year },
      },
    });

    if (gameSession?.isInitialized) {
      const adminMessage = 
        `💳 <b>Новое подтверждение оплаты</b>\n\n` +
        `👤 Игрок: ${player.firstName} (@${player.username})\n` +
        `💵 Сумма: ${gameSession.paymentAmount} ₽\n` +
        `📱 Номер: ${gameSession.paymentPhone}\n\n` +
        `Используйте /confirm_player_payment @${player.username} для подтверждения`;

      // Отправляем уведомление всем админам
      for (const adminId of CONFIG.ADMINS) {
        try {
          await ctx.telegram.sendMessage(adminId, adminMessage, { parse_mode: 'HTML' });
        } catch (error) {
          // Игнорируем ошибки отправки админам (могли заблокировать бота)
        }
      }
    }

  } catch (error) {
    console.error('Error in confirm payment command:', error);
    await ctx.reply('Произошла ошибка при подтверждении оплаты.');
  }
};