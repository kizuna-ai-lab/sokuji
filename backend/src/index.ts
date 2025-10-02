import { Hono } from "hono";
import { cors } from "hono/cors";
import { createAuth } from "./auth";
import type { CloudflareBindings } from "./env";
import { createCorsConfig } from "./middleware/cors";
import userRoutes from "./routes/user";
import walletRoutes from "./routes/wallet";
import healthRoutes from "./routes/health";
import v1Routes from "./routes/v1";

type Variables = {
  auth: ReturnType<typeof createAuth>;
};

const app = new Hono<{ Bindings: CloudflareBindings; Variables: Variables }>();

// CORS configuration for auth routes
app.use(
  "/auth/**",
  cors(
    createCorsConfig({
      exposeHeaders: ["Content-Length"],
      maxAge: 600,
    })
  )
);

// CORS for user routes
app.use("/user/*", cors(createCorsConfig()));

// CORS for wallet routes
app.use("/wallet/*", cors(createCorsConfig()));

// CORS for health routes
app.use("/health/*", cors(createCorsConfig()));

// CORS for v1 routes (OpenAI compatibility)
app.use(
  "/v1/*",
  cors(
    createCorsConfig({
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "Sec-WebSocket-Protocol"],
    })
  )
);

// Middleware to initialize auth instance for each request
app.use("*", async (c, next) => {
  const auth = createAuth(c.env, (c.req.raw as any).cf || {});
  c.set("auth", auth);
  await next();
});

// Handle all auth routes
app.all("/auth/*", async (c) => {
  const auth = c.get("auth");
  return auth.handler(c.req.raw);
});

// Home page
app.get("/", (c) => {
  return c.json({
    status: "healthy",
    service: "Sokuji Backend (Better Auth)",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
});

// API routes
app.route("/user", userRoutes);
app.route("/wallet", walletRoutes);
app.route("/health", healthRoutes);

// V1 routes (OpenAI compatibility)
app.route("/v1", v1Routes);

// Error handling
app.onError((err, c) => {
  console.error("Error:", err);

  const isDevelopment = c.env.ENVIRONMENT === "development";

  return c.json(
    {
      error: "Internal server error",
      ...(isDevelopment && { message: err.message, stack: err.stack }),
    },
    500
  );
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: "Not found" }, 404);
});

export default app;

// Export Durable Objects for Cloudflare Workers
export { RealtimeRelayDurableObject } from "./durable-objects/RealtimeRelayDurableObject";
