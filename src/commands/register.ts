import { BotContext } from '@/bot';
import { CONFIG } from '@/config';
import { prisma } from '@/utils/database';
import { escapeHtml } from '@/utils/html';

export const registerPlayerCommand = async (ctx: BotContext): Promise<void> => {
  try {
    if (!CONFIG.ADMINS.includes(ctx.from!.id)) {
      await ctx.reply('🚫 У вас нет доступа к этой команде');
      return;
    }

    const text = ('text' in ctx.message! && ctx.message.text) ? ctx.message.text : '';
    const args = text.split(' ').slice(1);
    
    if (args.length < 2 || args.length > 4) {
      await ctx.reply(
        `📋 <b>Использование:</b>\n` +
        `/register username "Имя Фамилия" [skill] [telegram_id]\n\n` +
        `<b>Параметры:</b>\n` +
        `• username - никнейм игрока (без @)\n` +
        `• "Имя Фамилия" - полное имя в кавычках\n` +
        `• skill - уровень игры 1-5 (по умолчанию 3)\n` +
        `• telegram_id - ID пользователя (опционально)\n\n` +
        `<b>Примеры:</b>\n` +
        `/register john_doe "Джон Доу"\n` +
        `/register mary_smith "Мария Смит" 4\n` +
        `/register alex_jones "Алекс Джонс" 5 123456789`
      , { parse_mode: 'HTML' });
      return;
    }

    const username = args[0].replace('@', '');
    
    // Парсим имя из кавычек
    let firstName: string;
    let skill = 3;
    let telegramId: number | null = null;
    
    // Ищем текст в кавычках
    const fullText = text.substring(text.indexOf(' ') + 1);
    const nameMatch = fullText.match(/"([^"]+)"/);
    
    if (!nameMatch) {
      await ctx.reply('❌ Имя должно быть в кавычках: "Имя Фамилия"');
      return;
    }
    
    firstName = nameMatch[1];
    
    // Парсим остальные параметры после кавычек
    const afterName = fullText.substring(fullText.indexOf(nameMatch[0]) + nameMatch[0].length).trim();
    const remainingArgs = afterName.split(' ').filter(arg => arg.length > 0);
    
    if (remainingArgs.length >= 1) {
      const skillValue = parseInt(remainingArgs[0]);
      if (isNaN(skillValue) || skillValue < 1 || skillValue > 5) {
        await ctx.reply('❌ Уровень игры должен быть от 1 до 5');
        return;
      }
      skill = skillValue;
    }
    
    if (remainingArgs.length >= 2) {
      const telegramIdValue = parseInt(remainingArgs[1]);
      if (isNaN(telegramIdValue)) {
        await ctx.reply('❌ Telegram ID должен быть числом');
        return;
      }
      telegramId = telegramIdValue;
    }
    
    // Проверяем, не существует ли уже игрок с таким username
    const existingPlayer = await prisma.player.findFirst({
      where: { username }
    });
    
    if (existingPlayer) {
      await ctx.reply(`❌ Игрок с username @${username} уже зарегистрирован`);
      return;
    }
    
    // Проверяем telegram_id если указан
    if (telegramId) {
      const existingByTelegramId = await prisma.player.findFirst({
        where: { telegramId: BigInt(telegramId) }
      });
      
      if (existingByTelegramId) {
        await ctx.reply(`❌ Игрок с Telegram ID ${telegramId} уже зарегистрирован (@${existingByTelegramId.username})`);
        return;
      }
    }
    
    // Создаем игрока
    const player = await prisma.player.create({
      data: {
        telegramId: telegramId ? BigInt(telegramId) : BigInt(Date.now() * -1), // Используем отрицательный timestamp как временный ID
        username,
        firstName,
        skillSelf: skill,
      }
    });
    
    const escapedName = escapeHtml(firstName);
    await ctx.reply(
      `✅ <b>Игрок зарегистрирован:</b>\n\n` +
      `👤 Имя: ${escapedName}\n` +
      `🏷️ Username: @${username}\n` +
      `⭐ Уровень игры: ${skill}/5\n` +
      `🆔 ID: ${player.id}` +
      (telegramId ? `\n📱 Telegram ID: ${telegramId}` : '')
    , { parse_mode: 'HTML' });
    
  } catch (error) {
    console.error('Error in register player command:', error);
    await ctx.reply('Произошла ошибка при регистрации игрока.');
  }
};

export const bulkRegisterCommand = async (ctx: BotContext): Promise<void> => {
  try {
    if (!CONFIG.ADMINS.includes(ctx.from!.id)) {
      await ctx.reply('🚫 У вас нет доступа к этой команде');
      return;
    }

    const text = ('text' in ctx.message! && ctx.message.text) ? ctx.message.text : '';
    
    if (!text.includes('\n')) {
      await ctx.reply(
        `📋 <b>Массовая регистрация игроков:</b>\n\n` +
        `Отправьте команду /bulk_register, а затем список игроков в формате:\n` +
        `username1 "Имя1 Фамилия1" skill1\n` +
        `username2 "Имя2 Фамилия2" skill2\n` +
        `...\n\n` +
        `<b>Пример:</b>\n` +
        `/bulk_register\n` +
        `john_doe "Джон Доу" 4\n` +
        `mary_smith "Мария Смит" 5\n` +
        `alex_jones "Алекс Джонс" 3`
      , { parse_mode: 'HTML' });
      return;
    }
    
    const lines = text.split('\n').slice(1); // убираем первую строку с командой
    const results: string[] = [];
    let registered = 0;
    let errors = 0;
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;
      
      try {
        // Парсим строку: username "Name" skill
        const nameMatch = trimmedLine.match(/^(\S+)\s+"([^"]+)"(?:\s+(\d+))?/);
        
        if (!nameMatch) {
          results.push(`❌ ${trimmedLine} - неверный формат`);
          errors++;
          continue;
        }
        
        const [, rawUsername, firstName, skillStr] = nameMatch;
        const username = rawUsername.replace('@', ''); // Убираем @ если есть
        const skill = skillStr ? parseInt(skillStr) : 3;
        
        if (skill < 1 || skill > 5) {
          results.push(`❌ @${username} - уровень должен быть 1-5`);
          errors++;
          continue;
        }
        
        // Проверяем существование
        const existing = await prisma.player.findFirst({
          where: { username }
        });
        
        if (existing) {
          results.push(`⚠️ @${username} - уже существует`);
          errors++;
          continue;
        }
        
        // Создаем игрока
        await prisma.player.create({
          data: {
            telegramId: BigInt(Date.now() * -1 - registered), // Уникальный отрицательный ID
            username,
            firstName,
            skillSelf: skill,
          }
        });
        
        results.push(`✅ @${username} - ${firstName} (${skill})`);
        registered++;
        
      } catch (error) {
        results.push(`❌ ${trimmedLine} - ошибка обработки`);
        errors++;
      }
    }
    
    let message = `📊 <b>Результат массовой регистрации:</b>\n\n`;
    message += `✅ Зарегистрировано: ${registered}\n`;
    message += `❌ Ошибок: ${errors}\n\n`;
    
    if (results.length > 0) {
      message += `<b>Детали:</b>\n${results.slice(0, 20).join('\n')}`;
      
      if (results.length > 20) {
        message += `\n... и еще ${results.length - 20} записей`;
      }
    }
    
    await ctx.reply(message, { parse_mode: 'HTML' });
    
  } catch (error) {
    console.error('Error in bulk register command:', error);
    await ctx.reply('Произошла ошибка при массовой регистрации.');
  }
};

export const editPlayerCommand = async (ctx: BotContext): Promise<void> => {
  try {
    if (!CONFIG.ADMINS.includes(ctx.from!.id)) {
      await ctx.reply('🚫 У вас нет доступа к этой команде');
      return;
    }

    const text = ('text' in ctx.message! && ctx.message.text) ? ctx.message.text : '';
    const args = text.split(' ').slice(1);
    
    if (args.length < 2) {
      await ctx.reply(
        `📋 <b>Редактирование игрока:</b>\n\n` +
        `/edit_player username field value\n\n` +
        `<b>Поля для изменения:</b>\n` +
        `• name "Новое Имя" - изменить имя\n` +
        `• skill 1-5 - изменить уровень игры\n` +
        `• username новый_юзернейм - изменить username\n\n` +
        `<b>Примеры:</b>\n` +
        `/edit_player john_doe name "Джон Смит"\n` +
        `/edit_player mary_smith skill 4\n` +
        `/edit_player old_name username new_name`
      , { parse_mode: 'HTML' });
      return;
    }

    const username = args[0].replace('@', '');
    const field = args[1].toLowerCase();
    
    // Ищем игрока
    const player = await prisma.player.findFirst({
      where: { username }
    });
    
    if (!player) {
      await ctx.reply(`❌ Игрок @${username} не найден`);
      return;
    }
    
    let updateData: any = {};
    let successMessage = '';
    
    switch (field) {
      case 'name':
        // Парсим имя из кавычек
        const nameMatch = text.match(/"([^"]+)"/);
        if (!nameMatch) {
          await ctx.reply('❌ Имя должно быть в кавычках: "Новое Имя"');
          return;
        }
        updateData.firstName = nameMatch[1];
        successMessage = `имя изменено на "${nameMatch[1]}"`;
        break;
        
      case 'skill':
        const skill = parseInt(args[2]);
        if (isNaN(skill) || skill < 1 || skill > 5) {
          await ctx.reply('❌ Уровень игры должен быть от 1 до 5');
          return;
        }
        updateData.skillSelf = skill;
        successMessage = `уровень игры изменен на ${skill}`;
        break;
        
      case 'username':
        const newUsername = args[2].replace('@', '');
        // Проверяем, не занят ли новый username
        const existingUser = await prisma.player.findFirst({
          where: { username: newUsername }
        });
        if (existingUser && existingUser.id !== player.id) {
          await ctx.reply(`❌ Username @${newUsername} уже занят`);
          return;
        }
        updateData.username = newUsername;
        successMessage = `username изменен на @${newUsername}`;
        break;
        
      default:
        await ctx.reply('❌ Неизвестное поле. Доступны: name, skill, username');
        return;
    }
    
    // Обновляем игрока
    const updatedPlayer = await prisma.player.update({
      where: { id: player.id },
      data: updateData
    });
    
    const escapedName = escapeHtml(updatedPlayer.firstName);
    await ctx.reply(
      `✅ <b>Игрок обновлен:</b>\n\n` +
      `👤 Имя: ${escapedName}\n` +
      `🏷️ Username: @${updatedPlayer.username}\n` +
      `⭐ Уровень: ${updatedPlayer.skillSelf}/5\n\n` +
      `📝 ${successMessage}`
    , { parse_mode: 'HTML' });
    
  } catch (error) {
    console.error('Error in edit player command:', error);
    await ctx.reply('Произошла ошибка при редактировании игрока.');
  }
};

export const linkPlayerCommand = async (ctx: BotContext): Promise<void> => {
  try {
    if (!CONFIG.ADMINS.includes(ctx.from!.id)) {
      await ctx.reply('🚫 У вас нет доступа к этой команде');
      return;
    }

    const text = ('text' in ctx.message! && ctx.message.text) ? ctx.message.text : '';
    const args = text.split(' ').slice(1);
    
    if (args.length !== 2) {
      await ctx.reply(
        `📋 <b>Связать игрока с Telegram ID:</b>\n\n` +
        `/link_player username telegram_id\n\n` +
        `<b>Пример:</b>\n` +
        `/link_player john_doe 123456789`
      , { parse_mode: 'HTML' });
      return;
    }

    const username = args[0].replace('@', '');
    const telegramId = parseInt(args[1]);
    
    if (isNaN(telegramId)) {
      await ctx.reply('❌ Telegram ID должен быть числом');
      return;
    }
    
    // Ищем игрока по username
    const player = await prisma.player.findFirst({
      where: { username }
    });
    
    if (!player) {
      await ctx.reply(`❌ Игрок @${username} не найден`);
      return;
    }
    
    // Проверяем, не занят ли этот Telegram ID
    const existingByTelegramId = await prisma.player.findFirst({
      where: { 
        telegramId: BigInt(telegramId),
        id: { not: player.id }
      }
    });
    
    if (existingByTelegramId) {
      await ctx.reply(`❌ Telegram ID ${telegramId} уже используется игроком @${existingByTelegramId.username}`);
      return;
    }
    
    // Связываем игрока с Telegram ID
    await prisma.player.update({
      where: { id: player.id },
      data: { telegramId: BigInt(telegramId) }
    });
    
    const escapedName = escapeHtml(player.firstName);
    await ctx.reply(
      `✅ <b>Игрок связан с Telegram:</b>\n\n` +
      `👤 ${escapedName} (@${username})\n` +
      `📱 Telegram ID: ${telegramId}\n\n` +
      `Теперь игрок может использовать /start для активации аккаунта`
    , { parse_mode: 'HTML' });
    
  } catch (error) {
    console.error('Error in link player command:', error);
    await ctx.reply('Произошла ошибка при связывании игрока.');
  }
};