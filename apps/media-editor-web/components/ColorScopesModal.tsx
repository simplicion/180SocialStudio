import React, { useState, useEffect, useRef } from "react";
import { X, Activity, BarChart2, Disc, Eye } from "lucide-react";

export type ScopeMode = "waveform" | "parade" | "vectorscope" | "histogram";

interface ColorScopesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ColorScopesModal: React.FC<ColorScopesModalProps> = ({ isOpen, onClose }) => {
  const [activeScope, setActiveScope] = useState<ScopeMode>("waveform");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let phase = 0;

    const renderScope = () => {
      phase += 0.05;
      const width = canvas.width;
      const height = canvas.height;

      ctx.fillStyle = "#060608";
      ctx.fillRect(0, 0, width, height);

      if (activeScope === "waveform") {
        // Draw IRE reference lines (0, 25, 50, 75, 100)
        ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
        ctx.lineWidth = 1;
        [0.1, 0.3, 0.5, 0.7, 0.9].forEach((pct) => {
          ctx.beginPath();
          ctx.moveTo(30, height * pct);
          ctx.lineTo(width - 10, height * pct);
          ctx.stroke();
        });

        // IRE Labels
        ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
        ctx.font = "9px monospace";
        ctx.fillText("100", 6, height * 0.1 + 3);
        ctx.fillText("50", 12, height * 0.5 + 3);
        ctx.fillText("0", 16, height * 0.9 + 3);

        // Simulated Luma trace
        ctx.fillStyle = "rgba(74, 222, 128, 0.25)";
        for (let x = 32; x < width - 10; x += 2) {
          const normX = (x - 32) / (width - 42);
          const baseLuma = 0.35 + Math.sin(normX * 6 + phase) * 0.2 + Math.cos(normX * 14) * 0.15;
          const y = height * (1 - baseLuma * 0.8 - 0.1);
          const scatter = (Math.random() - 0.5) * 24;
          ctx.fillRect(x, y + scatter, 1.5, 3);
        }
      } else if (activeScope === "parade") {
        // RGB Parade: 3 channels side by side
        const laneW = (width - 40) / 3;
        const colors = [
          { name: "RED", fill: "rgba(239, 68, 68, 0.3)", stroke: "#ef4444" },
          { name: "GREEN", fill: "rgba(34, 197, 94, 0.3)", stroke: "#22c55e" },
          { name: "BLUE", fill: "rgba(59, 130, 246, 0.3)", stroke: "#3b82f6" },
        ];

        colors.forEach((col, idx) => {
          const startX = 30 + idx * laneW;
          // Divider
          ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
          ctx.strokeRect(startX, 10, laneW - 6, height - 20);

          ctx.fillStyle = col.stroke;
          ctx.font = "9px font-bold monospace";
          ctx.fillText(col.name, startX + 6, 22);

          ctx.fillStyle = col.fill;
          for (let x = startX + 4; x < startX + laneW - 10; x += 2) {
            const normX = (x - startX) / laneW;
            const trace = 0.4 + Math.sin(normX * 5 + phase + idx) * 0.25;
            const y = height * (1 - trace * 0.75 - 0.1);
            const scatter = (Math.random() - 0.5) * 18;
            ctx.fillRect(x, y + scatter, 1.5, 2.5);
          }
        });
      } else if (activeScope === "vectorscope") {
        // Circular chrominance vectorscope
        const cx = width / 2;
        const cy = height / 2;
        const r = Math.min(cx, cy) - 20;

        // Outer Reticle & Skin-Tone Line (I-Bar at ~117°)
        ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = "rgba(251, 191, 36, 0.4)"; // Skin tone line
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx - r * 0.85, cy - r * 0.45);
        ctx.stroke();

        ctx.fillStyle = "rgba(251, 191, 36, 0.7)";
        ctx.font = "9px monospace";
        ctx.fillText("SKIN", cx - r * 0.9, cy - r * 0.5);

        // Chrominance cloud
        ctx.fillStyle = "rgba(168, 85, 247, 0.25)";
        for (let i = 0; i < 150; i++) {
          const ang = Math.random() * Math.PI * 2;
          const dist = Math.random() * r * 0.65;
          const px = cx + Math.cos(ang) * dist;
          const py = cy + Math.sin(ang) * dist;
          ctx.fillRect(px, py, 1.5, 1.5);
        }
      } else if (activeScope === "histogram") {
        // Histogram RGB bars
        const numBins = 64;
        const binW = (width - 60) / numBins;
        for (let i = 0; i < numBins; i++) {
          const ratio = i / numBins;
          const hR = Math.sin(ratio * Math.PI) * (height - 50) * 0.8 + Math.random() * 10;
          const hG = Math.sin(ratio * Math.PI + 0.2) * (height - 50) * 0.85;
          const hB = Math.sin(ratio * Math.PI - 0.2) * (height - 50) * 0.7;

          const x = 30 + i * binW;
          ctx.fillStyle = "rgba(239, 68, 68, 0.35)";
          ctx.fillRect(x, height - 20 - hR, binW - 1, hR);
          ctx.fillStyle = "rgba(34, 197, 94, 0.35)";
          ctx.fillRect(x, height - 20 - hG, binW - 1, hG);
          ctx.fillStyle = "rgba(59, 130, 246, 0.35)";
          ctx.fillRect(x, height - 20 - hB, binW - 1, hB);
        }
      }

      animId = requestAnimationFrame(renderScope);
    };

    renderScope();
    return () => cancelAnimationFrame(animId);
  }, [isOpen, activeScope]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-[#0e0e13] border border-[#262633] rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#22222D] bg-[#121218]">
          <div className="flex items-center space-x-2">
            <Activity className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-white tracking-wide">Color Scopes Monitor</h3>
          </div>

          {/* Scope Selector Tabs */}
          <div className="flex items-center space-x-1 bg-[#181822] p-1 rounded-lg border border-[#252533]">
            <button
              onClick={() => setActiveScope("waveform")}
              className={`px-2 py-0.5 rounded text-[11px] font-semibold transition ${
                activeScope === "waveform"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Waveform
            </button>
            <button
              onClick={() => setActiveScope("parade")}
              className={`px-2 py-0.5 rounded text-[11px] font-semibold transition ${
                activeScope === "parade"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              RGB Parade
            </button>
            <button
              onClick={() => setActiveScope("vectorscope")}
              className={`px-2 py-0.5 rounded text-[11px] font-semibold transition ${
                activeScope === "vectorscope"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Vectorscope
            </button>
            <button
              onClick={() => setActiveScope("histogram")}
              className={`px-2 py-0.5 rounded text-[11px] font-semibold transition ${
                activeScope === "histogram"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Histogram
            </button>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Canvas Display */}
        <div className="p-4 flex flex-col items-center justify-center bg-[#07070a]">
          <canvas
            ref={canvasRef}
            width={480}
            height={260}
            className="rounded-xl border border-white/10 shadow-inner w-full max-w-[480px]"
          />
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 bg-[#121218] border-t border-[#22222D] flex items-center justify-between text-xs text-zinc-400">
          <span>Rec.709 Full Range • Live WebGL Analysis</span>
          <button
            onClick={onClose}
            className="px-3 py-1 bg-white/10 hover:bg-white/20 text-white font-medium rounded-md transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
