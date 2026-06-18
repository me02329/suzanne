-- CreateTable
CREATE TABLE "bill_matches" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "bill_id" INTEGER NOT NULL,
    "transaction_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_matches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bill_matches_user_id_idx" ON "bill_matches"("user_id");

-- CreateIndex
CREATE INDEX "bill_matches_transaction_id_idx" ON "bill_matches"("transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "bill_matches_bill_id_transaction_id_key" ON "bill_matches"("bill_id", "transaction_id");

-- AddForeignKey
ALTER TABLE "bill_matches" ADD CONSTRAINT "bill_matches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_matches" ADD CONSTRAINT "bill_matches_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_matches" ADD CONSTRAINT "bill_matches_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
