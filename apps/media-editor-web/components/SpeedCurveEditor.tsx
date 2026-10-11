import React, { useState } from "react";
import { Gauge, Zap, Flame, FastForward, Sliders } from "lucide-react";

export interface SpeedCurvePoint {
  timeRatio: number; // 0 to 1
  speed: number; // e.g. 0.1 to 5.0x
}

export interface SpeedCurvePreset {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  points: SpeedCurvePoint[];
}

export const SPEED_CURVE_PRESETS: SpeedCurvePreset[] = [
  {
    id: "hero",
    name: "Hero",
    description: "Fast in, dramatic slow-mo impact, fast exit",
    icon: <Flame className="w-3 h-3 text-amber-400" />,
    points: [
      { timeRatio: 0, speed: 3.0 },
      { timeRatio: 0.25, speed: 2.0 },
      { timeRatio: 0.5, speed: 0.3 },
      { timeRatio: 0.75, speed: 1.5 },
      { timeRatio: 1.0, speed: 2.5 },
    ],
  },
  {
    id: "bullet",
    name: "Bullet Time",
    description: "Smooth 1x entry, ultra slow motion freeze, snap back to 1x",
    icon: <Zap className="w-3 h-3 text-cyan-400" />,
    points: [
      { timeRatio: 0, speed: 1.0 },
      { timeRatio: 0.3, speed: 1.0 },
      { timeRatio: 0.5, speed: 0.2 },
      { timeRatio: 0.7, speed: 1.0 },
      { timeRatio: 1.0, speed: 1.0 },
    ],
  },
  {
    id: "montage",
    name: "Montage",
    description: "Rhythmic beat ramp for quick montage cuts",
    icon: <FastForward className="w-3 h-3 text-indigo-400" />,
    points: [
      { timeRatio: 0, speed: 2.5 },
      { timeRatio: 0.4, speed: 1.0 },
      { timeRatio: 0.7, speed: 1.0 },
      { timeRatio: 1.0, speed: 2.5 },
    ],
  },
  {
    id: "flash_in",
    name: "Flash In",
    description: "Hyper-speed acceleration into steady playback",
    icon: <Sliders className="w-3 h-3 text-emerald-400" />,
    points: [
      { timeRatio: 0, speed: 4.0 },
      { timeRatio: 0.2, speed: 2.0 },
      { timeRatio: 0.4, speed: 1.0 },
      { timeRatio: 1.0, speed: 1.0 },
    ],
  },
];

interface SpeedCurveEditorProps {
  currentSpeed: number;
  activePresetId?: string;
  onSelectPreset: (preset: SpeedCurvePreset) => void;
  onSelectLinearSpeed: (speed: number) => void;
}

export const SpeedCurveEditor: React.FC<SpeedCurveEditorProps> = ({
  currentSpeed,
  activePresetId,
  onSelectPreset,
  onSelectLinearSpeed,
}) => {
  const [selectedTab, setSelectedTab] = useState<"linear" | "curve">("curve");

  const linearSpeeds = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0];

  return (
    <div className="space-y-2.5">
      {/* Tab Switcher */}
      <div className="flex items-center space-x-1 bg-[#101015] p-1 rounded-lg border border-[#22222B]">
        <button
          onClick={() => setSelectedTab("curve")}
          className={`flex-1 py-1 text-[11px] font-semibold rounded-md transition flex items-center justify-center space-x-1.5 ${
            selectedTab === "curve"
              ? "bg-indigo-600 text-white shadow-sm"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Flame className="w-3 h-3" />
          <span>Curve Ramping</span>
        </button>
        <button
          onClick={() => setSelectedTab("linear")}
          className={`flex-1 py-1 text-[11px] font-semibold rounded-md transition flex items-center justify-center space-x-1.5 ${
            selectedTab === "linear"
              ? "bg-indigo-600 text-white shadow-sm"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Gauge className="w-3 h-3" />
          <span>Standard</span>
        </button>
      </div>

      {selectedTab === "curve" ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {SPEED_CURVE_PRESETS.map((preset) => {
              const isSelected = activePresetId === preset.id;
              return (
                <button
                  key={preset.id}
                  onClick={() => onSelectPreset(preset)}
                  className={`p-2.5 rounded-xl border text-left transition flex flex-col justify-between ${
                    isSelected
                      ? "bg-indigo-950/40 border-indigo-500 shadow-md ring-1 ring-indigo-500/30"
                      : "bg-[#101015] border-[#22222B] hover:border-zinc-500 hover:bg-[#15151C]"
                  }`}
                >
                  <div className="flex items-center space-x-1.5 mb-1">
                    {preset.icon}
                    <span className="text-xs font-bold text-zinc-100">{preset.name}</span>
                  </div>
                  <p className="text-[9px] text-zinc-400 leading-tight mb-2">
                    {preset.description}
                  </p>

                  {/* Mini visual curve badge */}
                  <svg width="100%" height="24" className="bg-black/30 rounded border border-white/5 px-1">
                    <polyline
                      fill="none"
                      stroke={isSelected ? "#818cf8" : "#71717a"}
                      strokeWidth="1.5"
                      points={preset.points
                        .map(
                          (p, idx) =>
                            `${(idx / (preset.points.length - 1)) * 90 + 5},${22 - (p.speed / 4.0) * 18}`
                        )
                        .join(" ")}
                    />
                  </svg>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs font-mono text-zinc-300">
            <span>Playback Multiplier</span>
            <span className="font-bold text-indigo-400">{currentSpeed.toFixed(2)}x</span>
          </div>
          <input
            type="range"
            min="0.2"
            max="4.0"
            step="0.05"
            value={currentSpeed}
            onChange={(e) => onSelectLinearSpeed(parseFloat(e.target.value))}
            className="w-full h-1.5 bg-[#1C1C26] rounded appearance-none cursor-pointer accent-indigo-500"
          />
          <div className="grid grid-cols-4 gap-1.5">
            {linearSpeeds.map((s) => (
              <button
                key={s}
                onClick={() => onSelectLinearSpeed(s)}
                className={`py-1 text-[10px] font-mono rounded border transition ${
                  Math.abs(currentSpeed - s) < 0.01
                    ? "bg-indigo-600 text-white border-indigo-400 font-bold"
                    : "bg-[#101015] text-zinc-400 border-[#22222B] hover:text-white"
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
