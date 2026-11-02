import React, { useEffect, useRef } from 'react';
import QRCode from 'qrcode';

interface QRDisplayProps {
  data: string;
  size?: number;
  label?: string;
  sublabel?: string;
  badge?: string;
  invert?: boolean;
}

export const QRDisplay: React.FC<QRDisplayProps> = ({
  data,
  size = 320,
  label,
  sublabel,
  badge,
  invert = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!canvasRef.current || !data) return;

    // Fast, high-contrast QR generation
    QRCode.toCanvas(canvasRef.current, data, {
      width: size,
      margin: 2,
      errorCorrectionLevel: 'L', // Low redundancy allows max data per square & highest read rate
      color: {
        dark: invert ? '#FFFFFF' : '#000000',
        light: invert ? '#000000' : '#FFFFFF',
      },
    }).catch((err) => {
      console.error('QR Render Error:', err);
    });
  }, [data, size, invert]);

  return (
    <div className="flex flex-col items-center justify-center p-3 rounded-2xl bg-zinc-900/80 border border-zinc-800 shadow-2xl backdrop-blur">
      <div className="relative p-2 bg-white rounded-xl shadow-inner flex items-center justify-center">
        <canvas
          ref={canvasRef}
          width={size}
          height={size}
          className="rounded-lg max-w-full h-auto aspect-square"
          style={{ imageRendering: 'pixelated' }}
        />
        {badge && (
          <div className="absolute top-3 right-3 bg-zinc-950/90 text-emerald-400 border border-emerald-500/40 text-[10px] font-mono px-2 py-0.5 rounded-full shadow-md font-semibold tracking-wider">
            {badge}
          </div>
        )}
      </div>

      {(label || sublabel) && (
        <div className="mt-3 text-center w-full max-w-xs">
          {label && <p className="text-sm font-semibold text-zinc-100 truncate">{label}</p>}
          {sublabel && <p className="text-xs text-zinc-400 font-mono mt-0.5 truncate">{sublabel}</p>}
        </div>
      )}
    </div>
  );
};
