import { describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";
import {
  ATTACHMENT_READ_ROOTS_ENV,
  canonicalRoots,
  isProtectedPath,
  resolveAttachmentReadPath,
} from "@/utils/attachmentReadPolicy.js";
import {
  isPathWithinAllowedRoots,
  resolveAttachmentSaveTarget,
} from "@/services/appleMailManager.js";

describe("outbound attachment read policy", () => {
  it("allows a regular file in the default temporary root", () => {
    const dir = mkdtempSync(join(tmpdir(), "amcp-read-policy-"));
    try {
      const file = join(dir, "report.pdf");
      writeFileSync(file, "pdf");
      expect(resolveAttachmentReadPath(file)).toBe(realpathSync(file));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("allows a regular file in an ordinary home-directory location", () => {
    const dir = mkdtempSync(join(homedir(), "amcp-read-policy-"));
    try {
      const file = join(dir, "private.txt");
      writeFileSync(file, "private");
      expect(resolveAttachmentReadPath(file)).toBe(realpathSync(file));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects hidden home-directory paths by default", () => {
    const dir = mkdtempSync(join(homedir(), ".amcp-read-policy-"));
    try {
      const file = join(dir, "selected.txt");
      writeFileSync(file, "secret");
      expect(() => resolveAttachmentReadPath(file)).toThrow(/protected location/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects application config files under the home Library", () => {
    const dir = mkdtempSync(join(homedir(), "Library", "Application Support", "amcp-read-policy-"));
    try {
      const file = join(dir, "config.json");
      writeFileSync(file, "{}");
      expect(() => resolveAttachmentReadPath(file)).toThrow(/protected location/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects app state under the home Library but allows iCloud Drive", () => {
    const appState = mkdtempSync(join(homedir(), "Library", "Caches", "amcp-read-policy-"));
    try {
      const file = join(appState, "chat.db");
      writeFileSync(file, "db");
      expect(() => resolveAttachmentReadPath(file)).toThrow(/protected location/);
    } finally {
      rmSync(appState, { recursive: true, force: true });
    }

    const home = realpathSync.native(homedir());
    const icloud = join(home, "Library", "Mobile Documents", "com~apple~CloudDocs", "x.pdf");
    expect(isProtectedPath(icloud)).toBe(false);
    expect(isProtectedPath(join(home, "Library", "CloudStorage", "Dropbox", "x.pdf"))).toBe(false);
    expect(isProtectedPath(join(home, "Library", "LaunchAgents", "x.plist"))).toBe(true);
    // Per-app iCloud containers are app state, not iCloud Drive.
    expect(
      isProtectedPath(join(home, "Library", "Mobile Documents", "iCloud~com~app", "db.sqlite"))
    ).toBe(true);
  });

  it("protects a user Library on any volume and in any spelling", () => {
    for (const path of [
      "/Volumes/Clone/Users/someone/Library/Messages/chat.db",
      "/Volumes/Backup/users/SOMEONE/library/Keychains/login.keychain-db",
      "/Users/JAP/Library/LaunchAgents/x.plist",
    ]) {
      expect(isProtectedPath(path), path).toBe(true);
    }
    expect(isProtectedPath("/Volumes/Clone/Users/someone/Documents/report.pdf")).toBe(false);
  });

  it("lets an explicit root, and the server's tmpdir, lift only the Library rule", () => {
    const mailDownloads = "/Users/someone/Library/Containers/com.apple.mail/Data/Downloads";
    expect(isProtectedPath(join(mailDownloads, "a.pdf"))).toBe(true);
    expect(isProtectedPath(join(mailDownloads, "a.pdf"), [mailDownloads])).toBe(false);
    expect(isProtectedPath(join(mailDownloads, ".hidden"), [mailDownloads])).toBe(true);
  });

  it("refuses save targets in hidden folders and Library app state", () => {
    const home = realpathSync.native(homedir());
    expect(isPathWithinAllowedRoots(join(home, "Downloads", "report.pdf"))).toBe(true);
    expect(isPathWithinAllowedRoots(join(home, "Library", "LaunchAgents", "evil.plist"))).toBe(
      false
    );
    expect(isPathWithinAllowedRoots(join(home, ".ssh", "authorized_keys"))).toBe(false);
    expect(isPathWithinAllowedRoots(join(home, "Downloads", ".zshrc"))).toBe(false);
  });

  it("refuses a save through a hidden folder that symlinks to a visible one", () => {
    const visible = mkdtempSync(join(homedir(), "amcp-dotfiles-"));
    const hidden = join(homedir(), `.amcp-link-${process.pid}`);
    try {
      symlinkSync(visible, hidden, "dir");
      expect(() => resolveAttachmentSaveTarget(hidden, "evil.lua")).toThrow(/outside allowed/);
      expect(resolveAttachmentSaveTarget(visible, "ok.pdf").savedPath).toBe(
        join(realpathSync.native(visible), "ok.pdf")
      );
    } finally {
      rmSync(hidden, { force: true });
      rmSync(visible, { recursive: true, force: true });
    }
  });

  it("keeps a dot-named attachment's name only in a staging directory", () => {
    // Any visible save root will do; the home keeps the test inside a sandboxed run.
    const dir = mkdtempSync(join(homedir(), "amcp-stage-"));
    try {
      expect(() => resolveAttachmentSaveTarget(dir, ".env")).toThrow(/outside allowed/);
      expect(resolveAttachmentSaveTarget(dir, ".env", { stagingDirectory: true }).savedPath).toBe(
        join(realpathSync.native(dir), ".env")
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never treats the filesystem root as a home-directory root", () => {
    expect(canonicalRoots(["/", "/tmp"])).toEqual([realpathSync.native("/tmp")]);
  });

  it("authorizes an explicit absolute root outside the defaults", () => {
    const file = "/etc/hosts";
    expect(resolveAttachmentReadPath(file, { [ATTACHMENT_READ_ROOTS_ENV]: "/etc" })).toBe(
      realpathSync(file)
    );
  });

  it("refuses a hidden path that is a symlink to an ordinary file", () => {
    // A dotfile manager's `~/.npmrc` -> `~/dotfiles/npmrc`: the target looks
    // ordinary, the path asked for names a credential location.
    const dir = mkdtempSync(join(homedir(), "amcp-dotfiles-"));
    const hidden = join(homedir(), `.amcp-npmrc-${process.pid}`);
    try {
      const target = join(dir, "npmrc");
      writeFileSync(target, "//registry.npmjs.org/:_authToken=secret");
      symlinkSync(target, hidden);
      expect(() => resolveAttachmentReadPath(hidden)).toThrow(/protected location/);
      expect(resolveAttachmentReadPath(target)).toBe(realpathSync(target));
    } finally {
      rmSync(hidden, { force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a file reached through a hidden folder that is a symlink to a visible one", () => {
    const dir = mkdtempSync(join(homedir(), "amcp-dotfiles-"));
    const hidden = join(homedir(), `.amcp-dir-${process.pid}`);
    try {
      writeFileSync(join(dir, "notes.txt"), "notes");
      symlinkSync(dir, hidden, "dir");
      expect(() => resolveAttachmentReadPath(join(hidden, "notes.txt"))).toThrow(
        /protected location/
      );
    } finally {
      rmSync(hidden, { force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a symlink that resolves outside an allowed temporary root", () => {
    const allowed = mkdtempSync(join(tmpdir(), "amcp-read-policy-"));
    try {
      const link = join(allowed, "link.txt");
      symlinkSync("/etc/hosts", link);
      expect(() => resolveAttachmentReadPath(link)).toThrow(/outside the allowed read roots/);
    } finally {
      rmSync(allowed, { recursive: true, force: true });
    }
  });
  it("canonicalizes to the on-disk spelling so a respelled segment cannot dodge a deny root", () => {
    // fs.realpathSync resolves symlinks but preserves the CALLER's casing; only
    // fs.realpathSync.native returns the true on-disk name. On a case-insensitive
    // volume (APFS default) that difference is a policy bypass: the deny roots are
    // written in exact case, so `~/library/keychains/...` opens the same file as
    // `~/Library/Keychains/...` while matching no deny root.
    const dir = mkdtempSync(join(homedir(), "AmcpCase-"));
    try {
      mkdirSync(join(dir, "Mixed"));
      const trueCased = join(dir, "Mixed", "Report.txt");
      writeFileSync(trueCased, "payload");

      const respelled = join(dir, "mixed", "report.txt");
      if (!existsSync(respelled)) return; // case-sensitive volume: respelling cannot exist

      // The policy must report the on-disk spelling, not the caller's.
      expect(resolveAttachmentReadPath(respelled)).toBe(realpathSync.native(trueCased));
      expect(resolveAttachmentReadPath(respelled)).not.toBe(respelled);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("denies a sensitive root under every spelling the filesystem accepts", () => {
    const keychain = join(homedir(), "Library", "Keychains", "login.keychain-db");
    if (!existsSync(keychain)) return; // not present on this host

    for (const variant of [
      keychain,
      join(homedir(), "library", "keychains", "login.keychain-db"),
      join(homedir(), "Library", "keychains", "login.keychain-db"),
    ]) {
      if (!existsSync(variant)) continue;
      expect(() => resolveAttachmentReadPath(variant)).toThrow(/protected location/);
    }
  });
});
