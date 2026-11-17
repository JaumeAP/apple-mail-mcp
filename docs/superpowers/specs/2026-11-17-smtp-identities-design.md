# SMTP sender identities

## Intent

`send-email` (and `reply-to-message` / `forward-message` over SMTP) can send
through only one SMTP login. A second sender whose mail server credentials differ
(for example `james.puig@elcine.com` on the same `smtp.nopuedomas.com` host as
`jap@nopuedomas.com`) is refused with
`SMTP From "..." is not a configured sender identity.` `ALLOWED_FROM` only lists
aliases of the single login, so it cannot help.

## Goals

- A caller-supplied From that matches a configured identity is sent with that
  identity's own login and Keychain password.
- Passwords stay in the Keychain (or the existing password env var for the
  primary identity). No secret in the config.
- No change for users who configure nothing new.

## Non-goals

- No per-identity IMAP account mapping beyond what the Sent-copy path already does.
- No auto-discovery of identities from Mail.app.

## Approaches

1. **`APPLE_MAIL_MCP_SMTP_IDENTITIES` JSON array (chosen).** Mirrors the existing
   `APPLE_MAIL_MCP_IMAP_ACCOUNTS`, one string value, readable, works in
   `config.json`.
2. Numbered environment variables (`SMTP_2_USER`, ...). Harder to read and to extend.
3. Derive from Mail.app account settings. Needs AppleScript and guesses at how
   Mail names its Keychain items.

## Design

- New env var `APPLE_MAIL_MCP_SMTP_IDENTITIES`: JSON array of objects
  `{ from, user, host?, port?, secure?, keychainService?, keychainAccount?,
password? }`. `host`, `port`, `secure` and `allowPlaintext` default to the
  primary identity's values. `user` defaults to `from`. `keychainService` defaults
  to `host`, `keychainAccount` to `user`, as for the primary identity.
- `resolveSmtpConfig(env, from?)`: when `from` equals (case-insensitive) an
  identity's `from`, return that identity's config. Otherwise the primary config,
  unchanged, including `ALLOWED_FROM` aliases.
- `sendViaSmtp` passes `opts.from` to `resolveSmtpConfig`.
- Invalid JSON, a non-array value, or an identity without `from` is a clear error
  naming the variable.
- `isSmtpConfigured` and `doctor` keep keying on the primary host and user;
  `doctor` additionally counts the identities.

## Left to the builder

Tests (resolution by From, inheritance, invalid JSON, no match falls back to the
primary rules), `docs/IMAP-SETUP.md` section, `CHANGELOG`/README mention if the
repository keeps them, version bump to `2.20.50-jap.3`.
