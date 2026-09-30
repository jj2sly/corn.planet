// Release gate (runs as `predist`): launch the real app with CPI_DESKTOP_SMOKE=1 and fail the build
// unless the shell loads, the sandboxed preload exposes window.cpiDesktop and an IPC round trip works.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import electronPath from "electron";

const PASS_MARKER = "CPI desktop smoke test passed";
const appDir = fileURLToPath(new URL(".", import.meta.url));
const child = spawn(electronPath, [appDir], {
  env: { ...process.env, CPI_DESKTOP_SMOKE: "1" },
  stdio: ["ignore", "pipe", "inherit"],
});

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk;
  process.stdout.write(chunk);
});

const timer = setTimeout(() => {
  console.error("CPI desktop smoke test failed: Electron did not exit within 90s");
  child.kill();
  process.exit(1);
}, 90_000);

child.on("exit", (code, signal) => {
  clearTimeout(timer);
  // Require the explicit marker: an early quit (e.g. single-instance lock) also exits 0.
  if (code === 0 && output.includes(PASS_MARKER)) process.exit(0);
  console.error(`CPI desktop smoke test failed: exit ${code ?? signal}${output.includes(PASS_MARKER) ? "" : ", no pass marker"}`);
  process.exit(1);
});
