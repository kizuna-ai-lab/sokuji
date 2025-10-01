import { Hono } from "hono";
import { eq, and, desc, sql } from "drizzle-orm";
import type { CloudflareBindings } from "../env";
import { createDb } from "../db";
import { wallets, walletLedger, usageLogs, entitlements } from "../db/schema";
import type { Auth } from "../auth";

type Variables = {
  auth: Auth;
};

const app = new Hono<{ Bindings: CloudflareBindings; Variables: Variables }>();

// Get wallet balance
app.get("/balance", async (c) => {
  try {
    const auth = c.get("auth");
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (!session?.user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const db = createDb(c.env);

    const wallet = await db.query.wallets.findFirst({
      where: and(eq(wallets.subjectType, "user"), eq(wallets.subjectId, session.user.id)),
    });

    if (!wallet) {
      return c.json(
        {
          error: "Wallet not found",
          message: "Wallet not initialized",
        },
        404
      );
    }

    const entitlement = await db.query.entitlements.findFirst({
      where: and(eq(entitlements.subjectType, "user"), eq(entitlements.subjectId, session.user.id)),
    });

    return c.json({
      balance: wallet.balanceTokens,
      frozen: wallet.frozen,
      planId: entitlement?.planId || "free_plan",
      maxConcurrentSessions: entitlement?.maxConcurrentSessions || 1,
      rateLimitRpm: entitlement?.rateLimitRpm || 60,
      updatedAt: wallet.updatedAt,
    });
  } catch (error) {
    console.error("Failed to get wallet balance:", error);
    return c.json(
      {
        error: "Failed to get wallet balance",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

// Get usage history
app.get("/usage", async (c) => {
  try {
    const auth = c.get("auth");
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (!session?.user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const limit = parseInt(c.req.query("limit") || "50");
    const offset = parseInt(c.req.query("offset") || "0");

    const db = createDb(c.env);

    const usage = await db.query.usageLogs.findMany({
      where: and(eq(usageLogs.subjectType, "user"), eq(usageLogs.subjectId, session.user.id)),
      orderBy: [desc(usageLogs.createdAt)],
      limit,
      offset,
    });

    // Get total count
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(usageLogs)
      .where(and(eq(usageLogs.subjectType, "user"), eq(usageLogs.subjectId, session.user.id)));

    const total = countResult[0]?.count || 0;

    return c.json({
      usage,
      pagination: {
        limit,
        offset,
        total,
        hasMore: offset + limit < total,
      },
    });
  } catch (error) {
    console.error("Failed to get usage history:", error);
    return c.json(
      {
        error: "Failed to get usage history",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

// Get ledger history
app.get("/ledger", async (c) => {
  try {
    const auth = c.get("auth");
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (!session?.user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const limit = parseInt(c.req.query("limit") || "50");
    const offset = parseInt(c.req.query("offset") || "0");

    const db = createDb(c.env);

    const ledger = await db.query.walletLedger.findMany({
      where: and(
        eq(walletLedger.subjectType, "user"),
        eq(walletLedger.subjectId, session.user.id)
      ),
      orderBy: [desc(walletLedger.createdAt)],
      limit,
      offset,
    });

    // Get total count
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(walletLedger)
      .where(
        and(eq(walletLedger.subjectType, "user"), eq(walletLedger.subjectId, session.user.id))
      );

    const total = countResult[0]?.count || 0;

    return c.json({
      ledger,
      pagination: {
        limit,
        offset,
        total,
        hasMore: offset + limit < total,
      },
    });
  } catch (error) {
    console.error("Failed to get ledger history:", error);
    return c.json(
      {
        error: "Failed to get ledger history",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

// Mint tokens (admin only - implement proper authorization)
app.post("/mint", async (c) => {
  try {
    const auth = c.get("auth");
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (!session?.user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    // TODO: Add admin authorization check
    // For now, this endpoint is accessible to any authenticated user
    // In production, you should check if the user has admin privileges

    const body = await c.req.json();
    const { amount, description, planId } = body;

    if (!amount || amount <= 0) {
      return c.json({ error: "Invalid amount" }, 400);
    }

    const db = createDb(c.env);

    // Create ledger entry
    const [ledgerEntry] = await db
      .insert(walletLedger)
      .values({
        subjectType: "user",
        subjectId: session.user.id,
        amountTokens: amount,
        eventType: "mint",
        referenceType: "manual",
        planId: planId || null,
        description: description || "Manual token mint",
      })
      .returning();

    // Update wallet balance
    const wallet = await db.query.wallets.findFirst({
      where: and(eq(wallets.subjectType, "user"), eq(wallets.subjectId, session.user.id)),
    });

    if (wallet) {
      await db
        .update(wallets)
        .set({
          balanceTokens: wallet.balanceTokens + amount,
          updatedAt: sql`strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
        })
        .where(
          and(eq(wallets.subjectType, "user"), eq(wallets.subjectId, session.user.id))
        );
    } else {
      await db.insert(wallets).values({
        subjectType: "user",
        subjectId: session.user.id,
        balanceTokens: amount,
        frozen: false,
      });
    }

    return c.json({
      success: true,
      ledgerEntry,
      newBalance: (wallet?.balanceTokens || 0) + amount,
    });
  } catch (error) {
    console.error("Failed to mint tokens:", error);
    return c.json(
      {
        error: "Failed to mint tokens",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

export default app;
