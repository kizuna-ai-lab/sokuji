import { Hono } from "hono";
import type { CloudflareBindings } from "../env";
import type { Auth } from "../auth";

type Variables = {
  auth: Auth;
};

const app = new Hono<{ Bindings: CloudflareBindings; Variables: Variables }>();

// Get wallet status (balance, plan, usage statistics)
app.get("/status", async (c) => {
  try {
    const auth = c.get("auth");
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (!session?.user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const { createWalletService } = await import("../services/wallet-service");
    const walletService = createWalletService(c.env);

    // Get wallet balance and entitlements
    const balance = await walletService.getBalance("user", session.user.id);

    if (!balance) {
      return c.json({ error: "Failed to get wallet status" }, 500);
    }

    // Get usage statistics (30-day usage and monthly quota)
    const usageStats = await walletService.getUsageStats("user", session.user.id);

    // Format response for frontend compatibility
    return c.json({
      // Balance information
      balance: balance.balanceTokens,
      frozen: balance.frozen,

      // Plan information
      plan: balance.planId?.replace(/_plan$/, "") || "free", // Remove '_plan' suffix for display

      // Usage statistics (new fields)
      monthlyQuota: usageStats?.monthlyQuota || 0, // Tokens allocated monthly for this plan
      last30DaysUsage: usageStats?.last30DaysUsage || 0, // Tokens used in past 30 days

      // Features and limits
      features: balance.features || [],
      rateLimitRpm: balance.rateLimitRpm || 60,
      maxConcurrentSessions: balance.maxConcurrentSessions || 1,

      // Compatibility fields for frontend
      total: balance.balanceTokens, // For compatibility, total = current balance
      used: 0, // In wallet model, we don't track monthly usage
      remaining: balance.frozen ? 0 : balance.balanceTokens,

      // No reset date in wallet model
      resetDate: null,
    });
  } catch (error) {
    console.error("Failed to get wallet status:", error);
    return c.json(
      {
        error: "Failed to get wallet status",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

export default app;
