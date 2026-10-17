/**
 * A named sending account must be a real one.
 *
 * `set sender to "<account name>"` is not a valid sender in Mail: it silently
 * fell back to the default account, so a message asked to leave from one account
 * left from another (2026-10-10). A named account must be an enabled account, by
 * name or by address; its address is what Mail gets. With no account named, the
 * script sets no sender and Mail uses the default sender chosen in its settings.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ scripts: [] as string[], output: "sent" }));

vi.mock("@/utils/applescript.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/applescript.js")>();
  return {
    ...actual,
    executeAppleScript: (script: string) => {
      h.scripts.push(script);
      return { success: true, output: h.output };
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
  h.output = "sent";
});

describe("sendEmail sending account", () => {
  it("leaves the sender to Mail's default when no account is given", () => {
    expect(send(manager())).toBe(true);
    expect(h.scripts).toHaveLength(1);
    expect(h.scripts[0]).not.toContain("set sender");
  });

  it("treats a blank account like none", () => {
    expect(send(manager(), "  ")).toBe(true);
    expect(h.scripts[0]).not.toContain("set sender");
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

  it("leaves the sender to Mail's default when no account is given", () => {
    h.output = "draft created";
    expect(manager().createDraft(["to@example.com"], "subject", "body")).toBe(true);
    expect(h.scripts).toHaveLength(1);
    expect(h.scripts[0]).not.toContain("set sender");
  });
});

describe("useTemplate sending account", () => {
  const template = {
    id: "t1",
    name: "T",
    subject: "s",
    body: "b",
    to: ["to@example.com"],
  };

  function withTemplate(): AppleMailManager {
    const mgr = manager();
    vi.spyOn(
      (mgr as unknown as { templateStore: { get: (id: string) => unknown } }).templateStore,
      "get"
    ).mockReturnValue(template);
    return mgr;
  }

  it("makes a template draft from Mail's default sender when no account is given", () => {
    h.output = "draft created";
    expect(withTemplate().useTemplate("t1")).toBe(true);
    expect(h.scripts).toHaveLength(1);
    expect(h.scripts[0]).not.toContain("set sender");
  });

  it("creates the draft from the given account's address", () => {
    withTemplate().useTemplate("t1", { account: "iCloud" });
    expect(h.scripts[0]).toContain('set sender to "me@icloud.example"');
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
