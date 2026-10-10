/**
 * A send needs a real sending account.
 *
 * `set sender to "<account name>"` is not a valid sender in Mail: it silently
 * fell back to the default account, so a message asked to leave from one account
 * left from another (2026-10-10). The sending account must be given and must be
 * an enabled account, by name or by address; its address is what Mail gets.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ scripts: [] as string[] }));

vi.mock("@/utils/applescript.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/applescript.js")>();
  return {
    ...actual,
    executeAppleScript: (script: string) => {
      h.scripts.push(script);
      return { success: true, output: "sent" };
    },
  };
});

import { AppleMailManager } from "@/services/appleMailManager.js";

const ACCOUNTS = [
  { name: "iCloud", email: "me@icloud.example", enabled: true },
  { name: "Nopuedomas", email: "jap@nopuedomas.example", enabled: true },
  { name: "Old", email: "old@example.com", enabled: false },
];

function manager(): AppleMailManager {
  const mgr = new AppleMailManager();
  vi.spyOn(
    mgr as unknown as { getCachedAccounts: () => unknown },
    "getCachedAccounts"
  ).mockReturnValue(ACCOUNTS);
  return mgr;
}

const send = (mgr: AppleMailManager, account?: string) =>
  mgr.sendEmail(["to@example.com"], "subject", "body", undefined, undefined, account);

afterEach(() => {
  h.scripts.length = 0;
});

describe("sendEmail sending account", () => {
  it("refuses a send with no account and composes nothing", () => {
    expect(() => send(manager())).toThrow(/No sending account given/);
    expect(h.scripts).toHaveLength(0);
  });

  it("refuses an account that matches no account, naming the real ones", () => {
    expect(() => send(manager(), "Nope")).toThrow(/does not match any enabled Mail account/);
    expect(() => send(manager(), "Nope")).toThrow(/jap@nopuedomas\.example/);
    expect(h.scripts).toHaveLength(0);
  });

  it("refuses a disabled account", () => {
    expect(() => send(manager(), "Old")).toThrow(/does not match any enabled Mail account/);
    expect(h.scripts).toHaveLength(0);
  });

  it("sends from the account's address when given its name", () => {
    expect(send(manager(), "Nopuedomas")).toBe(true);
    expect(h.scripts).toHaveLength(1);
    expect(h.scripts[0]).toContain('set sender to "jap@nopuedomas.example"');
    expect(h.scripts[0]).not.toContain('set sender to "Nopuedomas"');
  });

  it("accepts the address itself, in any case", () => {
    expect(send(manager(), "JAP@Nopuedomas.example")).toBe(true);
    expect(h.scripts[0]).toContain('set sender to "jap@nopuedomas.example"');
  });
});

describe("createDraft sending account", () => {
  it("refuses a named account that does not exist", () => {
    expect(() =>
      manager().createDraft(["to@example.com"], "subject", "body", undefined, undefined, "Nope")
    ).toThrow(/does not match any enabled Mail account/);
    expect(h.scripts).toHaveLength(0);
  });

  it("uses the address of a named account", () => {
    manager().createDraft(["to@example.com"], "subject", "body", undefined, undefined, "iCloud");
    expect(h.scripts[0]).toContain('set sender to "me@icloud.example"');
  });

  it("with no account keeps Mail's default and sets no sender", () => {
    manager().createDraft(["to@example.com"], "subject", "body");
    expect(h.scripts[0]).not.toContain("set sender");
  });
});

describe("sendSerialEmail sending account", () => {
  it("refuses the whole batch up front when the account is unknown", () => {
    expect(() =>
      manager().sendSerialEmail([{ email: "a@example.com", variables: {} }], "s", "b", "Nope")
    ).toThrow(/does not match any enabled Mail account/);
    expect(h.scripts).toHaveLength(0);
  });
});
