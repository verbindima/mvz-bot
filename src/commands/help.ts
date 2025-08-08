import { BotContext } from '../bot';
import { CONFIG } from '../config';
import { isPrivateChat } from '../utils/chat';

export const helpCommand = async (ctx: BotContext): Promise<void> => {
  try {
    const isAdmin = CONFIG.ADMINS.includes(ctx.from!.id);
    const isPrivate = isPrivateChat(ctx);
    
    let message = `🤖 <b>Справка по командам</b>\n\n`;
    
    message += `<b>📋 Основные команды:</b>\n`;
    message += `/start - Регистрация в боте\n`;
    message += `/info - Показать информацию об игре (рекомендуется)\n`;
    message += `/join - Записаться на игру\n`;
    message += `/leave - Отменить участие\n`;
    message += `/stats - Показать статистику\n`;
    message += `/rating_info - Как работает система рейтингов\n`;
    message += `/payment_info - Информация об оплате\n`;
    message += `/help - Показать эту справку\n\n`;
    
    message += `<b>🎮 Кнопки:</b>\n`;
    message += `⚽ Я играю - Записаться на игру\n`;
    message += `❌ Передумал - Отменить участие\n`;
    message += `📊 Статистика - Показать статистику игры\n`;
    message += `✅ (галочка) - Подтвердить оплату\n\n`;
    
    if (isAdmin) {
      if (isPrivate) {
        // Показываем все команды в приватном чате
        message += `<b>👑 Админские команды:</b>\n`;
        message += `/teams - Сгенерировать команды\n`;
        message += `/players - Список всех игроков\n`;
        message += `/rate @username ±1 - Обновить рейтинг\n`;
        message += `/scheme &lt;self|captain|ts&gt; - Схема рейтинга\n`;
        message += `/result A 5-3 B - Результат матча\n`;
        message += `/finish_game confirm - Завершить игру и сбросить сессию\n`;
        message += `/register username "Имя" skill - Зарегистрировать игрока\n`;
        message += `/remove_from_game username - Убрать игрока из текущей игры\n`;
        message += `/add username - Добавить одного игрока\n`;
        message += `/add16 user1 user2... - Добавить игроков по username\n`;
        message += `/reset_week - Очистить текущую неделю\n`;
        message += `/add_history - Добавить результаты прошлых матчей\n`;
        message += `/init_week - Инициализировать игру на неделю\n`;
        message += `/confirm_player_payment username - Подтвердить оплату\n`;
        message += `/payment_status - Статус оплат всех игроков\n\n`;
        message += `🔒 <i>Большинство админских команд работают только в личных сообщениях</i>\n\n`;
      } else {
        // Показываем только AI в канале
        message += `<b>👑 Админские команды (в канале):</b>\n`;
      }
      message += `/ai вопрос - Задать вопрос AI\n\n`;
    }
    
    message += `<b>📊 Схемы рейтинга:</b>\n`;
    message += `• <b>self</b> - самооценка (1-5)\n`;
    message += `• <b>ts</b> - TrueSkill система\n\n`;
    
    message += `<b>⚽ Как играть:</b>\n`;
    message += `1. Зарегистрируйтесь через /start\n`;
    message += `2. Нажмите "Я играю" или /join\n`;
    message += `3. Ждите формирования команд (16 игроков)\n`;
    message += `4. Получите уведомление о составах\n\n`;
    
    // Получаем актуальную схему рейтинга из переменной окружения
    const currentScheme = process.env.SCHEME || CONFIG.SCHEME;
    message += `Текущая схема рейтинга: <b>${currentScheme}</b>`;
    
    await ctx.reply(message, { parse_mode: 'HTML' });
  } catch (error) {
    console.error('Error in help command:', error);
    await ctx.reply('Произошла ошибка при показе справки.');
  }
};