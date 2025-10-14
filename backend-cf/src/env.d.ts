export interface CloudflareBindings {
    DATABASE: D1Database;
    KV: KVNamespace;
}

declare global {
    namespace NodeJS {
        interface ProcessEnv extends CloudflareBindings {
            // Additional environment variables can be added here
        }
    }
}
