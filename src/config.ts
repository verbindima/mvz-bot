import { config } from 'dotenv';

config();

interface Config {
  BOT_TOKEN: string;
  ADMINS: number[];
  REMINDER_HOURS: number;
  DATABASE_URL: string;
  SCHEME: 'self' | 'captain' | 'ts';
  PORT: number;
  NODE_ENV: string;
  GEMINI_API_KEY: string;
}

class ConfigManager {
  private _config: Config;

  constructor() {
    this._config = {
      BOT_TOKEN: process.env.BOT_TOKEN || '',
      ADMINS: process.env.ADMINS?.split(',').map(id => parseInt(id)) || [],
      REMINDER_HOURS: parseInt(process.env.REMINDER_HOURS || '3'),
      DATABASE_URL: process.env.DATABASE_URL || 'file:./data/database.db',
      SCHEME: (process.env.SCHEME as 'self' | 'captain' | 'ts') || 'self',
      PORT: parseInt(process.env.PORT || '3000'),
      NODE_ENV: process.env.NODE_ENV || 'development',
      GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
    };
  }

  get CONFIG(): Config {
    return this._config;
  }

  setScheme(scheme: 'self' | 'captain' | 'ts'): void {
    this._config.SCHEME = scheme;
    process.env.SCHEME = scheme;
  }
}

const configManager = new ConfigManager();
export const CONFIG = configManager.CONFIG;
export const setScheme = configManager.setScheme.bind(configManager);

export const MESSAGES = {
  WELCOME: '⚽ Добро пожаловать в бот для организации команд 8×8!\n\nВыберите ваш стартовый уровень игры (1-5):',
  ALREADY_REGISTERED: '✅ Вы уже зарегистрированы!',
  REGISTRATION_COMPLETE: '🎉 Регистрация завершена! Уровень игры: {level}\n\n💡 <b>Что дальше?</b>\nТеперь вы можете записаться на следующую игру, нажав кнопку "⚽ Я играю" или используя команду /info для просмотра текущего состава.',
  JOINED_GAME: '✅ <b>Вы записались на игру!</b>\n\nПозиция в основном составе: <b>#{position}</b>\n\n💡 Используйте /info для просмотра полного состава',
  JOINED_WAITLIST: '⏳ <b>Вы добавлены в список ожидания!</b>\n\nПозиция в очереди: <b>#{position}</b>\n\n💡 Как только освободится место в основном составе, вы автоматически переместитесь туда',
  LEFT_GAME: '❌ <b>Вы удалены из игры</b>\n\n💡 Чтобы записаться снова, используйте /info или нажмите "⚽ Я играю"',
  NOT_IN_GAME: '⚠️ <b>Вы не записаны на игру</b>\n\n💡 Используйте /info для записи или просмотра текущего состава',
  GAME_FULL: '⚽ Основной состав полный (16/16)',
  TEAMS_GENERATED: '⚽ Команды сформированы:\n\n{teams}\n\nВероятность победы команды A: {probability}%',
  ACCESS_DENIED: '🚫 У вас нет доступа к этой команде',
  TEAMS_CONFIRMED: '✅ Команды подтверждены и опубликованы!',
  INVALID_RATING: '❌ <b>Неверный формат рейтинга</b>\n\nИспользуйте: <code>/rate @username +1</code> или <code>/rate @username -1</code>\n\n💡 Доступные значения: +1, 0, -1',
  RATING_UPDATED: '✅ Рейтинг обновлен: {username} {delta}',
  PLAYER_NOT_FOUND: '❌ <b>Игрок не найден</b>\n\nВозможно, игрок еще не зарегистрировался через /start или указан неверный username',
};

export const KEYBOARDS = {
  SKILL_LEVELS: [
    [{ text: '1 - Новичок', callback_data: 'skill_1' }],
    [{ text: '2 - Любитель', callback_data: 'skill_2' }],
    [{ text: '3 - Опытный', callback_data: 'skill_3' }],
    [{ text: '4 - Продвинутый', callback_data: 'skill_4' }],
    [{ text: '5 - Профи', callback_data: 'skill_5' }],
  ],
  MAIN_MENU: [
    [{ text: '⚽ Я играю', callback_data: 'join' }],
    [{ text: '❌ Передумал', callback_data: 'leave' }],
    [{ text: '📊 Статистика', callback_data: 'stats' }],
    [{ text: '📋 Информация', callback_data: 'refresh_info' }],
    [{ text: '❎ Закрыть', callback_data: 'close_menu' }],
  ],
  REGISTRATION_COMPLETE: [
    [{ text: '⚽ Записаться на игру', callback_data: 'join' }],
    [{ text: '📋 Посмотреть состав', callback_data: 'refresh_info' }],
    [{ text: '❎ Закрыть', callback_data: 'close_menu' }],
  ],
  ADMIN_TEAMS: [
    [{ text: '✅ Принять', callback_data: 'confirm_teams' }],
    [{ text: '♻️ Пересчитать', callback_data: 'regenerate_teams' }],
    [{ text: '✏️ Ручная правка', callback_data: 'edit_teams' }],
    [{ text: '❎ Закрыть', callback_data: 'close_admin_menu' }],
  ],
};