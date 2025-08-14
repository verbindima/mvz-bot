import { BotContext } from '../bot';
import { CONFIG } from '../config';
import { safeEditOrReply } from '../utils/safe-edit';

export const ratingSettingsCommand = async (ctx: BotContext): Promise<void> => {
  try {
    let message = `📊 <b>Текущие настройки системы</b>\n\n`;

    message += `<b>⚙️ Схема рейтинга:</b> <code>${CONFIG.SCHEME}</code>\n\n`;

    const schemeDescription = 'TrueSkill - автоматическая адаптация';

    message += `<b>📋 Описание:</b> ${schemeDescription}\n\n`;

    message += `<b>🎯 Параметры балансировки:</b>\n`;
    message += `• Максимальная разница: <b>1.5 балла</b>\n`;
    message += `• Алгоритм: Snake Draft + стохастическая оптимизация\n`;
    message += `• Максимум итераций: 500\n\n`;

    message += `<b>⏰ Инфляция неактивности:</b>\n`;
    message += `• Включено: <b>${CONFIG.RATING_IDLE_ENABLED ? 'Да' : 'Нет'}</b>\n`;
    message += `• Скорость роста σ: <b>${CONFIG.RATING_IDLE_LAMBDA}/неделю</b>\n`;
    message += `• Период: <b>${CONFIG.RATING_IDLE_PERIOD_DAYS} дней</b>\n`;
    message += `• Максимум σ: <b>${CONFIG.RATING_SIGMA0}</b>\n\n`;

    message += `<b>⭐ MVP система:</b>\n`;
    message += `• Включено: <b>${CONFIG.RATING_MVP_ENABLED ? 'Да' : 'Нет'}</b>\n`;
    message += `• Бонус к μ: <b>+${CONFIG.RATING_MVP_MU_BONUS}</b>\n`;
    message += `• Максимум MVP за матч: <b>2 (по 1 на команду)</b>\n\n`;

    message += `<b>👥 Формат игры:</b>\n`;
    message += `• Игроков в команде: 8\n`;
    message += `• Всего игроков: 16\n`;
    message += `• Формат: 8×8\n\n`;

    if (CONFIG.ADMINS.includes(ctx.from!.id)) {
      message += `<b>🔧 Админские команды:</b>\n`;
      message += `• <code>/result A 5-3 B</code> - внести результат матча\n`;
      message += `• <code>/mvp @username1 [@username2]</code> - назначить MVP`;
    } else {
      message += `<b>💡 Информация:</b>\n`;
      message += `Схема рейтинга фиксирована и не может быть изменена.`;
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