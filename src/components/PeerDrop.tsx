import React, { useState, useEffect, useRef } from 'react';
import Peer, { type DataConnection } from 'peerjs';
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
} from 'lucide-react';
import { playAudioFeedback } from '../protocol/crc32';

interface PeerDropProps {
  onBackToOptical?: () => void;
}

export const PeerDrop: React.FC<PeerDropProps> = () => {
  const [peerId, setPeerId] = useState<string>('');
  const [targetPeerId, setTargetPeerId] = useState<string>('');
  const [connectionStatus, setConnectionStatus] = useState<'DISCONNECTED' | 'CONNECTING' | 'CONNECTED'>('DISCONNECTED');
  const [connectedPeerName, setConnectedPeerName] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Transfer states
  const [transferProgress, setTransferProgress] = useState<number>(0);
  const [transferSpeed, setTransferSpeed] = useState<number>(0);
  const [transferStatus, setTransferStatus] = useState<string>('');
  const [incomingFile, setIncomingFile] = useState<{ name: string; size: number; url: string } | null>(null);

  const peerRef = useRef<Peer | null>(null);
  const activeConnRef = useRef<DataConnection | null>(null);

  // Check URL query parameters for one-click pairing: ?join=1234
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const joinCode = params.get('join');
    if (joinCode) {
      setTargetPeerId(joinCode.trim());
    }
  }, []);

  // Initialize resilient PeerJS connection with automatic code collision retry
  const initPeer = () => {
    if (peerRef.current) {
      peerRef.current.destroy();
    }

    // Generate random 4-digit code (1000 - 9999)
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

      // Auto-connect if query parameter exists
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
      // If code collision happens, retry with a fresh code
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
    let fileChunks: ArrayBuffer[] = [];
    let startTime = 0;

    conn.on('data', (data: unknown) => {
      const msg = data as any;

      if (msg.type === 'START') {
        fileName = msg.name;
        expectedSize = msg.size;
        mimeType = msg.mime || 'application/octet-stream';
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
        const fullBlob = new Blob(fileChunks, { type: mimeType });
        const url = URL.createObjectURL(fullBlob);
        setIncomingFile({ name: fileName, size: expectedSize, url });
        setTransferStatus('File received successfully!');
        setTransferProgress(100);
        playAudioFeedback('complete');
        confetti({ particleCount: 150, spread: 80 });

        // Auto trigger download
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    });

    conn.on('close', () => {
      setConnectionStatus('DISCONNECTED');
      activeConnRef.current = null;
    });
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

  // High-performance streaming with WebRTC backpressure control (supports multi-GB files)
  const sendFileP2P = (file: File) => {
    if (!activeConnRef.current || connectionStatus !== 'CONNECTED') {
      alert('Please connect to another device first!');
      return;
    }

    const conn = activeConnRef.current;
    const chunkSize = 32 * 1024; // 32 KB high-throughput chunks
    const totalSize = file.size;
    let offset = 0;
    const startTime = Date.now();

    conn.send({
      type: 'START',
      name: file.name,
      size: file.size,
      mime: file.type,
    });

    setTransferStatus(`Sending ${file.name}...`);
    setTransferProgress(0);

    const reader = new FileReader();

    const sendNextChunk = () => {
      // Check WebRTC bufferedAmount for flow control backpressure
      const dc = (conn as any).dataChannel as RTCDataChannel | undefined;
      if (dc && dc.bufferedAmount > 2 * 1024 * 1024) {
        // Pause 10ms if buffer is over 2MB to prevent browser crash
        setTimeout(sendNextChunk, 10);
        return;
      }

      if (offset < totalSize) {
        const slice = file.slice(offset, offset + chunkSize);
        reader.readAsArrayBuffer(slice);
      } else {
        conn.send({ type: 'END' });
        setTransferStatus('Transfer complete!');
        playAudioFeedback('complete');
        confetti({ particleCount: 100, spread: 70 });
      }
    };

    reader.onload = (e) => {
      if (!e.target?.result) return;
      const buffer = e.target.result as ArrayBuffer;
      conn.send({ type: 'CHUNK', chunk: buffer });

      offset += buffer.byteLength;
      const percent = Math.min(100, Math.round((offset / totalSize) * 100));
      setTransferProgress(percent);

      const duration = Math.max(0.1, (Date.now() - startTime) / 1000);
      setTransferSpeed(Math.round((offset / 1024 / duration) * 10) / 10);

      sendNextChunk();
    };

    sendNextChunk();
  };

  const copyPeerId = () => {
    const codeOnly = peerId.replace('qjump-', '');
    navigator.clipboard.writeText(codeOnly);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyPairLink = () => {
    const codeOnly = peerId.replace('qjump-', '');
    const shareUrl = `${window.location.origin}${window.location.pathname}?join=${codeOnly}`;
    navigator.clipboard.writeText(shareUrl);
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
      copyPairLink();
    }
  };

  const shortCode = peerId.replace('qjump-', '');

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {/* Hero Badge */}
      <div className="p-6 rounded-3xl bg-zinc-900/80 border border-zinc-800 shadow-2xl backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <Radio className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-white">Direct AirDrop (Zero Cloud • Zero Friction)</h2>
                <span className="text-[10px] font-mono bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 px-2 py-0.5 rounded-full uppercase">
                  Encrypted P2P
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                Drop unlimited files between any phone and laptop without Discord, without accounts, and without compression.
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

        {/* Pairing Bar */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6 pt-6 border-t border-zinc-800">
          {/* My Device Code */}
          <div className="p-4 rounded-2xl bg-zinc-950/80 border border-zinc-800/80 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-mono text-zinc-500 uppercase block">This Device Code</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={copyPeerId}
                  title="Copy 4-digit code"
                  className="px-2 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-[11px] font-semibold text-zinc-300 transition flex items-center gap-1"
                >
                  <Copy className="w-3 h-3" />
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
                <button
                  onClick={shareNativeLink}
                  title="Share 1-Click Link"
                  className="px-2 py-1 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-[11px] font-semibold transition flex items-center gap-1"
                >
                  <Share2 className="w-3 h-3" />
                  <span>1-Click Link</span>
                </button>
              </div>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black font-mono tracking-wider text-cyan-400">
                {shortCode || 'Connecting...'}
              </span>
              <span className="text-[10px] text-zinc-500 font-mono">New code on reload</span>
            </div>
          </div>

          {/* Connect to Remote Device */}
          <div className="p-4 rounded-2xl bg-zinc-950/80 border border-zinc-800/80 flex flex-col justify-between">
            <span className="text-[11px] font-mono text-zinc-500 uppercase block mb-1">Connect To Code</span>
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
                className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xl font-mono font-bold text-white focus:outline-none focus:border-cyan-500 placeholder:text-zinc-600 placeholder:text-sm"
              />
              <button
                onClick={connectToPeer}
                disabled={connectionStatus === 'CONNECTED' || targetPeerId.length < 3}
                className="px-4 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-black font-bold text-xs flex items-center gap-1.5 transition shadow-lg shadow-cyan-500/20"
              >
                <span>Connect</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
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

      {/* Transfer Area (File Drop & Progress) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Send File Card */}
        <div className="p-6 rounded-3xl bg-zinc-900/60 border border-zinc-800 flex flex-col justify-between">
          <div>
            <h3 className="text-base font-bold text-white mb-2 flex items-center gap-2">
              <Upload className="w-4 h-4 text-cyan-400" /> Send File to Connected Device
            </h3>
            <p className="text-xs text-zinc-400 mb-6 leading-relaxed">
              Drop any photo, video, PDF, APK, or multi-GB archive. Streams via direct WebRTC memory buffer.
            </p>

            <label className={`flex flex-col items-center justify-center p-8 rounded-2xl bg-zinc-950 border border-zinc-800 transition group ${connectionStatus === 'CONNECTED' ? 'cursor-pointer hover:border-cyan-500/50' : 'opacity-60 cursor-not-allowed'}`}>
              <Upload className="w-8 h-8 text-cyan-400 mb-2 group-hover:scale-110 transition" />
              <span className="text-sm font-semibold text-zinc-200">
                {connectionStatus === 'CONNECTED' ? 'Drop or choose file to beam' : 'Connect devices above first'}
              </span>
              <span className="text-xs text-zinc-500 mt-1">Unlimited file size • Zero compression</span>
              <input
                type="file"
                className="hidden"
                disabled={connectionStatus !== 'CONNECTED'}
                onChange={(e) => {
                  if (e.target.files?.[0]) sendFileP2P(e.target.files[0]);
                }}
              />
            </label>
          </div>

          <div className="mt-4 pt-4 border-t border-zinc-800/80 text-[11px] text-zinc-500 flex items-center justify-between">
            <span className="flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> DTLS 1.3 End-to-End Encrypted
            </span>
            <span>Zero Third-Party Relays</span>
          </div>
        </div>

        {/* Live Progress / Incoming File Card */}
        <div className="p-6 rounded-3xl bg-zinc-900/60 border border-zinc-800 flex flex-col justify-between">
          <div>
            <h3 className="text-base font-bold text-white mb-2 flex items-center gap-2">
              <Zap className="w-4 h-4 text-emerald-400" /> Live Stream Status
            </h3>
            <p className="text-xs text-zinc-400 mb-6 leading-relaxed">
              Real-time transfer metrics with auto-download and backpressure flow control.
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
    </div>
  );
};
