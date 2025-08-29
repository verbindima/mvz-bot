"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.migrateTriHistory = migrateTriHistory;
require("reflect-metadata");
const database_1 = require("../src/utils/database");
async function migrateTriHistory() {
    try {
        console.log('🔍 Поиск TRI сессий без MatchResult записей...');
        // Находим все TRI сессии с мини-матчами, но без MatchResult
        const triSessions = await database_1.prisma.gameSession.findMany({
            where: {
                format: 'TRI',
                matchResult: null,
                triMatches: {
                    some: {} // Есть хотя бы один мини-матч
                }
            },
            include: {
                triMatches: true
            }
        });
        console.log(`📊 Найдено ${triSessions.length} TRI сессий для миграции`);
        if (triSessions.length === 0) {
            console.log('✅ Все TRI сессии уже имеют MatchResult записи');
            return;
        }
        let migratedCount = 0;
        for (const session of triSessions) {
            try {
                console.log(`\n🔄 Обрабатываю TRI сессию ${session.id} (неделя ${session.week}-${session.year})`);
                console.log(`   📝 Мини-матчей: ${session.triMatches.length}`);
                // Создаем MatchResult запись для TRI сессии
                // Используем счет 0-0 так как в TRI нет единого счета
                await database_1.prisma.matchResult.create({
                    data: {
                        gameSessionId: session.id,
                        teamAScore: 0,
                        teamBScore: 0,
                        winnerTeam: 'TRI', // Специальное значение для TRI формата
                        createdAt: session.createdAt
                    }
                });
                migratedCount++;
                console.log(`   ✅ Создана MatchResult запись для сессии ${session.id}`);
            }
            catch (error) {
                console.error(`   ❌ Ошибка при миграции сессии ${session.id}:`, error);
            }
        }
        console.log(`\n🎉 Миграция завершена!`);
        console.log(`✅ Обработано: ${migratedCount}/${triSessions.length} TRI сессий`);
        if (migratedCount > 0) {
            console.log(`\n💡 Теперь TRI игры будут отображаться в статистике как "Легендарный турнир МВЗ"`);
        }
    }
    catch (error) {
        console.error('❌ Ошибка при миграции TRI истории:', error);
        throw error;
    }
}
// Запуск скрипта
if (require.main === module) {
    migrateTriHistory()
        .then(() => {
        console.log('✅ Скрипт миграции завершен');
        process.exit(0);
    })
        .catch((error) => {
        console.error('💥 Скрипт завершился с ошибкой:', error);
        process.exit(1);
    });
}
