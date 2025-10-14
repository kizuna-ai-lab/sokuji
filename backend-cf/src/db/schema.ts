import * as authSchema from "./auth.schema"; // This will be generated in a later step

// Combine all schemas here for migrations
export const schema = {
    ...authSchema,
    // ... your other application schemas
} as const;
