-- CreateTable
CREATE TABLE "global_budgets" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "month" TEXT NOT NULL,
    "amount_limit" DOUBLE PRECISION NOT NULL,
    "recurring" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "global_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sinking_funds" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "category_id" INTEGER,
    "target_amount" DOUBLE PRECISION NOT NULL,
    "period_months" INTEGER NOT NULL DEFAULT 12,
    "start_month" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#4a6a00',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sinking_funds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "global_budgets_user_id_month_key" ON "global_budgets"("user_id", "month");

-- CreateIndex
CREATE INDEX "sinking_funds_user_id_idx" ON "sinking_funds"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sinking_funds_user_id_name_key" ON "sinking_funds"("user_id", "name");

-- AddForeignKey
ALTER TABLE "global_budgets" ADD CONSTRAINT "global_budgets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sinking_funds" ADD CONSTRAINT "sinking_funds_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sinking_funds" ADD CONSTRAINT "sinking_funds_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

