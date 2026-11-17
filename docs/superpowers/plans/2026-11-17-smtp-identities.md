# SMTP sender identities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `send-email` (and reply/forward over SMTP) send as a second sender with its own SMTP login, chosen by the requested From.

**Architecture:** A new JSON env var lists extra identities. `resolveSmtpConfig(env, from?)` returns the matching identity's config (inheriting host/port/TLS from the primary) when `from` matches; otherwise the primary config as today. `sendViaSmtp` passes `opts.from`.

**Tech Stack:** TypeScript, nodemailer, vitest.

**Spec:** `docs/superpowers/specs/2026-11-17-smtp-identities-design.md`

## Global Constraints

- Passwords stay in the Keychain; the optional per-identity `password` field mirrors the discouraged `password` of `APPLE_MAIL_MCP_IMAP_ACCOUNTS`.
- No change in behavior when `APPLE_MAIL_MCP_SMTP_IDENTITIES` is unset.
- Version `2.20.50-jap.3` in every manifest that carries `2.20.50-jap.2`.
- Tests run on macOS only; run only `src/services/smtpMailer.test.ts` and `src/tools/doctor.test.ts`, plus typecheck, lint and `format:check`.

## Review Focus

- Case-insensitive From match (`James.Puig@Elcine.com`).
- Invalid JSON, non-array, or an entry without `from` names the variable in the error.
- An identity with no resolvable password fails with the identity's user in the message, never falling back to the primary password.
- A From that matches neither an identity nor the primary/`ALLOWED_FROM` keeps the existing `not a configured sender identity` error.
- Identity `from` equal to the primary `from` does not shadow the primary.

---

### Task 1: Identities in `resolveSmtpConfig`

**Files:**

- Modify: `src/services/smtpMailer.ts` (`SMTP_ENV`, `resolveSmtpConfig`, `sendViaSmtp`)
- Test: `src/services/smtpMailer.test.ts`
- Modify: `src/tools/doctor.ts` (count identities in the SMTP check detail)
- Test: `src/tools/doctor.test.ts`
- Modify: `docs/IMAP-SETUP.md` (new "Multiple SMTP identities" subsection under Step 4, plus a row in the variable table)

**Interfaces:**

- Produces: `SMTP_ENV.identities = "APPLE_MAIL_MCP_SMTP_IDENTITIES"`; `resolveSmtpConfig(env?: NodeJS.ProcessEnv, from?: string): SmtpConfig`. The returned config's `user`, `from`, `pass` come from the identity; `allowedFrom` is empty for an identity config.

- [ ] **Step 1: Write failing tests** in `smtpMailer.test.ts`, describe `resolveSmtpConfig identities`, with `identitiesEnv = { ...baseEnv, [SMTP_ENV.identities]: JSON.stringify([{ from: "james@elcine.com", user: "james@elcine.com", password: "pw2" }]) }`:
  - `resolveSmtpConfig(identitiesEnv, "james@elcine.com")` → `user`/`from` `james@elcine.com`, `pass` `pw2`, `host` `smtp.example.com`, `port` 587.
  - Same with `"James@Elcine.com"` → same `user`.
  - `resolveSmtpConfig(identitiesEnv, "alice@example.com")` and `resolveSmtpConfig(identitiesEnv)` → `user` `alice@example.com`, `pass` `s3cret`.
  - An identity with `host: "smtp.other.test"`, `port: 465`, `secure: true` overrides them.
  - `[SMTP_ENV.identities]: "not json"` and `"{}"` and `JSON.stringify([{ user: "x" }])` each throw an error matching `/APPLE_MAIL_MCP_SMTP_IDENTITIES/`.
  - An identity without `password` and a Keychain-less service (`keychainService: "smtp.nonexistent.invalid"`) throws `/no smtp password.*james@elcine\.com/i` and never returns `s3cret`.
  - `resolveSmtpFrom("james@elcine.com", resolveSmtpConfig(identitiesEnv, "james@elcine.com"))` returns `james@elcine.com`.
- [ ] **Step 2: Run** `pnpm vitest run src/services/smtpMailer.test.ts -t "identities"`. Expected: FAIL (`SMTP_ENV.identities` undefined).
- [ ] **Step 3: Implement** in `smtpMailer.ts`: add `identities` to `SMTP_ENV`; extend `resolveSmtpConfig(env, from?)` — parse the JSON (private helper `parseSmtpIdentities(env): SmtpIdentity[]` with the validation errors above), find the entry whose `from` equals the requested one case-insensitively and differs from the primary `from`, and build its config by reusing the primary values for `host`, `port`, `secure`, `allowPlaintext` and the same password resolution (identity `password`, else Keychain with `keychainService` default host, `keychainAccount` default identity user). Pass `opts.from` in `sendViaSmtp`: `resolveSmtpConfig(process.env, opts.from)`.
- [ ] **Step 4: Run** the same command. Expected: PASS; then `pnpm vitest run src/services/smtpMailer.test.ts` all PASS.
- [ ] **Step 5: doctor.** Test in `doctor.test.ts`: with `SMTP_IDENTITIES` of two entries set, the SMTP check detail contains `2 additional sender identities`. Implement in `doctor.ts` by counting `JSON.parse` entries, ignoring invalid JSON (it reports `invalid APPLE_MAIL_MCP_SMTP_IDENTITIES`). Run `pnpm vitest run src/tools/doctor.test.ts`.
- [ ] **Step 6: Docs.** Add the subsection and table row to `docs/IMAP-SETUP.md` with the Elcine example (one identity, `keychainService`/`keychainAccount`).
- [ ] **Step 7: Gate** `pnpm typecheck && pnpm lint && pnpm format:check`. Expected: no errors.
- [ ] **Step 8: Commit**

```bash
git add src/services/smtpMailer.ts src/services/smtpMailer.test.ts src/tools/doctor.ts src/tools/doctor.test.ts docs/IMAP-SETUP.md docs/superpowers
git commit -m "feat(smtp): add per-From SMTP sender identities"
```

### Task 2: Version bump

**Files:**

- Modify: every manifest listed by `grep -l "2.20.50-jap.2"`: `package.json`, `.agents/plugins/marketplace.json`, `.antigravity-plugin/marketplace.json`, `.antigravity-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.claude-plugin/plugin.json`, `codex/.mcp.json`, `codex/mcp.json`, `codex/plugin.json`, `codex/.codex-plugin/plugin.json`.

**Interfaces:** none.

- [ ] **Step 1:** replace `2.20.50-jap.2` with `2.20.50-jap.3` in those files (the `.claude-plugin/marketplace.json` has two occurrences).
- [ ] **Step 2:** `grep -rn "2.20.50-jap.2"` over those paths returns nothing; `pnpm build` succeeds.
- [ ] **Step 3: Commit** `git commit -m "chore(release): 2.20.50-jap.3"` with the ten files added by name.
