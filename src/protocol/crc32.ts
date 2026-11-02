/**
 * Fast CRC32 Implementation (IEEE 802.3 standard)
 */

const CRC32_TABLE = new Uint32Array(256);

// Precompute CRC32 lookup table
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC32_TABLE[i] = c >>> 0;
}

export function crc32(data: Uint8Array | string): number {
  let c = 0xffffffff;
  
  if (typeof data === 'string') {
    for (let i = 0; i < data.length; i++) {
      const code = data.charCodeAt(i);
      if (code < 0x80) {
        c = (c >>> 8) ^ CRC32_TABLE[(c ^ code) & 0xff];
      } else if (code < 0x800) {
        c = (c >>> 8) ^ CRC32_TABLE[(c ^ (0xc0 | (code >> 6))) & 0xff];
        c = (c >>> 8) ^ CRC32_TABLE[(c ^ (0x80 | (code & 0x3f))) & 0xff];
      } else {
        c = (c >>> 8) ^ CRC32_TABLE[(c ^ (0xe0 | (code >> 12))) & 0xff];
        c = (c >>> 8) ^ CRC32_TABLE[(c ^ (0x80 | ((code >> 6) & 0x3f))) & 0xff];
        c = (c >>> 8) ^ CRC32_TABLE[(c ^ (0x80 | (code & 0x3f))) & 0xff];
      }
    }
  } else {
    for (let i = 0; i < data.length; i++) {
      c = (c >>> 8) ^ CRC32_TABLE[(c ^ data[i]) & 0xff];
    }
  }
  
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Base64 encode and decode utilities for Uint8Array
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Audio cue using Web Audio API (100% offline, no asset files needed)
 */
let audioCtx: AudioContext | null = null;

export function playAudioFeedback(type: 'ack' | 'complete' | 'packet' | 'error') {
  try {
    if (!audioCtx) {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtxClass) return;
      audioCtx = new AudioCtxClass();
    }
    
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    const now = audioCtx.currentTime;

    if (type === 'ack') {
      osc.frequency.setValueAtTime(880, now); // A5
      osc.frequency.exponentialRampToValueAtTime(1320, now + 0.08); // E6
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.start(now);
      osc.stop(now + 0.12);
    } else if (type === 'complete') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.setValueAtTime(659.25, now + 0.1); // E5
      osc.frequency.setValueAtTime(783.99, now + 0.2); // G5
      osc.frequency.setValueAtTime(1046.50, now + 0.3); // C6
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc.start(now);
      osc.stop(now + 0.45);
    } else if (type === 'packet') {
      osc.frequency.setValueAtTime(1200, now);
      gain.gain.setValueAtTime(0.03, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
      osc.start(now);
      osc.stop(now + 0.03);
    } else if (type === 'error') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.setValueAtTime(180, now + 0.1);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.2);
    }
  } catch {
    // Ignore audio context exceptions (e.g., auto-play restrictions)
  }
}
