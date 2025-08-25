import { container } from 'tsyringe';
import { BotContext } from '../bot';
import { checkAdminPrivateOnly } from '../utils/chat';
import { migrateExistingMatches } from '../scripts/migrate-existing-matches';
import { logger } from '../utils/logger';

export const migratePairsCommand = async (ctx: BotContext): Promise<void> => {
  try {
    if (!await checkAdminPrivateOnly(ctx)) {
      return;
    }

    await ctx.reply('🚀 Начинаю миграцию существующих матчей в систему химии команд...\n\nЭто может занять несколько минут.');

    try {
      await migrateExistingMatches();
      
      await ctx.reply(
        '✅ <b>Миграция завершена успешно!</b>\n\n' +
        '🧪 Система химии команд теперь учитывает все предыдущие матчи.\n' +
        '📊 Статистику парных взаимодействий можно посмотреть в /stats.\n\n' +
        '💡 Теперь генерация команд будет учитывать:\n' +
        '• Какие игроки хорошо играют вместе\n' +
        '• Кто кому обычно проигрывает в личных встречах\n' +
        '• Историю всех предыдущих матчей',
        { parse_mode: 'HTML' }
      );

      logger.info('Admin successfully ran pairs migration', { adminId: ctx.from?.id });
      
    } catch (error) {
      logger.error('Migration failed:', error);
      
      await ctx.reply(
        '❌ <b>Ошибка при миграции</b>\n\n' +
        'Произошла ошибка при обработке существующих матчей. ' +
        'Проверьте логи сервера для получения подробной информации.\n\n' +
        'Система химии команд продолжит работать для новых матчей.',
        { parse_mode: 'HTML' }
      );
    }

  } catch (error) {
    logger.error('Error in migrate pairs command:', error);
    await ctx.reply('❌ Произошла ошибка при выполнении миграции.');
  }
};