import { config } from 'dotenv';

config();

interface Config {
  BOT_TOKEN: string;
  ADMINS: number[];
  REMINDER_HOURS: number;
  DATABASE_URL: string;
  SCHEME: 'ts';
  PORT: number;
  NODE_ENV: string;
  GEMINI_API_KEY: string;
  // TrueSkill improvements
  RATING_IDLE_ENABLED: boolean;
  RATING_IDLE_LAMBDA: number;
  RATING_IDLE_PERIOD_DAYS: number;
  RATING_SIGMA0: number;
  RATING_SIGMA_FLOOR: number;
  RATING_MVP_ENABLED: boolean;
  RATING_MVP_MU_BONUS: number;
  RATING_MVP_SIGMA_MULT: number;
}

class ConfigManager {
  private _config: Config;

  constructor() {
    this._config = {
      BOT_TOKEN: process.env.BOT_TOKEN || '',
      ADMINS: process.env.ADMINS?.split(',').map(id => parseInt(id)) || [],
      REMINDER_HOURS: parseInt(process.env.REMINDER_HOURS || '3'),
      DATABASE_URL: process.env.DATABASE_URL || 'file:./data/database.db',
      SCHEME: 'ts',
      PORT: parseInt(process.env.PORT || '3000'),
      NODE_ENV: process.env.NODE_ENV || 'development',
      GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
      // TrueSkill improvements
      RATING_IDLE_ENABLED: process.env.RATING_IDLE_ENABLED !== 'false',
      RATING_IDLE_LAMBDA: parseFloat(process.env.RATING_IDLE_LAMBDA || '0.35'),
      RATING_IDLE_PERIOD_DAYS: parseInt(process.env.RATING_IDLE_PERIOD_DAYS || '7'),
      RATING_SIGMA0: parseFloat(process.env.RATING_SIGMA0 || '8.333'),
      RATING_SIGMA_FLOOR: parseFloat(process.env.RATING_SIGMA_FLOOR || '1.0'),
      RATING_MVP_ENABLED: process.env.RATING_MVP_ENABLED !== 'false',
      RATING_MVP_MU_BONUS: parseFloat(process.env.RATING_MVP_MU_BONUS || '0.6'),
      RATING_MVP_SIGMA_MULT: parseFloat(process.env.RATING_MVP_SIGMA_MULT || '1.0'),
    };
  }

  get CONFIG(): Config {
    return this._config;
  }
}

const configManager = new ConfigManager();
export const CONFIG = configManager.CONFIG;

export const MESSAGES = {
  ALREADY_REGISTERED: '✅ Вы уже зарегистрированы!',
  REGISTRATION_COMPLETE: '🎉 Регистрация завершена!\n\n💡 <b>Что дальше?</b>\nТеперь вы можете записаться на следующую игру, нажав кнопку "⚽ Я играю" или используя команду /info для просмотра текущего состава.',
  JOINED_GAME: '✅ <b>Вы записались на игру!</b>\n\nПозиция в основном составе: <b>#{position}</b>\n\n💡 Используйте /info для просмотра полного состава',
  JOINED_WAITLIST: '⏳ <b>Вы добавлены в список ожидания!</b>\n\nПозиция в очереди: <b>#{position}</b>\n\n💡 Как только освободится место в основном составе, вы автоматически переместитесь туда',
  LEFT_GAME: '❌ <b>Вы удалены из игры</b>\n\n💡 Чтобы записаться снова, используйте /info или нажмите "⚽ Я играю"',
  NOT_IN_GAME: '⚠️ <b>Вы не записаны на игру</b>\n\n💡 Используйте /info для записи или просмотра текущего состава',
  GAME_FULL: '⚽ Основной состав полный (16/16)',
  TEAMS_GENERATED: '⚽ Команды сформированы:\n\n{teams}\n\nВероятность победы команды A: {probability}%',
  ACCESS_DENIED: '🚫 У вас нет доступа к этой команде',
  TEAMS_CONFIRMED: '✅ Команды подтверждены и опубликованы!',
};

export const KEYBOARDS = {
  MAIN_MENU: [
    [{ text: '📊 Статистика', callback_data: 'stats' }, { text: '📋 Информация', callback_data: 'refresh_info' }],
    [{ text: '❎ Закрыть', callback_data: 'close_menu' }],
  ],
  ADMIN_TEAMS: [
    [{ text: '✅ Принять', callback_data: 'confirm_teams' }],
    [{ text: '♻️ Пересчитать', callback_data: 'regenerate_teams' }],
    [{ text: '✏️ Ручная правка', callback_data: 'edit_teams' }],
    [{ text: '❎ Закрыть', callback_data: 'close_admin_menu' }],
  ],
};