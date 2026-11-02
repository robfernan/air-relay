import { describe, it, expect } from 'bun:test';
import { crc32, uint8ArrayToBase64, base64ToUint8Array } from './crc32';
import { prepareFileForTransfer } from './sender';
import { ReceiverEngine } from './receiver';
import type { DataFrame } from './types';

describe('QRJump Protocol Verification', () => {
  it('should compute identical CRC32 checksums', () => {
    const text = 'Air-gapped optical transfer test string 12345';
    const bytes = new TextEncoder().encode(text);
    const crcText = crc32(text);
    const crcBytes = crc32(bytes);
    expect(crcText).toBe(crcBytes);
    expect(crcText).toBeGreaterThan(0);
  });

  it('should correctly encode and decode Base64 byte arrays', () => {
    const original = new Uint8Array([0, 255, 128, 64, 32, 16, 8, 4, 2, 1, 0]);
    const b64 = uint8ArrayToBase64(original);
    const decoded = base64ToUint8Array(b64);
    expect(decoded.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(decoded[i]).toBe(original[i]);
    }
  });

  it('should execute complete file transfer lifecycle with flow control ACK and reassembly', () => {
    // 1. Create pseudo-random data to prevent extreme deflate ratio
    const originalSize = 12 * 1024;
    const dummyBytes = new Uint8Array(originalSize);
    let seed = 1337;
    for (let i = 0; i < originalSize; i++) {
      seed = (seed * 16807 + 7) % 2147483647;
      dummyBytes[i] = seed & 0xff;
    }

    const dummyFile = new File([dummyBytes], 'secure-payload.bin', { type: 'application/octet-stream' });
    const chunkSize = 350;
    const winSize = 6;

    // 2. Sender prepares the file
    const prepared = prepareFileForTransfer(dummyFile, dummyBytes, chunkSize, winSize);
    expect(prepared.totalChunks).toBeGreaterThan(10);
    expect(prepared.dataFrames.length).toBe(prepared.totalChunks);

    // 3. Receiver initializes
    const receiver = new ReceiverEngine();
    const initAccepted = receiver.handleInit(prepared.initFrame);
    expect(initAccepted).toBe(true);

    // 4. Simulate transmission window by window with an out-of-order/dropped packet
    let windowStart = 0;
    let cycles = 0;

    while (!receiver.isComplete() && cycles < 100) {
      cycles++;
      const currentWindow = prepared.dataFrames.slice(windowStart, windowStart + winSize);

      // Simulate sending chunks in window (intentionally drop the 2nd chunk in first window to test ACK recovery)
      for (let i = 0; i < currentWindow.length; i++) {
        const frame = currentWindow[i];
        if (cycles === 1 && i === 1) {
          // Drop packet on purpose once
          continue;
        }
        receiver.handleData(frame);
      }

      // Receiver generates ACK
      const ack = receiver.generateAck();
      expect(ack).not.toBeNull();

      if (cycles === 1) {
        // We dropped packet #1, so missing should contain 1 and next should be 1
        expect(ack!.missing).toContain(1);
        expect(ack!.next).toBe(1);

        // Sender retransmits dropped frame #1
        const droppedFrame = prepared.dataFrames[1];
        const res = receiver.handleData(droppedFrame);
        expect(res.accepted).toBe(true);
      }

      // Re-generate ACK after recovery
      const nextAck = receiver.generateAck();
      windowStart = nextAck!.next;
    }

    expect(receiver.isComplete()).toBe(true);

    // 5. Assemble and verify decompress & CRC32
    const result = receiver.assembleAndDecompress();
    expect(result.fileName).toBe('secure-payload.bin');
    expect(result.isValid).toBe(true);
  });
});
