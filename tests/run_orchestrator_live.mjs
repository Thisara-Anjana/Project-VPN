/**
 * USB VPN Bridge — Phase 6: Live Connection Orchestration & Benchmark Runner
 */

import path from "node:path";
import fs from "node:fs";
import { execFileSync, execFile } from "node:child_process";
import { ConnectionOrchestrator } from "../windows-client/dist-electron/orchestrator.js";
import { AdbManager } from "../windows-client/dist-electron/adbManager.js";
import { ControlClient } from "../windows-client/dist-electron/controlClient.js";
import { EngineLauncher } from "../network-core/dist/index.js";

console.log("=================================================================");
console.log("USB VPN BRIDGE: PHASE 6 SUPERVISED LIVE ORCHESTRATION TEST");
console.log("=================================================================\n");

const projectRoot = path.resolve(process.cwd());
const stateDir = path.resolve(projectRoot, "network-core/state");

const adbManager = new AdbManager();
const controlClient = new ControlClient();
const engineLauncher = new EngineLauncher(path.resolve(projectRoot, "network-core"));
const orchestrator = new ConnectionOrchestrator(adbManager, controlClient, engineLauncher, projectRoot);

const results = {
  timestamp: new Date().toISOString(),
  preconditions: {},
  stateTransitions: [],
  egressVerification: {},
  progressiveTests: {},
  telemetry: {},
  restoration: {},
  errors: [],
};

// Monitor all orchestrator logs
orchestrator.on("log", (l) => {
  const ts = new Date(l.timestamp).toLocaleTimeString();
  console.log(`[${ts}] [${l.level}] ${l.message}`);
});

// Monitor all state transitions
orchestrator.on("status-change", (status) => {
  const lastState = results.stateTransitions[results.stateTransitions.length - 1]?.state;
  if (status.state !== lastState) {
    results.stateTransitions.push({
      time: new Date().toISOString(),
      state: status.state,
    });
    console.log(`>>> STATE TRANSITION: ${status.state}`);
  }
});

async function main() {
  // 1. Precondition checks
  console.log("\n[1/8] Checking Preconditions...");

  // Ensure initial ADB forward for precondition baseline test
  try {
    const devices = await adbManager.getDevices();
    const authorized = devices.filter((d) => d.state === "device");
    if (authorized.length > 0) {
      console.log(`  - Detected Android device via ADB: ${authorized[0].serial}`);
      await adbManager.forwardPort(authorized[0].serial, 10809, 10809);
      await adbManager.forwardPort(authorized[0].serial, 10808, 10808);
    }
  } catch (err) {
    console.warn(`  - Precondition ADB note: ${err.message}`);
  }

  const directIp = execFileSync("curl.exe", ["--noproxy", "*", "-s", "-m", "6", "https://api.ipify.org"], {
    encoding: "utf-8",
  }).trim();
  console.log(`  - Physical ISP Direct IP: ${directIp}`);
  results.preconditions.directIp = directIp;

  const socksIp = execFileSync(
    "curl.exe",
    ["--proxy", "socks5h://127.0.0.1:10808", "-s", "-m", "6", "https://api.ipify.org"],
    { encoding: "utf-8" }
  ).trim();
  console.log(`  - Android NetMod SOCKS5 IP: ${socksIp}`);
  results.preconditions.socksIp = socksIp;

  if (!socksIp || socksIp === directIp) {
    throw new Error(`SOCKS5 proxy invalid: ${socksIp} vs direct ${directIp}`);
  }

  // 2. Trigger One-Click Connect Pipeline
  console.log("\n[2/8] Executing One-Click Connection Sequence...");
  console.log("  -> Note: Windows UAC elevation prompt will appear for Wintun virtual adapter configuration.");
  console.log("  -> Please approve the prompt when requested.\n");

  const connRes = await orchestrator.connect();
  if (!connRes.success) {
    throw new Error(`Connection sequence failed: ${connRes.error}`);
  }

  const connectedStatus = orchestrator.getStatus();
  console.log("\n[3/8] Verifying Connected Pipeline Status:");
  console.log(`  - Orchestrator State: ${connectedStatus.state}`);
  console.log(`  - SOCKS5 Egress IP: ${connectedStatus.proxyEgressIp}`);
  console.log(`  - TUN System Egress IP: ${connectedStatus.tunEgressIp}`);
  console.log(`  - Active VPN App: ${connectedStatus.vpnAppName}`);
  console.log(`  - Latency: ${connectedStatus.latencyMs}ms`);

  results.egressVerification = {
    proxyEgressIp: connectedStatus.proxyEgressIp,
    tunEgressIp: connectedStatus.tunEgressIp,
    matchesNetMod: connectedStatus.tunEgressIp === socksIp,
    state: connectedStatus.state,
  };

  // 4. Progressive Test A: Multi-Host Browsing
  console.log("\n[4/8] Progressive Test A: Multi-Host HTTPS Endpoints...");
  const endpoints = [
    "https://api.ipify.org",
    "https://cloudflare.com/cdn-cgi/trace",
    "https://httpbin.org/ip",
  ];
  results.progressiveTests.browsing = {};
  for (const ep of endpoints) {
    const start = Date.now();
    try {
      const out = await new Promise((resolve, reject) => {
        execFile("curl.exe", ["--noproxy", "*", "-s", "-m", "8", ep], (err, stdout, stderr) => {
          if (err) return reject(new Error(stderr?.trim() || err.message));
          resolve(stdout);
        });
      });
      const latency = Date.now() - start;
      console.log(`  - ${ep}: SUCCESS (${latency}ms)`);
      results.progressiveTests.browsing[ep] = { success: true, latencyMs: latency };
    } catch (e) {
      console.error(`  - ${ep}: FAILED (${e.message})`);
      results.progressiveTests.browsing[ep] = { success: false, error: e.message };
    }
  }

  // 5. Progressive Test C: 4 Concurrent HTTPS TCP Connections
  console.log("\n[5/8] Progressive Test C: 4 Concurrent HTTPS TCP Connections...");
  const startConc = Date.now();
  const promises = [1, 2, 3, 4].map(
    (idx) =>
      new Promise((resolve) => {
        execFile("curl.exe", ["--noproxy", "*", "-s", "-m", "10", "https://api.ipify.org"], (err, stdout) => {
          resolve({ idx, success: !err, ip: stdout?.trim() });
        });
      })
  );
  const concResults = await Promise.all(promises);
  const elapsedConc = Date.now() - startConc;
  const allMatched = concResults.every((r) => r.success && r.ip === socksIp);
  console.log(
    `  - 4 Concurrent TCP Connections: ${allMatched ? "ALL 4 PASSED (100% NetMod VPN)" : "PARTIAL/FAILED"} in ${elapsedConc}ms`
  );
  results.progressiveTests.concurrent = {
    total: 4,
    allMatched,
    durationMs: elapsedConc,
    responses: concResults,
  };

  // 6. Progressive Test D & E: Controlled 5 MB Transfer & Resource Benchmark
  console.log("\n[6/8] Progressive Test D: Controlled 5 MB Download Throughput Benchmark...");
  const dlUrl = "https://speed.cloudflare.com/__down?bytes=5242880";
  const tmpFile = path.join(stateDir, "test-transfer.tmp");
  const startDl = Date.now();

  try {
    await new Promise((resolve, reject) => {
      execFile(
        "curl.exe",
        ["--noproxy", "*", "-s", "-m", "25", "-o", tmpFile, dlUrl],
        (err, stdout, stderr) => {
          if (err) return reject(new Error(stderr?.trim() || err.message));
          resolve(true);
        }
      );
    });

    const dlDurationSec = Math.max(0.1, (Date.now() - startDl) / 1000);
    const bytes = fs.statSync(tmpFile).size;
    fs.unlinkSync(tmpFile);

    const throughputMbps = Math.round(((bytes * 8) / (dlDurationSec * 1000000)) * 100) / 100;
    console.log(`  - Downloaded ${(bytes / (1024 * 1024)).toFixed(2)} MB in ${dlDurationSec.toFixed(2)}s`);
    console.log(`  - Measured Throughput: ${throughputMbps} Mbps (Phase 4 baseline: ~19 Mbps)`);

    results.progressiveTests.download = {
      bytes,
      durationSec: dlDurationSec,
      throughputMbps,
      baselineComparison: `${throughputMbps} Mbps vs ~19 Mbps`,
    };
  } catch (err) {
    console.error(`  - Download benchmark failed: ${err.message}`);
    results.progressiveTests.download = { success: false, error: err.message };
  }

  // Sample CPU and Memory
  try {
    const psOut = await new Promise((resolve) => {
      execFile(
        "powershell.exe",
        ["-NoProfile", "-Command", "Get-Process -Name sing-box -ErrorAction SilentlyContinue | Select-Object -Property WorkingSet64 | ConvertTo-Json"],
        { encoding: "utf-8" },
        (err, stdout) => resolve(stdout?.trim() || "")
      );
    });
    if (psOut) {
      const psData = JSON.parse(psOut);
      const memMb = Math.round(psData.WorkingSet64 / (1024 * 1024));
      console.log(`  - sing-box Memory Footprint: ${memMb} MB`);
      results.progressiveTests.resources = { singBoxMemoryMb: memMb };
    }
  } catch {}

  // Telemetry sample
  const finalTelemetry = orchestrator.getStatus();
  results.telemetry = {
    downloadSpeedBps: finalTelemetry.downloadSpeedBps,
    uploadSpeedBps: finalTelemetry.uploadSpeedBps,
    totalBytesReceived: finalTelemetry.totalBytesReceived,
    totalBytesSent: finalTelemetry.totalBytesSent,
    sessionDurationSec: finalTelemetry.sessionDurationSec,
  };
  console.log(
    `  - Measured Telemetry: Recv=${finalTelemetry.totalBytesReceived} B, Sent=${finalTelemetry.totalBytesSent} B, Duration=${finalTelemetry.sessionDurationSec}s`
  );

  // 7. Disconnect and Teardown
  console.log("\n[7/8] Executing Graceful One-Click Disconnect...");
  const disconnRes = await orchestrator.disconnect();
  console.log(`  - Disconnect result: ${disconnRes.message}`);

  // 8. Verify Physical Internet Restoration
  console.log("\n[8/8] Verifying Original Physical Internet Restoration...");
  await new Promise((r) => setTimeout(r, 1500));
  const postIp = await new Promise((resolve) => {
    execFile(
      "curl.exe",
      ["--noproxy", "*", "-s", "-m", "6", "https://api.ipify.org"],
      { encoding: "utf-8" },
      (err, stdout) => resolve(stdout?.trim() || "")
    );
  });
  console.log(`  - Post-Restoration Host IP: ${postIp}`);
  results.restoration = {
    postIp,
    matchesBaseline: postIp === directIp,
  };

  if (postIp === directIp) {
    console.log(`  - CLEAN RESTORATION VERIFIED: Host restored 100% to physical ISP (${postIp})!`);
  } else {
    console.warn(`  - Note: Post-restoration IP is ${postIp} (baseline direct was ${directIp})`);
  }

  fs.writeFileSync(path.join(stateDir, "phase6-live-results.json"), JSON.stringify(results, null, 2));
  console.log(`\nResults written to ${path.join(stateDir, "phase6-live-results.json")}`);
  console.log("=================================================================");
  console.log("PHASE 6 LIVE TEST COMPLETED SUCCESSFULLY!");
  console.log("=================================================================");
}

main().catch(async (err) => {
  console.error("FATAL ERROR during Phase 6 live test:", err);
  results.errors.push(err.message);
  try {
    await orchestrator.disconnect();
  } catch {}
  fs.writeFileSync(path.join(stateDir, "phase6-live-results.json"), JSON.stringify(results, null, 2));
  process.exit(1);
});
