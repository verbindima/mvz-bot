import { BotContext } from '@/bot';
import { MESSAGES } from '@/config';

export const joinCommand = async (ctx: BotContext): Promise<void> => {
  try {
    const result = await ctx.gameService.joinGame(ctx.from!.id);
    
    let message = '';
    if (result.success) {
      if (result.position! <= 16) {
        message = MESSAGES.JOINED_GAME.replace('{position}', result.position!.toString());
      } else {
        message = MESSAGES.JOINED_WAITLIST.replace('{position}', (result.position! - 16).toString());
      }
    } else {
      message = result.error || 'Произошла ошибка';
    }
    
    await ctx.reply(message);
  } catch (error) {
    console.error('Error in join command:', error);
    await ctx.reply('Произошла ошибка при записи на игру.');
  }
};

export const leaveCommand = async (ctx: BotContext): Promise<void> => {
  try {
    const result = await ctx.gameService.leaveGame(ctx.from!.id);
    await ctx.reply(result.success ? MESSAGES.LEFT_GAME : result.error || 'Произошла ошибка');
  } catch (error) {
    console.error('Error in leave command:', error);
    await ctx.reply('Произошла ошибка при выходе из игры.');
  }
};