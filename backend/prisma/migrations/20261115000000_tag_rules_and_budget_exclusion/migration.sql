-- Tags exclus des budgets et règles de tag (libellé → tag).
ALTER TABLE "tags" ADD COLUMN "exclude_from_budgets" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "tag_rules" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "pattern" TEXT NOT NULL,
    "tag_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tag_rules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tag_rules_user_id_pattern_tag_id_key" ON "tag_rules"("user_id", "pattern", "tag_id");
CREATE INDEX "tag_rules_user_id_idx" ON "tag_rules"("user_id");

ALTER TABLE "tag_rules" ADD CONSTRAINT "tag_rules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tag_rules" ADD CONSTRAINT "tag_rules_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
