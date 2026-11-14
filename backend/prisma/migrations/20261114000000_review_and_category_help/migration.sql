-- Aide de catégorie (infobulle) et doublons validés par l'utilisateur.
ALTER TABLE "categories" ADD COLUMN "description" TEXT;

CREATE TABLE "duplicate_dismissals" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "a_id" INTEGER NOT NULL,
    "b_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "duplicate_dismissals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "duplicate_dismissals_user_id_a_id_b_id_key" ON "duplicate_dismissals"("user_id", "a_id", "b_id");
CREATE INDEX "duplicate_dismissals_b_id_idx" ON "duplicate_dismissals"("b_id");

ALTER TABLE "duplicate_dismissals" ADD CONSTRAINT "duplicate_dismissals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "duplicate_dismissals" ADD CONSTRAINT "duplicate_dismissals_a_id_fkey" FOREIGN KEY ("a_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "duplicate_dismissals" ADD CONSTRAINT "duplicate_dismissals_b_id_fkey" FOREIGN KEY ("b_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
