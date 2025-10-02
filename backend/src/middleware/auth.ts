import { Context, Next } from "hono";
import type { CloudflareBindings } from "../env";
import type { Auth } from "../auth";

type Variables = {
  auth: Auth;
  userId?: string;
  userEmail?: string;
};

/**
 * Middleware to verify authentication using Better Auth
 * Extracts user info from session and stores in context
 */
export async function authMiddleware(
  c: Context<{ Bindings: CloudflareBindings; Variables: Variables }>,
  next: Next
) {
  // Get auth instance from context (set by global middleware)
  const auth = c.get("auth");

  // Get session from Better Auth
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session?.user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // Store user info in context for use in route handlers
  c.set("userId", session.user.id);
  c.set("userEmail", session.user.email);

  await next();
}

/**
 * Middleware to optionally verify authentication
 * Sets user info if valid session is present, but doesn't require it
 */
export async function optionalAuthMiddleware(
  c: Context<{ Bindings: CloudflareBindings; Variables: Variables }>,
  next: Next
) {
  const auth = c.get("auth");

  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (session?.user) {
    c.set("userId", session.user.id);
    c.set("userEmail", session.user.email);
  }

  await next();
}
