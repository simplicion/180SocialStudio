import React, { useState } from "react";
import {
  Sliders,
  Move,
  Maximize2,
  RotateCw,
  Eye,
  Gauge,
  Crop,
  Layers,
  Sparkles,
  X,
  Volume2,
  VolumeX,
  Music,
  Sun,
  Palette,
  Copy,
  Trash2,
  Split,
  Film,
  Thermometer,
  CircleDot,
  CornerDownRight,
  Zap,
} from "lucide-react";
import { VideoClip, Transform, ClipKeyframe, RationalTimeMath, Transition } from "@workspace/video-contracts";
import { TRANSITION_OPTIONS } from "../services/editor-library";
import { ColorWheelsPanel } from "./ColorWheelsPanel";
import { RgbCurvesPanel } from "./RgbCurvesPanel";
import { SpeedCurveEditor } from "./SpeedCurveEditor";

interface ClipInspectorProps {
  selectedClip: VideoClip | null;
  currentTimeSeconds?: number;
  onUpdateTransform: (transform: Transform) => void;
  onUpdateSpeed: (speed: number) => void;
  onUpdateVolume?: (volumeDb: number) => void;
  onUpdateTransitions?: (transitionIn?: Transition, transitionOut?: Transition) => void;
  onDetachAudio?: () => void;
  onDuplicateClip?: () => void;
  onDeleteClip?: () => void;
  onClose: () => void;
}

const FILTER_PRESETS = [
  { id: "NORMAL", label: "Normal", color: "bg-zinc-800 text-zinc-300" },
  { id: "VIVID", label: "✨ Vivid", color: "bg-emerald-950/60 text-emerald-300 border-emerald-500/30" },
  { id: "NOIR_BW", label: "🖤 Noir B&W", color: "bg-zinc-900 text-zinc-200 border-zinc-500/30" },
  { id: "CINEMATIC_TEAL_ORANGE", label: "🎬 Teal & Orange", color: "bg-cyan-950/60 text-cyan-300 border-cyan-500/30" },
  { id: "VINTAGE_WARM", label: "🌅 Vintage Warm", color: "bg-amber-950/60 text-amber-300 border-amber-500/30" },
  { id: "CYBER_NEON", label: "⚡ Cyber Neon", color: "bg-purple-950/60 text-purple-300 border-purple-500/30" },
  { id: "GLOW", label: "🌟 Soft Glow", color: "bg-indigo-950/60 text-indigo-300 border-indigo-500/30" },
];

const KeyframeButton: React.FC<{
  property: "scale" | "posX" | "posY" | "rotation" | "opacity" | "volume";
  currentValue: number;
  keyframes: ClipKeyframe[];
  currentOffsetSec: number;
  onToggleKeyframe: (
    prop: "scale" | "posX" | "posY" | "rotation" | "opacity" | "volume",
    val: number
  ) => void;
}> = ({ property, currentValue, keyframes, currentOffsetSec, onToggleKeyframe }) => {
  const existingKey = keyframes.find(
    (k) => k.property === property && Math.abs(k.timeOffsetSec - currentOffsetSec) < 0.15
  );
  const hasAnyKey = keyframes.some((k) => k.property === property);

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onToggleKeyframe(property, currentValue);
      }}
      className={`px-1.5 py-0.5 rounded text-[11px] font-bold transition flex items-center space-x-0.5 cursor-pointer ${
        existingKey
          ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-[0_0_8px_rgba(245,158,11,0.5)]"
          : hasAnyKey
          ? "bg-[#16161E] text-zinc-400 hover:text-amber-300 border border-[#242430]"
          : "bg-transparent text-zinc-600 hover:text-zinc-300 hover:bg-[#16161E]"
      }`}
      title={
        existingKey
          ? "Active Keyframe at playhead! Click to remove (◆)"
          : "Click to add keyframe at playhead (◇)"
      }
    >
      <span>{existingKey ? "◆" : "◇"}</span>
    </button>
  );
};

export const ClipInspector: React.FC<ClipInspectorProps> = ({
  selectedClip,
  currentTimeSeconds = 0,
  onUpdateTransform,
  onUpdateSpeed,
  onUpdateVolume,
  onUpdateTransitions,
  onDetachAudio,
  onDuplicateClip,
  onDeleteClip,
  onClose,
}) => {
  if (!selectedClip) return null;

  const { transform, speedMultiplier, volumeDb = 0.0 } = selectedClip;
  const clipStartSec = RationalTimeMath.toSeconds(selectedClip.timelineRange.start);
  const currentOffsetSec = Math.max(0, currentTimeSeconds - clipStartSec);
  const keyframes: ClipKeyframe[] = transform.keyframes || [];

  const [colorSubTab, setColorSubTab] = useState<"basic" | "wheels" | "curves">("basic");

  const handleColorWheelsChange = (colorWheels: any) => {
    onUpdateTransform({
      ...transform,
      colorWheels,
    });
  };

  const handleRgbCurvesChange = (rgbCurves: any) => {
    onUpdateTransform({
      ...transform,
      rgbCurves,
    });
  };

  const handleToggleKeyframe = (
    prop: "scale" | "posX" | "posY" | "rotation" | "opacity" | "volume",
    val: number
  ) => {
    const existing = transform.keyframes || [];
    const idx = existing.findIndex(
      (k) => k.property === prop && Math.abs(k.timeOffsetSec - currentOffsetSec) < 0.15
    );
    let updatedKeys: ClipKeyframe[];
    if (idx >= 0) {
      updatedKeys = existing.filter((_, i) => i !== idx);
    } else {
      updatedKeys = [
        ...existing,
        {
          id: `kf_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          timeOffsetSec: parseFloat(currentOffsetSec.toFixed(2)),
          property: prop,
          value: val,
          easing: "linear" as const,
        },
      ].sort((a, b) => a.timeOffsetSec - b.timeOffsetSec);
    }
    onUpdateTransform({
      ...transform,
      keyframes: updatedKeys,
    });
  };

  const handleScaleChange = (val: number) => {
    onUpdateTransform({
      ...transform,
      scale: { ...transform.scale, start: val, end: val },
    });
  };

  const handlePositionXChange = (val: number) => {
    onUpdateTransform({
      ...transform,
      position: { ...transform.position, x: val },
    });
  };

  const handlePositionYChange = (val: number) => {
    onUpdateTransform({
      ...transform,
      position: { ...transform.position, y: val },
    });
  };

  const handleRotationChange = (val: number) => {
    onUpdateTransform({
      ...transform,
      rotationDeg: val,
    });
  };

  const handleOpacityChange = (val: number) => {
    onUpdateTransform({
      ...transform,
      opacity: val,
    });
  };

  const handleBrightnessChange = (val: number) => {
    onUpdateTransform({
      ...transform,
      brightness: val,
    });
  };

  const handleContrastChange = (val: number) => {
    onUpdateTransform({
      ...transform,
      contrast: val,
    });
  };

  const handleSaturationChange = (val: number) => {
    onUpdateTransform({
      ...transform,
      saturation: val,
    });
  };

  const handleTemperatureChange = (val: number) => {
    onUpdateTransform({
      ...transform,
      temperature: val,
    });
  };

  const handleTintChange = (val: number) => {
    onUpdateTransform({
      ...transform,
      tint: val,
    });
  };

  const handleExposureChange = (val: number) => {
    onUpdateTransform({
      ...transform,
      exposure: val,
    });
  };

  const handleVignetteChange = (val: number) => {
    onUpdateTransform({
      ...transform,
      vignette: val,
    });
  };

  const handleBorderRadiusChange = (val: number) => {
    onUpdateTransform({
      ...transform,
      borderRadius: val,
    });
  };

  const handleFilterPresetChange = (presetId: string) => {
    let b = 1.0;
    let c = 1.0;
    let s = 1.0;

    if (presetId === "VIVID") {
      b = 1.05;
      c = 1.2;
      s = 1.35;
    } else if (presetId === "NOIR_BW") {
      b = 1.0;
      c = 1.3;
      s = 0.0;
    } else if (presetId === "CINEMATIC_TEAL_ORANGE") {
      b = 0.98;
      c = 1.25;
      s = 1.2;
    } else if (presetId === "VINTAGE_WARM") {
      b = 1.05;
      c = 1.1;
      s = 1.15;
    } else if (presetId === "CYBER_NEON") {
      b = 1.1;
      c = 1.35;
      s = 1.5;
    } else if (presetId === "GLOW") {
      b = 1.12;
      c = 1.08;
      s = 1.1;
    }

    onUpdateTransform({
      ...transform,
      filterPreset: presetId,
      brightness: b,
      contrast: c,
      saturation: s,
    });
  };

  const handleCropChange = (side: "top" | "bottom" | "left" | "right", val: number) => {
    const currentCrop = transform.crop || { top: 0, bottom: 0, left: 0, right: 0 };
    onUpdateTransform({
      ...transform,
      crop: {
        ...currentCrop,
        [side]: Math.max(0, Math.min(50, val)),
      },
    });
  };

  const handleCropPreset = (preset: "reset" | "16:9" | "9:16" | "1:1") => {
    if (preset === "reset") {
      onUpdateTransform({
        ...transform,
        crop: { top: 0, bottom: 0, left: 0, right: 0 },
      });
    } else if (preset === "9:16") {
      onUpdateTransform({
        ...transform,
        crop: { top: 0, bottom: 0, left: 22, right: 22 },
      });
    } else if (preset === "1:1") {
      onUpdateTransform({
        ...transform,
        crop: { top: 0, bottom: 0, left: 15, right: 15 },
      });
    } else if (preset === "16:9") {
      onUpdateTransform({
        ...transform,
        crop: { top: 12, bottom: 12, left: 0, right: 0 },
      });
    }
  };

  const handleResetTransform = () => {
    onUpdateTransform({
      scale: { start: 1.0, end: 1.0, easing: "spring" },
      position: { x: 0, y: 0 },
      anchor: { x: 0.5, y: 0.5 },
      rotationDeg: 0,
      opacity: 1.0,
      crop: { top: 0, bottom: 0, left: 0, right: 0 },
      brightness: 1.0,
      contrast: 1.0,
      saturation: 1.0,
      filterPreset: "NORMAL",
    });
    onUpdateSpeed(1.0);
    if (onUpdateVolume) onUpdateVolume(0.0);
  };

  return (
    <div className="w-full flex-1 flex flex-col h-full select-none bg-[#0B0B0C] overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-[#1F1F24] flex items-center justify-between bg-[#0B0B0C] shrink-0">
        <div className="flex items-center space-x-2 text-indigo-400">
          <Sliders className="w-4 h-4" />
          <span className="font-semibold text-xs uppercase tracking-wider text-gray-200">Clip Inspector</span>
        </div>
        <div className="flex items-center space-x-1">
          <button
            onClick={handleResetTransform}
            className="text-[10px] font-mono text-gray-400 hover:text-white px-2 py-0.5 rounded border border-[#1F1F24] hover:bg-[#1F1F24] transition"
            title="Reset All Properties to Defaults"
          >
            Reset
          </button>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1 rounded hover:bg-[#1F1F24] transition"
            title="Close Inspector"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Inspector Body */}
      <div className="p-3.5 overflow-y-auto flex-1 space-y-4 text-xs">
        {/* Active Clip Info & Quick Actions */}
        <div className="bg-[#111114] p-2.5 rounded-lg border border-[#1F1F24] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-gray-500 uppercase font-mono">Active Clip</span>
            <span className="text-[9px] font-mono text-indigo-400 bg-indigo-950/80 px-1.5 py-0.5 rounded">
              {speedMultiplier}x Speed
            </span>
          </div>
          <p className="text-gray-200 font-medium truncate text-xs">
            {selectedClip.sourcePath.split(/[\/\\]/).pop()}
          </p>

          {/* Quick Action Buttons */}
          <div className="grid grid-cols-3 gap-1.5 pt-1 border-t border-[#1C1C22]">
            {onDetachAudio && (
              <button
                onClick={onDetachAudio}
                className="flex items-center justify-center space-x-1 py-1 rounded bg-[#16161C] hover:bg-[#1E1E26] text-zinc-300 hover:text-white border border-[#22222A] text-[10px] font-medium transition"
                title="Extract audio from this clip into a separate audio track"
              >
                <Split className="w-3 h-3 text-cyan-400" />
                <span>Detach Audio</span>
              </button>
            )}

            {onDuplicateClip && (
              <button
                onClick={onDuplicateClip}
                className="flex items-center justify-center space-x-1 py-1 rounded bg-[#16161C] hover:bg-[#1E1E26] text-zinc-300 hover:text-white border border-[#22222A] text-[10px] font-medium transition"
                title="Duplicate Clip (Ctrl+D)"
              >
                <Copy className="w-3 h-3 text-indigo-400" />
                <span>Duplicate</span>
              </button>
            )}

            {onDeleteClip && (
              <button
                onClick={onDeleteClip}
                className="flex items-center justify-center space-x-1 py-1 rounded bg-[#1C1316] hover:bg-[#28181D] text-rose-300 hover:text-rose-200 border border-rose-500/20 text-[10px] font-medium transition"
                title="Ripple Delete Clip"
              >
                <Trash2 className="w-3 h-3 text-rose-400" />
                <span>Delete</span>
              </button>
            )}
          </div>
        </div>

        {/* 1. Color, Tone & Filters */}
        <div className="space-y-2.5 pt-2 border-t border-[#1F1F24]">
          <div className="flex items-center justify-between">
            <span className="flex items-center space-x-1.5 text-gray-200 font-semibold text-xs">
              <Palette className="w-3.5 h-3.5 text-amber-400" />
              <span>Color Grading & Filters</span>
            </span>
          </div>

          {/* Sub-tab Switcher: Basic | Wheels | Curves */}
          <div className="flex items-center space-x-1 bg-[#101015] p-1 rounded-lg border border-[#1F1F24]">
            <button
              onClick={() => setColorSubTab("basic")}
              className={`flex-1 py-1 rounded text-[10px] font-semibold transition ${
                colorSubTab === "basic"
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Basic
            </button>
            <button
              onClick={() => setColorSubTab("wheels")}
              className={`flex-1 py-1 rounded text-[10px] font-semibold transition ${
                colorSubTab === "wheels"
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Color Wheels
            </button>
            <button
              onClick={() => setColorSubTab("curves")}
              className={`flex-1 py-1 rounded text-[10px] font-semibold transition ${
                colorSubTab === "curves"
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              RGB Curves
            </button>
          </div>

          {colorSubTab === "basic" && (
            <div className="space-y-2.5">
              {/* Preset Pills */}
              <div className="grid grid-cols-2 gap-1.5">
                {FILTER_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => handleFilterPresetChange(preset.id)}
                    className={`py-1 px-2 rounded-md text-[10px] font-medium border text-left truncate transition ${
                      (transform.filterPreset || "NORMAL") === preset.id
                        ? `${preset.color} ring-1 ring-white/20 font-bold`
                        : "bg-[#141418] text-zinc-400 border-[#1F1F24] hover:text-white hover:bg-[#181820]"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              {/* Brightness */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-gray-400 text-[11px]">
                  <span className="flex items-center space-x-1">
                    <Sun className="w-3 h-3 text-amber-400" />
                    <span>Brightness</span>
                  </span>
                  <span className="font-mono text-zinc-200">{((transform.brightness ?? 1.0) * 100).toFixed(0)}%</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="1.5"
                  step="0.05"
                  value={transform.brightness ?? 1.0}
                  onChange={(e) => handleBrightnessChange(parseFloat(e.target.value))}
                  className="w-full h-1 bg-[#16161A] rounded-lg appearance-none cursor-pointer accent-amber-400"
                />
              </div>

              {/* Contrast */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-gray-400 text-[11px]">
                  <span>Contrast</span>
                  <span className="font-mono text-zinc-200">{((transform.contrast ?? 1.0) * 100).toFixed(0)}%</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="1.5"
                  step="0.05"
                  value={transform.contrast ?? 1.0}
                  onChange={(e) => handleContrastChange(parseFloat(e.target.value))}
                  className="w-full h-1 bg-[#16161A] rounded-lg appearance-none cursor-pointer accent-indigo-400"
                />
              </div>

              {/* Saturation */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-gray-400 text-[11px]">
                  <span>Saturation</span>
                  <span className="font-mono text-zinc-200">{((transform.saturation ?? 1.0) * 100).toFixed(0)}%</span>
                </div>
                <input
                  type="range"
                  min="0.0"
                  max="2.0"
                  step="0.05"
                  value={transform.saturation ?? 1.0}
                  onChange={(e) => handleSaturationChange(parseFloat(e.target.value))}
                  className="w-full h-1 bg-[#16161A] rounded-lg appearance-none cursor-pointer accent-cyan-400"
                />
              </div>

              {/* Temperature (Cool/Warm) */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-gray-400 text-[11px]">
                  <span className="flex items-center space-x-1">
                    <Thermometer className="w-3 h-3 text-cyan-400" />
                    <span>Temperature</span>
                  </span>
                  <span className="font-mono text-zinc-200">
                    {(transform.temperature ?? 0) > 0 ? `+${transform.temperature}` : transform.temperature ?? 0}
                  </span>
                </div>
                <input
                  type="range"
                  min="-100"
                  max="100"
                  step="5"
                  value={transform.temperature ?? 0}
                  onChange={(e) => handleTemperatureChange(parseInt(e.target.value, 10))}
                  className="w-full h-1 bg-gradient-to-r from-cyan-500 via-zinc-600 to-amber-500 rounded-lg appearance-none cursor-pointer accent-amber-400"
                />
              </div>

              {/* Tint (Green/Magenta) */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-gray-400 text-[11px]">
                  <span>Tint (Green / Magenta)</span>
                  <span className="font-mono text-zinc-200">
                    {(transform.tint ?? 0) > 0 ? `+${transform.tint}` : transform.tint ?? 0}
                  </span>
                </div>
                <input
                  type="range"
                  min="-100"
                  max="100"
                  step="5"
                  value={transform.tint ?? 0}
                  onChange={(e) => handleTintChange(parseInt(e.target.value, 10))}
                  className="w-full h-1 bg-gradient-to-r from-emerald-500 via-zinc-600 to-fuchsia-500 rounded-lg appearance-none cursor-pointer accent-fuchsia-400"
                />
              </div>

              {/* Exposure */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-gray-400 text-[11px]">
                  <span>Exposure</span>
                  <span className="font-mono text-zinc-200">
                    {(transform.exposure ?? 0) > 0 ? `+${(transform.exposure ?? 0).toFixed(1)}` : (transform.exposure ?? 0).toFixed(1)} EV
                  </span>
                </div>
                <input
                  type="range"
                  min="-2.0"
                  max="2.0"
                  step="0.1"
                  value={transform.exposure ?? 0}
                  onChange={(e) => handleExposureChange(parseFloat(e.target.value))}
                  className="w-full h-1 bg-[#16161A] rounded-lg appearance-none cursor-pointer accent-amber-300"
                />
              </div>

              {/* Vignette */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-gray-400 text-[11px]">
                  <span className="flex items-center space-x-1">
                    <CircleDot className="w-3 h-3 text-zinc-400" />
                    <span>Vignette</span>
                  </span>
                  <span className="font-mono text-zinc-200">{(transform.vignette ?? 0)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={transform.vignette ?? 0}
                  onChange={(e) => handleVignetteChange(parseInt(e.target.value, 10))}
                  className="w-full h-1 bg-[#16161A] rounded-lg appearance-none cursor-pointer accent-zinc-400"
                />
              </div>
            </div>
          )}

          {colorSubTab === "wheels" && (
            <ColorWheelsPanel
              wheels={transform.colorWheels as any}
              onChange={handleColorWheelsChange}
            />
          )}

          {colorSubTab === "curves" && (
            <RgbCurvesPanel
              curves={transform.rgbCurves as any}
              onChange={handleRgbCurvesChange}
            />
          )}
        </div>

        {/* 2. Audio Gain & Clip Volume */}
        {onUpdateVolume && (
          <div className="space-y-2 pt-2 border-t border-[#1F1F24]">
            <div className="flex items-center justify-between text-gray-200 font-semibold text-xs">
              <span className="flex items-center space-x-1.5">
                <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Clip Audio Volume</span>
              </span>
              <div className="flex items-center space-x-2">
                <span className="font-mono text-emerald-300 text-[11px]">
                  {volumeDb <= -40 ? "Muted" : `${volumeDb > 0 ? "+" : ""}${volumeDb.toFixed(1)} dB`}
                </span>
                <KeyframeButton
                  property="volume"
                  currentValue={volumeDb}
                  keyframes={keyframes}
                  currentOffsetSec={currentOffsetSec}
                  onToggleKeyframe={handleToggleKeyframe}
                />
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => onUpdateVolume(volumeDb <= -40 ? 0.0 : -60.0)}
                className={`p-1.5 rounded text-xs border transition ${
                  volumeDb <= -40
                    ? "bg-rose-950/60 text-rose-300 border-rose-500/30"
                    : "bg-[#141418] text-zinc-400 border-[#1F1F24] hover:text-white"
                }`}
                title={volumeDb <= -40 ? "Unmute Clip" : "Mute Clip"}
              >
                {volumeDb <= -40 ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
              </button>
              <input
                type="range"
                min="-40"
                max="6"
                step="1"
                value={volumeDb}
                onChange={(e) => onUpdateVolume(parseFloat(e.target.value))}
                className="w-full h-1 bg-[#16161A] rounded-lg appearance-none cursor-pointer accent-emerald-400"
              />
            </div>
          </div>
        )}

        {/* 3. Spatial Scale & Position */}
        <div className="space-y-2 pt-2 border-t border-[#1F1F24]">
          <div className="flex items-center justify-between text-gray-300 font-semibold text-xs">
            <span className="flex items-center space-x-1.5">
              <Maximize2 className="w-3.5 h-3.5 text-indigo-400" />
              <span>Spatial Transform</span>
            </span>
            <div className="flex items-center space-x-2">
              <span className="font-mono text-indigo-300 text-[11px]">{(transform.scale.start * 100).toFixed(0)}%</span>
              <KeyframeButton
                property="scale"
                currentValue={transform.scale.start}
                keyframes={keyframes}
                currentOffsetSec={currentOffsetSec}
                onToggleKeyframe={handleToggleKeyframe}
              />
            </div>
          </div>

          <input
            type="range"
            min="0.2"
            max="3.0"
            step="0.05"
            value={transform.scale.start}
            onChange={(e) => handleScaleChange(parseFloat(e.target.value))}
            className="w-full h-1 bg-[#16161A] rounded-lg appearance-none cursor-pointer accent-indigo-500"
          />

          <div className="grid grid-cols-2 gap-2 pt-1">
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <label className="text-[9px] text-gray-500 font-mono">X Offset</label>
                <KeyframeButton
                  property="posX"
                  currentValue={transform.position.x}
                  keyframes={keyframes}
                  currentOffsetSec={currentOffsetSec}
                  onToggleKeyframe={handleToggleKeyframe}
                />
              </div>
              <input
                type="number"
                step="1"
                min="-1000"
                max="1000"
                value={transform.position.x}
                onChange={(e) => handlePositionXChange(parseFloat(e.target.value) || 0)}
                className="w-full bg-[#141417] border border-[#1F1F24] rounded-md px-2 py-1 text-gray-200 font-mono text-xs focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <label className="text-[9px] text-gray-500 font-mono">Y Offset</label>
                <KeyframeButton
                  property="posY"
                  currentValue={transform.position.y}
                  keyframes={keyframes}
                  currentOffsetSec={currentOffsetSec}
                  onToggleKeyframe={handleToggleKeyframe}
                />
              </div>
              <input
                type="number"
                step="1"
                min="-1000"
                max="1000"
                value={transform.position.y}
                onChange={(e) => handlePositionYChange(parseFloat(e.target.value) || 0)}
                className="w-full bg-[#141417] border border-[#1F1F24] rounded-md px-2 py-1 text-gray-200 font-mono text-xs focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>
        </div>

        {/* 4. Rotation & Opacity */}
        <div className="space-y-2 pt-2 border-t border-[#1F1F24]">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-gray-400 text-[11px]">
                <span>Rotation</span>
                <div className="flex items-center space-x-1">
                  <span className="font-mono text-zinc-200">{transform.rotationDeg}°</span>
                  <KeyframeButton
                    property="rotation"
                    currentValue={transform.rotationDeg}
                    keyframes={keyframes}
                    currentOffsetSec={currentOffsetSec}
                    onToggleKeyframe={handleToggleKeyframe}
                  />
                </div>
              </div>
              <input
                type="range"
                min="-180"
                max="180"
                step="5"
                value={transform.rotationDeg}
                onChange={(e) => handleRotationChange(parseInt(e.target.value, 10))}
                className="w-full h-1 bg-[#16161A] rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-gray-400 text-[11px]">
                <span>Opacity</span>
                <div className="flex items-center space-x-1">
                  <span className="font-mono text-zinc-200">{((transform.opacity ?? 1.0) * 100).toFixed(0)}%</span>
                  <KeyframeButton
                    property="opacity"
                    currentValue={transform.opacity ?? 1.0}
                    keyframes={keyframes}
                    currentOffsetSec={currentOffsetSec}
                    onToggleKeyframe={handleToggleKeyframe}
                  />
                </div>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={transform.opacity ?? 1.0}
                onChange={(e) => handleOpacityChange(parseFloat(e.target.value))}
                className="w-full h-1 bg-[#16161A] rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
            </div>
          </div>
        </div>

        {/* 5. Corner Radius & Styling */}
        <div className="space-y-2 pt-2 border-t border-[#1F1F24]">
          <div className="flex items-center justify-between text-gray-300 font-semibold text-xs">
            <span className="flex items-center space-x-1.5">
              <CornerDownRight className="w-3.5 h-3.5 text-indigo-400" />
              <span>Corner Radius</span>
            </span>
            <span className="font-mono text-zinc-200 text-[11px]">{transform.borderRadius ?? 0}px</span>
          </div>
          <input
            type="range"
            min="0"
            max="60"
            step="2"
            value={transform.borderRadius ?? 0}
            onChange={(e) => handleBorderRadiusChange(parseInt(e.target.value, 10))}
            className="w-full h-1 bg-[#16161A] rounded-lg appearance-none cursor-pointer accent-indigo-500"
          />
        </div>

        {/* 6. Cropping */}
        <div className="space-y-2 pt-2 border-t border-[#1F1F24]">
          <div className="flex items-center justify-between text-gray-300 font-semibold text-xs">
            <span className="flex items-center space-x-1.5">
              <Crop className="w-3.5 h-3.5 text-indigo-400" />
              <span>Edge Cropping</span>
            </span>
            <div className="flex items-center space-x-1">
              <button
                onClick={() => handleCropPreset("reset")}
                className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#141417] text-zinc-400 hover:text-white border border-[#1F1F24]"
                title="Reset Crop"
              >
                Reset
              </button>
              <button
                onClick={() => handleCropPreset("9:16")}
                className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#141417] text-zinc-400 hover:text-white border border-[#1F1F24]"
                title="Crop 9:16 Vertical"
              >
                9:16
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[9px] text-gray-500 block font-mono mb-0.5">Top ({transform.crop?.top || 0}%)</label>
              <input
                type="range"
                min="0"
                max="45"
                value={transform.crop?.top || 0}
                onChange={(e) => handleCropChange("top", parseInt(e.target.value, 10))}
                className="w-full h-1 bg-[#16161A] rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
            </div>
            <div>
              <label className="text-[9px] text-gray-500 block font-mono mb-0.5">Bottom ({transform.crop?.bottom || 0}%)</label>
              <input
                type="range"
                min="0"
                max="45"
                value={transform.crop?.bottom || 0}
                onChange={(e) => handleCropChange("bottom", parseInt(e.target.value, 10))}
                className="w-full h-1 bg-[#16161A] rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
            </div>
            <div>
              <label className="text-[9px] text-gray-500 block font-mono mb-0.5">Left ({transform.crop?.left || 0}%)</label>
              <input
                type="range"
                min="0"
                max="45"
                value={transform.crop?.left || 0}
                onChange={(e) => handleCropChange("left", parseInt(e.target.value, 10))}
                className="w-full h-1 bg-[#16161A] rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
            </div>
            <div>
              <label className="text-[9px] text-gray-500 block font-mono mb-0.5">Right ({transform.crop?.right || 0}%)</label>
              <input
                type="range"
                min="0"
                max="45"
                value={transform.crop?.right || 0}
                onChange={(e) => handleCropChange("right", parseInt(e.target.value, 10))}
                className="w-full h-1 bg-[#16161A] rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
            </div>
          </div>
        </div>

        {/* 7. Speed & Dynamic Curve Ramping */}
        <div className="space-y-2 pt-2 border-t border-[#1F1F24]">
          <div className="flex items-center justify-between text-gray-300 font-semibold text-xs mb-1">
            <span className="flex items-center space-x-1.5">
              <Gauge className="w-3.5 h-3.5 text-indigo-400" />
              <span>Speed & Dynamic Curve Ramping</span>
            </span>
          </div>

          <SpeedCurveEditor
            currentSpeed={speedMultiplier}
            activePresetId={transform.speedCurvePreset}
            onSelectPreset={(preset) => {
              onUpdateTransform({
                ...transform,
                speedCurvePreset: preset.id,
              });
              onUpdateSpeed(preset.points[0]?.speed || 1.0);
            }}
            onSelectLinearSpeed={(spd) => {
              onUpdateTransform({
                ...transform,
                speedCurvePreset: undefined,
              });
              onUpdateSpeed(spd);
            }}
          />
        </div>

        {/* 8. Visual Transitions (In & Out) */}
        <div className="space-y-3 pt-2 border-t border-[#1F1F24]">
          <div className="flex items-center justify-between text-gray-300 font-semibold text-xs">
            <span className="flex items-center space-x-1.5">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span>Visual Transitions (In & Out)</span>
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Transition In */}
            <div className="space-y-1.5 bg-[#14141A] p-2.5 rounded-xl border border-[#22222E]">
              <div className="flex items-center justify-between text-[11px] font-semibold text-zinc-300">
                <span>Transition In</span>
                <span className="text-[10px] font-mono text-zinc-400">
                  {selectedClip.transitionIn
                    ? `${RationalTimeMath.toSeconds(selectedClip.transitionIn.duration).toFixed(1)}s`
                    : "None"}
                </span>
              </div>
              <select
                value={selectedClip.transitionIn?.type || "CUT"}
                onChange={(e) => {
                  const val = e.target.value as any;
                  if (val === "CUT") {
                    onUpdateTransitions?.(undefined, selectedClip.transitionOut);
                  } else {
                    const dur = selectedClip.transitionIn?.duration
                      ? RationalTimeMath.toSeconds(selectedClip.transitionIn.duration)
                      : 0.5;
                    onUpdateTransitions?.(
                      { type: val, duration: RationalTimeMath.fromSeconds(dur) },
                      selectedClip.transitionOut
                    );
                  }
                }}
                className="w-full bg-[#1C1C24] border border-[#2A2A38] text-xs rounded-lg px-2 py-1 text-zinc-200 outline-none cursor-pointer"
              >
                {TRANSITION_OPTIONS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              {selectedClip.transitionIn && (
                <div className="pt-1">
                  <input
                    type="range"
                    min="0.2"
                    max="1.5"
                    step="0.1"
                    value={RationalTimeMath.toSeconds(selectedClip.transitionIn.duration)}
                    onChange={(e) => {
                      const dur = parseFloat(e.target.value);
                      onUpdateTransitions?.(
                        { ...selectedClip.transitionIn!, duration: RationalTimeMath.fromSeconds(dur) },
                        selectedClip.transitionOut
                      );
                    }}
                    className="w-full h-1 bg-[#242430] rounded accent-amber-400 cursor-pointer"
                  />
                </div>
              )}
            </div>

            {/* Transition Out */}
            <div className="space-y-1.5 bg-[#14141A] p-2.5 rounded-xl border border-[#22222E]">
              <div className="flex items-center justify-between text-[11px] font-semibold text-zinc-300">
                <span>Transition Out</span>
                <span className="text-[10px] font-mono text-zinc-400">
                  {selectedClip.transitionOut
                    ? `${RationalTimeMath.toSeconds(selectedClip.transitionOut.duration).toFixed(1)}s`
                    : "None"}
                </span>
              </div>
              <select
                value={selectedClip.transitionOut?.type || "CUT"}
                onChange={(e) => {
                  const val = e.target.value as any;
                  if (val === "CUT") {
                    onUpdateTransitions?.(selectedClip.transitionIn, undefined);
                  } else {
                    const dur = selectedClip.transitionOut?.duration
                      ? RationalTimeMath.toSeconds(selectedClip.transitionOut.duration)
                      : 0.5;
                    onUpdateTransitions?.(
                      selectedClip.transitionIn,
                      { type: val, duration: RationalTimeMath.fromSeconds(dur) }
                    );
                  }
                }}
                className="w-full bg-[#1C1C24] border border-[#2A2A38] text-xs rounded-lg px-2 py-1 text-zinc-200 outline-none cursor-pointer"
              >
                {TRANSITION_OPTIONS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              {selectedClip.transitionOut && (
                <div className="pt-1">
                  <input
                    type="range"
                    min="0.2"
                    max="1.5"
                    step="0.1"
                    value={RationalTimeMath.toSeconds(selectedClip.transitionOut.duration)}
                    onChange={(e) => {
                      const dur = parseFloat(e.target.value);
                      onUpdateTransitions?.(
                        selectedClip.transitionIn,
                        { ...selectedClip.transitionOut!, duration: RationalTimeMath.fromSeconds(dur) }
                      );
                    }}
                    className="w-full h-1 bg-[#242430] rounded accent-amber-400 cursor-pointer"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
