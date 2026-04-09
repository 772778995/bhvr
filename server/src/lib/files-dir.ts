import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the data/files/ directory used for storing binary artifacts.
 * Respects DATA_FILES_DIR env var; defaults to <project-root>/data/files/.
 */
export function resolveFilesDir(): string {
  if (process.env.DATA_FILES_DIR) return process.env.DATA_FILES_DIR;
  // server/src/lib/ → ../../../data/files
  return resolve(__dirname, "../../../data/files");
}
