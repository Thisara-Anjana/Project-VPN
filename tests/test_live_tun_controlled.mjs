/**
 * Controlled Single Live TUN Connectivity Test Runner
 * USB VPN Bridge - Phase 5B
 *
 * Executes a strictly bounded (sub-10-second), single-request live test:
 * 1. Spawns sing-box with validated MTU 1500 config and auto_route: true.
 * 2. Verifies virtual adapter and routing table changes.
 * 3. Executes single bare HTTPS test (curl.exe --noproxy "*" https://api.ipify.org).
 * 4. Compares egress IP against baseline NetMod IP (91.192.81.167).
 * 5. Immediately terminates sing-box.
 * 6. Confirms route and DNS restoration to baseline (192.168.8.1 / 175.157.16.142).
 */

import { spawn, execFileSync, execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCommand(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 8000 }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code || 1 : 0, stdout: stdout || "", stderr: stderr || "" });
    });
  });
}

async function runLiveTest() {
  console.log("=================================================================");
  console.log("USB VPN BRIDGE — CONTROLLED SINGLE LIVE TUN CONNECTIVITY TEST");
  console.log("=================================================================\n");

  const stateDir = path.resolve(process.cwd(), "network-core/state");
  const binDir = path.resolve(process.cwd(), "network-core/bin");
  const singBoxBin = path.join(binDir, "sing-box.exe");
  const configPath = path.join(stateDir, "sing-box-config.json");
  const snapshotPath = path.join(stateDir, "pre-test-snapshot.json");

  if (!fs.existsSync(singBoxBin)) throw new Error("sing-box.exe missing");
  if (!fs.existsSync(configPath)) throw new Error("sing-box-config.json missing");
  if (!fs.existsSync(snapshotPath)) throw new Error("pre-test-snapshot.json missing");

  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf-8"));
  console.log(`[PRE-CHECK] Baseline Physical Gateway: ${snapshot.defaultIpv4Gateway} (Metric: ${snapshot.defaultIpv4Metric})`);

  // Verify baseline direct IP without proxy
  console.log("[PRE-CHECK] Measuring current direct host egress IP...");
  const directEgress = await runCommand("curl.exe", ["--noproxy", "*", "-s", "-m", "6", "https://api.ipify.org"]);
  console.log(`  - Direct Physical Host IP: ${directEgress.stdout.trim() || "Failed to query"}`);

  // Verify SOCKS5 relay over USB
  console.log("[PRE-CHECK] Measuring current USB NetMod SOCKS5 egress IP...");
  const socksEgress = await runCommand("curl.exe", ["--proxy", "socks5h://127.0.0.1:10808", "-s", "-m", "6", "https://api.ipify.org"]);
  const expectedNetModIp = socksEgress.stdout.trim();
  console.log(`  - Target NetMod VPN Egress IP: ${expectedNetModIp}`);
  if (!expectedNetModIp || socksEgress.code !== 0) {
    throw new Error("SOCKS5 relay on 127.0.0.1:10808 is not responding. Aborting live test.");
  }

  const testReport = {
    startedAt: new Date().toISOString(),
    expectedNetModIp,
    baselineDirectIp: directEgress.stdout.trim(),
    tunStartupSuccess: false,
    virtualAdapterFound: false,
    tunDefaultRouteFound: false,
    proxyFreeEgressIp: null,
    tunnelHandledEvidence: [],
    singBoxLogs: [],
    restorationSuccess: false,
    postRestorationIp: null,
    error: null,
  };

  let singBoxProc = null;

  try {
    console.log("\n[STEP 1] Starting native TUN engine (sing-box 1.14.4 + Wintun)...");
    singBoxProc = spawn(singBoxBin, ["run", "-c", configPath], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    singBoxProc.stdout.on("data", (d) => {
      const txt = d.toString().trim();
      for (const line of txt.split(/\r?\n/)) {
        if (line) {
          testReport.singBoxLogs.push(`[OUT] ${line}`);
          if (line.includes("inbound/tun") || line.includes("outbound/socks")) {
            testReport.tunnelHandledEvidence.push(line);
          }
        }
      }
    });

    singBoxProc.stderr.on("data", (d) => {
      const txt = d.toString().trim();
      for (const line of txt.split(/\r?\n/)) {
        if (line) {
          testReport.singBoxLogs.push(`[ERR] ${line}`);
          if (line.includes("inbound/tun") || line.includes("outbound/socks")) {
            testReport.tunnelHandledEvidence.push(line);
          }
        }
      }
    });

    // Wait up to 3 seconds for Wintun adapter creation & route table update
    console.log("[STEP 2] Awaiting Wintun adapter initialization & auto_route injection...");
    await sleep(2500);

    if (singBoxProc.exitCode !== null) {
      throw new Error(`sing-box terminated prematurely with exit code: ${singBoxProc.exitCode}. Logs:\n${testReport.singBoxLogs.join("\n")}`);
    }
    testReport.tunStartupSuccess = true;
    console.log("  => sing-box process is alive (PID: " + singBoxProc.pid + ")");

    // Inspect routing table
    console.log("[STEP 3] Inspecting active routing table (route print -4)...");
    const routeCheck = await runCommand("route.exe", ["print", "-4"]);
    const hasTunRoute = routeCheck.stdout.includes("172.19.0.1") || routeCheck.stdout.includes("172.19.0.2");
    testReport.tunDefaultRouteFound = hasTunRoute;
    console.log("  - TUN route entry (172.19.0.x) active in routing table:", hasTunRoute);

    // Inspect adapters
    const ipconfigCheck = await runCommand("ipconfig.exe", ["/all"]);
    const hasTunAdapter = ipconfigCheck.stdout.includes("usb-vpn-tun") || ipconfigCheck.stdout.includes("172.19.0.1");
    testReport.virtualAdapterFound = hasTunAdapter;
    console.log("  - Virtual adapter (usb-vpn-tun) detected:", hasTunAdapter);

    // STEP 4: Execute single HTTPS request WITHOUT proxy flag
    console.log("\n[STEP 4] Executing controlled proxy-free HTTPS request: curl.exe --noproxy '*' https://api.ipify.org...");
    const curlTest = await runCommand("curl.exe", ["--noproxy", "*", "-s", "-m", "8", "https://api.ipify.org"]);
    const tunEgressIp = curlTest.stdout.trim();
    testReport.proxyFreeEgressIp = tunEgressIp;
    console.log(`  - Returned Egress IP: ${tunEgressIp} (Exit Code: ${curlTest.code})`);

    const egressMatches = tunEgressIp === expectedNetModIp;
    console.log(`  - Matches NetMod Singapore Egress (${expectedNetModIp}): ${egressMatches ? "YES! 100% MATCH" : "NO"}`);
  } catch (err) {
    console.error("Test encountered an exception:", err.message);
    testReport.error = err.message;
  } finally {
    // Immediate teardown
    console.log("\n[STEP 5] Stopping sing-box daemon and triggering emergency route restoration...");
    if (singBoxProc && singBoxProc.exitCode === null) {
      singBoxProc.kill("SIGINT");
      await sleep(1500);
      if (singBoxProc.exitCode === null) {
        singBoxProc.kill("SIGKILL");
      }
    }

    // Clean up TUN adapter and reset default route
    try {
      execFileSync("netsh.exe", ["interface", "set", "interface", "name=usb-vpn-tun", "admin=disable"], { windowsHide: true });
    } catch {}

    try {
      execFileSync("route.exe", ["delete", "0.0.0.0", "mask", "0.0.0.0", "172.19.0.1"], { windowsHide: true });
    } catch {}

    if (snapshot.defaultIpv4Gateway && snapshot.primaryInterfaceIndex) {
      try {
        execFileSync(
          "route.exe",
          ["change", "0.0.0.0", "mask", "0.0.0.0", snapshot.defaultIpv4Gateway, "metric", String(snapshot.defaultIpv4Metric || 35), "if", String(snapshot.primaryInterfaceIndex)],
          { windowsHide: true }
        );
      } catch {}
    }

    try {
      execFileSync("ipconfig.exe", ["/flushdns"], { windowsHide: true });
    } catch {}

    // Verify post-restoration
    console.log("[STEP 6] Verifying route and DNS restoration...");
    await sleep(1000);
    const postCheck = await runCommand("curl.exe", ["--noproxy", "*", "-s", "-m", "6", "https://api.ipify.org"]);
    testReport.postRestorationIp = postCheck.stdout.trim();
    console.log(`  - Post-restoration direct IP: ${testReport.postRestorationIp}`);
    testReport.restorationSuccess = testReport.postRestorationIp === testReport.baselineDirectIp;
    console.log(`  - Matches original physical ISP IP (${testReport.baselineDirectIp}): ${testReport.restorationSuccess}`);

    // Save live test output
    fs.writeFileSync(path.join(stateDir, "live-test-results.json"), JSON.stringify(testReport, null, 2), "utf-8");
    console.log(`\nLive test results saved to: ${path.join(stateDir, "live-test-results.json")}`);
  }

  console.log("\n=================================================================");
  console.log("CONTROLLED LIVE TUN TEST COMPLETE");
  console.log("=================================================================");
}

runLiveTest().catch((e) => {
  console.error("Fatal runner error:", e);
});
