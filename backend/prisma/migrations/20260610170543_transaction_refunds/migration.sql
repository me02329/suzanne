-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "refunds_transaction_id" INTEGER;

-- CreateIndex
CREATE INDEX "transactions_refunds_transaction_id_idx" ON "transactions"("refunds_transaction_id");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_refunds_transaction_id_fkey" FOREIGN KEY ("refunds_transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
