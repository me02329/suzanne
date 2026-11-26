-- Récurrent « virement » : compte de destination (mensualité de prêt,
-- épargne programmée). Null pour les dépenses et revenus.
ALTER TABLE "recurring_transactions" ADD COLUMN "to_account_id" INTEGER;
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_to_account_id_fkey"
  FOREIGN KEY ("to_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
