import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { CloudflareBindings } from "../env";
import { createDb } from "../db";
import { appUser, wallets, entitlements } from "../db/schema";
import type { Auth } from "../auth";

type Variables = {
  auth: Auth;
};

const app = new Hono<{ Bindings: CloudflareBindings; Variables: Variables }>();

// Get user profile
app.get("/profile", async (c) => {
  try {
    const auth = c.get("auth");
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (!session?.user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const db = createDb(c.env);

    // Get or create app user record
    let userRecord = await db.query.appUser.findFirst({
      where: eq(appUser.betterAuthUserId, session.user.id),
    });

    if (!userRecord) {
      // Create app user record if it doesn't exist
      const [newUser] = await db
        .insert(appUser)
        .values({
          betterAuthUserId: session.user.id,
          firstName: session.user.name || null,
          subscription: "free_plan",
          tokenQuota: 0,
          tokensUsed: 0,
        })
        .returning();

      userRecord = newUser;

      // Initialize wallet
      await db.insert(wallets).values({
        subjectType: "user",
        subjectId: session.user.id,
        balanceTokens: 0,
        frozen: false,
      });

      // Initialize entitlements
      await db.insert(entitlements).values({
        subjectType: "user",
        subjectId: session.user.id,
        planId: "free_plan",
        maxConcurrentSessions: 1,
        rateLimitRpm: 60,
      });
    }

    return c.json({
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        image: session.user.image,
        firstName: userRecord.firstName,
        lastName: userRecord.lastName,
        subscription: userRecord.subscription,
        tokenQuota: userRecord.tokenQuota,
        tokensUsed: userRecord.tokensUsed,
        createdAt: userRecord.createdAt,
      },
    });
  } catch (error) {
    console.error("Failed to get user profile:", error);
    return c.json(
      {
        error: "Failed to get user profile",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

// Get API key (wallet-based access)
app.get("/api-key", async (c) => {
  try {
    const auth = c.get("auth");
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (!session?.user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const db = createDb(c.env);

    // Check wallet balance
    const wallet = await db.query.wallets.findFirst({
      where: (wallets, { and, eq }) =>
        and(eq(wallets.subjectType, "user"), eq(wallets.subjectId, session.user.id)),
    });

    if (!wallet) {
      return c.json(
        {
          error: "Wallet not found",
          message: "Please contact support to initialize your wallet",
        },
        404
      );
    }

    if (wallet.frozen) {
      return c.json(
        {
          error: "Wallet frozen",
          message: "Your wallet has been frozen. Please contact support.",
        },
        403
      );
    }

    if (wallet.balanceTokens <= 0) {
      return c.json(
        {
          error: "Insufficient balance",
          message: "Please add tokens to your wallet to continue using the service",
          balance: wallet.balanceTokens,
        },
        402
      );
    }

    // For now, return a placeholder API key
    // In production, you would generate or retrieve a real API key from your system
    return c.json({
      apiKey: "kizuna-" + session.user.id.substring(0, 16),
      balance: wallet.balanceTokens,
      provider: "kizunaai",
    });
  } catch (error) {
    console.error("Failed to get API key:", error);
    return c.json(
      {
        error: "Failed to get API key",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

export default app;
