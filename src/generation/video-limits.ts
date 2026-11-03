/** OpenRouter rejects a reference video outside this duration and width/height range. */
export const VIDEO_MAX_SECONDS = 30;
export const VIDEO_MIN_RATIO = 0.39;
export const VIDEO_MAX_RATIO = 2.5;

export type VideoMeasure = { duration: number; width: number; height: number };

/** Null when the clip is acceptable. The same sentences are shown by the client and the API. */
export function videoLimitMessage(input: VideoMeasure | null): string | null {
  if (
    !input ||
    !Number.isFinite(input.duration) ||
    input.duration <= 0 ||
    !Number.isFinite(input.width) ||
    !Number.isFinite(input.height) ||
    input.width <= 0 ||
    input.height <= 0
  ) {
    return "Video duration or dimensions could not be read";
  }
  if (input.duration > VIDEO_MAX_SECONDS) return "Video is longer than 30 seconds";
  const ratio = input.width / input.height;
  if (ratio < VIDEO_MIN_RATIO || ratio > VIDEO_MAX_RATIO) {
    return "Video aspect ratio must be between 0.39 and 2.50";
  }
  return null;
}

/** Movie duration from mvhd and display size from the largest tkhd. Null when either is missing. */
export function readMp4Limits(bytes: Uint8Array): VideoMeasure | null {
  let timescale = 0;
  let duration = 0;
  let width = 0;
  let height = 0;
  let area = 0;

  walkBoxes(bytes, 0, bytes.length, (type, start, end) => {
    if (type === "mvhd") {
      const movie = readMvhd(bytes, start, end);
      if (movie) {
        timescale = movie.timescale;
        duration = movie.duration;
      }
    }
    if (type === "tkhd") {
      const track = readTkhd(bytes, start, end);
      if (!track) return;
      const next = track.width * track.height;
      if (next > area) {
        area = next;
        width = track.width;
        height = track.height;
      }
    }
  });

  if (timescale <= 0 || duration <= 0 || width <= 0 || height <= 0) return null;
  return { duration: duration / timescale, width, height };
}

function walkBoxes(
  bytes: Uint8Array,
  from: number,
  to: number,
  visit: (type: string, start: number, end: number) => void,
): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = from;
  while (offset + 8 <= to) {
    let size = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > to) return;
      const large = view.getUint32(offset + 8) * 2 ** 32 + view.getUint32(offset + 12);
      if (!Number.isFinite(large) || large < 16) return;
      size = large;
      header = 16;
    } else if (size === 0) {
      size = to - offset;
    }
    if (size < header || offset + size > to) return;
    const start = offset + header;
    const end = offset + size;
    visit(type, start, end);
    if (type === "moov" || type === "trak") walkBoxes(bytes, start, end, visit);
    offset += size;
  }
}

function readMvhd(bytes: Uint8Array, start: number, end: number): { timescale: number; duration: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (start >= end) return null;
  const version = bytes[start];
  if (version === 0) {
    if (start + 20 > end) return null;
    return { timescale: view.getUint32(start + 12), duration: view.getUint32(start + 16) };
  }
  if (version === 1) {
    if (start + 32 > end) return null;
    const duration = view.getUint32(start + 24) * 2 ** 32 + view.getUint32(start + 28);
    return { timescale: view.getUint32(start + 20), duration };
  }
  return null;
}

function readTkhd(bytes: Uint8Array, start: number, end: number): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (start >= end) return null;
  const version = bytes[start];
  const at = version === 0 ? 76 : version === 1 ? 88 : -1;
  if (at < 0 || start + at + 8 > end) return null;
  const width = view.getUint32(start + at) / 65536;
  const height = view.getUint32(start + at + 4) / 65536;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}
