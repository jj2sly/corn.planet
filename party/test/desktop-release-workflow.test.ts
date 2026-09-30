// The desktop release workflow is what installed CPI Party builds update from. It must only publish
// after every check passes, include the files electron-updater reads, and never clobber a release.
//
// The workflow file has to be added to GitHub by someone with permission to change workflows (this
// repo's usual push token can't). Until it exists these tests are reported as skipped, not passed.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const WORKFLOW_URL = new URL("../../.github/workflows/cpi-desktop-release.yml", import.meta.url);
const missing = !existsSync(WORKFLOW_URL);
const workflow = missing ? "" : await readFile(WORKFLOW_URL, "utf8");
const job = (name: string) => {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `missing job ${name}`);
  const next = workflow.slice(start + 1).search(/\n {2}[a-z]+:\n/);
  return next < 0 ? workflow.slice(start) : workflow.slice(start, start + 1 + next);
};

describe("desktop release workflow", { skip: missing && "cpi-desktop-release.yml has not been added yet" }, () => {
  it("releases when the desktop version changes on cpst-party, or on demand", () => {
    assert.match(workflow, /branches: \[cpst-party\]/);
    assert.match(workflow, /- "party\/desktop\/package\.json"/);
    assert.match(workflow, /workflow_dispatch:/);
    assert.match(workflow, /node-version: "24"/);
    assert.doesNotMatch(workflow, /\bmain\b/);
  });

  it("gates publishing on the Party checks, desktop checks and both platform builds", () => {
    const checks = job("checks");
    assert.match(checks, /npm run check/);
    assert.match(checks, /npm --prefix desktop run check/);
    const build = job("build");
    assert.match(build, /needs: \[version, checks\]/);
    assert.match(build, /windows-latest/);
    assert.match(build, /macos-latest/);
    // dist runs predist, which launch-tests the real app.
    assert.match(build, /npm run dist/);
    const release = job("release");
    assert.match(release, /needs: \[version, build\]/);
  });

  it("only the release job can write, and only with the workflow's own token", () => {
    assert.match(workflow, /^permissions:\n {2}contents: read/m);
    assert.match(job("release"), /permissions:\n {6}contents: write/);
    assert.doesNotMatch(workflow, /secrets\.(?!GITHUB_TOKEN)/);
  });

  it("uploads and verifies everything electron-updater needs", () => {
    const build = job("build");
    for (const pattern of ["*.exe", "*.dmg", "*.zip", "*.blockmap", "*.yml", "BUILD-INFO.txt"]) {
      assert.ok(build.includes(`party/dist-desktop/${pattern}`), `build must upload ${pattern}`);
    }
    const release = job("release");
    assert.match(release, /for meta in latest\.yml latest-mac\.yml/);
    assert.match(release, /grep -q "\^version: \$VERSION\$" "\$meta"/);
    assert.match(release, /points at missing/);
    assert.match(release, /CPI-Party-Setup-\$VERSION\.exe\.blockmap/);
    // Both Mac architectures must be published, each with a DMG and an update ZIP.
    assert.match(release, /for arch in x64 arm64; do/);
    assert.match(release, /CPI-Party-\$VERSION-\$arch\.dmg/);
    assert.match(release, /url: CPI-Party-\$VERSION-\$arch-mac\.zip/);
  });

  it("never overwrites a published version and hides half-uploaded ones", () => {
    const version = job("version");
    assert.match(version, /already published/);
    assert.match(version, /publish=false/);
    assert.match(version, /gh release delete "\$TAG"/, "a leftover draft is replaced, never a published release");
    const release = job("release");
    assert.match(release, /--draft\n/);
    assert.match(release, /--draft=false --latest/);
    assert.match(workflow, /cancel-in-progress: false/);
  });

  it("tags releases the way the desktop updater and its version compare expect", async () => {
    assert.match(workflow, /echo "tag=v\$version"/);
    const desktop = JSON.parse(await readFile(new URL("../desktop/package.json", import.meta.url), "utf8"));
    assert.match(desktop.version, /^\d+\.\d+\.\d+$/);
  });
});
