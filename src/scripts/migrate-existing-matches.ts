import 'reflect-metadata';
import { prisma } from '../utils/database';
import { container } from 'tsyringe';
import { PairService } from '../services/pair.service';
import { logger } from '../utils/logger';

interface MatchData {
  id: number;
  week: number;
  year: number;
  teamAPlayers: number[];
  teamBPlayers: number[];
  winnerTeam: 'A' | 'B' | 'DRAW';
  matchDate: Date;
}

async function getExistingMatches(): Promise<MatchData[]> {
  console.log('🔍 Поиск завершенных матчей...');
  
  // Получаем все игровые сессии с результатами
  const sessions = await prisma.gameSession.findMany({
    where: {
      matchResult: {
        isNot: null
      }
    },
    include: {
      matchResult: true,
      teamPlayers: {
        include: {
          player: true
        }
      }
    },
    orderBy: {
      createdAt: 'asc'
    }
  });

  const matches: MatchData[] = [];

  for (const session of sessions) {
    if (!session.matchResult) continue;

    const teamAPlayers = session.teamPlayers
      .filter(tp => tp.team === 'A')
      .map(tp => tp.playerId);
    
    const teamBPlayers = session.teamPlayers
      .filter(tp => tp.team === 'B')
      .map(tp => tp.playerId);

    // Проверяем, что у нас есть игроки в обеих командах
    if (teamAPlayers.length === 0 || teamBPlayers.length === 0) {
      console.warn(`⚠️  Матч ${session.week}-${session.year} пропущен: неполные составы команд`);
      continue;
    }

    matches.push({
      id: session.id,
      week: session.week,
      year: session.year,
      teamAPlayers,
      teamBPlayers,
      winnerTeam: session.matchResult.winnerTeam as 'A' | 'B' | 'DRAW',
      matchDate: session.matchResult.createdAt
    });
  }

  return matches;
}

async function migrateExistingMatches() {
  try {
    console.log('🚀 Начинаем миграцию существующих матчей...\n');

    // Получаем все завершенные матчи
    const matches = await getExistingMatches();
    
    if (matches.length === 0) {
      console.log('ℹ️  Завершенных матчей не найдено. Миграция не требуется.');
      return;
    }

    console.log(`📊 Найдено ${matches.length} завершенных матчей для миграции:\n`);

    // Показываем найденные матчи
    matches.forEach((match, index) => {
      console.log(`${index + 1}. Неделя ${match.year}-${match.week}: команда ${match.winnerTeam === 'DRAW' ? 'ничья' : match.winnerTeam} (${match.matchDate.toLocaleDateString('ru-RU')})`);
      console.log(`   Команда A: ${match.teamAPlayers.length} игроков`);
      console.log(`   Команда B: ${match.teamBPlayers.length} игроков\n`);
    });

    // Инициализируем PairService
    const pairService = container.resolve(PairService);

    console.log('⚙️  Обрабатываем матчи...\n');

    // Обрабатываем каждый матч
    let processedCount = 0;
    for (const match of matches) {
      try {
        console.log(`🔄 Обрабатываем матч ${match.year}-${match.week}...`);

        let winnerIds: number[], loserIds: number[];

        if (match.winnerTeam === 'A') {
          winnerIds = match.teamAPlayers;
          loserIds = match.teamBPlayers;
        } else if (match.winnerTeam === 'B') {
          winnerIds = match.teamBPlayers;
          loserIds = match.teamAPlayers;
        } else {
          // Ничья - обрабатываем как если бы обе команды "выиграли" частично
          // Для простоты можем считать команду A "победителем" в ничьей
          console.log('   Ничья - обрабатываем как победу команды A');
          winnerIds = match.teamAPlayers;
          loserIds = match.teamBPlayers;
        }

        // Обновляем статистику пар
        await pairService.updateAfterMatch(winnerIds, loserIds, match.matchDate);
        
        processedCount++;
        console.log(`   ✅ Матч обработан (${processedCount}/${matches.length})\n`);

      } catch (error) {
        console.error(`❌ Ошибка при обработке матча ${match.year}-${match.week}:`, error);
      }
    }

    // Показываем итоговую статистику
    console.log('📈 Проверяем результаты миграции...\n');
    
    const totalPairs = await prisma.playerPair.count();
    const activePairs = await prisma.playerPair.count({
      where: {
        OR: [
          { togetherGames: { gt: 0 } },
          { vsGames: { gt: 0 } }
        ]
      }
    });

    console.log(`📊 Статистика после миграции:`);
    console.log(`   Всего пар в базе: ${totalPairs}`);
    console.log(`   Пар с игровой историей: ${activePairs}`);
    console.log(`   Обработано матчей: ${processedCount}/${matches.length}`);

    // Показываем топ-5 самых активных пар
    const topPairs = await prisma.playerPair.findMany({
      where: {
        togetherGames: { gt: 0 }
      },
      include: {
        playerA: { select: { firstName: true } },
        playerB: { select: { firstName: true } }
      },
      orderBy: {
        togetherGames: 'desc'
      },
      take: 5
    });

    if (topPairs.length > 0) {
      console.log(`\n🤝 Топ-5 самых частых партнерств:`);
      topPairs.forEach((pair, index) => {
        const winRate = pair.togetherGames > 0 ? (pair.togetherWins / pair.togetherGames * 100).toFixed(1) : '0';
        console.log(`   ${index + 1}. ${pair.playerA.firstName} + ${pair.playerB.firstName}: ${pair.togetherGames} игр, ${winRate}% побед`);
      });
    }

    console.log('\n✅ Миграция завершена успешно!');
    console.log('🧪 Система химии команд готова к использованию.');

  } catch (error) {
    console.error('❌ Ошибка при миграции:', error);
    throw error;
  }
}

// Запуск скрипта
if (require.main === module) {
  migrateExistingMatches()
    .then(() => {
      console.log('\n🎉 Скрипт миграции выполнен успешно!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Скрипт миграции завершился с ошибкой:', error);
      process.exit(1);
    });
}

export { migrateExistingMatches };