-- Un revenu de remboursement peut maintenant être ventilé vers plusieurs
-- dépenses. L'ancien lien unique transactions.refunds_transaction_id reste en
-- place pour compatibilité, mais les nouvelles agrégations lisent cette table
-- en priorité.
CREATE TABLE "refund_allocations" (
  "id" SERIAL NOT NULL,
  "user_id" INTEGER NOT NULL,
  "refund_transaction_id" INTEGER NOT NULL,
  "expense_transaction_id" INTEGER NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "refund_allocations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "refund_allocations_refund_transaction_id_expense_transaction_id_key"
  ON "refund_allocations"("refund_transaction_id", "expense_transaction_id");
CREATE INDEX "refund_allocations_user_id_idx" ON "refund_allocations"("user_id");
CREATE INDEX "refund_allocations_refund_transaction_id_idx" ON "refund_allocations"("refund_transaction_id");
CREATE INDEX "refund_allocations_expense_transaction_id_idx" ON "refund_allocations"("expense_transaction_id");

ALTER TABLE "refund_allocations"
  ADD CONSTRAINT "refund_allocations_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "refund_allocations"
  ADD CONSTRAINT "refund_allocations_refund_transaction_id_fkey"
  FOREIGN KEY ("refund_transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "refund_allocations"
  ADD CONSTRAINT "refund_allocations_expense_transaction_id_fkey"
  FOREIGN KEY ("expense_transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "refund_allocations" (
  "user_id",
  "refund_transaction_id",
  "expense_transaction_id",
  "amount",
  "created_at"
)
SELECT
  refund."user_id",
  refund."id",
  refund."refunds_transaction_id",
  refund."amount",
  refund."created_at"
FROM "transactions" refund
JOIN "transactions" expense ON expense."id" = refund."refunds_transaction_id"
WHERE refund."type" = 'income'
  AND expense."type" = 'expense'
  AND refund."refunds_transaction_id" IS NOT NULL
ON CONFLICT ("refund_transaction_id", "expense_transaction_id") DO NOTHING;
