const profiles = Object.freeze({
  received: Object.freeze({ maxBytes: 2 * 1024 * 1024, maxDimension: 4096, maxPixels: 4e6 }),
  outgoing: Object.freeze({ maxBytes: 25 * 1024 * 1024, maxDimension: 8192, maxPixels: 16e6 }),
  preview: Object.freeze({ maxBytes: 8 * 1024 * 1024, maxDimension: 8192, maxPixels: 16e6 })
});
const TYPES = /* @__PURE__ */ new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
function validateNativeComposeRaster(bytes, type, profile) {
  return inspectNativeComposeRaster(bytes, type, profile) !== null;
}
function inspectNativeComposeRaster(bytes, type, profile) {
  if (profile !== "received" && profile !== "outgoing" && profile !== "preview") return null;
  const selected = profiles[profile];
  if (!selected) return null;
  const { maxBytes, maxDimension, maxPixels } = selected;
  if (!(bytes instanceof Uint8Array) || bytes.length < 12 || bytes.length > maxBytes || !TYPES.has(type)) return null;
  const starts = (...values) => values.every((value, index) => bytes[index] === value);
  const bounded = (width, height) => width > 0 && height > 0 && width <= maxDimension && height <= maxDimension && width * height <= maxPixels;
  const info = (width, height, pixels = width * height) => bounded(width, height) ? Object.freeze({ width, height, pixels }) : null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (type === "image/png") {
    if (!(bytes.length >= 33 && starts(137, 80, 78, 71, 13, 10, 26, 10) && [73, 72, 68, 82].every((value, index) => bytes[index + 12] === value) && bounded(view.getUint32(16), view.getUint32(20)))) return null;
    for (let offset = 8; offset + 12 <= bytes.length; ) {
      const length = view.getUint32(offset);
      if (offset + 12 + length > bytes.length) return null;
      if (String.fromCharCode(...bytes.slice(offset + 4, offset + 8)) === "acTL") return null;
      offset += 12 + length;
    }
    return info(view.getUint32(16), view.getUint32(20));
  }
  if (type === "image/gif") {
    if (!(bytes.length >= 14 && starts(71, 73, 70, 56) && [55, 57].includes(bytes[4]) && bytes[5] === 97 && bounded(view.getUint16(6, true), view.getUint16(8, true)))) return null;
    let offset = 13 + (bytes[10] & 128 ? 3 * 2 ** ((bytes[10] & 7) + 1) : 0), frames = 0, pixels = 0;
    const blocks = () => {
      while (offset < bytes.length) {
        const length = bytes[offset++];
        if (!length) return true;
        if (offset + length > bytes.length) return false;
        offset += length;
      }
      return false;
    };
    while (offset < bytes.length) {
      const kind = bytes[offset++];
      if (kind === 59) {
        const width2 = view.getUint16(6, true), height2 = view.getUint16(8, true);
        return frames > 0 ? info(width2, height2, Math.max(width2 * height2, pixels)) : null;
      }
      if (kind === 33) {
        if (offset >= bytes.length) return null;
        offset++;
        if (!blocks()) return null;
        continue;
      }
      if (kind !== 44 || offset + 9 >= bytes.length) return null;
      const width = view.getUint16(offset + 4, true), height = view.getUint16(offset + 6, true);
      if (!bounded(width, height) || ++frames > 32 || (pixels += width * height) > 16e6) return null;
      const packed = bytes[offset + 8];
      offset += 9 + (packed & 128 ? 3 * 2 ** ((packed & 7) + 1) : 0);
      if (offset >= bytes.length) return null;
      offset++;
      if (!blocks()) return null;
    }
    return null;
  }
  if (type === "image/jpeg") {
    if (!starts(255, 216, 255)) return null;
    for (let offset = 2; offset + 8 < bytes.length; ) {
      if (bytes[offset] !== 255) return null;
      const marker = bytes[offset + 1];
      if (marker === 255) {
        offset++;
        continue;
      }
      if (marker === 216 || marker === 1 || marker >= 208 && marker <= 215) {
        offset += 2;
        continue;
      }
      if (marker === 217 || marker === 218) return null;
      const length = view.getUint16(offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) return null;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) return length >= 8 ? info(view.getUint16(offset + 7), view.getUint16(offset + 5)) : null;
      offset += 2 + length;
    }
    return null;
  }
  if (!(starts(82, 73, 70, 70) && [87, 69, 66, 80].every((value, index) => bytes[index + 8] === value))) return null;
  const chunk = String.fromCharCode(...bytes.slice(12, 16));
  if (chunk === "VP8X" && bytes.length >= 30) {
    if (bytes[20] & 2) return null;
    return info(1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16));
  }
  if (chunk === "VP8 " && bytes.length >= 30 && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) return info(view.getUint16(26, true) & 16383, view.getUint16(28, true) & 16383);
  if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 47) return info(1 + bytes[21] + ((bytes[22] & 63) << 8), 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 15) << 10));
  return null;
}
export {
  inspectNativeComposeRaster,
  validateNativeComposeRaster
};
