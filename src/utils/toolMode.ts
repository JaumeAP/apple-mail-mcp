/**
 * Server-side tool gate, set by APPLE_MAIL_MCP_MODE.
 *
 * Tool descriptions asking the model to "confirm with the user" are advisory: a
 * prompt injection carried in an email body can still call `send-email` or
 * `batch-delete-messages`. The mode removes those tools from the server, so a
 * caller cannot reach them at all.
 *
 * - `full` (default): every tool, as upstream.
 * - `no_send`: everything except the tools that send mail.
 * - `read_only`: only tools that leave Mail, the filesystem and the template
 *   store untouched.
 *
 * Every sending or deleting tool is also advertised with `destructiveHint`, so
 * a client that honours annotations can ask before running it in `full` mode.
 */
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

export const TOOL_MODE_ENV = "APPLE_MAIL_MCP_MODE";

export type ToolMode = "full" | "no_send" | "read_only";

const TOOL_MODES: readonly ToolMode[] = ["full", "no_send", "read_only"];

/** Tools that put a message on the wire. */
export const SENDING_TOOLS = new Set([
  "send-email",
  "send-serial-email",
  "reply-to-message",
  "forward-message",
]);

/** Tools that change Mail, the disk or the template store, beyond sending. */
const WRITING_TOOLS = new Set([
  "create-draft",
  "mark-as-read",
  "mark-as-unread",
  "flag-message",
  "unflag-message",
  "delete-message",
  "move-message",
  "batch-delete-messages",
  "batch-move-messages",
  "batch-mark-as-read",
  "batch-mark-as-unread",
  "batch-flag-messages",
  "batch-unflag-messages",
  "save-attachment",
  "create-mailbox",
  "delete-mailbox",
  "rename-mailbox",
  "create-smart-mailbox",
  "delete-smart-mailbox",
  "create-newsletter-smart-mailboxes",
  "enable-rule",
  "disable-rule",
  "create-rule",
  "delete-rule",
  "save-template",
  "delete-template",
  "use-template",
]);

/** Tools whose effect cannot be taken back from inside Mail. */
const DESTRUCTIVE_TOOLS = new Set([
  ...SENDING_TOOLS,
  "delete-message",
  "batch-delete-messages",
  "delete-mailbox",
  "delete-smart-mailbox",
  "create-rule",
  "delete-rule",
  "delete-template",
]);

/** Parse the mode; an unknown value is a configuration error, never a silent `full`. */
export function parseToolMode(raw: string | undefined): ToolMode {
  const value = (raw ?? "").trim().toLowerCase() || "full";
  if ((TOOL_MODES as readonly string[]).includes(value)) return value as ToolMode;
  throw new Error(`${TOOL_MODE_ENV} must be one of ${TOOL_MODES.join(", ")}; got "${raw}".`);
}

/** True when `name` may be offered under `mode`. */
export function isToolAllowed(name: string, mode: ToolMode): boolean {
  if (mode === "full") return true;
  if (SENDING_TOOLS.has(name)) return false;
  return mode === "no_send" || !WRITING_TOOLS.has(name);
}

/** Add `destructiveHint` to the tools that send or delete; leave the rest untouched. */
export function withSafetyAnnotations(
  name: string,
  annotations: ToolAnnotations | undefined
): ToolAnnotations | undefined {
  if (!DESTRUCTIVE_TOOLS.has(name)) return annotations;
  return { ...annotations, destructiveHint: true };
}
