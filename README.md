# ⚡ QRJump

> **100% Offline, Air-Gapped Bidirectional Optical File Transfer Web Application**  
> High-speed Screen-to-Camera transmission with an interactive animated optical ACK window.

![QRJump Dark UI](https://img.shields.io/badge/Air--Gap-Guaranteed-emerald?style=flat-square)
![Zero Dependencies Runtime](https://img.shields.io/badge/Network-0%20Bytes-blue?style=flat-square)
![Bun](https://img.shields.io/badge/Runtime-Bun-f472b6?style=flat-square&logo=bun)
![License](https://img.shields.io/badge/License-MIT-zinc?style=flat-square)

---

## 🎯 Architecture & Purpose

QRJump enables **zero-connection, zero-radio (no Wi-Fi, no Bluetooth, no NFC, no USB, no cellular)** physical data transfer between two devices using only displays and cameras.

It operates using an animated optical pipeline with real-time sliding-window flow control:
1. **Transmitter (Sender)** compresses the file with `fflate` (gzip/deflate level 6), slices it into calibrated ~450-byte packets, and streams them as high-contrast QR codes at 8–20 FPS.
2. **Receiver** scans the transmitter's display using `jsQR` over an offscreen HTML5 Canvas pipeline, decodes frames, validates packet CRC32 checksums, and updates its packet matrix.
3. **Interactive ACK Window**: The receiver's screen dynamically renders inverted ACK QR codes indicating received chunk ranges and missing frames. The sender's camera scans this to advance its window or retransmit dropped packets.
4. **Assembly**: Once all chunks are collected, the payload CRC32 is verified, decompressed in-memory, and the original file is delivered to the user.

---

## 🚀 Key Features

- **Bidirectional Optical Protocol**: Full `INIT`, `DATA`, `ACK`, and `FIN` frame specification.
- **Two Display Modes**:
  - **Simultaneous Duplex (Split Screen)**: Top/Left half runs camera viewfinder, Bottom/Right half displays active transmit/ACK QR.
  - **Alternating Half-Duplex**: Sender flashes a batch of data frames, then switches to camera view to read the receiver's ACK.
- **Selective Retransmission**: Missing packets flagged in the ACK payload are prioritized in subsequent batches.
- **Real-Time Visual Matrix**: Interactive packet grid with live percentage, received byte counts, and throughput (KB/s).
- **Zero Assets / Offline Sound FX**: Web Audio API generates synthetic audio cues on successful ACK/FIN detection without external audio files.
- **Responsive Dark HUD**: High-contrast, minimalist OLED dark interface with targeting reticles and scanline animations.

---

## 📦 Protocol Specification

```typescript
// 1. Session Announcement (Sender -> Receiver)
{ t: "INIT", id: string, name: string, size: number, compSize: number, total: number, win: number, mime: string, crc: number }

// 2. Data Packet Frame (Sender -> Receiver)
{ t: "DATA", id: string, idx: number, data: string /* base64 compressed payload */, crc: number }

// 3. Flow Control ACK Frame (Receiver -> Sender)
{ t: "ACK", id: string, got: number[], missing: number[], next: number }

// 4. Transfer Complete Termination Frame (Receiver -> Sender)
{ t: "FIN", id: string, status: "COMPLETE" }
```

---

## 🛠️ Development & Tooling

Built natively using [**Bun**](https://bun.sh):

```bash
# Clone the repository
git clone git@github.com:robfernan/qr-jump.git
cd qr-jump

# Install dependencies using Bun
bun install

# Start local dev server
bun dev

# Build production bundle with zero type errors
bun run build
```

---

## 🛡️ Security & Air-Gap Verification

QRJump requires **zero network requests**:
- No external CDN scripts
- No analytical trackers or background telemetry
- Operates in complete Airplane Mode with radios physically disconnected or disabled
