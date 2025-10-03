import { Hono } from "hono";
import type { CloudflareBindings } from "../env";
import type { Auth } from "../auth";

type Variables = {
  auth: Auth;
};

const app = new Hono<{ Bindings: CloudflareBindings; Variables: Variables }>();

// All user endpoints have been removed as they are not used by the frontend
// User data is now managed through Better Auth session and /wallet/status endpoint

export default app;
