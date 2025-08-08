import { BotContext } from '../bot';
import { CONFIG } from '../config';
import { prisma } from '../utils/database';
import { getCurrentWeek } from '../utils/week';

export const initWeekCommand = async (ctx: BotContext): Promise<void> => {
  try {
    if (!CONFIG.ADMINS.includes(ctx.from!.id)) {
      await ctx.reply('🚫 У вас нет доступа к этой команде');
      return;
    }

    const text = ('text' in ctx.message! && ctx.message.text) ? ctx.message.text : '';
    const args = text.split('\n');
    
    if (args.length < 2) {
      await ctx.reply(
        `🏁 <b>Инициализация игры на неделю</b>\n\n` +
        `<b>Использование:</b>\n` +
        `/init_week\n` +
        `телефон банк сумма\n` +
        `дата время\n` +
        `адрес\n\n` +
        `<b>Пример:</b>\n` +
        `/init_week\n` +
        `+7900123456 Сбер 1500\n` +
        `10.08.2025 10:00\n` +
        `ул. Спортивная, 10, Спорткомплекс "Арена"`
      , { parse_mode: 'HTML' });
      return;
    }

    // Парсим аргументы
    const paymentLine = args[1]?.trim();
    const dateLine = args[2]?.trim();
    const locationLine = args[3]?.trim();
    
    if (!paymentLine || !dateLine || !locationLine) {
      await ctx.reply('❌ Неверный формат. Проверьте все строки.');
      return;
    }

    // Парсим платежные данные
    const paymentParts = paymentLine.split(' ');
    if (paymentParts.length < 3) {
      await ctx.reply('❌ Неверный формат платежных данных. Нужно: телефон банк сумма');
      return;
    }

    const paymentPhone = paymentParts[0];
    const paymentBank = paymentParts[1];
    const paymentAmount = parseFloat(paymentParts[2]);

    if (isNaN(paymentAmount)) {
      await ctx.reply('❌ Сумма должна быть числом');
      return;
    }

    // Парсим дату и время в формате ДД.ММ.ГГГГ ЧЧ:ММ
    const dateTimeRegex = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{1,2}):(\d{2})$/;
    const dateMatch = dateLine.match(dateTimeRegex);
    
    if (!dateMatch) {
      await ctx.reply('❌ Неверный формат даты. Используйте: ДД.ММ.ГГГГ ЧЧ:ММ');
      return;
    }
    
    const [, day, month, yearStr, hour, minute] = dateMatch;
    const gameDate = new Date(
      parseInt(yearStr),
      parseInt(month) - 1, // месяцы начинаются с 0
      parseInt(day),
      parseInt(hour),
      parseInt(minute)
    );
    
    if (isNaN(gameDate.getTime())) {
      await ctx.reply('❌ Некорректная дата. Проверьте правильность введенных значений.');
      return;
    }

    const { week, year } = getCurrentWeek();

    // Создаем или обновляем игровую сессию
    const gameSession = await prisma.gameSession.upsert({
      where: {
        week_year: { week, year },
      },
      update: {
        isInitialized: true,
        paymentPhone,
        paymentBank,
        paymentAmount,
        gameDate,
        gameLocation: locationLine,
      },
      create: {
        week,
        year,
        teamA: '',
        teamB: '',
        isConfirmed: false,
        isInitialized: true,
        paymentPhone,
        paymentBank,
        paymentAmount,
        gameDate,
        gameLocation: locationLine,
      },
    });

    // Очищаем записи предыдущей недели (если есть)
    await prisma.weekEntry.deleteMany({
      where: { 
        week, 
        year,
      },
    });

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

    let message = `🏁 <b>Игра инициализирована!</b>\n\n`;
    message += `📅 <b>Когда:</b> ${formatDate(gameDate)}\n`;
    message += `📍 <b>Где:</b> ${locationLine}\n\n`;
    message += `💳 <b>Оплата:</b>\n`;
    message += `• Телефон: <code>${paymentPhone}</code>\n`;
    message += `• Банк: ${paymentBank}\n`;
    message += `• Сумма: ${paymentAmount} ₽\n\n`;
    message += `🎯 <b>Сбор игроков открыт!</b>\n`;
    message += `Используйте /info для записи на игру.`;

    await ctx.reply(message, { 
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📢 Объявить всем', callback_data: 'announce_game' }],
          [{ text: '📋 Посмотреть состав', callback_data: 'refresh_info' }],
        ],
      },
    });

  } catch (error) {
    console.error('Error in init week command:', error);
    await ctx.reply('Произошла ошибка при инициализации недели.');
  }
};