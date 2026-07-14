import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync, mkdirSync, writeFileSync, readFileSync, readlinkSync, lstatSync,
} from "node:fs";
import { join } from "node:path";
import { makeTmpDir, buildFakeWorkspace, runScript } from "./helpers.mjs";
import {
  prepareMirroredSettingsMigration,
  isEmptyJsonObjectContent,
  nextAvailableBackupPath,
} from "../scripts/lib.mjs";

let tmp;
afterEach(() => tmp?.cleanup());

describe("prepareMirroredSettingsMigration", () => {
  it("seeds empty canonical from non-empty local settings", () => {
    tmp = makeTmpDir();
    const canonical = join(tmp.dir, "settings.json");
    const local = join(tmp.dir, "local", "settings.json");
    mkdirSync(join(tmp.dir, "local"), { recursive: true });
    writeFileSync(canonical, "{}\n");
    writeFileSync(local, JSON.stringify({ plugins: { "cursor-team-kit": { enabled: true } } }, null, 2) + "\n");

    const result = prepareMirroredSettingsMigration(canonical, local, "settings.json");
    assert.equal(result.action, "seeded");
    assert.equal(existsSync(local), false);
    assert.match(readFileSync(canonical, "utf8"), /cursor-team-kit/);
  });

  it("backs up local settings when canonical already has team content", () => {
    tmp = makeTmpDir();
    const canonical = join(tmp.dir, "settings.json");
    const local = join(tmp.dir, "local", "settings.json");
    mkdirSync(join(tmp.dir, "local"), { recursive: true });
    writeFileSync(canonical, JSON.stringify({ plugins: { shared: { enabled: true } } }, null, 2) + "\n");
    writeFileSync(local, JSON.stringify({ plugins: { personal: { enabled: true } } }, null, 2) + "\n");

    const result = prepareMirroredSettingsMigration(canonical, local, "settings.json");
    assert.equal(result.action, "backed-up");
    assert.equal(existsSync(local), false);
    assert.ok(existsSync(`${local}.bak`));
    assert.match(readFileSync(`${local}.bak`, "utf8"), /personal/);
  });

  it("skips non-settings filenames", () => {
    tmp = makeTmpDir();
    const canonical = join(tmp.dir, "other.json");
    const local = join(tmp.dir, "local", "other.json");
    mkdirSync(join(tmp.dir, "local"), { recursive: true });
    writeFileSync(canonical, "{}\n");
    writeFileSync(local, '{"a":1}\n');

    const result = prepareMirroredSettingsMigration(canonical, local, "other.json");
    assert.equal(result.action, "skipped");
    assert.equal(existsSync(local), true);
  });

  it("removes identical local copy without backup", () => {
    tmp = makeTmpDir();
    const canonical = join(tmp.dir, "settings.json");
    const local = join(tmp.dir, "local", "settings.json");
    mkdirSync(join(tmp.dir, "local"), { recursive: true });
    const content = JSON.stringify({ plugins: { shared: { enabled: true } } }, null, 2) + "\n";
    writeFileSync(canonical, content);
    writeFileSync(local, content);

    const result = prepareMirroredSettingsMigration(canonical, local, "settings.json");
    assert.equal(result.action, "removed-identical");
    assert.equal(existsSync(local), false);
    assert.equal(existsSync(`${local}.bak`), false);
  });
});

describe("setup-skills cursor settings migration", () => {
  it("seeds canonical and symlinks parent .cursor/settings.json", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    const canonical = join(ws, "root-config", ".cursor", "settings.json");
    const parentSettings = join(tmp.dir, ".cursor", "settings.json");
    mkdirSync(join(ws, "root-config", ".cursor"), { recursive: true });
    mkdirSync(join(tmp.dir, ".cursor"), { recursive: true });
    writeFileSync(canonical, "{}\n");
    writeFileSync(
      parentSettings,
      JSON.stringify({ plugins: { "cursor-team-kit": { enabled: true } } }, null, 2) + "\n",
    );

    const r = runScript(join(ws, "scripts", "skills", "setup-skills.mjs"), [], { cwd: ws });
    assert.equal(r.exitCode, 0, r.stderr + r.stdout);

    assert.ok(lstatSync(parentSettings).isSymbolicLink());
    assert.match(readFileSync(canonical, "utf8"), /cursor-team-kit/);
    assert.match(readFileSync(parentSettings, "utf8"), /cursor-team-kit/);
  });
});

describe("setup-skills claude settings migration", () => {
  it("backs up conflicting local .claude/settings.json and symlinks canonical", () => {
    tmp = makeTmpDir();
    const { ws } = buildFakeWorkspace(tmp.dir, { withSkill: "demo" });
    const canonical = join(ws, "root-config", ".claude", "settings.json");
    const parentSettings = join(tmp.dir, ".claude", "settings.json");
    mkdirSync(join(ws, "root-config", ".claude"), { recursive: true });
    mkdirSync(join(tmp.dir, ".claude"), { recursive: true });
    writeFileSync(
      canonical,
      JSON.stringify({ permissions: { allow: ["mcp__context7__*"] } }, null, 2) + "\n",
    );
    writeFileSync(
      parentSettings,
      JSON.stringify({ permissions: { allow: ["mcp__github__*"] } }, null, 2) + "\n",
    );

    const r = runScript(join(ws, "scripts", "skills", "setup-skills.mjs"), [], { cwd: ws });
    assert.equal(r.exitCode, 0, r.stderr + r.stdout);

    assert.ok(lstatSync(parentSettings).isSymbolicLink());
    assert.match(readFileSync(canonical, "utf8"), /context7/);
    assert.match(readFileSync(`${parentSettings}.bak`, "utf8"), /github/);
    assert.doesNotMatch(readFileSync(parentSettings, "utf8"), /github/);
  });
});

describe("isEmptyJsonObjectContent", () => {
  it("accepts empty object", () => {
    assert.equal(isEmptyJsonObjectContent("{}"), true);
    assert.equal(isEmptyJsonObjectContent('{ "plugins": {} }'), false);
  });
});

describe("nextAvailableBackupPath", () => {
  it("increments when .bak exists", () => {
    tmp = makeTmpDir();
    const base = join(tmp.dir, "settings.json");
    writeFileSync(`${base}.bak`, "x");
    assert.equal(nextAvailableBackupPath(base), `${base}.bak.1`);
  });
});
