/**
 * Per-test isolation for on-disk state the server persists.
 *
 * The by-id scan's learned "stalled mailbox" list (#270 follow-up) lives in a
 * JSON file under ~/Library/Application Support/apple-mail-mcp by default.
 * Unit tests must neither read the developer's real list (it changes the
 * generated AppleScript) nor write to it, and tests must not leak entries into
 * each other — so every test file gets its own throwaway path, emptied before
 * each test (a fresh AppleMailManager used to mean a fresh in-memory list).
 *
 * The attachment tests also build files "in the home directory" to exercise the
 * path policy. They get a throwaway HOME (os.homedir() reads $HOME) so they
 * never write into the developer's real home, which a sandboxed run denies.
 */
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { beforeEach } from "vitest";

const root = mkdtempSync(join(tmpdir(), "amcp-vitest-"));
// Not under tmpdir(): the policy exempts the server's own tmpdir from the Library
// rule, so a home there could not exercise it. node_modules is git-ignored.
const home = join(process.cwd(), "node_modules", "amcp-vitest-home");
for (const dir of ["Library/Application Support", "Library/Caches", "Library/Keychains"]) {
  mkdirSync(join(home, dir), { recursive: true });
}
process.env.HOME = home;

const file = join(root, "stalled-mailboxes.json");
process.env.APPLE_MAIL_MCP_STALLED_MAILBOXES_FILE = file;
beforeEach(() => {
  process.env.APPLE_MAIL_MCP_STALLED_MAILBOXES_FILE = file;
  rmSync(file, { force: true });
});
