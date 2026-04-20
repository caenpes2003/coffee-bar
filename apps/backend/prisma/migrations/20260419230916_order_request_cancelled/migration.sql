-- AlterEnum
ALTER TYPE "OrderRequestStatus" ADD VALUE 'cancelled';

-- AlterTable
ALTER TABLE "OrderRequest" ADD COLUMN     "cancelled_at" TIMESTAMP(3);
