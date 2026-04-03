import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function resolveDatabasePath() {
  const configuredPath = process.env.DATABASE_PATH || "../../../data/notebooklm.db";

  if (isAbsolute(configuredPath)) {
    return configuredPath;
  }

  return resolve(__dirname, configuredPath);
}
