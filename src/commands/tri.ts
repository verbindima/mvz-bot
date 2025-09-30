import { container } from 'tsyringe';
import { BotContext } from '../bot';
import { CONFIG, MESSAGES } from '../config';
import { TeamService } from '../services/team.service';
import { TeamPlayerService } from '../services/team-player.service';
import { RatingService } from '../services/rating.service';
import { StatisticsService } from '../services/statistics.service';
import { checkAdminPrivateOnly } from '../utils/chat';
import { prisma } from '../utils/database';
import { getCurrentWeek } from '../utils/week';
import { logger } from '../utils/logger';

// Интерфейс для парсера результатов
interface TriMatchResult {
  t1: string;
  t2: string;
  s1: number;
  s2: number;
  winner: string | null;
}

export const triInitCommand = async (ctx: BotContext): Promise<void> => {
  try {
    if (!await checkAdminPrivateOnly(ctx)) {
      return;
    }

    if (!CONFIG.TRI_MODE_ENABLED) {
      await ctx.reply('❌ Режим трёх команд отключен в конфигурации.');
      return;
    }

    const { week, year } = getCurrentWeek();

    // Проверяем, есть ли уже открытая сессия (любого формата)
    const existingOpenSession = await prisma.gameSession.findFirst({
      where: {
        isClosed: false,
        isConfirmed: true
      }
    });

    if (existingOpenSession) {
      const formatName = existingOpenSession.format === 'DUO' ? '2×8' : '3×8';
      await ctx.reply(`❌ Уже есть открытая игра в формате ${formatName}. Завершите её перед созданием новой TRI сессии.`);
      return;
    }

    // Получаем игроков недели
    const { main } = await ctx.gameService.getWeekPlayers();

    if (main.length < 24) {
      await ctx.reply(`❌ Недостаточно игроков для TRI режима (${main.length}/24)\n\nДля режима трёх команд нужно ровно 24 игрока.`);
      return;
    }

    if (main.length > 24) {
      await ctx.reply(`❌ Слишком много игроков для TRI режима (${main.length}/24)\n\nДля режима трёх команд нужно ровно 24 игрока.`);
      return;
    }

    await ctx.reply('🔄 Генерирую три команды по 8 игроков...');

    // Генерируем три команды
    const teamService = container.resolve(TeamService);
    const balance = await teamService.generateThreeTeams(main);

    // Создаем или обновляем сессию
    const gameSession = await prisma.gameSession.upsert({
      where: { week_year: { week, year } },
      update: {
        format: 'TRI',
        teamA: '🔴 Красная',
        teamB: '🔵 Синяя',
        teamC: '🟢 Зелёная',
        isInitialized: true,
        isConfirmed: false
      },
      create: {
        week,
        year,
        format: 'TRI',
        teamA: '🔴 Красная',
        teamB: '🔵 Синяя',
        teamC: '🟢 Зелёная',
        isInitialized: true,
        isConfirmed: false
      }
    });

    // Сохраняем составы команд
    const teamPlayerService = container.resolve(TeamPlayerService);
    await teamPlayerService.saveThreeTeamComposition(
      gameSession.id,
      balance.teamA.players,
      balance.teamB.players,
      balance.teamC.players
    );

    // Форматируем и отправляем сообщение
    const message = teamService.formatThreeTeamsMessage(balance, {
      teamA: '🔴 Красная',
      teamB: '🔵 Синяя',
      teamC: '🟢 Зелёная'
    });

    await ctx.reply(
      `⚽ <b>Команды TRI сгенерированы!</b>\n\n${message}\n\n` +
      `💡 Используйте /tri_confirm для подтверждения составов`,
      { parse_mode: 'HTML' }
    );

    logger.info(`TRI teams generated for session ${gameSession.id} by admin ${ctx.from?.id}`);

  } catch (error) {
    logger.error('Error in tri_init command:', error);
    await ctx.reply('❌ Произошла ошибка при генерации TRI команд.');
  }
};

export const triConfirmCommand = async (ctx: BotContext): Promise<void> => {
  try {
    if (!await checkAdminPrivateOnly(ctx)) {
      return;
    }

    if (!CONFIG.TRI_MODE_ENABLED) {
      await ctx.reply('❌ Режим трёх команд отключен в конфигурации.');
      return;
    }

    // Ищем открытую TRI сессию
    const gameSession = await prisma.gameSession.findFirst({
      where: {
        format: 'TRI',
        isInitialized: true,
        isClosed: false
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!gameSession) {
      await ctx.reply('❌ Нет активной открытой TRI сессии. Используйте /tri_init для создания.');
      return;
    }

    if (!gameSession.isInitialized) {
      await ctx.reply('❌ TRI сессия не инициализирована. Используйте /tri_init.');
      return;
    }

    if (gameSession.isConfirmed) {
      await ctx.reply('✅ TRI команды уже подтверждены.');
      return;
    }

    // Подтверждаем составы
    await prisma.gameSession.update({
      where: { id: gameSession.id },
      data: { isConfirmed: true }
    });

    // Получаем составы для показа
    const teamPlayerService = container.resolve(TeamPlayerService);
    const composition = await teamPlayerService.getThreeTeamComposition(gameSession.id);

    if (!composition) {
      await ctx.reply('❌ Не найдены составы команд.');
      return;
    }

    const teamService = container.resolve(TeamService);
    const teamBalance = {
      teamA: { players: composition.teamA, totalRating: 0, averageRating: 0 },
      teamB: { players: composition.teamB, totalRating: 0, averageRating: 0 },
      teamC: { players: composition.teamC, totalRating: 0, averageRating: 0 },
      maxDifference: 0,
      avgDifference: 0
    };

    // Пересчитываем рейтинги
    teamBalance.teamA.totalRating = composition.teamA.reduce((sum, p) => sum + teamService.getPlayerWeight(p), 0);
    teamBalance.teamA.averageRating = teamBalance.teamA.totalRating / composition.teamA.length;

    teamBalance.teamB.totalRating = composition.teamB.reduce((sum, p) => sum + teamService.getPlayerWeight(p), 0);
    teamBalance.teamB.averageRating = teamBalance.teamB.totalRating / composition.teamB.length;

    teamBalance.teamC.totalRating = composition.teamC.reduce((sum, p) => sum + teamService.getPlayerWeight(p), 0);
    teamBalance.teamC.averageRating = teamBalance.teamC.totalRating / composition.teamC.length;

    // Рассчитываем разности
    const weights = [teamBalance.teamA.totalRating, teamBalance.teamB.totalRating, teamBalance.teamC.totalRating];
    teamBalance.maxDifference = Math.max(...weights) - Math.min(...weights);
    const avgWeight = weights.reduce((sum, w) => sum + w, 0) / weights.length;
    teamBalance.avgDifference = weights.reduce((sum, w) => sum + Math.abs(w - avgWeight), 0) / weights.length;

    const message = teamService.formatThreeTeamsMessage(teamBalance, {
      teamA: '🔴 Красная',
      teamB: '🔵 Синяя',
      teamC: '🟢 Зелёная'
    });

    await ctx.reply(
      `✅ <b>TRI команды подтверждены!</b>\n\n${message}\n\n` +
      `🎮 Команды готовы к игре в формате "winner stays"\n` +
      `📝 После матчей используйте /tri_results для ввода результатов`,
      { parse_mode: 'HTML' }
    );

    logger.info(`TRI teams confirmed for session ${gameSession.id} by admin ${ctx.from?.id}`);

  } catch (error) {
    logger.error('Error in tri_confirm command:', error);
    await ctx.reply('❌ Произошла ошибка при подтверждении TRI команд.');
  }
};

export const triCancelCommand = async (ctx: BotContext): Promise<void> => {
  try {
    if (!await checkAdminPrivateOnly(ctx)) {
      return;
    }

    // Ищем открытую TRI сессию
    const gameSession = await prisma.gameSession.findFirst({
      where: {
        format: 'TRI',
        isClosed: false
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!gameSession) {
      await ctx.reply('❌ Нет активной TRI сессии для отмены.');
      return;
    }

    // Сбрасываем в черновик
    await prisma.gameSession.update({
      where: { id: gameSession.id },
      data: {
        isConfirmed: false,
        isInitialized: false
      }
    });

    await ctx.reply(
      '🔄 TRI сессия сброшена в черновик.\n\n' +
      '💡 Составы команд сохранены. Используйте /tri_init для повторной генерации или /tri_confirm для подтверждения текущих составов.'
    );

    logger.info(`TRI session ${gameSession.id} cancelled by admin ${ctx.from?.id}`);

  } catch (error) {
    logger.error('Error in tri_cancel command:', error);
    await ctx.reply('❌ Произошла ошибка при отмене TRI сессии.');
  }
};

// Парсер результатов матчей
function parseTriResults(text: string): { results: TriMatchResult[]; errors: string[] } {
  const lines = text.trim().split('\n');
  const results: TriMatchResult[] = [];
  const errors: string[] = [];

  if (lines.length > CONFIG.TRI_BULK_PARSE_MAX_LINES) {
    errors.push(`Превышен лимит строк: ${lines.length}/${CONFIG.TRI_BULK_PARSE_MAX_LINES}`);
    return { results: [], errors };
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const lineNum = i + 1;

    // Пытаемся распарсить разные форматы
    let match = line.match(/^([ABC])\s+(\d+)-(\d+)\s+([ABC])$/); // A 5-3 B
    if (!match) {
      match = line.match(/^([ABC])-([ABC])\s+(\d+):(\d+)$/); // A-B 5:3
      if (match) {
        match = [match[0], match[1], match[3], match[4], match[2]]; // переставляем для единообразия
      }
    }
    if (!match) {
      match = line.match(/^([ABC])([ABC])\s+(\d+)\s+(\d+)$/); // AB 5 3
      if (match) {
        match = [match[0], match[1], match[3], match[4], match[2]]; // переставляем
      }
    }

    if (!match) {
      errors.push(`Строка ${lineNum}: не удалось распарсить "${line}"`);
      continue;
    }

    const t1 = match[1];
    const s1 = parseInt(match[2]);
    const s2 = parseInt(match[3]);
    const t2 = match[4];

    // Валидация
    if (!['A', 'B', 'C'].includes(t1) || !['A', 'B', 'C'].includes(t2)) {
      errors.push(`Строка ${lineNum}: недопустимые команды "${t1}" и "${t2}"`);
      continue;
    }

    if (t1 === t2) {
      errors.push(`Строка ${lineNum}: команда не может играть сама с собой`);
      continue;
    }

    if (s1 < 0 || s2 < 0) {
      errors.push(`Строка ${lineNum}: счет не может быть отрицательным`);
      continue;
    }

    const winner = s1 > s2 ? t1 : s2 > s1 ? t2 : null;

    results.push({ t1, t2, s1, s2, winner });
  }

  return { results, errors };
}

export const triBulkAddCommand = async (ctx: BotContext): Promise<void> => {
  try {
    if (!await checkAdminPrivateOnly(ctx)) {
      return;
    }

    if (!CONFIG.TRI_MODE_ENABLED) {
      await ctx.reply('❌ Режим трёх команд отключен в конфигурации.');
      return;
    }

    // Получаем список игроков из сообщения
    let playersText = '';
    if (ctx.message && 'text' in ctx.message) {
      playersText = ctx.message.text?.replace('/tri_bulk_add', '').trim() || '';
    }

    if (!playersText) {
      await ctx.reply(
        '❌ Не указан список игроков.\n\n' +
        '📝 <b>Формат команды:</b>\n' +
        '<code>/tri_bulk_add\n' +
        'Иван Петров\n' +
        'Александр Смирнов\n' +
        '@username\n' +
        '...(до 24 строк)</code>\n\n' +
        '💡 <b>Поддерживаемые форматы:</b>\n' +
        '• Полное имя (ищется по firstName)\n' +
        '• @username (автоматическая регистрация если не найден)\n' +
        '• ID Telegram (автоматическая регистрация если не найден)\n\n' +
        '🆕 <b>Автоматическая регистрация:</b>\n' +
        'Новые игроки (по @username и telegram ID) будут автоматически зарегистрированы с базовым рейтингом',
        { parse_mode: 'HTML' }
      );
      return;
    }

    const lines = playersText.trim().split('\n').filter(line => line.trim());

    if (lines.length === 0) {
      await ctx.reply('❌ Список игроков пуст.');
      return;
    }

    if (lines.length > 24) {
      await ctx.reply(`❌ Слишком много игроков (${lines.length}/24). Для TRI режима максимум 24 игрока.`);
      return;
    }

    await ctx.reply(`🔄 Ищу и добавляю ${lines.length} игрок(ов)...`);

    const { week, year } = getCurrentWeek();
    const addedPlayers: string[] = [];
    const notFoundPlayers: string[] = [];
    const alreadyJoined: string[] = [];
    const autoRegistered: string[] = [];

    // Получаем текущих записанных игроков
    const currentEntries = await prisma.weekEntry.findMany({
      where: { week, year },
      include: { player: true }
    });

    const currentPlayerIds = new Set(currentEntries.map(e => e.player.id));

    for (let i = 0; i < lines.length; i++) {
      const playerInput = lines[i].trim();
      if (!playerInput) continue;

      try {
        let player = null;

        // Поиск по username (@username)
        if (playerInput.startsWith('@')) {
          const username = playerInput.slice(1);
          player = await prisma.player.findFirst({
            where: { username }
          });
        }
        // Поиск по Telegram ID (только числа)
        else if (/^\d+$/.test(playerInput)) {
          const telegramId = BigInt(playerInput);
          player = await prisma.player.findUnique({
            where: { telegramId }
          });
        }
        // Поиск по имени (firstName содержит)
        else {
          player = await prisma.player.findFirst({
            where: {
              firstName: {
                contains: playerInput,
                mode: 'insensitive'
              }
            }
          });
        }

        // Если игрок не найден, пытаемся автоматически зарегистрировать
        let isAutoRegistered = false;
        if (!player) {
          // Автоматическая регистрация только по username и telegram ID
          if (playerInput.startsWith('@')) {
            const username = playerInput.slice(1);
            try {
              player = await prisma.player.create({
                data: {
                  telegramId: BigInt(Date.now()), // Временный уникальный ID
                  username: username,
                  firstName: username, // Используем username как имя по умолчанию
                  tsMu: 25,
                  tsSigma: 8.333,
                  isAdmin: false
                }
              });
              autoRegistered.push(`@${username} (новый игрок)`);
              isAutoRegistered = true;
              logger.info(`Auto-registered player with username: ${username}`);
            } catch (error) {
              logger.error(`Failed to auto-register player with username ${username}:`, error);
              notFoundPlayers.push(playerInput);
              continue;
            }
          }
          else if (/^\d+$/.test(playerInput)) {
            const telegramId = BigInt(playerInput);
            try {
              player = await prisma.player.create({
                data: {
                  telegramId: telegramId,
                  username: null,
                  firstName: `ID${playerInput}`, // Используем ID как имя по умолчанию
                  tsMu: 25,
                  tsSigma: 8.333,
                  isAdmin: false
                }
              });
              autoRegistered.push(`ID${playerInput} (новый игрок)`);
              isAutoRegistered = true;
              logger.info(`Auto-registered player with telegram ID: ${telegramId}`);
            } catch (error) {
              logger.error(`Failed to auto-register player with telegram ID ${telegramId}:`, error);
              notFoundPlayers.push(playerInput);
              continue;
            }
          }
          else {
            // По имени автоматически не регистрируем, так как нет уникального идентификатора
            notFoundPlayers.push(playerInput);
            continue;
          }
        }

        // Проверяем, уже записан ли игрок
        if (currentPlayerIds.has(player.id)) {
          alreadyJoined.push(`${player.firstName} (@${player.username || 'no_username'})`);
          continue;
        }

        // Добавляем игрока в основной состав
        await prisma.weekEntry.create({
          data: {
            week,
            year,
            playerId: player.id,
            state: 'MAIN',
            isPaid: false
          }
        });

        // Добавляем в соответствующий список в зависимости от того, как был найден игрок
        if (isAutoRegistered) {
          // Уже добавлен в autoRegistered выше
        } else {
          addedPlayers.push(`${player.firstName} (@${player.username || 'no_username'})`);
        }
        currentPlayerIds.add(player.id);

      } catch (error) {
        logger.error(`Error adding player "${playerInput}":`, error);
        notFoundPlayers.push(playerInput);
      }
    }

    // Формируем отчет
    let reportMessage = `✅ <b>Пакетное добавление завершено!</b>\n\n`;

    if (addedPlayers.length > 0) {
      reportMessage += `➕ <b>Добавлено игроков (${addedPlayers.length}):</b>\n`;
      addedPlayers.forEach((player, i) => {
        reportMessage += `${i + 1}. ${player}\n`;
      });
      reportMessage += '\n';
    }

    if (autoRegistered.length > 0) {
      reportMessage += `🆕 <b>Автоматически зарегистрированы (${autoRegistered.length}):</b>\n`;
      autoRegistered.forEach((player, i) => {
        reportMessage += `${i + 1}. ${player}\n`;
      });
      reportMessage += '\n';
    }

    if (alreadyJoined.length > 0) {
      reportMessage += `ℹ️ <b>Уже записаны (${alreadyJoined.length}):</b>\n`;
      alreadyJoined.forEach((player, i) => {
        reportMessage += `${i + 1}. ${player}\n`;
      });
      reportMessage += '\n';
    }

    if (notFoundPlayers.length > 0) {
      reportMessage += `❌ <b>Не найдены (${notFoundPlayers.length}):</b>\n`;
      notFoundPlayers.forEach((player, i) => {
        reportMessage += `${i + 1}. ${player}\n`;
      });
      reportMessage += '\n';
    }

    // Получаем актуальную статистику
    const { main } = await ctx.gameService.getWeekPlayers();
    const totalPlayers = main.length;
    const needed = Math.max(0, 24 - totalPlayers);

    reportMessage += `📊 <b>Итого записано:</b> ${totalPlayers}/24\n`;
    if (needed > 0) {
      reportMessage += `🎯 <b>Нужно еще:</b> ${needed} игрок(ов)`;
    } else {
      reportMessage += `🔥 <b>TRI состав полный! Можно формировать команды</b>`;
    }

    await ctx.reply(reportMessage, { parse_mode: 'HTML' });

    logger.info(`Bulk add completed: ${addedPlayers.length} added, ${autoRegistered.length} auto-registered, ${alreadyJoined.length} already joined, ${notFoundPlayers.length} not found by admin ${ctx.from?.id}`);

  } catch (error) {
    logger.error('Error in tri_bulk_add command:', error);
    await ctx.reply('❌ Произошла ошибка при пакетном добавлении игроков.');
  }
};

// Функция для обновления интерфейса редактирования (редактирует существующее сообщение)
export const refreshTriEditInterface = async (ctx: BotContext, addTimestamp: boolean = false): Promise<void> => {
  try {
    // Ищем открытую TRI сессию
    const gameSession = await prisma.gameSession.findFirst({
      where: {
        format: 'TRI',
        isInitialized: true,
        isClosed: false
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!gameSession) {
      await ctx.editMessageText('❌ TRI сессия недоступна для редактирования.');
      return;
    }

    // Получаем составы команд
    const teamPlayerService = container.resolve(TeamPlayerService);
    const composition = await teamPlayerService.getThreeTeamComposition(gameSession.id);

    if (!composition) {
      await ctx.editMessageText('❌ Не найдены составы команд.');
      return;
    }

    // Формируем сообщение с текущими составами
    const teamService = container.resolve(TeamService);

    const teamAWeight = composition.teamA.reduce((sum, p) => sum + teamService.getPlayerWeight(p), 0);
    const teamBWeight = composition.teamB.reduce((sum, p) => sum + teamService.getPlayerWeight(p), 0);
    const teamCWeight = composition.teamC.reduce((sum, p) => sum + teamService.getPlayerWeight(p), 0);

    const maxWeight = Math.max(teamAWeight, teamBWeight, teamCWeight);
    const minWeight = Math.min(teamAWeight, teamBWeight, teamCWeight);
    const difference = maxWeight - minWeight;

    const formatTeam = (players: any[], teamName: string, weight: number) => {
      const playersStr = players.map((p, i) => {
        const rating = teamService.getPlayerWeight(p).toFixed(1);
        return `${i + 1}. ${p.firstName} — ${rating}`;
      }).join('\n');
      return `<b>${teamName}</b> (${weight.toFixed(1)}):\n${playersStr}`;
    };

    let message = `⚽ <b>Редактирование TRI составов</b>\n\n`;
    message += formatTeam(composition.teamA, '🔴 Красная', teamAWeight) + '\n\n';
    message += formatTeam(composition.teamB, '🔵 Синяя', teamBWeight) + '\n\n';
    message += formatTeam(composition.teamC, '🟢 Зелёная', teamCWeight) + '\n\n';

    // Добавляем информацию о балансе и вероятностях
    message += `📊 <b>Баланс команд:</b>\n`;
    message += `• Разница в силе (макс-мин): ${difference.toFixed(2)} μ\n`;

    // Рассчитываем примерные вероятности для трех команд
    const totalWeight = teamAWeight + teamBWeight + teamCWeight;
    const probA = (teamAWeight / totalWeight * 100);
    const probB = (teamBWeight / totalWeight * 100);
    const probC = (teamCWeight / totalWeight * 100);

    message += `• Примерное распределение силы:\n`;
    message += `  🔴 ${probA.toFixed(1)}% | 🔵 ${probB.toFixed(1)}% | 🟢 ${probC.toFixed(1)}%\n\n`;

    // Добавляем временную метку если запрошено (для кнопки "Пересчитать")
    if (addTimestamp) {
      const now = new Date();
      message += `🔄 <i>Обновлено: ${now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</i>\n\n`;
    }

    message += `💡 Выберите действие:`;

    const keyboard = [
      [
        { text: '🔴→🔵 A→B', callback_data: 'tri_move_A_B' },
        { text: '🔴→🟢 A→C', callback_data: 'tri_move_A_C' }
      ],
      [
        { text: '🔵→🔴 B→A', callback_data: 'tri_move_B_A' },
        { text: '🔵→🟢 B→C', callback_data: 'tri_move_B_C' }
      ],
      [
        { text: '🟢→🔴 C→A', callback_data: 'tri_move_C_A' },
        { text: '🟢→🔵 C→B', callback_data: 'tri_move_C_B' }
      ],
      [
        { text: '🔄 Пересчитать', callback_data: 'tri_regenerate' },
        { text: '♻️ Авто-баланс', callback_data: 'tri_auto_balance' }
      ],
      [
        { text: '✅ Принять', callback_data: 'tri_accept_edit' },
        { text: '❌ Отмена', callback_data: 'tri_cancel_edit' }
      ]
    ];

    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });

  } catch (error: any) {
    // Если сообщение не изменилось, пробрасываем ошибку дальше для обработки
    if (error?.response?.error_code === 400 &&
        error?.response?.description?.includes('message is not modified')) {
      throw error;
    }

    logger.error('Error in refreshTriEditInterface:', error);

    // Пытаемся отредактировать сообщение с ошибкой
    try {
      await ctx.editMessageText('❌ Ошибка при обновлении интерфейса редактирования.');
    } catch {
      // Если и это не удалось, просто логируем
      logger.error('Failed to show error message in TRI edit interface');
    }
  }
};

export const triEditCommand = async (ctx: BotContext): Promise<void> => {
  try {
    if (!await checkAdminPrivateOnly(ctx)) {
      return;
    }

    if (!CONFIG.TRI_MODE_ENABLED) {
      await ctx.reply('❌ Режим трёх команд отключен в конфигурации.');
      return;
    }

    // Ищем открытую TRI сессию
    const gameSession = await prisma.gameSession.findFirst({
      where: {
        format: 'TRI',
        isInitialized: true,
        isClosed: false
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!gameSession) {
      await ctx.reply('❌ Нет активной открытой TRI сессии. Используйте /tri_init для создания.');
      return;
    }

    // Получаем составы команд
    const teamPlayerService = container.resolve(TeamPlayerService);
    const composition = await teamPlayerService.getThreeTeamComposition(gameSession.id);

    if (!composition) {
      await ctx.reply('❌ Не найдены составы команд.');
      return;
    }

    // Формируем сообщение с текущими составами
    const teamService = container.resolve(TeamService);

    const teamAWeight = composition.teamA.reduce((sum, p) => sum + teamService.getPlayerWeight(p), 0);
    const teamBWeight = composition.teamB.reduce((sum, p) => sum + teamService.getPlayerWeight(p), 0);
    const teamCWeight = composition.teamC.reduce((sum, p) => sum + teamService.getPlayerWeight(p), 0);

    const maxWeight = Math.max(teamAWeight, teamBWeight, teamCWeight);
    const minWeight = Math.min(teamAWeight, teamBWeight, teamCWeight);
    const difference = maxWeight - minWeight;

    const formatTeam = (players: any[], teamName: string, weight: number) => {
      const playersStr = players.map((p, i) => {
        const rating = teamService.getPlayerWeight(p).toFixed(1);
        return `${i + 1}. ${p.firstName} — ${rating}`;
      }).join('\n');
      return `<b>${teamName}</b> (${weight.toFixed(1)}):\n${playersStr}`;
    };

    let message = `⚽ <b>Редактирование TRI составов</b>\n\n`;
    message += formatTeam(composition.teamA, '🔴 Красная', teamAWeight) + '\n\n';
    message += formatTeam(composition.teamB, '🔵 Синяя', teamBWeight) + '\n\n';
    message += formatTeam(composition.teamC, '🟢 Зелёная', teamCWeight) + '\n\n';
    message += `📊 Разница в силе (макс-мин): ${difference.toFixed(2)} μ\n\n`;
    message += `💡 Выберите действие:`;

    const keyboard = [
      [
        { text: '🔴→🔵 A→B', callback_data: 'tri_move_A_B' },
        { text: '🔴→🟢 A→C', callback_data: 'tri_move_A_C' }
      ],
      [
        { text: '🔵→🔴 B→A', callback_data: 'tri_move_B_A' },
        { text: '🔵→🟢 B→C', callback_data: 'tri_move_B_C' }
      ],
      [
        { text: '🟢→🔴 C→A', callback_data: 'tri_move_C_A' },
        { text: '🟢→🔵 C→B', callback_data: 'tri_move_C_B' }
      ],
      [
        { text: '🔄 Пересчитать', callback_data: 'tri_regenerate' },
        { text: '♻️ Авто-баланс', callback_data: 'tri_auto_balance' }
      ],
      [
        { text: '✅ Принять', callback_data: 'tri_accept_edit' },
        { text: '❌ Отмена', callback_data: 'tri_cancel_edit' }
      ]
    ];

    await ctx.reply(message, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });

    logger.info(`TRI edit interface opened for session ${gameSession.id} by admin ${ctx.from?.id}`);

  } catch (error) {
    logger.error('Error in tri_edit command:', error);
    await ctx.reply('❌ Произошла ошибка при открытии редактора TRI составов.');
  }
};

// Функция для обработки перемещения игроков между командами
export const handleTriMove = async (ctx: BotContext, fromTeam: string, toTeam: string): Promise<void> => {
  try {
    // Ищем открытую TRI сессию
    const gameSession = await prisma.gameSession.findFirst({
      where: {
        format: 'TRI',
        isInitialized: true,
        isClosed: false
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!gameSession) {
      await ctx.answerCbQuery('❌ Нет активной TRI сессии');
      return;
    }

    const teamPlayerService = container.resolve(TeamPlayerService);
    const composition = await teamPlayerService.getThreeTeamComposition(gameSession.id);

    if (!composition) {
      await ctx.answerCbQuery('❌ Не найдены составы команд');
      return;
    }

    // Получаем игроков исходной команды
    let sourceTeam: any[] = [];
    if (fromTeam === 'A') sourceTeam = composition.teamA;
    else if (fromTeam === 'B') sourceTeam = composition.teamB;
    else if (fromTeam === 'C') sourceTeam = composition.teamC;

    if (sourceTeam.length === 0) {
      await ctx.answerCbQuery('❌ В исходной команде нет игроков');
      return;
    }

    // Создаем клавиатуру со списком игроков для перемещения
    const keyboard = sourceTeam.map((player, index) => [
      {
        text: `${index + 1}. ${player.firstName}`,
        callback_data: `tri_move_player_${fromTeam}_${toTeam}_${player.id}`
      }
    ]);
    keyboard.push([{ text: '← Назад', callback_data: 'tri_edit_back' }]);

    const teamNames = { A: '🔴 Красная', B: '🔵 Синяя', C: '🟢 Зелёная' };
    const message = `👤 <b>Выберите игрока для перемещения</b>\n\n` +
      `Из команды: ${teamNames[fromTeam as keyof typeof teamNames]}\n` +
      `В команду: ${teamNames[toTeam as keyof typeof teamNames]}`;

    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    });

    await ctx.answerCbQuery();

  } catch (error) {
    logger.error('Error in handleTriMove:', error);
    await ctx.answerCbQuery('❌ Ошибка при выборе игрока');
  }
};

// Функция для выполнения перемещения конкретного игрока
export const executeTriPlayerMove = async (ctx: BotContext, fromTeam: string, toTeam: string, playerId: number): Promise<void> => {
  try {
    // Ищем открытую TRI сессию
    const gameSession = await prisma.gameSession.findFirst({
      where: {
        format: 'TRI',
        isInitialized: true,
        isClosed: false
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!gameSession) {
      await ctx.answerCbQuery('❌ Нет активной TRI сессии');
      return;
    }

    // Получаем информацию об игроке
    const player = await prisma.player.findUnique({
      where: { id: playerId }
    });

    if (!player) {
      await ctx.answerCbQuery('❌ Игрок не найден');
      return;
    }

    // Обновляем запись в таблице TeamPlayer
    await prisma.teamPlayer.updateMany({
      where: {
        gameSessionId: gameSession.id,
        playerId: playerId,
        team: fromTeam
      },
      data: {
        team: toTeam
      }
    });

    await ctx.answerCbQuery(`✅ ${player.firstName} перемещен в команду ${toTeam}`);

    // Возвращаемся к главному экрану редактирования (редактируем сообщение)
    await refreshTriEditInterface(ctx);

    logger.info(`Player ${playerId} moved from team ${fromTeam} to team ${toTeam} in TRI session ${gameSession.id}`);

  } catch (error) {
    logger.error('Error in executeTriPlayerMove:', error);
    await ctx.answerCbQuery('❌ Ошибка при перемещении игрока');
  }
};

// Функция для пересчета текущих составов (без изменения игроков)
export const handleTriRecalculate = async (ctx: BotContext): Promise<void> => {
  try {
    await ctx.answerCbQuery('🔄 Пересчитываю составы...');

    // Обновляем интерфейс с актуальными данными (с временной меткой)
    await refreshTriEditInterface(ctx, true);
    logger.info(`TRI teams recalculated (display refreshed with timestamp)`);

  } catch (error) {
    logger.error('Error in handleTriRecalculate:', error);
    await ctx.answerCbQuery('❌ Ошибка при пересчете');
  }
};

// Функция для автоматической балансировки команд
export const handleTriAutoBalance = async (ctx: BotContext): Promise<void> => {
  try {
    // Ищем открытую TRI сессию
    const gameSession = await prisma.gameSession.findFirst({
      where: {
        format: 'TRI',
        isInitialized: true,
        isClosed: false
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!gameSession) {
      await ctx.answerCbQuery('❌ Нет активной TRI сессии');
      return;
    }

    const teamPlayerService = container.resolve(TeamPlayerService);
    const composition = await teamPlayerService.getThreeTeamComposition(gameSession.id);

    if (!composition) {
      await ctx.answerCbQuery('❌ Не найдены составы команд');
      return;
    }

    // Собираем всех игроков
    const allPlayers = [...composition.teamA, ...composition.teamB, ...composition.teamC];

    if (allPlayers.length !== 24) {
      await ctx.answerCbQuery('❌ Неполный состав команд');
      return;
    }

    // Генерируем новые сбалансированные команды
    const teamService = container.resolve(TeamService);
    const newBalance = await teamService.generateThreeTeams(allPlayers);

    // Сохраняем новые составы
    await teamPlayerService.saveThreeTeamComposition(
      gameSession.id,
      newBalance.teamA.players,
      newBalance.teamB.players,
      newBalance.teamC.players
    );

    await ctx.answerCbQuery('✅ Команды автоматически сбалансированы');

    // Обновляем интерфейс (редактируем сообщение)
    await refreshTriEditInterface(ctx);

    logger.info(`TRI teams auto-balanced for session ${gameSession.id} by admin ${ctx.from?.id}`);

  } catch (error) {
    logger.error('Error in handleTriAutoBalance:', error);
    await ctx.answerCbQuery('❌ Ошибка при автобалансировке');
  }
};

export const triMvpCommand = async (ctx: BotContext): Promise<void> => {
  try {
    if (!await checkAdminPrivateOnly(ctx)) {
      return;
    }

    if (!CONFIG.TRI_MODE_ENABLED) {
      await ctx.reply('❌ Режим трёх команд отключен в конфигурации.');
      return;
    }

    const text = ('text' in ctx.message! && ctx.message.text) ? ctx.message.text.replace('/tri_mvp', '').trim() : '';
    const args = text.split(' ').filter(Boolean);

    if (args.length === 0 || args.length > 3) {
      await ctx.reply(
        '🏆 <b>Назначение MVP для TRI режима</b>\n\n' +
        '<b>Использование:</b> <code>/tri_mvp @username1 [@username2] [@username3]</code>\n\n' +
        '• Максимум 3 MVP (по одному из каждой команды)\n' +
        '• Можно указать 1, 2 или 3 игроков\n' +
        '• Каждый MVP должен быть из разной команды',
        { parse_mode: 'HTML' }
      );
      return;
    }

    // Ищем подтвержденную (возможно закрытую) TRI сессию
    const gameSession = await prisma.gameSession.findFirst({
      where: {
        format: 'TRI',
        isConfirmed: true
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!gameSession) {
      await ctx.reply('❌ Нет подтвержденной TRI сессии.');
      return;
    }

    if (!gameSession.isConfirmed) {
      await ctx.reply('❌ TRI команды не подтверждены. Используйте /tri_confirm.');
      return;
    }

    // Получаем составы команд
    const teamPlayerService = container.resolve(TeamPlayerService);
    const composition = await teamPlayerService.getThreeTeamComposition(gameSession.id);

    if (!composition) {
      await ctx.reply('❌ Составы команд не найдены.');
      return;
    }

    // Находим игроков по username и определяем их команды
    const mvpPlayers: { id: number; firstName: string; username: string; team: string }[] = [];

    for (const usernameArg of args) {
      const username = usernameArg.replace('@', '');
      let found = false;

      // Ищем в команде A (красная)
      const playerA = composition.teamA.find(p => p.username === username);
      if (playerA) {
        mvpPlayers.push({ id: playerA.id, firstName: playerA.firstName, username, team: 'A' });
        found = true;
      }

      // Ищем в команде B (синяя)
      if (!found) {
        const playerB = composition.teamB.find(p => p.username === username);
        if (playerB) {
          mvpPlayers.push({ id: playerB.id, firstName: playerB.firstName, username, team: 'B' });
          found = true;
        }
      }

      // Ищем в команде C (зелёная)
      if (!found) {
        const playerC = composition.teamC.find(p => p.username === username);
        if (playerC) {
          mvpPlayers.push({ id: playerC.id, firstName: playerC.firstName, username, team: 'C' });
          found = true;
        }
      }

      if (!found) {
        await ctx.reply(`❌ Игрок @${username} не найден в составах TRI команд`);
        return;
      }
    }

    // Проверяем, что не более одного MVP на команду
    const teamCounts = { A: 0, B: 0, C: 0 };
    mvpPlayers.forEach(p => teamCounts[p.team as keyof typeof teamCounts]++);

    if (teamCounts.A > 1 || teamCounts.B > 1 || teamCounts.C > 1) {
      await ctx.reply('❌ Максимум один MVP на команду');
      return;
    }

    // Проверяем, не были ли уже назначены MVP для этой TRI сессии
    const existingMvpEvents = await prisma.ratingEvent.findMany({
      where: {
        reason: 'mvp',
        meta: {
          path: ['matchId'],
          equals: gameSession.id
        }
      },
      include: { player: true }
    });

    if (existingMvpEvents.length > 0) {
      const existingMvpNames = existingMvpEvents.map(e => {
        const meta = e.meta as any;
        const team = meta?.team || 'Unknown';
        return `${e.player.firstName} (${team})`;
      }).join(', ');
      await ctx.reply(`⚠️ MVP уже назначены для этой TRI сессии: ${existingMvpNames}`);
      return;
    }

    // Применяем MVP бонусы
    const mvpIds = mvpPlayers.map(p => p.id);

    await prisma.$transaction([
      // Обновляем μ рейтинг MVP игроков
      ...mvpIds.map(id =>
        prisma.player.update({
          where: { id },
          data: {
            tsMu: { increment: CONFIG.RATING_MVP_MU_BONUS },
            mvpCount: { increment: 1 }
          }
        })
      ),
      // Создаем события MVP
      ...mvpIds.map(id => {
        const mvpPlayer = mvpPlayers.find(p => p.id === id)!;
        const teamNames = { A: '🔴 Красная', B: '🔵 Синяя', C: '🟢 Зелёная' };
        return prisma.ratingEvent.create({
          data: {
            playerId: id,
            muBefore: 0,
            muAfter: 0,
            sigmaBefore: 0,
            sigmaAfter: 0,
            reason: 'mvp',
            meta: {
              bonus: CONFIG.RATING_MVP_MU_BONUS,
              team: mvpPlayer.team,
              teamName: teamNames[mvpPlayer.team as keyof typeof teamNames],
              matchId: gameSession.id
            }
          }
        });
      })
    ]);

    // Формируем ответ
    const teamNames = { A: '🔴 Красная', B: '🔵 Синяя', C: '🟢 Зелёная' };
    const mvpList = mvpPlayers.map(p =>
      `${p.firstName} (@${p.username}) - ${teamNames[p.team as keyof typeof teamNames]}`
    ).join('\n');

    await ctx.reply(
      `🏆 <b>MVP назначены для TRI игры:</b>\n\n${mvpList}\n\n` +
      `💫 Бонус: +${CONFIG.RATING_MVP_MU_BONUS} к рейтингу каждому`,
      { parse_mode: 'HTML' }
    );

    logger.info(`TRI MVP assigned for session ${gameSession.id}: ${mvpPlayers.map(p => `${p.firstName} (${p.team})`).join(', ')} by admin ${ctx.from?.id}`);

  } catch (error) {
    logger.error('Error in tri_mvp command:', error);
    await ctx.reply('❌ Произошла ошибка при назначении MVP.');
  }
};

export const triResultsCommand = async (ctx: BotContext): Promise<void> => {
  try {
    if (!await checkAdminPrivateOnly(ctx)) {
      return;
    }

    if (!CONFIG.TRI_MODE_ENABLED) {
      await ctx.reply('❌ Режим трёх команд отключен в конфигурации.');
      return;
    }

    // Получаем текст результатов
    let resultsText = '';
    if (ctx.message && 'text' in ctx.message) {
      resultsText = ctx.message.text?.replace('/tri_results', '').trim() || '';
    }

    if (!resultsText) {
      await ctx.reply(
        '❌ Не указаны результаты матчей.\n\n' +
        '📝 <b>Формат команды:</b>\n' +
        '<code>/tri_results\n' +
        'A 5-3 B\n' +
        'A 2-4 C\n' +
        'C 1-0 B</code>\n\n' +
        '🎯 <b>Поддерживаемые форматы строк:</b>\n' +
        '• <code>A 5-3 B</code>\n' +
        '• <code>A-B 5:3</code>\n' +
        '• <code>AB 5 3</code>',
        { parse_mode: 'HTML' }
      );
      return;
    }

    // Ищем открытую TRI сессию (не привязанную к текущей неделе)
    const gameSession = await prisma.gameSession.findFirst({
      where: {
        format: 'TRI',
        isConfirmed: true,
        isClosed: false
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!gameSession) {
      await ctx.reply('❌ Нет активной открытой TRI сессии. Используйте /tri_init для создания.');
      return;
    }

    // Парсим результаты
    const { results, errors } = parseTriResults(resultsText);

    if (errors.length > 0) {
      await ctx.reply(
        `❌ <b>Ошибки парсинга:</b>\n\n${errors.join('\n')}\n\n` +
        '💡 Исправьте ошибки и попробуйте снова.',
        { parse_mode: 'HTML' }
      );
      return;
    }

    if (results.length === 0) {
      await ctx.reply('❌ Не найдено валидных результатов для обработки.');
      return;
    }

    await ctx.reply(`🔄 Обрабатываю ${results.length} результат(ов)...`);

    // Получаем составы команд
    const teamPlayerService = container.resolve(TeamPlayerService);
    const { teamAIds, teamBIds, teamCIds } = await teamPlayerService.getThreeTeamIds(gameSession.id);

    if (teamAIds.length !== 8 || teamBIds.length !== 8 || teamCIds.length !== 8) {
      await ctx.reply('❌ Некорректные составы команд. Каждая команда должна иметь ровно 8 игроков.');
      return;
    }

    const teamIds = { A: teamAIds, B: teamBIds, C: teamCIds };

    // Создаем записи мини-матчей
    const ratingService = container.resolve(RatingService);
    let processedCount = 0;
    let ratingUpdatesCount = 0;
    let firstMatchForInflation = true;

    for (let i = 0; i < results.length; i++) {
      const result = results[i];

      try {
        // Создаем запись мини-матча
        await prisma.triMiniMatch.create({
          data: {
            sessionId: gameSession.id,
            seq: i + 1,
            t1: result.t1,
            t2: result.t2,
            s1: result.s1,
            s2: result.s2,
            winner: result.winner,
            ratingApplied: result.winner !== null
          }
        });

        processedCount++;

        // Обновляем рейтинги для всех матчей (победы и ничьи)
        if (result.winner) {
          const winnerIds = teamIds[result.winner as 'A' | 'B' | 'C'];

          // Правильно определяем проигравшую команду
          const loserTeam = result.winner === result.t1 ? result.t2 : result.t1;
          const loserIds = teamIds[loserTeam as 'A' | 'B' | 'C'];

          logger.info(`TRI match: ${result.t1} ${result.s1}-${result.s2} ${result.t2}, winner: ${result.winner}, loser: ${loserTeam}`);

          await ratingService.updateTrueSkill(winnerIds, loserIds, {
            matchPlayedAt: gameSession.createdAt,
            applyIdleInflation: firstMatchForInflation, // Только для первого матча
            weight: CONFIG.TRI_MINI_MATCH_WEIGHT
          });

          ratingUpdatesCount++;
          firstMatchForInflation = false; // Отключаем для последующих матчей
        } else {
          // Обрабатываем ничью с новой системой рейтинга
          const team1Ids = teamIds[result.t1 as 'A' | 'B' | 'C'];
          const team2Ids = teamIds[result.t2 as 'A' | 'B' | 'C'];

          logger.info(`TRI draw: ${result.t1} ${result.s1}-${result.s2} ${result.t2}`);

          await ratingService.updateTrueSkillDraw(team1Ids, team2Ids, {
            matchPlayedAt: gameSession.createdAt,
            applyIdleInflation: firstMatchForInflation,
            weight: CONFIG.TRI_MINI_MATCH_WEIGHT
          });

          ratingUpdatesCount++;
          firstMatchForInflation = false;
        }

      } catch (error) {
        logger.error(`Error processing TRI match ${i + 1}:`, error);
      }
    }

    // Создаем основную запись матча для истории
    const statisticsService = container.resolve(StatisticsService);
    await statisticsService.saveMatchResult(gameSession.id, -1, -1); // TRI формат - специальные значения

    // Закрываем сессию после обработки результатов
    await prisma.gameSession.update({
      where: { id: gameSession.id },
      data: { isClosed: true }
    });

    // Формируем отчет
    let reportMessage = `✅ <b>Обработка завершена!</b>\n\n`;
    reportMessage += `📊 <b>Статистика:</b>\n`;
    reportMessage += `• Обработано строк: ${processedCount}/${results.length}\n`;
    reportMessage += `• Обновлений рейтинга: ${ratingUpdatesCount}\n`;
    reportMessage += `• Ничьих (с обновлением): ${results.filter(r => r.winner === null).length}\n\n`;

    if (results.length > 0) {
      reportMessage += `🎯 <b>Первые результаты:</b>\n`;
      results.slice(0, Math.min(5, results.length)).forEach((result, i) => {
        const scoreStr = `${result.s1}-${result.s2}`;
        const winnerStr = result.winner ? ` (победа ${result.winner})` : ' (ничья)';
        reportMessage += `${i + 1}. ${result.t1} ${scoreStr} ${result.t2}${winnerStr}\n`;
      });

      if (results.length > 5) {
        reportMessage += `... и ещё ${results.length - 5} матч(ей)\n`;
      }
    }

    reportMessage += `\n💡 Рейтинги обновлены с весом ${CONFIG.TRI_MINI_MATCH_WEIGHT}`;

    await ctx.reply(reportMessage, { parse_mode: 'HTML' });

    logger.info(`TRI results processed: ${processedCount} matches, ${ratingUpdatesCount} rating updates for session ${gameSession.id} by admin ${ctx.from?.id}`);

  } catch (error) {
    logger.error('Error in tri_results command:', error);
    await ctx.reply('❌ Произошла ошибка при обработке результатов TRI.');
  }
};

// Команда для просмотра статуса всех TRI сессий
export const triStatusCommand = async (ctx: BotContext): Promise<void> => {
  try {
    if (!await checkAdminPrivateOnly(ctx)) {
      return;
    }

    if (!CONFIG.TRI_MODE_ENABLED) {
      await ctx.reply('❌ Режим трёх команд отключен в конфигурации.');
      return;
    }

    const sessions = await prisma.gameSession.findMany({
      where: { format: 'TRI' },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    if (sessions.length === 0) {
      await ctx.reply('📋 Нет TRI сессий в системе.');
      return;
    }

    let message = `📋 <b>Статус TRI сессий (последние 10):</b>\n\n`;

    sessions.forEach((session, index) => {
      const statusIcon = session.isClosed ? '🔒' : '🔓';
      const confirmedIcon = session.isConfirmed ? '✅' : '⏳';
      const initIcon = session.isInitialized ? '🎯' : '📝';
      
      const date = session.createdAt.toLocaleDateString('ru-RU');
      const time = session.createdAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      
      message += `${index + 1}. ${statusIcon} Сессия #${session.id} (${date} ${time})\n`;
      message += `   ${initIcon} Инициализована: ${session.isInitialized ? 'Да' : 'Нет'}\n`;
      message += `   ${confirmedIcon} Подтверждена: ${session.isConfirmed ? 'Да' : 'Нет'}\n`;
      message += `   ${statusIcon} Закрыта: ${session.isClosed ? 'Да' : 'Нет'}\n\n`;
    });

    // Показываем активную открытую сессию отдельно
    const openSession = sessions.find(s => !s.isClosed && s.isConfirmed);
    if (openSession) {
      message += `🎮 <b>Активная открытая сессия:</b> #${openSession.id}\n`;
      message += `💡 Эта сессия будет закрыта при вводе результатов через /tri_results`;
    } else {
      message += `✨ <b>Нет активных открытых сессий</b>\n`;
      message += `💡 Создайте новую через /tri_init`;
    }

    await ctx.reply(message, { parse_mode: 'HTML' });

  } catch (error) {
    logger.error('Error in tri_status command:', error);
    await ctx.reply('❌ Произошла ошибка при получении статуса TRI сессий.');
  }
};