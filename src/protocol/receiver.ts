import { inflateSync } from 'fflate';
import { base64ToUint8Array, crc32 } from './crc32';
import type { DataFrame, InitFrame } from './types';

export class ReceiverEngine {
  public initFrame: InitFrame | null = null;
  public chunks: Map<number, Uint8Array> = new Map();
  public startTime: number | null = null;
  public endTime: number | null = null;
  public totalBytesReceived: number = 0;

  public reset() {
    this.initFrame = null;
    this.chunks.clear();
    this.startTime = null;
    this.endTime = null;
    this.totalBytesReceived = 0;
  }

  public handleInit(frame: InitFrame): boolean {
    if (!this.initFrame || this.initFrame.id !== frame.id) {
      this.initFrame = frame;
      this.chunks.clear();
      this.startTime = Date.now();
      this.endTime = null;
      this.totalBytesReceived = 0;
      return true;
    }
    return false;
  }

  public handleData(frame: DataFrame): { accepted: boolean; isNew: boolean } {
    if (!this.initFrame || this.initFrame.id !== frame.id) {
      return { accepted: false, isNew: false };
    }

    if (!this.startTime) {
      this.startTime = Date.now();
    }

    if (this.chunks.has(frame.idx)) {
      return { accepted: true, isNew: false };
    }

    // Convert Base64 back to Uint8Array
    const chunkBytes = base64ToUint8Array(frame.data);

    // Verify CRC32 checksum of chunk
    const calculatedCrc = crc32(chunkBytes);
    if (calculatedCrc !== frame.crc) {
      console.warn(`[ReceiverEngine] CRC mismatch for chunk #${frame.idx}`);
      return { accepted: false, isNew: false };
    }

    this.chunks.set(frame.idx, chunkBytes);
    this.totalBytesReceived += chunkBytes.length;
    return { accepted: true, isNew: true };
  }

  public isComplete(): boolean {
    if (!this.initFrame) return false;
    return this.chunks.size === this.initFrame.total;
  }

  /**
   * Generates ACK payload according to protocol spec
   */
  public generateAck(): { got: number[]; missing: number[]; next: number } | null {
    if (!this.initFrame) return null;

    const total = this.initFrame.total;
    const win = this.initFrame.win;

    // Find the contiguous acknowledged streak from 0
    let nextContiguous = 0;
    while (nextContiguous < total && this.chunks.has(nextContiguous)) {
      nextContiguous++;
    }

    // Current window windowStart to windowEnd
    const windowStart = nextContiguous;
    const windowEnd = Math.min(windowStart + win, total);

    const got: number[] = [];
    const missing: number[] = [];

    for (let i = windowStart; i < windowEnd; i++) {
      if (this.chunks.has(i)) {
        got.push(i);
      } else {
        missing.push(i);
      }
    }

    return {
      got,
      missing,
      next: nextContiguous,
    };
  }

  /**
   * Reassembles chunks, verifies full file CRC32, and decompresses via fflate
   */
  public assembleAndDecompress(): { blob: Blob; fileName: string; isValid: boolean } {
    if (!this.initFrame) {
      throw new Error('Transfer init metadata missing');
    }

    if (!this.isComplete()) {
      throw new Error(`Incomplete chunks: received ${this.chunks.size} of ${this.initFrame.total}`);
    }

    this.endTime = Date.now();

    // 1. Concatenate all chunk Uint8Arrays in sequential index order
    const totalCompressedLen = this.initFrame.compSize;
    const concatenated = new Uint8Array(totalCompressedLen);
    let offset = 0;

    for (let i = 0; i < this.initFrame.total; i++) {
      const chunk = this.chunks.get(i);
      if (!chunk) {
        throw new Error(`Missing expected chunk #${i}`);
      }
      concatenated.set(chunk, offset);
      offset += chunk.length;
    }

    // 2. Validate payload CRC32
    const calculatedCompCrc = crc32(concatenated);
    if (calculatedCompCrc !== this.initFrame.crc) {
      console.warn(`Compressed payload CRC mismatch: expected ${this.initFrame.crc}, got ${calculatedCompCrc}`);
    }

    // 3. Decompress in-memory with fflate
    const decompressed = inflateSync(concatenated);

    // 4. Create downloadable Blob with original MIME type
    const blob = new Blob([decompressed], { type: this.initFrame.mime });

    return {
      blob,
      fileName: this.initFrame.name,
      isValid: calculatedCompCrc === this.initFrame.crc,
    };
  }

  public getSpeedKBps(): number {
    if (!this.startTime) return 0;
    const end = this.endTime || Date.now();
    const durationSec = Math.max(0.1, (end - this.startTime) / 1000);
    return Math.round((this.totalBytesReceived / 1024 / durationSec) * 10) / 10;
  }
}
