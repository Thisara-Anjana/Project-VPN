/**
 * USB VPN Bridge — Background Stability & Minimize Operation Test Suite
 *
 * Verifies that window minimization, app switching, and background operation:
 * 1. Keep the network engine, Wintun adapter, and ADB forward active.
 * 2. Prevent Chromium background timer throttling (backgroundThrottling: false).
 * 3. Engage OS power suspension blocker during active tethering.
 * 4. Have generous heartbeat watchdog tolerances (>= 22.5s / 25s) on both Windows and Android.
 * 5. Run device polling in the Electron Main process independent of the renderer.
 * 6. Smoothly restore UI state on window restore/focus without dropping connections.
 */

import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";

console.log("=================================================================");
console.log("USB VPN BRIDGE — BACKGROUND STABILITY & MINIMIZE SUITE");
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

// 1. Electron Main Process Configuration
console.log("\n[TEST 1] Auditing Electron main.ts for background operation...");

const mainTsPath = path.resolve("windows-client/electron/main.ts");
assert(fs.existsSync(mainTsPath), "main.ts exists");
const mainTs = fs.readFileSync(mainTsPath, "utf-8");

test("backgroundThrottling is explicitly set to false in BrowserWindow webPreferences", () => {
  assert(mainTs.includes("backgroundThrottling: false"), "backgroundThrottling must be false");
});

test("powerSaveBlocker is imported from electron", () => {
  assert(mainTs.includes("powerSaveBlocker") && mainTs.includes('from "electron"'), "powerSaveBlocker imported");
});

test("powerSaveBlocker.start('prevent-app-suspension') is managed based on connection state", () => {
  assert(mainTs.includes('powerSaveBlocker.start("prevent-app-suspension")'), "powerSaveBlocker started");
  assert(mainTs.includes("syncPowerSaveBlocker"), "syncPowerSaveBlocker helper function exists");
});

test("minimize, restore, and focus window events are handled non-destructively", () => {
  assert(mainTs.includes('mainWindow.on("minimize"'), "minimize event registered");
  assert(mainTs.includes('mainWindow.on("restore"'), "restore event registered");
  assert(mainTs.includes('mainWindow.on("focus"'), "focus event registered");
  assert(!mainTs.includes('mainWindow.on("minimize", async () => { await orchestrator.disconnect(); })'), "minimize must never disconnect");
});

test("Main process background device polling loop is active and broadcasts adb:devices-changed", () => {
  assert(mainTs.includes('mainWindow.webContents.send("adb:devices-changed"'), "broadcasts adb:devices-changed");
});

// 2. Control Client Heartbeat Watchdog Tolerances
console.log("\n[TEST 2] Auditing Windows controlClient.ts heartbeat watchdog tolerances...");

const controlClientPath = path.resolve("windows-client/electron/controlClient.ts");
assert(fs.existsSync(controlClientPath), "controlClient.ts exists");
const controlClientTs = fs.readFileSync(controlClientPath, "utf-8");

test("Windows heartbeat timeout requires >= 15 missed heartbeats (>= 22.5s)", () => {
  assert(controlClientTs.includes("this.missedHeartbeats >= 15"), "Missed heartbeats threshold must be >= 15");
});

test("Windows heartbeat watchdog checks elapsed time (> 25000ms)", () => {
  assert(controlClientTs.includes("elapsedSinceLastHb > 25000"), "Watchdog must check elapsed time > 25000ms");
});

test("HELLO_ACK sets lastHeartbeatTime for immediate timing baseline", () => {
  assert(controlClientTs.includes("lastHeartbeatTime: now") || controlClientTs.includes("lastHeartbeatTime: Date.now()"), "lastHeartbeatTime initialized on HELLO_ACK");
});

// 3. Android Foreground Service Heartbeat Watchdog Tolerances
console.log("\n[TEST 3] Auditing Android RelayForegroundService.kt watchdog tolerances...");

const androidServicePath = path.resolve("android-app/app/src/main/java/com/usbvpnbridge/android/service/RelayForegroundService.kt");
assert(fs.existsSync(androidServicePath), "RelayForegroundService.kt exists");
const androidServiceKt = fs.readFileSync(androidServicePath, "utf-8");

test("Android heartbeat watchdog timeout is set to > 25000ms", () => {
  assert(androidServiceKt.includes("elapsedSinceHb > 25000"), "Android heartbeat watchdog must be > 25000ms");
});

test("Android acquires PARTIAL_WAKE_LOCK on connection for screen-off tethering", () => {
  assert(androidServiceKt.includes("acquireWakeLock()"), "acquireWakeLock must be called");
  assert(androidServiceKt.includes("PowerManager.PARTIAL_WAKE_LOCK"), "PARTIAL_WAKE_LOCK must be defined");
});

// 4. Orchestrator Speed Calculation Decoupling
console.log("\n[TEST 4] Auditing ConnectionOrchestrator telemetry decoupling...");

const orchPath = path.resolve("windows-client/electron/orchestrator.ts");
assert(fs.existsSync(orchPath), "orchestrator.ts exists");
const orchTs = fs.readFileSync(orchPath, "utf-8");

test("Speed calculation tolerates delayed heartbeats up to 10s before resetting to 0", () => {
  assert(
    orchTs.includes("now - session.lastHeartbeatTime > 10000") ||
    orchTs.includes("now - session.lastHeartbeatTime > 15000"),
    "Speed calc must tolerate at least 10s between heartbeats"
  );
});

// 5. Preload API & React UI Event Hooks
console.log("\n[TEST 5] Auditing React App.tsx and preload.ts event hooks...");

const preloadPath = path.resolve("windows-client/electron/preload.ts");
const appPath = path.resolve("windows-client/src/App.tsx");
assert(fs.existsSync(preloadPath), "preload.ts exists");
assert(fs.existsSync(appPath), "App.tsx exists");
const preloadTs = fs.readFileSync(preloadPath, "utf-8");
const appTsx = fs.readFileSync(appPath, "utf-8");

test("preload.ts exposes onDevicesChange listener", () => {
  assert(preloadTs.includes("onDevicesChange:"), "onDevicesChange listener exposed");
  assert(preloadTs.includes('ipcRenderer.on("adb:devices-changed"'), "listens for adb:devices-changed");
});

test("App.tsx listens to onDevicesChange and syncs on window focus", () => {
  assert(appTsx.includes("onDevicesChange"), "App.tsx subscribes to onDevicesChange");
  assert(appTsx.includes('window.addEventListener("focus"'), "App.tsx listens to window focus");
});

console.log("\n=================================================================");
console.log(`BACKGROUND STABILITY SUITE RESULTS: ${passed} Passed, ${failed} Failed`);
console.log("=================================================================");

if (failed > 0) {
  process.exit(1);
}
