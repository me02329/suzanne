-- ADR 0012 : identité stable des profils (reconnaissance serveur ⇄ téléphone).
-- Les profils existants reçoivent un uid aléatoire.
ALTER TABLE "users" ADD COLUMN "uid" UUID NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX "users_uid_key" ON "users"("uid");
