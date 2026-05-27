ALTER TABLE "transactions" ADD COLUMN "recurring_transaction_id" INTEGER;

ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_recurring_transaction_id_fkey"
  FOREIGN KEY ("recurring_transaction_id")
  REFERENCES "recurring_transactions"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE INDEX "transactions_recurring_transaction_id_idx" ON "transactions"("recurring_transaction_id");
