import { BotContext } from '@/bot';
import { MESSAGES, KEYBOARDS } from '@/config';

export const startCommand = async (ctx: BotContext): Promise<void> => {
  try {
    // Сначала проверяем по telegramId
    let existingPlayer = await ctx.playerService.getPlayer(ctx.from!.id);
    
    if (existingPlayer && existingPlayer.skillSelf > 0) {
      await ctx.reply(MESSAGES.ALREADY_REGISTERED, {
        reply_markup: {
          inline_keyboard: KEYBOARDS.MAIN_MENU,
        },
      });
      return;
    }

    // Если не найден по telegramId, проверяем по username (может быть зарегистрирован админом)
    if (!existingPlayer && ctx.from!.username) {
      const playerByUsername = await ctx.playerService.getPlayerByUsername(ctx.from!.username);
      
      if (playerByUsername && playerByUsername.telegramId < 0) {
        // Это игрок, зарегистрированный админом - обновляем его telegramId
        await ctx.playerService.linkPlayerToTelegram(playerByUsername.id, ctx.from!.id, ctx.from!.first_name);
        
        await ctx.reply(
          `✅ Добро пожаловать, ${playerByUsername.firstName}!\n\n` +
          `Ваш аккаунт успешно связан с Telegram.\n` +
          `Текущий уровень игры: ${playerByUsername.skillSelf}/5`,
          {
            reply_markup: {
              inline_keyboard: KEYBOARDS.MAIN_MENU,
            },
          }
        );
        return;
      }
    }

    // Если игрок не найден - создаем нового
    await ctx.playerService.getOrCreatePlayer(
      ctx.from!.id,
      ctx.from!.username,
      ctx.from!.first_name
    );

    await ctx.reply(MESSAGES.WELCOME, {
      reply_markup: {
        inline_keyboard: KEYBOARDS.SKILL_LEVELS,
      },
    });
  } catch (error) {
    console.error('Error in start command:', error);
    await ctx.reply('Произошла ошибка при регистрации. Попробуйте позже.');
  }
};