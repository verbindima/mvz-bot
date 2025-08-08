-- CreateTable
CREATE TABLE "players" (
    "id" SERIAL NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "username" TEXT,
    "firstName" TEXT NOT NULL,
    "skillSelf" INTEGER NOT NULL DEFAULT 3,
    "skillCaptain" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tsMu" DOUBLE PRECISION NOT NULL DEFAULT 25,
    "tsSigma" DOUBLE PRECISION NOT NULL DEFAULT 8.333,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "week_entries" (
    "id" SERIAL NOT NULL,
    "week" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "playerId" INTEGER NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'MAIN',
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "paymentTime" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "week_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ratings" (
    "id" SERIAL NOT NULL,
    "matchId" INTEGER NOT NULL,
    "playerId" INTEGER NOT NULL,
    "delta" INTEGER NOT NULL,
    "scheme" TEXT NOT NULL DEFAULT 'captain',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_sessions" (
    "id" SERIAL NOT NULL,
    "week" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "teamA" TEXT NOT NULL,
    "teamB" TEXT NOT NULL,
    "isConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "isInitialized" BOOLEAN NOT NULL DEFAULT false,
    "paymentPhone" TEXT,
    "paymentBank" TEXT,
    "paymentAmount" DOUBLE PRECISION,
    "gameDate" TIMESTAMP(3),
    "gameLocation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_players" (
    "id" SERIAL NOT NULL,
    "gameSessionId" INTEGER NOT NULL,
    "playerId" INTEGER NOT NULL,
    "team" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_players_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "players_telegramId_key" ON "players"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "week_entries_week_year_playerId_key" ON "week_entries"("week", "year", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "game_sessions_week_year_key" ON "game_sessions"("week", "year");

-- CreateIndex
CREATE UNIQUE INDEX "team_players_gameSessionId_playerId_key" ON "team_players"("gameSessionId", "playerId");

-- AddForeignKey
ALTER TABLE "week_entries" ADD CONSTRAINT "week_entries_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_players" ADD CONSTRAINT "team_players_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "game_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_players" ADD CONSTRAINT "team_players_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;
