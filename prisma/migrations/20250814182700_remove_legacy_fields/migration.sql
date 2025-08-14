-- AlterTable
ALTER TABLE "players" DROP COLUMN IF EXISTS "skillCaptain";

-- AlterTable  
ALTER TABLE "ratings" DROP COLUMN IF EXISTS "scheme";

-- Update match results to support draws (no schema change needed, just comment update)
-- winnerTeam can now be "A", "B", or "DRAW"