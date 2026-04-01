import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync, readFileSync, readlinkSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir } from "./helpers.mjs";
import {
  isSymlink, isRealDir, isFile, ensureDir, removeIfEmpty,
  safeSymlink, getSkillNames, normalizeGitHubUrl, cleanCliArtifacts,
  cleanLockEntry,
  validateLockFile,
} from "../scripts/lib.mjs";

let tmp;
afterEach(() => tmp?.cleanup());

describe("isSymlink", () => {
  it("true for symlink", () => {
    tmp = makeTmpDir();
    writeFileSync(join(tmp.dir, "target"), "x");
    symlinkSync("target", join(tmp.dir, "link"));
    assert.equal(isSymlink(join(tmp.dir, "link")), true);
  });
  it("false for regular file", () => {
    tmp = makeTmpDir();
    writeFileSync(join(tmp.dir, "f"), "x");
    assert.equal(isSymlink(join(tmp.dir, "f")), false);
  });
  it("false for missing", () => {
    assert.equal(isSymlink("/nonexistent-aiws-test"), false);
  });
});

describe("isRealDir", () => {
  it("true for real dir", () => {
    tmp = makeTmpDir();
    mkdirSync(join(tmp.dir, "d"));
    assert.equal(isRealDir(join(tmp.dir, "d")), true);
  });
  it("false for symlink to dir", () => {
    tmp = makeTmpDir();
    mkdirSync(join(tmp.dir, "d"));
    symlinkSync("d", join(tmp.dir, "link"));
    assert.equal(isRealDir(join(tmp.dir, "link")), false);
  });
  it("false for missing", () => {
    assert.equal(isRealDir("/nonexistent-aiws-test"), false);
  });
});

describe("isFile", () => {
  it("true for regular file", () => {
    tmp = makeTmpDir();
    writeFileSync(join(tmp.dir, "f"), "x");
    assert.equal(isFile(join(tmp.dir, "f")), true);
  });
  it("false for dir", () => {
    tmp = makeTmpDir();
    mkdirSync(join(tmp.dir, "d"));
    assert.equal(isFile(join(tmp.dir, "d")), false);
  });
  it("false for symlink to file", () => {
    tmp = makeTmpDir();
    writeFileSync(join(tmp.dir, "f"), "x");
    symlinkSync("f", join(tmp.dir, "link"));
    assert.equal(isFile(join(tmp.dir, "link")), false);
  });
});

describe("ensureDir", () => {
  it("creates nested dirs", () => {
    tmp = makeTmpDir();
    const nested = join(tmp.dir, "a", "b", "c");
    ensureDir(nested);
    assert.equal(isRealDir(nested), true);
  });
  it("idempotent", () => {
    tmp = makeTmpDir();
    const nested = join(tmp.dir, "a", "b");
    ensureDir(nested);
    ensureDir(nested);
    assert.equal(isRealDir(nested), true);
  });
});

describe("removeIfEmpty", () => {
  it("removes empty dir", () => {
    tmp = makeTmpDir();
    const d = join(tmp.dir, "empty");
    mkdirSync(d);
    assert.equal(removeIfEmpty(d), true);
    assert.equal(isRealDir(d), false);
  });
  it("leaves non-empty dir", () => {
    tmp = makeTmpDir();
    const d = join(tmp.dir, "notempty");
    mkdirSync(d);
    writeFileSync(join(d, "f"), "x");
    assert.equal(removeIfEmpty(d), false);
    assert.equal(isRealDir(d), true);
  });
  it("ignores .DS_Store", () => {
    tmp = makeTmpDir();
    const d = join(tmp.dir, "ds");
    mkdirSync(d);
    writeFileSync(join(d, ".DS_Store"), "");
    assert.equal(removeIfEmpty(d), true);
  });
  it("no-ops on missing", () => {
    assert.equal(removeIfEmpty("/nonexistent-aiws-test"), false);
  });
});

describe("safeSymlink", () => {
  it("creates symlink", () => {
    tmp = makeTmpDir();
    writeFileSync(join(tmp.dir, "target"), "x");
    const ok = safeSymlink("target", join(tmp.dir, "link"), { quiet: true });
    assert.equal(ok, true);
    assert.equal(isSymlink(join(tmp.dir, "link")), true);
  });
  it("replaces stale symlink", () => {
    tmp = makeTmpDir();
    writeFileSync(join(tmp.dir, "a"), "x");
    writeFileSync(join(tmp.dir, "b"), "y");
    symlinkSync("a", join(tmp.dir, "link"));
    safeSymlink("b", join(tmp.dir, "link"), { quiet: true });
    assert.equal(isSymlink(join(tmp.dir, "link")), true);
    assert.equal(readlinkSync(join(tmp.dir, "link")), "b");
  });
  it("skips correct symlink", () => {
    tmp = makeTmpDir();
    writeFileSync(join(tmp.dir, "target"), "x");
    symlinkSync("target", join(tmp.dir, "link"));
    const ok = safeSymlink("target", join(tmp.dir, "link"), { quiet: true });
    assert.equal(ok, true);
  });
  it("refuses to overwrite real file", () => {
    tmp = makeTmpDir();
    writeFileSync(join(tmp.dir, "target"), "x");
    writeFileSync(join(tmp.dir, "link"), "real");
    const ok = safeSymlink("target", join(tmp.dir, "link"), { quiet: true });
    assert.equal(ok, false);
  });
});

describe("getSkillNames", () => {
  it("returns non-dot subdirs and symlinks", () => {
    tmp = makeTmpDir();
    mkdirSync(join(tmp.dir, "alpha"), { recursive: true });
    writeFileSync(join(tmp.dir, "alpha", "SKILL.md"), "---\nname: alpha\n---\n");
    mkdirSync(join(tmp.dir, "beta"), { recursive: true });
    writeFileSync(join(tmp.dir, "beta", "SKILL.md"), "---\nname: beta\n---\n");
    mkdirSync(join(tmp.dir, "empty"));
    const names = getSkillNames(tmp.dir);
    assert.ok(names.includes("alpha"));
    assert.ok(names.includes("beta"));
    assert.ok(names.includes("empty"));
  });
  it("ignores dotfiles", () => {
    tmp = makeTmpDir();
    mkdirSync(join(tmp.dir, ".hidden"), { recursive: true });
    writeFileSync(join(tmp.dir, ".hidden", "SKILL.md"), "x");
    assert.deepEqual(getSkillNames(tmp.dir), []);
  });
  it("returns empty for missing dir", () => {
    assert.deepEqual(getSkillNames("/nonexistent-aiws-test"), []);
  });
});

describe("normalizeGitHubUrl", () => {
  it("blob URL → owner/repo", () => {
    assert.equal(
      normalizeGitHubUrl("https://github.com/acme/cool-skill/blob/main/SKILL.md"),
      "acme/cool-skill",
    );
  });
  it("raw URL → owner/repo", () => {
    assert.equal(
      normalizeGitHubUrl("https://github.com/acme/repo/raw/main/SKILL.md"),
      "acme/repo",
    );
  });
  it("strips .git suffix", () => {
    assert.equal(
      normalizeGitHubUrl("https://github.com/acme/repo.git/blob/main/x"),
      "acme/repo",
    );
  });
  it("returns null for non-GitHub URL", () => {
    assert.equal(normalizeGitHubUrl("https://gitlab.com/acme/repo/blob/main/x"), null);
  });
});

describe("cleanLockEntry", () => {
  it("removes matching skill from lock file", () => {
    tmp = makeTmpDir();
    const lock = { version: 1, skills: { humanizer: { source: "blader/humanizer" }, other: { source: "x/y" } } };
    writeFileSync(join(tmp.dir, "skills-lock.json"), JSON.stringify(lock));
    cleanLockEntry(tmp.dir, "humanizer");
    const after = JSON.parse(readFileSync(join(tmp.dir, "skills-lock.json"), "utf8"));
    assert.equal(after.skills.humanizer, undefined);
    assert.equal(after.skills.other.source, "x/y");
  });
  it("no-ops when skill not in lock", () => {
    tmp = makeTmpDir();
    const lock = { version: 1, skills: { other: { source: "x/y" } } };
    writeFileSync(join(tmp.dir, "skills-lock.json"), JSON.stringify(lock));
    cleanLockEntry(tmp.dir, "nonexistent");
    const after = JSON.parse(readFileSync(join(tmp.dir, "skills-lock.json"), "utf8"));
    assert.equal(after.skills.other.source, "x/y");
  });
  it("no-ops when no lock file exists", () => {
    tmp = makeTmpDir();
    assert.doesNotThrow(() => cleanLockEntry(tmp.dir, "anything"));
  });
  it("no-ops with null skill name", () => {
    tmp = makeTmpDir();
    const lock = { version: 1, skills: { humanizer: { source: "blader/humanizer" } } };
    writeFileSync(join(tmp.dir, "skills-lock.json"), JSON.stringify(lock));
    cleanLockEntry(tmp.dir, null);
    const after = JSON.parse(readFileSync(join(tmp.dir, "skills-lock.json"), "utf8"));
    assert.equal(after.skills.humanizer.source, "blader/humanizer");
  });
});

describe("cleanCliArtifacts", () => {
  it("removes symlinks in .cursor/skills and .claude/skills", () => {
    tmp = makeTmpDir();
    const cs = join(tmp.dir, ".cursor", "skills");
    mkdirSync(cs, { recursive: true });
    writeFileSync(join(tmp.dir, "target"), "x");
    symlinkSync(join(tmp.dir, "target"), join(cs, "my-skill"));
    cleanCliArtifacts(tmp.dir);
    assert.equal(isSymlink(join(cs, "my-skill")), false);
  });
  it("removes symlinks in bare skills/ (OpenClaw)", () => {
    tmp = makeTmpDir();
    const bare = join(tmp.dir, "skills");
    mkdirSync(bare, { recursive: true });
    writeFileSync(join(tmp.dir, "target"), "x");
    symlinkSync(join(tmp.dir, "target"), join(bare, "my-skill"));
    cleanCliArtifacts(tmp.dir);
    assert.equal(isSymlink(join(bare, "my-skill")), false);
    assert.equal(existsSync(bare), false);
  });
  it("leaves real files intact", () => {
    tmp = makeTmpDir();
    const cs = join(tmp.dir, ".cursor", "skills");
    mkdirSync(cs, { recursive: true });
    writeFileSync(join(cs, "real-file"), "keep");
    cleanCliArtifacts(tmp.dir);
    assert.equal(isFile(join(cs, "real-file")), true);
  });
});

describe("validateLockFile", () => {
  it("returns ok when lock entries match disk", () => {
    tmp = makeTmpDir();
    mkdirSync(join(tmp.dir, ".agents", "skills", "alpha"), { recursive: true });
    writeFileSync(join(tmp.dir, ".agents", "skills", "alpha", "SKILL.md"), "x");
    const lock = { version: 1, skills: { alpha: { source: "x/y" } } };
    writeFileSync(join(tmp.dir, "skills-lock.json"), JSON.stringify(lock));
    const result = validateLockFile(tmp.dir);
    assert.equal(result.ok, true);
    assert.deepEqual(result.extra, []);
    assert.deepEqual(result.missing, []);
  });

  it("detects extra lock entries with no directory", () => {
    tmp = makeTmpDir();
    mkdirSync(join(tmp.dir, ".agents", "skills"), { recursive: true });
    const lock = { version: 1, skills: { ghost: { source: "x/y" } } };
    writeFileSync(join(tmp.dir, "skills-lock.json"), JSON.stringify(lock));
    const result = validateLockFile(tmp.dir);
    assert.equal(result.ok, false);
    assert.deepEqual(result.extra, ["ghost"]);
  });

  it("detects directories missing from lock (ok stays true)", () => {
    tmp = makeTmpDir();
    mkdirSync(join(tmp.dir, ".agents", "skills", "local-skill"), { recursive: true });
    const lock = { version: 1, skills: {} };
    writeFileSync(join(tmp.dir, "skills-lock.json"), JSON.stringify(lock));
    const result = validateLockFile(tmp.dir);
    assert.equal(result.ok, true);
    assert.deepEqual(result.missing, ["local-skill"]);
  });

  it("handles missing lock file gracefully", () => {
    tmp = makeTmpDir();
    mkdirSync(join(tmp.dir, ".agents", "skills", "solo"), { recursive: true });
    const result = validateLockFile(tmp.dir);
    assert.equal(result.ok, true);
    assert.deepEqual(result.extra, []);
    assert.deepEqual(result.missing, ["solo"]);
  });

  it("handles missing skills directory gracefully", () => {
    tmp = makeTmpDir();
    const lock = { version: 1, skills: { phantom: { source: "a/b" } } };
    writeFileSync(join(tmp.dir, "skills-lock.json"), JSON.stringify(lock));
    const result = validateLockFile(tmp.dir);
    assert.equal(result.ok, false);
    assert.deepEqual(result.extra, ["phantom"]);
  });

  it("detects cross-contamination (entries from another directory)", () => {
    tmp = makeTmpDir();
    mkdirSync(join(tmp.dir, ".agents", "skills", "real-skill"), { recursive: true });
    const lock = { version: 1, skills: {
      "real-skill": { source: "a/b" },
      "wrong-skill": { source: "c/d" },
    }};
    writeFileSync(join(tmp.dir, "skills-lock.json"), JSON.stringify(lock));
    const result = validateLockFile(tmp.dir);
    assert.equal(result.ok, false);
    assert.deepEqual(result.extra, ["wrong-skill"]);
    assert.deepEqual(result.missing, []);
  });

  it("detects symlinked lock file", () => {
    tmp = makeTmpDir();
    const realDir = join(tmp.dir, "real");
    const linkDir = join(tmp.dir, "linked");
    mkdirSync(join(realDir, ".agents", "skills"), { recursive: true });
    mkdirSync(linkDir, { recursive: true });
    const lock = { version: 1, skills: {} };
    writeFileSync(join(realDir, "skills-lock.json"), JSON.stringify(lock));
    symlinkSync(join(realDir, "skills-lock.json"), join(linkDir, "skills-lock.json"));
    const result = validateLockFile(linkDir);
    assert.equal(result.ok, false);
    assert.equal(result.isSymlink, true);
  });
});
