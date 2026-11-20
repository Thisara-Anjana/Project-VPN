import { execFile } from "node:child_process";

const PROXY = "socks5h://127.0.0.1:10808";

function runCurlDownload(url, label) {
  console.log(`\n--- [${label}] Fetching: ${url} ---`);
  const writeOutFormat = "time_total:%{time_total}\\nspeed_download:%{speed_download}\\nsize_download:%{size_download}\\nhttp_code:%{http_code}\\n";

  return new Promise((resolve, reject) => {
    execFile(
      "curl.exe",
      [
        "--proxy", PROXY,
        "-s",
        "-o", "NUL",
        "-w", writeOutFormat,
        "-m", "30",
        url
      ],
      (err, stdout, stderr) => {
        if (err) {
          return reject(new Error(`curl error: ${err.message} - ${stderr}`));
        }

        const lines = stdout.trim().split(/\r?\n/);
        const stats = {};
        for (const line of lines) {
          const [k, v] = line.split(":");
          if (k && v !== undefined) stats[k.trim()] = parseFloat(v.trim());
        }

        const duration = stats.time_total || 0;
        const bytes = stats.size_download || 0;
        const bytesPerSec = stats.speed_download || 0;
        const mbps = (bytesPerSec * 8) / 1_000_000;
        const mb = bytes / (1024 * 1024);

        console.log(`[PASS] ${label} Completed:`);
        console.log(`       HTTP Status: ${stats.http_code}`);
        console.log(`       Bytes Downloaded: ${bytes.toLocaleString()} bytes (${mb.toFixed(2)} MB)`);
        console.log(`       Time Total: ${duration.toFixed(2)} seconds`);
        console.log(`       Throughput: ${mbps.toFixed(2)} Mbps`);

        resolve({ duration, bytes, mbps });
      }
    );
  });
}

async function runPerf() {
  console.log("=========================================================");
  console.log("  USB VPN Bridge — Phase 4 SOCKS5 Throughput Suite (via curl) ");
  console.log("=========================================================");
  console.log(`SOCKS5 Proxy: ${PROXY}`);

  try {
    // Test 1: Single TCP Stream (5 MB controlled download)
    const test1Url = "https://speed.cloudflare.com/__down?bytes=5242880";
    await runCurlDownload(test1Url, "Single TCP Stream (5MB)");

    // Test 2: 3 Concurrent TCP Streams (2 MB each in parallel)
    console.log("\n--- [Concurrent Streams] 3 Parallel TCP Downloads (2MB each) ---");
    const test2Url = "https://speed.cloudflare.com/__down?bytes=2097152";
    const tStart = Date.now();

    const results = await Promise.all([
      runCurlDownload(test2Url, "Worker #1 (2MB)"),
      runCurlDownload(test2Url, "Worker #2 (2MB)"),
      runCurlDownload(test2Url, "Worker #3 (2MB)")
    ]);

    const wallDuration = (Date.now() - tStart) / 1000;
    const totalBytes = results.reduce((acc, r) => acc + r.bytes, 0);
    const aggMbps = (totalBytes * 8) / wallDuration / 1_000_000;

    console.log("\n---------------------------------------------------------");
    console.log("  Concurrent Downloads Summary:");
    console.log(`  Aggregate Bytes: ${(totalBytes / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`  Wall-Clock Duration: ${wallDuration.toFixed(2)} seconds`);
    console.log(`  Aggregate Measured Throughput: ${aggMbps.toFixed(2)} Mbps`);
    console.log("=========================================================");
  } catch (err) {
    console.error(`[FAIL] Perf test error: ${err.message}`);
    process.exit(1);
  }
}

runPerf();
