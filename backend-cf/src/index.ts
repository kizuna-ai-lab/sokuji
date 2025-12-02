import { Hono } from "hono";
import { cors } from "hono/cors";
import Stripe from "stripe";
import { createAuth } from "./auth";
import { sendFeedbackEmail } from "./lib/email";
import { createWalletService } from "./services/wallet-service";
import type { CloudflareBindings } from "./env";

// Feedback rate limiting
const DAILY_FEEDBACK_LIMIT = 3;

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

// One-Time Token verification wrapper
// This GET endpoint wraps the POST /api/auth/one-time-token/verify to support browser redirects
// The after hook in auth config will set the signed session cookie
app.get("/api/ott/verify", async (c) => {
    const token = c.req.query("token");
    const redirect = c.req.query("redirect") || "/dashboard";

    if (!token) {
        return c.redirect(`/sign-in?error=missing_token`);
    }

    try {
        const auth = c.get("auth");

        // Create a POST request to the internal verify endpoint
        // This will trigger the after hook which sets the signed cookie
        // IMPORTANT: Forward the original Cookie header so the hook can check for existing sessions
        const headers: HeadersInit = {
            "Content-Type": "application/json",
        };
        const cookie = c.req.header("cookie");
        if (cookie) {
            headers["Cookie"] = cookie;
        }

        const verifyRequest = new Request(
            new URL("/api/auth/one-time-token/verify", c.req.url).toString(),
            {
                method: "POST",
                headers,
                body: JSON.stringify({ token }),
            }
        );

        // Call the auth handler directly
        const response = await auth.handler(verifyRequest);

        if (!response.ok) {
            return c.redirect(`/sign-in?error=invalid_token`);
        }

        // Get the Set-Cookie header from the response (set by our after hook)
        const setCookie = response.headers.get("Set-Cookie");

        // Create redirect response
        const redirectResponse = c.redirect(redirect);

        // Forward the cookie header if present
        if (setCookie) {
            redirectResponse.headers.set("Set-Cookie", setCookie);
        }

        return redirectResponse;
    } catch (error) {
        console.error("OTT verification error:", error);
        return c.redirect(`/sign-in?error=verification_failed`);
    }
});

// CORS for feedback routes
app.use(
    "/api/feedback/*",
    cors({
        origin: "*",
        allowHeaders: ["Content-Type", "Authorization"],
        allowMethods: ["GET", "POST", "OPTIONS"],
        maxAge: 600,
    })
);
app.use(
    "/api/feedback",
    cors({
        origin: "*",
        allowHeaders: ["Content-Type", "Authorization"],
        allowMethods: ["GET", "POST", "OPTIONS"],
        maxAge: 600,
    })
);

// Get remaining feedback count for today
app.get("/api/feedback/remaining", async (c) => {
    try {
        const auth = c.get("auth");
        const session = await auth.api.getSession({
            headers: c.req.raw.headers,
        });

        if (!session?.user) {
            return c.json(
                { error: "Authentication required" },
                401
            );
        }

        const userId = session.user.id;
        const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
        const kvKey = `feedback:${userId}:${today}`;
        const currentCount = parseInt((await c.env.KV.get(kvKey)) || "0");

        return c.json({
            remaining: Math.max(0, DAILY_FEEDBACK_LIMIT - currentCount),
            limit: DAILY_FEEDBACK_LIMIT,
            used: currentCount,
        });
    } catch (error) {
        console.error("Error checking feedback remaining:", error);
        return c.json(
            { error: "Failed to check remaining feedback count" },
            500
        );
    }
});

// Feedback submission endpoint (requires authenticated user with verified email)
app.post("/api/feedback", async (c) => {
    try {
        // Check authentication and email verification first
        const auth = c.get("auth");
        const session = await auth.api.getSession({
            headers: c.req.raw.headers,
        });

        if (!session?.user) {
            return c.json(
                { error: "Authentication required. Please sign in to submit feedback." },
                401
            );
        }

        if (!session.user.emailVerified) {
            return c.json(
                { error: "Please verify your email address before submitting feedback." },
                403
            );
        }

        const userId = session.user.id;
        const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
        const kvKey = `feedback:${userId}:${today}`;

        // Check daily limit
        const currentCount = parseInt((await c.env.KV.get(kvKey)) || "0");
        if (currentCount >= DAILY_FEEDBACK_LIMIT) {
            return c.json(
                {
                    error: `Daily limit reached. You can send up to ${DAILY_FEEDBACK_LIMIT} feedback messages per day.`,
                    remaining: 0,
                    limit: DAILY_FEEDBACK_LIMIT,
                },
                429
            );
        }

        const body = await c.req.json();
        const { type, message } = body;

        // Use authenticated user's email
        const email = session.user.email;

        // Validate required fields
        if (!type || !message) {
            return c.json(
                { error: "Missing required fields: type, message" },
                400
            );
        }

        // Validate feedback type
        const validTypes = ["bug", "suggestion", "other"];
        if (!validTypes.includes(type)) {
            return c.json(
                { error: "Invalid type. Must be: bug, suggestion, or other" },
                400
            );
        }

        // Validate message length
        if (message.length < 10) {
            return c.json(
                { error: "Message must be at least 10 characters long" },
                400
            );
        }

        if (message.length > 5000) {
            return c.json(
                { error: "Message must be less than 5000 characters" },
                400
            );
        }

        // Get user agent
        const userAgent = c.req.header("User-Agent");

        // Send feedback email
        await sendFeedbackEmail(
            {
                fromEmail: email,
                feedbackType: type,
                message,
                userId,
                userAgent,
            },
            {
                user: c.env.ZOHO_MAIL_USER,
                password: c.env.ZOHO_MAIL_PASSWORD,
            }
        );

        // Update daily count with 24h expiration
        await c.env.KV.put(kvKey, String(currentCount + 1), {
            expirationTtl: 86400,
        });

        const newRemaining = DAILY_FEEDBACK_LIMIT - currentCount - 1;

        return c.json({
            success: true,
            message: "Feedback sent successfully",
            remaining: newRemaining,
            limit: DAILY_FEEDBACK_LIMIT,
        });
    } catch (error) {
        console.error("Feedback submission error:", error);
        return c.json(
            {
                error: "Failed to submit feedback. Please try again later.",
            },
            500
        );
    }
});

// CORS for payment routes
app.use(
    "/api/payment/*",
    cors({
        origin: "*",
        allowHeaders: ["Content-Type", "Authorization", "Stripe-Signature"],
        allowMethods: ["GET", "POST", "OPTIONS"],
        maxAge: 600,
    })
);
app.use(
    "/api/payment",
    cors({
        origin: "*",
        allowHeaders: ["Content-Type", "Authorization", "Stripe-Signature"],
        allowMethods: ["GET", "POST", "OPTIONS"],
        maxAge: 600,
    })
);

// CORS for wallet routes
app.use(
    "/api/wallet/*",
    cors({
        origin: "*",
        allowHeaders: ["Content-Type", "Authorization"],
        allowMethods: ["GET", "POST", "OPTIONS"],
        maxAge: 600,
    })
);
app.use(
    "/api/wallet",
    cors({
        origin: "*",
        allowHeaders: ["Content-Type", "Authorization"],
        allowMethods: ["GET", "POST", "OPTIONS"],
        maxAge: 600,
    })
);

// Payment configuration (public)
app.get("/api/payment/config", async (c) => {
    return c.json({
        publishableKey: c.env.STRIPE_PUBLISHABLE_KEY || "",
        minAmount: 500, // $5.00 in cents
        maxAmount: 50000, // $500.00 in cents
        tokensPerDollar: 1_000_000,
    });
});

// Create Stripe checkout session
app.post("/api/payment/create-checkout-session", async (c) => {
    try {
        const auth = c.get("auth");
        const session = await auth.api.getSession({
            headers: c.req.raw.headers,
        });

        if (!session?.user) {
            return c.json({ error: "Authentication required" }, 401);
        }

        const { amount } = await c.req.json();

        // Validate amount (in cents)
        if (!amount || typeof amount !== "number") {
            return c.json({ error: "Invalid amount" }, 400);
        }

        if (amount < 500 || amount > 50000) {
            return c.json({ error: "Amount must be between $5 and $500" }, 400);
        }

        if (!c.env.STRIPE_SECRET_KEY) {
            return c.json({ error: "Stripe not configured" }, 500);
        }

        const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, {
            apiVersion: "2025-04-30.basil",
        });

        const checkoutSession = await stripe.checkout.sessions.create({
            mode: "payment",
            payment_method_types: ["card"],
            line_items: [
                {
                    price_data: {
                        currency: "usd",
                        product_data: {
                            name: "Token Top-up",
                            description: `${((amount / 100) * 1_000_000).toLocaleString()} tokens`,
                        },
                        unit_amount: amount,
                    },
                    quantity: 1,
                },
            ],
            metadata: {
                userId: session.user.id,
                userEmail: session.user.email,
                amountCents: amount.toString(),
            },
            customer_email: session.user.email,
            success_url: `${new URL(c.req.url).origin}/dashboard/wallet?success=true`,
            cancel_url: `${new URL(c.req.url).origin}/dashboard/wallet?canceled=true`,
        });

        return c.json({ url: checkoutSession.url });
    } catch (error) {
        console.error("Create checkout session error:", error);
        return c.json({ error: "Failed to create checkout session" }, 500);
    }
});

// Stripe webhook handler
app.post("/api/payment/webhook", async (c) => {
    try {
        if (!c.env.STRIPE_SECRET_KEY || !c.env.STRIPE_WEBHOOK_SECRET) {
            console.error("Stripe not configured");
            return c.json({ error: "Stripe not configured" }, 500);
        }

        const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, {
            apiVersion: "2025-04-30.basil",
        });

        const signature = c.req.header("stripe-signature");
        if (!signature) {
            return c.json({ error: "Missing signature" }, 400);
        }

        const body = await c.req.text();

        let event: Stripe.Event;
        try {
            event = await stripe.webhooks.constructEventAsync(
                body,
                signature,
                c.env.STRIPE_WEBHOOK_SECRET
            );
        } catch (err) {
            console.error("Webhook signature verification failed:", err);
            return c.json({ error: "Invalid signature" }, 400);
        }

        // Log webhook for audit trail
        try {
            await c.env.DATABASE.prepare(`
                INSERT INTO webhook_logs (event_id, event_type, raw_payload, headers, created_at, processing_status)
                VALUES (?, ?, ?, ?, ?, 'pending')
            `).bind(
                event.id,
                event.type,
                body,
                JSON.stringify({ signature: signature?.substring(0, 50) + "..." }),
                Date.now()
            ).run();
        } catch (logError) {
            console.warn("Failed to log webhook:", logError);
        }

        // Handle checkout.session.completed event
        if (event.type === "checkout.session.completed") {
            const checkoutSession = event.data.object as Stripe.Checkout.Session;

            if (checkoutSession.payment_status === "paid") {
                const userId = checkoutSession.metadata?.userId;
                const amountCents = parseInt(checkoutSession.metadata?.amountCents || "0");

                if (!userId || !amountCents) {
                    console.error("Missing metadata in checkout session");
                    return c.json({ error: "Missing metadata" }, 400);
                }

                const walletService = createWalletService(c.env);
                const result = await walletService.mintTokensFromTopUp({
                    subjectType: "user",
                    subjectId: userId,
                    amountCents,
                    externalEventId: event.id,
                    stripeSessionId: checkoutSession.id,
                    stripePaymentIntentId: checkoutSession.payment_intent as string,
                    metadata: {
                        customerEmail: checkoutSession.customer_email,
                    },
                });

                if (!result.success) {
                    console.error("Failed to mint tokens:", result.error);
                    // Update webhook log
                    await c.env.DATABASE.prepare(`
                        UPDATE webhook_logs SET processing_status = 'failed', error_message = ?, processed_at = ?
                        WHERE event_id = ?
                    `).bind(result.error, Date.now(), event.id).run();
                    return c.json({ error: result.error }, 500);
                }

                // Update webhook log as successful
                await c.env.DATABASE.prepare(`
                    UPDATE webhook_logs SET processing_status = 'success', user_id = ?, processed_at = ?
                    WHERE event_id = ?
                `).bind(userId, Date.now(), event.id).run();

                console.log(`Successfully processed payment for user ${userId}: ${result.minted} tokens`);
            }
        }

        return c.json({ received: true });
    } catch (error) {
        console.error("Webhook error:", error);
        return c.json({ error: "Webhook processing failed" }, 500);
    }
});

// Get payment history
app.get("/api/payment/history", async (c) => {
    try {
        const auth = c.get("auth");
        const session = await auth.api.getSession({
            headers: c.req.raw.headers,
        });

        if (!session?.user) {
            return c.json({ error: "Authentication required" }, 401);
        }

        const walletService = createWalletService(c.env);
        const limit = parseInt(c.req.query("limit") || "50");
        const offset = parseInt(c.req.query("offset") || "0");

        const { payments, total } = await walletService.getPaymentHistory(
            "user",
            session.user.id,
            Math.min(limit, 100),
            offset
        );

        return c.json({ payments, total });
    } catch (error) {
        console.error("Get payment history error:", error);
        return c.json({ error: "Failed to get payment history" }, 500);
    }
});

// Get wallet status
app.get("/api/wallet/status", async (c) => {
    try {
        const auth = c.get("auth");
        const session = await auth.api.getSession({
            headers: c.req.raw.headers,
        });

        if (!session?.user) {
            return c.json({ error: "Authentication required" }, 401);
        }

        const walletService = createWalletService(c.env);
        const balance = await walletService.getBalance("user", session.user.id);
        const usage = await walletService.getUsageStats("user", session.user.id);

        return c.json({
            balance: balance?.balanceTokens || 0,
            frozen: balance?.frozen || false,
            usage: usage?.last30DaysUsage || 0,
        });
    } catch (error) {
        console.error("Get wallet status error:", error);
        return c.json({ error: "Failed to get wallet status" }, 500);
    }
});

// All non-API routes: serve static assets (SPA)
app.all("*", async (c) => {
    return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
