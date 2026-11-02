/**
 * Web Crypto API - Client-Side AES-GCM 256 Encryption & Decryption
 * 100% in-memory, zero-dependency, hardware-accelerated.
 */

// Derive a 256-bit AES key from a human passphrase using PBKDF2
async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts an ArrayBuffer payload with AES-GCM 256
 * Output format: [16 bytes Salt] + [12 bytes IV] + [Ciphertext + 16 bytes Auth Tag]
 */
export async function encryptBuffer(data: ArrayBuffer, passphrase: string): Promise<ArrayBuffer> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);

  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv as BufferSource,
    },
    key,
    data
  );

  const combined = new Uint8Array(salt.byteLength + iv.byteLength + encrypted.byteLength);
  combined.set(salt, 0);
  combined.set(iv, salt.byteLength);
  combined.set(new Uint8Array(encrypted), salt.byteLength + iv.byteLength);

  return combined.buffer;
}

/**
 * Decrypts an AES-GCM 256 payload using the provided passphrase
 */
export async function decryptBuffer(encryptedBuffer: ArrayBuffer, passphrase: string): Promise<ArrayBuffer> {
  const bytes = new Uint8Array(encryptedBuffer);
  if (bytes.byteLength < 28) {
    throw new Error('Invalid encrypted buffer size');
  }

  const salt = bytes.slice(0, 16);
  const iv = bytes.slice(16, 28);
  const ciphertext = bytes.slice(28);

  const key = await deriveKey(passphrase, salt);

  return crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv as BufferSource,
    },
    key,
    ciphertext
  );
}

/**
 * Hash an IP or subnet string client-side into a privacy-safe room ID
 */
export async function hashSubnet(input: string): Promise<string> {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(`air-relay-subnet-salt-${input}`));
  const hashArray = Array.from(new Uint8Array(digest));
  return hashArray.slice(0, 4).map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}
