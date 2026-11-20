/**
 * USB VPN Bridge — Tetrd-Style Reliability Verification Suite
 *
 * Validates the core architectural reliability improvements:
 * 1. Orchestrator Transition Safety & Recovery Mutex
 * 2. Transient USB Drop Auto-Recovery (attemptConnectionRecovery)
 * 3. High-Throughput SOCKS5 Streaming (64KB buffers, no premature shutdownOutput)
 * 4. Screen-Off Background Tethering (persistent WakeLock in foreground service)
 * 5. Process Supervision & Stale Session Lock Recovery
 * 6. Minimized Window Throttling Immunity (backgroundThrottling: false & powerSaveBlocker)
 */

import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";

console.log("=================================================================");
console.log("USB VPN BRIDGE — TETRD-STYLE RELIABILITY SUITE");
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

// -------------------------------------------------------------
// TEST 1: Orchestrator Transition Safety & Auto-Recovery
// -------------------------------------------------------------
console.log("\n[TEST 1] Auditing ConnectionOrchestrator transition safety & recovery...");

const orchPath = path.resolve("windows-client/electron/orchestrator.ts");
assert(fs.existsSync(orchPath), "orchestrator.ts exists");
const orchTs = fs.readFileSync(orchPath, "utf-8");

test("connect() releases isTransitioning in a finally block", () => {
  const connectFnMatch = orchTs.match(/public async connect[\s\S]*?finally\s*\{[\s\S]*?this\.isTransitioning\s*=\s*false/);
  assert(connectFnMatch, "connect() must reset isTransitioning in finally block");
});

test("disconnect() releases isTransitioning in a finally block", () => {
  const disconnectFnMatch = orchTs.match(/public async disconnect[\s\S]*?finally\s*\{[\s\S]*?this\.isTransitioning\s*=\s*false/);
  assert(disconnectFnMatch, "disconnect() must reset isTransitioning in finally block");
});

test("attemptConnectionRecovery() implements multi-retry USB auto-recovery", () => {
  assert(orchTs.includes("attemptConnectionRecovery"), "orchestrator must implement attemptConnectionRecovery");
  assert(orchTs.includes("maxRetries = 3"), "must attempt at least 3 reconnection retries");
  assert(orchTs.includes("this.isRecovering"), "must use recovery mutex to prevent concurrent recoveries");
});

test("Speed calculation tolerates background jitter up to 15s", () => {
  assert(orchTs.includes("now - session.lastHeartbeatTime > 15000"), "Speed calc must allow at least 15s between heartbeats");
});

test("executeTunDiagnostic implements route propagation retry", () => {
  const tunDiagMatch = orchTs.match(/private async executeTunDiagnostic[\s\S]*?runCurl[\s\S]*?firstAttempt\.success[\s\S]*?setTimeout/);
  assert(tunDiagMatch, "executeTunDiagnostic must retry after delay to allow route propagation");
});

// -------------------------------------------------------------
// TEST 2: SOCKS5 High-Volume TCP Streaming Stability
// -------------------------------------------------------------
console.log("\n[TEST 2] Auditing Android SOCKS5 proxy server for heavy downloads...");

const socksPath = path.resolve("android-app/app/src/main/java/com/usbvpnbridge/android/proxy/Socks5ProxyServer.kt");
assert(fs.existsSync(socksPath), "Socks5ProxyServer.kt exists");
const socksKt = fs.readFileSync(socksPath, "utf-8");

test("SOCKS5 buffer size is optimized to 64 KB", () => {
  assert(socksKt.includes("BUFFER_SIZE = 65536"), "BUFFER_SIZE must be 65536 bytes (64 KB)");
});

test("Socket receive/send buffer sizes are configured for high throughput", () => {
  assert(socksKt.includes("receiveBufferSize = 262144"), "receiveBufferSize must be 256 KB");
  assert(socksKt.includes("sendBufferSize = 131072"), "sendBufferSize must be 128 KB");
});

test("No premature shutdownOutput() during active bidirectional streaming", () => {
  // Check that target.shutdownOutput() was eliminated from uploadJob / downloadJob pipe loops
  const pipeLoop = socksKt.substring(socksKt.indexOf("coroutineScope {"), socksKt.indexOf("uploadJob.join()"));
  assert(!pipeLoop.includes("target.shutdownOutput()"), "Must not call target.shutdownOutput() immediately when upload ends");
  assert(!pipeLoop.includes("client.shutdownOutput()"), "Must not call client.shutdownOutput() immediately when download ends");
});

// -------------------------------------------------------------
// TEST 3: Screen-Off Background Tethering & WakeLock
// -------------------------------------------------------------
console.log("\n[TEST 3] Auditing Android screen-off tethering & persistent WakeLock...");

const servicePath = path.resolve("android-app/app/src/main/java/com/usbvpnbridge/android/service/RelayForegroundService.kt");
assert(fs.existsSync(servicePath), "RelayForegroundService.kt exists");
const serviceKt = fs.readFileSync(servicePath, "utf-8");

test("WakeLock is acquired immediately when foreground service starts", () => {
  const onStartMatch = serviceKt.substring(serviceKt.indexOf("onStartCommand"), serviceKt.indexOf("startControlListener"));
  assert(onStartMatch.includes("acquireWakeLock()"), "acquireWakeLock() must be called in onStartCommand");
});

test("WakeLock is preserved across transient client disconnects", () => {
  // WakeLock should only be released in onDestroy, not on every client socket close
  const handleClientFinally = serviceKt.substring(serviceKt.indexOf("handleClientSession"), serviceKt.indexOf("processIncomingFrame"));
  assert(!handleClientFinally.includes("releaseWakeLock()"), "Must not release WakeLock inside handleClientSession finally block");
});

test("Android heartbeat watchdog allows up to 25s for backgrounding & heavy traffic", () => {
  assert(serviceKt.includes("elapsedSinceHb > 25000"), "Watchdog must allow > 25000ms");
});

// -------------------------------------------------------------
// TEST 4: Windows Client Background & Minimized Operation
// -------------------------------------------------------------
console.log("\n[TEST 4] Auditing Windows client backgrounding & power management...");

const mainPath = path.resolve("windows-client/electron/main.ts");
assert(fs.existsSync(mainPath), "main.ts exists");
const mainTs = fs.readFileSync(mainPath, "utf-8");

test("BrowserWindow has backgroundThrottling disabled", () => {
  assert(mainTs.includes("backgroundThrottling: false"), "backgroundThrottling must be false");
});

test("powerSaveBlocker prevents OS suspension during active tethering", () => {
  assert(mainTs.includes('powerSaveBlocker.start("prevent-app-suspension")'), "powerSaveBlocker must be started");
  assert(mainTs.includes("syncPowerSaveBlocker"), "syncPowerSaveBlocker must be implemented");
});

test("Main process polls ADB devices independently of renderer", () => {
  assert(mainTs.includes('mainWindow.webContents.send("adb:devices-changed"'), "Main process must push devices to renderer");
});

// -------------------------------------------------------------
// TEST 5: Control Client Watchdog & Handshake Timing Baseline
// -------------------------------------------------------------
console.log("\n[TEST 5] Auditing Windows controlClient.ts watchdog tolerances...");

const ccPath = path.resolve("windows-client/electron/controlClient.ts");
assert(fs.existsSync(ccPath), "controlClient.ts exists");
const ccTs = fs.readFileSync(ccPath, "utf-8");

test("Control client requires >= 15 missed heartbeats (>= 22.5s) before timeout", () => {
  assert(ccTs.includes("this.missedHeartbeats >= 15"), "Missed heartbeats threshold must be >= 15");
});

test("Control client watchdog checks elapsed time > 25000ms", () => {
  assert(ccTs.includes("elapsedSinceLastHb > 25000"), "Elapsed time check must be > 25000ms");
});

test("HELLO_ACK initializes lastHeartbeatTime for immediate baseline", () => {
  assert(ccTs.includes("lastHeartbeatTime: now"), "HELLO_ACK must initialize lastHeartbeatTime to current timestamp");
});

console.log("\n=================================================================");
console.log(`TETRD-STYLE RELIABILITY SUITE RESULTS: ${passed} Passed, ${failed} Failed`);
console.log("=================================================================");

if (failed > 0) {
  process.exit(1);
}
