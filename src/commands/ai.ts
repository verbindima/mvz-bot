import { BotContext } from '../bot';
import { checkAdminAnyChat } from '../utils/chat';

export const aiCommand = async (ctx: BotContext): Promise<void> => {
  try {
    if (!await checkAdminAnyChat(ctx)) {
      return;
    }

    const text = ('text' in ctx.message! && ctx.message.text) ? ctx.message.text : '';
    const query = text.replace('/ai', '').trim();
    
    if (!query) {
      await ctx.reply(
        `🤖 <b>AI помощник</b>\n\n` +
        `Использование: /ai ваш вопрос\n\n` +
        `<b>Пример:</b>\n` +
        `/ai Объясни как работает искусственный интеллект`
      , { parse_mode: 'HTML' });
      return;
    }

    await ctx.reply('🤖 Генерирую ответ...');

    const response = await ctx.aiService.generateResponse(query);
    
    await ctx.reply(`🤖 <b>AI Ответ:</b>\n\n${response}`, { parse_mode: 'HTML' });
    
  } catch (error) {
    console.error('Error in AI command:', error);
    await ctx.reply('Произошла ошибка при обращении к AI.');
  }
};