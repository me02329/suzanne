CREATE TABLE "tags" (
  "id"         SERIAL NOT NULL,
  "user_id"    INTEGER NOT NULL,
  "name"       TEXT NOT NULL,
  "color"      TEXT NOT NULL DEFAULT '#6366f1',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tags_user_id_name_key" ON "tags"("user_id", "name");
CREATE INDEX "tags_user_id_idx" ON "tags"("user_id");

ALTER TABLE "tags"
  ADD CONSTRAINT "tags_user_id_fkey"
  FOREIGN KEY ("user_id")
  REFERENCES "users"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

CREATE TABLE "transaction_tags" (
  "transaction_id" INTEGER NOT NULL,
  "tag_id"         INTEGER NOT NULL,

  CONSTRAINT "transaction_tags_pkey" PRIMARY KEY ("transaction_id", "tag_id")
);

CREATE INDEX "transaction_tags_tag_id_idx" ON "transaction_tags"("tag_id");

ALTER TABLE "transaction_tags"
  ADD CONSTRAINT "transaction_tags_transaction_id_fkey"
  FOREIGN KEY ("transaction_id")
  REFERENCES "transactions"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "transaction_tags"
  ADD CONSTRAINT "transaction_tags_tag_id_fkey"
  FOREIGN KEY ("tag_id")
  REFERENCES "tags"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
