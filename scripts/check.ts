// Local scheduler entry: `npm run check` (use Windows Task Scheduler for the daily run).
import { existsSync } from "node:fs";

for (const f of [".env.local", ".env"]) if (existsSync(f)) process.loadEnvFile(f);

const { runCheck } = await import("../src/lib/run");
const r = await runCheck();
console.log(`Checked ${r.at}: fetched ${r.fetched}, new ${r.added}, email ${r.emailed}`);
if (r.errors.length) console.log("Notes:\n- " + r.errors.join("\n- "));
