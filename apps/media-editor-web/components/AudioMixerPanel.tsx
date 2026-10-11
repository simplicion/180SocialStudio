import React, { useState } from "react";
import {
  Volume2,
  VolumeX,
  Mic,
  Music,
  Sparkles,
  Sliders,
  X,
  Radio,
  Activity,
  Zap,
} from "lucide-react";
import { AudioTrack } from "@workspace/video-contracts";

interface AudioMixerPanelProps {
  isOpen: boolean;
  onClose: () => void;
  audioTracks: AudioTrack[];
  onUpdateTrackVolume: (trackId: string, volumeDb: number) => void;
  onToggleDucking: (enabled: boolean) => void;
  isDuckingEnabled: boolean;
  onAutoSoundDesign?: () => void;
}

const DEFAULT_CHANNELS: {
  id: string;
  name: string;
  type: "PRIMARY_VOICE" | "BGM" | "SFX" | "VOICEOVER";
  icon: any;
  defaultDb: number;
  color: string;
  meterColor: string;
}[] = [
  { id: "track_a1", name: "Dialogue (A1)", type: "PRIMARY_VOICE", icon: Mic, defaultDb: 0, color: "text-emerald-400 accent-emerald-500", meterColor: "from-emerald-500 to-teal-400" },
  { id: "track_a2", name: "BGM (A2)", type: "BGM", icon: Music, defaultDb: -6, color: "text-indigo-400 accent-indigo-500", meterColor: "from-indigo-500 to-purple-400" },
  { id: "track_a3", name: "SFX (A3)", type: "SFX", icon: Sparkles, defaultDb: -2, color: "text-amber-400 accent-amber-500", meterColor: "from-amber-500 to-yellow-400" },
];

export const AudioMixerPanel: React.FC<AudioMixerPanelProps> = ({
  isOpen,
  onClose,
  audioTracks,
  onUpdateTrackVolume,
  onToggleDucking,
  isDuckingEnabled,
  onAutoSoundDesign,
}) => {
  const [mutedChannels, setMutedChannels] = useState<Record<string, boolean>>({});
  const [soloChannels, setSoloChannels] = useState<Record<string, boolean>>({});
  const [duckingDb, setDuckingDb] = useState(-18);
  const [lufsTarget, setLufsTarget] = useState<"-14" | "-16" | "OFF">("-14");

  if (!isOpen) return null;

  const toggleMute = (id: string) => {
    setMutedChannels((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleSolo = (id: string) => {
    setSoloChannels((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Merge provided audioTracks or use defaults
  const channels = DEFAULT_CHANNELS.map((ch) => {
    const existing = audioTracks.find((t) => t.id === ch.id || t.type === ch.type);
    return {
      ...ch,
      id: existing?.id || ch.id,
      volumeDb: existing?.volumeDb ?? ch.defaultDb,
    };
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 select-none">
      <div className="w-full max-w-2xl bg-[#0A0A0D] border border-[#1C1C22] rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="p-4 border-b border-[#1C1C22] flex items-center justify-between bg-[#08080A]">
          <div className="flex items-center space-x-2 text-emerald-400">
            <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-zinc-100">Multi-Track Audio Mixer & Psychoacoustics</h3>
              <p className="text-[11px] text-zinc-400">Sidechain vocal ducking, broadcast loudness normalization & faders</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-[#16161C] transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mixer Body */}
        <div className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
          {/* Ducking Banner */}
          <div className="p-4 rounded-xl bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-indigo-500/10 border border-emerald-500/30 flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400">
                <Mic className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs font-bold text-emerald-300">Automated Vocal Ducking (Sidechain)</p>
                <p className="text-[11px] text-zinc-400">
                  Automatically reduces BGM volume by {duckingDb}dB whenever active speech is detected.
                </p>
              </div>
            </div>
            <button
              onClick={() => onToggleDucking(!isDuckingEnabled)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition active:scale-95 ${
                isDuckingEnabled
                  ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/30"
                  : "bg-[#111114] border border-[#1C1C22] text-zinc-400 hover:text-white"
              }`}
            >
              {isDuckingEnabled ? "ACTIVE" : "DISABLED"}
            </button>
          </div>

          {/* Quick Audio Subsystem Bar */}
          <div className="grid grid-cols-2 gap-3">
            {/* Loudness Target */}
            <div className="p-3 rounded-xl bg-[#0E0E12] border border-[#1C1C22] flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Activity className="w-4 h-4 text-cyan-400" />
                <div>
                  <p className="text-xs font-semibold text-zinc-200">Broadcast LUFS Target</p>
                  <p className="text-[10px] text-zinc-500">YouTube & IG Normalization</p>
                </div>
              </div>
              <div className="flex space-x-1">
                {(["-14", "-16", "OFF"] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setLufsTarget(mode)}
                    className={`px-2 py-1 rounded text-[10px] font-bold transition ${
                      lufsTarget === mode
                        ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/50"
                        : "bg-[#141418] text-zinc-500 hover:text-zinc-300 border border-[#1C1C22]"
                    }`}
                  >
                    {mode === "OFF" ? "Off" : `${mode} LUFS`}
                  </button>
                ))}
              </div>
            </div>

            {/* Auto Sound Design Button */}
            {onAutoSoundDesign && (
              <div className="p-3 rounded-xl bg-[#0E0E12] border border-[#1C1C22] flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  <div>
                    <p className="text-xs font-semibold text-zinc-200">Auto Sound Design</p>
                    <p className="text-[10px] text-zinc-500">Whooshes & Sub-Drops</p>
                  </div>
                </div>
                <button
                  onClick={onAutoSoundDesign}
                  className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 active:scale-95 text-black text-xs font-bold transition shadow"
                >
                  Generate SFX
                </button>
              </div>
            )}
          </div>

          {/* Track Channels Grid */}
          <div className="grid grid-cols-3 gap-3">
            {channels.map((ch) => {
              const Icon = ch.icon;
              const isMuted = Boolean(mutedChannels[ch.id]);
              const isSolo = Boolean(soloChannels[ch.id]);

              return (
                <div
                  key={ch.id}
                  className={`p-3.5 rounded-xl bg-[#0E0E12] border ${
                    isSolo
                      ? "border-amber-500/50 shadow-lg shadow-amber-500/10"
                      : isMuted
                      ? "border-[#1C1C22] opacity-60"
                      : "border-[#1C1C22]"
                  } flex flex-col items-center space-y-3 transition`}
                >
                  <div className="flex items-center justify-between w-full">
                    <div className={`flex items-center space-x-1.5 text-xs font-semibold ${ch.color.split(" ")[0]}`}>
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{ch.name}</span>
                    </div>

                    <div className="flex items-center space-x-1">
                      <button
                        onClick={() => toggleMute(ch.id)}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold transition ${
                          isMuted
                            ? "bg-rose-500 text-white shadow"
                            : "bg-[#141418] border border-[#1C1C22] text-zinc-400 hover:text-white"
                        }`}
                        title="Mute Track"
                      >
                        M
                      </button>
                      <button
                        onClick={() => toggleSolo(ch.id)}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold transition ${
                          isSolo
                            ? "bg-amber-500 text-black font-extrabold shadow"
                            : "bg-[#141418] border border-[#1C1C22] text-zinc-400 hover:text-white"
                        }`}
                        title="Solo Track"
                      >
                        S
                      </button>
                    </div>
                  </div>

                  {/* Vertical Fader Slider */}
                  <div className="h-32 w-full flex items-center justify-center relative">
                    <input
                      type="range"
                      min={-30}
                      max={6}
                      step={0.5}
                      value={isMuted ? -30 : ch.volumeDb}
                      onChange={(e) => onUpdateTrackVolume(ch.id, parseFloat(e.target.value))}
                      disabled={isMuted}
                      className="w-24 h-2 bg-[#1C1C22] rounded-lg appearance-none cursor-pointer -rotate-90 origin-center accent-white"
                    />
                  </div>

                  {/* dB Readout */}
                  <div className="text-center font-mono text-xs font-bold text-zinc-300">
                    {isMuted ? "-INF dB" : `${ch.volumeDb > 0 ? "+" : ""}${ch.volumeDb.toFixed(1)} dB`}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-[#1C1C22] bg-[#08080A] flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl text-xs font-medium text-zinc-200 bg-[#141418] hover:bg-[#1C1C22] border border-[#1C1C22] transition"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
