import React, { useState, useEffect, useRef } from 'react';
import Peer, { type DataConnection } from 'peerjs';
import JSZip from 'jszip';
import confetti from 'canvas-confetti';
import {
  Radio,
  Upload,
  Download,
  CheckCircle,
  Copy,
  ArrowRight,
  ShieldCheck,
  Zap,
  Share2,
  AlertCircle,
  RefreshCw,
  FileText,
  Send,
  Check,
  X,
  Laptop,
  Smartphone,
  ShieldAlert,
  MessageSquare,
  Archive,
  History,
  Lock,
  Wifi,
  Sparkles,
} from 'lucide-react';
import { playAudioFeedback } from '../protocol/crc32';
import { encryptBuffer, decryptBuffer } from '../protocol/crypto';

interface PendingTransferRequest {
  name: string;
  size: number;
  mime: string;
  sender: string;
  isEncrypted?: boolean;
}

interface TransferAuditItem {
  id: string;
  name: string;
  size: number;
  type: 'SENT' | 'RECEIVED';
  timestamp: string;
}

interface DiscoveredPeer {
  id: string;
  name: string;
  code: string;
  lastSeen: number;
}

export const PeerDrop: React.FC = () => {
  const [peerId, setPeerId] = useState<string>('');
  const [deviceName, setDeviceName] = useState<string>('');
  const [targetPeerId, setTargetPeerId] = useState<string>('');
  const [connectionStatus, setConnectionStatus] = useState<'DISCONNECTED' | 'CONNECTING' | 'CONNECTED'>('DISCONNECTED');
  const [connectedPeerName, setConnectedPeerName] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Proximity Discovery Peers
  const [discoveredPeers, setDiscoveredPeers] = useState<DiscoveredPeer[]>([]);
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);

  // Client-Side AES-GCM 256 Passphrase Encryption
  const [passphrase, setPassphrase] = useState<string>('');
  const [requirePassphraseModal, setRequirePassphraseModal] = useState<boolean>(false);
  const [incomingDecryptionPassphrase, setIncomingDecryptionPassphrase] = useState<string>('');
  const [cachedEncryptedBlob, setCachedEncryptedBlob] = useState<{ buffer: ArrayBuffer; name: string; mime: string } | null>(null);

  // Drag and drop zone state
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);

  // Tabs: Files vs Instant Text/Links vs Transfer Audit Log
  const [activeTab, setActiveTab] = useState<'FILES' | 'TEXT' | 'AUDIT'>('FILES');
  const [textMessage, setTextMessage] = useState<string>('');
  const [receivedTextList, setReceivedTextList] = useState<{ text: string; time: string; sender: string }[]>([]);
  const [auditLog, setAuditLog] = useState<TransferAuditItem[]>([]);

  // Safety: Accept / Decline prompt
  const [pendingRequest, setPendingRequest] = useState<PendingTransferRequest | null>(null);

  // Transfer states
  const [transferProgress, setTransferProgress] = useState<number>(0);
  const [transferSpeed, setTransferSpeed] = useState<number>(0);
  const [transferStatus, setTransferStatus] = useState<string>('');
  const [incomingFile, setIncomingFile] = useState<{ name: string; size: number; url: string } | null>(null);

  const peerRef = useRef<Peer | null>(null);
  const activeConnRef = useRef<DataConnection | null>(null);
  const pendingFileQueueRef = useRef<{ file: File; conn: DataConnection } | null>(null);

  // Auto-detect friendly device name
  useEffect(() => {
    const ua = navigator.userAgent;
    let label = 'Unknown Device';
    if (/Android/i.test(ua)) label = 'Android Phone';
    else if (/iPhone|iPad|iPod/i.test(ua)) label = 'Apple Device';
    else if (/Linux/i.test(ua)) label = 'Linux Workstation';
    else if (/Macintosh|Mac OS X/i.test(ua)) label = 'Mac Desktop';
    else if (/Windows/i.test(ua)) label = 'Windows PC';
    setDeviceName(label);
  }, []);

  // BroadcastChannel for instant local Wi-Fi / same-subnet proximity discovery
  useEffect(() => {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      const bc = new BroadcastChannel('air-relay-local-discovery');
      broadcastChannelRef.current = bc;

      bc.onmessage = (event) => {
        const data = event.data;
        if (data && data.type === 'PEER_PING' && data.id !== peerId && data.code) {
          setDiscoveredPeers((prev) => {
            const filtered = prev.filter((p) => p.code !== data.code && Date.now() - p.lastSeen < 15000);
            return [
              {
                id: data.id,
                name: data.name || 'Nearby Device',
                code: data.code,
                lastSeen: Date.now(),
              },
              ...filtered,
            ];
          });
        }
      };

      // Periodic beacon pulse
      const beaconTimer = setInterval(() => {
        if (peerId) {
          const codeOnly = peerId.replace('qjump-', '');
          bc.postMessage({
            type: 'PEER_PING',
            id: peerId,
            code: codeOnly,
            name: deviceName,
          });
        }
      }, 3000);

      return () => {
        clearInterval(beaconTimer);
        bc.close();
      };
    }
  }, [peerId, deviceName]);

  // Check URL query parameters for one-click pairing: ?join=1234
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const joinCode = params.get('join');
    if (joinCode) {
      setTargetPeerId(joinCode.trim());
    }
  }, []);

  // Initialize PeerJS
  const initPeer = () => {
    if (peerRef.current) {
      peerRef.current.destroy();
    }

    const code = Math.floor(1000 + Math.random() * 9000);
    const customId = `qjump-${code}`;

    const peer = new Peer(customId, {
      debug: 1,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' }
        ]
      }
    });

    peer.on('open', (id) => {
      setPeerId(id);
      setErrorMessage(null);

      // Announce beacon on BroadcastChannel
      if (broadcastChannelRef.current) {
        broadcastChannelRef.current.postMessage({
          type: 'PEER_PING',
          id,
          code: id.replace('qjump-', ''),
          name: deviceName,
        });
      }

      const params = new URLSearchParams(window.location.search);
      const joinCode = params.get('join');
      if (joinCode && joinCode !== id.replace('qjump-', '')) {
        setTimeout(() => {
          connectToPeerWithCode(joinCode);
        }, 500);
      }
    });

    peer.on('connection', (conn) => {
      setupConnectionHandlers(conn);
    });

    peer.on('error', (err) => {
      console.warn('Peer error:', err);
      if (err.type === 'unavailable-id') {
        setTimeout(initPeer, 300);
      } else if (err.type === 'peer-unavailable') {
        setErrorMessage('Device not found. Make sure the other device is open on the app.');
        setConnectionStatus('DISCONNECTED');
      } else {
        setErrorMessage(err.message || 'Connection negotiation failed.');
      }
    });

    peerRef.current = peer;
  };

  useEffect(() => {
    initPeer();
    return () => {
      peerRef.current?.destroy();
    };
  }, []);

  const setupConnectionHandlers = (conn: DataConnection) => {
    activeConnRef.current = conn;
    setConnectionStatus('CONNECTING');
    setErrorMessage(null);

    conn.on('open', () => {
      setConnectionStatus('CONNECTED');
      setConnectedPeerName(conn.peer);
      playAudioFeedback('ack');
    });

    let receivedBytes = 0;
    let expectedSize = 0;
    let fileName = '';
    let mimeType = '';
    let isPayloadEncrypted = false;
    let fileChunks: ArrayBuffer[] = [];
    let startTime = 0;

    conn.on('data', (data: unknown) => {
      const msg = data as any;

      // 1. Text or Link Beam
      if (msg.type === 'TEXT') {
        playAudioFeedback('packet');
        const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        setReceivedTextList((prev) => [{ text: msg.content, time: now, sender: conn.peer.replace('qjump-', '#') }, ...prev]);
        setActiveTab('TEXT');
        return;
      }

      // 2. Sender asking permission to transfer
      if (msg.type === 'REQUEST_TRANSFER') {
        playAudioFeedback('packet');
        setPendingRequest({
          name: msg.name,
          size: msg.size,
          mime: msg.mime || 'application/octet-stream',
          sender: conn.peer.replace('qjump-', '#'),
          isEncrypted: msg.isEncrypted,
        });
        return;
      }

      // 3. Receiver answered transfer request
      if (msg.type === 'TRANSFER_RESPONSE') {
        if (msg.accepted) {
          if (pendingFileQueueRef.current) {
            executeFileStream(pendingFileQueueRef.current.file, pendingFileQueueRef.current.conn);
            pendingFileQueueRef.current = null;
          }
        } else {
          setTransferStatus('Transfer declined by recipient.');
          pendingFileQueueRef.current = null;
        }
        return;
      }

      // 4. File Data Streaming
      if (msg.type === 'START') {
        fileName = msg.name;
        expectedSize = msg.size;
        mimeType = msg.mime || 'application/octet-stream';
        isPayloadEncrypted = !!msg.isEncrypted;
        receivedBytes = 0;
        fileChunks = [];
        startTime = Date.now();
        setTransferStatus(`Receiving ${fileName}...`);
        setTransferProgress(0);
        playAudioFeedback('packet');
      } else if (msg.type === 'CHUNK') {
        const chunk = msg.chunk as ArrayBuffer;
        fileChunks.push(chunk);
        receivedBytes += chunk.byteLength;

        const percent = Math.min(100, Math.round((receivedBytes / expectedSize) * 100));
        setTransferProgress(percent);

        const duration = Math.max(0.1, (Date.now() - startTime) / 1000);
        setTransferSpeed(Math.round((receivedBytes / 1024 / duration) * 10) / 10);
      } else if (msg.type === 'END') {
        // Concatenate chunks
        const totalBuffer = new Uint8Array(receivedBytes);
        let offset = 0;
        for (const c of fileChunks) {
          totalBuffer.set(new Uint8Array(c), offset);
          offset += c.byteLength;
        }

        if (isPayloadEncrypted) {
          setCachedEncryptedBlob({ buffer: totalBuffer.buffer, name: fileName, mime: mimeType });
          setRequirePassphraseModal(true);
          setTransferStatus('File received (Encrypted). Enter passphrase to decrypt.');
          playAudioFeedback('ack');
        } else {
          completeDownload(totalBuffer.buffer, fileName, mimeType, expectedSize);
        }
      }
    });

    conn.on('close', () => {
      setConnectionStatus('DISCONNECTED');
      activeConnRef.current = null;
    });
  };

  const completeDownload = (buffer: ArrayBuffer, name: string, mime: string, size: number) => {
    const fullBlob = new Blob([buffer], { type: mime });
    const url = URL.createObjectURL(fullBlob);
    setIncomingFile({ name, size, url });
    setTransferStatus('File ready!');
    setTransferProgress(100);
    playAudioFeedback('complete');
    confetti({ particleCount: 150, spread: 80 });

    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setAuditLog((prev) => [
      {
        id: Math.random().toString(36).substring(7),
        name,
        size,
        type: 'RECEIVED',
        timestamp: timeStr,
      },
      ...prev,
    ]);

    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Decrypt and save encrypted file
  const handleDecryptAndSave = async () => {
    if (!cachedEncryptedBlob || !incomingDecryptionPassphrase) return;
    try {
      setTransferStatus('Decrypting with AES-GCM 256...');
      const decrypted = await decryptBuffer(cachedEncryptedBlob.buffer, incomingDecryptionPassphrase);
      setRequirePassphraseModal(false);
      completeDownload(decrypted, cachedEncryptedBlob.name, cachedEncryptedBlob.mime, decrypted.byteLength);
      setCachedEncryptedBlob(null);
      setIncomingDecryptionPassphrase('');
    } catch {
      alert('Decryption failed! Incorrect passphrase or corrupted payload.');
    }
  };

  const connectToPeerWithCode = (code: string) => {
    if (!peerRef.current || !code.trim()) return;
    const clean = code.trim().replace('qjump-', '');
    const formattedTarget = `qjump-${clean}`;
    setConnectionStatus('CONNECTING');
    setErrorMessage(null);
    const conn = peerRef.current.connect(formattedTarget, { reliable: true });
    setupConnectionHandlers(conn);
  };

  const connectToPeer = () => {
    connectToPeerWithCode(targetPeerId);
  };

  // Multi-File & Folder Auto-Zip Handler
  const handleMultipleFiles = async (fileList: FileList | File[]) => {
    if (!activeConnRef.current || connectionStatus !== 'CONNECTED') {
      alert('Please connect to another device first!');
      return;
    }

    const files = Array.from(fileList);
    if (files.length === 0) return;

    if (files.length === 1) {
      handleInitiateFileSend(files[0]);
    } else {
      setTransferStatus(`Packaging ${files.length} files into zip archive...`);
      const zip = new JSZip();
      for (const f of files) {
        zip.file(f.name, f);
      }
      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      const timestamp = new Date().toISOString().slice(0, 10);
      const zipFile = new File([zipBlob], `AirRelay_Batch_${timestamp}.zip`, { type: 'application/zip' });
      handleInitiateFileSend(zipFile);
    }
  };

  // Request transfer permission before streaming
  const handleInitiateFileSend = (file: File) => {
    if (!activeConnRef.current || connectionStatus !== 'CONNECTED') {
      alert('Please connect to another device first!');
      return;
    }

    const conn = activeConnRef.current;
    pendingFileQueueRef.current = { file, conn };
    setTransferStatus(`Waiting for ${connectedPeerName.replace('qjump-', '#')} to accept...`);

    conn.send({
      type: 'REQUEST_TRANSFER',
      name: file.name,
      size: file.size,
      mime: file.type,
      isEncrypted: passphrase.trim().length > 0,
    });
  };

  const acceptIncomingTransfer = () => {
    if (!activeConnRef.current) return;
    activeConnRef.current.send({ type: 'TRANSFER_RESPONSE', accepted: true });
    setPendingRequest(null);
    setTransferStatus('Incoming file accepted. Starting download stream...');
  };

  const rejectIncomingTransfer = () => {
    if (!activeConnRef.current) return;
    activeConnRef.current.send({ type: 'TRANSFER_RESPONSE', accepted: false });
    setPendingRequest(null);
    setTransferStatus('Incoming transfer declined.');
  };

  // Streaming engine with optional AES-GCM 256 encryption
  const executeFileStream = async (file: File, conn: DataConnection) => {
    let rawBuffer = await file.arrayBuffer();

    const isEncrypted = passphrase.trim().length > 0;
    if (isEncrypted) {
      setTransferStatus('Encrypting payload with AES-GCM 256...');
      rawBuffer = await encryptBuffer(rawBuffer, passphrase.trim());
    }

    const chunkSize = 32 * 1024;
    const totalSize = rawBuffer.byteLength;
    let offset = 0;
    const startTime = Date.now();

    conn.send({
      type: 'START',
      name: file.name,
      size: totalSize,
      mime: file.type,
      isEncrypted,
    });

    setTransferStatus(`Streaming ${file.name}${isEncrypted ? ' (AES-256 Encrypted)' : ''}...`);
    setTransferProgress(0);

    const sendNextChunk = () => {
      const dc = (conn as any).dataChannel as RTCDataChannel | undefined;
      if (dc && dc.bufferedAmount > 2 * 1024 * 1024) {
        setTimeout(sendNextChunk, 10);
        return;
      }

      if (offset < totalSize) {
        const end = Math.min(offset + chunkSize, totalSize);
        const slice = rawBuffer.slice(offset, end);
        conn.send({ type: 'CHUNK', chunk: slice });

        offset += slice.byteLength;
        const percent = Math.min(100, Math.round((offset / totalSize) * 100));
        setTransferProgress(percent);

        const duration = Math.max(0.1, (Date.now() - startTime) / 1000);
        setTransferSpeed(Math.round((offset / 1024 / duration) * 10) / 10);

        sendNextChunk();
      } else {
        conn.send({ type: 'END' });
        setTransferStatus('Transfer complete!');
        playAudioFeedback('complete');
        confetti({ particleCount: 100, spread: 70 });

        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        setAuditLog((prev) => [
          {
            id: Math.random().toString(36).substring(7),
            name: file.name,
            size: totalSize,
            type: 'SENT',
            timestamp: timeStr,
          },
          ...prev,
        ]);
      }
    };

    sendNextChunk();
  };

  // Instant Text / Link Beam
  const sendInstantText = () => {
    if (!activeConnRef.current || connectionStatus !== 'CONNECTED' || !textMessage.trim()) return;
    activeConnRef.current.send({
      type: 'TEXT',
      content: textMessage.trim(),
    });

    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setReceivedTextList((prev) => [{ text: textMessage.trim(), time: now, sender: 'You' }, ...prev]);
    setTextMessage('');
    playAudioFeedback('complete');
  };

  const copyPeerId = () => {
    const codeOnly = peerId.replace('qjump-', '');
    navigator.clipboard.writeText(codeOnly);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareNativeLink = async () => {
    const codeOnly = peerId.replace('qjump-', '');
    const shareUrl = `${window.location.origin}${window.location.pathname}?join=${codeOnly}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'AirRelay One-Click Drop',
          text: `Drop files to my device (${codeOnly}) directly via AirRelay:`,
          url: shareUrl,
        });
      } catch {
        // User cancelled share
      }
    } else {
      navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const shortCode = peerId.replace('qjump-', '');

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const isDangerousFile = (filename: string) => {
    const dangerous = ['.exe', '.bat', '.cmd', '.sh', '.vbs', '.apk', '.msi'];
    return dangerous.some((ext) => filename.toLowerCase().endsWith(ext));
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {/* Decryption Prompt Modal */}
      {requirePassphraseModal && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md p-6 rounded-3xl bg-zinc-900 border border-cyan-500/40 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Encrypted File Received</h3>
                <p className="text-xs text-zinc-400">Sender protected this payload with AES-GCM 256</p>
              </div>
            </div>

            <p className="text-xs text-zinc-300">
              Enter the secret passphrase agreed upon with the sender to decrypt <strong>{cachedEncryptedBlob?.name}</strong>:
            </p>

            <input
              type="password"
              placeholder="Enter decryption password..."
              value={incomingDecryptionPassphrase}
              onChange={(e) => setIncomingDecryptionPassphrase(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleDecryptAndSave();
              }}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-500"
            />

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => {
                  setRequirePassphraseModal(false);
                  setCachedEncryptedBlob(null);
                }}
                className="flex-1 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-bold text-zinc-300 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleDecryptAndSave}
                disabled={!incomingDecryptionPassphrase.trim()}
                className="flex-1 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-black text-xs font-bold flex items-center justify-center gap-1.5 transition shadow-lg shadow-cyan-500/20"
              >
                <Check className="w-4 h-4" /> Decrypt & Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pending Safety Confirmation Modal */}
      {pendingRequest && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md p-6 rounded-3xl bg-zinc-900 border border-zinc-700 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Incoming File Request</h3>
                <p className="text-xs text-zinc-400">From peer {pendingRequest.sender}</p>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-zinc-950 border border-zinc-800 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-zinc-200 block truncate">{pendingRequest.name}</span>
                {pendingRequest.isEncrypted && (
                  <span className="flex items-center gap-1 text-[10px] font-mono text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/30">
                    <Lock className="w-3 h-3" /> AES-256
                  </span>
                )}
              </div>
              <span className="text-xs font-mono text-cyan-400 block">{formatBytes(pendingRequest.size)}</span>
            </div>

            {isDangerousFile(pendingRequest.name) && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Caution: Executable files may contain risks.</span>
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={rejectIncomingTransfer}
                className="flex-1 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-bold text-zinc-300 flex items-center justify-center gap-1.5 transition"
              >
                <X className="w-4 h-4" /> Decline
              </button>
              <button
                onClick={acceptIncomingTransfer}
                className="flex-1 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black text-xs font-bold flex items-center justify-center gap-1.5 transition shadow-lg shadow-cyan-500/20"
              >
                <Check className="w-4 h-4" /> Accept & Download
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Connection Bar */}
      <div className="p-4 sm:p-6 rounded-3xl bg-zinc-900/80 border border-zinc-800 shadow-2xl backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0">
              <Radio className="w-5 h-5 sm:w-6 sm:h-6 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg sm:text-xl font-bold text-white">AirRelay</h2>
                <span className="text-[10px] font-mono bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 px-2 py-0.5 rounded-full uppercase">
                  Encrypted P2P
                </span>
                <span className="text-[10px] sm:text-[11px] text-zinc-500 flex items-center gap-1">
                  {deviceName.includes('Phone') ? <Smartphone className="w-3 h-3 inline" /> : <Laptop className="w-3 h-3 inline" />} {deviceName}
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-zinc-400 mt-0.5">
                Drop files, photos, or text links directly to any device. Zero cloud storage.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${connectionStatus === 'CONNECTED' ? 'bg-emerald-400 animate-ping' : connectionStatus === 'CONNECTING' ? 'bg-amber-400 animate-spin' : 'bg-zinc-600'}`} />
            <span className="text-xs font-mono font-semibold text-zinc-300 uppercase">
              {connectionStatus === 'CONNECTED' ? `Connected to #${connectedPeerName.replace('qjump-', '')}` : connectionStatus}
            </span>
          </div>
        </div>

        {/* Local Wi-Fi Proximity Discovery Cards */}
        {discoveredPeers.length > 0 && connectionStatus !== 'CONNECTED' && (
          <div className="mt-4 p-3.5 rounded-2xl bg-cyan-950/30 border border-cyan-500/30 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 font-bold text-cyan-300">
                <Wifi className="w-3.5 h-3.5 text-cyan-400 animate-pulse" /> Discovered Nearby on Same Network:
              </span>
              <span className="text-[10px] text-zinc-400 font-mono">1-Tap Auto Connect</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {discoveredPeers.map((p) => (
                <button
                  key={p.code}
                  onClick={() => connectToPeerWithCode(p.code)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-cyan-500/20 text-xs font-semibold text-zinc-200 border border-zinc-700 hover:border-cyan-400 transition"
                >
                  <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                  <span>{p.name} (#{p.code})</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Pairing Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 mt-5 pt-5 border-t border-zinc-800">
          {/* This Device Code */}
          <div className="p-3.5 sm:p-4 rounded-2xl bg-zinc-950/80 border border-zinc-800/80 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] sm:text-[11px] font-mono text-zinc-500 uppercase block">This Device Code</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={copyPeerId}
                  title="Copy 4-digit code"
                  className="px-2 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-[10px] sm:text-[11px] font-semibold text-zinc-300 transition flex items-center gap-1"
                >
                  <Copy className="w-3 h-3" />
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
                <button
                  onClick={shareNativeLink}
                  title="Share 1-Click Link"
                  className="px-2 py-1 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-[10px] sm:text-[11px] font-semibold transition flex items-center gap-1"
                >
                  <Share2 className="w-3 h-3" />
                  <span>1-Click Link</span>
                </button>
              </div>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-black font-mono tracking-wider text-cyan-400">
                {shortCode || 'Connecting...'}
              </span>
              <span className="text-[9px] sm:text-[10px] text-zinc-500 font-mono">Randomized on reload</span>
            </div>
          </div>

          {/* Connect To Code */}
          <div className="p-3.5 sm:p-4 rounded-2xl bg-zinc-950/80 border border-zinc-800/80 flex flex-col justify-between">
            <span className="text-[10px] sm:text-[11px] font-mono text-zinc-500 uppercase block mb-1">Connect To Remote Code</span>
            <div className="flex items-center gap-2">
              <input
                type="text"
                maxLength={4}
                placeholder="e.g. 4821"
                value={targetPeerId}
                onChange={(e) => setTargetPeerId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') connectToPeer();
                }}
                className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-lg sm:text-xl font-mono font-bold text-white focus:outline-none focus:border-cyan-500 placeholder:text-zinc-600 placeholder:text-sm"
              />
              <button
                onClick={connectToPeer}
                disabled={connectionStatus === 'CONNECTED' || targetPeerId.length < 3}
                className="px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-black font-bold text-xs flex items-center gap-1.5 transition shadow-lg shadow-cyan-500/20 shrink-0"
              >
                <span>Connect</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Optional AES-GCM 256 Passphrase Lock Bar */}
        <div className="mt-4 pt-4 border-t border-zinc-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <Lock className={`w-3.5 h-3.5 ${passphrase ? 'text-cyan-400' : 'text-zinc-500'}`} />
            <span className="text-zinc-400">Client-Side AES-256 Lock:</span>
            <input
              type="password"
              placeholder="Optional transfer password..."
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1 text-xs text-white focus:outline-none focus:border-cyan-500 placeholder:text-zinc-600 max-w-[180px]"
            />
          </div>
          <span className="text-[10px] text-zinc-500 font-mono">
            {passphrase ? '🔒 Payloads encrypted before leaving device' : 'Leave empty for default transfer'}
          </span>
        </div>

        {/* Error notification if peer not found */}
        {errorMessage && (
          <div className="mt-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span className="flex-1">{errorMessage}</span>
            <button
              onClick={initPeer}
              className="px-2 py-0.5 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 text-[10px] font-mono flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> Retry
            </button>
          </div>
        )}
      </div>

      {/* Tabs: Drop Files vs Beam Text/Links vs Audit Log */}
      <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('FILES')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition ${
              activeTab === 'FILES' ? 'bg-cyan-500 text-black shadow-lg shadow-cyan-500/20' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Drop Files</span>
          </button>
          <button
            onClick={() => setActiveTab('TEXT')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition ${
              activeTab === 'TEXT' ? 'bg-cyan-500 text-black shadow-lg shadow-cyan-500/20' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Beam Text / Links</span>
            {receivedTextList.length > 0 && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block animate-pulse" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('AUDIT')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition ${
              activeTab === 'AUDIT' ? 'bg-cyan-500 text-black shadow-lg shadow-cyan-500/20' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>History ({auditLog.length})</span>
          </button>
        </div>
        <span className="text-[11px] font-mono text-zinc-500 hidden sm:inline">
          {connectionStatus === 'CONNECTED' ? 'Ready to beam' : 'Waiting for connection'}
        </span>
      </div>

      {/* Mode A: Drop Files */}
      {activeTab === 'FILES' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDraggingOver(true);
            }}
            onDragLeave={() => setIsDraggingOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDraggingOver(false);
              if (e.dataTransfer.files) handleMultipleFiles(e.dataTransfer.files);
            }}
            className={`p-6 rounded-3xl bg-zinc-900/60 border-2 transition-all duration-200 flex flex-col justify-between ${
              isDraggingOver
                ? 'border-cyan-400 bg-cyan-950/20 shadow-[0_0_30px_rgba(34,211,238,0.2)]'
                : 'border-zinc-800'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Upload className="w-4 h-4 text-cyan-400" /> Send Files or Folders
                </h3>
                <span className="text-[10px] bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded font-mono">
                  Multi-file Auto-Zip
                </span>
              </div>
              <p className="text-xs text-zinc-400 mb-6 leading-relaxed">
                Drag and drop multiple files or photos together. AirRelay automatically packages multi-item drops into a zip stream on the fly.
              </p>

              <label className={`flex flex-col items-center justify-center p-8 rounded-2xl bg-zinc-950 border transition group ${connectionStatus === 'CONNECTED' ? 'cursor-pointer hover:border-cyan-500/50 border-zinc-800' : 'opacity-60 cursor-not-allowed border-zinc-900'}`}>
                {isDraggingOver ? (
                  <>
                    <Archive className="w-10 h-10 text-cyan-400 mb-2 animate-bounce" />
                    <span className="text-sm font-bold text-cyan-300">Release to Beam Items!</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-8 h-8 text-cyan-400 mb-2 group-hover:scale-110 transition" />
                    <span className="text-sm font-semibold text-zinc-200">
                      {connectionStatus === 'CONNECTED' ? 'Drop or choose files to beam' : 'Connect to another device first'}
                    </span>
                    <span className="text-xs text-zinc-500 mt-1">Multi-select enabled • Unlimited size</span>
                  </>
                )}
                <input
                  type="file"
                  multiple
                  className="hidden"
                  disabled={connectionStatus !== 'CONNECTED'}
                  onChange={(e) => {
                    if (e.target.files) handleMultipleFiles(e.target.files);
                  }}
                />
              </label>
            </div>

            <div className="mt-4 pt-4 border-t border-zinc-800/80 text-[11px] text-zinc-500 flex items-center justify-between">
              <span className="flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> DTLS 1.3 End-to-End Encrypted
              </span>
              <span>Zero Cloud Uploads</span>
            </div>
          </div>

          <div className="p-6 rounded-3xl bg-zinc-900/60 border border-zinc-800 flex flex-col justify-between">
            <div>
              <h3 className="text-base font-bold text-white mb-2 flex items-center gap-2">
                <Zap className="w-4 h-4 text-emerald-400" /> Live Stream Status
              </h3>
              <p className="text-xs text-zinc-400 mb-6 leading-relaxed">
                Direct peer-to-peer data channel with recipient consent confirmation.
              </p>

              {transferStatus ? (
                <div className="p-4 rounded-2xl bg-zinc-950 border border-zinc-800 space-y-3">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-zinc-300 font-semibold truncate max-w-[200px]">{transferStatus}</span>
                    <span className="text-cyan-400 font-bold">{transferProgress}%</span>
                  </div>
                  <div className="w-full bg-zinc-800 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-cyan-500 to-emerald-400 h-2 rounded-full transition-all duration-200"
                      style={{ width: `${transferProgress}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-zinc-400 font-mono">
                    <span>Speed: {transferSpeed} KB/s</span>
                    {incomingFile && <span>{formatBytes(incomingFile.size)}</span>}
                  </div>
                </div>
              ) : (
                <div className="p-8 rounded-2xl bg-zinc-950/60 border border-zinc-800 text-center">
                  <Radio className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
                  <span className="text-xs text-zinc-400 block font-mono">STANDBY FOR TRANSFERS</span>
                  <span className="text-[11px] text-zinc-600 block mt-1">Connect device code to begin sending</span>
                </div>
              )}

              {incomingFile && (
                <div className="mt-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between">
                  <div className="flex items-center gap-2 truncate">
                    <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="text-xs font-semibold text-emerald-300 truncate">{incomingFile.name}</span>
                  </div>
                  <a
                    href={incomingFile.url}
                    download={incomingFile.name}
                    className="px-3 py-1 bg-emerald-500 text-black font-bold text-xs rounded-lg shrink-0 flex items-center gap-1 shadow"
                  >
                    <Download className="w-3.5 h-3.5" /> Save
                  </a>
                </div>
              )}
            </div>

            <div className="mt-4 pt-4 border-t border-zinc-800/80 text-[11px] text-zinc-500 flex items-center justify-between">
              <span>Direct Memory Stream</span>
              <span>Zero Discord/Slack limits</span>
            </div>
          </div>
        </div>
      )}

      {/* Mode B: Beam Instant Text / Links */}
      {activeTab === 'TEXT' && (
        <div className="p-6 rounded-3xl bg-zinc-900/60 border border-zinc-800 space-y-4">
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder={connectionStatus === 'CONNECTED' ? "Type or paste link / note here..." : "Connect devices above to beam text"}
              value={textMessage}
              disabled={connectionStatus !== 'CONNECTED'}
              onChange={(e) => setTextMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') sendInstantText();
              }}
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-500"
            />
            <button
              onClick={sendInstantText}
              disabled={connectionStatus !== 'CONNECTED' || !textMessage.trim()}
              className="px-4 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-black font-bold text-xs flex items-center gap-1.5 transition shadow"
            >
              <span>Beam</span>
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-2 mt-4">
            <span className="text-[11px] font-mono text-zinc-500 uppercase block">Shared Text & Links</span>
            {receivedTextList.length === 0 ? (
              <div className="p-6 rounded-2xl bg-zinc-950/60 border border-zinc-800 text-center text-xs text-zinc-500">
                No text or links shared yet. Type above to beam a note or URL instantly across devices.
              </div>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {receivedTextList.map((item, idx) => (
                  <div key={idx} className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 flex items-center justify-between gap-4">
                    <div className="flex-1 truncate">
                      <span className="text-xs text-zinc-300 select-all block truncate font-mono">{item.text}</span>
                      <span className="text-[10px] text-zinc-500 mt-0.5 block">{item.sender} • {item.time}</span>
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(item.text);
                      }}
                      className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] shrink-0 font-mono"
                    >
                      Copy
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mode C: Transfer Audit Log History */}
      {activeTab === 'AUDIT' && (
        <div className="p-6 rounded-3xl bg-zinc-900/60 border border-zinc-800 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <History className="w-4 h-4 text-cyan-400" /> Session Transfer Log
            </h3>
            <span className="text-[11px] font-mono text-zinc-500">Cleared on tab reload</span>
          </div>

          {auditLog.length === 0 ? (
            <div className="p-8 rounded-2xl bg-zinc-950/60 border border-zinc-800 text-center text-xs text-zinc-500">
              No files transferred in this session yet. Sent and received files will appear here.
            </div>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {auditLog.map((item) => (
                <div key={item.id} className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 flex items-center justify-between">
                  <div className="flex items-center gap-3 truncate">
                    <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${item.type === 'SENT' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'}`}>
                      {item.type}
                    </span>
                    <span className="text-xs font-semibold text-zinc-200 truncate">{item.name}</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs font-mono text-zinc-400 shrink-0">
                    <span>{formatBytes(item.size)}</span>
                    <span className="text-zinc-600">{item.timestamp}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
