-- Données brutes de la banque (synchro) affichées dans la fiche de l opération.
ALTER TABLE "transactions" ADD COLUMN "bank_data" JSONB;
