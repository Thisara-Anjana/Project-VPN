/**
 * Safe, Read-Only Windows Network State Inspector & Snapshot Generator
 * USB VPN Bridge - Phase 5A
 *
 * Exclusively executes read-only inspection queries (ipconfig /all, route print -4).
 * Never mutates system routes, adapter metrics, or DNS configuration.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { NetworkAdapterInfo, RouteEntry, NetworkStateSnapshot } from "./types.js";

export class NetworkInspector {
  /**
   * Executes `ipconfig /all` safely without elevating permissions or modifying state.
   */
  public static async queryIpconfig(): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile("ipconfig.exe", ["/all"], { timeout: 8000, windowsHide: true }, (err: Error | null, stdout: string, stderr: string) => {
        if (err) {
          reject(new Error(`Failed to execute ipconfig /all: ${stderr || err.message}`));
        } else {
          resolve(stdout);
        }
      });
    });
  }

  /**
   * Executes `route print -4` safely without elevating permissions or modifying state.
   */
  public static async queryRoutePrint(): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile("route.exe", ["print", "-4"], { timeout: 8000, windowsHide: true }, (err: Error | null, stdout: string, stderr: string) => {
        if (err) {
          reject(new Error(`Failed to execute route print: ${stderr || err.message}`));
        } else {
          resolve(stdout);
        }
      });
    });
  }

  /**
   * Parses output of `route print -4` into structured `RouteEntry` objects.
   */
  public static parseRoutePrint(routeOutput: string): {
    interfaces: Map<number, string>;
    routes: RouteEntry[];
  } {
    const interfaces = new Map<number, string>();
    const routes: RouteEntry[] = [];

    const lines = routeOutput.split(/\r?\n/);
    let inInterfaceSection = false;
    let inActiveRoutes = false;

    for (const rawLine of lines) {
      const line = rawLine.trim();

      if (line.includes("Interface List")) {
        inInterfaceSection = true;
        inActiveRoutes = false;
        continue;
      }

      if (line.includes("IPv4 Route Table")) {
        inInterfaceSection = false;
        continue;
      }

      if (line.includes("Active Routes:")) {
        inActiveRoutes = true;
        continue;
      }

      if (line.includes("Persistent Routes:") || (inActiveRoutes && line.startsWith("======="))) {
        if (inActiveRoutes && routes.length > 0) {
          inActiveRoutes = false;
        }
      }

      // Parse Interface List entries: e.g. " 14...00 d8 61 6d cb 8d ......Realtek PCIe GbE Family Controller"
      if (inInterfaceSection) {
        const match = line.match(/^(\d+)\.\.\.([0-9a-fA-F ]+)\s*\.{3,}\s*(.+)$/);
        if (match) {
          const idx = parseInt(match[1], 10);
          const desc = match[3].trim();
          interfaces.set(idx, desc);
        }
        continue;
      }

      // Parse Active Route entries
      // Network Destination        Netmask          Gateway       Interface  Metric
      //           0.0.0.0          0.0.0.0      192.168.8.1    192.168.8.192     35
      if (inActiveRoutes) {
        const parts = line.split(/\s+/);
        if (parts.length >= 5) {
          const [dest, netmask, gateway, ifaceIp, metricStr] = parts;
          const metric = parseInt(metricStr, 10);
          if (!isNaN(metric) && dest.match(/^\d+\.\d+\.\d+\.\d+$/)) {
            const isDefault = dest === "0.0.0.0" && netmask === "0.0.0.0";
            routes.push({
              destination: dest,
              netmask,
              gateway,
              interfaceIp: ifaceIp,
              interfaceIndex: 0, // Will be mapped via interfaceIp
              metric,
              isDefaultRoute: isDefault,
            });
          }
        }
      }
    }

    return { interfaces, routes };
  }

  /**
   * Parses output of `ipconfig /all` into structured `NetworkAdapterInfo` objects.
   */
  public static parseIpconfig(ipconfigOutput: string): NetworkAdapterInfo[] {
    const adapters: NetworkAdapterInfo[] = [];
    const sections = ipconfigOutput.split(/\r?\n\r?\n(?=[A-Za-z0-9])/);

    for (const section of sections) {
      const lines = section.split(/\r?\n/);
      if (lines.length < 2) continue;

      const headerLine = lines[0].trim();
      if (headerLine.startsWith("Windows IP Configuration")) continue;

      // Extract adapter name: "Ethernet adapter Ethernet:" or "Unknown adapter Local Area Connection:"
      const nameMatch = headerLine.match(/^(?:Ethernet adapter|Wireless LAN adapter|Unknown adapter)\s+([^:]+):/i);
      const adapterName = nameMatch ? nameMatch[1].trim() : headerLine.replace(/:$/, "").trim();

      let description = "";
      let macAddress = "";
      let status: "Up" | "Down" | "Disconnected" | "Unknown" = "Up";
      const ipv4Addresses: string[] = [];
      const ipv6Addresses: string[] = [];
      const defaultGateways: string[] = [];
      const dnsServers: string[] = [];

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();

        if (line.includes("Media State") && line.includes("disconnected")) {
          status = "Disconnected";
        }
        const descMatch = line.match(/Description[ .]+:\s*(.+)$/i);
        if (descMatch) description = descMatch[1].trim();

        const macMatch = line.match(/Physical Address[ .]+:\s*([0-9A-Fa-f-]+)$/i);
        if (macMatch) macAddress = macMatch[1].trim();

        const ipv4Match = line.match(/IPv4 Address[ .]+:\s*([0-9.]+)(?:\(Preferred\))?/i);
        if (ipv4Match) ipv4Addresses.push(ipv4Match[1].trim());

        const ipv6Match = line.match(/(?:Link-local )?IPv6 Address[ .]+:\s*([0-9a-fA-F:]+(?:%[0-9]+)?)(?:\(Preferred\))?/i);
        if (ipv6Match) ipv6Addresses.push(ipv6Match[1].trim());

        const gwMatch = line.match(/Default Gateway[ .]+:\s*([0-9.]+)/i);
        if (gwMatch && gwMatch[1].trim()) defaultGateways.push(gwMatch[1].trim());

        const dnsMatch = line.match(/DNS Servers[ .]+:\s*([0-9.]+)/i);
        if (dnsMatch && dnsMatch[1].trim()) dnsServers.push(dnsMatch[1].trim());

        // Multi-line DNS entries follow indent
        if (line.match(/^\s+([0-9.]+)\s*$/)) {
          const subIp = line.trim();
          if (subIp.match(/^\d+\.\d+\.\d+\.\d+$/)) {
            dnsServers.push(subIp);
          }
        }
      }

      const descLower = description.toLowerCase();
      const nameLower = adapterName.toLowerCase();
      const isTunOrTap =
        descLower.includes("tap") ||
        descLower.includes("tun") ||
        descLower.includes("wintun") ||
        descLower.includes("tunnelbear") ||
        descLower.includes("openvpn") ||
        descLower.includes("wireguard") ||
        nameLower.includes("wintun");

      const isVirtual =
        isTunOrTap ||
        descLower.includes("hyper-v") ||
        descLower.includes("virtual") ||
        descLower.includes("vmware") ||
        descLower.includes("pdanet");

      adapters.push({
        name: adapterName,
        interfaceIndex: 0, // Will be mapped via route table
        description,
        macAddress,
        status,
        isVirtual,
        isTunOrTap,
        ipv4Addresses,
        ipv6Addresses,
        defaultGateways,
        dnsServers,
        interfaceMetric: 0,
      });
    }

    return adapters;
  }

  /**
   * Performs complete read-only network inspection and returns aggregated diagnostics.
   */
  public static async inspectNetwork(): Promise<{
    adapters: NetworkAdapterInfo[];
    routes: RouteEntry[];
    defaultRoutes: RouteEntry[];
    primaryAdapter: NetworkAdapterInfo | null;
    activeVpnAdapters: string[];
    snapshot: NetworkStateSnapshot;
  }> {
    const [ipconfigOut, routeOut] = await Promise.all([
      this.queryIpconfig(),
      this.queryRoutePrint(),
    ]);

    const adapters = this.parseIpconfig(ipconfigOut);
    const { interfaces, routes } = this.parseRoutePrint(routeOut);

    // Map interface indexes and metrics to adapters
    for (const adapter of adapters) {
      for (const [idx, desc] of interfaces.entries()) {
        if (
          adapter.description &&
          (desc.toLowerCase().includes(adapter.description.toLowerCase()) ||
            adapter.description.toLowerCase().includes(desc.toLowerCase()))
        ) {
          adapter.interfaceIndex = idx;
          break;
        }
      }
      // Correlate route interface IP
      for (const r of routes) {
        if (adapter.ipv4Addresses.includes(r.interfaceIp)) {
          r.interfaceIndex = adapter.interfaceIndex;
          adapter.interfaceMetric = r.metric;
        }
      }
    }

    const defaultRoutes = routes.filter((r) => r.isDefaultRoute);

    // Identify primary physical adapter with lowest metric default route
    let primaryAdapter: NetworkAdapterInfo | null = null;
    let lowestMetric = Infinity;

    for (const defRoute of defaultRoutes) {
      const match = adapters.find((a) => a.ipv4Addresses.includes(defRoute.interfaceIp));
      if (match && defRoute.metric < lowestMetric && !match.isTunOrTap) {
        lowestMetric = defRoute.metric;
        primaryAdapter = match;
      }
    }

    // Identify existing active VPN / TUN / TAP adapters
    const activeVpnAdapters = adapters
      .filter((a) => a.isTunOrTap && a.status === "Up")
      .map((a) => `${a.name} (${a.description})`);

    const dnsMap: Record<string, string[]> = {};
    for (const a of adapters) {
      if (a.dnsServers.length > 0) {
        dnsMap[a.name] = a.dnsServers;
      }
    }

    const now = Date.now();
    const snapshot: NetworkStateSnapshot = {
      capturedAt: now,
      timestampIso: new Date(now).toISOString(),
      primaryAdapterName: primaryAdapter ? primaryAdapter.name : null,
      primaryInterfaceIndex: primaryAdapter ? primaryAdapter.interfaceIndex : null,
      defaultIpv4Gateway: defaultRoutes.length > 0 ? defaultRoutes[0].gateway : null,
      defaultIpv4Metric: defaultRoutes.length > 0 ? defaultRoutes[0].metric : null,
      existingDefaultRoutes: defaultRoutes,
      dnsServers: dnsMap,
      activeVpnAdaptersFound: activeVpnAdapters,
      restorationStatus: "NOT_REQUIRED",
    };

    return {
      adapters,
      routes,
      defaultRoutes,
      primaryAdapter,
      activeVpnAdapters,
      snapshot,
    };
  }

  /**
   * Saves a network snapshot file to disk for crash recovery and audit trails.
   */
  public static saveSnapshot(snapshotPath: string, snapshot: NetworkStateSnapshot): void {
    const dir = path.dirname(snapshotPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), "utf-8");
  }
}
