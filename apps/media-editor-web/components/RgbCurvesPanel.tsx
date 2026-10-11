import React, { useState, useRef, useCallback } from "react";
import { RotateCcw } from "lucide-react";

export interface CurvePoint {
  x: number; // 0 to 1
  y: number; // 0 to 1
}

export type CurvesChannel = "master" | "red" | "green" | "blue";

export interface RgbCurvesState {
  master: CurvePoint[];
  red: CurvePoint[];
  green: CurvePoint[];
  blue: CurvePoint[];
}

export const DEFAULT_RGB_CURVES: RgbCurvesState = {
  master: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
  red: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
  green: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
  blue: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
};

interface RgbCurvesPanelProps {
  curves?: RgbCurvesState;
  onChange: (curves: RgbCurvesState) => void;
}

// Generate smooth cubic bezier SVG path string through points
function buildSmoothPath(points: CurvePoint[], size: number): string {
  if (points.length < 2) return "";
  const sorted = [...points].sort((a, b) => a.x - b.x);
  let path = `M ${sorted[0].x * size} ${(1 - sorted[0].y) * size}`;

  for (let i = 0; i < sorted.length - 1; i++) {
    const p0 = sorted[Math.max(0, i - 1)];
    const p1 = sorted[i];
    const p2 = sorted[i + 1];
    const p3 = sorted[Math.min(sorted.length - 1, i + 2)];

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    path += ` C ${cp1x * size} ${(1 - cp1y) * size}, ${cp2x * size} ${(1 - cp2y) * size}, ${p2.x * size} ${(1 - p2.y) * size}`;
  }

  return path;
}

export const RgbCurvesPanel: React.FC<RgbCurvesPanelProps> = ({
  curves = DEFAULT_RGB_CURVES,
  onChange,
}) => {
  const [activeChannel, setActiveChannel] = useState<CurvesChannel>("master");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const currentPoints = curves[activeChannel] || DEFAULT_RGB_CURVES[activeChannel];
  const size = 180; // px width & height for curve canvas

  const handlePointerDown = (index: number, e: React.PointerEvent) => {
    e.stopPropagation();
    setDragIndex(index);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const handleSvgPointerDown = (e: React.PointerEvent) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / size));
    const y = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / size));

    // Check if clicked close to an existing point
    const existingIdx = currentPoints.findIndex(
      (p) => Math.hypot(p.x - x, p.y - y) < 0.08
    );
    if (existingIdx !== -1) {
      setDragIndex(existingIdx);
      return;
    }

    // Otherwise insert point
    const newPoints = [...currentPoints, { x, y }].sort((a, b) => a.x - b.x);
    onChange({
      ...curves,
      [activeChannel]: newPoints,
    });
    const newIdx = newPoints.findIndex((p) => p.x === x && p.y === y);
    setDragIndex(newIdx);
  };

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragIndex === null || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      let x = Math.max(0, Math.min(1, (e.clientX - rect.left) / size));
      let y = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / size));

      // Endpoints stay locked to x=0 and x=1
      if (dragIndex === 0) x = 0;
      else if (dragIndex === currentPoints.length - 1) x = 1;
      else {
        // Clamp between previous and next point x
        const prevX = currentPoints[dragIndex - 1]?.x ?? 0;
        const nextX = currentPoints[dragIndex + 1]?.x ?? 1;
        x = Math.max(prevX + 0.02, Math.min(nextX - 0.02, x));
      }

      const updated = currentPoints.map((p, i) => (i === dragIndex ? { x, y } : p));
      onChange({
        ...curves,
        [activeChannel]: updated,
      });
    },
    [dragIndex, currentPoints, activeChannel, curves, onChange]
  );

  const handlePointerUp = () => {
    setDragIndex(null);
  };

  const handlePointDoubleClick = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    // Don't delete endpoints
    if (index === 0 || index === currentPoints.length - 1) return;
    const updated = currentPoints.filter((_, i) => i !== index);
    onChange({
      ...curves,
      [activeChannel]: updated,
    });
  };

  const resetCurrentChannel = () => {
    onChange({
      ...curves,
      [activeChannel]: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    });
  };

  const getChannelColor = () => {
    switch (activeChannel) {
      case "red":
        return "#ef4444";
      case "green":
        return "#22c55e";
      case "blue":
        return "#3b82f6";
      default:
        return "#ffffff";
    }
  };

  return (
    <div className="space-y-2.5">
      {/* Channel Switcher */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-1 bg-[#101015] p-1 rounded-lg border border-[#22222B]">
          {(["master", "red", "green", "blue"] as CurvesChannel[]).map((ch) => (
            <button
              key={ch}
              onClick={() => setActiveChannel(ch)}
              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase transition ${
                activeChannel === ch
                  ? ch === "red"
                    ? "bg-red-500/20 text-red-400 border border-red-500/40"
                    : ch === "green"
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                    : ch === "blue"
                    ? "bg-blue-500/20 text-blue-400 border border-blue-500/40"
                    : "bg-white/20 text-white border border-white/40"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {ch === "master" ? "Luma" : ch[0].toUpperCase()}
            </button>
          ))}
        </div>

        <button
          onClick={resetCurrentChannel}
          className="text-zinc-500 hover:text-zinc-200 transition p-1 rounded hover:bg-white/5"
          title="Reset Curve"
        >
          <RotateCcw className="w-3 h-3" />
        </button>
      </div>

      {/* Interactive SVG Curve Canvas */}
      <div className="flex justify-center">
        <svg
          ref={svgRef}
          width={size}
          height={size}
          onPointerDown={handleSvgPointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="bg-[#0c0c10] border border-[#252530] rounded-xl cursor-crosshair select-none touch-none shadow-inner"
        >
          {/* Background Grid Lines */}
          <line x1={size * 0.25} y1="0" x2={size * 0.25} y2={size} stroke="rgba(255,255,255,0.05)" />
          <line x1={size * 0.5} y1="0" x2={size * 0.5} y2={size} stroke="rgba(255,255,255,0.08)" />
          <line x1={size * 0.75} y1="0" x2={size * 0.75} y2={size} stroke="rgba(255,255,255,0.05)" />
          <line x1="0" y1={size * 0.25} x2={size} y2={size * 0.25} stroke="rgba(255,255,255,0.05)" />
          <line x1="0" y1={size * 0.5} x2={size} y2={size * 0.5} stroke="rgba(255,255,255,0.08)" />
          <line x1="0" y1={size * 0.75} x2={size} y2={size * 0.75} stroke="rgba(255,255,255,0.05)" />

          {/* Neutral Diagonal Reference Line */}
          <line x1="0" y1={size} x2={size} y2="0" stroke="rgba(255,255,255,0.12)" strokeDasharray="3 3" />

          {/* Interpolated Smooth Spline */}
          <path
            d={buildSmoothPath(currentPoints, size)}
            fill="none"
            stroke={getChannelColor()}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Control Point Handles */}
          {currentPoints.map((p, idx) => (
            <circle
              key={idx}
              cx={p.x * size}
              cy={(1 - p.y) * size}
              r={dragIndex === idx ? 5.5 : 4}
              fill={getChannelColor()}
              stroke="#000000"
              strokeWidth="1.5"
              className="cursor-pointer transition-transform"
              onPointerDown={(e) => handlePointerDown(idx, e)}
              onDoubleClick={(e) => handlePointDoubleClick(idx, e)}
            />
          ))}
        </svg>
      </div>

      <p className="text-[9px] text-zinc-500 text-center">
        Click curve to add point • Drag to adjust • Double-click to delete
      </p>
    </div>
  );
};
