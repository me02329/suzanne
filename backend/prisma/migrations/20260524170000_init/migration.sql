CREATE TABLE "users" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "accounts" (
  "id" SERIAL PRIMARY KEY,
  "user_id" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "initial_balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "initial_balance_date" DATE NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "categories" (
  "id" SERIAL PRIMARY KEY,
  "user_id" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "color" TEXT NOT NULL DEFAULT '#6366f1',
  "icon" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "transactions" (
  "id" SERIAL PRIMARY KEY,
  "user_id" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "account_id" INTEGER REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "category_id" INTEGER REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "amount" DOUBLE PRECISION NOT NULL,
  "type" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "description" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "budgets" (
  "id" SERIAL PRIMARY KEY,
  "user_id" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "category_id" INTEGER NOT NULL REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "month" TEXT NOT NULL,
  "amount_limit" DOUBLE PRECISION NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "recurring_transactions" (
  "id" SERIAL PRIMARY KEY,
  "user_id" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "account_id" INTEGER REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "category_id" INTEGER REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "amount" DOUBLE PRECISION NOT NULL,
  "type" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "frequency" TEXT NOT NULL,
  "day_of_month" INTEGER,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "last_executed" DATE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "accounts_user_id_name_key" ON "accounts"("user_id", "name");
CREATE UNIQUE INDEX "categories_user_id_name_type_key" ON "categories"("user_id", "name", "type");
CREATE UNIQUE INDEX "budgets_user_id_category_id_month_key" ON "budgets"("user_id", "category_id", "month");
CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");
CREATE INDEX "categories_user_id_type_idx" ON "categories"("user_id", "type");
CREATE INDEX "transactions_user_id_date_idx" ON "transactions"("user_id", "date");
CREATE INDEX "transactions_account_id_idx" ON "transactions"("account_id");
CREATE INDEX "transactions_category_id_idx" ON "transactions"("category_id");
CREATE INDEX "budgets_user_id_month_idx" ON "budgets"("user_id", "month");
CREATE INDEX "recurring_transactions_user_id_active_idx" ON "recurring_transactions"("user_id", "active");
