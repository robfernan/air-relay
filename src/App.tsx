import { useState } from 'react';
import { Volume2, VolumeX, ShieldCheck, Zap, ExternalLink } from 'lucide-react';
import { PeerDrop } from './components/PeerDrop';

export function App() {
  const [audioFeedback, setAudioFeedback] = useState<boolean>(true);

  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100 font-sans selection:bg-cyan-500 selection:text-black">
      {/* Top Navbar */}
      <header className="sticky top-0 z-50 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-md px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-cyan-500 to-teal-400 flex items-center justify-center font-black text-black text-lg shadow-lg shadow-cyan-500/20">
              AR
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold tracking-tight text-white m-0">AirRelay</h1>
                <span className="text-[10px] font-mono uppercase bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-2 py-0.5 rounded-full font-semibold">
                  P2P Transport
                </span>
              </div>
              <p className="text-[11px] text-zinc-400">Direct encrypted browser-to-browser file transfer</p>
            </div>
          </div>

          {/* Header Controls */}
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.open(window.location.href, '_blank');
                }
              }}
              title="Open in Full Tab / Full Window"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs font-semibold text-zinc-300 hover:text-white hover:bg-zinc-800 transition"
            >
              <ExternalLink className="w-3.5 h-3.5 text-cyan-400" />
              <span className="hidden sm:inline">Open in Tab</span>
            </button>

            <div className="hidden md:flex items-center gap-1.5 text-emerald-400 font-mono text-xs bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-xl">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Zero-Cloud P2P</span>
            </div>

            <button
              onClick={() => setAudioFeedback(!audioFeedback)}
              title={audioFeedback ? 'Sound FX Enabled' : 'Sound FX Muted'}
              className="p-2 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white transition hover:bg-zinc-800"
            >
              {audioFeedback ? <Volume2 className="w-4 h-4 text-cyan-400" /> : <VolumeX className="w-4 h-4 text-zinc-500" />}
            </button>
          </div>
        </div>
      </header>

      {/* Security Banner */}
      <div className="bg-cyan-950/20 border-b border-cyan-800/20 px-4 py-2">
        <div className="max-w-7xl mx-auto flex items-center justify-between text-xs text-cyan-300/80">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>
              <strong>Direct Stream:</strong> Data travels straight device-to-device through encrypted WebRTC memory sockets. No files ever touch a server.
            </span>
          </div>
          <span className="hidden md:inline font-mono text-[11px] text-zinc-400">
            No Discord limits • No accounts
          </span>
        </div>
      </div>

      {/* Main App */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-4 md:p-6 flex flex-col justify-center">
        <PeerDrop />
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800/80 bg-zinc-950 py-4 px-4 text-center text-xs text-zinc-500 font-mono">
        AirRelay • Zero-Cloud P2P File Transport • Built with Bun, React, WebRTC & Tailwind
      </footer>
    </div>
  );
}

export default App;
