import { BotContext } from '@/bot';
import { CONFIG } from '@/config';
import { getCurrentWeek } from '@/utils/week';
import { prisma } from '@/utils/database';

export const add16Command = async (ctx: BotContext): Promise<void> => {
  try {
    if (!CONFIG.ADMINS.includes(ctx.from!.id)) {
      await ctx.reply('🚫 У вас нет доступа к этой команде');
      return;
    }

    const text = ('text' in ctx.message! && ctx.message.text) ? ctx.message.text : '';
    const args = text.split(' ').slice(1); // убираем команду /add16

    if (args.length === 0) {
      await ctx.reply(
        `📋 <b>Использование:</b>\n` +
        `/add16 username1 username2 username3 ...\n\n` +
        `<b>Пример:</b>\n` +
        `/add16 john_doe mary_smith alex_jones mike_wilson`
      , { parse_mode: 'HTML' });
      return;
    }

    if (args.length > 16) {
      await ctx.reply(`❌ Максимум 16 игроков за раз. Указано: ${args.length}`);
      return;
    }

    const { week, year } = getCurrentWeek();

    // Проверяем, сколько уже записано на эту неделю
    const existingEntries = await prisma.weekEntry.findMany({
      where: { week, year },
      include: { player: true }
    });

    if (existingEntries.length > 0) {
      await ctx.reply(`⚠️ На эту неделю уже записано ${existingEntries.length} игроков. Очистить и добавить заново? /clear_and_add16 ${args.join(' ')}`);
      return;
    }

    // Ищем игроков по username (убираем @ если есть)
    const usernames = args.map(arg => arg.replace('@', ''));
    const players = await prisma.player.findMany({
      where: {
        username: {
          in: usernames
        }
      }
    });

    // Проверяем, найдены ли все игроки
    const foundUsernames = players.map(p => p.username).filter(u => u);
    const notFound = usernames.filter(username => !foundUsernames.includes(username));

    if (notFound.length > 0) {
      await ctx.reply(`❌ Игроки не найдены: ${notFound.map(u => '@' + u).join(', ')}\n\nПроверьте правильность username или убедитесь, что игроки зарегистрированы.`);
      return;
    }

    // Проверяем дубликаты
    const alreadyAdded = existingEntries.filter(entry =>
      players.some(p => p.id === entry.playerId)
    );

    if (alreadyAdded.length > 0) {
      const duplicates = alreadyAdded.map(entry => '@' + entry.player.username).join(', ');
      await ctx.reply(`⚠️ Следующие игроки уже записаны: ${duplicates}`);
      return;
    }

    // Добавляем игроков в основной состав
    const entries = players.map(player => ({
      week,
      year,
      playerId: player.id,
      state: 'MAIN'
    }));

    await prisma.weekEntry.createMany({
      data: entries
    });

    let message = `✅ <b>Добавлено ${players.length} игроков в основной состав:</b>\n\n`;
    players.forEach((player, index) => {
      message += `${index + 1}. ${player.firstName}${player.username ? ` @${player.username}` : ''} (${player.skillSelf})\n`;
    });

    const currentTotal = existingEntries.length + players.length;
    message += `\n📊 Всего записано: ${currentTotal}/16`;

    await ctx.reply(message, { parse_mode: 'HTML' });

  } catch (error) {
    console.error('Error in add16 command:', error);
    await ctx.reply('Произошла ошибка при добавлении игроков.');
  }
};

export const clearAndAdd16Command = async (ctx: BotContext): Promise<void> => {
  try {
    if (!CONFIG.ADMINS.includes(ctx.from!.id)) {
      await ctx.reply('🚫 У вас нет доступа к этой команде');
      return;
    }

    const { week, year } = getCurrentWeek();

    // Очищаем текущую неделю
    const deleted = await prisma.weekEntry.deleteMany({
      where: { week, year }
    });

    await ctx.reply(`🗑️ Очищена неделя ${week}/${year}. Удалено записей: ${deleted.count}\n\nТеперь добавляю новых игроков...`);

    // Получаем аргументы из исходной команды
    const text = ('text' in ctx.message! && ctx.message.text) ? ctx.message.text : '';
    const args = text.split(' ').slice(1); // убираем команду /clear_and_add16

    if (args.length === 0) {
      await ctx.reply(
        `📋 <b>Использование:</b>\n` +
        `/clear_and_add16 username1 username2 username3 ...\n\n` +
        `<b>Пример:</b>\n` +
        `/clear_and_add16 john_doe mary_smith alex_jones mike_wilson`
      , { parse_mode: 'HTML' });
      return;
    }

    // Создаем временное сообщение для add16Command
    const fakeMessage = {
      ...ctx.message,
      text: `/add16 ${args.join(' ')}`
    };

    const fakeCtx = {
      ...ctx,
      message: fakeMessage
    };

    // Выполняем добавление с новыми аргументами
    await add16Command(fakeCtx as BotContext);

  } catch (error) {
    console.error('Error in clear_and_add16 command:', error);
    await ctx.reply('Произошла ошибка при очистке и добавлении игроков.');
  }
};

export const resetWeekCommand = async (ctx: BotContext): Promise<void> => {
  try {
    if (!CONFIG.ADMINS.includes(ctx.from!.id)) {
      await ctx.reply('🚫 У вас нет доступа к этой команде');
      return;
    }

    const { week, year } = getCurrentWeek();

    const deletedCount = await prisma.weekEntry.deleteMany({
      where: { week, year }
    });

    await ctx.reply(`🗑️ Очищена неделя ${week}/${year}. Удалено записей: ${deletedCount.count}`);

  } catch (error) {
    console.error('Error in reset week command:', error);
    await ctx.reply('Произошла ошибка при очистке недели.');
  }
};

export const addPlayerCommand = async (ctx: BotContext): Promise<void> => {
  try {
    if (!CONFIG.ADMINS.includes(ctx.from!.id)) {
      await ctx.reply('🚫 У вас нет доступа к этой команде');
      return;
    }

    const text = ('text' in ctx.message! && ctx.message.text) ? ctx.message.text : '';
    const args = text.split(' ').slice(1);

    if (args.length !== 1) {
      await ctx.reply(
        `📋 <b>Использование:</b>\n` +
        `/add @username или /add username\n\n` +
        `<b>Пример:</b>\n` +
        `/add john_doe`
      , { parse_mode: 'HTML' });
      return;
    }

    const { week, year } = getCurrentWeek();
    const username = args[0].replace('@', '');
    console.log(username)
    // Ищем игрока
    const player = await prisma.player.findFirst({
      where: { username }
    });

    if (!player) {
      await ctx.reply(`❌ Игрок @${username} не найден. Убедитесь, что игрок зарегистрирован.`);
      return;
    }

    // Проверяем, не записан ли уже
    const existingEntry = await prisma.weekEntry.findFirst({
      where: {
        week,
        year,
        playerId: player.id
      }
    });

    if (existingEntry) {
      await ctx.reply(`⚠️ Игрок @${username} уже записан на эту неделю (${existingEntry.state === 'MAIN' ? 'основной состав' : 'лист ожидания'})`);
      return;
    }

    // Проверяем количество записанных
    const currentCount = await prisma.weekEntry.count({
      where: { week, year }
    });

    const state = currentCount < 16 ? 'MAIN' : 'WAIT';

    await prisma.weekEntry.create({
      data: {
        week,
        year,
        playerId: player.id,
        state
      }
    });

    const position = currentCount + 1;
    const statusText = state === 'MAIN' ?
      `основной состав (#${position})` :
      `лист ожидания (#${position - 16})`;

    await ctx.reply(
      `✅ Игрок ${player.firstName} (@${username}) добавлен в ${statusText}\n` +
      `📊 Всего записано: ${position}/16`
    );

  } catch (error) {
    console.error('Error in add player command:', error);
    await ctx.reply('Произошла ошибка при добавлении игрока.');
  }
};