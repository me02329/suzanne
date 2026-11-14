-- CreateTable
CREATE TABLE "bank_connections" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "aspsp_name" TEXT NOT NULL,
    "aspsp_country" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "valid_until" TIMESTAMPTZ(6) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_sync_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_links" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "connection_id" INTEGER NOT NULL,
    "remote_uid" TEXT NOT NULL,
    "remote_name" TEXT,
    "iban_last4" TEXT,
    "currency" TEXT,
    "account_id" INTEGER,
    "sync_from" DATE,
    "last_sync_at" TIMESTAMPTZ(6),
    "last_result" JSONB,

    CONSTRAINT "bank_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bank_connections_session_id_key" ON "bank_connections"("session_id");

-- CreateIndex
CREATE INDEX "bank_connections_user_id_idx" ON "bank_connections"("user_id");

-- CreateIndex
CREATE INDEX "bank_links_user_id_idx" ON "bank_links"("user_id");

-- CreateIndex
CREATE INDEX "bank_links_account_id_idx" ON "bank_links"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_links_connection_id_remote_uid_key" ON "bank_links"("connection_id", "remote_uid");

-- AddForeignKey
ALTER TABLE "bank_connections" ADD CONSTRAINT "bank_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_links" ADD CONSTRAINT "bank_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_links" ADD CONSTRAINT "bank_links_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "bank_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_links" ADD CONSTRAINT "bank_links_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

