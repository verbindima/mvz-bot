import { container } from 'tsyringe';
import { BotContext } from '../bot';
import { CONFIG, MESSAGES } from '../config';
import { TeamService } from '../services/team.service';
import { TeamPlayerService } from '../services/team-player.service';
import { RatingService } from '../services/rating.service';
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

    // Проверяем, есть ли уже активная DUO игра
    const existingSession = await prisma.gameSession.findUnique({
      where: { week_year: { week, year } }
    });

    if (existingSession && existingSession.format === 'DUO' && existingSession.isConfirmed) {
      await ctx.reply('❌ На этой неделе уже активна обычная игра 2×8. Завершите её перед запуском TRI режима.');
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

    logger.info(`TRI teams generated for week ${year}-${week} by admin ${ctx.from?.id}`);

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

    const { week, year } = getCurrentWeek();

    const gameSession = await prisma.gameSession.findUnique({
      where: { week_year: { week, year } }
    });

    if (!gameSession) {
      await ctx.reply('❌ Нет активной TRI сессии. Используйте /tri_init для создания.');
      return;
    }

    if (gameSession.format !== 'TRI') {
      await ctx.reply('❌ Текущая сессия не является TRI форматом.');
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
    teamBalance.teamB.totalRating = composition.teamB.reduce((sum, p) => sum + teamService.getPlayerWeight(p), 0);
    teamBalance.teamC.totalRating = composition.teamC.reduce((sum, p) => sum + teamService.getPlayerWeight(p), 0);

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

    logger.info(`TRI teams confirmed for week ${year}-${week} by admin ${ctx.from?.id}`);

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

    const { week, year } = getCurrentWeek();

    const gameSession = await prisma.gameSession.findUnique({
      where: { week_year: { week, year } }
    });

    if (!gameSession || gameSession.format !== 'TRI') {
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

    logger.info(`TRI session cancelled for week ${year}-${week} by admin ${ctx.from?.id}`);

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

    // Проверяем TRI сессию
    const { week, year } = getCurrentWeek();
    const gameSession = await prisma.gameSession.findUnique({
      where: { week_year: { week, year } }
    });

    if (!gameSession || gameSession.format !== 'TRI') {
      await ctx.reply('❌ Нет активной TRI сессии. Используйте /tri_init для создания.');
      return;
    }

    if (!gameSession.isConfirmed) {
      await ctx.reply('❌ TRI команды не подтверждены. Используйте /tri_confirm.');
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

        // Обновляем рейтинги только если есть победитель
        if (result.winner) {
          const winnerIds = teamIds[result.winner as 'A' | 'B' | 'C'];
          const loserIds = teamIds[(result.winner === result.t1 ? result.t2 : result.t1) as 'A' | 'B' | 'C'];

          await ratingService.updateTrueSkill(winnerIds, loserIds, {
            matchPlayedAt: gameSession.createdAt,
            applyIdleInflation: firstMatchForInflation, // Только для первого матча
            weight: CONFIG.TRI_MINI_MATCH_WEIGHT
          });

          ratingUpdatesCount++;
          firstMatchForInflation = false; // Отключаем для последующих матчей
        }

      } catch (error) {
        logger.error(`Error processing TRI match ${i + 1}:`, error);
      }
    }

    // Формируем отчет
    let reportMessage = `✅ <b>Обработка завершена!</b>\n\n`;
    reportMessage += `📊 <b>Статистика:</b>\n`;
    reportMessage += `• Обработано строк: ${processedCount}/${results.length}\n`;
    reportMessage += `• Обновлений рейтинга: ${ratingUpdatesCount}\n`;
    reportMessage += `• Ничьих (без обновления): ${processedCount - ratingUpdatesCount}\n\n`;

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

    logger.info(`TRI results processed: ${processedCount} matches, ${ratingUpdatesCount} rating updates for week ${year}-${week} by admin ${ctx.from?.id}`);

  } catch (error) {
    logger.error('Error in tri_results command:', error);
    await ctx.reply('❌ Произошла ошибка при обработке результатов TRI.');
  }
};