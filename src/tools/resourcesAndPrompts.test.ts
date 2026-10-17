import { describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppleMailManager } from "@/services/appleMailManager.js";
import { registerResourcesAndPrompts } from "@/tools/resourcesAndPrompts.js";

/** The prompts as registered, by name, with whether each is on offer. */
function promptsOffered(toolAllowed?: (tool: string) => boolean): Record<string, boolean> {
  const server = new McpServer({ name: "test", version: "0" });
  const register = vi.spyOn(server, "registerPrompt");
  registerResourcesAndPrompts(server, {} as AppleMailManager, toolAllowed);
  return Object.fromEntries(
    register.mock.calls.map((call, i) => [call[0], register.mock.results[i].value.enabled])
  );
}

describe("prompts follow the tool gate", () => {
  it("offers every prompt when every tool is allowed", () => {
    expect(promptsOffered()).toEqual({
      "triage-inbox": true,
      "compose-reply": true,
      "weekly-summary": true,
    });
  });

  it("drops the reply prompt when reply-to-message is not available", () => {
    expect(promptsOffered((tool) => tool !== "reply-to-message")).toEqual({
      "triage-inbox": true,
      "compose-reply": false,
      "weekly-summary": true,
    });
  });
});
