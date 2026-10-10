/**
 * listAttachments is bound to the mailbox the id was listed from, and syncMail
 * asks Mail for new mail. Both only build and run AppleScript, so the script is
 * what is checked.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ scripts: [] as string[], output: "" }));

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

type Internals = {
  getCachedAccounts: () => unknown;
  locationFor: (id: string) => { account: string; mailbox: string } | undefined;
  resolveMailboxFragment: (account: string, mailbox: string) => string;
};

afterEach(() => {
  h.scripts.length = 0;
  h.output = "";
});

function manager(location?: { account: string; mailbox: string }): AppleMailManager {
  const mgr = new AppleMailManager();
  const internals = mgr as unknown as Internals;
  vi.spyOn(internals, "getCachedAccounts").mockReturnValue([
    { name: "Nopuedomas", email: "jap@nopuedomas.example", enabled: true },
  ]);
  vi.spyOn(internals, "locationFor").mockReturnValue(location);
  vi.spyOn(internals, "resolveMailboxFragment").mockReturnValue('set _tmb to mailbox "BOUND"');
  return mgr;
}

describe("listAttachments mailbox binding", () => {
  it("looks only in the mailbox the id was listed from", () => {
    h.output = `a.pdf\x1fapplication/pdf\x1f10`;
    const found = manager({ account: "Nopuedomas", mailbox: "INBOX" }).listAttachments("538208");
    expect(found).toEqual([
      { id: "538208-a.pdf", name: "a.pdf", mimeType: "application/pdf", size: 10 },
    ]);
    expect(h.scripts[0]).toContain('set _tmb to mailbox "BOUND"');
    expect(h.scripts[0]).not.toContain("repeat with acct in accounts");
  });

  it("without a known mailbox, goes on past a hit with no attachments", () => {
    h.output = `a.pdf\x1fapplication/pdf\x1f10`;
    manager(undefined).listAttachments("538208");
    expect(h.scripts[0]).toContain("repeat with acct in accounts");
    expect(h.scripts[0]).toContain('if outputText is not "" then return outputText');
  });
});

describe("syncMail", () => {
  it("checks every account when none is named", () => {
    h.output = "false";
    expect(manager().syncMail()).toEqual({ accounts: "all", synchronized: false });
    expect(h.scripts[0]).toContain("check for new mail");
    expect(h.scripts[0]).not.toContain("synchronize with");
  });

  it("checks and synchronizes a named account, by address", () => {
    h.output = "true";
    expect(manager().syncMail("JAP@nopuedomas.example")).toEqual({
      accounts: "Nopuedomas",
      synchronized: true,
    });
    expect(h.scripts[0]).toContain('check for new mail for account "Nopuedomas"');
    expect(h.scripts[0]).toContain('synchronize with account "Nopuedomas"');
  });

  it("refuses an unknown account without running AppleScript", () => {
    expect(() => manager().syncMail("Nope")).toThrow(/does not match any Mail account/);
    expect(h.scripts).toHaveLength(0);
  });
});
