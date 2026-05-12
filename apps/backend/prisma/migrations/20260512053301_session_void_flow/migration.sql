-- CreateEnum
CREATE TYPE "SessionVoidReason" AS ENUM ('customer_left', 'admin_error', 'comp', 'other');

-- AlterEnum
ALTER TYPE "TableSessionStatus" ADD VALUE 'void';

-- AlterTable
ALTER TABLE "TableSession" ADD COLUMN     "void_other_detail" TEXT,
ADD COLUMN     "void_reason" "SessionVoidReason",
ADD COLUMN     "voided_at" TIMESTAMP(3),
ADD COLUMN     "voided_by" TEXT;
