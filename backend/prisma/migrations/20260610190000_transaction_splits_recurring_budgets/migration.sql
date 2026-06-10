-- Ventilation de transactions : une transaction garde son montant total pour
-- les soldes de comptes, et ses lignes de split détaillent l'imputation par
-- catégorie pour les statistiques et budgets.
CREATE TABLE "transaction_splits" (
  "id" SERIAL NOT NULL,
  "user_id" INTEGER NOT NULL,
  "transaction_id" INTEGER NOT NULL,
  "category_id" INTEGER NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "note" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "transaction_splits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "transaction_splits_user_id_idx" ON "transaction_splits"("user_id");
CREATE INDEX "transaction_splits_transaction_id_idx" ON "transaction_splits"("transaction_id");
CREATE INDEX "transaction_splits_category_id_idx" ON "transaction_splits"("category_id");

ALTER TABLE "transaction_splits"
  ADD CONSTRAINT "transaction_splits_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "transaction_splits"
  ADD CONSTRAINT "transaction_splits_transaction_id_fkey"
  FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "transaction_splits"
  ADD CONSTRAINT "transaction_splits_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "budgets" ADD COLUMN "recurring" BOOLEAN NOT NULL DEFAULT false;
