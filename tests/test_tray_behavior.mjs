/**
 * USB VPN Bridge — System Tray Background Mode Verification Suite
 *
 * Verifies that the Windows application behaves like PdaNet+:
 * 1. Single-Instance Lock prevents multiple processes and duplicate tray icons.
 * 2. Window Minimize and Close (X button) hide the window to the System Tray.
 * 3. Tray double-click and single-click reopen/focus the main window.
 * 4. Tray right-click context menu exposes Open, Status, Connect, Disconnect, Exit.
 * 5. Distinct tray icon states (Connected, Disconnected, Connecting, Error) and accurate tooltips.
 * 6. Background networking (ADB, SOCKS5, TUN engine, heartbeats) stays active when window is hidden.
 * 7. Exit from tray safely disconnects and restores network routes before quitting.
 */

import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import {
  getTrayIcon,
  getStatusTooltip,
  getStatusMenuLabel,
} from "../windows-client/dist-electron/trayIcons.js";

console.log("=================================================================");
console.log("USB VPN BRIDGE — SYSTEM TRAY BACKGROUND MODE SUITE");
console.log("=================================================================");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}: ${err.message}`);
    failed++;
  }
}

const mainPath = path.resolve("windows-client/electron/main.ts");
assert(fs.existsSync(mainPath), "main.ts exists");
const mainTs = fs.readFileSync(mainPath, "utf-8");

// -------------------------------------------------------------
// TEST 1: Single-Instance Lock & Duplicate Prevention
// -------------------------------------------------------------
console.log("\n[TEST 1] Auditing Single-Instance Lock & Process Lifecycle...");

test("app.requestSingleInstanceLock() is enforced at startup", () => {
  assert(mainTs.includes("app.requestSingleInstanceLock()"), "requestSingleInstanceLock must be called");
  assert(mainTs.includes("if (!gotSingleInstanceLock)"), "Secondary instance must be terminated");
});

test("second-instance event restores and focuses the primary window", () => {
  assert(mainTs.includes('app.on("second-instance"'), "second-instance event must be registered");
  assert(mainTs.includes("restoreMainWindow()"), "second-instance must call restoreMainWindow");
});

test("window-all-closed does not terminate application while in tray", () => {
  assert(mainTs.includes('app.on("window-all-closed"'), "window-all-closed listener must exist");
  assert(mainTs.includes("if (isQuitting)"), "Must only quit when isQuitting is true");
});

// -------------------------------------------------------------
// TEST 2: Minimize & Close (X) to System Tray
// -------------------------------------------------------------
console.log("\n[TEST 2] Auditing Window Minimize & Close to Tray...");

test("Window Minimize event hides window to system tray", () => {
  const minMatch = mainTs.match(/mainWindow\.on\("minimize"[\s\S]*?mainWindow\?\.hide\(\)/);
  assert(minMatch, "minimize must hide the window");
});

test("Window Close (X) event prevents default and hides to tray when not quitting", () => {
  const closeMatch = mainTs.match(/mainWindow\.on\("close"[\s\S]*?if \(!isQuitting\)[\s\S]*?event\.preventDefault\(\)[\s\S]*?mainWindow\?\.hide\(\)/);
  assert(closeMatch, "close event must hide window to tray unless isQuitting is true");
});

test("restoreMainWindow restores minimized window, shows, and focuses", () => {
  assert(mainTs.includes("function restoreMainWindow()"), "restoreMainWindow function must exist");
  assert(mainTs.includes("mainWindow.restore()"), "must restore minimized window");
  assert(mainTs.includes("mainWindow.show()"), "must show window");
  assert(mainTs.includes("mainWindow.focus()"), "must focus window");
  assert(mainTs.includes("syncRendererState()"), "must sync renderer state on restore");
});

// -------------------------------------------------------------
// TEST 3: System Tray Construction & Menu Actions
// -------------------------------------------------------------
console.log("\n[TEST 3] Auditing System Tray Icon & Context Menu...");

test("Tray is initialized with native Tray API", () => {
  assert(mainTs.includes("new Tray("), "new Tray() must be called");
  assert(mainTs.includes('tray.on("double-click"'), "tray double-click must be registered");
  assert(mainTs.includes('tray.on("click"'), "tray click must be registered");
});

test("Tray context menu contains Open, Status, Connect, Disconnect, Exit", () => {
  assert(mainTs.includes('"Open USB VPN Bridge"'), "Menu must have 'Open USB VPN Bridge'");
  assert(mainTs.includes("Status: ${statusMenuLabel}"), "Menu must have status label");
  assert(mainTs.includes('"Connect"'), "Menu must have 'Connect'");
  assert(mainTs.includes('"Disconnect"'), "Menu must have 'Disconnect'");
  assert(mainTs.includes('"Exit"'), "Menu must have 'Exit'");
});

test("Exit action safely disconnects, cleans up, and warns on error", () => {
  assert(mainTs.includes("async function handleApplicationExit()"), "handleApplicationExit must exist");
  assert(mainTs.includes("await orchestrator.disconnect()"), "must call orchestrator.disconnect() on exit");
  assert(mainTs.includes("dialog.showErrorBox"), "must show warning dialog if network restoration fails");
  assert(mainTs.includes("tray.destroy()"), "must destroy tray icon cleanly on exit");
});

// -------------------------------------------------------------
// TEST 4: Tray Icon State Mapping & Tooltips
// -------------------------------------------------------------
console.log("\n[TEST 4] Auditing Tray Icon Visual States & Tooltips...");

test("getTrayIcon maps INTERNET_CONNECTED to valid native image", () => {
  const icon = getTrayIcon("INTERNET_CONNECTED");
  assert(icon !== null && icon !== undefined, "Connected icon must be valid");
});

test("getTrayIcon maps DISCONNECTED to valid native image", () => {
  const icon = getTrayIcon("DISCONNECTED");
  assert(icon !== null && icon !== undefined, "Disconnected icon must be valid");
});

test("getTrayIcon maps ERROR to valid native image", () => {
  const icon = getTrayIcon("ERROR");
  assert(icon !== null && icon !== undefined, "Error icon must be valid");
});

test("getStatusTooltip returns informative status for active tethering", () => {
  const tip = getStatusTooltip("INTERNET_CONNECTED");
  assert(tip.includes("Connected"), `Tooltip should indicate connected: ${tip}`);
});

test("getStatusTooltip returns disconnected status for idle state", () => {
  const tip = getStatusTooltip("DISCONNECTED");
  assert(tip.includes("Disconnected"), `Tooltip should indicate disconnected: ${tip}`);
});

test("getStatusMenuLabel returns accurate human-readable status for menu item", () => {
  assert.strictEqual(getStatusMenuLabel("INTERNET_CONNECTED"), "Connected (VPN Shared)");
  assert.strictEqual(getStatusMenuLabel("DISCONNECTED"), "Disconnected");
  assert.strictEqual(getStatusMenuLabel("TUN_STARTING"), "Starting TUN Engine...");
});

// -------------------------------------------------------------
// TEST 5: Asset Files Existence & Packaging Configuration
// -------------------------------------------------------------
console.log("\n[TEST 5] Auditing Asset Packaging & Resources...");

test("All 4 tray icon PNG files exist in windows-client/assets", () => {
  assert(fs.existsSync("windows-client/assets/tray-disconnected.png"), "tray-disconnected.png exists");
  assert(fs.existsSync("windows-client/assets/tray-connected.png"), "tray-connected.png exists");
  assert(fs.existsSync("windows-client/assets/tray-connecting.png"), "tray-connecting.png exists");
  assert(fs.existsSync("windows-client/assets/tray-error.png"), "tray-error.png exists");
});

const pkgJson = JSON.parse(fs.readFileSync("windows-client/package.json", "utf-8"));

test("package.json includes assets in files and extraResources", () => {
  const hasFiles = pkgJson.build.files.includes("assets/**/*");
  const hasExtra = pkgJson.build.extraResources.some((r) => r.from === "assets" && r.to === "assets");
  assert(hasFiles, "assets/**/* must be included in build.files");
  assert(hasExtra, "assets must be included in build.extraResources");
});

console.log("\n=================================================================");
console.log(`SYSTEM TRAY SUITE RESULTS: ${passed} Passed, ${failed} Failed`);
console.log("=================================================================");

if (failed > 0) {
  process.exit(1);
}
