import React, { useState } from "react";
import {
  X,
  Subtitles,
  Plus,
  Trash2,
  Sparkles,
  Type,
  Palette,
  Clock,
  Flame,
  Coffee,
  Zap,
} from "lucide-react";
import toast from "react-hot-toast";
import { CaptionSegment, RationalTimeMath } from "@workspace/video-contracts";

export interface CaptionStyleTemplate {
  id: string;
  name: string;
  subtitle: string;
  icon: any;
  color: string;
  style: {
    preset: any;
    fontFamily: string;
    fontSize: number;
    textColor: string;
    highlightColor: string;
    strokeWidth?: number;
    strokeColor?: string;
    shadow?: boolean;
    glow?: boolean;
    pillBackground?: string;
    pillRadius?: number;
    pillPadding?: number;
  };
}

export const CAPTION_STYLE_PRESETS: CaptionStyleTemplate[] = [
  {
    id: "HORMOZI_BOUNCE",
    name: "Hormozi Viral",
    subtitle: "Yellow / Green Bold",
    icon: Flame,
    color: "text-amber-400 border-amber-500/40",
    style: {
      preset: "HORMOZI_BOUNCE",
      fontFamily: "Anton",
      fontSize: 52,
      textColor: "#FACC15",
      highlightColor: "#22C55E",
      strokeWidth: 3,
      strokeColor: "#000000",
      shadow: true,
      glow: false,
    },
  },
  {
    id: "MRBEAST_HYPE",
    name: "MrBeast Punch",
    subtitle: "Red / White Impact",
    icon: Zap,
    color: "text-rose-400 border-rose-500/40",
    style: {
      preset: "HORMOZI_BOUNCE",
      fontFamily: "Montserrat",
      fontSize: 54,
      textColor: "#FFFFFF",
      highlightColor: "#EF4444",
      strokeWidth: 4,
      strokeColor: "#000000",
      shadow: true,
      glow: false,
    },
  },
  {
    id: "ALI_ABDAAL_CLEAN",
    name: "Abdaal Aesthetic",
    subtitle: "Clean Teal & White",
    icon: Coffee,
    color: "text-teal-400 border-teal-500/40",
    style: {
      preset: "ALI_ABDAAL_CLEAN",
      fontFamily: "Poppins",
      fontSize: 44,
      textColor: "#FFFFFF",
      highlightColor: "#14B8A6",
      strokeWidth: 0,
      shadow: true,
      glow: false,
      pillBackground: "rgba(0,0,0,0.45)",
      pillRadius: 14,
      pillPadding: 6,
    },
  },
  {
    id: "DAN_KOE_MINIMAL",
    name: "Dan Koe Clean",
    subtitle: "Minimalist Grotesque",
    icon: Type,
    color: "text-zinc-300 border-zinc-500/40",
    style: {
      preset: "MINIMAL_SUBTITLE",
      fontFamily: "Syne",
      fontSize: 40,
      textColor: "#FFFFFF",
      highlightColor: "#94A3B8",
      strokeWidth: 0,
      shadow: false,
      glow: false,
    },
  },
  {
    id: "CYBER_NEON",
    name: "Cyber Neon",
    subtitle: "Cyan & Magenta Glow",
    icon: Sparkles,
    color: "text-cyan-400 border-cyan-500/40",
    style: {
      preset: "BOLD_CENTER",
      fontFamily: "Outfit",
      fontSize: 48,
      textColor: "#38BDF8",
      highlightColor: "#EC4899",
      strokeWidth: 1,
      strokeColor: "#0284C7",
      shadow: false,
      glow: true,
    },
  },
  {
    id: "KARAOKE_FROSTED",
    name: "Frosted Pill",
    subtitle: "Blurred Backdrop Box",
    icon: Subtitles,
    color: "text-indigo-400 border-indigo-500/40",
    style: {
      preset: "HORMOZI_BOUNCE",
      fontFamily: "Inter",
      fontSize: 46,
      textColor: "#FFFFFF",
      highlightColor: "#FBBF24",
      strokeWidth: 0,
      shadow: true,
      glow: false,
      pillBackground: "rgba(15,23,42,0.85)",
      pillRadius: 20,
      pillPadding: 10,
    },
  },
  {
    id: "VOX_EXPLAINER",
    name: "Vox Explainer",
    subtitle: "Yellow Highlighter",
    icon: Palette,
    color: "text-yellow-400 border-yellow-500/40",
    style: {
      preset: "BOLD_CENTER",
      fontFamily: "Roboto",
      fontSize: 42,
      textColor: "#0F172A",
      highlightColor: "#000000",
      strokeWidth: 0,
      shadow: false,
      glow: false,
      pillBackground: "#FACC15",
      pillRadius: 6,
      pillPadding: 6,
    },
  },
  {
    id: "CINEMATIC_SUBTITLE",
    name: "Cinema Subtitle",
    subtitle: "Bebas Neue Sans",
    icon: Clock,
    color: "text-amber-200 border-amber-300/40",
    style: {
      preset: "MINIMAL_SUBTITLE",
      fontFamily: "Bebas Neue",
      fontSize: 48,
      textColor: "#F8FAFC",
      highlightColor: "#F59E0B",
      strokeWidth: 1,
      strokeColor: "#0F172A",
      shadow: true,
      glow: false,
    },
  },
];

interface CaptionStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  captions: CaptionSegment[];
  onUpdateCaptions: (captions: CaptionSegment[]) => void;
}

export const CaptionStudioModal: React.FC<CaptionStudioModalProps> = ({
  isOpen,
  onClose,
  captions,
  onUpdateCaptions,
}) => {
  if (!isOpen) return null;

  const [selectedCapIndex, setSelectedCapIndex] = useState(0);
  const activeCap = captions[selectedCapIndex];

  const handleTextChange = (newText: string) => {
    if (!activeCap) return;
    const words = newText.split(/\s+/).filter(Boolean);
    const startSec = RationalTimeMath.toSeconds(activeCap.timeRange.start);
    const durationSec = RationalTimeMath.toSeconds(activeCap.timeRange.duration);
    const wordDur = durationSec / Math.max(1, words.length);

    const updatedWords = words.map((w, idx) => ({
      word: w,
      start: RationalTimeMath.fromSeconds(startSec + idx * wordDur),
      end: RationalTimeMath.fromSeconds(startSec + (idx + 1) * wordDur),
      highlight: idx % 2 === 0,
      scaleMultiplier: 1.1,
    }));

    const updated = [...captions];
    updated[selectedCapIndex] = {
      ...activeCap,
      text: newText,
      words: updatedWords,
    };
    onUpdateCaptions(updated);
  };

  const handleApplyPreset = (template: CaptionStyleTemplate, applyToAll = false) => {
    if (!activeCap) return;
    if (applyToAll) {
      const updated = captions.map((c) => ({
        ...c,
        style: {
          ...c.style,
          ...template.style,
        },
      }));
      onUpdateCaptions(updated);
      toast.success(`Applied "${template.name}" style to all subtitles!`);
    } else {
      const updated = [...captions];
      updated[selectedCapIndex] = {
        ...activeCap,
        style: {
          ...activeCap.style,
          ...template.style,
        },
      };
      onUpdateCaptions(updated);
      toast.success(`Applied "${template.name}" to selected subtitle!`);
    }
  };

  const handleStyleUpdate = (styleUpdates: any) => {
    if (!activeCap) return;
    const updated = [...captions];
    updated[selectedCapIndex] = {
      ...activeCap,
      style: {
        ...activeCap.style,
        ...styleUpdates,
      },
    };
    onUpdateCaptions(updated);
  };

  const handleAddCaption = () => {
    const newCap: CaptionSegment = {
      id: `cap_${Date.now()}` as any,
      timeRange: {
        start: RationalTimeMath.fromSeconds(captions.length * 2.0),
        duration: RationalTimeMath.fromSeconds(1.5),
      },
      text: "NEW SUBTITLE",
      words: [
        {
          word: "NEW",
          start: RationalTimeMath.fromSeconds(captions.length * 2.0),
          end: RationalTimeMath.fromSeconds(captions.length * 2.0 + 0.7),
          highlight: true,
          scaleMultiplier: 1.1,
        },
        {
          word: "SUBTITLE",
          start: RationalTimeMath.fromSeconds(captions.length * 2.0 + 0.75),
          end: RationalTimeMath.fromSeconds(captions.length * 2.0 + 1.5),
          highlight: false,
          scaleMultiplier: 1.0,
        },
      ],
      style: {
        preset: "HORMOZI_BOUNCE",
        fontFamily: "Inter",
        fontSize: 48,
        textColor: "#FACC15",
        highlightColor: "#00FF88",
        position: { x: 0.5, y: 0.8 },
        shadow: true,
      },
    };

    onUpdateCaptions([...captions, newCap]);
    setSelectedCapIndex(captions.length);
  };

  const handleDeleteCaption = (index: number) => {
    const updated = captions.filter((_, i) => i !== index);
    onUpdateCaptions(updated);
    setSelectedCapIndex(Math.max(0, index - 1));
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 select-none">
      <div className="w-full max-w-4xl bg-surface border border-surface-border rounded-2xl shadow-2xl overflow-hidden flex flex-col h-[650px] animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="p-4 border-b border-surface-border flex items-center justify-between">
          <div className="flex items-center space-x-2 text-cyan-400">
            <Subtitles className="w-5 h-5" />
            <div>
              <h3 className="text-sm font-semibold text-gray-100">Kinetic Caption & Subtitle Studio</h3>
              <p className="text-[11px] text-gray-400">Word-by-word karaoke timing and retention animations</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-surface-hover transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Studio Body */}
        <div className="flex-1 flex min-h-0">
          {/* Left: Caption Segments List */}
          <div className="w-80 border-r border-surface-border bg-surface-subtle/50 flex flex-col h-full">
            <div className="p-3 border-b border-surface-border flex items-center justify-between">
              <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                Timeline Subtitles ({captions.length})
              </span>
              <button
                onClick={handleAddCaption}
                className="flex items-center space-x-1 px-2 py-1 rounded bg-brand text-[11px] font-medium text-white hover:bg-brand-hover transition shadow-sm"
              >
                <Plus className="w-3 h-3" />
                <span>Add</span>
              </button>
            </div>

            <div className="p-2 overflow-y-auto flex-1 space-y-2">
              {captions.map((cap, idx) => {
                const startSec = RationalTimeMath.toSeconds(cap.timeRange.start);
                const isSelected = selectedCapIndex === idx;

                return (
                  <div
                    key={cap.id}
                    onClick={() => setSelectedCapIndex(idx)}
                    className={`p-2.5 rounded-xl border cursor-pointer transition ${
                      isSelected
                        ? "bg-cyan-500/10 border-cyan-500 text-cyan-200 shadow-md"
                        : "bg-surface border-surface-border hover:border-surface-hover text-gray-300"
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px] font-mono text-gray-500 mb-1">
                      <span>#{idx + 1} • {startSec.toFixed(2)}s</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteCaption(idx);
                        }}
                        className="text-gray-500 hover:text-red-400 p-0.5 rounded"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                    <p className="text-xs font-semibold truncate">"{cap.text}"</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: Active Caption Editor */}
          {activeCap ? (
            <div className="flex-1 p-6 overflow-y-auto space-y-6">
              {/* Preset Selector */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <label className="text-xs font-semibold text-gray-200 block">
                      CapCut Viral Style Pretemplates (8 Styles)
                    </label>
                    <span className="text-[10px] text-zinc-400">Click a style to apply to this subtitle, or apply to all</span>
                  </div>
                  <button
                    onClick={() => {
                      const matched = CAPTION_STYLE_PRESETS.find(
                        (p) => p.style.fontFamily === activeCap.style.fontFamily || p.id === activeCap.style.preset
                      ) || CAPTION_STYLE_PRESETS[0];
                      handleApplyPreset(matched, true);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/40 text-[11px] font-semibold transition shadow-sm active:scale-95"
                    title="Apply current style to all subtitles on the timeline"
                  >
                    Apply Style to All ({captions.length})
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {CAPTION_STYLE_PRESETS.map((p) => {
                    const Icon = p.icon;
                    const isSelected =
                      activeCap.style.preset === p.id ||
                      (activeCap.style.fontFamily === p.style.fontFamily &&
                        activeCap.style.highlightColor === p.style.highlightColor);
                    return (
                      <button
                        key={p.id}
                        onClick={() => handleApplyPreset(p, false)}
                        className={`p-2.5 rounded-xl border flex flex-col items-start space-y-1 text-left transition ${
                          isSelected
                            ? `bg-cyan-950/40 border-cyan-400 text-white shadow-lg ring-1 ring-cyan-400/40`
                            : `bg-surface-subtle border-surface-border text-gray-400 hover:text-white hover:border-surface-hover`
                        }`}
                      >
                        <div className="flex items-center space-x-1.5 w-full">
                          <Icon className={`w-3.5 h-3.5 ${isSelected ? "text-cyan-400" : "text-zinc-400"} shrink-0`} />
                          <span className="text-xs font-bold truncate text-zinc-100">{p.name}</span>
                        </div>
                        <span className="text-[9px] text-zinc-400 font-mono truncate w-full">{p.subtitle}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Live Styled Preview Card */}
              <div className="bg-[#0A0A0E] border border-[#22222E] rounded-xl p-4 flex flex-col items-center justify-center min-h-[90px] relative overflow-hidden shadow-inner">
                <span className="absolute top-2 left-3 text-[9px] font-mono text-zinc-500 uppercase tracking-wider">
                  Live Typography Preview
                </span>
                <div
                  style={{
                    fontFamily: `'${activeCap.style.fontFamily || "Inter"}', sans-serif`,
                    fontSize: `${Math.min(36, activeCap.style.fontSize || 32)}px`,
                    color: activeCap.style.textColor || "#FFFFFF",
                    WebkitTextStroke: activeCap.style.strokeWidth ? `${activeCap.style.strokeWidth}px ${activeCap.style.strokeColor || "#000000"}` : "none",
                    textShadow: activeCap.style.glow
                      ? `0 0 16px ${activeCap.style.highlightColor || "#00FF88"}`
                      : activeCap.style.shadow
                      ? "0 4px 14px rgba(0,0,0,0.9)"
                      : "none",
                    backgroundColor: activeCap.style.pillBackground || "transparent",
                    padding: activeCap.style.pillBackground ? `${activeCap.style.pillPadding || 8}px 16px` : "0",
                    borderRadius: activeCap.style.pillBackground ? `${activeCap.style.pillRadius || 14}px` : "0",
                  }}
                  className="font-extrabold tracking-wide uppercase text-center transition-all"
                >
                  {activeCap.text || "PREVIEW TEXT"}
                </div>
              </div>

              {/* Subtitle Text Input */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-300 block">
                  Subtitle Text Content
                </label>
                <textarea
                  rows={2}
                  value={activeCap.text}
                  onChange={(e) => handleTextChange(e.target.value)}
                  className="w-full bg-surface-subtle border border-surface-border rounded-xl p-3 text-sm text-gray-100 font-medium focus:outline-none focus:border-cyan-500"
                />
              </div>

              {/* Rich Typography & Google Fonts Grid */}
              <div className="space-y-3 bg-[#0D0D12] p-4 rounded-xl border border-[#1F1F2A]">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-zinc-200 flex items-center space-x-1.5">
                    <Type className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Google Fonts & Typography</span>
                  </span>
                  <span className="text-[10px] font-mono text-zinc-400">
                    {activeCap.style.fontFamily || "Inter"}
                  </span>
                </div>

                {/* Google Fonts Selector */}
                <div className="grid grid-cols-4 gap-1.5">
                  {[
                    "Inter",
                    "Bebas Neue",
                    "Montserrat",
                    "Anton",
                    "Outfit",
                    "Syne",
                    "Poppins",
                    "Roboto",
                  ].map((font) => (
                    <button
                      key={font}
                      onClick={() => handleStyleUpdate({ fontFamily: font })}
                      className={`py-1.5 px-2 rounded-lg text-xs font-semibold border truncate transition ${
                        (activeCap.style.fontFamily || "Inter") === font
                          ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/50 shadow-sm"
                          : "bg-[#14141A] text-zinc-400 border-[#22222D] hover:text-white hover:bg-[#1A1A22]"
                      }`}
                      style={{ fontFamily: `'${font}', sans-serif` }}
                    >
                      {font}
                    </button>
                  ))}
                </div>

                {/* Size & Stroke Sliders */}
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <div>
                    <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1">
                      <span>Font Size</span>
                      <span className="font-mono text-zinc-200">{activeCap.style.fontSize || 48}px</span>
                    </div>
                    <input
                      type="range"
                      min="24"
                      max="96"
                      step="2"
                      value={activeCap.style.fontSize || 48}
                      onChange={(e) => handleStyleUpdate({ fontSize: parseInt(e.target.value, 10) })}
                      className="w-full h-1 bg-[#22222E] rounded accent-cyan-400 cursor-pointer"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1">
                      <span>Text Stroke (Outline)</span>
                      <span className="font-mono text-zinc-200">{activeCap.style.strokeWidth || 0}px</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="6"
                      step="1"
                      value={activeCap.style.strokeWidth || 0}
                      onChange={(e) => handleStyleUpdate({ strokeWidth: parseInt(e.target.value, 10) })}
                      className="w-full h-1 bg-[#22222E] rounded accent-cyan-400 cursor-pointer"
                    />
                  </div>
                </div>

                {/* Colors & Toggles */}
                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[#1C1C24]">
                  {/* Text Color */}
                  <div>
                    <label className="text-[10px] text-zinc-400 block mb-1">Text Color</label>
                    <div className="flex items-center space-x-1.5">
                      <input
                        type="color"
                        value={activeCap.style.textColor || "#FFFFFF"}
                        onChange={(e) => handleStyleUpdate({ textColor: e.target.value })}
                        className="w-7 h-7 rounded border border-white/20 bg-transparent cursor-pointer"
                      />
                      <span className="text-[10px] font-mono text-zinc-300 uppercase">
                        {activeCap.style.textColor || "#FFFFFF"}
                      </span>
                    </div>
                  </div>

                  {/* Highlight Color */}
                  <div>
                    <label className="text-[10px] text-zinc-400 block mb-1">Highlight Color</label>
                    <div className="flex items-center space-x-1.5">
                      <input
                        type="color"
                        value={activeCap.style.highlightColor || "#00FF88"}
                        onChange={(e) => handleStyleUpdate({ highlightColor: e.target.value })}
                        className="w-7 h-7 rounded border border-white/20 bg-transparent cursor-pointer"
                      />
                      <span className="text-[10px] font-mono text-zinc-300 uppercase">
                        {activeCap.style.highlightColor || "#00FF88"}
                      </span>
                    </div>
                  </div>

                  {/* Glow / Shadow Toggle */}
                  <div>
                    <label className="text-[10px] text-zinc-400 block mb-1">Effects</label>
                    <div className="flex items-center space-x-1">
                      <button
                        onClick={() => handleStyleUpdate({ glow: !activeCap.style.glow })}
                        className={`px-2 py-1 rounded text-[10px] font-semibold border transition ${
                          activeCap.style.glow
                            ? "bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm"
                            : "bg-[#14141A] text-zinc-500 border-[#22222D] hover:text-white"
                        }`}
                      >
                        Neon Glow
                      </button>
                      <button
                        onClick={() =>
                          handleStyleUpdate({
                            pillBackground: activeCap.style.pillBackground
                              ? undefined
                              : "rgba(0,0,0,0.85)",
                          })
                        }
                        className={`px-2 py-1 rounded text-[10px] font-semibold border transition ${
                          activeCap.style.pillBackground
                            ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/40 shadow-sm"
                            : "bg-[#14141A] text-zinc-500 border-[#22222D] hover:text-white"
                        }`}
                      >
                        Pill Box
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Word Timings Preview */}
              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-2">
                  Karaoke Word Timings & Highlights
                </label>
                <div className="flex flex-wrap gap-2">
                  {activeCap.words?.map((w, wIdx) => {
                    const wStart = RationalTimeMath.toSeconds(w.start);
                    const wEnd = RationalTimeMath.toSeconds(w.end);
                    return (
                      <div
                        key={wIdx}
                        className={`px-3 py-1.5 rounded-xl border flex items-center space-x-2 text-xs font-bold ${
                          w.highlight
                            ? "bg-amber-500/20 border-amber-500/60 text-amber-300 shadow-sm"
                            : "bg-surface-subtle border-surface-border text-gray-300"
                        }`}
                      >
                        <span>{w.word}</span>
                        <span className="text-[9px] font-mono text-gray-500">
                          {((wEnd - wStart) * 1000).toFixed(0)}ms
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs text-gray-500">
              Select or add a caption segment to begin editing.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-surface-border bg-surface-subtle flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-brand hover:bg-brand-hover transition shadow-md"
          >
            Apply Captions
          </button>
        </div>
      </div>
    </div>
  );
};
