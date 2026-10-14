/**
 * Mail.app recovery: open Mail when it is closed, restart it when it is wedged.
 *
 * Every AppleScript call goes through one synchronous osascript, so a Mail.app
 * that has stopped answering Apple Events (days of uptime, a stuck sync) makes
 * every tool fail with `AppleEvent timed out (-1712)` until somebody restarts
 * it by hand. `ensureMailReady` runs before an AppleScript call and fixes the
 * two states a restart cures:
 *
 *   - Mail is not running: open it (`open -g -a Mail`) and wait until it answers.
 *   - Mail is running but a cheap probe times out: quit it, force-kill it if it
 *     will not quit, open it again and wait until it answers.
 *
 * It never retries a failed call, so a send that timed out is never sent twice;
 * the next call simply finds a healthy Mail. A restart happens at most once per
 * RESTART_COOLDOWN_MS, and only the current user's own Mail process is touched.
 * Permission refusals (-1743) are left alone: a restart does not cure them.
 *
 * Set APPLE_MAIL_MCP_AUTO_RECOVER=0 to turn the automatic part off; the
 * `restart-mail` tool keeps working.
 *
 * @module utils/mailRecovery
 */

import { spawnSync } from "child_process";

export const AUTO_RECOVER_ENV = "APPLE_MAIL_MCP_AUTO_RECOVER";

/** Outer limit for the probe; the in-script `with timeout` fires 4 s earlier. */
const PROBE_TIMEOUT_MS = 12_000;
/** A probe that succeeded is trusted for this long. */
const HEALTHY_TTL_MS = 30_000;
/** Minimum gap between two automatic restarts. */
const RESTART_COOLDOWN_MS = 10 * 60_000;
/** How long a freshly opened Mail may take to start answering. */
const READY_WAIT_MS = 45_000;
/** How long Mail gets to quit or die before the next step. */
const STOP_WAIT_MS = 6_000;
const POLL_MS = 1_500;

// Same refusals as PERMISSION_DENIED_PATTERN in applescript.ts, repeated here
// because applescript.ts imports this module.
const PERMISSION_DENIED = /\(-1743\)|not author(?:i[sz])ed|not permitted/i;

let healthyUntil = 0;
let lastRestartAt = 0;
let busy = false;

export interface RecoveryReport {
  ok: boolean;
  steps: string[];
}

type Probe = "ok" | "wedged" | "denied" | "other";

/** Automatic recovery is on unless switched off, and stays off under vitest. */
export function autoRecoverEnabled(): boolean {
  const flag = (process.env[AUTO_RECOVER_ENV] ?? "").trim().toLowerCase();
  if (flag === "0" || flag === "false") return false;
  if (flag === "1" || flag === "true") return true;
  return !process.env.VITEST;
}

/** A call just timed out: do not trust the last good probe. */
export function markMailUnhealthy(): void {
  healthyUntil = 0;
}

function sleepMs(ms: number): void {
  spawnSync("sleep", [String(ms / 1000)], { stdio: "ignore" });
}

/** PIDs of this user's Mail.app, never another user's. */
function mailPids(): number[] {
  const uid = process.getuid?.();
  if (uid === undefined) return [];
  const result = spawnSync("pgrep", ["-u", String(uid), "-x", "Mail"], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout) return [];
  return result.stdout
    .split("\n")
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

function probe(): Probe {
  const result = spawnSync(
    "osascript",
    ["-e", 'with timeout of 8 seconds\ntell application "Mail" to count of accounts\nend timeout'],
    { encoding: "utf8", timeout: PROBE_TIMEOUT_MS, killSignal: "SIGKILL" }
  );
  if (result.status === 0) return "ok";
  const text = result.stderr ?? "";
  if (PERMISSION_DENIED.test(text)) return "denied";
  const timedOut = (result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
  if (timedOut || result.signal || /\(-1712\)/.test(text)) return "wedged";
  return "other";
}

function waitUntilGone(ms: number): boolean {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (mailPids().length === 0) return true;
    sleepMs(500);
  }
  return mailPids().length === 0;
}

function waitUntilAnswering(ms: number): boolean {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (mailPids().length > 0 && probe() === "ok") return true;
    sleepMs(POLL_MS);
  }
  return false;
}

function openMail(): boolean {
  return spawnSync("open", ["-g", "-a", "Mail"], { stdio: "ignore" }).status === 0;
}

/**
 * Quit Mail (force-kill if it will not quit), open it again and wait until it
 * answers. Ignores the cooldown: this is what `restart-mail` runs.
 */
export function restartMail(): RecoveryReport {
  const steps: string[] = [];
  lastRestartAt = Date.now();
  healthyUntil = 0;

  const running = mailPids();
  if (running.length === 0) {
    steps.push("Mail was not running");
  } else {
    spawnSync(
      "osascript",
      ["-e", 'with timeout of 5 seconds\ntell application "Mail" to quit\nend timeout'],
      { timeout: 8_000, killSignal: "SIGKILL", stdio: "ignore" }
    );
    if (waitUntilGone(STOP_WAIT_MS)) {
      steps.push("Mail quit normally");
    } else {
      const stuck = mailPids();
      for (const pid of stuck) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // already gone
        }
      }
      steps.push(`Mail did not quit; force-killed pid ${stuck.join(", ")}`);
      if (!waitUntilGone(STOP_WAIT_MS)) {
        steps.push("Mail is still running after SIGKILL");
        return { ok: false, steps };
      }
    }
  }

  if (!openMail()) {
    steps.push("`open -g -a Mail` failed");
    return { ok: false, steps };
  }
  const ready = waitUntilAnswering(READY_WAIT_MS);
  steps.push(
    ready
      ? "Mail opened again and is answering Apple Events"
      : `Mail opened again but did not answer within ${READY_WAIT_MS / 1000}s`
  );
  if (ready) healthyUntil = Date.now() + HEALTHY_TTL_MS;
  return { ok: ready, steps };
}

/**
 * Called before an AppleScript call. Returns nothing: it only makes the next
 * call more likely to find Mail answering, and logs what it did to stderr.
 */
export function ensureMailReady(): void {
  if (busy || !autoRecoverEnabled() || Date.now() < healthyUntil) return;
  busy = true;
  try {
    if (mailPids().length === 0) {
      console.error("mail-recovery: Mail.app is not running; opening it");
      const ready = openMail() && waitUntilAnswering(READY_WAIT_MS);
      console.error(
        `mail-recovery: ${ready ? "Mail is answering" : "Mail did not answer in time"}`
      );
      if (ready) healthyUntil = Date.now() + HEALTHY_TTL_MS;
      return;
    }
    const state = probe();
    if (state === "ok") {
      healthyUntil = Date.now() + HEALTHY_TTL_MS;
      return;
    }
    if (state !== "wedged") return; // denied / unrelated failure: a restart would not help
    if (Date.now() - lastRestartAt < RESTART_COOLDOWN_MS) {
      console.error(
        "mail-recovery: Mail.app is not answering; last restart was under 10 minutes ago, not restarting"
      );
      return;
    }
    console.error("mail-recovery: Mail.app is not answering; restarting it");
    const report = restartMail();
    console.error(`mail-recovery: ${report.steps.join("; ")}`);
  } finally {
    busy = false;
  }
}
