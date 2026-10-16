/**
 * Draft clean-up after send-email (draftId). The delete must never run on a
 * message that is not the draft written for this send, and never when the sent
 * copy is missing: a sent email with its draft still around is harmless, a
 * deleted draft with nothing sent is a lost email.
 */
import { describe, it, expect } from "vitest";
import { hasSentCopy, isDraftForSend, pollUntil } from "@/tools/draftCleanup.js";

const SENT_AT = new Date("2026-10-12T18:00:00Z");

describe("isDraftForSend", () => {
  it("accepts a draft in Drafts with the same subject", () => {
    expect(isDraftForSend({ subject: "Hola", mailbox: "Drafts" }, "Hola")).toBe(true);
  });

  it("accepts Gmail's [Gmail]/Drafts", () => {
    expect(isDraftForSend({ subject: "Hola", mailbox: "[Gmail]/Drafts" }, "Hola")).toBe(true);
  });

  it("refuses a missing draft", () => {
    expect(isDraftForSend(null, "Hola")).toBe(false);
  });

  it("refuses a different subject", () => {
    expect(isDraftForSend({ subject: "Otro", mailbox: "Drafts" }, "Hola")).toBe(false);
  });

  it("refuses a message that is not in a Drafts mailbox", () => {
    expect(isDraftForSend({ subject: "Hola", mailbox: "INBOX" }, "Hola")).toBe(false);
  });
});

describe("pollUntil", () => {
  const noSleep = () => Promise.resolve();

  it("returns true at once when the first check passes", async () => {
    let calls = 0;
    const ok = await pollUntil(() => (calls++, true), 6_000, 2_000, noSleep);
    expect(ok).toBe(true);
    expect(calls).toBe(1);
  });

  it("keeps looking until the copy turns up", async () => {
    let calls = 0;
    const ok = await pollUntil(() => ++calls === 3, 6_000, 2_000, noSleep);
    expect(ok).toBe(true);
    expect(calls).toBe(3);
  });

  it("gives up after the timeout, keeping the draft", async () => {
    let calls = 0;
    const ok = await pollUntil(() => (calls++, false), 6_000, 2_000, noSleep);
    expect(ok).toBe(false);
    expect(calls).toBe(4);
  });
});

describe("hasSentCopy", () => {
  const sent = (overrides: Partial<{ subject: string; mailbox: string; when: Date }>) => ({
    subject: overrides.subject ?? "Hola",
    mailbox: overrides.mailbox ?? "Sent Messages",
    dateReceived: overrides.when ?? new Date("2026-10-12T18:00:05Z"),
    dateSent: undefined,
  });

  it("finds the copy in Sent Messages sent after the send started", () => {
    expect(hasSentCopy([sent({})], "Hola", SENT_AT)).toBe(true);
  });

  it("finds the copy in Gmail's [Gmail]/Sent Mail", () => {
    expect(hasSentCopy([sent({ mailbox: "[Gmail]/Sent Mail" })], "Hola", SENT_AT)).toBe(true);
  });

  it("refuses when no Sent copy exists", () => {
    expect(hasSentCopy([], "Hola", SENT_AT)).toBe(false);
  });

  it("refuses an old Sent copy with the same subject", () => {
    const old = sent({ when: new Date("2026-09-01T10:00:00Z") });
    expect(hasSentCopy([old], "Hola", SENT_AT)).toBe(false);
  });

  it("refuses a copy with another subject", () => {
    expect(hasSentCopy([sent({ subject: "Otro" })], "Hola", SENT_AT)).toBe(false);
  });

  it("refuses a match that is only in Drafts", () => {
    expect(hasSentCopy([sent({ mailbox: "Drafts" })], "Hola", SENT_AT)).toBe(false);
  });

  it("uses dateSent over dateReceived when the author's date is present", () => {
    const m = {
      subject: "Hola",
      mailbox: "Sent Messages",
      dateReceived: new Date("2026-10-12T18:00:05Z"),
      dateSent: new Date("2026-09-01T10:00:00Z"),
    };
    expect(hasSentCopy([m], "Hola", SENT_AT)).toBe(false);
  });
});
