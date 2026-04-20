-- CreateEnum
CREATE TYPE "TableStatus" AS ENUM ('available', 'occupied', 'closing');

-- CreateEnum
CREATE TYPE "TableSessionStatus" AS ENUM ('open', 'ordering', 'closing', 'closed');

-- CreateEnum
CREATE TYPE "QueueStatus" AS ENUM ('pending', 'playing', 'played', 'skipped');

-- CreateEnum
CREATE TYPE "OrderRequestStatus" AS ENUM ('pending', 'accepted', 'rejected');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('accepted', 'preparing', 'ready', 'delivered', 'cancelled');

-- CreateEnum
CREATE TYPE "ConsumptionType" AS ENUM ('product', 'adjustment');

-- CreateEnum
CREATE TYPE "PlaybackStatus" AS ENUM ('idle', 'buffering', 'playing', 'paused');

-- CreateTable
CREATE TABLE "Table" (
    "id" SERIAL NOT NULL,
    "number" INTEGER NOT NULL,
    "qr_code" TEXT NOT NULL,
    "status" "TableStatus" NOT NULL DEFAULT 'available',
    "current_session_id" INTEGER,
    "total_consumption" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "active_order_count" INTEGER NOT NULL DEFAULT 0,
    "pending_request_count" INTEGER NOT NULL DEFAULT 0,
    "last_activity_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Table_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TableSession" (
    "id" SERIAL NOT NULL,
    "table_id" INTEGER NOT NULL,
    "status" "TableSessionStatus" NOT NULL DEFAULT 'open',
    "total_consumption" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "last_consumption_at" TIMESTAMP(3),
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TableSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Song" (
    "id" SERIAL NOT NULL,
    "youtube_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "duration" INTEGER NOT NULL,
    "requested_by_table" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Song_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueItem" (
    "id" SERIAL NOT NULL,
    "song_id" INTEGER NOT NULL,
    "table_id" INTEGER,
    "priority_score" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "status" "QueueStatus" NOT NULL DEFAULT 'pending',
    "position" INTEGER NOT NULL,
    "queued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "started_playing_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "skipped_at" TIMESTAMP(3),

    CONSTRAINT "QueueItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "category" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderRequest" (
    "id" SERIAL NOT NULL,
    "table_session_id" INTEGER NOT NULL,
    "status" "OrderRequestStatus" NOT NULL DEFAULT 'pending',
    "items" JSONB NOT NULL,
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "rejected_at" TIMESTAMP(3),

    CONSTRAINT "OrderRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" SERIAL NOT NULL,
    "table_session_id" INTEGER NOT NULL,
    "order_request_id" INTEGER NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'accepted',
    "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consumption" (
    "id" SERIAL NOT NULL,
    "table_session_id" INTEGER NOT NULL,
    "order_id" INTEGER,
    "product_id" INTEGER,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_amount" DECIMAL(10,2) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "type" "ConsumptionType" NOT NULL DEFAULT 'product',
    "reversed_at" TIMESTAMP(3),
    "reverses_id" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Consumption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaybackState" (
    "id" SERIAL NOT NULL,
    "status" "PlaybackStatus" NOT NULL DEFAULT 'idle',
    "queue_item_id" INTEGER,
    "started_at" TIMESTAMP(3),
    "position_seconds" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlaybackState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Table_number_key" ON "Table"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Table_qr_code_key" ON "Table"("qr_code");

-- CreateIndex
CREATE UNIQUE INDEX "Table_current_session_id_key" ON "Table"("current_session_id");

-- CreateIndex
CREATE INDEX "TableSession_table_id_status_idx" ON "TableSession"("table_id", "status");

-- CreateIndex
CREATE INDEX "TableSession_status_idx" ON "TableSession"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Song_youtube_id_key" ON "Song"("youtube_id");

-- CreateIndex
CREATE INDEX "QueueItem_status_position_idx" ON "QueueItem"("status", "position");

-- CreateIndex
CREATE INDEX "QueueItem_table_id_status_idx" ON "QueueItem"("table_id", "status");

-- CreateIndex
CREATE INDEX "OrderRequest_table_session_id_status_idx" ON "OrderRequest"("table_session_id", "status");

-- CreateIndex
CREATE INDEX "OrderRequest_status_idx" ON "OrderRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Order_order_request_id_key" ON "Order"("order_request_id");

-- CreateIndex
CREATE INDEX "Order_table_session_id_status_idx" ON "Order"("table_session_id", "status");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "OrderItem_order_id_idx" ON "OrderItem"("order_id");

-- CreateIndex
CREATE INDEX "OrderItem_product_id_idx" ON "OrderItem"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "Consumption_reverses_id_key" ON "Consumption"("reverses_id");

-- CreateIndex
CREATE INDEX "Consumption_table_session_id_created_at_idx" ON "Consumption"("table_session_id", "created_at");

-- CreateIndex
CREATE INDEX "Consumption_order_id_idx" ON "Consumption"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "PlaybackState_queue_item_id_key" ON "PlaybackState"("queue_item_id");

-- AddForeignKey
ALTER TABLE "Table" ADD CONSTRAINT "Table_current_session_id_fkey" FOREIGN KEY ("current_session_id") REFERENCES "TableSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TableSession" ADD CONSTRAINT "TableSession_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "Table"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Song" ADD CONSTRAINT "Song_requested_by_table_fkey" FOREIGN KEY ("requested_by_table") REFERENCES "Table"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueItem" ADD CONSTRAINT "QueueItem_song_id_fkey" FOREIGN KEY ("song_id") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueItem" ADD CONSTRAINT "QueueItem_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "Table"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderRequest" ADD CONSTRAINT "OrderRequest_table_session_id_fkey" FOREIGN KEY ("table_session_id") REFERENCES "TableSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_table_session_id_fkey" FOREIGN KEY ("table_session_id") REFERENCES "TableSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_order_request_id_fkey" FOREIGN KEY ("order_request_id") REFERENCES "OrderRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consumption" ADD CONSTRAINT "Consumption_table_session_id_fkey" FOREIGN KEY ("table_session_id") REFERENCES "TableSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consumption" ADD CONSTRAINT "Consumption_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consumption" ADD CONSTRAINT "Consumption_reverses_id_fkey" FOREIGN KEY ("reverses_id") REFERENCES "Consumption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaybackState" ADD CONSTRAINT "PlaybackState_queue_item_id_fkey" FOREIGN KEY ("queue_item_id") REFERENCES "QueueItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Partial unique: at most one non-closed TableSession per table (R5 invariant)
CREATE UNIQUE INDEX "TableSession_one_active_per_table" ON "TableSession"("table_id") WHERE "status" <> 'closed';
