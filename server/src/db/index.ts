import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DB_PATH = resolve(
  __dirname,
  process.env.DATABASE_PATH || "../../../data/notebooklm.db"
);
mkdirSync(dirname(DB_PATH), { recursive: true });

const client = createClient({
  url: `file:${DB_PATH}`,
});

export const db = drizzle(client, { schema });
export default db;
