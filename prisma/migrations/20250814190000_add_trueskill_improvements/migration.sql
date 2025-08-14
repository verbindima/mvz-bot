-- CreateEnum
CREATE TYPE "RatingEventReason" AS ENUM ('match', 'idle', 'mvp');

-- AlterTable
ALTER TABLE "players" ADD COLUMN "firstPlayedAt" TIMESTAMP(6),
ADD COLUMN "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastPlayedAt" TIMESTAMP(6),
ADD COLUMN "mvpCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "rating_events" (
    "id" SERIAL NOT NULL,
    "playerId" INTEGER NOT NULL,
    "matchId" INTEGER,
    "muBefore" DOUBLE PRECISION NOT NULL,
    "muAfter" DOUBLE PRECISION NOT NULL,
    "sigmaBefore" DOUBLE PRECISION NOT NULL,
    "sigmaAfter" DOUBLE PRECISION NOT NULL,
    "reason" "RatingEventReason" NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rating_events_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "rating_events" ADD CONSTRAINT "rating_events_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Initialize firstPlayedAt and gamesPlayed for existing players
UPDATE "players" 
SET "firstPlayedAt" = "createdAt",
    "gamesPlayed" = (
        SELECT COUNT(*) 
        FROM "week_entries" we 
        WHERE we."playerId" = "players"."id"
    )
WHERE "players"."id" IN (
    SELECT DISTINCT "playerId" 
    FROM "week_entries"
);