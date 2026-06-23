-- CreateTable
CREATE TABLE "import_mappings" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "date_format" TEXT NOT NULL DEFAULT 'auto',
    "columns" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_mappings_user_id_idx" ON "import_mappings"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "import_mappings_user_id_name_key" ON "import_mappings"("user_id", "name");

-- AddForeignKey
ALTER TABLE "import_mappings" ADD CONSTRAINT "import_mappings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
