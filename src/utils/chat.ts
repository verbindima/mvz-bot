import { BotContext } from '../bot';
import { CONFIG } from '../config';

export const isPrivateChat = (ctx: BotContext): boolean => {
  return ctx.chat?.type === 'private';
};

export const checkAdminPrivateOnly = async (ctx: BotContext): Promise<boolean> => {
  // Check if user is admin
  if (!CONFIG.ADMINS.includes(ctx.from!.id)) {
    await ctx.reply('🚫 У вас нет доступа к этой команде');
    return false;
  }

  // Check if this is a private chat for admin commands
  if (!isPrivateChat(ctx)) {
    await ctx.reply('🔒 Админские команды доступны только в личных сообщениях с ботом');
    return false;
  }

  return true;
};

export const checkAdminAnyChat = async (ctx: BotContext): Promise<boolean> => {
  // Check if user is admin (can be used in any chat)
  if (!CONFIG.ADMINS.includes(ctx.from!.id)) {
    await ctx.reply('🚫 У вас нет доступа к этой команде');
    return false;
  }

  return true;
};