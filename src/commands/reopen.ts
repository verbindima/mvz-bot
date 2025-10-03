import { container } from 'tsyringe';
import { BotContext } from '../bot';
import { CONFIG } from '../config';
import { checkAdminPrivateOnly } from '../utils/chat';
import { prisma } from '../utils/database';
import { logger } from '../utils/logger';

// Команда для отката последней закрытой DUO игры
export const reopenLastDuoCommand = async (ctx: BotContext): Promise<void> => {
  try {
    if (!await checkAdminPrivateOnly(ctx)) {
      return;
    }

    // Находим последнюю закрытую DUO сессию
    const lastClosedSession = await prisma.gameSession.findFirst({
      where: {
        format: 'DUO',
        isClosed: true
      },
      orderBy: { createdAt: 'desc' },
      include: {
        matchResult: true,
        teamPlayers: {
          include: {
            player: true
          }
        }
      }
    });

    if (!lastClosedSession) {
      await ctx.reply('❌ Не найдено закрытых DUO игр для отката.');
      return;
    }

    if (!lastClosedSession.matchResult) {
      await ctx.reply('❌ У найденной сессии нет результатов матча для отката.');
      return;
    }

    const sessionDate = lastClosedSession.createdAt.toLocaleDateString('ru-RU');
    const sessionTime = lastClosedSession.createdAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const matchResult = lastClosedSession.matchResult;
    
    // Показываем детали сессии и просим подтверждение
    const confirmMessage = 
      `⚠️ <b>ВНИМАНИЕ: Откат последней DUO игры</b>\n\n` +
      `📅 <b>Дата игры:</b> ${sessionDate} ${sessionTime}\n` +
      `🆔 <b>ID сессии:</b> ${lastClosedSession.id}\n` +
      `⚽ <b>Результат:</b> ${lastClosedSession.teamA} ${matchResult.teamAScore}-${matchResult.teamBScore} ${lastClosedSession.teamB}\n` +
      `👥 <b>Игроков:</b> ${lastClosedSession.teamPlayers.length}\n\n` +
      `<b>Будет выполнен откат:</b>\n` +
      `• TrueSkill рейтингов всех игроков\n` +
      `• Статистики Player Pairs\n` +
      `• MVP бонусов (если есть)\n` +
      `• Результата матча\n` +
      `• Сессия будет переоткрыта\n\n` +
      `❓ <b>Продолжить откат?</b>`;

    await ctx.reply(confirmMessage, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Да, откатить', callback_data: `confirm_reopen_${lastClosedSession.id}` },
            { text: '❌ Отмена', callback_data: 'cancel_reopen' }
          ]
        ]
      }
    });

    logger.info(`Reopen confirmation requested for DUO session ${lastClosedSession.id} by admin ${ctx.from?.id}`);

  } catch (error) {
    logger.error('Error in reopenLastDuo command:', error);
    await ctx.reply('❌ Произошла ошибка при поиске игры для отката.');
  }
};

// Функция выполнения отката после подтверждения
export const executeReopenDuo = async (ctx: BotContext, sessionId: number): Promise<void> => {
  try {
    await ctx.answerCbQuery('🔄 Выполняю откат...');

    // Получаем полную информацию о сессии
    const session = await prisma.gameSession.findUnique({
      where: { id: sessionId },
      include: {
        matchResult: true,
        teamPlayers: {
          include: {
            player: true
          }
        }
      }
    });

    if (!session || !session.matchResult) {
      await ctx.editMessageText('❌ Сессия не найдена или не имеет результатов.');
      return;
    }

    // Выполняем откат в транзакции
    await prisma.$transaction(async (tx) => {
      // 1. Откатываем TrueSkill рейтинги из RatingEvent
      const ratingEvents = await tx.ratingEvent.findMany({
        where: { matchId: sessionId },
        include: { player: true }
      });

      for (const event of ratingEvents) {
        await tx.player.update({
          where: { id: event.playerId },
          data: {
            tsMu: event.muBefore,
            tsSigma: event.sigmaBefore
          }
        });
      }

      // 2. Откатываем Player Pairs статистику
      const teamAPlayers = session.teamPlayers.filter(tp => tp.team === 'A').map(tp => tp.playerId);
      const teamBPlayers = session.teamPlayers.filter(tp => tp.team === 'B').map(tp => tp.playerId);
      
      const winnerTeamPlayers = session.matchResult!.teamAScore > session.matchResult!.teamBScore ? teamAPlayers : teamBPlayers;
      const loserTeamPlayers = session.matchResult!.teamAScore > session.matchResult!.teamBScore ? teamBPlayers : teamAPlayers;

      // Откатываем пары в выигравшей команде (убираем win)
      await rollbackPlayerPairs(tx, winnerTeamPlayers, 'win');
      
      // Откатываем пары в проигравшей команде (убираем loss)  
      await rollbackPlayerPairs(tx, loserTeamPlayers, 'loss');

      // 3. Удаляем MVP записи если есть
      const mvpEvents = await tx.ratingEvent.findMany({
        where: {
          matchId: sessionId,
          reason: 'mvp'
        }
      });

      for (const mvpEvent of mvpEvents) {
        const meta = mvpEvent.meta as any;
        const mvpBonus = meta?.bonus || CONFIG.RATING_MVP_MU_BONUS;
        
        await tx.player.update({
          where: { id: mvpEvent.playerId },
          data: {
            tsMu: { decrement: mvpBonus },
            mvpCount: { decrement: 1 }
          }
        });
      }

      // 4. Удаляем все рейтинговые события этого матча
      await tx.ratingEvent.deleteMany({
        where: { matchId: sessionId }
      });

      // 5. Удаляем результат матча
      await tx.matchResult.delete({
        where: { gameSessionId: sessionId }
      });

      // 6. Переоткрываем сессию
      await tx.gameSession.update({
        where: { id: sessionId },
        data: { isClosed: false }
      });
    });

    const successMessage = 
      `✅ <b>Откат успешно выполнен!</b>\n\n` +
      `🔓 Сессия #${sessionId} переоткрыта\n` +
      `↩️ Рейтинги игроков восстановлены\n` +
      `📊 Player Pairs статистика обновлена\n` +
      `🏆 MVP бонусы удалены\n\n` +
      `💡 Теперь можно ввести правильные результаты через /result`;

    await ctx.editMessageText(successMessage, { parse_mode: 'HTML' });

    logger.info(`DUO session ${sessionId} successfully reopened by admin ${ctx.from?.id}`);

  } catch (error) {
    logger.error(`Error executing reopen for session ${sessionId}:`, error);
    await ctx.editMessageText('❌ Произошла ошибка при выполнении отката.');
  }
};

// Вспомогательная функция для отката Player Pairs
async function rollbackPlayerPairs(tx: any, playerIds: number[], resultType: 'win' | 'loss'): Promise<void> {
  // Генерируем все пары игроков в команде
  for (let i = 0; i < playerIds.length; i++) {
    for (let j = i + 1; j < playerIds.length; j++) {
      const [p1, p2] = [playerIds[i], playerIds[j]].sort((a, b) => a - b);
      
      const pair = await tx.playerPair.findUnique({
        where: { 
          player1Id_player2Id: { player1Id: p1, player2Id: p2 }
        }
      });

      if (pair && pair.gamesPlayed > 0) {
        const newGamesPlayed = pair.gamesPlayed - 1;
        const newWins = resultType === 'win' ? Math.max(0, pair.wins - 1) : pair.wins;
        const newLosses = resultType === 'loss' ? Math.max(0, pair.losses - 1) : pair.losses;
        const newWinRate = newGamesPlayed > 0 ? newWins / newGamesPlayed : 0;

        await tx.playerPair.update({
          where: { 
            player1Id_player2Id: { player1Id: p1, player2Id: p2 }
          },
          data: {
            gamesPlayed: newGamesPlayed,
            wins: newWins,
            losses: newLosses,
            winRate: newWinRate
          }
        });
      }
    }
  }
}

// Обработчик отмены отката
export const handleCancelReopen = async (ctx: BotContext): Promise<void> => {
  try {
    await ctx.answerCbQuery('Откат отменен');
    await ctx.editMessageText('❌ Откат отменен администратором.');
    
    logger.info(`Reopen cancelled by admin ${ctx.from?.id}`);
  } catch (error) {
    logger.error('Error handling cancel reopen:', error);
  }
};