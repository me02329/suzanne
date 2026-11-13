-- Comptes d'investissement : effet des ordres sur les espèces (opt-in) et date fiscale.
ALTER TABLE "accounts" ADD COLUMN "orders_affect_cash" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "accounts" ADD COLUMN "fiscal_start_date" DATE;
