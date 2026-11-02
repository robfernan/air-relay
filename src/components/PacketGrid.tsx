import React from 'react';
import { Zap, HardDrive, Hash } from 'lucide-react';
import type { InitFrame } from '../protocol/types';

interface PacketGridProps {
  initFrame: InitFrame | null;
  receivedIndices: Set<number>;
  currentWindowStart?: number;
  currentWindowEnd?: number;
  speedKBps?: number;
  bytesReceived?: number;
}

export const PacketGrid: React.FC<PacketGridProps> = ({
  initFrame,
  receivedIndices,
  currentWindowStart = 0,
  currentWindowEnd = 0,
  speedKBps = 0,
  bytesReceived = 0,
}) => {
  if (!initFrame) return null;

  const total = initFrame.total;
  const receivedCount = receivedIndices.size;
  const percent = total > 0 ? Math.round((receivedCount / total) * 100) : 0;

  // Format file size nicely
  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="w-full bg-zinc-900/90 border border-zinc-800 rounded-2xl p-4 shadow-xl backdrop-blur">
      {/* File & Transfer Info Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-3 mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded">
              ID: {initFrame.id}
            </span>
            <span className="text-sm font-semibold text-zinc-100 truncate max-w-[200px] md:max-w-[300px]">
              {initFrame.name}
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-zinc-400 mt-1">
            <span className="flex items-center gap-1">
              <HardDrive className="w-3.5 h-3.5 text-zinc-500" />
              {formatBytes(initFrame.size)} ({formatBytes(initFrame.compSize)} gz)
            </span>
            <span className="flex items-center gap-1">
              <Hash className="w-3.5 h-3.5 text-zinc-500" />
              {total} chunks
            </span>
          </div>
        </div>

        {/* Live Metrics */}
        <div className="flex items-center gap-4 text-xs font-mono">
          {bytesReceived > 0 && (
            <div className="text-right hidden sm:block">
              <span className="text-zinc-500 block text-[10px] uppercase">Received</span>
              <span className="text-zinc-300">{formatBytes(bytesReceived)}</span>
            </div>
          )}
          <div className="text-right">
            <span className="text-zinc-500 block text-[10px] uppercase">Speed</span>
            <span className="text-emerald-400 font-semibold flex items-center justify-end gap-1">
              <Zap className="w-3.5 h-3.5 fill-current" />
              {speedKBps} KB/s
            </span>
          </div>
          <div className="text-right">
            <span className="text-zinc-500 block text-[10px] uppercase">Progress</span>
            <span className="text-zinc-100 font-bold">{percent}%</span>
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-zinc-800 rounded-full h-2 mb-3 overflow-hidden">
        <div
          className="bg-gradient-to-r from-emerald-500 to-teal-400 h-2 rounded-full transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* Visual Packet Matrix */}
      <div className="mb-2 flex items-center justify-between text-xs text-zinc-400 font-mono">
        <span>PACKET MATRIX ({receivedCount}/{total})</span>
        <div className="flex items-center gap-2 text-[10px]">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-emerald-500 inline-block" /> Got
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-amber-500 animate-pulse inline-block" /> In Window
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-zinc-800 inline-block" /> Pending
          </span>
        </div>
      </div>

      <div className="max-h-48 overflow-y-auto p-2 bg-zinc-950/60 rounded-xl border border-zinc-800/80">
        <div className="grid grid-cols-12 sm:grid-cols-16 md:grid-cols-20 gap-1.5">
          {Array.from({ length: total }, (_, i) => {
            const isReceived = receivedIndices.has(i);
            const isInWindow = i >= currentWindowStart && i < currentWindowEnd;

            let bgClass = 'bg-zinc-800/60 text-zinc-600 border-zinc-800';
            if (isReceived) {
              bgClass = 'bg-emerald-500 text-black font-semibold border-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.3)]';
            } else if (isInWindow) {
              bgClass = 'bg-amber-500/20 text-amber-300 border-amber-500/50 animate-pulse';
            }

            return (
              <div
                key={i}
                title={`Packet #${i} ${isReceived ? '(Received)' : isInWindow ? '(Active Window)' : '(Pending)'}`}
                className={`h-6 rounded flex items-center justify-center text-[10px] font-mono border transition-all duration-150 ${bgClass}`}
              >
                {i}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
