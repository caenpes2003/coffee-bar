-- CreateTable
CREATE TABLE "HousePlaylistCategory" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HousePlaylistCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "_HousePlaylistItemCategories" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_HousePlaylistItemCategories_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "HousePlaylistCategory_name_key" ON "HousePlaylistCategory"("name");

-- CreateIndex
CREATE INDEX "_HousePlaylistItemCategories_B_index" ON "_HousePlaylistItemCategories"("B");

-- AddForeignKey
ALTER TABLE "_HousePlaylistItemCategories" ADD CONSTRAINT "_HousePlaylistItemCategories_A_fkey" FOREIGN KEY ("A") REFERENCES "HousePlaylistCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_HousePlaylistItemCategories" ADD CONSTRAINT "_HousePlaylistItemCategories_B_fkey" FOREIGN KEY ("B") REFERENCES "HousePlaylistItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
