import { useState, useEffect, useRef, useCallback } from 'react';
import confetti from 'canvas-confetti';
import {
  Upload,
  ArrowUpRight,
  ArrowDownLeft,
  Sun,
  Volume2,
  VolumeX,
  Play,
  Pause,
  RotateCcw,
  CheckCircle,
  Download,
  ShieldCheck,
  Split,
  Layers,
  FileText,
  Sliders,
} from 'lucide-react';
import { QRDisplay } from './components/QRDisplay';
import { Scanner } from './components/Scanner';
import { PacketGrid } from './components/PacketGrid';
import { prepareFileForTransfer, DEFAULT_CHUNK_SIZE, DEFAULT_WINDOW_SIZE, type PreparedTransfer } from './protocol/sender';
import { ReceiverEngine } from './protocol/receiver';
import { playAudioFeedback } from './protocol/crc32';
import type { InitFrame, DataFrame, AckFrame, FinFrame, ProtocolFrame, TransferMode, TransferRole } from './protocol/types';

export function App() {
  // App Modes & Global States
  const [role, setRole] = useState<TransferRole>('IDLE');
  const [mode, setMode] = useState<TransferMode>('SPLIT_DUPLEX');
  const [audioFeedback, setAudioFeedback] = useState<boolean>(true);
  const [fpsSetting, setFpsSetting] = useState<number>(12); // Transmission rate (12 FPS default)
  const [chunkSizeSetting, setChunkSizeSetting] = useState<number>(DEFAULT_CHUNK_SIZE);
  const [windowSizeSetting, setWindowSizeSetting] = useState<number>(DEFAULT_WINDOW_SIZE);

  // Sender States
  const [prepared, setPrepared] = useState<PreparedTransfer | null>(null);
  const [currentFramePayload, setCurrentFramePayload] = useState<string>('');
  const [windowStart, setWindowStart] = useState<number>(0);
  const [unackedIndices, setUnackedIndices] = useState<number[]>([]);
  const [senderCarouselIndex, setSenderCarouselIndex] = useState<number>(0);
  const [isSendingPaused, setIsSendingPaused] = useState<boolean>(false);
  const [isHalfDuplexAckScanning, setIsHalfDuplexAckScanning] = useState<boolean>(false);
  const [halfDuplexScanTimer, setHalfDuplexScanTimer] = useState<number>(0);
  const [transferComplete, setTransferComplete] = useState<boolean>(false);

  // Receiver States
  const receiverEngineRef = useRef<ReceiverEngine>(new ReceiverEngine());
  const [receiverInit, setReceiverInit] = useState<InitFrame | null>(null);
  const [receivedSet, setReceivedSet] = useState<Set<number>>(new Set());
  const [receiverSpeed, setReceiverSpeed] = useState<number>(0);
  const [receiverBytes, setReceiverBytes] = useState<number>(0);
  const [downloadReady, setDownloadReady] = useState<{ url: string; fileName: string } | null>(null);
  const [currentAckPayload, setCurrentAckPayload] = useState<string>('');
  const [isReceiverDone, setIsReceiverDone] = useState<boolean>(false);

  // Sound feedback helper
  const triggerSound = useCallback((type: 'ack' | 'complete' | 'packet' | 'error') => {
    if (audioFeedback) {
      playAudioFeedback(type);
    }
  }, [audioFeedback]);

  // -------------------------------------------------------------
  // File Picker / Dropper (Sender)
  // -------------------------------------------------------------
  const handleFileSelected = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result instanceof ArrayBuffer) {
        const fileBytes = new Uint8Array(e.target.result);
        const prep = prepareFileForTransfer(file, fileBytes, chunkSizeSetting, windowSizeSetting);
        setPrepared(prep);
        setRole('SENDER');
        setWindowStart(0);
        setTransferComplete(false);
        setIsSendingPaused(false);

        // Initial unacknowledged batch is the first window: [0 ... win-1]
        const firstBatch: number[] = [];
        const winLimit = Math.min(prep.initFrame.win, prep.totalChunks);
        for (let i = 0; i < winLimit; i++) {
          firstBatch.push(i);
        }
        setUnackedIndices(firstBatch);
        setSenderCarouselIndex(0);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // -------------------------------------------------------------
  // Sender Frame Cycle Engine
  // -------------------------------------------------------------
  useEffect(() => {
    if (role !== 'SENDER' || !prepared || isSendingPaused || transferComplete) return;

    // In Half-Duplex mode, sender alternates: flash batch -> scan for ACK
    if (mode === 'HALF_DUPLEX' && isHalfDuplexAckScanning) {
      return;
    }

    const intervalTime = Math.max(30, Math.round(1000 / fpsSetting));

    const cycleInterval = setInterval(() => {
      // 1. If we are at the very beginning of the transfer, announce INIT frame
      if (windowStart === 0 && unackedIndices.length === prepared.totalChunks && senderCarouselIndex === 0) {
        setCurrentFramePayload(JSON.stringify(prepared.initFrame));
        setSenderCarouselIndex((prev) => prev + 1);
        return;
      }

      // 2. Transmit DATA chunks in current unacknowledged window
      if (unackedIndices.length > 0) {
        const activeIdx = unackedIndices[senderCarouselIndex % unackedIndices.length];
        const dataChunk = prepared.dataFrames[activeIdx];
        if (dataChunk) {
          setCurrentFramePayload(JSON.stringify(dataChunk));
        }

        const nextCarouselIdx = senderCarouselIndex + 1;
        setSenderCarouselIndex(nextCarouselIdx);

        // In Half-Duplex mode: after cycling through the entire batch 2 times, pause to scan for ACK
        if (mode === 'HALF_DUPLEX' && nextCarouselIdx % (unackedIndices.length * 2) === 0) {
          setIsHalfDuplexAckScanning(true);
          setHalfDuplexScanTimer(3); // Scan camera for 3 seconds
        }
      }
    }, intervalTime);

    return () => clearInterval(cycleInterval);
  }, [
    role,
    prepared,
    isSendingPaused,
    transferComplete,
    mode,
    isHalfDuplexAckScanning,
    fpsSetting,
    unackedIndices,
    senderCarouselIndex,
    windowStart,
  ]);

  // Half-duplex countdown timer
  useEffect(() => {
    if (!isHalfDuplexAckScanning) return;
    const t = setInterval(() => {
      setHalfDuplexScanTimer((prev) => {
        if (prev <= 1) {
          setIsHalfDuplexAckScanning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [isHalfDuplexAckScanning]);

  // -------------------------------------------------------------
  // Sender ACK Processor (Decodes Receiver's ACK)
  // -------------------------------------------------------------
  const handleSenderCameraDecoded = useCallback((data: string) => {
    if (!prepared || transferComplete) return;

    try {
      const parsed: ProtocolFrame = JSON.parse(data);

      if (parsed.t === 'ACK' && parsed.id === prepared.initFrame.id) {
        const ack = parsed as AckFrame;

        // Process advance in window
        if (ack.next > windowStart || ack.got.length > 0) {
          triggerSound('ack');

          const newWindowStart = ack.next;
          setWindowStart(newWindowStart);

          // Check if all chunks have been received
          if (newWindowStart >= prepared.totalChunks) {
            setTransferComplete(true);
            triggerSound('complete');
            confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
            return;
          }

          // Compute new unacknowledged indices for the next batch
          // Include any missing chunks in current batch + new chunks up to window size
          const nextWindowEnd = Math.min(newWindowStart + prepared.initFrame.win, prepared.totalChunks);
          const nextBatch: number[] = [];

          // First retransmit missing frames
          if (ack.missing && ack.missing.length > 0) {
            ack.missing.forEach((m) => nextBatch.push(m));
          }

          // Then append forward chunks
          for (let i = newWindowStart; i < nextWindowEnd; i++) {
            if (!nextBatch.includes(i)) {
              nextBatch.push(i);
            }
          }

          setUnackedIndices(nextBatch);
          setSenderCarouselIndex(0);

          // Resume half-duplex sending immediately upon receiving ACK
          if (mode === 'HALF_DUPLEX') {
            setIsHalfDuplexAckScanning(false);
          }
        }
      } else if (parsed.t === 'FIN' && parsed.id === prepared.initFrame.id) {
        setTransferComplete(true);
        triggerSound('complete');
        confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });
      }
    } catch {
      // Ignore non-protocol optical noise
    }
  }, [prepared, transferComplete, windowStart, triggerSound, mode]);

  // -------------------------------------------------------------
  // Receiver Optical Processor (Decodes Sender's Stream)
  // -------------------------------------------------------------
  const handleReceiverCameraDecoded = useCallback((data: string) => {
    if (isReceiverDone) return;

    try {
      const parsed: ProtocolFrame = JSON.parse(data);
      const engine = receiverEngineRef.current;

      if (parsed.t === 'INIT') {
        const init = parsed as InitFrame;
        const isNew = engine.handleInit(init);
        if (isNew) {
          setReceiverInit(init);
          setReceivedSet(new Set());
          setRole('RECEIVER');
          setDownloadReady(null);
          setIsReceiverDone(false);
          triggerSound('packet');
        }
      } else if (parsed.t === 'DATA') {
        const frame = parsed as DataFrame;

        // Auto-adopt receiver role if INIT frame was missed but we have valid ID
        if (!receiverInit && !engine.initFrame) {
          return;
        }

        const res = engine.handleData(frame);
        if (res.isNew) {
          triggerSound('packet');
          const newSet = new Set(engine.chunks.keys());
          setReceivedSet(newSet);
          setReceiverSpeed(engine.getSpeedKBps());
          setReceiverBytes(engine.totalBytesReceived);

          // Generate updated ACK
          const ackData = engine.generateAck();
          if (ackData) {
            const ackFrame: AckFrame = {
              t: 'ACK',
              id: engine.initFrame!.id,
              got: ackData.got,
              missing: ackData.missing,
              next: ackData.next,
            };
            setCurrentAckPayload(JSON.stringify(ackFrame));
          }

          // Check if file is completely received
          if (engine.isComplete()) {
            setIsReceiverDone(true);
            triggerSound('complete');
            confetti({ particleCount: 150, spread: 80, origin: { y: 0.6 } });

            const result = engine.assembleAndDecompress();
            const url = URL.createObjectURL(result.blob);
            setDownloadReady({ url, fileName: result.fileName });

            // Transmit FIN frame
            const finFrame: FinFrame = {
              t: 'FIN',
              id: engine.initFrame!.id,
              status: 'COMPLETE',
            };
            setCurrentAckPayload(JSON.stringify(finFrame));

            // Trigger auto-download
            const downloadLink = document.createElement('a');
            downloadLink.href = url;
            downloadLink.download = result.fileName;
            document.body.appendChild(downloadLink);
            downloadLink.click();
            document.body.removeChild(downloadLink);
          }
        }
      }
    } catch {
      // Ignore optical noise
    }
  }, [isReceiverDone, receiverInit, triggerSound]);

  // Reset session
  const handleResetSession = () => {
    receiverEngineRef.current.reset();
    setRole('IDLE');
    setPrepared(null);
    setCurrentFramePayload('');
    setWindowStart(0);
    setUnackedIndices([]);
    setTransferComplete(false);
    setReceiverInit(null);
    setReceivedSet(new Set());
    setDownloadReady(null);
    setCurrentAckPayload('');
    setIsReceiverDone(false);
  };

  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100 font-sans selection:bg-emerald-500 selection:text-black">
      {/* Top Navbar */}
      <header className="sticky top-0 z-50 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-md px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center font-black text-black text-lg shadow-lg shadow-emerald-500/20">
              QJ
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold tracking-tight text-white m-0">QRJump</h1>
                <span className="text-[10px] font-mono uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-semibold">
                  Air-Gapped Optical
                </span>
              </div>
              <p className="text-[11px] text-zinc-400">Bidirectional optical file transfer over screen-to-camera</p>
            </div>
          </div>

          {/* Quick Header Controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAudioFeedback(!audioFeedback)}
              title={audioFeedback ? 'Sound FX On' : 'Sound FX Muted'}
              className="p-2 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white transition hover:bg-zinc-800"
            >
              {audioFeedback ? <Volume2 className="w-4 h-4 text-emerald-400" /> : <VolumeX className="w-4 h-4 text-zinc-500" />}
            </button>

            <button
              onClick={() => setMode(mode === 'SPLIT_DUPLEX' ? 'HALF_DUPLEX' : 'SPLIT_DUPLEX')}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs font-semibold text-zinc-300 hover:text-white transition hover:bg-zinc-800"
            >
              {mode === 'SPLIT_DUPLEX' ? <Split className="w-3.5 h-3.5 text-teal-400" /> : <Layers className="w-3.5 h-3.5 text-amber-400" />}
              <span>{mode === 'SPLIT_DUPLEX' ? 'Simultaneous Duplex' : 'Alternating Half-Duplex'}</span>
            </button>

            {role !== 'IDLE' && (
              <button
                onClick={handleResetSession}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 text-xs font-semibold text-zinc-200 transition"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Reset</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Screen Brightness & Offline Warning Banner */}
      <div className="bg-emerald-950/40 border-b border-emerald-800/30 px-4 py-2">
        <div className="max-w-7xl mx-auto flex items-center justify-between text-xs text-emerald-300/90">
          <div className="flex items-center gap-2">
            <Sun className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              <strong>Optical Tip:</strong> Maximize screen brightness on both devices and hold cameras steady at ~15–25 cm distance.
            </span>
          </div>
          <div className="hidden md:flex items-center gap-1.5 text-emerald-400/80 font-mono text-[11px]">
            <ShieldCheck className="w-3.5 h-3.5" /> Zero network connections required (100% offline)
          </div>
        </div>
      </div>

      {/* Main Workspace Area */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-4 md:p-6 space-y-6">
        {/* Role Selection / Hero (Shown when Idle) */}
        {role === 'IDLE' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch pt-4">
            {/* Sender Dropzone Card */}
            <div className="flex flex-col justify-between p-6 rounded-3xl bg-zinc-900/60 border-2 border-dashed border-zinc-800 hover:border-emerald-500/50 transition-all duration-300 group">
              <div>
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-4 group-hover:scale-110 transition duration-200">
                  <ArrowUpRight className="w-6 h-6" />
                </div>
                <h2 className="text-xl font-bold text-white mb-2">Send File (Optical Transmitter)</h2>
                <p className="text-sm text-zinc-400 leading-relaxed mb-6">
                  Compresses and streams your file into animated optical QR frames. The receiver will scan this screen and flash back real-time ACK confirmations.
                </p>

                {/* File Upload Zone */}
                <label className="flex flex-col items-center justify-center p-8 rounded-2xl bg-zinc-950/80 border border-zinc-800 cursor-pointer hover:border-emerald-500/40 transition">
                  <Upload className="w-8 h-8 text-emerald-400 mb-2 group-hover:animate-bounce" />
                  <span className="text-sm font-semibold text-zinc-200">Choose or drop any file here</span>
                  <span className="text-xs text-zinc-500 mt-1 font-mono">PNG, PDF, ZIP, TXT, APK, BIN, etc.</span>
                  <input
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files?.[0]) handleFileSelected(e.target.files[0]);
                    }}
                  />
                </label>
              </div>

              {/* Tuning Parameters */}
              <div className="mt-6 pt-4 border-t border-zinc-800/80 flex flex-wrap items-center justify-between text-xs text-zinc-400 gap-4">
                <div className="flex items-center gap-2">
                  <Sliders className="w-3.5 h-3.5 text-zinc-500" />
                  <span>Speed:</span>
                  <select
                    value={fpsSetting}
                    onChange={(e) => setFpsSetting(Number(e.target.value))}
                    className="bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs rounded px-2 py-1"
                  >
                    <option value={8}>8 FPS (Ultra Stable)</option>
                    <option value={12}>12 FPS (Recommended)</option>
                    <option value={15}>15 FPS (Fast Focus)</option>
                    <option value={20}>20 FPS (High-end Cams)</option>
                  </select>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-zinc-500">Chunk:</span>
                    <select
                      value={chunkSizeSetting}
                      onChange={(e) => setChunkSizeSetting(Number(e.target.value))}
                      className="bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs rounded px-1.5 py-0.5"
                    >
                      <option value={180}>180B (Ultra Chunky / Easy Scan)</option>
                      <option value={240}>240B (Recommended)</option>
                      <option value={350}>350B (Dense)</option>
                      <option value={450}>450B (Max Capacity)</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-zinc-500">Win:</span>
                    <select
                      value={windowSizeSetting}
                      onChange={(e) => setWindowSizeSetting(Number(e.target.value))}
                      className="bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs rounded px-1.5 py-0.5"
                    >
                      <option value={6}>6</option>
                      <option value={10}>10</option>
                      <option value={16}>16</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {/* Receiver Standby Card */}
            <div className="flex flex-col justify-between p-6 rounded-3xl bg-zinc-900/60 border border-zinc-800 hover:border-teal-500/50 transition-all duration-300 group">
              <div>
                <div className="w-12 h-12 rounded-2xl bg-teal-500/10 border border-teal-500/30 flex items-center justify-center text-teal-400 mb-4 group-hover:scale-110 transition duration-200">
                  <ArrowDownLeft className="w-6 h-6" />
                </div>
                <h2 className="text-xl font-bold text-white mb-2">Receive File (Optical Scanner)</h2>
                <p className="text-sm text-zinc-400 leading-relaxed mb-6">
                  Points camera at the transmitter screen to decode frames, reassembles chunks with CRC32 integrity verification, and transmits interactive ACK confirmations.
                </p>

                {/* Instant Standby Receiver Camera */}
                <div className="rounded-2xl overflow-hidden">
                  <Scanner
                    onScan={handleReceiverCameraDecoded}
                    label="Standby Camera Receiver"
                    badge="WAITING FOR SENDER QR"
                  />
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-zinc-800/80 flex items-center justify-between text-xs text-zinc-400">
                <span className="flex items-center gap-1.5 text-zinc-400">
                  <span className="w-2 h-2 rounded-full bg-teal-400 animate-ping inline-block" />
                  Auto-detects incoming transfer streams
                </span>
                <span className="text-[11px] font-mono text-zinc-500">jsQR + fflate</span>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* SENDER ACTIVE VIEW                                        */}
        {/* ========================================================= */}
        {role === 'SENDER' && prepared && (
          <div className="space-y-6">
            {/* Top Sender Control Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-2xl bg-zinc-900/80 border border-zinc-800">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">{prepared.initFrame.name}</h3>
                  <p className="text-xs text-zinc-400 font-mono">
                    Session: {prepared.initFrame.id} • Window: [{windowStart} ... {Math.min(windowStart + prepared.initFrame.win, prepared.totalChunks) - 1}] / {prepared.totalChunks} chunks
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => setIsSendingPaused(!isSendingPaused)}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-200 border border-zinc-700 transition"
                >
                  {isSendingPaused ? <Play className="w-3.5 h-3.5 text-emerald-400 fill-current" /> : <Pause className="w-3.5 h-3.5" />}
                  <span>{isSendingPaused ? 'Resume Stream' : 'Pause'}</span>
                </button>

                <div className="flex items-center gap-1.5 bg-zinc-950 px-3 py-1.5 rounded-xl border border-zinc-800 text-xs">
                  <span className="text-zinc-500">Speed:</span>
                  <select
                    value={fpsSetting}
                    onChange={(e) => setFpsSetting(Number(e.target.value))}
                    className="bg-transparent text-emerald-400 font-mono font-bold focus:outline-none"
                  >
                    <option value={8}>8 FPS</option>
                    <option value={12}>12 FPS</option>
                    <option value={15}>15 FPS</option>
                    <option value={20}>20 FPS</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Split Screen Transmission Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
              {/* Left Column: Transmitter QR Display */}
              <div className="space-y-3">
                {mode === 'HALF_DUPLEX' && isHalfDuplexAckScanning ? (
                  <div className="flex flex-col items-center justify-center p-8 rounded-2xl bg-zinc-900 border border-amber-500/30 text-center min-h-[360px]">
                    <div className="w-12 h-12 rounded-full border-2 border-amber-400 border-t-transparent animate-spin mb-4" />
                    <h4 className="text-base font-bold text-amber-300">Scanning for Receiver's ACK</h4>
                    <p className="text-xs text-zinc-400 max-w-xs mt-1">
                      Batch finished. Aim this device's camera at the receiver's screen to read ACK confirmation ({halfDuplexScanTimer}s left).
                    </p>
                  </div>
                ) : (
                  <QRDisplay
                    data={currentFramePayload || JSON.stringify(prepared.initFrame)}
                    size={340}
                    label={`Chunk #${unackedIndices[senderCarouselIndex % (unackedIndices.length || 1)] ?? 0} of ${prepared.totalChunks}`}
                    sublabel={`Carousel Rate: ${fpsSetting} FPS • Unacked in Window: ${unackedIndices.length}`}
                    badge={transferComplete ? 'TRANSFER COMPLETE' : 'TRANSMITTING'}
                  />
                )}
              </div>

              {/* Right Column: Camera Viewfinder (Scanning Receiver's ACK) */}
              <div className="space-y-4">
                <Scanner
                  onScan={handleSenderCameraDecoded}
                  label="ACK Receiver Camera"
                  badge="LISTENING FOR ACK QR"
                />

                {/* Sender Matrix Status */}
                <PacketGrid
                  initFrame={prepared.initFrame}
                  receivedIndices={new Set(Array.from({ length: windowStart }, (_, i) => i))}
                  currentWindowStart={windowStart}
                  currentWindowEnd={Math.min(windowStart + prepared.initFrame.win, prepared.totalChunks)}
                />
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* RECEIVER ACTIVE VIEW                                      */}
        {/* ========================================================= */}
        {role === 'RECEIVER' && receiverInit && (
          <div className="space-y-6">
            {/* Receiver Completion Alert */}
            {downloadReady && (
              <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/40 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-8 h-8 text-emerald-400" />
                  <div>
                    <h3 className="text-sm font-bold text-emerald-300">File Reassembled & Verified!</h3>
                    <p className="text-xs text-zinc-400">CRC32 integrity confirmed. Download started automatically.</p>
                  </div>
                </div>
                <a
                  href={downloadReady.url}
                  download={downloadReady.fileName}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs rounded-xl shadow-lg transition"
                >
                  <Download className="w-4 h-4" /> Download Again ({downloadReady.fileName})
                </a>
              </div>
            )}

            {/* Split Screen Receiver Workspace */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
              {/* Left Column: Scanning Camera for Sender Stream */}
              <div className="space-y-4">
                <Scanner
                  onScan={handleReceiverCameraDecoded}
                  label="Transmitter Scanner Feed"
                  badge={`SESSION ${receiverInit.id}`}
                />

                <PacketGrid
                  initFrame={receiverInit}
                  receivedIndices={receivedSet}
                  speedKBps={receiverSpeed}
                  bytesReceived={receiverBytes}
                />
              </div>

              {/* Right Column: Receiver ACK QR Display */}
              <div className="space-y-3">
                <QRDisplay
                  data={currentAckPayload || JSON.stringify({ t: 'ACK', id: receiverInit.id, got: [], missing: [], next: 0 })}
                  size={340}
                  label={downloadReady ? 'Transfer Complete FIN' : `Interactive ACK Window (${receivedSet.size}/${receiverInit.total})`}
                  sublabel="Transmitter reads this code to advance sliding window"
                  badge={downloadReady ? 'COMPLETE (FIN)' : 'TRANSMITTING ACK'}
                  invert={true}
                />
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800/80 bg-zinc-950 py-4 px-4 text-center text-xs text-zinc-500 font-mono">
        QRJump • 100% Offline Optical Air-Gap Protocol • Built with Bun, React, Vite & Tailwind
      </footer>
    </div>
  );
}

export default App;
