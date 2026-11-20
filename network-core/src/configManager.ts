/**
 * Sing-box 1.14+ Configuration Manager & Strict Route-Loop Safety Validator
 * USB VPN Bridge - Phase 5B (Safety-Corrected)
 */

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { SingBoxConfigSchema, SingBoxRouteRule } from "./types.js";

export interface ConfigOptions {
  tunInterfaceName?: string;
  tunAddress?: string[];
  tunMtu?: number;
  socksHost?: string;
  socksPort?: number;
  enableAutoRoute?: boolean;
  blockIpv6?: boolean;
  unsupportedUdpPolicy?: "BLOCK" | "REJECT";
  localGatewayIp?: string | null;
  excludedProcesses?: string[];
}

export class ConfigManager {
  public static readonly DEFAULT_TUN_NAME = "usb-vpn-tun";
  public static readonly DEFAULT_TUN_ADDRESS = ["172.19.0.1/30"];
  public static readonly DEFAULT_TUN_MTU = 1500; // Standard Ethernet MTU for maximum cellular/VPN compatibility
  public static readonly DEFAULT_SOCKS_HOST = "127.0.0.1";
  public static readonly DEFAULT_SOCKS_PORT = 10808;

  /**
   * Generates a fully validated sing-box 1.14+ configuration with strict, non-leaking route rules.
   *
   * Route Policy Rationale:
   * 1. adb.exe & sing-box.exe: Only these 2 native processes are excluded from the TUN.
   *    - adb.exe transfers USB packets via USB driver endpoints.
   *    - sing-box.exe binds outbounds to physical interfaces/loopback.
   *    - Note: electron.exe is NEVER excluded to prevent browser/app diagnostic leaks.
   * 2. 127.0.0.0/8 (Loopback): Excluded to allow local ADB forwarder port (10808) and ADB server (5037)
   *    to communicate without looping into the TUN adapter.
   * 3. Local Gateway IP (Targeted): If provided (e.g. 192.168.8.1/32), ONLY that single gateway IP is
   *    routed direct to maintain local router ARP/NDP connectivity. Broad private networks (10.0.0.0/8,
   *    172.16.0.0/12, 192.168.0.0/16) are NOT bypassed.
   * 4. Unsupported UDP: Android SOCKS5 proxy supports TCP CONNECT only. Non-DNS UDP is directed to block-out
   *    to prevent silent physical interface leakage in VPN-only mode and force TCP fallback (e.g. HTTP/3 -> HTTP/2).
   * 5. IPv6: Blocked locally to prevent dual-stack leakage over physical network outside IPv4 NetMod VPN.
   * 6. Default TCP: Directed through socks-out (127.0.0.1:10808) traversing USB to Android NetMod VPN.
   */
  public static generateConfig(options: ConfigOptions = {}): SingBoxConfigSchema {
    const tunName = options.tunInterfaceName || this.DEFAULT_TUN_NAME;
    const tunAddress = options.tunAddress || this.DEFAULT_TUN_ADDRESS;
    const tunMtu = options.tunMtu || this.DEFAULT_TUN_MTU; // 1500 bytes
    const socksHost = options.socksHost || this.DEFAULT_SOCKS_HOST;
    const socksPort = options.socksPort || this.DEFAULT_SOCKS_PORT;
    const enableAutoRoute = options.enableAutoRoute ?? false;
    const blockIpv6 = options.blockIpv6 ?? true;
    const localGatewayIp = options.localGatewayIp || null;

    // Strict process exclusions: ONLY native transport daemons, NEVER user-facing applications
    const excludedProcesses = options.excludedProcesses || [
      "adb.exe",
      "sing-box.exe",
    ];

    const rules: SingBoxRouteRule[] = [
      // 0. Packet Sniffing Action (Sing-box 1.13+ rule action for TLS/HTTP host extraction)
      {
        inbound: ["tun-in"],
        action: "sniff",
      },
      // 1. Process Loopback Exclusion (CRITICAL)
      // adb.exe transfers USB bulk frames; sing-box.exe binds outbounds.
      {
        process_name: excludedProcesses,
        outbound: "direct-out",
      },
      // 2. Loopback CIDR Exclusion (CRITICAL)
      // 127.0.0.0/8 loopback connects to ADB forwarder (port 10808) and ADB server (port 5037)
      {
        ip_cidr: ["127.0.0.0/8"],
        outbound: "direct-out",
      },
    ];

    // 3. Targeted Single Gateway IP Exclusion (if known)
    // ONLY the physical gateway IP (e.g. 192.168.8.1/32) is preserved, avoiding broad subnet leaks
    if (localGatewayIp && localGatewayIp.match(/^\d+\.\d+\.\d+\.\d+$/)) {
      rules.push({
        ip_cidr: [`${localGatewayIp}/32`],
        outbound: "direct-out",
      });
    }

    // 4. IPv6 Leak Prevention (CRITICAL)
    // Since Android NetMod SOCKS5 tunnel is IPv4-only, all IPv6 is blocked locally
    if (blockIpv6) {
      rules.push({
        ip_version: 6 as const,
        outbound: "block-out",
      });
    }

    // 5. Unsupported UDP Protection (CRITICAL)
    // Android SOCKS5 proxy only supports TCP CONNECT (RFC 1928 cmd 1).
    // Raw UDP cannot be forwarded via port 10808. We block non-DNS UDP to prevent leaks.
    rules.push({
      network: "udp",
      outbound: "block-out",
    });

    // 6. Default Route: Route all tunneled TCP traffic to Android SOCKS5 Relay
    rules.push({
      network: "tcp",
      inbound: ["tun-in"],
      outbound: "socks-out",
    });

    const config: SingBoxConfigSchema = {
      log: {
        disabled: false,
        level: "info",
        timestamp: true,
      },
      dns: {
        servers: [
          {
            tag: "remote-dns",
            type: "tcp",
            server: "1.1.1.1",
            server_port: 53,
            detour: "socks-out",
          },
          {
            tag: "local-dns",
            type: "local",
            detour: "direct-out",
          },
        ],
        strategy: "ipv4_only",
      },
      inbounds: [
        {
          type: "tun",
          tag: "tun-in",
          interface_name: tunName,
          address: tunAddress,
          mtu: tunMtu, // 1500 bytes
          auto_route: enableAutoRoute,
          strict_route: true,
          stack: "mixed",
          endpoint_independent_nat: true,
        },
      ],
      outbounds: [
        {
          type: "socks",
          tag: "socks-out",
          server: socksHost,
          server_port: socksPort,
          version: "5",
        },
        {
          type: "direct",
          tag: "direct-out",
        },
        {
          type: "block",
          tag: "block-out",
        },
      ],
      route: {
        auto_detect_interface: true,
        default_domain_resolver: "local-dns",
        rules,
      },
    };

    return config;
  }

  /**
   * Performs static architectural validation on a Sing-box configuration object.
   * Returns validation result and security/loop-safety audit findings.
   */
  public static validateConfig(config: SingBoxConfigSchema): {
    valid: boolean;
    errors: string[];
    warnings: string[];
    routeLoopProtected: boolean;
    udpSafetyEnforced: boolean;
    ipv6LeakProtected: boolean;
    mtuCorrect: boolean;
    electronNotExcluded: boolean;
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Verify SOCKS outbound
    const socksOutbound = config.outbounds.find((o) => (o as any).type === "socks" && (o as any).tag === "socks-out") as any;
    if (!socksOutbound) {
      errors.push("Missing required 'socks-out' outbound targeting local SOCKS5 proxy.");
    } else {
      if (socksOutbound.server !== "127.0.0.1" && socksOutbound.server !== "localhost") {
        warnings.push(`SOCKS5 server is set to '${socksOutbound.server}', expected '127.0.0.1'.`);
      }
      if (socksOutbound.server_port !== 10808) {
        warnings.push(`SOCKS5 port is '${socksOutbound.server_port}', expected 10808.`);
      }
    }

    // Verify TUN inbound
    const tunInbound = config.inbounds.find((i) => (i as any).type === "tun") as any;
    let mtuCorrect = false;
    if (!tunInbound) {
      errors.push("Missing required 'tun' inbound.");
    } else {
      if (!Array.isArray(tunInbound.address) || tunInbound.address.length === 0) {
        errors.push("Missing required 'address' array on TUN inbound.");
      }
      if (tunInbound.mtu === 1500) {
        mtuCorrect = true;
      } else {
        warnings.push(`TUN MTU is configured as ${tunInbound.mtu}, recommended initial MTU is 1500.`);
      }
    }

    // Verify Route-Loop Protection
    const rules = config.route.rules || [];
    const hasLoopbackExclusion = rules.some(
      (r) => r.ip_cidr && r.ip_cidr.includes("127.0.0.0/8") && r.outbound === "direct-out"
    );
    const hasAdbProcessExclusion = rules.some(
      (r) => r.process_name && r.process_name.includes("adb.exe") && r.outbound === "direct-out"
    );
    const routeLoopProtected = hasLoopbackExclusion && hasAdbProcessExclusion;

    if (!hasLoopbackExclusion) {
      errors.push("CRITICAL ROUTE-LOOP RISK: 127.0.0.0/8 is not explicitly routed to 'direct-out'.");
    }
    if (!hasAdbProcessExclusion) {
      errors.push("CRITICAL ROUTE-LOOP RISK: 'adb.exe' process is not excluded via 'direct-out'.");
    }

    // Verify electron.exe is NOT broadly excluded
    const excludesElectron = rules.some(
      (r) => r.process_name && r.process_name.includes("electron.exe") && r.outbound === "direct-out"
    );
    const electronNotExcluded = !excludesElectron;
    if (excludesElectron) {
      warnings.push("SECURITY WARNING: 'electron.exe' is excluded from tunnel, which could leak desktop app web requests.");
    }

    // Verify broad private IP exclusion is absent
    const hasBroadPrivateExclusion = rules.some(
      (r) => r.ip_is_private === true && r.outbound === "direct-out"
    );
    if (hasBroadPrivateExclusion) {
      warnings.push("SECURITY WARNING: Broad 'ip_is_private' exclusion detected. Private IP subnets may leak outside VPN.");
    }

    // Verify UDP Safety
    const hasUdpBlockRule = rules.some(
      (r) => r.network === "udp" && (r.outbound === "block-out" || (r as any).outbound === "reject-out")
    );
    const udpSafetyEnforced = hasUdpBlockRule;
    if (!hasUdpBlockRule) {
      warnings.push("WARNING: Unsupported UDP is not explicitly blocked. Risk of traffic leak or unhandled timeouts.");
    }

    // Verify IPv6 Leak Protection
    const hasIpv6BlockRule = rules.some((r) => r.ip_version === 6 && r.outbound === "block-out");
    const ipv6LeakProtected = hasIpv6BlockRule;
    if (!hasIpv6BlockRule) {
      warnings.push("WARNING: IPv6 traffic is not explicitly blocked. Potential IPv6 DNS/traffic leak.");
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      routeLoopProtected,
      udpSafetyEnforced,
      ipv6LeakProtected,
      mtuCorrect,
      electronNotExcluded,
    };
  }

  /**
   * Writes the configuration to a JSON file.
   */
  public static saveConfigFile(filePath: string, config: SingBoxConfigSchema): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), "utf-8");
  }

  /**
   * Runs an external dry-run check using `sing-box.exe check -c <configFile>` if sing-box binary is present.
   */
  public static async dryRunCheck(
    binaryPath: string,
    configPath: string
  ): Promise<{ success: boolean; output: string }> {
    if (!fs.existsSync(binaryPath)) {
      return { success: false, output: `Sing-box binary not found at: ${binaryPath}` };
    }
    if (!fs.existsSync(configPath)) {
      return { success: false, output: `Config file not found at: ${configPath}` };
    }

    return new Promise((resolve) => {
      execFile(
        binaryPath,
        ["check", "-c", configPath],
        { timeout: 10000, windowsHide: true },
        (err: Error | null, stdout: string, stderr: string) => {
          if (err) {
            resolve({ success: false, output: stderr?.trim() || stdout?.trim() || err.message });
          } else {
            resolve({ success: true, output: stdout?.trim() || "Configuration check passed successfully." });
          }
        }
      );
    });
  }
}
