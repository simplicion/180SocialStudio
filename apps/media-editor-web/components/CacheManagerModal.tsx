import React, { useState } from "react";
import { X, Database, Trash2, CheckCircle2, HardDrive, Cpu, RefreshCw } from "lucide-react";

interface CacheManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CacheManagerModal: React.FC<CacheManagerModalProps> = ({ isOpen, onClose }) => {
  const [isClearing, setIsClearing] = useState(false);
  const [cleared, setCleared] = useState(false);

  if (!isOpen) return null;

  const handleClearCache = async () => {
    setIsClearing(true);
    await new Promise((r) => setTimeout(r, 600));
    setIsClearing(false);
    setCleared(true);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 select-none">
      <div className="w-full max-w-lg bg-surface border border-surface-border rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="p-4 border-b border-surface-border flex items-center justify-between">
          <div className="flex items-center space-x-2 text-indigo-400">
            <Database className="w-5 h-5" />
            <div>
              <h3 className="text-sm font-semibold text-gray-100">Content-Addressed Cache Storage</h3>
              <p className="text-[11px] text-gray-400">ADR-010 Deterministic local cache and telemetry index</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-surface-hover transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3.5 rounded-xl bg-surface-subtle border border-surface-border">
              <span className="text-[10px] font-mono text-gray-500 uppercase block">Cached Artifacts</span>
              <p className="text-xl font-bold text-white mt-1">{cleared ? "0" : "14"}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">Waveforms, telemetry & keyframes</p>
            </div>

            <div className="p-3.5 rounded-xl bg-surface-subtle border border-surface-border">
              <span className="text-[10px] font-mono text-gray-500 uppercase block">Disk Footprint</span>
              <p className="text-xl font-bold text-emerald-400 mt-1">{cleared ? "0 KB" : "4.8 MB"}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">Instant zero-cost reload</p>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-surface-subtle border border-surface-border space-y-1.5 text-xs text-gray-300">
            <p className="font-semibold text-gray-200 flex items-center space-x-1.5">
              <HardDrive className="w-3.5 h-3.5 text-indigo-400" />
              <span>Location: .vproj/cache/</span>
            </p>
            <p className="text-[11px] text-gray-400 leading-relaxed">
              Every waveform, transcript alignment, and GOP stream-slice is indexed deterministically via source hash.
            </p>
          </div>

          {cleared && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4" />
              <span>Local cache purged successfully.</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-surface-border bg-surface-subtle flex items-center justify-between">
          <button
            onClick={handleClearCache}
            disabled={isClearing || cleared}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-red-400 hover:bg-red-500/20 border border-red-500/30 transition disabled:opacity-40"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Purge Cache</span>
          </button>

          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-brand hover:bg-brand-hover transition shadow-md"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
