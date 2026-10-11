import React, { useState, useRef, useCallback, useEffect } from "react";
import { RotateCcw } from "lucide-react";

export interface ColorWheelValue {
  hue: number; // 0 to 360
  amount: number; // 0 to 1
  luma: number; // -1 to 1 (shadows, midtones, highlights, offset)
}

export interface ColorWheelsState {
  lift: ColorWheelValue;
  gamma: ColorWheelValue;
  gain: ColorWheelValue;
  offset: ColorWheelValue;
}

export const DEFAULT_COLOR_WHEELS: ColorWheelsState = {
  lift: { hue: 0, amount: 0, luma: 0 },
  gamma: { hue: 0, amount: 0, luma: 0 },
  gain: { hue: 0, amount: 0, luma: 0 },
  offset: { hue: 0, amount: 0, luma: 0 },
};

interface SingleWheelProps {
  label: string;
  value: ColorWheelValue;
  onChange: (val: ColorWheelValue) => void;
  onReset: () => void;
}

const SingleWheel: React.FC<SingleWheelProps> = ({ label, value, onChange, onReset }) => {
  const wheelRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const radius = 38; // px radius for wheel

  const handlePointer = useCallback(
    (clientX: number, clientY: number) => {
      if (!wheelRef.current) return;
      const rect = wheelRef.current.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = clientX - cx;
      const dy = clientY - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const maxR = rect.width / 2 - 4;

      const amount = Math.min(1, dist / maxR);
      const angleRad = Math.atan2(dy, dx);
      const hue = Math.round(((angleRad * 180) / Math.PI + 360) % 360);

      onChange({
        ...value,
        hue,
        amount: Math.round(amount * 100) / 100,
      });
    },
    [value, onChange]
  );

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: PointerEvent) => handlePointer(e.clientX, e.clientY);
    const onUp = () => setIsDragging(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [isDragging, handlePointer]);

  // Puck position in px relative to center
  const angleRad = (value.hue * Math.PI) / 180;
  const puckDist = value.amount * (radius - 4);
  const puckX = radius + Math.cos(angleRad) * puckDist;
  const puckY = radius + Math.sin(angleRad) * puckDist;

  const isModified = value.amount > 0 || value.luma !== 0;

  return (
    <div className="flex flex-col items-center bg-[#101015] border border-[#22222B] rounded-xl p-2.5 relative group">
      {/* Header */}
      <div className="w-full flex items-center justify-between mb-1.5 px-0.5">
        <span className="text-[10px] font-bold tracking-wider text-zinc-300 uppercase">{label}</span>
        {isModified && (
          <button
            onClick={onReset}
            className="text-zinc-500 hover:text-zinc-200 transition p-0.5 rounded"
            title="Reset Wheel"
          >
            <RotateCcw className="w-2.5 h-2.5" />
          </button>
        )}
      </div>

      {/* Wheel Disc */}
      <div
        ref={wheelRef}
        onPointerDown={(e) => {
          setIsDragging(true);
          handlePointer(e.clientX, e.clientY);
        }}
        style={{
          width: `${radius * 2}px`,
          height: `${radius * 2}px`,
          background: `radial-gradient(circle at center, #181920 0%, #121318 60%, transparent 72%), conic-gradient(from 90deg, #ff3b30, #ff9500, #ffcc00, #34c759, #00c7be, #007aff, #5856d6, #ff2d55, #ff3b30)`,
        }}
        className="rounded-full relative cursor-crosshair border border-white/10 shadow-inner flex items-center justify-center select-none"
      >
        {/* Center reticle */}
        <div className="w-1.5 h-1.5 rounded-full bg-white/20 pointer-events-none" />

        {/* Puck Handle */}
        <div
          style={{
            left: `${puckX}px`,
            top: `${puckY}px`,
            transform: "translate(-50%, -50%)",
            backgroundColor: value.amount > 0 ? `hsl(${value.hue}, 85%, 60%)` : "#ffffff",
          }}
          className="absolute w-3 h-3 rounded-full border-2 border-white shadow-lg pointer-events-none transition-transform"
        />
      </div>

      {/* Numerical Hue & Amount Display */}
      <div className="flex items-center justify-between w-full mt-1.5 text-[9px] font-mono text-zinc-400 px-1">
        <span>{value.amount > 0 ? `${value.hue}°` : "0°"}</span>
        <span>{Math.round(value.amount * 100)}%</span>
      </div>

      {/* Master Luminance Slider */}
      <div className="w-full mt-1.5 flex items-center space-x-1">
        <span className="text-[8px] font-mono text-zinc-500 w-3 text-right">Y</span>
        <input
          type="range"
          min="-1"
          max="1"
          step="0.02"
          value={value.luma}
          onChange={(e) => onChange({ ...value, luma: parseFloat(e.target.value) })}
          className="w-full h-1 bg-[#1A1A22] rounded appearance-none cursor-pointer accent-indigo-400"
          title={`Luminance: ${(value.luma * 100).toFixed(0)}%`}
        />
        <span className="text-[8px] font-mono text-zinc-400 w-6 text-right">
          {value.luma > 0 ? `+${(value.luma * 100).toFixed(0)}` : (value.luma * 100).toFixed(0)}
        </span>
      </div>
    </div>
  );
};

interface ColorWheelsPanelProps {
  wheels?: ColorWheelsState;
  onChange: (wheels: ColorWheelsState) => void;
}

export const ColorWheelsPanel: React.FC<ColorWheelsPanelProps> = ({
  wheels = DEFAULT_COLOR_WHEELS,
  onChange,
}) => {
  const updateWheel = (key: keyof ColorWheelsState, val: ColorWheelValue) => {
    onChange({
      ...wheels,
      [key]: val,
    });
  };

  const resetAll = () => {
    onChange(DEFAULT_COLOR_WHEELS);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-200">3-Way Color Wheels</span>
        <button
          onClick={resetAll}
          className="text-[10px] text-zinc-400 hover:text-white flex items-center space-x-1 transition"
        >
          <RotateCcw className="w-2.5 h-2.5" />
          <span>Reset All</span>
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <SingleWheel
          label="Lift (Shadows)"
          value={wheels.lift || DEFAULT_COLOR_WHEELS.lift}
          onChange={(v) => updateWheel("lift", v)}
          onReset={() => updateWheel("lift", DEFAULT_COLOR_WHEELS.lift)}
        />
        <SingleWheel
          label="Gamma (Midtones)"
          value={wheels.gamma || DEFAULT_COLOR_WHEELS.gamma}
          onChange={(v) => updateWheel("gamma", v)}
          onReset={() => updateWheel("gamma", DEFAULT_COLOR_WHEELS.gamma)}
        />
        <SingleWheel
          label="Gain (Highlights)"
          value={wheels.gain || DEFAULT_COLOR_WHEELS.gain}
          onChange={(v) => updateWheel("gain", v)}
          onReset={() => updateWheel("gain", DEFAULT_COLOR_WHEELS.gain)}
        />
        <SingleWheel
          label="Offset (Global)"
          value={wheels.offset || DEFAULT_COLOR_WHEELS.offset}
          onChange={(v) => updateWheel("offset", v)}
          onReset={() => updateWheel("offset", DEFAULT_COLOR_WHEELS.offset)}
        />
      </div>
    </div>
  );
};
