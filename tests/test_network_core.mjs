/**
 * Unit & Integration Test for Network Core Subsystem (Safety-Corrected Phase 5B)
 * USB VPN Bridge - Phase 5B
 */

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import {
  ConfigManager,
  NetworkInspector,
  RouteRestorer,
  EngineLauncher,
} from "../network-core/dist/index.js";

async function runTests() {
  console.log("=================================================================");
  console.log("USB VPN BRIDGE - PHASE 5B: SAFETY-CORRECTED VALIDATION SUITE");
  console.log("=================================================================\n");

  const stateDir = path.resolve(process.cwd(), "network-core/state");
  if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });

  // --------------------------------------------------------------------------
  // TEST 1: Config Generation & Strict Route-Loop Safety Audit
  // --------------------------------------------------------------------------
  console.log("[TEST 1] Auditing revised Sing-box configuration (MTU 1500, Strict Exclusions)...");
  const config = ConfigManager.generateConfig({
    tunInterfaceName: "usb-vpn-tun",
    socksPort: 10808,
    enableAutoRoute: false,
    blockIpv6: true,
    localGatewayIp: "192.168.8.1", // Dynamic gateway parameter
  });

  const audit = ConfigManager.validateConfig(config);
  console.log("  - Config Valid:", audit.valid);
  console.log("  - MTU Correct (1500 bytes):", audit.mtuCorrect);
  console.log("  - Route Loop Protected:", audit.routeLoopProtected);
  console.log("  - electron.exe Protected From Accidental Bypass:", audit.electronNotExcluded);
  console.log("  - UDP Safety Enforced (Block non-DNS):", audit.udpSafetyEnforced);
  console.log("  - IPv6 Leak Protected (Block):", audit.ipv6LeakProtected);
  console.log("  - Warnings:", audit.warnings);

  assert.strictEqual(audit.valid, true, "Generated config must be valid");
  assert.strictEqual(audit.mtuCorrect, true, "TUN MTU must be 1500");
  assert.strictEqual(audit.routeLoopProtected, true, "Route-loop protection must be verified");
  assert.strictEqual(audit.electronNotExcluded, true, "electron.exe must NOT be bypassed");
  assert.strictEqual(audit.udpSafetyEnforced, true, "UDP safety must be enforced");
  assert.strictEqual(audit.ipv6LeakProtected, true, "IPv6 leak protection must be active");
  console.log("  => TEST 1 PASSED: Strict configuration safety verified.\n");

  // --------------------------------------------------------------------------
  // TEST 2: Official Binary Verification & Live `sing-box check` Execution
  // --------------------------------------------------------------------------
  console.log("[TEST 2] Verifying official sing-box binary and executing live check with MTU 1500...");
  const launcher = new EngineLauncher(path.resolve(process.cwd(), "network-core"));
  const binInfo = launcher.detectBinaries();

  console.log("  - sing-box binary found:", binInfo.binaryFound, `(${launcher.getBinaryPath()})`);
  console.log("  - wintun driver found:", binInfo.wintunFound, `(${launcher.getWintunPath()})`);
  console.log("  - detected engine version:", launcher.getEngineVersion());

  assert.strictEqual(binInfo.binaryFound, true, "sing-box binary must be present");
  assert.strictEqual(binInfo.wintunFound, true, "wintun driver must be present");

  const prep = await launcher.validateAndPrepare(stateDir, {
    socksPort: 10808,
    enableAutoRoute: false,
    localGatewayIp: "192.168.8.1",
  });
  console.log("  - sing-box check output:", prep.validationOutput);
  assert.strictEqual(prep.success, true, "sing-box check dry run must succeed");
  console.log("  => TEST 2 PASSED: Official binary check succeeded with 0 errors.\n");

  // --------------------------------------------------------------------------
  // TEST 3: Read-Only System Network Inspection & Dynamic Baseline Capture
  // --------------------------------------------------------------------------
  console.log("[TEST 3] Capturing dynamic Windows network state snapshot...");
  const inspection = await NetworkInspector.inspectNetwork();

  console.log(`  - Total Adapters Detected: ${inspection.adapters.length}`);
  console.log(`  - Primary Adapter: ${inspection.primaryAdapter ? inspection.primaryAdapter.name : "None"}`);
  console.log(`  - Dynamic Gateway: ${inspection.snapshot.defaultIpv4Gateway} (Metric: ${inspection.snapshot.defaultIpv4Metric})`);
  console.log(`  - Active Third-Party VPNs: ${inspection.activeVpnAdapters.join(", ") || "None"}`);

  assert.ok(inspection.adapters.length > 0, "Must detect adapters");
  assert.ok(inspection.snapshot.defaultIpv4Gateway, "Must dynamically identify default gateway");
  const snapshotPath = path.join(stateDir, "network-state-snapshot.json");
  NetworkInspector.saveSnapshot(snapshotPath, inspection.snapshot);
  assert.strictEqual(fs.existsSync(snapshotPath), true, "Snapshot must exist");
  console.log("  => TEST 3 PASSED: Dynamic network state snapshot saved.\n");

  // --------------------------------------------------------------------------
  // TEST 4: Standalone Self-Elevating Recovery Script Generation
  // --------------------------------------------------------------------------
  console.log("[TEST 4] Generating and verifying self-elevating emergency recovery scripts...");
  const recoveryFiles = RouteRestorer.saveRecoveryScripts(stateDir, inspection.snapshot);
  assert.strictEqual(fs.existsSync(recoveryFiles.batPath), true, "restore-routes.bat must exist");
  assert.strictEqual(fs.existsSync(recoveryFiles.ps1Path), true, "restore-routes.ps1 must exist");

  const bat = fs.readFileSync(recoveryFiles.batPath, "utf-8");
  assert.ok(bat.includes("net session"), "BAT must contain UAC elevation check");
  assert.ok(bat.includes("Start-Process"), "BAT must trigger UAC elevation prompt");
  assert.ok(bat.includes(inspection.snapshot.defaultIpv4Gateway), "BAT must contain dynamic gateway restoration");
  assert.ok(bat.includes("ipconfig /flushdns"), "BAT must flush DNS cache");

  const ps1 = fs.readFileSync(recoveryFiles.ps1Path, "utf-8");
  assert.ok(ps1.includes("WindowsBuiltInRole"), "PS1 must contain Administrator role check");
  console.log("  => TEST 4 PASSED: UAC-elevating emergency recovery scripts verified.\n");

  // --------------------------------------------------------------------------
  // TEST 5: Recovery Logic & Rollback Verification
  // --------------------------------------------------------------------------
  console.log("[TEST 5] Testing recovery verification logic (simulated pending restoration)...");
  const dummySnapshotPath = path.join(stateDir, "test-pending-snapshot.json");
  const testSnapshot = { ...inspection.snapshot, restorationStatus: "PENDING" };
  fs.writeFileSync(dummySnapshotPath, JSON.stringify(testSnapshot, null, 2));

  const checkPending = RouteRestorer.checkPendingRestoration(dummySnapshotPath);
  assert.strictEqual(checkPending.needsRecovery, true, "Must detect pending restoration");

  RouteRestorer.markResolved(dummySnapshotPath);
  const checkResolved = RouteRestorer.checkPendingRestoration(dummySnapshotPath);
  assert.strictEqual(checkResolved.needsRecovery, false, "Must detect resolved restoration");
  fs.unlinkSync(dummySnapshotPath);
  console.log("  => TEST 5 PASSED: Recovery detection and resolution logic verified.\n");

  console.log("=================================================================");
  console.log("ALL PHASE 5B PRE-ACTIVATION SAFETY TESTS PASSED SUCCESSFULLY!");
  console.log("=================================================================");
}

runTests().catch((err) => {
  console.error("Test failure:", err);
  process.exit(1);
});
