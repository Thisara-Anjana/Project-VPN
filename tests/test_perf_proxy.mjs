import http from "node:http";
import https from "node:https";
import { SocksProxyAgent } from "socks-proxy-agent";

const PROXY_URL = "socks5h://127.0.0.1:10808";
const agent = new SocksProxyAgent(PROXY_URL);

async function downloadTest(url, label) {
  console.log(`\n--- [${label}] Starting Download from: ${url} ---`);
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    https.get(url, { agent, timeout: 20000 }, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP status: ${res.statusCode}`));
      }

      let totalBytes = 0;
      res.on("data", (chunk) => {
        totalBytes += chunk.length;
      });

      res.on("end", () => {
        const durationSec = (Date.now() - startTime) / 1000;
        const mbps = (totalBytes * 8) / durationSec / 1_000_000;
        const totalMB = totalBytes / (1024 * 1024);
        console.log(`[PASS] ${label} Completed:`);
        console.log(`       Bytes Received: ${totalBytes.toLocaleString()} bytes (${totalMB.toFixed(2)} MB)`);
        console.log(`       Duration: ${durationSec.toFixed(2)} seconds`);
        console.log(`       Throughput: ${mbps.toFixed(2)} Mbps`);
        resolve({ totalBytes, durationSec, mbps });
      });

      res.on("error", (err) => reject(err));
    }).on("error", (err) => reject(err));
  });
}

async function runPerformanceSuite() {
  console.log("=================================================");
  console.log("   USB VPN Bridge — Phase 4 SOCKS5 Perf Suite   ");
  console.log("=================================================");
  console.log(`Proxy Gateway: ${PROXY_URL}`);

  try {
    // Test 1: Single 5MB download (controlled size to avoid excessive cellular data)
    const test1Url = "https://speed.cloudflare.com/__down?bytes=5242880";
    const res1 = await downloadTest(test1Url, "Single TCP Stream (5MB)");

    // Test 2: 3 Concurrent 2MB downloads in parallel
    console.log("\n--- [Concurrent TCP Streams] 3 Parallel Downloads (2MB each) ---");
    const test2Url = "https://speed.cloudflare.com/__down?bytes=2097152";
    const t2Start = Date.now();

    const parallelResults = await Promise.all([
      downloadTest(test2Url, "Worker #1 (2MB)"),
      downloadTest(test2Url, "Worker #2 (2MB)"),
      downloadTest(test2Url, "Worker #3 (2MB)")
    ]);

    const t2DurationSec = (Date.now() - t2Start) / 1000;
    const totalBytesAll = parallelResults.reduce((acc, r) => acc + r.totalBytes, 0);
    const aggMbps = (totalBytesAll * 8) / t2DurationSec / 1_000_000;

    console.log(`\n[PASS] Concurrent TCP Test Summary:`);
    console.log(`       Aggregate Bytes: ${(totalBytesAll / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`       Total Wall Duration: ${t2DurationSec.toFixed(2)} seconds`);
    console.log(`       Aggregate Throughput: ${aggMbps.toFixed(2)} Mbps`);

    console.log("\n=================================================");
    console.log("   All Performance Tests Passed Successfully     ");
    console.log("=================================================");
  } catch (err) {
    console.error(`[FAIL] Performance test failed: ${err.message}`);
    process.exit(1);
  }
}

runPerformanceSuite();
