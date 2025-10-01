import { drizzle } from "drizzle-orm/d1";
import type { CloudflareBindings } from "../env";
import * as schema from "./schema";

export function createDb(env: CloudflareBindings) {
  return drizzle(env.DATABASE, { schema });
}

export type Database = ReturnType<typeof createDb>;

export { schema };
