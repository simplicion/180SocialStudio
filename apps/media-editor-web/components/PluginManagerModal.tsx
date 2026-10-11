import React, { useState } from "react";
import { X, Puzzle, ShieldCheck, Cpu, Plus, Check } from "lucide-react";
import { PluginManifest } from "@workspace/video-contracts";

interface PluginManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const INSTALLED_PLUGINS: PluginManifest[] = [
  {
    id: "com.180workspace.plugin.filmgrain",
    name: "35mm Analog Film Grain",
    version: "1.2.0",
    author: "180 VFX Labs",
    description: "Hardware accelerated WGSL procedural film grain and chromatic aberration",
    capabilities: ["RENDER_GPU_SHADER", "READ_TIMELINE"],
  },
  {
    id: "com.180workspace.plugin.autopunch",
    name: "Auto-Punch Zoom Pro",
    version: "2.0.1",
    author: "Creator Tools",
    description: "Harmonic spring physics auto-zooms centered on focal points",
    capabilities: ["WRITE_COMMANDS", "CUSTOM_DIRECTOR_STYLE"],
  },
  {
    id: "com.180workspace.plugin.discordhook",
    name: "Discord & Slack Render Webhook",
    version: "1.0.0",
    author: "Automation Guild",
    description: "Pings Discord channel with render statistics upon export completion",
    capabilities: ["EXPORT_HOOK"],
  },
];

export const PluginManagerModal: React.FC<PluginManagerModalProps> = ({ isOpen, onClose }) => {
  const [plugins, setPlugins] = useState(INSTALLED_PLUGINS);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 select-none">
      <div className="w-full max-w-2xl bg-surface border border-surface-border rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="p-4 border-b border-surface-border flex items-center justify-between">
          <div className="flex items-center space-x-2 text-indigo-400">
            <Puzzle className="w-5 h-5" />
            <div>
              <h3 className="text-sm font-semibold text-gray-100">Sandboxed Plugin & Extension SDK</h3>
              <p className="text-[11px] text-gray-400">ADR-011 Capability-based sandboxed extensions</p>
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
        <div className="p-6 space-y-4 max-h-[450px] overflow-y-auto">
          <div className="space-y-3">
            {plugins.map((plugin) => (
              <div
                key={plugin.id}
                className="p-4 rounded-xl bg-surface-subtle border border-surface-border space-y-2"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center space-x-2">
                      <h4 className="text-xs font-bold text-gray-100">{plugin.name}</h4>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-surface border border-surface-border text-gray-400">
                        v{plugin.version}
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-400 mt-0.5">{plugin.description}</p>
                  </div>
                  <span className="flex items-center space-x-1 text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full font-semibold">
                    <ShieldCheck className="w-3 h-3" />
                    <span>Sandboxed</span>
                  </span>
                </div>

                <div className="pt-2 border-t border-surface-border/50 flex items-center justify-between text-[10px] text-gray-500">
                  <div className="flex items-center space-x-1">
                    <span>Capabilities:</span>
                    {plugin.capabilities.map((cap) => (
                      <span
                        key={cap}
                        className="px-1.5 py-0.5 rounded bg-surface border border-surface-border font-mono text-indigo-300"
                      >
                        {cap}
                      </span>
                    ))}
                  </div>
                  <span>By {plugin.author}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-surface-border bg-surface-subtle flex items-center justify-end">
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
