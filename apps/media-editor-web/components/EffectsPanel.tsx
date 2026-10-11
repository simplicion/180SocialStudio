import React, { useState } from "react";
import { Plus, Trash2, Zap } from "lucide-react";
import { RationalTimeMath, type EffectEvent, type VideoEffectType } from "@workspace/video-contracts";
import { EFFECT_CATALOG, effectInfo } from "../services/editor-library";

interface EffectsPanelProps {
  currentTimeSeconds: number;
  /** The effect selected on the timeline (FX track), if any. */
  selectedEffect: EffectEvent | null;
  onAddEffect: (type: VideoEffectType, intensity: number) => void;
  onUpdateIntensity: (id: string, intensity: number) => void;
  onDeleteEffect: (id: string) => void;
}

/** Small CSS swatch showing roughly what the effect does. */
const swatch = (type: VideoEffectType): React.CSSProperties => {
  const base = "linear-gradient(135deg, #2563EB 0%, #10B981 50%, #F59E0B 100%)";
  switch (type) {
    case "flash":
      return { background: `linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.95) 50%, rgba(255,255,255,0) 100%), ${base}` };
    case "fade_black":
      return { background: `linear-gradient(90deg, rgba(0,0,0,0) 0%, #000 50%, rgba(0,0,0,0) 100%), ${base}` };
    case "black_white":
      return { background: base, filter: "grayscale(1)" };
    case "vignette":
      return { background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 35%, rgba(0,0,0,0.9) 100%), ${base}` };
    case "zoom_pulse":
      return { background: base, transform: "scale(1.15)" };
    case "shake":
      return { background: base, transform: "translateX(3px) rotate(-2deg)" };
  }
};

export const EffectsPanel: React.FC<EffectsPanelProps> = ({
  currentTimeSeconds,
  selectedEffect,
  onAddEffect,
  onUpdateIntensity,
  onDeleteEffect,
}) => {
  const [intensity, setIntensity] = useState<Record<string, number>>(() =>
    Object.fromEntries(EFFECT_CATALOG.map((e) => [e.type, e.defaultIntensity]))
  );

  return (
    <div className="h-full flex flex-col bg-[#0E1118] text-slate-100">
      {selectedEffect && (
        <div className="p-3 border-b border-[#222838] bg-[#141822] space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold">
            <Zap className="w-3.5 h-3.5 text-violet-300" />
            <span>Selected: {effectInfo(selectedEffect.type).name}</span>
            <span className="ml-auto font-mono text-[10px] text-slate-400">
              {RationalTimeMath.toSeconds(selectedEffect.timeRange.start).toFixed(2)}s ·{" "}
              {RationalTimeMath.toSeconds(selectedEffect.timeRange.duration).toFixed(2)}s
            </span>
          </div>
          <label className="flex items-center gap-2 text-[11px] text-slate-400">
            Intensity
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={selectedEffect.intensity ?? 0.6}
              onChange={(e) => onUpdateIntensity(selectedEffect.id, Number(e.target.value))}
              className="flex-1 h-11 accent-[#4F46E5]"
              aria-label="Selected effect intensity"
            />
            <span className="font-mono w-9 text-right">{Math.round((selectedEffect.intensity ?? 0.6) * 100)}%</span>
          </label>
          <button
            onClick={() => onDeleteEffect(selectedEffect.id)}
            className="w-full min-h-[44px] rounded-md border border-[#222838] hover:bg-[#1C2230] text-xs font-semibold text-rose-300 flex items-center justify-center gap-2 transition"
          >
            <Trash2 className="w-3.5 h-3.5" /> Remove effect
          </button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {EFFECT_CATALOG.map((fx) => (
          <div key={fx.type} className="rounded-lg border border-[#222838] bg-[#141822] p-2.5 space-y-2">
            <div className="flex gap-2.5">
              <div className="w-14 h-10 rounded overflow-hidden shrink-0 border border-[#222838]">
                <div className="w-full h-full" style={swatch(fx.type)} />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-100 flex items-center gap-1.5">
                  {fx.name}
                  <span className="font-mono text-[10px] text-slate-500">{fx.defaultSeconds}s</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-snug">{fx.description}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.05}
                value={intensity[fx.type]}
                onChange={(e) => setIntensity((m) => ({ ...m, [fx.type]: Number(e.target.value) }))}
                className="flex-1 h-11 accent-[#4F46E5]"
                aria-label={`${fx.name} intensity`}
              />
              <span className="font-mono text-[10px] text-slate-400 w-8 text-right">{Math.round(intensity[fx.type] * 100)}%</span>
              <button
                onClick={() => onAddEffect(fx.type, intensity[fx.type])}
                className="min-h-[44px] px-3 rounded-md bg-[#4F46E5] hover:bg-[#4338CA] text-xs font-semibold flex items-center gap-1.5 transition"
                title={`Add at ${currentTimeSeconds.toFixed(1)}s`}
              >
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
