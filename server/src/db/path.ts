import { isAbsolute, resolve } from "node:path";

export function resolveDatabasePath() {
  const configuredPath = process.env.DATABASE_PATH || "../data/notebooklm.db";

  if (isAbsolute(configuredPath)) {
    return configuredPath;
  }

  return resolve(process.cwd(), configuredPath);
}
