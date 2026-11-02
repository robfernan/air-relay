# 🌐 AirRelay

> **Zero-Setup, Zero-Cloud Cross-Device File Transport**  
> Send unlimited files directly between any phone, laptop, or PC over encrypted peer-to-peer WebSockets. No accounts, no compression, and no file size limits.

[![Live Web App](https://img.shields.io/badge/Live%20App-Try%20AirRelay-cyan?style=for-the-badge&logo=vercel)](https://robfernan.github.io/air-relay/)
[![Runtime: Bun](https://img.shields.io/badge/Runtime-Bun-f472b6?style=for-the-badge&logo=bun)](https://bun.sh)
[![License: MIT](https://img.shields.io/badge/License-MIT-emerald?style=for-the-badge)](LICENSE)

---

### 🔥 Why AirRelay?

Sending a file from your phone to your PC or to a friend shouldn't require uploading it to a cloud server:
- **Discord:** Caps you at 10–25 MB unless you pay for Nitro, and compresses your media.
- **AirDrop / Quick Share:** Locked to Apple or Google hardware silos.
- **Google Drive / WeTransfer:** Requires logins, creates permanent server copies, and forces you to wait for a 2-step upload/download loop.

**AirRelay streams directly device-to-device:**
- **Zero Cloud Storage:** Data travels directly through an end-to-end encrypted WebRTC memory socket.
- **Unlimited File Size:** Features streaming backpressure flow control to transfer multi-gigabyte videos and archives without browser memory leaks.
- **Instant 1-Click Pairing:** Share a direct link or enter a 4-digit code to connect in seconds.
- **Android System Share Sheet:** Install as a PWA, and AirRelay registers directly into Android's native "Share..." menu.
- **Cross-Platform:** Works seamlessly between Linux, Windows, macOS, Android, and iOS.

---

### 🚀 How It Works

1. Open **[AirRelay](https://robfernan.github.io/air-relay/)** on your sending device.
2. Share the 4-digit code (or click **1-Click Link** to copy a direct pairing URL).
3. Open the link or enter the code on the receiving device.
4. Drop your file. It streams directly into the recipient's browser memory and automatically saves to their device.

---

### 🗺️ Production Roadmap

- [x] **Zero-Cloud Direct Stream**: High-speed memory pipe using WebRTC SCTP DataChannels.
- [x] **Global STUN Traversal**: Connect across different Wi-Fi and mobile 5G/cellular networks.
- [x] **1-Click Shareable URL**: Auto-pair devices via URL parameters (`?join=XXXX`).
- [x] **Streaming Backpressure Control**: Buffer-aware queue monitor preventing browser crashes on multi-GB transfers.
- [x] **Android Web Share Target**: Appear natively in Android's system share menu.
- [x] **Offline-First PWA**: Instant home-screen install via Service Worker.
- [ ] **Multi-File Batch Queue**: Drag-and-drop multiple files or whole folders with on-the-fly zip packaging.
- [ ] **Local Subnet Proximity Discovery**: Auto-detect peers active on the same local Wi-Fi without needing a code.
- [ ] **Optional Passphrase E2EE**: Extra AES-GCM 256 encryption layer for sensitive documents.

---

### 🛠️ Developer Quickstart

Built natively with **Bun + Vite + React 19 + TypeScript**:

```bash
# Clone
git clone https://github.com/robfernan/air-relay.git
cd air-relay

# Install dependencies (Sub-second with Bun)
bun install

# Start local development server
bun dev --host

# Build production bundle
bun run build
```

---

### 📜 License

MIT License • Built by [robfernan](https://github.com/robfernan).
