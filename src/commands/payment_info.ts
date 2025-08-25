import { BotContext } from '../bot';
import { prisma } from '../utils/database';
import { getCurrentWeek } from '../utils/week';
import { safeEditOrReply } from '../utils/safe-edit';

export const paymentInfoCommand = async (ctx: BotContext): Promise<void> => {
  try {
    const { week, year } = getCurrentWeek();

    const gameSession = await prisma.gameSession.findUnique({
      where: {
        week_year: { week, year },
      },
    });

    if (!gameSession || !gameSession.isInitialized) {
      await ctx.reply(
        '❌ <b>Игра на эту неделю не инициализирована</b>\n\n' +
        'Обратитесь к администратору для настройки игры.',
        { parse_mode: 'HTML' }
      );
      return;
    }

    const formatDate = (date: Date): string => {
      return date.toLocaleString('ru-RU', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    };

    let message = `💳 <b>Информация об оплате</b>\n\n`;

    if (gameSession.gameDate) {
      message += `📅 <b>Дата игры:</b> ${formatDate(gameSession.gameDate)}\n`;
    }

    if (gameSession.gameLocation) {
      message += `📍 <b>Место:</b> ${gameSession.gameLocation}\n\n`;
    }

    message += `💰 <b>Реквизиты для оплаты:</b>\n`;

    if (gameSession.paymentPhone) {
      message += `📱 <b>Телефон:</b> <code>${gameSession.paymentPhone}</code>\n`;
    }

    if (gameSession.paymentBank) {
      message += `🏦 <b>Банк:</b> ${gameSession.paymentBank}\n`;
    }

    if (gameSession.paymentAmount) {
      message += `💵 <b>Сумма:</b> ${gameSession.paymentAmount} ₽\n\n`;
    }

    message += `<b>📋 Как оплатить:</b>\n`;
    message += `1. Переведите указанную сумму на номер телефона\n`;
    message += `2. Сообщите админу об оплате\n\n`;

    message += `💡 <i>Админ подтвердит получение денег командой /confirm_player_payment</i>`;

    await safeEditOrReply(ctx, message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📋 Записаться на игру', callback_data: 'refresh_info' }],
          [{ text: '📊 Посмотреть состав', callback_data: 'refresh_info' }],
          [{ text: '❎ Закрыть', callback_data: 'close_menu' }],
        ],
      },
    });

  } catch (error) {
    console.error('Error in payment info command:', error);
    await ctx.reply('Произошла ошибка при получении информации об оплате.');
  }
};