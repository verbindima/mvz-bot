import { BotContext } from '@/bot';
import { CONFIG } from '@/config';
import { safeEditOrReply } from '@/utils/safe-edit';

export const ratingInfoCommand = async (ctx: BotContext): Promise<void> => {
  try {
    // Разбиваем на две части из-за ограничения длины сообщения
    let message1 = `📊 <b>Система рейтингов и балансировки команд</b>\n\n`;

    message1 += `<b>🎯 Главная цель:</b>\n`;
    message1 += `Создать максимально честные команды из 16 игроков (8 на 8), где разница в силе команд не превышает 1.5 балла.\n\n`;

    message1 += `<b>⚖️ Как работает балансировка:</b>\n\n`;

    message1 += `<b>1. Snake Draft:</b>\n`;
    message1 += `• Игроки сортируются по рейтингу\n`;
    message1 += `• Распределение: 1→A, 2→B, 3→B, 4→A...\n`;
    message1 += `• Равное распределение сильных игроков\n\n`;

    message1 += `<b>2. Стохастическая оптимизация:</b>\n`;
    message1 += `• До 500 случайных обменов между командами\n`;
    message1 += `• Каждый обмен проверяется на улучшение баланса\n`;
    message1 += `• Процесс продолжается пока разница не станет меньше 1.5 балла\n\n`;

    message1 += `<b>📈 Две схемы рейтинга:</b>\n\n`;

    message1 += `<b>🔰 Self:</b> Рейтинг 1-5, самооценка\n`;
    message1 += `<b>🧠 TrueSkill:</b> Автоматическая адаптация по результатам`;

    await safeEditOrReply(ctx, message1, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📋 Подробнее про TrueSkill', callback_data: 'trueskill_details' }],
          [{ text: '📊 Текущие настройки', callback_data: 'rating_settings' }],
          [{ text: '🔙 Вернуться к игре', callback_data: 'refresh_info' }],
          [{ text: '❎ Закрыть', callback_data: 'close_menu' }],
        ],
      },
    });

  } catch (error) {
    console.error('Error in rating info command:', error);
    await ctx.reply('Произошла ошибка при показе информации о рейтингах.');
  }
};