import { BotContext } from '../bot';

interface MessageOptions {
  parse_mode?: 'HTML' | 'Markdown';
  reply_markup?: any;
}

export const safeEditOrReply = async (
  ctx: BotContext, 
  message: string, 
  options: MessageOptions = {}
): Promise<void> => {
  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(message, options);
    } catch (error: any) {
      // Если сообщение не изменилось, молча игнорируем ошибку
      if (error.message && error.message.includes('message is not modified')) {
        return;
      }
      
      // Если сообщение слишком старое или удалено, отправляем новое
      if (error.message && (
        error.message.includes('message to edit not found') ||
        error.message.includes('message can\'t be edited')
      )) {
        await ctx.reply(message, options);
        return;
      }
      
      // Для всех остальных ошибок - пробрасываем дальше
      throw error;
    }
  } else {
    await ctx.reply(message, options);
  }
};