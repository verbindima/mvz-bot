import { BotContext } from '../bot';
import { CONFIG } from '../config';
import { safeEditOrReply } from '../utils/safe-edit';

export const trueskillDetailsCommand = async (ctx: BotContext): Promise<void> => {
  try {
    let message = `🧠 <b>TrueSkill - умная система рейтингов</b>\n\n`;

    message += `<b>📝 Как это работает:</b>\n`;
    message += `• Каждый игрок имеет два параметра:\n`;
    message += `  - Мю (средний навык): начальное значение 25\n`;
    message += `  - Сигма (неопределенность): начальное значение 8.33\n\n`;

    message += `<b>🎮 После каждого матча:</b>\n`;
    message += `• Победители: рейтинг увеличивается\n`;
    message += `• Проигравшие: рейтинг уменьшается\n`;
    message += `• Сигма уменьшается у всех (система "уверенности")\n\n`;

    message += `<b>🔄 Адаптация:</b>\n`;
    message += `• Чем больше игр - тем точнее рейтинг\n`;
    message += `• Новички получают большие изменения рейтинга\n`;
    message += `• Опытные игроки - малые изменения\n\n`;

    message += `<b>⚖️ Вероятность победы:</b>\n`;
    message += `Система рассчитывает шансы каждой команды на победу на основе TrueSkill рейтингов всех игроков.\n\n`;

    message += `<b>🆕 Новые возможности:</b>\n`;
    message += `⏰ <b>Инфляция неактивности:</b>\n`;
    message += `• Если игрок не играет несколько недель, его σ увеличивается\n`;
    message += `• Это означает, что система менее уверена в его навыке\n`;
    message += `• Новички не затрагиваются\n\n`;
    
    message += `⭐ <b>MVP система:</b>\n`;
    message += `• До 2 MVP за матч (по 1 из каждой команды)\n`;
    message += `• MVP получает бонус +${CONFIG.RATING_MVP_MU_BONUS} к μ\n`;
    message += `• Назначается админом командой /mvp\n\n`;

    message += `<b>📊 Преимущества:</b>\n`;
    message += `• Автоматическое обновление\n`;
    message += `• Учет неопределенности и времени\n`;
    message += `• Поощрение лучших игроков\n`;
    message += `• Справедливые команды\n`;
    message += `• Растет точность со временем`;

    await safeEditOrReply(ctx, message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📊 Текущие настройки', callback_data: 'rating_settings' }],
          [{ text: '🔙 К описанию системы', callback_data: 'rating_info' }],
          [{ text: '🏠 Вернуться к игре', callback_data: 'refresh_info' }],
          [{ text: '❎ Закрыть', callback_data: 'close_menu' }],
        ],
      },
    });

  } catch (error) {
    console.error('Error in trueskill details command:', error);
    await ctx.reply('Произошла ошибка при показе детальной информации.');
  }
};