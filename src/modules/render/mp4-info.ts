import type { VideoMedia } from "./formats";

/**
 * Duration and picture size of an MP4 or MOV file, read from its header boxes ("moov": "mvhd" for the
 * duration, the video track's "tkhd" for the size) without decoding anything. Used when the browser
 * cannot play the codec (HEVC, or H.264 in browsers without it). `read(offset, length)` returns bytes.
 */
export async function readMp4Media(read: (offset: number, length: number) => Promise<Uint8Array>, size: number): Promise<VideoMedia | null> {
  let offset = 0;
  // Top-level boxes: ftyp, mdat, moov… The moov box may be after the media data.
  for (let i = 0; i < 64 && offset + 8 <= size; i++) {
    const head = await read(offset, 16);
    if (head.length < 8) return null;
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
    let boxSize = view.getUint32(0);
    const type = String.fromCharCode(head[4], head[5], head[6], head[7]);
    let headerSize = 8;
    if (boxSize === 1) {
      if (head.length < 16) return null;
      boxSize = Number(view.getBigUint64(8));
      headerSize = 16;
    } else if (boxSize === 0) {
      boxSize = size - offset;
    }
    if (boxSize < headerSize) return null;
    if (type === "moov") {
      if (boxSize > 50 * 1024 * 1024) return null;
      return parseMoov(await read(offset + headerSize, boxSize - headerSize));
    }
    offset += boxSize;
  }
  return null;
}

type Box = { type: string; start: number; end: number };

function children(data: Uint8Array, start: number, end: number): Box[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const boxes: Box[] = [];
  let at = start;
  while (at + 8 <= end) {
    const size = view.getUint32(at);
    const type = String.fromCharCode(data[at + 4], data[at + 5], data[at + 6], data[at + 7]);
    if (size < 8 || at + size > end) break;
    boxes.push({ type, start: at + 8, end: at + size });
    at += size;
  }
  return boxes;
}

function parseMoov(moov: Uint8Array): VideoMedia | null {
  const view = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
  const top = children(moov, 0, moov.length);
  const mvhd = top.find((b) => b.type === "mvhd");
  if (!mvhd) return null;
  const version = moov[mvhd.start];
  const timescale = version === 1 ? view.getUint32(mvhd.start + 20) : view.getUint32(mvhd.start + 12);
  const units = version === 1 ? Number(view.getBigUint64(mvhd.start + 24)) : view.getUint32(mvhd.start + 16);
  if (!timescale) return null;
  let width = 0;
  let height = 0;
  for (const trak of top.filter((b) => b.type === "trak")) {
    const parts = children(moov, trak.start, trak.end);
    const mdia = parts.find((b) => b.type === "mdia");
    const hdlr = mdia ? children(moov, mdia.start, mdia.end).find((b) => b.type === "hdlr") : null;
    const handler = hdlr ? String.fromCharCode(moov[hdlr.start + 8], moov[hdlr.start + 9], moov[hdlr.start + 10], moov[hdlr.start + 11]) : "";
    const tkhd = parts.find((b) => b.type === "tkhd");
    if (handler === "vide" && tkhd && tkhd.end - tkhd.start >= 84) {
      // Width and height are the last two 16.16 fixed-point numbers of the track header.
      width = Math.round(view.getUint32(tkhd.end - 8) / 65536);
      height = Math.round(view.getUint32(tkhd.end - 4) / 65536);
      break;
    }
  }
  return { duration: Math.round((units / timescale) * 100) / 100, width, height };
}
