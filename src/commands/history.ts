import { BotContext } from '../bot';
import { CONFIG } from '../config';
import { prisma } from '../utils/database';
import { container } from 'tsyringe';
import { RatingService } from '../services/rating.service';
import { StatisticsService } from '../services/statistics.service';
import { TeamPlayerService } from '../services/team-player.service';

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

        // Создаем или получаем игровую сессию
        const gameSession = await prisma.gameSession.upsert({
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

        // Сохраняем составы команд для статистики
        const teamPlayerService = container.resolve(TeamPlayerService);
        const teamAPlayerObjects = await prisma.player.findMany({
          where: { id: { in: teamAPlayers } }
        });
        const teamBPlayerObjects = await prisma.player.findMany({
          where: { id: { in: teamBPlayers } }
        });

        await teamPlayerService.saveTeamComposition(
          gameSession.id,
          teamAPlayerObjects,
          teamBPlayerObjects
        );

        // Сохраняем результат матча для статистики
        const statisticsService = container.resolve(StatisticsService);
        const teamAScore = team1 === 'A' ? score1 : score2;
        const teamBScore = team1 === 'A' ? score2 : score1;

        await statisticsService.saveMatchResult(gameSession.id, teamAScore, teamBScore);

        // Определяем победителей и проигравших, обновляем TrueSkill
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

        results.push(`✅ Неделя ${week}/${year}: ${team1} ${score1}-${score2} ${team2} (статистика обновлена)`);
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

    await ctx.reply('Команда /bulk_rate больше не поддерживается. Система капитанских рейтингов удалена.');
  } catch (error) {
    console.error('Error in bulk rate command:', error);
    await ctx.reply('Произошла ошибка при обработке команды.');
  }
};