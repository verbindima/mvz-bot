-- CreateEnum
CREATE TYPE "GameFormat" AS ENUM ('DUO', 'TRI');

-- AlterTable
ALTER TABLE "game_sessions" ADD COLUMN     "format" "GameFormat" NOT NULL DEFAULT 'DUO',
ADD COLUMN     "teamC" TEXT;

-- CreateTable
CREATE TABLE "tri_mini_matches" (
    "id" SERIAL NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "t1" TEXT NOT NULL,
    "t2" TEXT NOT NULL,
    "s1" INTEGER NOT NULL,
    "s2" INTEGER NOT NULL,
    "winner" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ratingApplied" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "tri_mini_matches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tri_mini_matches_sessionId_seq_idx" ON "tri_mini_matches"("sessionId", "seq");

-- AddForeignKey
ALTER TABLE "tri_mini_matches" ADD CONSTRAINT "tri_mini_matches_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "game_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
