import { schema } from "./schema";

// Re-export the drizzle-orm types and utilities from here for convenience
export * from "drizzle-orm";

// Re-export the feature schemas for use in other files
export * from "./auth.schema"; // Export individual tables for drizzle-kit
export * from "./schema";
