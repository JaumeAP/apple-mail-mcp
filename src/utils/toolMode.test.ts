import { describe, expect, it } from "vitest";
import {
  SENDING_TOOLS,
  isToolAllowed,
  parseToolMode,
  withSafetyAnnotations,
} from "@/utils/toolMode.js";

describe("APPLE_MAIL_MCP_MODE tool gate", () => {
  it("defaults to full and rejects unknown modes instead of opening up", () => {
    expect(parseToolMode(undefined)).toBe("full");
    expect(parseToolMode(" NO_SEND ")).toBe("no_send");
    expect(() => parseToolMode("readonly")).toThrow(/must be one of/);
  });

  it("no_send drops every sending tool and keeps drafts and organizing", () => {
    for (const name of SENDING_TOOLS) expect(isToolAllowed(name, "no_send")).toBe(false);
    expect(isToolAllowed("create-draft", "no_send")).toBe(true);
    expect(isToolAllowed("batch-delete-messages", "no_send")).toBe(true);
  });

  it("read_only keeps reads and drops anything that writes", () => {
    expect(isToolAllowed("search-messages", "read_only")).toBe(true);
    expect(isToolAllowed("fetch-attachment", "read_only")).toBe(true);
    for (const name of [
      "send-email",
      "create-draft",
      "save-attachment",
      "delete-rule",
      "use-template",
    ]) {
      expect(isToolAllowed(name, "read_only")).toBe(false);
    }
  });

  it("marks sending and deleting tools destructive without dropping other hints", () => {
    expect(withSafetyAnnotations("send-email", { openWorldHint: true })).toEqual({
      openWorldHint: true,
      destructiveHint: true,
    });
    expect(withSafetyAnnotations("search-messages", { readOnlyHint: true })).toEqual({
      readOnlyHint: true,
    });
  });
});
