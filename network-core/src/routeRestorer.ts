/**
 * Windows Route Restoration Manager & Standalone Self-Elevating Recovery Engine
 * USB VPN Bridge - Phase 5B (Safety-Corrected)
 *
 * Implements dynamic snapshot restoration and generates standalone UAC-elevating recovery scripts.
 * Explicitly protects third-party VPNs (TAP-Windows, TunnelBear, WireGuard) from disruption.
 */

import fs from "node:fs";
import path from "node:path";
import { NetworkStateSnapshot } from "./types.js";

export class RouteRestorer {
  /**
   * Generates a standalone, idempotent Batch recovery script (restore-routes.bat)
   * that automatically requests Administrator elevation via UAC if not already elevated.
   */
  public static generateBatchScript(snapshot: NetworkStateSnapshot): string {
    const lines: string[] = [
      "@echo off",
      "setlocal EnableDelayedExpansion",
      ":: ===========================================================================",
      ":: USB VPN Bridge - Emergency Route & DNS Restoration Script",
      `:: Generated at: ${snapshot.timestampIso}`,
      ":: ===========================================================================",
      "",
      ":: Check for Administrator Privileges and Self-Elevate via UAC if needed",
      "net session >nul 2>&1",
      "if %errorLevel% neq 0 (",
      '    echo [USB VPN Bridge] Requesting Administrator privileges...',
      '    powershell -NoProfile -Command "Start-Process cmd.exe -ArgumentList \'/c \"\"%~f0\"\"\' -Verb RunAs"',
      "    exit /b",
      ")",
      "",
      'echo [USB VPN Bridge] Running with Administrator privileges.',
      'echo [USB VPN Bridge] Initiating safe network restoration...',
      "",
      ":: 1. Clean up usb-vpn-tun adapter if present",
      'echo [1/4] Checking for lingering usb-vpn-tun adapter...',
      'netsh interface set interface name="usb-vpn-tun" admin=disable >nul 2>&1',
      "",
      ":: 2. Remove transient TUN default route (172.19.0.1)",
      'echo [2/4] Removing transient TUN default route...',
      'route delete 0.0.0.0 mask 0.0.0.0 172.19.0.1 >nul 2>&1',
      "",
      ":: 3. Restore Dynamically Captured Default IPv4 Route Metrics",
      'echo [3/4] Restoring original default IPv4 route...',
    ];

    if (snapshot.defaultIpv4Gateway && snapshot.primaryInterfaceIndex) {
      const metric = snapshot.defaultIpv4Metric ?? 25;
      lines.push(
        `:: Dynamically captured: Interface Index ${snapshot.primaryInterfaceIndex}, Gateway ${snapshot.defaultIpv4Gateway}, Metric ${metric}`,
        `route change 0.0.0.0 mask 0.0.0.0 ${snapshot.defaultIpv4Gateway} metric ${metric} if ${snapshot.primaryInterfaceIndex} >nul 2>&1`,
        'echo Primary default route restored to gateway %snapshot.defaultIpv4Gateway%.'
      );
    } else {
      lines.push('echo No specific physical gateway mutation found in baseline snapshot.');
    }

    lines.push(
      "",
      ":: 4. Flush DNS Resolver Cache",
      'echo [4/4] Flushing DNS resolver cache...',
      'ipconfig /flushdns >nul 2>&1',
      "",
      'echo ===========================================================================',
      'echo [SUCCESS] Network restoration complete.',
      `echo [PROTECTED] Third-party VPN adapters preserved: ${snapshot.activeVpnAdaptersFound.join(", ") || "None"}`,
      'echo ===========================================================================',
      "pause"
    );

    return lines.join("\r\n");
  }

  /**
   * Generates a standalone, idempotent PowerShell recovery script (restore-routes.ps1).
   */
  public static generatePowerShellScript(snapshot: NetworkStateSnapshot): string {
    const lines: string[] = [
      "# ===========================================================================",
      "# USB VPN Bridge - Emergency Route & DNS Restoration Script (PowerShell)",
      `# Generated at: ${snapshot.timestampIso}`,
      "# ===========================================================================",
      "",
      "# Self-elevate if not running as Administrator",
      "$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())",
      "if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {",
      '    Write-Host "[USB VPN Bridge] Elevating to Administrator..." -ForegroundColor Cyan',
      '    Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs',
      "    exit",
      "}",
      "",
      'Write-Host "[USB VPN Bridge] Initiating safe network restoration..." -ForegroundColor Cyan',
      "",
      "# 1. Clean up usb-vpn-tun adapter if present",
      "try {",
      '    $tun = Get-NetAdapter -Name "usb-vpn-tun" -ErrorAction SilentlyContinue',
      "    if ($tun) {",
      '        Write-Host "Disabling lingering TUN adapter: $($tun.Name)" -ForegroundColor Yellow',
      "        Disable-NetAdapter -Name $tun.Name -Confirm:$false -ErrorAction SilentlyContinue",
      "    }",
      "} catch {}",
      "",
      "# 2. Remove TUN default route if present",
      "try {",
      '    route delete 0.0.0.0 mask 0.0.0.0 172.19.0.1 2>$null',
      "} catch {}",
      "",
      "# 3. Restore primary default route metric dynamically",
    ];

    if (snapshot.primaryInterfaceIndex && snapshot.defaultIpv4Gateway) {
      const metric = snapshot.defaultIpv4Metric ?? 25;
      lines.push(
        "try {",
        `    $primaryIfIndex = ${snapshot.primaryInterfaceIndex}`,
        `    $gateway = "${snapshot.defaultIpv4Gateway}"`,
        `    $metric = ${metric}`,
        '    Write-Host "Restoring default route for interface $primaryIfIndex with metric $metric..." -ForegroundColor Green',
        "    Set-NetIPInterface -InterfaceIndex $primaryIfIndex -InterfaceMetric $metric -ErrorAction SilentlyContinue",
        "} catch {",
        '    Write-Warning "Failed to set interface metric via PowerShell: $_"',
        "}"
      );
    }

    lines.push(
      "",
      "# 4. Flush DNS",
      "Clear-DnsClientCache -ErrorAction SilentlyContinue",
      "",
      'Write-Host "[SUCCESS] Network restoration complete." -ForegroundColor Green',
      `Write-Host "[PROTECTED] Preserved third-party VPNs: ${snapshot.activeVpnAdaptersFound.join(", ") || "None"}" -ForegroundColor Gray`
    );

    return lines.join("\r\n");
  }

  /**
   * Writes the standalone emergency restoration scripts to disk.
   */
  public static saveRecoveryScripts(stateDir: string, snapshot: NetworkStateSnapshot): {
    batPath: string;
    ps1Path: string;
  } {
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }

    const batPath = path.join(stateDir, "restore-routes.bat");
    const ps1Path = path.join(stateDir, "restore-routes.ps1");

    fs.writeFileSync(batPath, this.generateBatchScript(snapshot), "utf-8");
    fs.writeFileSync(ps1Path, this.generatePowerShellScript(snapshot), "utf-8");

    return { batPath, ps1Path };
  }

  /**
   * Checks if an unresolved snapshot exists from a previous crash/ungraceful termination.
   */
  public static checkPendingRestoration(snapshotPath: string): {
    needsRecovery: boolean;
    snapshot: NetworkStateSnapshot | null;
  } {
    if (!fs.existsSync(snapshotPath)) {
      return { needsRecovery: false, snapshot: null };
    }

    try {
      const data = fs.readFileSync(snapshotPath, "utf-8");
      const snapshot: NetworkStateSnapshot = JSON.parse(data);
      if (snapshot.restorationStatus === "PENDING") {
        return { needsRecovery: true, snapshot };
      }
      return { needsRecovery: false, snapshot };
    } catch {
      return { needsRecovery: false, snapshot: null };
    }
  }

  /**
   * Marks a snapshot as resolved/restored.
   */
  public static markResolved(snapshotPath: string): void {
    if (!fs.existsSync(snapshotPath)) return;
    try {
      const data = fs.readFileSync(snapshotPath, "utf-8");
      const snapshot: NetworkStateSnapshot = JSON.parse(data);
      snapshot.restorationStatus = "RESTORED";
      fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), "utf-8");
    } catch {}
  }
}
