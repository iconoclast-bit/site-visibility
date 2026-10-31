/** Rebuilds the demo data (relative to today). Usage: npm run reseed  (stop the server first). */
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve(process.env.DATA_DIR || ".data");
fs.rmSync(dir, { recursive: true, force: true });
console.log(`Removed ${dir}. Demo data will be regenerated, relative to today, on the next request.`);
