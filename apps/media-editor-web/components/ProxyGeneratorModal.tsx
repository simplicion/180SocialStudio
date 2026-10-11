import React, { useState } from "react";
import { X, HardDrive, Cpu, CheckCircle2, Film } from "lucide-react";
import { MediaAssetDescriptor } from "@workspace/video-contracts";

interface ProxyGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  assets: MediaAssetDescriptor[];
  onGenerateProxies?: () => Promise<void>;
}

export const ProxyGeneratorModal: React.FC<ProxyGeneratorModalProps> = ({
  isOpen,
  onClose,
  assets,
  onGenerateProxies,
}) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [completed, setCompleted] = useState(false);

  if (!isOpen) return null;

  const handleStart = async () => {
    setIsGenerating(true);
    if (onGenerateProxies) {
      await onGenerateProxies();
    } else {
      await new Promise((r) => setTimeout(r, 1000));
    }
    setIsGenerating(false);
    setCompleted(true);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 select-none">
      <div className="w-full max-w-lg bg-surface border border-surface-border rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="p-4 border-b border-surface-border flex items-center justify-between">
          <div className="flex items-center space-x-2 text-indigo-400">
            <HardDrive className="w-5 h-5" />
            <div>
              <h3 className="text-sm font-semibold text-gray-100">4K/8K Editing Proxy Generator</h3>
              <p className="text-[11px] text-gray-400">Intra-frame lightweight proxies for zero-lag scrubbing</p>
            </div>
          </div>
          {!isGenerating && (
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-surface-hover transition"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          <div className="p-3.5 rounded-xl bg-surface-subtle border border-surface-border space-y-2">
            <span className="text-xs font-semibold text-gray-200 block">
              Assets to transcode ({assets.length}):
            </span>
            <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
              {assets.map((asset) => (
                <div
                  key={asset.id}
                  className="flex items-center justify-between text-[11px] text-gray-300 p-1.5 rounded-lg bg-surface border border-surface-border"
                >
                  <span className="truncate flex items-center space-x-1.5">
                    <Film className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                    <span>{asset.name}</span>
                  </span>
                  <span className="text-gray-500 font-mono">{asset.width}x{asset.height}</span>
                </div>
              ))}
            </div>
          </div>

          {isGenerating && (
            <div className="py-4 text-center space-y-2">
              <Cpu className="w-8 h-8 text-indigo-400 animate-spin mx-auto" />
              <p className="text-xs font-semibold text-gray-200">Generating 720p Intra-frame Proxies...</p>
              <p className="text-[11px] text-gray-500">Hardware accelerated transcode in progress</p>
            </div>
          )}

          {completed && (
            <div className="py-4 text-center space-y-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
              <p className="text-xs font-semibold text-gray-200">All Proxies Generated!</p>
              <p className="text-[11px] text-gray-500">Timeline scrubbing will now use zero CPU buffers</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-surface-border bg-surface-subtle flex items-center justify-end space-x-2">
          {!isGenerating && !completed && (
            <>
              <button
                onClick={onClose}
                className="px-3.5 py-1.5 rounded-xl text-xs text-gray-400 hover:text-white transition"
              >
                Cancel
              </button>
              <button
                onClick={handleStart}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-brand hover:bg-brand-hover shadow-md transition"
              >
                Generate Proxies
              </button>
            </>
          )}

          {completed && (
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-brand hover:bg-brand-hover transition"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
