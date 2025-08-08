/*
  Warnings:

  - Made the column `teamA` on table `game_sessions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `teamB` on table `game_sessions` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "game_sessions" ALTER COLUMN "teamA" SET NOT NULL,
ALTER COLUMN "teamA" SET DEFAULT '',
ALTER COLUMN "teamB" SET NOT NULL,
ALTER COLUMN "teamB" SET DEFAULT '';

-- CreateTable
CREATE TABLE "match_results" (
    "id" SERIAL NOT NULL,
    "gameSessionId" INTEGER NOT NULL,
    "teamAScore" INTEGER NOT NULL,
    "teamBScore" INTEGER NOT NULL,
    "winnerTeam" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "match_results_gameSessionId_key" ON "match_results"("gameSessionId");

-- AddForeignKey
ALTER TABLE "match_results" ADD CONSTRAINT "match_results_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "game_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
