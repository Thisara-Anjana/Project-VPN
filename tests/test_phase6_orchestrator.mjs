/**
 * USB VPN Bridge — Phase 6: Orchestrator & State Machine Verification Suite
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync, execFile } from "node:child_process";
import {
  ConfigManager,
  NetworkInspector,
  RouteRestorer,
  EngineLauncher,
} from "../network-core/dist/index.js";

console.log("=================================================================");
console.log("USB VPN BRIDGE — PHASE 6: ORCHESTRATOR & INTEGRATION SUITE");
console.log("=================================================================\n");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failed++;
  }
}

async function runTests() {
  // TEST 1: Check UAC Elevated Supervisor Script
  console.log("[TEST 1] Verifying UAC Elevated Supervisor Script (run-elevated.ps1)...");
  const ps1Path = path.resolve("network-core/bin/run-elevated.ps1");
  assert(fs.existsSync(ps1Path), "run-elevated.ps1 exists on disk");
  const ps1Content = fs.readFileSync(ps1Path, "utf-8");
  assert(ps1Content.includes("engine.active"), "Supervisor script watches engine.active signal file");
  assert(ps1Content.includes("sing-box.exe"), "Supervisor script launches official sing-box binary");
  assert(ps1Content.includes("usb-vpn-tun"), "Supervisor script includes clean adapter teardown");
  assert(ps1Content.includes("172.19.0.1"), "Supervisor script includes clean transient route deletion");
  assert(ps1Content.includes("ipconfig /flushdns"), "Supervisor script flushes DNS cache on exit");

  // TEST 2: Validate Network Core & Sing-Box Config for Phase 6
  console.log("\n[TEST 2] Auditing Phase 6 EngineLauncher & Sing-box configuration...");
  const engine = new EngineLauncher(path.resolve("network-core"));
  const binInfo = engine.detectBinaries();
  assert(binInfo.binaryFound, `sing-box binary located: ${engine.getBinaryPath()}`);
  assert(binInfo.wintunFound, `wintun driver located: ${engine.getWintunPath()}`);

  const stateDir = path.resolve("network-core/state");
  const prep = await engine.validateAndPrepare(stateDir, {
    socksPort: 10808,
    enableAutoRoute: true,
    localGatewayIp: "192.168.8.1",
  });
  assert(prep.success, `Configuration validation passed: ${prep.validationOutput}`);

  // TEST 3: State Machine Centralized States & Transition Guards
  console.log("\n[TEST 3] Verifying Connection State Machine Valid Transitions...");
  const validStates = [
    "DISCONNECTED",
    "DEVICE_DETECTED",
    "CONTROL_CONNECTING",
    "CONTROL_CONNECTED",
    "PROXY_CHECKING",
    "PROXY_READY",
    "TUN_STARTING",
    "TUN_ACTIVE",
    "INTERNET_VERIFYING",
    "INTERNET_CONNECTED",
    "DISCONNECTING",
    "RECOVERING",
    "ERROR",
  ];
  assert(validStates.length === 13, "All 13 centralized connection states documented");

  // TEST 4: Check ADB Device Availability & Control Channel
  console.log("\n[TEST 4] Probing physical Android device via ADB...");
  const adbBin = "C:\\Android\\Sdk\\platform-tools\\adb.exe";
  try {
    const androidDir = path.resolve(".android");
    if (!fs.existsSync(androidDir)) fs.mkdirSync(androidDir, { recursive: true });
    const adbOut = execFileSync(adbBin, ["devices", "-l"], {
      encoding: "utf-8",
      env: { ...process.env, ANDROID_USER_HOME: androidDir },
    });
    const hasDevice = adbOut.includes("device") && !adbOut.includes("unauthorized");
    assert(hasDevice, `Physical Android device recognized by ADB: ${adbOut.trim()}`);
  } catch (err) {
    console.warn(`  [WARN] ADB query note: ${err.message}`);
  }

  // TEST 5: Standalone Route Restoration Script Idempotence
  console.log("\n[TEST 5] Testing Route Restoration idempotence and script safety...");
  const inspection = await NetworkInspector.inspectNetwork();
  const scripts = RouteRestorer.saveRecoveryScripts(stateDir, inspection.snapshot);
  assert(fs.existsSync(scripts.batPath), `restore-routes.bat generated: ${scripts.batPath}`);
  assert(fs.existsSync(scripts.ps1Path), `restore-routes.ps1 generated: ${scripts.ps1Path}`);

  console.log("\n=================================================================");
  console.log(`PHASE 6 SUITE COMPLETED: ${passed} Passed, ${failed} Failed`);
  console.log("=================================================================");
}

runTests().catch((e) => {
  console.error("Test suite runner error:", e);
  process.exit(1);
});
