-- AlterTable
ALTER TABLE "QueueItem" ALTER COLUMN "table_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Song" ALTER COLUMN "requested_by_table" DROP NOT NULL;
