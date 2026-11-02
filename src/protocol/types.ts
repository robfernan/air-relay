/**
 * QRJump Optical Protocol Types
 */

export interface InitFrame {
  t: 'INIT';
  id: string;      // Unique transfer session ID
  name: string;    // Original file name
  size: number;    // Uncompressed byte size
  compSize: number;// Compressed byte size
  total: number;   // Total data chunks count
  win: number;     // Window batch size (e.g. 10 frames)
  mime: string;    // MIME type
  crc: number;     // CRC32 of compressed payload
}

export interface DataFrame {
  t: 'DATA';
  id: string;      // Transfer session ID
  idx: number;     // Chunk sequence index (0-based)
  data: string;    // Base64 chunk of compressed data
  crc: number;     // CRC32 of this chunk's base64 or binary data
}

export interface AckFrame {
  t: 'ACK';
  id: string;      // Transfer session ID
  got: number[];   // Indices successfully received in current window
  missing: number[]; // Indices missed in current window
  next: number;    // Next expected continuous chunk index
}

export interface FinFrame {
  t: 'FIN';
  id: string;      // Transfer session ID
  status: 'COMPLETE';
}

export type ProtocolFrame = InitFrame | DataFrame | AckFrame | FinFrame;

export type TransferMode = 'HALF_DUPLEX' | 'SPLIT_DUPLEX';

export type TransferRole = 'IDLE' | 'SENDER' | 'RECEIVER';

export interface ReceiverStats {
  receivedCount: number;
  totalCount: number;
  startTime: number | null;
  endTime: number | null;
  bytesReceived: number;
  speedKBps: number;
}
