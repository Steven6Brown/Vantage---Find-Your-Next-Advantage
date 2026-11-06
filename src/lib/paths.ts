import path from "node:path";

/**
 * Where profile.json, store.json, settings.json and auth.db live. Read on every call (not at import)
 * so tests can point it at a temporary folder and never touch real data.
 */
export function dataDir(): string {
  return process.env.DATA_DIR ?? path.join(process.cwd(), "data");
}
