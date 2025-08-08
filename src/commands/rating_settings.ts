import { BotContext } from '../bot';
import { CONFIG } from '../config';
import { safeEditOrReply } from '../utils/safe-edit';

export const ratingSettingsCommand = async (ctx: BotContext): Promise<void> => {
  try {
    let message = `📊 <b>Текущие настройки системы</b>\n\n`;

    message += `<b>⚙️ Активная схема:</b> <code>${CONFIG.SCHEME}</code>\n\n`;

    let schemeDescription = '';
    switch (CONFIG.SCHEME) {
      case 'captain':
        schemeDescription = 'Оценка капитанов и админов';
        break;
      case 'ts':
        schemeDescription = 'TrueSkill - автоматическая адаптация';
        break;
    }

    message += `<b>📋 Описание:</b> ${schemeDescription}\n\n`;

    message += `<b>🎯 Параметры балансировки:</b>\n`;
    message += `• Максимальная разница: <b>1.5 балла</b>\n`;
    message += `• Алгоритм: Snake Draft + стохастическая оптимизация\n`;
    message += `• Максимум итераций: 500\n\n`;

    message += `<b>👥 Формат игры:</b>\n`;
    message += `• Игроков в команде: 8\n`;
    message += `• Всего игроков: 16\n`;
    message += `• Формат: 8×8\n\n`;

    if (CONFIG.ADMINS.includes(ctx.from!.id)) {
      message += `<b>🔧 Админские команды:</b>\n`;
      message += `• <code>/scheme captain</code> - переключить на оценки капитанов\n`;
      message += `• <code>/scheme ts</code> - переключить на TrueSkill\n`;
      message += `• <code>/result A 5-3 B</code> - внести результат (только TrueSkill)`;
    } else {
      message += `<b>💡 Информация:</b>\n`;
      message += `Схему рейтинга могут изменять только администраторы.`;
    }

    await safeEditOrReply(ctx, message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📋 Подробнее про TrueSkill', callback_data: 'trueskill_details' }],
          [{ text: '🔙 К описанию системы', callback_data: 'rating_info' }],
          [{ text: '🏠 Вернуться к игре', callback_data: 'refresh_info' }],
          [{ text: '❎ Закрыть', callback_data: 'close_menu' }],
        ],
      },
    });

  } catch (error) {
    console.error('Error in rating settings command:', error);
    await ctx.reply('Произошла ошибка при показе настроек системы.');
  }
};