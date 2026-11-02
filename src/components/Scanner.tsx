import React, { useEffect, useRef, useState, useCallback } from 'react';
import jsQR from 'jsqr';
import { BrowserQRCodeReader } from '@zxing/browser';
import { Camera, CameraOff, RefreshCw, SwitchCamera, CheckCircle } from 'lucide-react';

interface ScannerProps {
  onScan: (decodedText: string) => void;
  active?: boolean;
  scanIntervalMs?: number;
  label?: string;
  badge?: string;
}

export const Scanner: React.FC<ScannerProps> = ({
  onScan,
  active = true,
  scanIntervalMs = 60,
  label = 'Optical Receiver Feed',
  badge,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const zxingReaderRef = useRef<BrowserQRCodeReader | null>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastDecodedTime, setLastDecodedTime] = useState<number>(0);
  const [lastDecodedPreview, setLastDecodedPreview] = useState<string>('');
  const [fps, setFps] = useState<number>(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [activeEngine, setActiveEngine] = useState<'HYBRID' | 'ZXING' | 'JSQR'>('HYBRID');

  const reqIdRef = useRef<number | null>(null);
  const lastScanTimeRef = useRef<number>(0);
  const frameCountRef = useRef<number>(0);
  const lastFpsCalcRef = useRef<number>(Date.now());
  const streamRef = useRef<MediaStream | null>(null);

  // Initialize ZXing reader
  useEffect(() => {
    zxingReaderRef.current = new BrowserQRCodeReader();
  }, []);

  // Enumerate all available cameras
  const updateDeviceList = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const videoDevs = allDevices.filter((d) => d.kind === 'videoinput');
      setDevices(videoDevs);
    } catch {
      // Ignore enumeration failure
    }
  }, []);

  const startCamera = useCallback(async (devId?: string, currentFacing: 'environment' | 'user' = facingMode) => {
    setErrorMsg(null);
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }

      // Check if getUserMedia is supported (in insecure HTTP non-localhost it might be undefined)
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera API not accessible. When testing across devices on local Wi-Fi, browsers require HTTPS or localhost. Try Chrome with --unsafely-treat-insecure-origin-as-secure or use the Loopback Test button.');
      }

      let constraints: MediaStreamConstraints;
      if (devId) {
        constraints = {
          video: { deviceId: { exact: devId } },
          audio: false,
        };
      } else {
        constraints = {
          video: {
            facingMode: { ideal: currentFacing },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        };
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch {
        // Fallback to basic video constraint
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        videoRef.current.muted = true;
        await videoRef.current.play();
      }

      setHasPermission(true);
      await updateDeviceList();
    } catch (err: unknown) {
      console.error('Camera access error:', err);
      const msg = err instanceof Error ? err.message : 'Camera permission denied or camera not found.';
      setErrorMsg(msg);
      setHasPermission(false);
    }
  }, [facingMode, updateDeviceList]);

  const toggleCameraFacing = () => {
    const nextFacing = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextFacing);
    setSelectedDeviceId('');
    startCamera(undefined, nextFacing);
  };

  const switchSpecificDevice = (devId: string) => {
    setSelectedDeviceId(devId);
    startCamera(devId);
  };

  useEffect(() => {
    if (active) {
      startCamera();
    } else {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    }

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [active, startCamera]);

  // Dual-Engine Optical Scanner Loop: jsQR + ZXing
  useEffect(() => {
    if (!active || !hasPermission) return;

    let isScanning = true;

    const scanFrame = () => {
      if (!isScanning) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (video && canvas && video.readyState >= video.HAVE_CURRENT_DATA) {
        const now = performance.now();

        if (now - lastScanTimeRef.current >= scanIntervalMs) {
          lastScanTimeRef.current = now;

          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (ctx && video.videoWidth > 0 && video.videoHeight > 0) {
            const targetWidth = Math.min(800, video.videoWidth);
            const targetHeight = Math.round((targetWidth / video.videoWidth) * video.videoHeight);

            if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
              canvas.width = targetWidth;
              canvas.height = targetHeight;
            }

            ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
            const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);

            let decodedText: string | null = null;

            // 1. First attempt: jsQR with both inversion passes
            const qrCode = jsQR(imageData.data, imageData.width, imageData.height, {
              inversionAttempts: 'attemptBoth',
            });

            if (qrCode && qrCode.data) {
              decodedText = qrCode.data;
              setActiveEngine('JSQR');
            } else if (zxingReaderRef.current) {
              // 2. Second attempt: ZXing fallback (handles low contrast, blur, and high density screens)
              try {
                const zxResult = zxingReaderRef.current.decodeFromCanvas(canvas);
                if (zxResult && zxResult.getText()) {
                  decodedText = zxResult.getText();
                  setActiveEngine('ZXING');
                }
              } catch {
                // ZXing throws NotFoundException when no QR is in frame
              }
            }

            if (decodedText) {
              onScan(decodedText);
              setLastDecodedTime(Date.now());
              setLastDecodedPreview(decodedText.slice(0, 40) + '...');
            }

            frameCountRef.current++;
          }
        }

        const wallNow = Date.now();
        if (wallNow - lastFpsCalcRef.current >= 1000) {
          setFps(frameCountRef.current);
          frameCountRef.current = 0;
          lastFpsCalcRef.current = wallNow;
        }
      }

      reqIdRef.current = requestAnimationFrame(scanFrame);
    };

    reqIdRef.current = requestAnimationFrame(scanFrame);

    return () => {
      isScanning = false;
      if (reqIdRef.current) {
        cancelAnimationFrame(reqIdRef.current);
      }
    };
  }, [active, hasPermission, scanIntervalMs, onScan]);

  const isRecentlyDecoded = Date.now() - lastDecodedTime < 350;

  return (
    <div className="relative flex flex-col items-center rounded-2xl bg-zinc-900/80 border border-zinc-800 p-3 shadow-2xl backdrop-blur overflow-hidden">
      {/* Top Header */}
      <div className="w-full flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-2">
          <Camera className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">{label}</span>
          <span className="text-[9px] bg-zinc-800 text-teal-400 px-1.5 py-0.5 rounded font-mono border border-zinc-700">
            {activeEngine}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {devices.length > 1 && (
            <button
              onClick={toggleCameraFacing}
              title="Flip Camera (Front/Back)"
              className="flex items-center gap-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-2 py-0.5 rounded-lg border border-zinc-700 transition"
            >
              <SwitchCamera className="w-3 h-3 text-emerald-400" />
              <span>Flip</span>
            </button>
          )}
          {badge && (
            <span className="text-[10px] bg-zinc-800 border border-zinc-700 text-zinc-300 px-2 py-0.5 rounded-full font-mono">
              {badge}
            </span>
          )}
          {hasPermission && (
            <span className="text-[10px] text-zinc-400 font-mono">
              {fps} FPS
            </span>
          )}
        </div>
      </div>

      {/* Camera device picker if multiple sensors are found */}
      {devices.length > 1 && (
        <div className="w-full mb-2">
          <select
            value={selectedDeviceId}
            onChange={(e) => switchSpecificDevice(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 text-zinc-300 text-[11px] rounded-lg px-2 py-1 focus:outline-none"
          >
            <option value="">Default ({facingMode === 'environment' ? 'Back Camera' : 'Front Camera'})</option>
            {devices.map((d, idx) => (
              <option key={d.deviceId || idx} value={d.deviceId}>
                {d.label || `Camera Sensor #${idx + 1}`}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Video Viewfinder */}
      <div
        className={`relative w-full aspect-video bg-black rounded-xl overflow-hidden border-2 transition-all duration-200 ${
          isRecentlyDecoded ? 'border-emerald-400 shadow-[0_0_25px_rgba(52,211,153,0.5)]' : 'border-zinc-800'
        }`}
      >
        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          muted
          playsInline
        />

        <canvas ref={canvasRef} className="hidden" />

        {/* Viewfinder crosshairs and HUD */}
        {hasPermission && (
          <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center p-6">
            <div className="relative w-52 h-52 border-2 border-emerald-500/40 rounded-xl">
              <div className="absolute -top-1 -left-1 w-5 h-5 border-t-2 border-l-2 border-emerald-400" />
              <div className="absolute -top-1 -right-1 w-5 h-5 border-t-2 border-r-2 border-emerald-400" />
              <div className="absolute -bottom-1 -left-1 w-5 h-5 border-b-2 border-l-2 border-emerald-400" />
              <div className="absolute -bottom-1 -right-1 w-5 h-5 border-b-2 border-r-2 border-emerald-400" />
              <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_8px_#34d399] animate-scanline" />
            </div>

            <div className="absolute bottom-2 left-0 right-0 text-center px-4">
              {isRecentlyDecoded ? (
                <span className="text-[10px] font-mono text-emerald-300 bg-emerald-950/90 px-3 py-1 rounded-full border border-emerald-500 flex items-center justify-center gap-1.5 mx-auto max-w-xs truncate shadow-lg">
                  <CheckCircle className="w-3 h-3 text-emerald-400 shrink-0" />
                  READ: {lastDecodedPreview}
                </span>
              ) : (
                <span className="text-[10px] font-mono text-zinc-400/90 bg-black/60 px-2.5 py-1 rounded-full backdrop-blur-sm border border-zinc-700/50">
                  CENTER QR CODE IN RETICLE (~15-25 CM)
                </span>
              )}
            </div>
          </div>
        )}

        {/* Permission Denied / HTTP Insecure Context Warning */}
        {hasPermission === false && (
          <div className="absolute inset-0 bg-zinc-950 flex flex-col items-center justify-center p-4 text-center">
            <CameraOff className="w-10 h-10 text-rose-500 mb-2" />
            <p className="text-sm font-semibold text-zinc-200">Camera Unavailable</p>
            <p className="text-xs text-zinc-400 mt-1 max-w-sm leading-relaxed">{errorMsg}</p>
            <button
              onClick={() => startCamera()}
              className="mt-4 flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-black font-semibold text-xs rounded-lg transition"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Retry Camera
            </button>
          </div>
        )}

        {hasPermission === null && (
          <div className="absolute inset-0 bg-zinc-950 flex flex-col items-center justify-center p-4">
            <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mb-2" />
            <span className="text-xs text-zinc-400 font-mono">Initializing Camera...</span>
          </div>
        )}
      </div>
    </div>
  );
};
