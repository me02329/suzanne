CREATE TABLE "institutions" (
  "id" SERIAL PRIMARY KEY,
  "user_id" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "accounts" ADD COLUMN "institution_id" INTEGER;
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "institutions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "category_rules" (
  "id" SERIAL PRIMARY KEY,
  "user_id" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "pattern" TEXT NOT NULL,
  "category_id" INTEGER NOT NULL REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "savings_goals" (
  "id" SERIAL PRIMARY KEY,
  "user_id" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "target_amount" DOUBLE PRECISION NOT NULL,
  "current_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "deadline" DATE,
  "color" TEXT NOT NULL DEFAULT '#4f46e5',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "account_snapshots" (
  "id" SERIAL PRIMARY KEY,
  "user_id" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "account_id" INTEGER NOT NULL REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "date" DATE NOT NULL,
  "balance" DOUBLE PRECISION NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "institutions_user_id_name_key" ON "institutions"("user_id", "name");
CREATE INDEX "institutions_user_id_idx" ON "institutions"("user_id");
CREATE INDEX "accounts_institution_id_idx" ON "accounts"("institution_id");
CREATE UNIQUE INDEX "category_rules_user_id_pattern_key" ON "category_rules"("user_id", "pattern");
CREATE INDEX "category_rules_user_id_idx" ON "category_rules"("user_id");
CREATE INDEX "savings_goals_user_id_idx" ON "savings_goals"("user_id");
CREATE UNIQUE INDEX "account_snapshots_account_id_date_key" ON "account_snapshots"("account_id", "date");
CREATE INDEX "account_snapshots_user_id_date_idx" ON "account_snapshots"("user_id", "date");
