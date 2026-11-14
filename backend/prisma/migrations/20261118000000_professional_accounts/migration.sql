-- Compte professionnel (société) : exclu des finances personnelles.
ALTER TABLE "accounts" ADD COLUMN "professional" BOOLEAN NOT NULL DEFAULT false;
