import { BotContext } from '../bot';
import { CONFIG } from '../config';
import { prisma } from '../utils/database';
import { container } from 'tsyringe';
import { RatingService } from '../services/rating.service';

export const addHistoryCommand = async (ctx: BotContext): Promise<void> => {
  try {
    if (!CONFIG.ADMINS.includes(ctx.from!.id)) {
      await ctx.reply('🚫 У вас нет доступа к этой команде');
      return;
    }

    const text = ('text' in ctx.message! && ctx.message.text) ? ctx.message.text : '';

    if (!text.includes('\n')) {
      await ctx.reply(
        `📋 <b>Добавление результатов матчей:</b>\n\n` +
        `Отправьте /add_history, затем список результатов:\n` +
        `week/year winner_team score loser_team\n` +
        `winner1,winner2,winner3,winner4,winner5,winner6,winner7,winner8\n` +
        `loser1,loser2,loser3,loser4,loser5,loser6,loser7,loser8\n\n` +
        `<b>Пример:</b>\n` +
        `/add_history\n` +
        `30/2024 A 5-3 B\n` +
        `user1,user2,user3,user4,user5,user6,user7,user8\n` +
        `user9,user10,user11,user12,user13,user14,user15,user16\n\n` +
        `Или просто результат без команд (обновит всех участников текущей недели):\n` +
        `/add_history\n` +
        `32/2024 A 7-2 B`
      , { parse_mode: 'HTML' });
      return;
    }

    const lines = text.split('\n').slice(1);
    const results: string[] = [];
    let processed = 0;
    let errors = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      try {
        // Парсим строку результата: week/year team score team
        const resultMatch = line.match(/^(\d+)\/(\d+)\s+([AB])\s+(\d+)-(\d+)\s+([AB])$/);

        if (!resultMatch) {
          results.push(`❌ ${line} - неверный формат результата`);
          errors++;
          continue;
        }

        const [, weekStr, yearStr, team1, score1Str, score2Str, team2] = resultMatch;
        const week = parseInt(weekStr);
        const year = parseInt(yearStr);
        const score1 = parseInt(score1Str);
        const score2 = parseInt(score2Str);

        if (team1 === team2) {
          results.push(`❌ Неделя ${week}/${year} - команды должны быть разными`);
          errors++;
          continue;
        }

        // Проверяем, есть ли следующие 2 строки со списками игроков
        let teamAPlayers: number[] = [];
        let teamBPlayers: number[] = [];

        if (i + 2 < lines.length && lines[i + 1].includes(',') && lines[i + 2].includes(',')) {
          // Есть списки игроков
          const winnersLine = lines[i + 1].trim();
          const losersLine = lines[i + 2].trim();

          const winnerUsernames = winnersLine.split(',').map(u => u.trim().replace('@', ''));
          const loserUsernames = losersLine.split(',').map(u => u.trim().replace('@', ''));

          // Ищем игроков по username
          const winnerPlayers = await prisma.player.findMany({
            where: { username: { in: winnerUsernames } }
          });
          console.log(winnerPlayers)
          const loserPlayers = await prisma.player.findMany({
            where: { username: { in: loserUsernames } }
          });
          console.log(winnerPlayers.length, winnerUsernames.length, loserPlayers.length, loserUsernames.length)

          if (winnerPlayers.length !== winnerUsernames.length || loserPlayers.length !== loserUsernames.length) {
            const notFoundWinners = winnerUsernames.filter(u => !winnerPlayers.some(p => p.username === u));
            const notFoundLosers = loserUsernames.filter(u => !loserPlayers.some(p => p.username === u));

            let errorMsg = `❌ Неделя ${week}/${year} - игроки не найдены:`;
            if (notFoundWinners.length > 0) errorMsg += ` победители: ${notFoundWinners.join(', ')}`;
            if (notFoundLosers.length > 0) errorMsg += ` проигравшие: ${notFoundLosers.join(', ')}`;

            results.push(errorMsg);
            errors++;
            i += 2; // Пропускаем обе строки с игроками
            continue;
          }

          teamAPlayers = score1 > score2 ? winnerPlayers.map(p => p.id) : loserPlayers.map(p => p.id);
          teamBPlayers = score1 > score2 ? loserPlayers.map(p => p.id) : winnerPlayers.map(p => p.id);

          i += 2; // Пропускаем обе строки с игроками
        } else {
          // Нет списков игроков - используем игроков из той недели
          const weekPlayers = await prisma.weekEntry.findMany({
            where: { week, year, state: 'MAIN' },
            include: { player: true },
            orderBy: { createdAt: 'asc' }
          });

          if (weekPlayers.length !== 16) {
            results.push(`❌ Неделя ${week}/${year} - найдено ${weekPlayers.length} игроков вместо 16`);
            errors++;
            continue;
          }

          teamAPlayers = weekPlayers.slice(0, 8).map(entry => entry.playerId);
          teamBPlayers = weekPlayers.slice(8, 16).map(entry => entry.playerId);
        }

        // Определяем победителей и проигравших
        const ratingService = container.resolve(RatingService);

        if (score1 > score2) {
          const winners = team1 === 'A' ? teamAPlayers : teamBPlayers;
          const losers = team1 === 'A' ? teamBPlayers : teamAPlayers;
          await ratingService.updateTrueSkill(winners, losers);
        } else if (score2 > score1) {
          const winners = team2 === 'A' ? teamAPlayers : teamBPlayers;
          const losers = team2 === 'A' ? teamBPlayers : teamAPlayers;
          await ratingService.updateTrueSkill(winners, losers);
        }

        // Сохраняем результат матча
        await prisma.gameSession.upsert({
          where: { week_year: { week, year } },
          update: {
            teamA: team1 === 'A' ? `${score1}` : `${score2}`,
            teamB: team1 === 'B' ? `${score1}` : `${score2}`,
            isConfirmed: true,
          },
          create: {
            week,
            year,
            teamA: team1 === 'A' ? `${score1}` : `${score2}`,
            teamB: team1 === 'B' ? `${score1}` : `${score2}`,
            isConfirmed: true,
          },
        });

        results.push(`✅ Неделя ${week}/${year}: ${team1} ${score1}-${score2} ${team2}`);
        processed++;

      } catch (error) {
        results.push(`❌ ${line} - ошибка обработки: ${error}`);
        errors++;
      }
    }

    let message = `📊 <b>Результат добавления матчей:</b>\n\n`;
    message += `✅ Обработано: ${processed}\n`;
    message += `❌ Ошибок: ${errors}\n\n`;

    if (results.length > 0) {
      message += `<b>Детали:</b>\n${results.slice(0, 15).join('\n')}`;

      if (results.length > 15) {
        message += `\n... и еще ${results.length - 15} записей`;
      }
    }

    await ctx.reply(message, { parse_mode: 'HTML' });

  } catch (error) {
    console.error('Error in add history command:', error);
    await ctx.reply('Произошла ошибка при добавлении результатов.');
  }
};

export const bulkRateCommand = async (ctx: BotContext): Promise<void> => {
  try {
    if (!CONFIG.ADMINS.includes(ctx.from!.id)) {
      await ctx.reply('🚫 У вас нет доступа к этой команде');
      return;
    }

    const text = ('text' in ctx.message! && ctx.message.text) ? ctx.message.text : '';

    if (!text.includes('\n')) {
      await ctx.reply(
        `📋 <b>Массовое обновление рейтингов:</b>\n\n` +
        `Отправьте /bulk_rate, затем список:\n` +
        `username rating_change\n\n` +
        `<b>Пример:</b>\n` +
        `/bulk_rate\n` +
        `user1 +1\n` +
        `user2 +1\n` +
        `user3 0\n` +
        `user4 -1`
      , { parse_mode: 'HTML' });
      return;
    }

    const lines = text.split('\n').slice(1);
    const results: string[] = [];
    let processed = 0;
    let errors = 0;

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      try {
        const parts = trimmedLine.split(/\s+/);
        if (parts.length !== 2) {
          results.push(`❌ ${trimmedLine} - неверный формат`);
          errors++;
          continue;
        }

        const username = parts[0].replace('@', '');
        const delta = parseInt(parts[1]);

        if (isNaN(delta) || delta < -1 || delta > 1) {
          results.push(`❌ @${username} - рейтинг должен быть -1, 0 или +1`);
          errors++;
          continue;
        }

        const player = await prisma.player.findFirst({
          where: { username }
        });

        if (!player) {
          results.push(`❌ @${username} - игрок не найден`);
          errors++;
          continue;
        }

        // Обновляем рейтинг
        await prisma.player.update({
          where: { id: player.id },
          data: {
            skillCaptain: Math.max(0, Math.min(10, player.skillCaptain + delta)),
          },
        });

        await prisma.rating.create({
          data: {
            matchId: Math.floor(Date.now() / 1000),
            playerId: player.id,
            delta,
            scheme: 'captain',
          },
        });

        results.push(`✅ @${username} - ${delta > 0 ? '+' : ''}${delta}`);
        processed++;

      } catch (error) {
        results.push(`❌ ${trimmedLine} - ошибка обработки`);
        errors++;
      }
    }

    let message = `📊 <b>Результат обновления рейтингов:</b>\n\n`;
    message += `✅ Обработано: ${processed}\n`;
    message += `❌ Ошибок: ${errors}\n\n`;

    if (results.length > 0) {
      message += `<b>Детали:</b>\n${results.slice(0, 20).join('\n')}`;

      if (results.length > 20) {
        message += `\n... и еще ${results.length - 20} записей`;
      }
    }

    await ctx.reply(message, { parse_mode: 'HTML' });

  } catch (error) {
    console.error('Error in bulk rate command:', error);
    await ctx.reply('Произошла ошибка при массовом обновлении рейтингов.');
  }
};