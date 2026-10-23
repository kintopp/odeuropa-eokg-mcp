// Pure JPEG header parsing (no I/O).

/**
 * Dimensions from a JPEG's frame header, or null if the bytes aren't a JPEG we
 * can read. Read from the bytes rather than assumed: the image server's copies
 * vary in size and bounding boxes are pixels in that copy's frame.
 */
export function jpegDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;
  if (buffer[0] !== 0xFF || buffer[1] !== 0xD8) return null;
  let i = 2;
  while (i + 1 < buffer.length) {
    if (buffer[i] !== 0xFF) { i += 1; continue; }
    const marker = buffer[i + 1];
    if (marker === 0xFF) { i += 1; continue; } // fill byte
    // Standalone markers carry no length field.
    if (marker === 0xD8 || marker === 0xD9 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
    if (i + 4 > buffer.length) return null;
    const length = buffer.readUInt16BE(i + 2);
    if (length < 2) return null;
    // SOF0–SOF15 carry the frame size; DHT/JPG/DAC sit in the same range and don't.
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      if (i + 9 > buffer.length) return null;
      return { width: buffer.readUInt16BE(i + 7), height: buffer.readUInt16BE(i + 5) };
    }
    i += 2 + length;
  }
  return null;
}
