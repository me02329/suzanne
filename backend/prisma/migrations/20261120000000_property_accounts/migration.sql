-- Biens (immobilier, objets de valeur) valorisés par estimation, et prêt lié.
ALTER TYPE "AccountType" ADD VALUE IF NOT EXISTS 'real_estate';
ALTER TYPE "AccountType" ADD VALUE IF NOT EXISTS 'valuable';
ALTER TABLE "accounts" ADD COLUMN "linked_account_id" INTEGER;
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_linked_account_id_fkey" FOREIGN KEY ("linked_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
