-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "uid" UUID NOT NULL DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "bills" ADD COLUMN     "uid" UUID NOT NULL DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "uid" UUID NOT NULL DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "holdings" ADD COLUMN     "uid" UUID NOT NULL DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "institutions" ADD COLUMN     "uid" UUID NOT NULL DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "recurring_transactions" ADD COLUMN     "uid" UUID NOT NULL DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "savings_goals" ADD COLUMN     "uid" UUID NOT NULL DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "sinking_funds" ADD COLUMN     "uid" UUID NOT NULL DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "tags" ADD COLUMN     "uid" UUID NOT NULL DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "import_fingerprint" TEXT,
ADD COLUMN     "uid" UUID NOT NULL DEFAULT gen_random_uuid();

-- CreateIndex
CREATE UNIQUE INDEX "accounts_uid_key" ON "accounts"("uid");

-- CreateIndex
CREATE UNIQUE INDEX "bills_uid_key" ON "bills"("uid");

-- CreateIndex
CREATE UNIQUE INDEX "categories_uid_key" ON "categories"("uid");

-- CreateIndex
CREATE UNIQUE INDEX "holdings_uid_key" ON "holdings"("uid");

-- CreateIndex
CREATE UNIQUE INDEX "institutions_uid_key" ON "institutions"("uid");

-- CreateIndex
CREATE UNIQUE INDEX "recurring_transactions_uid_key" ON "recurring_transactions"("uid");

-- CreateIndex
CREATE UNIQUE INDEX "savings_goals_uid_key" ON "savings_goals"("uid");

-- CreateIndex
CREATE UNIQUE INDEX "sinking_funds_uid_key" ON "sinking_funds"("uid");

-- CreateIndex
CREATE UNIQUE INDEX "tags_uid_key" ON "tags"("uid");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_uid_key" ON "transactions"("uid");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_user_id_import_fingerprint_key" ON "transactions"("user_id", "import_fingerprint");

