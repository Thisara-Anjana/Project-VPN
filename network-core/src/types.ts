/**
 * Network Core Types & Schema Specifications (sing-box 1.14+ & Wintun)
 * USB VPN Bridge - Phase 5B
 */

export type NetworkEngineStatus =
  | "NOT_STARTED"
  | "VALIDATING"
  | "READY"
  | "ACTIVE"
  | "ERROR"
  | "STOPPING";

export interface NetworkAdapterInfo {
  name: string;
  interfaceIndex: number;
  description: string;
  macAddress: string;
  status: "Up" | "Down" | "Disconnected" | "Unknown";
  isVirtual: boolean;
  isTunOrTap: boolean;
  ipv4Addresses: string[];
  ipv6Addresses: string[];
  defaultGateways: string[];
  dnsServers: string[];
  interfaceMetric: number;
}

export interface RouteEntry {
  destination: string;
  netmask: string;
  gateway: string;
  interfaceIp: string;
  interfaceIndex: number;
  metric: number;
  isDefaultRoute: boolean;
}

export interface NetworkStateSnapshot {
  capturedAt: number;
  timestampIso: string;
  primaryAdapterName: string | null;
  primaryInterfaceIndex: number | null;
  defaultIpv4Gateway: string | null;
  defaultIpv4Metric: number | null;
  existingDefaultRoutes: RouteEntry[];
  dnsServers: Record<string, string[]>; // adapterName -> dnsList
  activeVpnAdaptersFound: string[];
  restorationStatus: "PENDING" | "RESTORED" | "NOT_REQUIRED";
}

export interface EngineDiagnostics {
  engineStatus: NetworkEngineStatus;
  engineVersion: string | null;
  engineBinaryFound: boolean;
  engineBinaryPath: string | null;
  wintunDriverFound: boolean;
  wintunDriverPath: string | null;
  configValid: boolean;
  configValidationMessage: string | null;
  activeTunAdapterName: string | null;
  routeLoopProtectionVerified: boolean;
  unsupportedUdpPolicy: "BLOCK" | "REJECT" | "DROP";
  ipv6LeakProtectionActive: boolean;
  lastError: string | null;
  processPid: number | null;
}

/**
 * Sing-box 1.14+ Typed Configuration Schema
 */
export interface SingBoxLogConfig {
  disabled?: boolean;
  level: "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "panic";
  output?: string;
  timestamp?: boolean;
}

export interface SingBoxDnsServerConfig {
  tag: string;
  type: "tcp" | "udp" | "local" | "fakeip" | "https" | "tls";
  server?: string;
  server_port?: number;
  detour?: string;
}

export interface SingBoxDnsConfig {
  servers: SingBoxDnsServerConfig[];
  strategy?: "prefer_ipv4" | "ipv4_only";
}

export interface SingBoxTunInbound {
  type: "tun";
  tag: string;
  interface_name: string;
  address: string[];
  mtu?: number;
  auto_route: boolean;
  strict_route: boolean;
  stack: "mixed" | "gvisor" | "system";
  endpoint_independent_nat?: boolean;
}

export interface SingBoxSocksOutbound {
  type: "socks";
  tag: string;
  server: string;
  server_port: number;
  version: "5";
}

export interface SingBoxDirectOutbound {
  type: "direct";
  tag: string;
}

export interface SingBoxBlockOutbound {
  type: "block";
  tag: string;
}

export interface SingBoxRouteRule {
  action?: "sniff" | "resolve" | "route";
  ip_cidr?: string[];
  ip_is_private?: boolean;
  process_name?: string[];
  protocol?: string[];
  network?: "tcp" | "udp";
  port?: number[];
  ip_version?: 4 | 6;
  inbound?: string[];
  outbound?: string;
}

export interface SingBoxRouteConfig {
  rules: SingBoxRouteRule[];
  auto_detect_interface?: boolean;
  default_domain_resolver?: string;
}

export interface SingBoxConfigSchema {
  log?: SingBoxLogConfig;
  dns?: SingBoxDnsConfig;
  inbounds: (SingBoxTunInbound | Record<string, unknown>)[];
  outbounds: (SingBoxSocksOutbound | SingBoxDirectOutbound | SingBoxBlockOutbound | Record<string, unknown>)[];
  route: SingBoxRouteConfig;
}
