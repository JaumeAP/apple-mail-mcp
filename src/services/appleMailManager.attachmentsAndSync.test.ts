/**
 * listAttachments is bound to the mailbox the id was listed from, and syncMail
 * asks Mail for new mail. Both only build and run AppleScript, so the script is
 * what is checked.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ scripts: [] as string[], output: "", source: "" }));

vi.mock("@/utils/applescript.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/applescript.js")>();
  return {
    ...actual,
    executeAppleScript: (script: string) => {
      h.scripts.push(script);
      // The raw-source fallback asks for `source of msg`; everything else gets `output`.
      const isSource = script.includes("return source of msg");
      return { success: true, output: isSource ? h.source : h.output };
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
  h.source = "";
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

describe("listAttachments survives an unreadable property (2026-10-14)", () => {
  it("reads name, MIME type and size each inside its own try", () => {
    manager({ account: "Nopuedomas", mailbox: "Sent" }).listAttachments("538547");
    const script = h.scripts[0];
    // `MIME type of att` throws "AppleEvent handler failed" for a PDF Apple Mail
    // attached; unguarded, that threw away the whole list.
    expect(script).toMatch(/try\s+set attType to MIME type of att\s+end try/);
    expect(script).toMatch(/try\s+set attSize to file size of att as string\s+end try/);
    expect(script).toMatch(/try\s+set attName to name of att\s+end try/);
  });

  it("falls back to the raw source and lists an inline PDF Apple Mail attached", () => {
    h.output = "";
    h.source = [
      'Content-Type: multipart/mixed; boundary="B"',
      "",
      "--B",
      "Content-Type: text/plain",
      "",
      "Hola",
      "--B",
      "Content-Disposition: inline;",
      '\tfilename="JAP 2026_40_transperfect.pdf"',
      "Content-Type: application/pdf;",
      '\tname="JAP 2026_40_transperfect.pdf"',
      "Content-Transfer-Encoding: base64",
      "",
      "JVBERi0xLjMK",
      "--B--",
    ].join("\n");
    const found = manager({ account: "Nopuedomas", mailbox: "Sent" }).listAttachments("538547");
    expect(found.map((a) => a.name)).toEqual(["JAP 2026_40_transperfect.pdf"]);
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
