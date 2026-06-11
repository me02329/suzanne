-- CreateEnum
CREATE TYPE "BillFrequency" AS ENUM ('monthly', 'yearly');

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "cleared" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "goal_contributions" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "goal_id" INTEGER NOT NULL,
    "transaction_id" INTEGER,
    "amount" DOUBLE PRECISION NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_contributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bills" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "account_id" INTEGER,
    "category_id" INTEGER,
    "name" TEXT NOT NULL,
    "amount_min" DOUBLE PRECISION NOT NULL,
    "amount_max" DOUBLE PRECISION NOT NULL,
    "start_date" DATE NOT NULL,
    "frequency" "BillFrequency" NOT NULL DEFAULT 'monthly',
    "interval" INTEGER NOT NULL DEFAULT 1,
    "pattern" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bills_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "goal_contributions_user_id_idx" ON "goal_contributions"("user_id");

-- CreateIndex
CREATE INDEX "goal_contributions_goal_id_date_idx" ON "goal_contributions"("goal_id", "date");

-- CreateIndex
CREATE INDEX "bills_user_id_active_idx" ON "bills"("user_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "bills_user_id_name_key" ON "bills"("user_id", "name");

-- AddForeignKey
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "savings_goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "refund_allocations_refund_transaction_id_expense_transaction_id" RENAME TO "refund_allocations_refund_transaction_id_expense_transactio_key";
