import { Hono } from "hono";
import type { CloudflareBindings } from "../env";

const app = new Hono<{ Bindings: CloudflareBindings }>();

// Basic health check
app.get("/", (c) => {
  return c.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    environment: c.env.ENVIRONMENT || "unknown",
  });
});

// Database health check
app.get("/db", async (c) => {
  try {
    // Simple query to check database connectivity
    const result = await c.env.DATABASE.prepare("SELECT 1 as test").first();

    if (!result) {
      return c.json(
        {
          status: "unhealthy",
          database: "error",
          message: "Database query returned no results",
        },
        503
      );
    }

    return c.json({
      status: "healthy",
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Database health check failed:", error);
    return c.json(
      {
        status: "unhealthy",
        database: "error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      503
    );
  }
});

// KV health check
app.get("/kv", async (c) => {
  try {
    const testKey = "health_check_test";
    const testValue = Date.now().toString();

    await c.env.KV.put(testKey, testValue, { expirationTtl: 60 });
    const retrieved = await c.env.KV.get(testKey);

    if (retrieved !== testValue) {
      return c.json(
        {
          status: "unhealthy",
          kv: "error",
          message: "KV read/write test failed",
        },
        503
      );
    }

    await c.env.KV.delete(testKey);

    return c.json({
      status: "healthy",
      kv: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("KV health check failed:", error);
    return c.json(
      {
        status: "unhealthy",
        kv: "error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      503
    );
  }
});

export default app;
