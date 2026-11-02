import { deflateSync } from 'fflate';
import { crc32, uint8ArrayToBase64 } from './crc32';
import type { DataFrame, InitFrame } from './types';

// Chunk size 220-250 bytes produces large, chunky QR pixels (Version 7-9)
// easily readable by budget laptop webcams, Moondrop MIAD01, and smartphones.
export const DEFAULT_CHUNK_SIZE = 240;
export const DEFAULT_WINDOW_SIZE = 8;

export interface PreparedTransfer {
  initFrame: InitFrame;
  dataFrames: DataFrame[];
  totalChunks: number;
  compressedSize: number;
  originalSize: number;
}

export function prepareFileForTransfer(
  file: File,
  fileBytes: Uint8Array,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
  winSize: number = DEFAULT_WINDOW_SIZE
): PreparedTransfer {
  // 1. Compress file bytes using fflate (Deflate level 6)
  const compressed = deflateSync(fileBytes, { level: 6 });
  const compCrc = crc32(compressed);

  // Generate a random 6-character transfer session ID
  const transferId = Math.random().toString(36).substring(2, 8).toUpperCase();

  // 2. Split compressed buffer into discrete chunks
  const totalChunks = Math.ceil(compressed.length / chunkSize);
  const dataFrames: DataFrame[] = [];

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, compressed.length);
    const chunkBytes = compressed.subarray(start, end);
    const base64Data = uint8ArrayToBase64(chunkBytes);
    const chunkCrc = crc32(chunkBytes);

    dataFrames.push({
      t: 'DATA',
      id: transferId,
      idx: i,
      data: base64Data,
      crc: chunkCrc,
    });
  }

  const initFrame: InitFrame = {
    t: 'INIT',
    id: transferId,
    name: file.name,
    size: file.size,
    compSize: compressed.length,
    total: totalChunks,
    win: winSize,
    mime: file.type || 'application/octet-stream',
    crc: compCrc,
  };

  return {
    initFrame,
    dataFrames,
    totalChunks,
    compressedSize: compressed.length,
    originalSize: file.size,
  };
}
