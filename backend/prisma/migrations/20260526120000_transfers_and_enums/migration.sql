-- Enums
CREATE TYPE "TransactionType" AS ENUM ('expense', 'income', 'transfer');
CREATE TYPE "CategoryType" AS ENUM ('expense', 'income');
CREATE TYPE "AccountType" AS ENUM ('checking', 'savings', 'cash', 'other');
CREATE TYPE "RecurringFrequency" AS ENUM ('weekly', 'monthly', 'yearly');

-- Convert existing text columns to enums
ALTER TABLE "transactions" ALTER COLUMN "type" TYPE "TransactionType" USING ("type"::"TransactionType");
ALTER TABLE "recurring_transactions" ALTER COLUMN "type" TYPE "TransactionType" USING ("type"::"TransactionType");
ALTER TABLE "recurring_transactions" ALTER COLUMN "frequency" TYPE "RecurringFrequency" USING ("frequency"::"RecurringFrequency");
ALTER TABLE "categories" ALTER COLUMN "type" TYPE "CategoryType" USING ("type"::"CategoryType");
ALTER TABLE "accounts" ALTER COLUMN "type" TYPE "AccountType" USING ("type"::"AccountType");

-- Transfers: destination account
ALTER TABLE "transactions" ADD COLUMN "to_account_id" INTEGER;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_to_account_id_fkey" FOREIGN KEY ("to_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "transactions_to_account_id_idx" ON "transactions"("to_account_id");
