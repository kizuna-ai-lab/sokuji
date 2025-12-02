import * as authSchema from "./auth.schema";
import * as walletSchema from "./wallet.schema";

// Combine all schemas here for migrations
export const schema = {
    ...authSchema,
    ...walletSchema,
} as const;

// Re-export for convenience
export * from "./auth.schema";
export * from "./wallet.schema";
