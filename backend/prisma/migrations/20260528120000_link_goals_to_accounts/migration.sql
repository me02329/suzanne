ALTER TABLE "savings_goals" ADD COLUMN "account_id" INTEGER;

ALTER TABLE "savings_goals"
  ADD CONSTRAINT "savings_goals_account_id_fkey"
  FOREIGN KEY ("account_id")
  REFERENCES "accounts"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE INDEX "savings_goals_account_id_idx" ON "savings_goals"("account_id");
