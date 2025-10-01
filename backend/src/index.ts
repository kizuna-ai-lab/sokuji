import { Hono } from "hono";
import { cors } from "hono/cors";
import { createAuth } from "./auth";
import type { CloudflareBindings } from "./env";
import userRoutes from "./routes/user";
import walletRoutes from "./routes/wallet";
import healthRoutes from "./routes/health";

type Variables = {
  auth: ReturnType<typeof createAuth>;
};

const app = new Hono<{ Bindings: CloudflareBindings; Variables: Variables }>();

// CORS configuration for auth routes
app.use(
  "/api/auth/**",
  cors({
    origin: (origin) => {
      if (!origin) {
        return "http://localhost:5173";
      }

      const allowed = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:63342",
        "https://sokuji.kizuna.ai",
        "https://www.sokuji.kizuna.ai",
        "https://dev.sokuji.kizuna.ai",
      ];

      if (allowed.includes(origin)) {
        return origin;
      }

      const patterns = [/^chrome-extension:\/\//, /^file:\/\//];

      for (const pattern of patterns) {
        if (pattern.test(origin)) {
          return origin;
        }
      }

      return null;
    },
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Device-Id", "X-Platform"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  })
);

// CORS for API routes
app.use(
  "/api/*",
  cors({
    origin: (origin) => {
      if (!origin) {
        return "http://localhost:5173";
      }

      const allowed = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:63342",
        "https://sokuji.kizuna.ai",
        "https://www.sokuji.kizuna.ai",
        "https://dev.sokuji.kizuna.ai",
      ];

      if (allowed.includes(origin)) {
        return origin;
      }

      const patterns = [/^chrome-extension:\/\//, /^file:\/\//];

      for (const pattern of patterns) {
        if (pattern.test(origin)) {
          return origin;
        }
      }

      return null;
    },
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Device-Id", "X-Platform"],
  })
);

// Middleware to initialize auth instance for each request
app.use("*", async (c, next) => {
  const auth = createAuth(c.env, (c.req.raw as any).cf || {});
  c.set("auth", auth);
  await next();
});

// Handle all auth routes
app.all("/api/auth/*", async (c) => {
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
app.route("/api/user", userRoutes);
app.route("/api/wallet", walletRoutes);
app.route("/api/health", healthRoutes);

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
