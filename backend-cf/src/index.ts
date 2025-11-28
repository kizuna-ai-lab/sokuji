import { Hono } from "hono";
import { cors } from "hono/cors";
import { createAuth } from "./auth";
import { sendFeedbackEmail } from "./lib/email";
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

// All non-API routes: serve static assets (SPA)
app.all("*", async (c) => {
    return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
