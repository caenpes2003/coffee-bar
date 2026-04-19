-- AlterTable
ALTER TABLE "QueueItem" ADD COLUMN     "finished_at" TIMESTAMP(3),
ADD COLUMN     "queued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "skipped_at" TIMESTAMP(3),
ADD COLUMN     "started_playing_at" TIMESTAMP(3);
