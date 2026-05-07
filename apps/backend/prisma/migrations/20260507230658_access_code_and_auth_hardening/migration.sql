-- AlterTable
ALTER TABLE "User" ADD COLUMN     "failed_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "last_failed_at" TIMESTAMP(3),
ADD COLUMN     "locked_until" TIMESTAMP(3),
ADD COLUMN     "reset_expires_at" TIMESTAMP(3),
ADD COLUMN     "reset_token_hash" TEXT;

-- CreateTable
CREATE TABLE "BarAccessCode" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(4) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "rotated_by" TEXT,

    CONSTRAINT "BarAccessCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BarAccessCode_is_active_created_at_idx" ON "BarAccessCode"("is_active", "created_at");
