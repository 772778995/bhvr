import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { mkdirSync } from "node:fs";
import * as schema from "./schema.js";
import { dirname } from "node:path";
import { resolveDatabasePath } from "./path.js";

const DB_PATH = resolveDatabasePath();
mkdirSync(dirname(DB_PATH), { recursive: true });

const client = createClient({
  url: `file:${DB_PATH}`,
});

export const db = drizzle(client, { schema });
export default db;
