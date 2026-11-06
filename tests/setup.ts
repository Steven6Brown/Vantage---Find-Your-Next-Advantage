import { mkdtempSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Every test file gets its own empty data folder and in-memory accounts, so tests can never touch real data.
const dir = mkdtempSync(path.join(tmpdir(), "vantage-test-"));
cpSync(path.join(process.cwd(), "data", "profile.json"), path.join(dir, "profile.json"));
process.env.DATA_DIR = dir;
process.env.AUTH_DB_PATH ??= ":memory:";
process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.CRON_SECRET ??= "cron-secret-cron-secret-cron-secret-12";
delete process.env.ADZUNA_APP_ID;
delete process.env.ADZUNA_APP_KEY;
delete process.env.RESEND_API_KEY;
writeFileSync(path.join(dir, ".test-data"), "temporary test data");
