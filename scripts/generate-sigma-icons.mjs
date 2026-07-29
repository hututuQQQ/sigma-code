#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import * as zlib from "node:zlib";

const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(repoRoot, "assets", "sigma-code-mark.png");
const checkOnly = process.argv.includes("--check");

const crcTable = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row += 1) {
    rgba.copy(raw, row * (stride + 1) + 1, row * stride, (row + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function paeth(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  return upDistance <= upperLeftDistance ? up : upperLeft;
}

function decodePng(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!buffer.subarray(0, 8).equals(signature)) {
    throw new Error("Sigma brand source is not a PNG.");
  }

  let offset = 8;
  let width;
  let height;
  let bitDepth;
  let colorType;
  let interlace;
  const compressed = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      compressed.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += length + 12;
  }

  if (
    width === undefined ||
    height === undefined ||
    bitDepth !== 8 ||
    (colorType !== 2 && colorType !== 6) ||
    interlace !== 0
  ) {
    throw new Error("Sigma brand source must be a non-interlaced 8-bit RGB or RGBA PNG.");
  }

  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const filtered = zlib.inflateSync(Buffer.concat(compressed));
  const pixels = Buffer.alloc(stride * height);
  let inputOffset = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = filtered[inputOffset];
    inputOffset += 1;
    for (let column = 0; column < stride; column += 1) {
      const source = filtered[inputOffset + column];
      const left = column >= channels ? pixels[row * stride + column - channels] : 0;
      const up = row > 0 ? pixels[(row - 1) * stride + column] : 0;
      const upperLeft =
        row > 0 && column >= channels ? pixels[(row - 1) * stride + column - channels] : 0;
      const value =
        filter === 0
          ? source
          : filter === 1
            ? source + left
            : filter === 2
              ? source + up
              : filter === 3
                ? source + Math.floor((left + up) / 2)
                : filter === 4
                  ? source + paeth(left, up, upperLeft)
                  : Number.NaN;
      if (!Number.isFinite(value)) throw new Error(`Unsupported PNG filter ${filter}.`);
      pixels[row * stride + column] = value & 0xff;
    }
    inputOffset += stride;
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    rgba[index * 4] = pixels[index * channels];
    rgba[index * 4 + 1] = pixels[index * channels + 1];
    rgba[index * 4 + 2] = pixels[index * channels + 2];
    rgba[index * 4 + 3] = channels === 4 ? pixels[index * channels + 3] : 255;
  }
  return { width, height, rgba };
}

function resizeRgba(source, targetWidth, targetHeight) {
  const output = Buffer.alloc(targetWidth * targetHeight * 4);
  for (let targetY = 0; targetY < targetHeight; targetY += 1) {
    const sourceY = Math.max(
      0,
      Math.min(source.height - 1, ((targetY + 0.5) * source.height) / targetHeight - 0.5),
    );
    const top = Math.floor(sourceY);
    const bottom = Math.min(source.height - 1, top + 1);
    const vertical = sourceY - top;
    for (let targetX = 0; targetX < targetWidth; targetX += 1) {
      const sourceX = Math.max(
        0,
        Math.min(source.width - 1, ((targetX + 0.5) * source.width) / targetWidth - 0.5),
      );
      const left = Math.floor(sourceX);
      const right = Math.min(source.width - 1, left + 1);
      const horizontal = sourceX - left;
      for (let channel = 0; channel < 4; channel += 1) {
        const topLeft = source.rgba[(top * source.width + left) * 4 + channel];
        const topRight = source.rgba[(top * source.width + right) * 4 + channel];
        const bottomLeft = source.rgba[(bottom * source.width + left) * 4 + channel];
        const bottomRight = source.rgba[(bottom * source.width + right) * 4 + channel];
        const topValue = topLeft + (topRight - topLeft) * horizontal;
        const bottomValue = bottomLeft + (bottomRight - bottomLeft) * horizontal;
        output[(targetY * targetWidth + targetX) * 4 + channel] = Math.round(
          topValue + (bottomValue - topValue) * vertical,
        );
      }
    }
  }
  return output;
}

function transparentBrandMark(source, monochrome = false) {
  const output = Buffer.from(source.rgba);
  const background = [source.rgba[0], source.rgba[1], source.rgba[2]];
  for (let index = 0; index < source.width * source.height; index += 1) {
    const offset = index * 4;
    const distance = Math.max(
      Math.abs(output[offset] - background[0]),
      Math.abs(output[offset + 1] - background[1]),
      Math.abs(output[offset + 2] - background[2]),
    );
    output[offset + 3] = Math.max(0, Math.min(255, (distance - 2) * 12));
    if (monochrome) {
      output[offset] = 255;
      output[offset + 1] = 255;
      output[offset + 2] = 255;
    }
  }
  return { ...source, rgba: output };
}

function encodeIco(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let imageOffset = header.length;
  images.forEach(({ size, png }, index) => {
    const offset = 6 + index * 16;
    header[offset] = size === 256 ? 0 : size;
    header[offset + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, offset + 4);
    header.writeUInt16LE(32, offset + 6);
    header.writeUInt32LE(png.length, offset + 8);
    header.writeUInt32LE(imageOffset, offset + 12);
    imageOffset += png.length;
  });
  return Buffer.concat([header, ...images.map(({ png }) => png)]);
}

function encodeIcns(images) {
  const entries = images.map(({ type, png }) => {
    const header = Buffer.alloc(8);
    header.write(type, 0, "ascii");
    header.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([header, png]);
  });
  const header = Buffer.alloc(8);
  header.write("icns", 0, "ascii");
  header.writeUInt32BE(8 + entries.reduce((total, entry) => total + entry.length, 0), 4);
  return Buffer.concat([header, ...entries]);
}

const sourceBytes = fs.readFileSync(sourcePath);
const source = decodePng(sourceBytes);
const pngCache = new Map();
const png = (size) => {
  if (!pngCache.has(size)) {
    pngCache.set(size, encodePng(size, size, resizeRgba(source, size, size)));
  }
  return pngCache.get(size);
};

const generated = new Map();
const add = (relativePath, contents) => generated.set(relativePath, contents);

for (const relativePath of [
  "assets/prod/black-ios-1024.png",
  "assets/prod/black-macos-1024.png",
  "assets/prod/black-universal-1024.png",
  "assets/dev/blueprint-ios-1024.png",
  "assets/dev/blueprint-macos-1024.png",
  "assets/dev/blueprint-universal-1024.png",
  "assets/nightly/nightly-ios-1024.png",
  "assets/nightly/nightly-macos-1024.png",
  "assets/nightly/nightly-universal-1024.png",
]) {
  add(relativePath, png(1024));
}

for (const directory of ["assets/prod", "assets/dev", "assets/nightly"]) {
  const prefix = directory.endsWith("/prod")
    ? "t3-black"
    : directory.endsWith("/dev")
      ? "blueprint"
      : "nightly";
  add(`${directory}/${prefix}-web-apple-touch-180.png`, png(180));
  add(`${directory}/${prefix}-web-favicon-16x16.png`, png(16));
  add(`${directory}/${prefix}-web-favicon-32x32.png`, png(32));
  add(
    `${directory}/${prefix}-web-favicon.ico`,
    encodeIco([16, 32, 48, 64, 128, 256].map((size) => ({ size, png: png(size) }))),
  );
  const windowsName = directory.endsWith("/prod")
    ? "t3-black-windows.ico"
    : directory.endsWith("/dev")
      ? "blueprint-windows.ico"
      : "nightly-windows.ico";
  add(
    `${directory}/${windowsName}`,
    encodeIco([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: png(size) }))),
  );
  add(`${directory}/app-icon.icon/Assets/sigma-code-mark.png`, sourceBytes);
}

add("apps/desktop/resources/icon.png", png(1024));
add(
  "apps/desktop/resources/icon.ico",
  encodeIco([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: png(size) }))),
);
add(
  "apps/desktop/resources/icon.icns",
  encodeIcns(
    [
      ["icp4", 16],
      ["icp5", 32],
      ["icp6", 64],
      ["ic07", 128],
      ["ic08", 256],
      ["ic09", 512],
      ["ic10", 1024],
    ].map(([type, size]) => ({ type, png: png(size) })),
  ),
);
add("apps/web/public/apple-touch-icon.png", png(180));
add("apps/web/public/favicon-16x16.png", png(16));
add("apps/web/public/favicon-32x32.png", png(32));
add("apps/web/public/sigma-code-mark.png", sourceBytes);
add(
  "apps/web/public/favicon.ico",
  encodeIco([16, 32, 48, 64, 128, 256].map((size) => ({ size, png: png(size) }))),
);

const transparent = transparentBrandMark(source);
const notification = transparentBrandMark(source, true);
add(
  "apps/mobile/assets/android-icon-mark.png",
  encodePng(1024, 1024, resizeRgba(transparent, 1024, 1024)),
);
add(
  "apps/mobile/assets/android-notification-icon.png",
  encodePng(96, 96, resizeRgba(notification, 96, 96)),
);
add("apps/mobile/assets/widget/SigmaMark.png", png(256));

const stale = [];
for (const [relativePath, contents] of generated) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (checkOnly) {
    if (!fs.existsSync(absolutePath) || !fs.readFileSync(absolutePath).equals(contents)) {
      stale.push(relativePath);
    }
  } else {
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, contents);
  }
}

if (stale.length > 0) {
  console.error(
    `Sigma Code icon assets are stale:\n${stale.map((item) => `- ${item}`).join("\n")}`,
  );
  process.exitCode = 1;
} else if (checkOnly) {
  console.log("Sigma Code icon assets are current.");
} else {
  console.log(`Generated ${generated.size} icon assets from assets/sigma-code-mark.png.`);
}
