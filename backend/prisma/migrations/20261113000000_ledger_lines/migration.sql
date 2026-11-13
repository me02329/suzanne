-- Modèle comptable à lignes (cf. docs/ARCHITECTURE-ledger.md).
-- 1. structure ; 2. conversion des données existantes ; 3. suppression de
-- l'ancien modèle (colonnes type/montants/comptes/catégorie, ventilations,
-- allocations de remboursement).

-- 1. Structure ---------------------------------------------------------------
CREATE TYPE "TransactionKind" AS ENUM ('standard', 'transfer', 'trade', 'adjustment');

ALTER TABLE "transactions" ADD COLUMN "kind" "TransactionKind" NOT NULL DEFAULT 'standard';
ALTER TABLE "holding_orders" ADD COLUMN "cash_transaction_id" INTEGER;

CREATE TABLE "transaction_lines" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "transaction_id" INTEGER NOT NULL,
    "account_id" INTEGER,
    "category_id" INTEGER,
    "amount" DOUBLE PRECISION NOT NULL,
    "refund" BOOLEAN NOT NULL DEFAULT false,
    "refund_of_id" INTEGER,
    "note" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "transaction_lines_pkey" PRIMARY KEY ("id")
);

-- 2. Données -----------------------------------------------------------------

-- 2a. Virements : ligne source négative, ligne destination positive (montant
-- crédité réel, frais/change inclus).
UPDATE "transactions" SET "kind" = 'transfer' WHERE "type" = 'transfer';

INSERT INTO "transaction_lines" ("user_id", "transaction_id", "account_id", "amount", "position")
SELECT "user_id", "id", "account_id", -"amount", 0
FROM "transactions" WHERE "type" = 'transfer' AND "account_id" IS NOT NULL;

INSERT INTO "transaction_lines" ("user_id", "transaction_id", "account_id", "amount", "position")
SELECT "user_id", "id", "to_account_id", COALESCE("to_amount", "amount"), 1
FROM "transactions" WHERE "type" = 'transfer' AND "to_account_id" IS NOT NULL;

-- Opérations de remboursement : revenu lié à une dépense (lien simple ou allocations).
CREATE TEMP TABLE "_refund_tx" AS
SELECT t."id"
FROM "transactions" t
WHERE t."type" = 'income'
  AND (t."refunds_transaction_id" IS NOT NULL
       OR EXISTS (SELECT 1 FROM "refund_allocations" ra WHERE ra."refund_transaction_id" = t."id"));

-- 2b. Dépenses / revenus simples (ni ventilés, ni remboursements).
INSERT INTO "transaction_lines" ("user_id", "transaction_id", "account_id", "category_id", "amount", "position")
SELECT t."user_id", t."id", t."account_id", t."category_id",
       CASE WHEN t."type" = 'income' THEN t."amount" ELSE -t."amount" END, 0
FROM "transactions" t
WHERE t."type" IN ('expense', 'income')
  AND t."id" NOT IN (SELECT "id" FROM "_refund_tx")
  AND NOT EXISTS (SELECT 1 FROM "transaction_splits" s WHERE s."transaction_id" = t."id");

-- 2c. Ventilations : une ligne par part, dans l'ordre de saisie.
INSERT INTO "transaction_lines" ("user_id", "transaction_id", "account_id", "category_id", "amount", "note", "position")
SELECT t."user_id", t."id", t."account_id", s."category_id",
       CASE WHEN t."type" = 'income' THEN s."amount" ELSE -s."amount" END,
       s."note",
       (ROW_NUMBER() OVER (PARTITION BY t."id" ORDER BY s."id")) - 1
FROM "transactions" t
JOIN "transaction_splits" s ON s."transaction_id" = t."id"
WHERE t."type" IN ('expense', 'income')
  AND t."id" NOT IN (SELECT "id" FROM "_refund_tx");

-- Écart d'arrondi toléré (±0,01) entre la ventilation et le montant : reporté
-- sur la première part, pour que la somme des lignes égale le montant (solde).
WITH diff AS (
  SELECT t."id",
         (CASE WHEN t."type" = 'income' THEN t."amount" ELSE -t."amount" END) - SUM(l."amount") AS d
  FROM "transactions" t
  JOIN "transaction_lines" l ON l."transaction_id" = t."id"
  WHERE t."type" IN ('expense', 'income')
    AND EXISTS (SELECT 1 FROM "transaction_splits" s WHERE s."transaction_id" = t."id")
    AND t."id" NOT IN (SELECT "id" FROM "_refund_tx")
  GROUP BY t."id", t."type", t."amount"
)
UPDATE "transaction_lines" l SET "amount" = l."amount" + diff.d
FROM diff
WHERE l."transaction_id" = diff."id" AND l."position" = 0 AND ABS(diff.d) > 1e-9;

-- 2d. Remboursements : chaque montant remboursé devient une ligne positive dans
-- la (les) catégorie(s) de la dépense remboursée, au prorata de sa ventilation
-- (même règle que l'ancien refundCategoryAllocations). Le reste éventuel du
-- revenu reste un revenu dans la catégorie de l'opération.
CREATE TEMP TABLE "_allocs" AS
SELECT ra."refund_transaction_id" AS rid, ra."expense_transaction_id" AS eid, ra."amount" AS a, ra."id" AS ord
FROM "refund_allocations" ra
UNION ALL
SELECT t."id", t."refunds_transaction_id", t."amount", 0
FROM "transactions" t
WHERE t."id" IN (SELECT "id" FROM "_refund_tx")
  AND t."refunds_transaction_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "refund_allocations" ra WHERE ra."refund_transaction_id" = t."id");

CREATE TEMP TABLE "_expense_parts" AS
SELECT s."transaction_id" AS eid, s."category_id", s."amount", s."id" AS ord
FROM "transaction_splits" s
UNION ALL
SELECT e."id", e."category_id", e."amount", 0
FROM "transactions" e
WHERE NOT EXISTS (SELECT 1 FROM "transaction_splits" s WHERE s."transaction_id" = e."id");

INSERT INTO "transaction_lines" ("user_id", "transaction_id", "account_id", "category_id", "amount", "refund", "refund_of_id", "position")
SELECT t."user_id", t."id", t."account_id", parts.category_id, parts.amount, true, parts.eid,
       (ROW_NUMBER() OVER (PARTITION BY t."id" ORDER BY parts.alloc_ord, parts.part_ord)) - 1
FROM "transactions" t
JOIN (
  -- Dépense valide : répartition au prorata de ses parts.
  SELECT al.rid, al.eid, al.ord AS alloc_ord, p.ord AS part_ord, p."category_id",
         al.a * (p."amount" / e."amount") AS amount
  FROM "_allocs" al
  JOIN "transactions" e ON e."id" = al.eid AND e."amount" > 0
  JOIN "_expense_parts" p ON p.eid = e."id"
  UNION ALL
  -- Dépense introuvable ou nulle : remboursement non catégorisé.
  SELECT al.rid, e."id", al.ord, 0, NULL::INTEGER, al.a
  FROM "_allocs" al
  LEFT JOIN "transactions" e ON e."id" = al.eid
  WHERE e."id" IS NULL OR e."amount" <= 0
) parts ON parts.rid = t."id";

-- Reste du revenu au-delà des montants remboursés.
INSERT INTO "transaction_lines" ("user_id", "transaction_id", "account_id", "category_id", "amount", "position")
SELECT t."user_id", t."id", t."account_id", t."category_id",
       t."amount" - COALESCE(alloc.total, 0), 1000
FROM "transactions" t
LEFT JOIN (SELECT rid, SUM(a) AS total FROM "_allocs" GROUP BY rid) alloc ON alloc.rid = t."id"
WHERE t."id" IN (SELECT "id" FROM "_refund_tx")
  AND t."amount" - COALESCE(alloc.total, 0) > 0.000001;

-- Lien d'en-tête : seulement quand une seule dépense est remboursée (sinon le
-- détail est porté par refund_of_id sur chaque ligne).
UPDATE "transactions" t
SET "refunds_transaction_id" = single.eid
FROM (
  SELECT rid, MIN(eid) AS eid FROM "_allocs" GROUP BY rid HAVING COUNT(DISTINCT eid) = 1
) single
WHERE t."id" = single.rid AND t."refunds_transaction_id" IS NULL;

-- Le lien ne vaut que pour un remboursement.
UPDATE "transactions" SET "refunds_transaction_id" = NULL
WHERE "id" NOT IN (SELECT "id" FROM "_refund_tx");

-- 3. Suppression de l'ancien modèle ----------------------------------------
ALTER TABLE "refund_allocations" DROP CONSTRAINT "refund_allocations_expense_transaction_id_fkey";
ALTER TABLE "refund_allocations" DROP CONSTRAINT "refund_allocations_refund_transaction_id_fkey";
ALTER TABLE "refund_allocations" DROP CONSTRAINT "refund_allocations_user_id_fkey";
ALTER TABLE "transaction_splits" DROP CONSTRAINT "transaction_splits_category_id_fkey";
ALTER TABLE "transaction_splits" DROP CONSTRAINT "transaction_splits_transaction_id_fkey";
ALTER TABLE "transaction_splits" DROP CONSTRAINT "transaction_splits_user_id_fkey";
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_account_id_fkey";
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_category_id_fkey";
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_to_account_id_fkey";

DROP INDEX "transactions_account_id_idx";
DROP INDEX "transactions_category_id_idx";
DROP INDEX "transactions_to_account_id_idx";

ALTER TABLE "transactions"
  DROP COLUMN "account_id",
  DROP COLUMN "amount",
  DROP COLUMN "category_id",
  DROP COLUMN "exchange_rate",
  DROP COLUMN "to_account_id",
  DROP COLUMN "to_amount",
  DROP COLUMN "type";

DROP TABLE "refund_allocations";
DROP TABLE "transaction_splits";
DROP TABLE "_refund_tx";
DROP TABLE "_allocs";
DROP TABLE "_expense_parts";

CREATE INDEX "transaction_lines_transaction_id_idx" ON "transaction_lines"("transaction_id");
CREATE INDEX "transaction_lines_account_id_idx" ON "transaction_lines"("account_id");
CREATE INDEX "transaction_lines_category_id_idx" ON "transaction_lines"("category_id");
CREATE INDEX "transaction_lines_user_id_idx" ON "transaction_lines"("user_id");
CREATE INDEX "transaction_lines_refund_of_id_idx" ON "transaction_lines"("refund_of_id");
CREATE UNIQUE INDEX "holding_orders_cash_transaction_id_key" ON "holding_orders"("cash_transaction_id");

ALTER TABLE "transaction_lines" ADD CONSTRAINT "transaction_lines_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "transaction_lines" ADD CONSTRAINT "transaction_lines_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "transaction_lines" ADD CONSTRAINT "transaction_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "transaction_lines" ADD CONSTRAINT "transaction_lines_refund_of_id_fkey" FOREIGN KEY ("refund_of_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "transaction_lines" ADD CONSTRAINT "transaction_lines_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "holding_orders" ADD CONSTRAINT "holding_orders_cash_transaction_id_fkey" FOREIGN KEY ("cash_transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
