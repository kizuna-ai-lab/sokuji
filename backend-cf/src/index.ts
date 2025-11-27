import { Hono } from "hono";
import { cors } from "hono/cors";
import { createAuth } from "./auth";
import type { CloudflareBindings } from "./env";

type Variables = {
    auth: ReturnType<typeof createAuth>;
};

// Extend bindings to include ASSETS
interface Bindings extends CloudflareBindings {
    ASSETS: { fetch: (request: Request) => Promise<Response> };
}

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// CORS configuration for auth routes
app.use(
    "/api/auth/**",
    cors({
        origin: "*", // In production, replace with your actual domain
        allowHeaders: ["Content-Type", "Authorization"],
        allowMethods: ["POST", "GET", "OPTIONS"],
        exposeHeaders: ["Content-Length"],
        maxAge: 600,
        credentials: true,
    })
);

// Middleware to initialize auth instance for API routes only
app.use("/api/*", async (c, next) => {
    const auth = createAuth(c.env, (c.req.raw as any).cf || {});
    c.set("auth", auth);
    await next();
});

// Handle all auth routes
app.all("/api/auth/*", async (c) => {
    const auth = c.get("auth");
    return auth.handler(c.req.raw);
});

// Simple health check
app.get("/api/health", (c) => {
    return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// All non-API routes: serve static assets (SPA)
app.all("*", async (c) => {
    return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
