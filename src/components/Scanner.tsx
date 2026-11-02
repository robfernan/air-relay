import React, { useEffect, useRef, useState, useCallback } from 'react';
import jsQR from 'jsqr';
import { Camera, CameraOff, RefreshCw } from 'lucide-react';

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
  scanIntervalMs = 60, // ~16 FPS scanning loop
  label = 'Optical Receiver Feed',
  badge,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastDecodedTime, setLastDecodedTime] = useState<number>(0);
  const [fps, setFps] = useState<number>(0);

  const reqIdRef = useRef<number | null>(null);
  const lastScanTimeRef = useRef<number>(0);
  const frameCountRef = useRef<number>(0);
  const lastFpsCalcRef = useRef<number>(Date.now());
  const streamRef = useRef<MediaStream | null>(null);

  const startCamera = useCallback(async () => {
    setErrorMsg(null);
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }

      // Request environment (rear) camera with optimal optical scanning resolution
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        await videoRef.current.play();
      }
      setHasPermission(true);
    } catch (err: unknown) {
      console.error('Camera access error:', err);
      const msg = err instanceof Error ? err.message : 'Camera permission denied or camera not found.';
      setErrorMsg(msg);
      setHasPermission(false);
    }
  }, []);

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

  // Optical scanning loop with offscreen canvas & jsQR
  useEffect(() => {
    if (!active || !hasPermission) return;

    let isScanning = true;

    const scanFrame = () => {
      if (!isScanning) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        const now = performance.now();

        // Throttle scanning to avoid pinning the UI thread
        if (now - lastScanTimeRef.current >= scanIntervalMs) {
          lastScanTimeRef.current = now;

          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            // Process at scaled dimension for fast jsQR parsing
            const targetWidth = Math.min(640, video.videoWidth);
            const targetHeight = Math.round((targetWidth / video.videoWidth) * video.videoHeight);

            if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
              canvas.width = targetWidth;
              canvas.height = targetHeight;
            }

            ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
            const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);

            const qrCode = jsQR(imageData.data, imageData.width, imageData.height, {
              inversionAttempts: 'dontInvert',
            });

            if (qrCode && qrCode.data) {
              onScan(qrCode.data);
              setLastDecodedTime(Date.now());
            }

            frameCountRef.current++;
          }
        }

        // Calculate scanning loop FPS
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

  const isRecentlyDecoded = Date.now() - lastDecodedTime < 250;

  return (
    <div className="relative flex flex-col items-center rounded-2xl bg-zinc-900/80 border border-zinc-800 p-3 shadow-2xl backdrop-blur overflow-hidden">
      {/* Top Header */}
      <div className="w-full flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-2">
          <Camera className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">{label}</span>
        </div>
        <div className="flex items-center gap-2">
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

      {/* Video Viewfinder */}
      <div
        className={`relative w-full aspect-video bg-black rounded-xl overflow-hidden border-2 transition-colors duration-200 ${
          isRecentlyDecoded ? 'border-emerald-400 shadow-[0_0_20px_rgba(52,211,153,0.3)]' : 'border-zinc-800'
        }`}
      >
        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          muted
          playsInline
        />

        {/* Offscreen scanning canvas */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Viewfinder crosshairs and HUD */}
        {hasPermission && (
          <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center p-6">
            <div className="relative w-48 h-48 border-2 border-emerald-500/40 rounded-xl">
              {/* Corner brackets */}
              <div className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-emerald-400" />
              <div className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-emerald-400" />
              <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 border-emerald-400" />
              <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-emerald-400" />
              {/* Animated laser scan line */}
              <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_8px_#34d399] animate-scanline" />
            </div>
            <div className="absolute bottom-2 left-0 right-0 text-center">
              <span className="text-[10px] font-mono text-zinc-400/90 bg-black/60 px-2.5 py-1 rounded-full backdrop-blur-sm border border-zinc-700/50">
                ALIGN QR CODE IN RETICLE
              </span>
            </div>
          </div>
        )}

        {/* Error / Permission State */}
        {hasPermission === false && (
          <div className="absolute inset-0 bg-zinc-950 flex flex-col items-center justify-center p-4 text-center">
            <CameraOff className="w-10 h-10 text-rose-500 mb-2" />
            <p className="text-sm font-semibold text-zinc-200">Camera Unavailable</p>
            <p className="text-xs text-zinc-400 mt-1 max-w-xs">{errorMsg || 'Please grant camera access to scan.'}</p>
            <button
              onClick={startCamera}
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
