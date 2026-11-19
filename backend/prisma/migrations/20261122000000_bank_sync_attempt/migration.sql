-- Dernière tentative de synchronisation (réussie ou non) : la synchro
-- automatique ne retente pas en boucle une connexion en erreur.
ALTER TABLE "bank_connections" ADD COLUMN "last_attempt_at" TIMESTAMPTZ(6);
UPDATE "bank_connections" SET "last_attempt_at" = "last_sync_at";
