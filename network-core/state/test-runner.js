const path = require('path');
const fs = require('fs');

async function test() {
    const lines = [];
    const asarDist = path.join(process.resourcesPath, 'app.asar', 'dist-electron');
    const { AdbManager } = require(path.join(asarDist, 'adbManager.js'));
    const { ControlClient } = require(path.join(asarDist, 'controlClient.js'));
    const { ConnectionOrchestrator } = require(path.join(asarDist, 'orchestrator.js'));
    
    lines.push('AdbManager loaded: true');
    const adb = new AdbManager();
    lines.push('Adb path: ' + adb.getResolvedAdbPath());
    
    try {
        const devices = await adb.getDevices();
        lines.push('Devices: ' + JSON.stringify(devices));
    } catch (e) {
        lines.push('ADB devices err: ' + e.message);
    }
    
    fs.writeFileSync(path.resolve('G:/Project VPN/network-core/state/packaged-test.log'), lines.join('\n'));
}

test().catch(e => {
    fs.writeFileSync(path.resolve('G:/Project VPN/network-core/state/packaged-test.log'), 'FATAL: ' + e.stack);
});