import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ============================================
// BETTER AUTH TABLES
// ============================================

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("emailVerified", { mode: "boolean" }).notNull(),
  image: text("image"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: integer("accessTokenExpiresAt", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refreshTokenExpiresAt", { mode: "timestamp" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }),
  updatedAt: integer("updatedAt", { mode: "timestamp" }),
});

// ============================================
// CUSTOM APPLICATION TABLES
// ============================================

// Extended users table for application-specific data
export const appUser = sqliteTable(
  "app_user",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    betterAuthUserId: text("better_auth_user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    firstName: text("first_name"),
    lastName: text("last_name"),
    subscription: text("subscription").default("free_plan"),
    tokenQuota: integer("token_quota").default(0),
    tokensUsed: integer("tokens_used").default(0),
    createdAt: text("created_at").default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
    updatedAt: text("updated_at").default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (table) => ({
    betterAuthUserIdIdx: index("idx_app_user_better_auth_user_id").on(table.betterAuthUserId),
  })
);

// Plans catalog
export const plans = sqliteTable("plans", {
  planId: text("plan_id").primaryKey(),
  monthlyQuotaTokens: integer("monthly_quota_tokens").notNull(),
  priceCents: integer("price_cents").notNull(),
  createdAt: text("created_at").default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  updatedAt: text("updated_at").default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
});

// Wallet balance
export const wallets = sqliteTable(
  "wallets",
  {
    subjectType: text("subject_type", { enum: ["user", "organization"] }).notNull(),
    subjectId: text("subject_id").notNull(),
    balanceTokens: integer("balance_tokens").notNull().default(0),
    frozen: integer("frozen", { mode: "boolean" }).notNull().default(false),
    updatedAt: text("updated_at").default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.subjectType, table.subjectId] }),
  })
);

// Wallet ledger
export const walletLedger = sqliteTable(
  "wallet_ledger",
  {
    id: text("id").primaryKey().default(sql`(lower(hex(randomblob(16))))`),
    subjectType: text("subject_type", { enum: ["user", "organization"] }).notNull(),
    subjectId: text("subject_id").notNull(),
    amountTokens: integer("amount_tokens").notNull(),
    eventType: text("event_type", { enum: ["mint", "use", "refund", "adjust"] }).notNull(),
    referenceType: text("reference_type"),
    referenceId: text("reference_id"),
    planId: text("plan_id").references(() => plans.planId, { onDelete: "set null" }),
    externalEventId: text("external_event_id"),
    description: text("description"),
    metadata: text("metadata"),
    createdAt: text("created_at").default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (table) => ({
    subjectIdx: index("idx_ledger_subject").on(table.subjectType, table.subjectId, table.createdAt),
    externalEventUniq: uniqueIndex("uniq_ledger_external").on(table.externalEventId),
    eventTypeIdx: index("idx_ledger_event_type").on(table.eventType, table.createdAt),
    referenceIdx: index("idx_ledger_reference").on(table.referenceType, table.referenceId),
  })
);

// Entitlements
export const entitlements = sqliteTable(
  "entitlements",
  {
    subjectType: text("subject_type", { enum: ["user", "organization"] }).notNull(),
    subjectId: text("subject_id").notNull(),
    planId: text("plan_id").references(() => plans.planId, { onDelete: "set null" }),
    maxConcurrentSessions: integer("max_concurrent_sessions").default(1),
    rateLimitRpm: integer("rate_limit_rpm").default(60),
    features: text("features"),
    updatedAt: text("updated_at").default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.subjectType, table.subjectId] }),
  })
);

// Usage logs
export const usageLogs = sqliteTable(
  "usage_logs",
  {
    id: text("id").primaryKey().default(sql`(lower(hex(randomblob(16))))`),
    subjectType: text("subject_type", { enum: ["user", "organization"] }).notNull(),
    subjectId: text("subject_id").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    endpoint: text("endpoint"),
    method: text("method"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    adjustedInputTokens: integer("adjusted_input_tokens"),
    adjustedOutputTokens: integer("adjusted_output_tokens"),
    adjustedTotalTokens: integer("adjusted_total_tokens"),
    inputRatio: real("input_ratio"),
    outputRatio: real("output_ratio"),
    modality: text("modality"),
    sessionId: text("session_id"),
    requestId: text("request_id"),
    responseId: text("response_id"),
    eventType: text("event_type"),
    ledgerId: text("ledger_id").references(() => walletLedger.id, { onDelete: "set null" }),
    metadata: text("metadata"),
    createdAt: text("created_at").default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (table) => ({
    subjectIdx: index("idx_usage_logs_subject").on(table.subjectType, table.subjectId, table.createdAt),
    providerIdx: index("idx_usage_logs_provider").on(table.provider),
    modelIdx: index("idx_usage_logs_model").on(table.model),
    sessionIdIdx: index("idx_usage_logs_session_id").on(table.sessionId),
    eventTypeIdx: index("idx_usage_logs_event_type").on(table.eventType),
    createdAtIdx: index("idx_usage_logs_created_at").on(table.createdAt),
    modalityIdx: index("idx_usage_logs_modality").on(table.modality),
    ledgerIdIdx: index("idx_usage_logs_ledger_id").on(table.ledgerId),
  })
);

// Processed events (idempotency)
export const processedEvents = sqliteTable("processed_events", {
  eventId: text("event_id").primaryKey(),
  createdAt: text("created_at").default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
});

// Webhook logs
export const webhookLogs = sqliteTable(
  "webhook_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    eventId: text("event_id").notNull().unique(),
    eventType: text("event_type").notNull(),
    userId: text("user_id"),
    rawPayload: text("raw_payload").notNull(),
    headers: text("headers"),
    processedAt: integer("processed_at", { mode: "timestamp" }),
    processingStatus: text("processing_status", { enum: ["pending", "success", "failed"] }).default("pending"),
    errorMessage: text("error_message"),
    retryCount: integer("retry_count").default(0),
    webhookSignature: text("webhook_signature"),
    ipAddress: text("ip_address"),
    createdAt: integer("createdAt", { mode: "timestamp" }).default(sql`(unixepoch())`),
    updatedAt: integer("updatedAt", { mode: "timestamp" }).default(sql`(unixepoch())`),
  },
  (table) => ({
    eventIdIdx: index("idx_webhook_logs_event_id").on(table.eventId),
    eventTypeIdx: index("idx_webhook_logs_event_type").on(table.eventType),
    userIdIdx: index("idx_webhook_logs_user_id").on(table.userId),
    createdAtIdx: index("idx_webhook_logs_created_at").on(table.createdAt),
    processingStatusIdx: index("idx_webhook_logs_processing_status").on(table.processingStatus),
    processedAtIdx: index("idx_webhook_logs_processed_at").on(table.processedAt),
  })
);

// Export types
export type User = typeof user.$inferSelect;
export type Session = typeof session.$inferSelect;
export type Account = typeof account.$inferSelect;
export type Verification = typeof verification.$inferSelect;
export type AppUser = typeof appUser.$inferSelect;
export type Plan = typeof plans.$inferSelect;
export type Wallet = typeof wallets.$inferSelect;
export type WalletLedger = typeof walletLedger.$inferSelect;
export type Entitlement = typeof entitlements.$inferSelect;
export type UsageLog = typeof usageLogs.$inferSelect;
export type ProcessedEvent = typeof processedEvents.$inferSelect;
export type WebhookLog = typeof webhookLogs.$inferSelect;
