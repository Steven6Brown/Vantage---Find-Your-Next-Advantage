import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

// Safe JSON files: never lose data to a half-written file, a corrupt file, or a briefly locked file
// (OneDrive and antivirus tools lock files for a moment on Windows).

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LOCKED = new Set(["EPERM", "EBUSY", "EACCES"]);

/** Write a file by writing a uniquely named temp file and renaming it over the target, retrying if locked. */
export async function writeFileAtomic(file: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(tmp, contents, "utf8");
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.rename(tmp, file);
        return;
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code ?? "";
        if (!LOCKED.has(code) || attempt >= 5) {
          if (LOCKED.has(code)) {
            // Last resort when rename keeps failing: copy over the target.
            await fs.copyFile(tmp, file);
            return;
          }
          throw e;
        }
        await sleep(40 * 2 ** attempt);
      }
    }
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
  }
}

/** Keeps one copy of the current file as `<file>.bak` before it is replaced. Best effort. */
export async function backupFile(file: string): Promise<void> {
  try {
    await fs.copyFile(file, `${file}.bak`);
  } catch {
    /* no file yet, or locked: not worth failing a save over */
  }
}

export type ReadResult =
  | { kind: "ok"; text: string }
  | { kind: "missing" };

/** Reads a text file; a missing file is a normal result, not an error. */
export async function readTextIfExists(file: string): Promise<ReadResult> {
  try {
    return { kind: "ok", text: await fs.readFile(file, "utf8") };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
    throw e;
  }
}

/**
 * Moves an unreadable file aside (never deletes it) so the user can recover it by hand.
 * Returns the new file name.
 */
export async function quarantine(file: string, label: string): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(path.dirname(file), `${path.basename(file, path.extname(file))}.${label}-${stamp}${path.extname(file)}`);
  try {
    await fs.rename(file, dest);
  } catch {
    await fs.copyFile(file, dest).catch(() => undefined);
  }
  return path.basename(dest);
}
