/**
 * A named sending account must be a real one.
 *
 * `set sender to "<account name>"` is not a valid sender in Mail: it silently
 * fell back to the default account, so a message asked to leave from one account
 * left from another (2026-10-10). A named account must be an enabled account, by
 * name or by address; its address is what Mail gets. With no account named, the
 * sender is read from Mail's own settings and set explicitly; when Mail does not
 * answer, no sender is set and Mail fills in that same default.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  scripts: [] as string[],
  output: "sent",
  /** What Mail answers when asked for its default sender; "" = no answer. */
  defaultSender: "",
  probes: 0,
}));

vi.mock("@/utils/applescript.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/applescript.js")>();
  return {
    ...actual,
    executeAppleScript: (script: string) => {
      if (script.includes("sender of newMsg")) {
        h.probes += 1;
        return { success: h.defaultSender !== "", output: h.defaultSender };
      }
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
  h.defaultSender = "";
  h.probes = 0;
});

describe("sendEmail sending account", () => {
  it("sends from the sender Mail's settings choose when no account is given", () => {
    h.defaultSender = "Jaume <me@icloud.example>";
    expect(send(manager())).toBe(true);
    expect(h.scripts).toHaveLength(1);
    expect(h.scripts[0]).toContain('set sender to "me@icloud.example"');
  });

  it("sets no sender when Mail does not answer, leaving Mail to fill in its default", () => {
    expect(send(manager())).toBe(true);
    expect(h.scripts[0]).not.toContain("set sender");
  });

  it("treats a blank account like none", () => {
    h.defaultSender = "me@icloud.example";
    expect(send(manager(), "  ")).toBe(true);
    expect(h.scripts[0]).toContain('set sender to "me@icloud.example"');
  });

  it("does not read the default sender when an account is given", () => {
    h.defaultSender = "me@icloud.example";
    expect(send(manager(), "Nopuedomas")).toBe(true);
    expect(h.probes).toBe(0);
    expect(h.scripts[0]).toContain('set sender to "jap@nopuedomas.example"');
  });

  it("reads the default sender once for a whole mail merge", () => {
    h.defaultSender = "me@icloud.example";
    const results = manager().sendSerialEmail(
      [
        { email: "a@example.com", variables: {} },
        { email: "b@example.com", variables: {} },
      ],
      "s",
      "b",
      undefined,
      0
    );
    expect(results.every((r) => r.success)).toBe(true);
    expect(h.probes).toBe(1);
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

  it("uses the sender Mail's settings choose when no account is given", () => {
    h.output = "draft created";
    h.defaultSender = "me@icloud.example";
    expect(manager().createDraft(["to@example.com"], "subject", "body")).toBe(true);
    expect(h.scripts).toHaveLength(1);
    expect(h.scripts[0]).toContain('set sender to "me@icloud.example"');
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

  it("makes a template draft from the sender Mail's settings choose when no account is given", () => {
    h.output = "draft created";
    h.defaultSender = "me@icloud.example";
    expect(withTemplate().useTemplate("t1")).toBe(true);
    expect(h.scripts).toHaveLength(1);
    expect(h.scripts[0]).toContain('set sender to "me@icloud.example"');
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
