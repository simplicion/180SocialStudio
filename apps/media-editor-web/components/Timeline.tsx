import React, { useRef, useState, useEffect } from "react";
import {
  Scissors,
  Trash2,
  ZoomIn,
  ZoomOut,
  Camera,
  Subtitles,
  Volume2,
  VolumeX,
  Film,
  Sparkles,
  Layers,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Magnet,
  Maximize2,
  Copy,
  Keyboard,
  Type,
  Music,
  Plus,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Rewind,
  FastForward,
  Repeat,
  ChevronDown,
  Activity,
  Zap,
} from "lucide-react";
import {
  EditIR,
  RationalTimeMath,
  VideoClip,
  CameraZoomKeyframe,
  CaptionSegment,
  Transition,
} from "@workspace/video-contracts";
import { VisibleWaveformCanvas } from "./VisibleWaveformCanvas";
import { TRANSITION_OPTIONS, effectInfo, isTitleSegment } from "../services/editor-library";

interface TimelineProps {
  editIR: EditIR;
  currentTimeSeconds: number;
  zoomLevel: number;
  selectedClipId: string | null;
  height?: number;
  isPlaying?: boolean;
  aspectRatio?: "16:9" | "9:16" | "1:1";
  onSelectClip: (id: string | null) => void;
  onSeek: (seconds: number) => void;
  onZoomChange: (newZoom: number) => void;
  onSplitClip: () => void;
  onDeleteSelectedClip: () => void;
  onUpdateClipTiming?: (clipId: string, newStartSec: number, newDurationSec: number) => void;
  onCommitHistory?: () => void;
  onDuplicateClip?: () => void;
  onAddTextOverlay?: () => void;
  onAddAudioTrack?: () => void;
  onOpenCaptions?: () => void;
  onOpenShortcuts?: () => void;
  onOpenScopes?: () => void;
  onOpenSilenceTrimmer?: () => void;
  onUpdateClipTransition?: (
    clipId: string,
    transitionIn?: Transition,
    transitionOut?: Transition
  ) => void;
  onTogglePlay?: () => void;
  onStepFrame?: (direction: -1 | 1) => void;
  onAspectRatioChange?: (aspect: "16:9" | "9:16" | "1:1") => void;
  onTakeSnapshot?: () => void;
  /** Controlled track locks (keys: "c1", "t1", "fx", "v_<id>", "a_<id>"). Locked = not editable by drag or by the AI. */
  lockedTracks?: Record<string, boolean>;
  onToggleTrackLock?: (key: string) => void;
  /** Timeline ranges (ms) the AI Director must keep. */
  lockedRangesMs?: Array<[number, number]>;
  /** Locks the selected item's time range (disabled when nothing is selected). */
  onLockRange?: () => void;
  onUnlockRange?: (index: number) => void;
}

export const Timeline: React.FC<TimelineProps> = ({
  editIR,
  currentTimeSeconds,
  zoomLevel,
  selectedClipId,
  height,
  isPlaying = false,
  aspectRatio = "16:9",
  onSelectClip,
  onSeek,
  onZoomChange,
  onSplitClip,
  onDeleteSelectedClip,
  onUpdateClipTiming,
  onCommitHistory,
  onDuplicateClip,
  onAddTextOverlay,
  onAddAudioTrack,
  onOpenCaptions,
  onOpenShortcuts,
  onOpenScopes,
  onOpenSilenceTrimmer,
  onUpdateClipTransition,
  onTogglePlay,
  onStepFrame,
  onAspectRatioChange,
  onTakeSnapshot,
  lockedTracks: controlledLocks,
  onToggleTrackLock,
  lockedRangesMs = [],
  onLockRange,
  onUnlockRange,
}) => {
  const timelineRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);

  const [isScrubbing, setIsScrubbing] = useState(false);
  const [isSnappingEnabled, setIsSnappingEnabled] = useState(true);
  const [isLooping, setIsLooping] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);

  // Track control states
  const [mutedTracks, setMutedTracks] = useState<Record<string, boolean>>({});
  const [localLocks, setLocalLocks] = useState<Record<string, boolean>>({});
  const lockedTracks = controlledLocks ?? localLocks;
  const [hiddenTracks, setHiddenTracks] = useState<Record<string, boolean>>({});

  // Clip drag & trim state
  const [draggingClip, setDraggingClip] = useState<{
    id: string;
    mode: "move" | "trim-start" | "trim-end";
    startX: number;
    initialStart: number;
    initialDuration: number;
  } | null>(null);

  const [containerWidth, setContainerWidth] = useState(1200);
  const [activeCutTransition, setActiveCutTransition] = useState<{
    clipId: string;
    nextClipId?: string;
    cutPointSec: number;
    currentType?: string;
    durationSec: number;
  } | null>(null);

  useEffect(() => {
    if (!timelineRef.current) return;
    const updateSize = () => {
      if (timelineRef.current) {
        setContainerWidth(timelineRef.current.clientWidth);
      }
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(timelineRef.current);
    return () => observer.disconnect();
  }, []);

  const totalDurationSec = Math.max(1, RationalTimeMath.toSeconds(editIR.meta.totalDuration));
  const headerWidthPx = 180;
  const availableTrackWidth = Math.max(400, containerWidth - headerWidthPx - 40);

  // Base Pixels-Per-Second: fits the entire project duration across the available track area!
  // E.g., for a 5-second video in 1000px width: fitPps = 1000 / 5 = 200 px/sec.
  // Then at zoomLevel = 1.0 (Fit), the 5s video spans the FULL WIDTH of the timeline!
  const fitPps = Math.max(30, availableTrackWidth / totalDurationSec);
  const pixelsPerSecond = fitPps * zoomLevel;
  const timelineWidthPx = Math.max(availableTrackWidth, totalDurationSec * pixelsPerSecond + 120);

  // Convert client X to timeline seconds
  const clientXToSeconds = (clientX: number) => {
    if (!timelineRef.current) return 0;
    const rect = timelineRef.current.getBoundingClientRect();
    const scrollLeft = timelineRef.current.scrollLeft;
    const clickX = clientX - rect.left + scrollLeft - headerWidthPx;
    const rawSec = Math.max(0, Math.min(totalDurationSec, clickX / pixelsPerSecond));
    return rawSec;
  };

  // Ruler & Track lane scrub mouse handlers
  const handleRulerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsScrubbing(true);
    const sec = clientXToSeconds(e.clientX);
    onSeek(sec);
  };

  const handleTrackAreaMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(".timeline-clip")) return;
    setIsScrubbing(true);
    const sec = clientXToSeconds(e.clientX);
    onSeek(sec);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isScrubbing) {
        const sec = clientXToSeconds(e.clientX);
        onSeek(sec);
      } else if (draggingClip && onUpdateClipTiming) {
        const deltaPx = e.clientX - draggingClip.startX;
        const deltaSec = deltaPx / pixelsPerSecond;

        if (draggingClip.mode === "move") {
          let newStart = Math.max(0, draggingClip.initialStart + deltaSec);
          if (isSnappingEnabled && Math.abs(newStart - currentTimeSeconds) < 0.15) {
            newStart = currentTimeSeconds;
          }
          onUpdateClipTiming(draggingClip.id, newStart, draggingClip.initialDuration);
        } else if (draggingClip.mode === "trim-start") {
          const newStart = Math.max(0, Math.min(draggingClip.initialStart + draggingClip.initialDuration - 0.2, draggingClip.initialStart + deltaSec));
          const newDur = Math.max(0.2, draggingClip.initialDuration - (newStart - draggingClip.initialStart));
          onUpdateClipTiming(draggingClip.id, newStart, newDur);
        } else if (draggingClip.mode === "trim-end") {
          const newDur = Math.max(0.2, draggingClip.initialDuration + deltaSec);
          onUpdateClipTiming(draggingClip.id, draggingClip.initialStart, newDur);
        }
      }
    };

    const handleMouseUp = () => {
      if (isScrubbing) setIsScrubbing(false);
      if (draggingClip) {
        setDraggingClip(null);
        onCommitHistory?.();
      }
    };

    if (isScrubbing || draggingClip) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isScrubbing, draggingClip, isSnappingEnabled, currentTimeSeconds, pixelsPerSecond, onSeek, onUpdateClipTiming, onCommitHistory]);

  const fps = 30;
  const curH = Math.floor(currentTimeSeconds / 3600);
  const curM = Math.floor((currentTimeSeconds % 3600) / 60);
  const curS = Math.floor(currentTimeSeconds % 60);
  const curFrames = Math.floor((currentTimeSeconds % 1) * fps);
  const currentFrame = Math.floor(currentTimeSeconds * fps);
  const currentTimecodeFormatted = `${String(curH).padStart(2, "0")}:${String(curM).padStart(2, "0")}:${String(curS).padStart(2, "0")}:${String(curFrames).padStart(2, "0")}`;

  const totH = Math.floor(totalDurationSec / 3600);
  const totM = Math.floor((totalDurationSec % 3600) / 60);
  const totS = Math.floor(totalDurationSec % 60);
  const totalFramesInSec = Math.floor((totalDurationSec % 1) * fps);
  const totalFrames = Math.floor(totalDurationSec * fps);
  const totalTimecodeFormatted = `${String(totH).padStart(2, "0")}:${String(totM).padStart(2, "0")}:${String(totS).padStart(2, "0")}:${String(totalFramesInSec).padStart(2, "0")}`;

  // Generate ruler tick marks spanning the entire scrollable timeline width
  const maxSec = Math.max(totalDurationSec, timelineWidthPx / pixelsPerSecond);
  const ticks: number[] = [];
  const step = pixelsPerSecond >= 140 ? 1 : pixelsPerSecond >= 55 ? 2 : 5;
  for (let s = 0; s <= Math.ceil(maxSec) + 1; s += step) {
    ticks.push(s);
  }

  const videoTrack = editIR.tracks.videoTracks[0];
  const cameraTrack = editIR.tracks.cameraTrack;
  const captionTrack = editIR.tracks.captionTrack;
  const effectTrack = editIR.tracks.effectTrack ?? [];

  const toggleTrackMute = (trackId: string) => {
    setMutedTracks((prev) => ({ ...prev, [trackId]: !prev[trackId] }));
  };

  const toggleTrackLock = (trackId: string) => {
    if (onToggleTrackLock) onToggleTrackLock(trackId);
    else setLocalLocks((prev) => ({ ...prev, [trackId]: !prev[trackId] }));
  };

  const toggleTrackHide = (trackId: string) => {
    setHiddenTracks((prev) => ({ ...prev, [trackId]: !prev[trackId] }));
  };

  // Format timecode MM:SS.FF
  const formatTimecode = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const f = Math.floor((sec % 1) * 30);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(f).padStart(2, "0")}`;
  };

  return (
    <div
      style={{ height: height ? `${height}px` : undefined }}
      className="h-full border-t border-[#1F1F24] bg-[#0B0B0C] flex flex-col select-none relative z-20 shrink-0"
    >
      {/* 1. Attached Playback Transport Controls Deck (Directly Docked to Timeline) */}
      <div className="h-10 border-b border-[#1A1A20] bg-[#0B0C10] px-3 flex items-center justify-between">
        {/* Left: SMPTE Timecode & Playback Speed */}
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1.5 font-mono text-xs select-none">
            <span className="text-sky-400 font-bold tracking-wider">{currentTimecodeFormatted}</span>
            <span className="text-sky-500/80 font-medium">[{currentFrame}]</span>
          </div>

          {/* Speed Selector */}
          <div className="relative flex items-center">
            <select
              value={playbackSpeed}
              onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
              className="bg-[#18191F] hover:bg-[#22242C] text-zinc-300 border border-[#2A2D36] rounded px-2 py-0.5 text-xs font-mono font-medium outline-none cursor-pointer appearance-none pr-5 transition"
              title="Playback Speed"
            >
              <option value={0.25}>x0.25</option>
              <option value={0.5}>x0.5</option>
              <option value={0.75}>x0.75</option>
              <option value={1}>x1</option>
              <option value={1.25}>x1.25</option>
              <option value={1.5}>x1.5</option>
              <option value={2}>x2</option>
            </select>
            <ChevronDown className="w-3 h-3 text-zinc-400 absolute right-1.5 pointer-events-none" />
          </div>

          <button
            onClick={() => setIsMuted(!isMuted)}
            className={`p-1 rounded text-zinc-400 hover:text-white transition ${isMuted ? "text-rose-400" : ""}`}
            title={isMuted ? "Unmute Audio (M)" : "Mute Audio (M)"}
          >
            {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
          </button>
        </div>

        {/* Center: Playback Transport Buttons */}
        <div className="flex items-center space-x-2">
          {/* Jump to Start */}
          <button
            onClick={() => onSeek(0)}
            className="p-1 text-zinc-400 hover:text-white transition"
            title="Jump to Start (Home)"
          >
            <SkipBack className="w-4 h-4 fill-current" />
          </button>

          {/* Step Backward / Rewind */}
          <button
            onClick={() => {
              if (onStepFrame) onStepFrame(-1);
              else onSeek(Math.max(0, currentTimeSeconds - 1 / fps));
            }}
            className="p-1 text-zinc-400 hover:text-white transition"
            title="Previous Frame (Left Arrow)"
          >
            <Rewind className="w-4 h-4 fill-current" />
          </button>

          {/* Play / Pause Primary Button */}
          {onTogglePlay && (
            <button
              onClick={onTogglePlay}
              className="p-1 text-zinc-100 hover:text-white hover:scale-110 active:scale-95 transition"
              title="Play / Pause (Space)"
            >
              {isPlaying ? (
                <Pause className="w-4 h-4 fill-current" />
              ) : (
                <Play className="w-4 h-4 fill-current ml-0.5" />
              )}
            </button>
          )}

          {/* Step Forward / Fast Forward */}
          <button
            onClick={() => {
              if (onStepFrame) onStepFrame(1);
              else onSeek(Math.min(totalDurationSec, currentTimeSeconds + 1 / fps));
            }}
            className="p-1 text-zinc-400 hover:text-white transition"
            title="Next Frame (Right Arrow)"
          >
            <FastForward className="w-4 h-4 fill-current" />
          </button>

          {/* Jump to End */}
          <button
            onClick={() => onSeek(totalDurationSec)}
            className="p-1 text-zinc-400 hover:text-white transition"
            title="Jump to End (End)"
          >
            <SkipForward className="w-4 h-4 fill-current" />
          </button>

          {/* Loop Toggle */}
          <button
            onClick={() => setIsLooping(!isLooping)}
            className={`p-1 transition ${isLooping ? "text-sky-400" : "text-zinc-500 hover:text-zinc-300"}`}
            title={isLooping ? "Loop Enabled" : "Loop Disabled"}
          >
            <Repeat className="w-4 h-4" />
          </button>

          {/* Status Badge */}
          <div className="bg-[#1C1E26] border border-[#2E323E] px-2 py-0.5 rounded text-[10px] font-mono font-bold text-zinc-300 tracking-wider select-none">
            {isPlaying ? "PLAYING" : "PAUSED"}
          </div>

          {/* Snapshot Camera */}
          {onTakeSnapshot && (
            <button
              onClick={onTakeSnapshot}
              className="p-1 text-zinc-400 hover:text-white hover:scale-105 active:scale-95 transition"
              title="Capture Frame Snapshot (PNG)"
            >
              <Camera className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Right: Aspect Ratio & Duration */}
        <div className="flex items-center space-x-3">
          {onAspectRatioChange && (
            <div className="flex items-center space-x-0.5 bg-[#14151B] border border-[#242630] p-0.5 rounded-lg">
              <button
                onClick={() => onAspectRatioChange("16:9")}
                className={`px-2 py-0.5 rounded text-[11px] font-semibold transition ${
                  aspectRatio === "16:9"
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
                title="Landscape (16:9)"
              >
                16:9
              </button>
              <button
                onClick={() => onAspectRatioChange("9:16")}
                className={`px-2 py-0.5 rounded text-[11px] font-semibold transition ${
                  aspectRatio === "9:16"
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
                title="Vertical Shorts / Reels (9:16)"
              >
                9:16
              </button>
              <button
                onClick={() => onAspectRatioChange("1:1")}
                className={`px-2 py-0.5 rounded text-[11px] font-semibold transition ${
                  aspectRatio === "1:1"
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
                title="Square (1:1)"
              >
                1:1
              </button>
            </div>
          )}

          <div className="flex items-center space-x-1.5 font-mono text-xs text-zinc-400 select-none">
            <span className="text-zinc-500 font-medium">[{totalFrames}]</span>
            <span className="tracking-wider">{totalTimecodeFormatted}</span>
          </div>
        </div>
      </div>

      {/* 2. Timeline Editing Toolbar */}
      <div className="h-9 border-b border-[#1F1F24] bg-[#0E0E12] flex items-center justify-between px-3">
        {/* Left: Editing Tools */}
        <div className="flex items-center space-x-1.5">
          <button
            onClick={onSplitClip}
            className="flex items-center space-x-1 px-2.5 py-1 rounded-md bg-[#141417] hover:bg-[#1F1F24] active:scale-95 text-xs font-semibold text-gray-200 border border-[#26262D] transition shadow-sm"
            title="Split Clip at Playhead (S)"
          >
            <Scissors className="w-3.5 h-3.5 text-zinc-300" />
            <span>Split</span>
            <span className="text-[10px] text-gray-500 font-mono">S</span>
          </button>

          <button
            onClick={onDeleteSelectedClip}
            disabled={!selectedClipId}
            className="flex items-center space-x-1 px-2.5 py-1 rounded-md bg-[#141417] hover:bg-red-500/15 active:scale-95 text-xs font-semibold text-gray-200 hover:text-red-300 border border-[#26262D] disabled:opacity-25 disabled:pointer-events-none transition shadow-sm"
            title="Ripple Delete Clip (Del)"
          >
            <Trash2 className="w-3.5 h-3.5 text-red-400" />
            <span>Delete</span>
            <span className="text-[10px] text-gray-500 font-mono">Del</span>
          </button>

          {onDuplicateClip && (
            <button
              onClick={onDuplicateClip}
              disabled={!selectedClipId}
              className="flex items-center space-x-1 px-2 py-1 rounded-md bg-[#141417] hover:bg-[#1F1F24] text-xs font-medium text-gray-300 border border-[#26262D] disabled:opacity-25 disabled:pointer-events-none transition"
              title="Duplicate Clip (Ctrl+D)"
            >
              <Copy className="w-3 h-3 text-zinc-300" />
              <span>Duplicate</span>
            </button>
          )}

          <div className="h-4 w-px bg-[#1F1F24] mx-1" />

          {/* Add Text / Title Overlay Button */}
          {onAddTextOverlay && (
            <button
              onClick={onAddTextOverlay}
              className="flex items-center space-x-1 px-2 py-1 rounded-md bg-[#141417] hover:bg-[#1C1C26] active:scale-95 text-xs font-medium text-cyan-300 hover:text-cyan-200 border border-cyan-500/30 transition shadow-sm"
              title="Add Custom Title / Text Overlay"
            >
              <Type className="w-3 h-3 text-cyan-400" />
              <span>+ Text</span>
            </button>
          )}

          {/* Add Music / Audio Track Button */}
          {onAddAudioTrack && (
            <button
              onClick={onAddAudioTrack}
              className="flex items-center space-x-1 px-2 py-1 rounded-md bg-[#141417] hover:bg-[#161F1A] active:scale-95 text-xs font-medium text-emerald-300 hover:text-emerald-200 border border-emerald-500/30 transition shadow-sm"
              title="Add BGM / Audio Track"
            >
              <Music className="w-3 h-3 text-emerald-400" />
              <span>+ Audio</span>
            </button>
          )}

          {/* Subtitles & Typography Studio Button */}
          {onOpenCaptions && (
            <button
              onClick={onOpenCaptions}
              className="flex items-center space-x-1 px-2 py-1 rounded-md bg-[#141417] hover:bg-[#121E24] active:scale-95 text-xs font-medium text-cyan-300 hover:text-cyan-200 border border-cyan-500/30 transition shadow-sm"
              title="Open Subtitle & Typography Studio (Google Fonts, Strokes, Glows)"
            >
              <Subtitles className="w-3 h-3 text-cyan-400" />
              <span>Captions</span>
            </button>
          )}

          <div className="h-4 w-px bg-[#1F1F24] mx-1" />

          {/* Snapping Magnet Toggle */}
          <button
            onClick={() => setIsSnappingEnabled(!isSnappingEnabled)}
            className={`flex items-center space-x-1 px-2 py-1 rounded-md text-xs font-medium border transition ${
              isSnappingEnabled
                ? "bg-[#181822] text-white border-zinc-500"
                : "bg-[#141417] text-gray-500 border-[#26262D] hover:text-gray-300"
            }`}
            title={isSnappingEnabled ? "Snapping Enabled (N)" : "Snapping Disabled"}
          >
            <Magnet className="w-3.5 h-3.5" />
            <span>Snap</span>
          </button>

          <div className="h-4 w-px bg-[#1F1F24] mx-1" />

          {onLockRange && (
            <button
              onClick={onLockRange}
              disabled={!selectedClipId}
              className="flex items-center space-x-1 px-2 py-1 rounded-md bg-[#141822] hover:bg-[#1C2230] disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium text-amber-300 border border-amber-500/30 transition ml-1"
              title={selectedClipId ? "Lock the selected item's time range: the AI Director will keep it" : "Select a clip to lock its time range"}
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Lock range</span>
            </button>
          )}

          {onOpenSilenceTrimmer && (
            <button
              onClick={onOpenSilenceTrimmer}
              className="flex items-center space-x-1 px-2 py-1 rounded-md bg-[#1C1316] hover:bg-[#28181D] text-xs font-medium text-rose-300 border border-rose-500/30 transition shadow-sm ml-1"
              title="Silence & Dead-Air Auto-Trimmer"
            >
              <Scissors className="w-3.5 h-3.5 text-rose-400" />
              <span>Silence Trimmer</span>
            </button>
          )}

          {onOpenScopes && (
            <button
              onClick={onOpenScopes}
              className="flex items-center space-x-1 px-2 py-1 rounded-md bg-[#111A16] hover:bg-[#16251E] text-xs font-medium text-emerald-300 border border-emerald-500/30 transition shadow-sm ml-1"
              title="Color Scopes Monitor (RGB Parade, Vectorscope)"
            >
              <Activity className="w-3.5 h-3.5 text-emerald-400" />
              <span>Scopes</span>
            </button>
          )}

          {onOpenShortcuts && (
            <button
              onClick={onOpenShortcuts}
              className="flex items-center space-x-1 px-2 py-1 rounded-md bg-[#141417] hover:bg-[#1F1F24] text-xs font-medium text-gray-300 border border-[#26262D] transition shadow-sm ml-1"
              title="Keyboard Shortcuts (?)"
            >
              <Keyboard className="w-3.5 h-3.5 text-zinc-300" />
              <span>Hotkeys</span>
            </button>
          )}
        </div>

        {/* Right: Zoom Controls */}
        <div className="flex items-center space-x-1.5">
          <button
            onClick={() => onZoomChange(Math.max(0.5, zoomLevel - 0.25))}
            className="p-1 rounded-md bg-[#141417] hover:bg-[#1F1F24] text-gray-400 hover:text-gray-200 border border-[#26262D] transition"
            title="Zoom Out (-)"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <input
            type="range"
            min="0.5"
            max="3"
            step="0.1"
            value={zoomLevel}
            onChange={(e) => onZoomChange(parseFloat(e.target.value))}
            className="w-20 h-1.5 bg-[#16161A] rounded appearance-none cursor-pointer accent-indigo-500"
            title={`Zoom: ${Math.round(zoomLevel * 100)}%`}
          />
          <button
            onClick={() => onZoomChange(Math.min(3, zoomLevel + 0.25))}
            className="p-1 rounded-md text-gray-400 hover:text-white hover:bg-[#1F1F24] transition"
            title="Zoom In (+)"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onZoomChange(1.0)}
            className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium text-gray-400 hover:text-white hover:bg-[#1F1F24] border border-[#26262D] transition"
            title="Reset Zoom to Fit Timeline (100%)"
          >
            Fit
          </button>
        </div>
      </div>

      {/* Main Multi-Track Scrollable Timeline Canvas */}
      <div
        ref={timelineRef}
        className="flex-1 overflow-x-auto overflow-y-auto relative bg-[#050505] flex"
      >
        {/* Left Track Headers (Fixed on Scroll) */}
        <div
          className="shrink-0 bg-surface/95 border-r border-surface-border sticky left-0 z-20 flex flex-col shadow-xl"
          style={{ width: `${headerWidthPx}px` }}
        >
          {/* Ruler Corner Header */}
          <div className="h-8 border-b border-surface-border bg-surface-subtle/90 px-3 flex items-center justify-between text-[10px] text-gray-400 font-mono">
            <span className="font-bold tracking-wider text-gray-300">TRACKS</span>
            <span className="text-[9px] text-gray-500">30 FPS</span>
          </div>

          {/* 1. Camera Zoom Track Header */}
          <div className="h-12 border-b border-surface-border px-3 flex items-center justify-between text-xs font-semibold text-amber-400 bg-surface/60">
            <div className="flex items-center space-x-1.5 truncate">
              <Camera className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="truncate">Camera (C1)</span>
            </div>
            <div className="flex items-center space-x-1 text-gray-400">
              <button
                onClick={() => toggleTrackLock("c1")}
                className="p-1 hover:text-white transition"
              >
                {lockedTracks["c1"] ? <Lock className="w-3 h-3 text-amber-400" /> : <Unlock className="w-3 h-3" />}
              </button>
            </div>
          </div>

          {/* 2. Captions Track Header */}
          <div className="h-12 border-b border-surface-border px-3 flex items-center justify-between text-xs font-semibold text-cyan-400 bg-surface/60">
            <div className="flex items-center space-x-1.5 truncate">
              <Subtitles className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span className="truncate">Captions (T1)</span>
            </div>
            <div className="flex items-center space-x-1 text-gray-400">
              <button
                onClick={() => toggleTrackLock("t1")}
                className="p-1 hover:text-white transition"
                title={lockedTracks["t1"] ? "Unlock captions and titles" : "Lock captions and titles"}
              >
                {lockedTracks["t1"] ? <Lock className="w-3 h-3 text-cyan-300" /> : <Unlock className="w-3 h-3" />}
              </button>
              <button
                onClick={() => toggleTrackHide("t1")}
                className="p-1 hover:text-white transition"
              >
                {hiddenTracks["t1"] ? <EyeOff className="w-3 h-3 text-rose-400" /> : <Eye className="w-3 h-3" />}
              </button>
            </div>
          </div>

          {/* 2b. Effects Track Header */}
          <div className="h-12 border-b border-surface-border px-3 flex items-center justify-between text-xs font-semibold text-violet-300 bg-surface/60">
            <div className="flex items-center space-x-1.5 truncate">
              <Zap className="w-3.5 h-3.5 text-violet-300 shrink-0" />
              <span className="truncate">Effects (FX)</span>
            </div>
            <div className="flex items-center space-x-1 text-gray-400">
              <button
                onClick={() => toggleTrackLock("fx")}
                className="p-1 hover:text-white transition"
                title={lockedTracks["fx"] ? "Unlock effects" : "Lock effects"}
              >
                {lockedTracks["fx"] ? <Lock className="w-3 h-3 text-violet-300" /> : <Unlock className="w-3 h-3" />}
              </button>
            </div>
          </div>

          {/* 3. Dynamic Video & Overlay Track Headers */}
          {editIR.tracks.videoTracks.map((vTrack, vIdx) => {
            const trackKey = `v_${vTrack.id || vIdx}`;
            const isMain = vTrack.type === "MAIN_VIDEO" || vIdx === 0;
            const trackLabel = isMain
              ? "Video (V1)"
              : vTrack.type === "B_ROLL_OVERLAY"
              ? `B-Roll (V${vIdx + 1})`
              : vTrack.type === "STICKER_OVERLAY"
              ? `Sticker (V${vIdx + 1})`
              : `Overlay (V${vIdx + 1})`;

            return (
              <div
                key={vTrack.id || vIdx}
                className={`h-16 border-b border-surface-border px-3 flex items-center justify-between text-xs font-semibold ${
                  isMain ? "text-zinc-300 bg-[#0A0A0D]" : "text-indigo-300 bg-[#0C0C12]"
                }`}
              >
                <div className="flex items-center space-x-1.5 truncate">
                  <Film className={`w-3.5 h-3.5 ${isMain ? "text-zinc-400" : "text-indigo-400"} shrink-0`} />
                  <span className="truncate">{trackLabel}</span>
                </div>
                <div className="flex items-center space-x-1 text-zinc-400">
                  <button
                    onClick={() => toggleTrackLock(trackKey)}
                    className="p-1 hover:text-white transition"
                    title={lockedTracks[trackKey] ? "Unlock track" : "Lock track"}
                  >
                    {lockedTracks[trackKey] ? <Lock className="w-3 h-3 text-amber-400" /> : <Unlock className="w-3 h-3" />}
                  </button>
                  <button
                    onClick={() => toggleTrackHide(trackKey)}
                    className="p-1 hover:text-white transition"
                    title={hiddenTracks[trackKey] ? "Show track" : "Hide track"}
                  >
                    {hiddenTracks[trackKey] ? <EyeOff className="w-3 h-3 text-rose-400" /> : <Eye className="w-3 h-3" />}
                  </button>
                </div>
              </div>
            );
          })}

          {/* 4. Dynamic Audio Track Headers */}
          {editIR.tracks.audioTracks && editIR.tracks.audioTracks.length > 0 ? (
            editIR.tracks.audioTracks.map((aTrack, aIdx) => {
              const trackKey = `a_${aTrack.id || aIdx}`;
              const isVoice = aTrack.type === "PRIMARY_VOICE" || aIdx === 0;
              const isBgm = aTrack.type === "BGM";
              const isSfx = aTrack.type === "SFX";
              const trackLabel = isBgm
                ? `Music (A${aIdx + 1})`
                : isSfx
                ? `SFX (A${aIdx + 1})`
                : isVoice
                ? `Voice (A${aIdx + 1})`
                : `Audio (A${aIdx + 1})`;

              const colorClass = isBgm
                ? "text-purple-400"
                : isSfx
                ? "text-amber-400"
                : "text-emerald-400";

              return (
                <div
                  key={aTrack.id || aIdx}
                  className="h-12 border-b border-surface-border px-3 flex items-center justify-between text-xs font-semibold bg-surface/60"
                >
                  <div className={`flex items-center space-x-1.5 truncate ${colorClass}`}>
                    {isBgm ? (
                      <Music className="w-3.5 h-3.5 shrink-0 text-purple-400" />
                    ) : isSfx ? (
                      <Zap className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                    ) : (
                      <Volume2 className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                    )}
                    <span className="truncate">{trackLabel}</span>
                  </div>
                  <div className="flex items-center space-x-1 text-gray-400">
                    {(isBgm || isSfx) && onAddAudioTrack && (
                      <button
                        onClick={onAddAudioTrack}
                        className={`p-1 transition rounded ${
                          isBgm
                            ? "hover:text-purple-300 hover:bg-purple-950/40 text-purple-400/80"
                            : "hover:text-amber-300 hover:bg-amber-950/40 text-amber-400/80"
                        }`}
                        title={isBgm ? "Browse / Replace Background Music" : "Browse / Add Sound Effects"}
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    )}
                    <button
                      onClick={() => toggleTrackLock(trackKey)}
                      className="p-1 hover:text-white transition"
                      title={lockedTracks[trackKey] ? "Unlock track" : "Lock track"}
                    >
                      {lockedTracks[trackKey] ? <Lock className="w-3 h-3 text-amber-400" /> : <Unlock className="w-3 h-3" />}
                    </button>
                    <button
                      onClick={() => toggleTrackMute(trackKey)}
                      className="p-1 hover:text-white transition"
                      title={mutedTracks[trackKey] ? "Unmute track" : "Mute track"}
                    >
                      {mutedTracks[trackKey] ? <VolumeX className="w-3 h-3 text-rose-400" /> : <Volume2 className="w-3 h-3" />}
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="h-12 border-b border-surface-border px-3 flex items-center justify-between text-xs font-semibold text-emerald-400 bg-surface/60">
              <div className="flex items-center space-x-1.5 truncate">
                <Volume2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="truncate">Audio (A1)</span>
              </div>
              <div className="flex items-center space-x-1 text-gray-400">
                <button
                  onClick={() => toggleTrackMute("a1")}
                  className="p-1 hover:text-white transition"
                >
                  {mutedTracks["a1"] ? <VolumeX className="w-3 h-3 text-rose-400" /> : <Volume2 className="w-3 h-3" />}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right Scrollable Tracks Area */}
        <div
          onMouseDown={handleTrackAreaMouseDown}
          className="relative flex-1 h-full cursor-pointer"
          style={{ width: `${timelineWidthPx}px` }}
        >
          {/* Top Time Ruler */}
          <div
            ref={rulerRef}
            onMouseDown={handleRulerMouseDown}
            className="h-8 border-b border-surface-border bg-surface-subtle/90 cursor-ew-resize relative select-none"
          >
            {ticks.map((t) => (
              <div
                key={t}
                className="absolute top-0 bottom-0 border-l border-surface-border/60 flex items-center pl-1 text-[10px] text-gray-400 font-mono pointer-events-none"
                style={{ left: `${t * pixelsPerSecond}px` }}
              >
                {t}s
              </div>
            ))}
            {lockedRangesMs.map(([s0, e0], i) => (
              <div
                key={`lock-${i}`}
                className="absolute top-0 bottom-0 bg-amber-500/15 border-x border-amber-400/60 flex items-center justify-end"
                style={{ left: `${(s0 / 1000) * pixelsPerSecond}px`, width: `${Math.max(4, ((e0 - s0) / 1000) * pixelsPerSecond)}px` }}
                title={`Locked for the AI Director: ${(s0 / 1000).toFixed(1)}–${(e0 / 1000).toFixed(1)} s`}
              >
                {onUnlockRange && (
                  <button
                    type="button"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onUnlockRange(i);
                    }}
                    className="h-full px-1 text-amber-300 hover:text-white"
                    aria-label="Remove this locked range"
                  >
                    <Lock className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Red Playhead Line & Marker */}
          <div
            className="absolute top-0 bottom-0 z-30 pointer-events-none flex flex-col items-center transition-all duration-75 ease-out"
            style={{ left: `${currentTimeSeconds * pixelsPerSecond}px` }}
          >
            {/* Playhead Marker */}
            <div className="w-3.5 h-3.5 bg-red-500 transform rotate-45 -mt-1 shadow-lg shadow-red-500/80 rounded-sm" />
            {/* Playhead Line */}
            <div className="w-0.5 flex-1 bg-red-500 shadow-md shadow-red-500/60" />
          </div>

          {/* 1. Camera Track Lane */}
          <div className="h-12 border-b border-surface-border/40 relative bg-[#09090B]/80 flex items-center">
            {cameraTrack.length > 0 ? (
              cameraTrack.map((cam) => {
                const startSec = RationalTimeMath.toSeconds(cam.timeRange.start);
                const durationSec = RationalTimeMath.toSeconds(cam.timeRange.duration);
                const widthPx = Math.max(48, durationSec * pixelsPerSecond);

                return (
                  <div
                    key={cam.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSeek(startSec);
                    }}
                    className="timeline-clip absolute top-1.5 bottom-1.5 rounded-lg bg-amber-500/15 border border-amber-500/40 hover:border-amber-400 hover:bg-amber-500/25 px-2 flex items-center space-x-1.5 text-amber-300 text-[10px] font-mono shadow-sm cursor-pointer min-w-[48px] overflow-hidden transition"
                    style={{
                      left: `${startSec * pixelsPerSecond}px`,
                      width: `${widthPx}px`,
                    }}
                    title={`Click to seek to Auto-Zoom ${cam.scale}x (${startSec.toFixed(1)}s)`}
                  >
                    <Camera className="w-3 h-3 text-amber-400 shrink-0" />
                    <span className="truncate font-bold whitespace-nowrap">Auto-Zoom {cam.scale}x</span>
                  </div>
                );
              })
            ) : (
              <div className="text-[10px] text-zinc-600 font-mono italic px-4 select-none pointer-events-none">
                No camera keyframes on C1
              </div>
            )}
          </div>

          {/* 2. Captions Track Lane */}
          <div className="h-12 border-b border-surface-border/40 relative bg-[#09090B]/80">
            {captionTrack.map((cap) => {
              const startSec = RationalTimeMath.toSeconds(cap.timeRange.start);
              const durationSec = RationalTimeMath.toSeconds(cap.timeRange.duration);
              return (
                <div
                  key={cap.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isTitleSegment(cap)) onSelectClip(cap.id);
                    else onOpenCaptions?.();
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    onOpenCaptions?.();
                  }}
                  onMouseDown={(e) => {
                    // Titles (text templates / AI addText) move like clips; speech captions stay synced to the words.
                    if (!isTitleSegment(cap)) return;
                    e.stopPropagation();
                    onSelectClip(cap.id);
                    if (lockedTracks["t1"]) return;
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    const mode = e.clientX > rect.right - 8 ? "trim-end" : e.clientX < rect.left + 8 ? "trim-start" : "move";
                    setDraggingClip({ id: cap.id, mode, startX: e.clientX, initialStart: startSec, initialDuration: durationSec });
                  }}
                  className={`timeline-clip absolute top-1.5 bottom-1.5 rounded-lg bg-cyan-500/15 border ${
                    selectedClipId === cap.id ? "border-cyan-200 ring-1 ring-white/20" : "border-cyan-500/40"
                  } hover:border-cyan-300 hover:bg-cyan-500/25 px-2.5 flex items-center space-x-1.5 text-cyan-300 text-[10px] font-semibold truncate shadow-sm ${
                    isTitleSegment(cap) ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
                  } transition`}
                  style={{
                    left: `${startSec * pixelsPerSecond}px`,
                    width: `${durationSec * pixelsPerSecond}px`,
                  }}
                  title={`Click to edit caption in Studio: "${cap.text}" (${startSec.toFixed(1)}s)`}
                >
                  <Subtitles className="w-3 h-3 text-cyan-400 shrink-0" />
                  <span className="truncate">"{cap.text}"</span>
                </div>
              );
            })}
          </div>

          {/* 2b. Effects Track Lane: select, drag to move, drag the edges to trim, Delete to remove */}
          <div className="h-12 border-b border-surface-border/40 relative bg-[#09090B]/80 flex items-center">
            {effectTrack.length === 0 && (
              <div className="text-[10px] text-zinc-600 font-mono italic px-4 select-none pointer-events-none">
                No effects on FX — add one from the Effects tab
              </div>
            )}
            {effectTrack.map((fx) => {
              const startSec = RationalTimeMath.toSeconds(fx.timeRange.start);
              const durationSec = RationalTimeMath.toSeconds(fx.timeRange.duration);
              const isSelected = selectedClipId === fx.id;
              const locked = Boolean(lockedTracks["fx"]);
              const startDrag = (e: React.MouseEvent, mode: "move" | "trim-start" | "trim-end") => {
                e.stopPropagation();
                onSelectClip(fx.id);
                if (!locked) setDraggingClip({ id: fx.id, mode, startX: e.clientX, initialStart: startSec, initialDuration: durationSec });
              };
              return (
                <div
                  key={fx.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectClip(fx.id);
                  }}
                  onMouseDown={(e) => startDrag(e, "move")}
                  className={`timeline-clip group absolute top-1.5 bottom-1.5 rounded-lg border px-2 flex items-center space-x-1.5 text-[10px] font-semibold overflow-hidden transition cursor-grab active:cursor-grabbing ${
                    isSelected
                      ? "bg-violet-500/30 border-violet-300 ring-1 ring-white/20 text-white"
                      : "bg-violet-500/15 border-violet-500/40 hover:border-violet-300 text-violet-200"
                  }`}
                  style={{ left: `${startSec * pixelsPerSecond}px`, width: `${Math.max(14, durationSec * pixelsPerSecond)}px` }}
                  title={`${effectInfo(fx.type).name} · ${startSec.toFixed(2)}s–${(startSec + durationSec).toFixed(2)}s · intensity ${Math.round((fx.intensity ?? 0.6) * 100)}%`}
                >
                  <div
                    onMouseDown={(e) => startDrag(e, "trim-start")}
                    className="absolute left-0 top-0 bottom-0 w-2 group-hover:bg-white/20 hover:!bg-white cursor-ew-resize z-10"
                  />
                  <Zap className="w-3 h-3 shrink-0" />
                  <span className="truncate">{effectInfo(fx.type).name}</span>
                  <div
                    onMouseDown={(e) => startDrag(e, "trim-end")}
                    className="absolute right-0 top-0 bottom-0 w-2 group-hover:bg-white/20 hover:!bg-white cursor-ew-resize z-10"
                  />
                </div>
              );
            })}
          </div>

          {/* 3. Dynamic Video & Overlay Track Lanes */}
          {editIR.tracks.videoTracks.map((vTrack, vIdx) => {
            const trackKey = `v_${vTrack.id || vIdx}`;
            const isMain = vTrack.type === "MAIN_VIDEO" || vIdx === 0;

            return (
              <div
                key={vTrack.id || vIdx}
                className={`h-16 border-b border-surface-border/40 relative ${
                  isMain ? "bg-[#0D0D0F]" : "bg-[#0B0B11]"
                }`}
              >
                {vTrack.clips.map((clip, clipIdx) => {
                  const startSec = RationalTimeMath.toSeconds(clip.timelineRange.start);
                  const durationSec = RationalTimeMath.toSeconds(clip.timelineRange.duration);
                  const isSelected = selectedClipId === clip.id;

                  return (
                    <React.Fragment key={clip.id}>
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectClip(clip.id);
                        }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          onSelectClip(clip.id);
                          if (!lockedTracks[trackKey]) {
                            setDraggingClip({
                              id: clip.id,
                              mode: "move",
                              startX: e.clientX,
                              initialStart: startSec,
                              initialDuration: durationSec,
                            });
                          }
                        }}
                        className={`timeline-clip absolute top-1 bottom-1 rounded-xl bg-gradient-to-r ${
                          isMain
                            ? "from-[#141418] via-[#1A1A22] to-[#141418]"
                            : "from-[#161622] via-[#1E1E30] to-[#161622]"
                        } border ${
                          isSelected
                            ? "border-zinc-400 ring-1 ring-white/20 shadow-xl shadow-black/50"
                            : isMain
                            ? "border-[#262630] hover:border-zinc-500"
                            : "border-indigo-900/60 hover:border-indigo-500"
                        } p-2 flex flex-col justify-between cursor-grab active:cursor-grabbing transition-all group overflow-hidden`}
                        style={{
                          left: `${startSec * pixelsPerSecond}px`,
                          width: `${durationSec * pixelsPerSecond}px`,
                        }}
                      >
                        {/* Left Trim Handle */}
                        <div
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            onSelectClip(clip.id);
                            setDraggingClip({
                              id: clip.id,
                              mode: "trim-start",
                              startX: e.clientX,
                              initialStart: startSec,
                              initialDuration: durationSec,
                            });
                          }}
                          className="absolute left-0 top-0 bottom-0 w-2.5 bg-white/0 group-hover:bg-white/20 hover:!bg-white cursor-ew-resize transition-colors rounded-l-xl z-10"
                          title="Drag to trim start"
                        />

                        {/* Keyframe Diamonds Track Overlay */}
                        {clip.transform?.keyframes && clip.transform.keyframes.length > 0 && (
                          <div className="absolute inset-x-2 top-6 h-3 pointer-events-none z-10">
                            {clip.transform.keyframes.map((kf) => {
                              const kfPercent = Math.max(0, Math.min(100, (kf.timeOffsetSec / durationSec) * 100));
                              const isNearPlayhead = Math.abs(currentTimeSeconds - (startSec + kf.timeOffsetSec)) < 0.1;
                              return (
                                <button
                                  key={kf.id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onSeek(startSec + kf.timeOffsetSec);
                                  }}
                                  className={`absolute -translate-x-1/2 -translate-y-1/2 top-1.5 w-2.5 h-2.5 rotate-45 pointer-events-auto cursor-pointer transition-transform ${
                                    isNearPlayhead
                                      ? "bg-cyan-400 border border-white shadow-[0_0_8px_rgba(6,182,212,0.8)] scale-125 z-10"
                                      : "bg-amber-400 border border-black/80 hover:scale-125 shadow-sm"
                                  }`}
                                  style={{ left: `${kfPercent}%` }}
                                  title={`Keyframe (${kf.property}): ${kf.timeOffsetSec.toFixed(2)}s`}
                                />
                              );
                            })}
                          </div>
                        )}

                        {/* Header Row */}
                        <div className="flex items-center justify-between text-[11px] text-zinc-200 font-semibold px-1">
                          <span className="truncate flex items-center space-x-1.5">
                            <Film className={`w-3.5 h-3.5 ${isMain ? "text-zinc-400" : "text-indigo-400"} shrink-0`} />
                            <span className="truncate">{clip.sourcePath.split(/[\/\\]/).pop()}</span>
                          </span>
                          <span className="text-[10px] font-mono text-zinc-300 bg-black/60 px-1.5 py-0.5 rounded border border-white/5">
                            {durationSec.toFixed(1)}s
                          </span>
                        </div>

                        {/* Footer Row */}
                        <div className="flex items-center justify-between text-[9px] font-mono text-zinc-400 px-1">
                          <span>{isMain ? "Lossless Stream-Copy" : "Layer Overlay"}</span>
                          <span>{clip.speedMultiplier || 1.0}x</span>
                        </div>

                        {/* Right Trim Handle */}
                        <div
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            onSelectClip(clip.id);
                            setDraggingClip({
                              id: clip.id,
                              mode: "trim-end",
                              startX: e.clientX,
                              initialStart: startSec,
                              initialDuration: durationSec,
                            });
                          }}
                          className="absolute right-0 top-0 bottom-0 w-2.5 bg-white/0 group-hover:bg-white/20 hover:!bg-white cursor-ew-resize transition-colors rounded-r-xl z-10"
                          title="Drag to trim end"
                        />
                      </div>

                      {/* Cut-Point Transition Badge at Clip End */}
                      <div
                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-20 pointer-events-auto"
                        style={{ left: `${(startSec + durationSec) * pixelsPerSecond}px` }}
                      >
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const nextClip = vTrack.clips[clipIdx + 1];
                            setActiveCutTransition({
                              clipId: clip.id,
                              nextClipId: nextClip?.id,
                              cutPointSec: startSec + durationSec,
                              currentType: clip.transitionOut?.type || "CUT",
                              durationSec: clip.transitionOut?.duration
                                ? RationalTimeMath.toSeconds(clip.transitionOut.duration)
                                : 0.5,
                            });
                          }}
                          className={`p-1 rounded-md text-[10px] font-bold transition flex items-center space-x-1 shadow-md cursor-pointer ${
                            clip.transitionOut && clip.transitionOut.type !== "CUT"
                              ? "bg-amber-500/90 text-black border border-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.7)] scale-105"
                              : "bg-[#161622]/90 hover:bg-indigo-600 text-zinc-400 hover:text-white border border-[#2D2D3A] opacity-40 hover:opacity-100 hover:scale-110"
                          }`}
                          title={
                            clip.transitionOut && clip.transitionOut.type !== "CUT"
                              ? `Transition: ${clip.transitionOut.type} (${RationalTimeMath.toSeconds(clip.transitionOut.duration).toFixed(1)}s)`
                              : "Add Cut-Point Transition"
                          }
                        >
                          <Zap className="w-3 h-3 fill-current" />
                          {clip.transitionOut && clip.transitionOut.type !== "CUT" && (
                            <span className="text-[9px] uppercase tracking-wider font-extrabold pr-0.5">
                              {clip.transitionOut.type.replace("_", " ")}
                            </span>
                          )}
                        </button>
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>
            );
          })}

          {/* 4. Dynamic Audio Waveform Track Lanes */}
          {editIR.tracks.audioTracks && editIR.tracks.audioTracks.length > 0 ? (
            editIR.tracks.audioTracks.map((aTrack, aIdx) => {
              const isVoice = aTrack.type === "PRIMARY_VOICE" || aIdx === 0;
              const isBgm = aTrack.type === "BGM";
              const isSfx = aTrack.type === "SFX";
              const waveformColor = isBgm ? "purple" : isSfx ? "amber" : "emerald";
              const bgBadgeColor = isBgm
                ? "bg-purple-950/50 border-purple-500/40 text-purple-200"
                : isSfx
                ? "bg-amber-950/50 border-amber-500/40 text-amber-200"
                : "bg-emerald-950/50 border-emerald-500/40 text-emerald-200";

              return (
                <div
                  key={aTrack.id || aIdx}
                  className="h-12 border-b border-surface-border/40 relative bg-[#08080A] flex items-center"
                >
                  {aTrack.clips && aTrack.clips.length > 0 ? (
                    aTrack.clips.map((aClip) => {
                      const startSec = RationalTimeMath.toSeconds(aClip.timelineRange.start);
                      const durationSec = RationalTimeMath.toSeconds(aClip.timelineRange.duration);
                      const clipWidthPx = durationSec * pixelsPerSecond;
                      const isSelected = selectedClipId === aClip.id;

                      return (
                        <div
                          key={aClip.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectClip(aClip.id);
                          }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            onSelectClip(aClip.id);
                            setDraggingClip({
                              id: aClip.id,
                              mode: "move",
                              startX: e.clientX,
                              initialStart: startSec,
                              initialDuration: durationSec,
                            });
                          }}
                          className={`timeline-clip absolute top-1 bottom-1 rounded-lg ${bgBadgeColor} border px-1 flex items-center overflow-hidden group shadow-sm cursor-grab active:cursor-grabbing ${
                            isSelected ? "ring-1 ring-white/50 border-white" : ""
                          }`}
                          style={{
                            left: `${startSec * pixelsPerSecond}px`,
                            width: `${clipWidthPx}px`,
                          }}
                          title={`${isBgm ? "BGM" : isSfx ? "SFX" : "Audio"}: ${aClip.sourcePath.split(/[\/\\]/).pop() || "Audio"} (${durationSec.toFixed(1)}s)`}
                        >
                          {/* Left Trim Handle */}
                          <div
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              onSelectClip(aClip.id);
                              setDraggingClip({
                                id: aClip.id,
                                mode: "trim-start",
                                startX: e.clientX,
                                initialStart: startSec,
                                initialDuration: durationSec,
                              });
                            }}
                            className="absolute left-0 top-0 bottom-0 w-2 bg-white/0 group-hover:bg-white/20 hover:!bg-white cursor-ew-resize transition-colors rounded-l-lg z-10"
                            title="Trim start"
                          />

                          <VisibleWaveformCanvas
                            sourceUrl={aClip.sourcePath}
                            durationSec={durationSec}
                            width={clipWidthPx}
                            height={38}
                            color={waveformColor as any}
                          />

                          {/* Right Trim Handle */}
                          <div
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              onSelectClip(aClip.id);
                              setDraggingClip({
                                id: aClip.id,
                                mode: "trim-end",
                                startX: e.clientX,
                                initialStart: startSec,
                                initialDuration: durationSec,
                              });
                            }}
                            className="absolute right-0 top-0 bottom-0 w-2 bg-white/0 group-hover:bg-white/20 hover:!bg-white cursor-ew-resize transition-colors rounded-r-lg z-10"
                            title="Trim end"
                          />
                        </div>
                      );
                    })
                  ) : isVoice && videoTrack && videoTrack.clips.length > 0 ? (
                    videoTrack.clips.map((vClip) => {
                      const startSec = RationalTimeMath.toSeconds(vClip.timelineRange.start);
                      const durationSec = RationalTimeMath.toSeconds(vClip.timelineRange.duration);
                      const clipWidthPx = durationSec * pixelsPerSecond;

                      return (
                        <div
                          key={`v_audio_${vClip.id}`}
                          className="absolute top-1 bottom-1 rounded-lg bg-cyan-950/30 border border-cyan-500/30 px-1 flex items-center overflow-hidden shadow-inner"
                          style={{
                            left: `${startSec * pixelsPerSecond}px`,
                            width: `${clipWidthPx}px`,
                          }}
                          title={`Embedded Audio Track (${durationSec.toFixed(1)}s)`}
                        >
                          <VisibleWaveformCanvas
                            sourceUrl={vClip.sourcePath}
                            durationSec={durationSec}
                            width={clipWidthPx}
                            height={38}
                            color="cyan"
                          />
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-[10px] text-zinc-600 font-mono italic px-4 select-none pointer-events-none">
                      No audio clips on {isBgm ? "Music" : isSfx ? "SFX" : "Audio"} track
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div className="h-12 border-b border-surface-border/40 relative bg-[#08080A] flex items-center">
              <div className="text-[10px] text-zinc-600 font-mono italic px-4 select-none pointer-events-none">
                No audio tracks configured
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Floating Cut-Point Transition Picker Modal */}
      {activeCutTransition && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setActiveCutTransition(null)}
        >
          <div
            className="w-84 bg-[#121218] border border-[#262634] rounded-2xl shadow-2xl p-4 space-y-3 animate-in fade-in zoom-in duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-[#22222E]">
              <div className="flex items-center space-x-2 text-amber-400">
                <Zap className="w-4 h-4 fill-current" />
                <span className="text-xs font-bold text-zinc-100">Cut-Point Transition</span>
              </div>
              <button
                onClick={() => setActiveCutTransition(null)}
                className="text-zinc-500 hover:text-white text-xs p-1 rounded hover:bg-[#1E1E28]"
              >
                ✕
              </button>
            </div>

            <div className="text-[11px] text-zinc-400">
              Select transition at cut point ({activeCutTransition.cutPointSec.toFixed(2)}s):
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              {TRANSITION_OPTIONS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    if (t.id === "CUT") {
                      onUpdateClipTransition?.(activeCutTransition.clipId, undefined, undefined);
                      if (activeCutTransition.nextClipId) {
                        onUpdateClipTransition?.(activeCutTransition.nextClipId, undefined, undefined);
                      }
                    } else {
                      const trans = {
                        type: t.id as any,
                        duration: RationalTimeMath.fromSeconds(activeCutTransition.durationSec),
                      };
                      onUpdateClipTransition?.(activeCutTransition.clipId, undefined, trans);
                      if (activeCutTransition.nextClipId) {
                        onUpdateClipTransition?.(activeCutTransition.nextClipId, trans, undefined);
                      }
                    }
                    setActiveCutTransition(null);
                  }}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border text-left transition ${
                    activeCutTransition.currentType === t.id
                      ? "bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-sm"
                      : "bg-[#181820] text-zinc-300 border-[#262632] hover:bg-[#20202C] hover:text-white"
                  }`}
                >
                  {t.name}
                </button>
              ))}
            </div>

            {/* Duration Selector */}
            <div className="pt-2 border-t border-[#20202A] space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-zinc-400">
                <span>Transition Duration</span>
                <span className="font-mono text-zinc-200">{activeCutTransition.durationSec.toFixed(1)}s</span>
              </div>
              <div className="flex items-center space-x-1.5">
                {[0.2, 0.5, 0.8, 1.0, 1.5].map((d) => (
                  <button
                    key={d}
                    onClick={() => {
                      setActiveCutTransition({
                        ...activeCutTransition,
                        durationSec: d,
                      });
                      if (activeCutTransition.currentType && activeCutTransition.currentType !== "CUT") {
                        const trans = {
                          type: activeCutTransition.currentType as any,
                          duration: RationalTimeMath.fromSeconds(d),
                        };
                        onUpdateClipTransition?.(activeCutTransition.clipId, undefined, trans);
                        if (activeCutTransition.nextClipId) {
                          onUpdateClipTransition?.(activeCutTransition.nextClipId, trans, undefined);
                        }
                      }
                    }}
                    className={`flex-1 py-1 rounded text-[10px] font-mono font-semibold border transition ${
                      activeCutTransition.durationSec === d
                        ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                        : "bg-[#16161E] text-zinc-400 border-[#22222E] hover:text-white"
                    }`}
                  >
                    {d}s
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
