import React, { useState, useRef, useEffect } from "react";
import {
  Sparkles,
  Send,
  Trash2,
  Undo2,
  Smartphone,
  Monitor,
  Bot,
  User,
  Lightbulb,
  CheckCircle2,
  AlertCircle,
  Scissors,
  Subtitles,
  Mic,
  Film,
  Zap,
  BarChart3,
  Palette,
  Code2,
  ChevronsLeft,
  ChevronsRight,
  ChevronLeft,
} from "lucide-react";
import { DirectorStylePreset, EditIR } from "@workspace/video-contracts";
import { CompanyAIStatus, AIDirectorProgressEvent, DirectorPlannerSource, DirectorCritique } from "../services/tauri-bridge";
import { QualityIssuesList } from "./QualityIssuesList";
import type { LastExportQa } from "../services/media-analysis";
import { AICreditProgressWidget } from "@workspace/ui";

export interface DirectorChatMessage {
  /** Server run id of the director turn that produced this message (agent-memory feedback). */
  runId?: string;
  id: string;
  sender: "user" | "director";
  text: string;
  timestamp: string;
  actions?: string[];
  snapshotEditIR?: EditIR;
  /** Who planned this turn: the LLM, the server's rule-based fallback, or offline rules on this device. */
  plannerSource?: DirectorPlannerSource;
  plannerReason?: string;
  warnings?: string[];
  /** Set on a failed turn: the prompt to retry (or run with the offline rules). */
  retryPrompt?: string;
  /** The server applied this turn without asking (project editing autonomy AUTO, safe operations only). */
  autoApplied?: boolean;
  /** The server critic's review of the result. */
  critique?: DirectorCritique;
  /** Changes dropped because they broke the timeline locks (server validator or the client re-check). */
  violations?: string[];
  pendingConfirmation?: {
    whatFound: string;
    whatWillChange: string;
    assumptions: string;
    /** A compiled timeline to apply, or ... */
    targetEditIR?: EditIR;
    /** ... a prompt to run through the director once the user confirms (greeting proposal). */
    suggestedPrompt?: string;
  };
}

export interface DirectorPromptOptions {
  /** The user already approved this (greeting Apply): apply the result without asking again. */
  preconfirmed?: boolean;
  /** Use the offline keyword rules on this device instead of the AI Director. */
  offline?: boolean;
  /** QA of the last export: this turn is a repair of what the quality check found. */
  lastExportQa?: LastExportQa;
}

const PLANNER_LABEL: Record<DirectorPlannerSource, string> = {
  llm: "AI planner",
  deterministic: "Rule-based fallback",
  offline: "Offline rules (this device)",
};

interface AIDirectorPanelProps {
  currentPreset?: DirectorStylePreset;
  onSelectPreset?: (preset: DirectorStylePreset) => void;
  onApplyPrompt: (prompt: string, options?: DirectorPromptOptions) => Promise<void> | void;
  isProcessing: boolean;
  currentProgress?: AIDirectorProgressEvent | null;
  companyAIStatus?: CompanyAIStatus | null;
  onRefreshAIStatus?: () => void;
  messages: DirectorChatMessage[];
  onRevertToMessage?: (message: DirectorChatMessage) => void;
  onClearMessages?: () => void;
  currentAspect?: "16:9" | "9:16" | "1:1";
  timelineDurationSec?: number;
  clipsCount?: number;
  selectedClipId?: string | null;
  userProfile?: {
    name?: string;
    photoUrl?: string;
    email?: string;
  } | null;
  onToggleCollapse?: () => void;
  onConfirmAutonomousEdit?: (message: DirectorChatMessage) => void;
  onCancelAutonomousEdit?: (message: DirectorChatMessage) => void;
  /** Stops the running director turn (analysis or request). */
  onCancelRun?: () => void;
  /** Seeks the timeline (ms), e.g. from a critique issue. */
  onSeekMs?: (ms: number) => void;
  /** Number of locked tracks/ranges the director will be told to respect. */
  lockCount?: number;
}


const INSPIRATION_SUGGESTIONS = [
  {
    label: "📱 9:16 Vertical Reel",
    prompt: "Convert to 9:16 vertical Reel with high-retention pacing and bouncing captions.",
    icon: Smartphone,
  },
  {
    label: "💬 Blue Kinetic Captions",
    prompt: "Add blue animated kinetic captions in safe zone.",
    icon: Subtitles,
  },
  {
    label: "📊 Motion Graphic Cards",
    prompt: "Add visuals and animated explanation cards according to what I'm explaining.",
    icon: BarChart3,
  },
  {
    label: "🎥 Pexels HD B-Roll Cutaways",
    prompt: "Source context-matched HD B-roll footage and cutaways from Pexels stock video library to overlay during key explanations.",
    icon: Film,
  },
  {
    label: "🎙️ Multi-Cam Podcast",
    prompt: "Direct as a multi-cam podcast with speaker diarization, reaction cutaways, and J/L-cuts.",
    icon: Mic,
  },
  {
    label: "🎬 Cinematic Color Grade",
    prompt: "Apply a cinematic teal and orange film look with S-curve contrast.",
    icon: Palette,
  },
  {
    label: "⚡ MrBeast Fast Pacing",
    prompt: "Edit with MrBeast high-retention style: aggressive 1.35x cuts, punch zooms, and neon highlights.",
    icon: Zap,
  },
  {
    label: "💡 Dan Koe Minimalist",
    prompt: "Apply Dan Koe minimalist aesthetic: clean typography, calm pacing, and subtle zoom.",
    icon: Lightbulb,
  },
  {
    label: "✂️ Trim Dead Air",
    prompt: "Clean up awkward pauses and dead air across my clips.",
    icon: Scissors,
  },
];


export const AIDirectorPanel: React.FC<AIDirectorPanelProps> = ({
  onApplyPrompt,
  isProcessing,
  currentProgress,
  messages,
  onRevertToMessage,
  onClearMessages,
  currentAspect = "16:9",
  timelineDurationSec = 0,
  clipsCount = 0,
  userProfile,
  onToggleCollapse,
  onConfirmAutonomousEdit,
  onCancelAutonomousEdit,
  onCancelRun,
  onSeekMs,
  lockCount = 0,
}) => {
  const [prompt, setPrompt] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll messages to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isProcessing, currentProgress]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!prompt.trim() || isProcessing) return;
    const currentPrompt = prompt.trim();
    setPrompt("");
    onApplyPrompt(currentPrompt);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSuggestionClick = (suggestedText: string) => {
    if (isProcessing) return;
    onApplyPrompt(suggestedText);
  };

  return (
    <div className="w-full flex-1 flex flex-col select-none relative bg-[#090A0E] text-gray-200 overflow-hidden font-sans">
      {/* Clean, Minimalist Header with Official 180 AI Logo & <> Collapse Toggle */}
      <div className="px-3.5 py-3 border-b border-[#1A1C24] bg-[#0C0E15] shrink-0 flex items-center justify-between">
        <div className="flex items-center space-x-2.5">
          <div className="p-1 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
            <img
              src="/white-icon.svg"
              onError={(e) => {
                e.currentTarget.src = "/white icon.svg";
              }}
              alt="180 AI"
              className="w-4 h-4 object-contain"
            />
          </div>
          <div>
            <div className="flex items-center space-x-1.5">
              <span className="font-semibold text-xs tracking-wide text-white">Creative Director</span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            </div>
            <span className="text-[10px] text-gray-400 block">AI Editing Co-Pilot</span>
          </div>
        </div>

        <div className="flex items-center space-x-1.5">
          <div className="px-2 py-0.5 rounded-full bg-[#141722] border border-[#212638] text-[10px] text-gray-400 font-mono">
            {currentAspect} • {timelineDurationSec.toFixed(1)}s • {clipsCount} {clipsCount === 1 ? "clip" : "clips"}
          </div>

          {onClearMessages && messages.length > 0 && (
            <button
              onClick={onClearMessages}
              className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-[#1A1D2A] transition"
              title="Start fresh conversation"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Sidebar Collapse Toggle Button (<>) */}
          {onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-[#1A1D2A] border border-[#212638] transition flex items-center justify-center"
              title="Collapse AI Director Panel (<>)"
            >
              <ChevronsLeft className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Real-Time AI Credit Usage & Recharge Widget */}
      <div className="px-3 pt-2.5 pb-1 bg-[#090A0E] shrink-0">
        <AICreditProgressWidget />
      </div>

      {/* Message Thread */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5 scrollbar-thin scrollbar-thumb-[#1F222E] scrollbar-track-transparent">
        {/* Welcome State when no messages */}
        {messages.length === 0 && (
          <div className="p-4 rounded-2xl bg-gradient-to-b from-[#121522] to-[#0D0F17] border border-indigo-500/20 shadow-sm space-y-3">
            {clipsCount === 0 ? (
              <div className="space-y-3">
                <div className="flex items-center space-x-2.5">
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/30">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      Prompt-to-Video Engine
                      <span className="px-1.5 py-0.2 rounded text-[9px] bg-emerald-950/80 text-emerald-400 border border-emerald-500/30 font-mono">
                        0 FOOTAGE NEEDED
                      </span>
                    </span>
                    <span className="text-[10px] text-gray-400 block">
                      Autonomous Cartesia Narration + Pixabay & Pexels Stock
                    </span>
                  </div>
                </div>

                <p className="text-xs text-gray-300 leading-relaxed">
                  No video files in your project? Just type what you want to create! The AI Director writes the script, narrates with <strong>Cartesia Sonic-3.6</strong> studio neural voice, sources <strong>Pexels 4K video</strong> &amp; <strong>Pixabay vector illustrations</strong>, aligns <strong>Whisper captions</strong>, ducks background music, and builds your multi-track timeline automatically.
                </p>

                <div className="pt-2 border-t border-white/5 space-y-1.5">
                  <span className="text-[10px] uppercase font-semibold tracking-wider text-indigo-400 block">
                    ⚡ Instant Generation Templates:
                  </span>
                  <div className="grid grid-cols-1 gap-1.5">
                    {[
                      {
                        label: "📱 30s Viral SaaS Product Launch Ad (9:16)",
                        prompt: "Create a fast-paced 30-second vertical TikTok ad for our AI software platform. Hook the viewer immediately, use energetic confident narration, dynamic tech B-roll from Pexels, bold kinetic captions, and upbeat electronic music.",
                      },
                      {
                        label: "🌟 Explainer Video with Pixabay Vector Illustrations",
                        prompt: "Create an engaging corporate explainer video highlighting workplace AI automation. Include authoritative narration, Pixabay transparent vector diagrams, professional office B-roll cutaways, and ambient background music.",
                      },
                      {
                        label: "🚀 High-Converting Startup Feature Reel",
                        prompt: "Generate a high-converting startup teaser video showcasing revolutionary workflow speed. Confident founder voice, rapid cuts, and bouncing yellow kinetic subtitles in safe zone.",
                      },
                    ].map((item, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleSuggestionClick(item.prompt)}
                        className="text-left px-2.5 py-2 rounded-xl bg-[#141825] hover:bg-indigo-950/40 hover:border-indigo-500/40 border border-white/5 text-[11px] text-gray-200 hover:text-white transition flex items-center justify-between group"
                      >
                        <span className="font-medium">{item.label}</span>
                        <ChevronLeft className="w-3.5 h-3.5 text-indigo-400 rotate-180 opacity-60 group-hover:opacity-100 shrink-0 ml-1.5" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center space-x-2.5">
                  <div className="w-7 h-7 rounded-xl bg-indigo-600/25 border border-indigo-500/35 flex items-center justify-center text-indigo-300">
                    <img
                      src="/white-icon.svg"
                      onError={(e) => {
                        e.currentTarget.src = "/white icon.svg";
                      }}
                      alt="180 AI"
                      className="w-4 h-4 object-contain"
                    />
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-white">Creative Director Ready</span>
                    <span className="text-[10px] text-gray-400 block">Collaborative video editing</span>
                  </div>
                </div>

                <p className="text-xs text-gray-300 leading-relaxed">
                  I&apos;m your creative partner. Talk to me naturally about your video vision, ask for ideas on hooks and pacing, or tell me how you want your clips cut.
                </p>

                <div className="pt-2 border-t border-white/5">
                  <span className="text-[10px] uppercase font-semibold tracking-wider text-gray-400 block mb-1.5">
                    Try asking:
                  </span>
                  <div className="grid grid-cols-1 gap-1.5">
                    {INSPIRATION_SUGGESTIONS.map((item, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleSuggestionClick(item.prompt)}
                        className="text-left px-2.5 py-1.5 rounded-xl bg-[#141825] hover:bg-indigo-950/40 hover:border-indigo-500/40 border border-white/5 text-[11px] text-gray-300 hover:text-white transition flex items-center justify-between group"
                      >
                        <span>{item.prompt}</span>
                        <item.icon className="w-3 h-3 text-indigo-400 opacity-60 group-hover:opacity-100 shrink-0 ml-1.5" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Message Bubble Stream with User Avatar */}
        {messages.map((msg) => {
          const isUser = msg.sender === "user";

          return (
            <div
              key={msg.id}
              className={`flex items-start space-x-2 ${
                isUser ? "flex-row-reverse space-x-reverse" : "flex-row"
              }`}
            >
              {isUser ? (
                userProfile?.photoUrl ? (
                  <img
                    src={userProfile.photoUrl}
                    alt={userProfile.name || "You"}
                    className="w-6 h-6 rounded-xl object-cover shrink-0 mt-0.5 border border-indigo-500/40"
                  />
                ) : (
                  <div className="w-6 h-6 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-bold text-[11px] flex items-center justify-center shrink-0 mt-0.5 border border-indigo-500/30">
                    {(userProfile?.name?.[0] || userProfile?.email?.[0] || "U").toUpperCase()}
                  </div>
                )
              ) : (
                <div className="w-6 h-6 rounded-xl bg-[#161824] border border-indigo-500/30 flex items-center justify-center shrink-0 mt-0.5 text-indigo-300">
                  <img
                    src="/white-icon.svg"
                    onError={(e) => {
                      e.currentTarget.src = "/white icon.svg";
                    }}
                    alt="AI"
                    className="w-3.5 h-3.5 object-contain"
                  />
                </div>
              )}

              <div
                className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed transition-all shadow-sm ${
                  isUser
                    ? "bg-gradient-to-br from-indigo-600 to-indigo-700 text-white rounded-tr-sm"
                    : "bg-[#11131C] border border-[#1E212E] text-gray-200 rounded-tl-sm"
                }`}
              >
                <div className="flex items-center justify-between space-x-3 mb-1 text-[10px] text-gray-400">
                  <span className="font-semibold tracking-wide text-gray-300">
                    {isUser ? (userProfile?.name || "You") : "Director"}
                  </span>
                  <span className="font-mono text-[9px] opacity-75">{msg.timestamp}</span>
                </div>

                <div className="whitespace-pre-wrap font-sans text-[12px]">{msg.text}</div>

                {!isUser && msg.plannerSource && (
                  <div
                    className={`mt-1.5 text-[10px] ${msg.plannerSource === "llm" ? "text-gray-500" : "text-amber-300/80"}`}
                    title={msg.plannerReason || undefined}
                  >
                    {PLANNER_LABEL[msg.plannerSource]}
                    {msg.plannerReason && msg.plannerSource !== "llm" ? ` · ${msg.plannerReason}` : ""}
                  </div>
                )}

                {!isUser && msg.autoApplied && (
                  <div className="mt-1.5 text-[10px] text-emerald-300/90">Applied automatically (project autonomy: AUTO). Undo reverts it.</div>
                )}

                {!isUser && msg.violations && msg.violations.length > 0 && (
                  <div role="alert" className="mt-2 p-2 rounded-lg bg-amber-500/5 border border-amber-500/30 text-[10px] text-amber-200 space-y-0.5">
                    <p className="font-semibold">Kept your locks:</p>
                    <ul className="list-disc pl-4">
                      {msg.violations.slice(0, 6).map((v, i) => (
                        <li key={i}>{v}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {!isUser && msg.critique && (
                  <div className="mt-2">
                    <QualityIssuesList
                      heading={`Director review${msg.critique.repairRounds ? ` · ${msg.critique.repairRounds} repair round${msg.critique.repairRounds === 1 ? "" : "s"}` : ""}`}
                      score={msg.critique.score}
                      issues={msg.critique.issues}
                      onSeekMs={onSeekMs}
                    />
                  </div>
                )}

                {!isUser && msg.warnings && msg.warnings.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5 text-[10px] text-gray-500 list-disc pl-4">
                    {msg.warnings.slice(0, 4).map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                )}

                {!isUser && msg.retryPrompt && !isProcessing && (
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <button
                      onClick={() => onApplyPrompt(msg.retryPrompt!)}
                      className="min-h-[44px] px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition"
                    >
                      Retry
                    </button>
                    <button
                      onClick={() => onApplyPrompt(msg.retryPrompt!, { offline: true })}
                      className="min-h-[44px] px-3 rounded-lg bg-[#202434] hover:bg-[#282D42] text-gray-300 text-xs transition"
                      title="Keyword rules that run on this device. Less capable than the AI Director."
                    >
                      Use offline rules
                    </button>
                  </div>
                )}

                {/* Structured Confirmation Card */}
                {msg.pendingConfirmation && onConfirmAutonomousEdit && (
                  <div className="mt-3 p-3 rounded-xl bg-[#161926] border border-indigo-500/40 text-xs space-y-2.5 shadow-md">
                    <div className="flex items-center space-x-1.5 text-indigo-300 font-semibold text-[11px]">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 text-indigo-400" />
                      <span>Review Proposed Direction</span>
                    </div>

                    <div className="space-y-1.5 text-[11px] text-gray-300">
                      {msg.pendingConfirmation.whatFound && (
                      <div>
                        <span className="font-semibold text-gray-400 block text-[10px] uppercase">
                          Findings:
                        </span>
                        <p className="text-gray-300">{msg.pendingConfirmation.whatFound}</p>
                      </div>
                      )}

                      <div>
                        <span className="font-semibold text-gray-400 block text-[10px] uppercase">
                          Proposed Changes:
                        </span>
                        <div className="whitespace-pre-line text-indigo-200 bg-black/25 p-2 rounded-lg font-mono text-[10px] border border-white/5">
                          {msg.pendingConfirmation.whatWillChange}
                        </div>
                      </div>

                      {msg.pendingConfirmation.assumptions && (
                      <div>
                        <span className="font-semibold text-gray-400 block text-[10px] uppercase">
                          Creative Rationale:
                        </span>
                        <p className="text-gray-400 italic text-[10px]">
                          {msg.pendingConfirmation.assumptions}
                        </p>
                      </div>
                      )}
                    </div>

                    <div className="flex items-center space-x-2 pt-1 border-t border-white/5">
                      <button
                        onClick={() => onConfirmAutonomousEdit(msg)}
                        className="flex-1 py-1.5 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs flex items-center justify-center space-x-1.5 transition shadow-sm active:scale-95"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{msg.pendingConfirmation.suggestedPrompt ? "Apply" : "Apply Plan to Timeline"}</span>
                      </button>

                      {onCancelAutonomousEdit && (
                        <button
                          onClick={() => onCancelAutonomousEdit(msg)}
                          className="py-1.5 px-3 rounded-lg bg-[#202434] hover:bg-[#282D42] text-gray-300 text-xs transition"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Action Badges */}
                {msg.actions && msg.actions.length > 0 && (
                  <div className="mt-2.5 pt-2 border-t border-white/5 flex flex-wrap gap-1">
                    {msg.actions.map((act, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 rounded-md bg-indigo-950/50 border border-indigo-500/30 text-indigo-300 text-[10px] font-mono tracking-tight"
                      >
                        {act}
                      </span>
                    ))}
                  </div>
                )}

                {/* Revert Step Button */}
                {!isUser && msg.snapshotEditIR && onRevertToMessage && !msg.pendingConfirmation && (
                  <div className="mt-2.5 pt-1.5 flex justify-end">
                    <button
                      onClick={() => onRevertToMessage(msg)}
                      className="inline-flex items-center space-x-1 text-[10px] text-gray-500 hover:text-indigo-300 transition py-0.5 px-1.5 rounded hover:bg-white/5"
                      title="Revert timeline back to before this prompt"
                    >
                      <Undo2 className="w-3 h-3" />
                      <span>Revert this step</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Live Real-Time Multi-Step Progression Card */}
        {isProcessing && (
          <div className="flex flex-col items-start space-y-1.5 w-full">
            <div className="flex items-center space-x-1.5 px-1 text-[9px] text-gray-500">
              <Sparkles className="w-3 h-3 text-indigo-400 animate-spin" />
              <span className="font-semibold text-indigo-300">Director Agent</span>
              <span className="text-emerald-400 font-mono">Live Execution</span>
            </div>

            <div className="w-full rounded-2xl p-3.5 bg-gradient-to-br from-[#121524] to-[#0E101A] border border-indigo-500/40 rounded-tl-sm text-xs text-indigo-300 space-y-2.5 shadow-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                  <span className="font-semibold text-white text-xs tracking-wide">
                    {currentProgress?.stageName || "Directing Project Media..."}
                  </span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <span className="px-1.5 py-0.5 rounded bg-indigo-900/60 border border-indigo-400/30 text-[9px] font-mono text-cyan-300 uppercase">
                    {currentProgress?.phase || "EXECUTING"}
                  </span>
                  <span className="font-mono text-[10px] text-emerald-400 font-bold">
                    {currentProgress?.percent ?? 45}%
                  </span>
                </div>
              </div>

              {onCancelRun && (
                <button
                  type="button"
                  onClick={onCancelRun}
                  className="min-h-[44px] px-3 rounded-lg border border-[#38435C] text-[11px] text-slate-200 hover:bg-[#1C2230] transition"
                >
                  Cancel
                </button>
              )}

              {/* Live Status Detail String */}
              <p className="text-[11px] text-gray-300 leading-relaxed font-sans bg-black/30 p-2 rounded-lg border border-white/5">
                {currentProgress?.detail || "Analyzing speech dynamics, silence gaps, and camera keyframes..."}
              </p>

              {/* Glowing Dynamic Progress Meter */}
              <div className="w-full bg-[#181C2B] rounded-full h-1.5 overflow-hidden border border-white/5">
                <div
                  className="bg-gradient-to-r from-indigo-500 via-cyan-400 to-emerald-400 h-full rounded-full transition-all duration-300 ease-out shadow-[0_0_8px_rgba(56,189,248,0.5)]"
                  style={{ width: `${Math.max(5, currentProgress?.percent ?? 45)}%` }}
                />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>


      {lockCount > 0 && (
        <div className="px-3 py-1.5 border-t border-[#171922] bg-[#0B0D14] text-[10px] text-amber-300/90 shrink-0">
          {lockCount} timeline lock{lockCount === 1 ? "" : "s"} active: the director will not change locked tracks or ranges.
        </div>
      )}

      {/* Suggestion Chips */}
      <div className="px-3 py-2 border-t border-[#171922] bg-[#0B0D14] shrink-0">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
          {INSPIRATION_SUGGESTIONS.map((qp, idx) => {
            const QPIcon = qp.icon;
            return (
              <button
                key={idx}
                onClick={() => handleSuggestionClick(qp.prompt)}
                disabled={isProcessing}
                className="whitespace-nowrap flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-[#131622] hover:bg-indigo-950/40 hover:border-indigo-500/40 border border-[#202536] text-[10px] text-gray-300 hover:text-white transition active:scale-95 disabled:opacity-40 shrink-0"
              >
                <QPIcon className="w-2.5 h-2.5 text-indigo-400 shrink-0" />
                <span>{qp.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Clean Conversational Input Bar */}
      <div className="p-3 border-t border-[#1A1C24] bg-[#0C0E16] shrink-0">
        <form onSubmit={handleSubmit} className="relative flex flex-col space-y-1">
          <div className="relative flex items-center">
            <textarea
              ref={textareaRef}
              rows={2}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Discuss ideas or direct your edit (e.g. 'How should we edit the opening?')..."
              disabled={isProcessing}
              className="w-full bg-[#131622] text-xs text-gray-100 placeholder-gray-500 pl-3 pr-10 py-2.5 rounded-xl border border-[#202538] focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/40 focus:outline-none transition resize-none disabled:opacity-40"
            />
            <button
              type="submit"
              disabled={!prompt.trim() || isProcessing}
              className="absolute right-2 bottom-2 p-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white disabled:opacity-25 transition shadow-sm flex items-center justify-center"
              title="Send message (Enter)"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-center justify-between text-[9px] text-gray-500 px-1">
            <span>Ask questions, discuss ideas, or propose cuts</span>
            <span className="font-mono text-gray-500">Enter ↵ to send</span>
          </div>
        </form>
      </div>
    </div>
  );
};
