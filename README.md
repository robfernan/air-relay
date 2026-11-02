# 🌐 AirRelay

> **Zero-Setup, Zero-Cloud Cross-Device File Transport**  
> Send files instantly between any phone, laptop, or PC. Powered by WebRTC direct encrypted streaming with a 100% offline screen-to-camera optical air-gap fallback.

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Try%20AirRelay-cyan?style=for-the-badge&logo=vercel)](https://robfernan.github.io/air-relay/)
[![Runtime: Bun](https://img.shields.io/badge/Runtime-Bun-f472b6?style=for-the-badge&logo=bun)](https://bun.sh)
[![License: MIT](https://img.shields.io/badge/License-MIT-emerald?style=for-the-badge)](LICENSE)

---

### 🔥 Why AirRelay? (The Pitch)

AirDrop only works within Apple's walled garden. Quick Share only works within Google's ecosystem. Cloud services (Drive, Dropbox, WeTransfer) force you to upload your personal files to someone else's server, wait for uploads, and require accounts.

**AirRelay solves this universally:**
- **Zero Installs Needed:** Open the URL on your Moondrop, iPhone, Android, ThinkPad, or Mac — and drop files immediately.
- **Direct P2P Sockets:** Streams file bytes directly device-to-device through encrypted WebRTC memory sockets. No files ever touch a server.
- **100% Offline Optical Air-Gap:** Even with Wi-Fi, Bluetooth, and cellular completely disabled, AirRelay streams files screen-to-camera using animated QR packet bursts with real-time sliding-window ACK flow control.
- **Android Native Share Target:** Install as a PWA, and AirRelay registers directly into your Android OS "Share..." menu just like native Quick Share.
- **Desktop Browser Extension Ready:** Includes a Manifest V3 package to click and beam straight from your browser toolbar.

---

### ⚡ Two Powerful Transport Modes

| Feature | 📡 Direct AirDrop (WebRTC) | 📷 Optical Air-Gap (Screen-to-Camera) |
| :--- | :--- | :--- |
| **Optimal For** | Phones & Laptops on any Wi-Fi / Hotspot | Secure, air-gapped, zero-radio environments |
| **Hardware Required** | Any browser (Zero camera needed) | Display + Webcam / Phone Camera |
| **Connection Method** | Instant 4-digit pairing code | Optical visual scanning |
| **Speed** | Full network speed (Multi-MB/s) | 8–20 FPS packet bursts |
| **Privacy / Encryption** | DTLS 1.3 end-to-end encrypted | Physical line-of-sight isolated |

---

### 🗺️ Product Roadmap

- [x] **WebRTC Direct Stream**: High-speed zero-cloud memory pipe with 4-digit pairing.
- [x] **Optical Flow Control**: `INIT` $\rightarrow$ `DATA` $\rightarrow$ `ACK` $\rightarrow$ `FIN` protocol with sliding window retransmission.
- [x] **Dual Industrial Decoders**: Hybrid `ZXing` + `jsQR` engine for instant focus on webcams and phone cameras.
- [x] **PWA Standalone & Offline Caching**: Runs with zero internet connection via service workers.
- [x] **Android Web Share Target**: Appear directly in Android's native system share sheet.
- [ ] **Multi-File & Folder Auto-Zip**: Drag and drop entire directories to stream on the fly.
- [ ] **Client-Side AES-GCM 256 Passphrase**: Optional optical encryption key for paranoid security.
- [ ] **Native Desktop / Mobile Wrappers**: Optional Flutter or Wails lightweight binaries.

---

### 🛠️ Developer Quickstart

AirRelay is built with **Bun + Vite + React 19 + TypeScript**:

```bash
# Clone
git clone https://github.com/robfernan/air-relay.git
cd air-relay

# Install dependencies (Sub-second with Bun)
bun install

# Start local network development server
bun dev --host

# Run protocol verification tests
bun test

# Build production bundle & Chrome extension
bun run build
```

---

### 📜 License

MIT License • Built by [robfernan](https://github.com/robfernan).
