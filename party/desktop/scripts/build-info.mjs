// Stamps a build with the commit it came from.
//   node scripts/build-info.mjs            -> build-info.json (bundled; shown in the app footer)
//   node scripts/build-info.mjs --artifact -> ../dist-desktop/BUILD-INFO.txt (beside the installers)
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(path.join(desktopDir, "package.json"), "utf8"));

function commit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: desktopDir, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const info = { version: pkg.version, commit: commit(), builtAt: new Date().toISOString() };

if (process.argv.includes("--artifact")) {
  const outDir = path.resolve(desktopDir, pkg.build.directories.output);
  const lines = [`CPI Party ${info.version}`, `Commit ${info.commit}`, `Built ${info.builtAt}`, "", "Files (sha256):"];
  for (const name of fs.readdirSync(outDir).sort()) {
    const file = path.join(outDir, name);
    if (!fs.statSync(file).isFile() || name === "BUILD-INFO.txt" || name === "builder-debug.yml") continue;
    const hash = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    lines.push(`${hash}  ${name}`);
  }
  fs.writeFileSync(path.join(outDir, "BUILD-INFO.txt"), `${lines.join("\n")}\n`);
  console.log(`BUILD-INFO.txt written for ${info.version} (${info.commit.slice(0, 7)})`);
} else {
  fs.writeFileSync(path.join(desktopDir, "build-info.json"), `${JSON.stringify(info, null, 2)}\n`);
  console.log(`build-info.json: ${info.version} (${info.commit.slice(0, 7)})`);
}
