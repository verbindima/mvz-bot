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
  // Player pair chemistry system
  SYNERGY_ENABLED: boolean;
  SYNERGY_WEIGHT_SAME: number;
  SYNERGY_WEIGHT_VS: number;
  PAIR_CAP: number;
  PAIR_MIN_SAME_GAMES: number;
  PAIR_MIN_VS_GAMES: number;
  PAIR_GAMES_FOR_CONF: number;
  PAIR_DECAY_HALF_LIFE_WEEKS: number;
  PAIR_DECAY_FACTOR: number;
  PAIR_SCALE_SAME: number;
  PAIR_SCALE_VS: number;
  MAX_BASE_DIFF: number;
  // TRI mode configuration
  TRI_MODE_ENABLED: boolean;
  TRI_MINI_MATCH_WEIGHT: number;
  TRI_BULK_PARSE_MAX_LINES: number;
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
      // Player pair chemistry system
      SYNERGY_ENABLED: process.env.SYNERGY_ENABLED !== 'false',
      SYNERGY_WEIGHT_SAME: parseFloat(process.env.SYNERGY_WEIGHT_SAME || '0.6'),
      SYNERGY_WEIGHT_VS: parseFloat(process.env.SYNERGY_WEIGHT_VS || '0.4'),
      PAIR_CAP: parseFloat(process.env.PAIR_CAP || '0.8'),
      PAIR_MIN_SAME_GAMES: parseInt(process.env.PAIR_MIN_SAME_GAMES || '3'),
      PAIR_MIN_VS_GAMES: parseInt(process.env.PAIR_MIN_VS_GAMES || '3'),
      PAIR_GAMES_FOR_CONF: parseInt(process.env.PAIR_GAMES_FOR_CONF || '8'),
      PAIR_DECAY_HALF_LIFE_WEEKS: parseInt(process.env.PAIR_DECAY_HALF_LIFE_WEEKS || '8'),
      PAIR_DECAY_FACTOR: parseFloat(process.env.PAIR_DECAY_FACTOR || '0.9'),
      PAIR_SCALE_SAME: parseFloat(process.env.PAIR_SCALE_SAME || '2.0'),
      PAIR_SCALE_VS: parseFloat(process.env.PAIR_SCALE_VS || '2.0'),
      MAX_BASE_DIFF: parseFloat(process.env.MAX_BASE_DIFF || '2.0'),
      // TRI mode configuration
      TRI_MODE_ENABLED: process.env.TRI_MODE_ENABLED !== 'false',
      TRI_MINI_MATCH_WEIGHT: parseFloat(process.env.TRI_MINI_MATCH_WEIGHT || '0.5'),
      TRI_BULK_PARSE_MAX_LINES: parseInt(process.env.TRI_BULK_PARSE_MAX_LINES || '100'),
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
  ADMIN_TEAMS: (synergyEnabled: boolean) => [
    [{ text: '✅ Принять', callback_data: 'confirm_teams' }],
    [{ text: '♻️ Пересчитать', callback_data: 'regenerate_teams' }],
    [{ text: synergyEnabled ? '🧪 Химия: Вкл' : '⚗️ Химия: Выкл', callback_data: 'toggle_synergy' }],
    [{ text: '✏️ Ручная правка', callback_data: 'edit_teams' }],
    [{ text: '❎ Закрыть', callback_data: 'close_admin_menu' }],
  ],
};