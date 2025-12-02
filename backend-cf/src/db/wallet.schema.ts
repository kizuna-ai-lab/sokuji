import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index, uniqueIndex, primaryKey } from "drizzle-orm/sqlite-core";

// Wallet balance
export const wallets = sqliteTable(
    "wallets",
    {
        subjectType: text("subject_type", { enum: ["user", "organization"] }).notNull(),
        subjectId: text("subject_id").notNull(),
        balanceTokens: integer("balance_tokens").notNull().default(0),
        frozen: integer("frozen", { mode: "boolean" }).notNull().default(false),
        updatedAt: integer("updated_at", { mode: "timestamp_ms" })
            .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => ({
        pk: primaryKey({ columns: [table.subjectType, table.subjectId] }),
    })
);

// Wallet ledger (transaction history)
export const walletLedger = sqliteTable(
    "wallet_ledger",
    {
        id: text("id").primaryKey().default(sql`(lower(hex(randomblob(16))))`),
        subjectType: text("subject_type", { enum: ["user", "organization"] }).notNull(),
        subjectId: text("subject_id").notNull(),
        amountTokens: integer("amount_tokens").notNull(),
        eventType: text("event_type", { enum: ["mint", "use", "refund", "adjust"] }).notNull(),
        referenceType: text("reference_type"), // 'topup', 'usage', 'refund', etc.
        referenceId: text("reference_id"), // Stripe payment ID, session ID, etc.
        externalEventId: text("external_event_id"), // For idempotency (e.g., Stripe event ID)
        description: text("description"),
        metadata: text("metadata"), // JSON string
        createdAt: integer("created_at", { mode: "timestamp_ms" })
            .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
            .notNull(),
    },
    (table) => ({
        subjectIdx: index("idx_ledger_subject").on(table.subjectType, table.subjectId, table.createdAt),
        externalEventUniq: uniqueIndex("uniq_ledger_external").on(table.externalEventId),
        eventTypeIdx: index("idx_ledger_event_type").on(table.eventType, table.createdAt),
        referenceIdx: index("idx_ledger_reference").on(table.referenceType, table.referenceId),
    })
);

// Processed events (for idempotency)
export const processedEvents = sqliteTable("processed_events", {
    eventId: text("event_id").primaryKey(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
        .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
        .notNull(),
});

// Webhook logs (for audit trail)
export const webhookLogs = sqliteTable(
    "webhook_logs",
    {
        id: integer("id").primaryKey({ autoIncrement: true }),
        eventId: text("event_id").notNull().unique(),
        eventType: text("event_type").notNull(),
        userId: text("user_id"),
        rawPayload: text("raw_payload").notNull(),
        headers: text("headers"),
        processedAt: integer("processed_at", { mode: "timestamp_ms" }),
        processingStatus: text("processing_status", { enum: ["pending", "success", "failed"] }).default("pending"),
        errorMessage: text("error_message"),
        retryCount: integer("retry_count").default(0),
        webhookSignature: text("webhook_signature"),
        ipAddress: text("ip_address"),
        createdAt: integer("created_at", { mode: "timestamp_ms" })
            .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
            .notNull(),
        updatedAt: integer("updated_at", { mode: "timestamp_ms" })
            .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
            .$onUpdate(() => new Date())
            .notNull(),
    },
    (table) => ({
        eventIdIdx: index("idx_webhook_logs_event_id").on(table.eventId),
        eventTypeIdx: index("idx_webhook_logs_event_type").on(table.eventType),
        userIdIdx: index("idx_webhook_logs_user_id").on(table.userId),
        createdAtIdx: index("idx_webhook_logs_created_at").on(table.createdAt),
        processingStatusIdx: index("idx_webhook_logs_processing_status").on(table.processingStatus),
    })
);

// Type exports
export type Wallet = typeof wallets.$inferSelect;
export type WalletLedger = typeof walletLedger.$inferSelect;
export type ProcessedEvent = typeof processedEvents.$inferSelect;
export type WebhookLog = typeof webhookLogs.$inferSelect;
