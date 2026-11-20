import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

function crc32(buf) {
  let table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const combined = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(combined), 0);
  return Buffer.concat([lenBuf, combined, crcBuf]);
}

function createPng(width, height, pixelFn) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // 8 bits per channel
  ihdrData[9] = 6; // RGBA
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const ihdr = createChunk("IHDR", ihdrData);

  const rawScanlines = Buffer.alloc(height * (1 + width * 4));
  let offset = 0;
  for (let y = 0; y < height; y++) {
    rawScanlines[offset++] = 0; // Filter: None
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelFn(x, y, width, height);
      rawScanlines[offset++] = r;
      rawScanlines[offset++] = g;
      rawScanlines[offset++] = b;
      rawScanlines[offset++] = a;
    }
  }

  const compressed = zlib.deflateSync(rawScanlines);
  const idat = createChunk("IDAT", compressed);
  const iend = createChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([sig, ihdr, idat, iend]);
}

const assetsDir = path.resolve("windows-client/assets");
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

// 1. Disconnected Icon (Blue/Slate shield with lock/tether outline)
const disconnectedPng = createPng(32, 32, (x, y, w, h) => {
  const cx = w / 2;
  const cy = h / 2;
  const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
  
  // Background circle
  if (dist > 14) return [0, 0, 0, 0];
  if (dist > 13) return [71, 85, 105, 180]; // Border
  
  // Shield shape inside
  const normX = Math.abs(x - cx);
  const normY = y;
  if (normY < 8 || normY > 24) return [30, 41, 59, 255];
  if (normX > 9) return [30, 41, 59, 255];
  
  // Inner blue accent
  if (normX <= 6 && normY >= 11 && normY <= 20) {
    return [59, 130, 246, 255]; // Vibrant blue
  }
  return [51, 65, 85, 255];
});

// 2. Connected Icon (Vibrant Emerald Green shield/checkmark)
const connectedPng = createPng(32, 32, (x, y, w, h) => {
  const cx = w / 2;
  const cy = h / 2;
  const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
  
  if (dist > 14) return [0, 0, 0, 0];
  if (dist > 13) return [5, 150, 105, 200];
  
  // Checkmark shape in center
  const isCheck = (x === 10 && y === 16) ||
                  (x === 11 && (y === 16 || y === 17)) ||
                  (x === 12 && (y === 17 || y === 18)) ||
                  (x === 13 && (y === 18 || y === 19)) ||
                  (x === 14 && (y === 19 || y === 20)) ||
                  (x === 15 && (y === 18 || y === 19)) ||
                  (x === 16 && (y === 17 || y === 18)) ||
                  (x === 17 && (y === 16 || y === 17)) ||
                  (x === 18 && (y === 15 || y === 16)) ||
                  (x === 19 && (y === 14 || y === 15)) ||
                  (x === 20 && (y === 13 || y === 14)) ||
                  (x === 21 && (y === 12 || y === 13)) ||
                  (x === 22 && (y === 11 || y === 12));

  if (isCheck) return [255, 255, 255, 255];
  return [16, 185, 129, 255]; // Green #10b981
});

// 3. Connecting / Recovering Icon (Amber / Orange Ring)
const connectingPng = createPng(32, 32, (x, y, w, h) => {
  const cx = w / 2;
  const cy = h / 2;
  const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
  
  if (dist > 14) return [0, 0, 0, 0];
  if (dist > 13) return [217, 119, 6, 200];
  
  // Ring shape
  if (dist >= 7 && dist <= 12) {
    return [245, 158, 11, 255]; // Amber
  }
  if (dist < 4) {
    return [251, 191, 36, 255]; // Inner bright dot
  }
  return [30, 41, 59, 240];
});

// 4. Error Icon (Crimson / Red Warning)
const errorPng = createPng(32, 32, (x, y, w, h) => {
  const cx = w / 2;
  const cy = h / 2;
  const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
  
  if (dist > 14) return [0, 0, 0, 0];
  if (dist > 13) return [185, 28, 28, 200];
  
  // Exclamation mark in center
  if (x >= 14 && x <= 17 && y >= 8 && y <= 17) {
    return [255, 255, 255, 255]; // Upper stroke
  }
  if (x >= 14 && x <= 17 && y >= 20 && y <= 23) {
    return [255, 255, 255, 255]; // Dot
  }
  return [239, 68, 68, 255]; // Red #ef4444
});

fs.writeFileSync(path.join(assetsDir, "tray-disconnected.png"), disconnectedPng);
fs.writeFileSync(path.join(assetsDir, "tray-connected.png"), connectedPng);
fs.writeFileSync(path.join(assetsDir, "tray-connecting.png"), connectingPng);
fs.writeFileSync(path.join(assetsDir, "tray-error.png"), errorPng);

console.log("Successfully generated all tray icons in windows-client/assets/");
