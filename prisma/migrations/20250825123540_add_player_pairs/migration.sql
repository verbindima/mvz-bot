-- CreateTable
CREATE TABLE "player_pairs" (
    "id" SERIAL NOT NULL,
    "playerAId" INTEGER NOT NULL,
    "playerBId" INTEGER NOT NULL,
    "togetherGames" INTEGER NOT NULL DEFAULT 0,
    "togetherWins" INTEGER NOT NULL DEFAULT 0,
    "vsGames" INTEGER NOT NULL DEFAULT 0,
    "vsWins" INTEGER NOT NULL DEFAULT 0,
    "synergyMu" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "synergySigma" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "counterMu" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "counterSigma" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "lastGameAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "player_pairs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "player_pairs_playerAId_playerBId_key" ON "player_pairs"("playerAId", "playerBId");

-- AddForeignKey
ALTER TABLE "player_pairs" ADD CONSTRAINT "player_pairs_playerAId_fkey" FOREIGN KEY ("playerAId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_pairs" ADD CONSTRAINT "player_pairs_playerBId_fkey" FOREIGN KEY ("playerBId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;
