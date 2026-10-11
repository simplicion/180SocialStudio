import React, { useRef, useEffect, useState, useMemo } from "react";
import { Player, PlayerRef } from "@remotion/player";
import { Plus, Sparkles, Film, AlertTriangle } from "lucide-react";
import { EditIR, RationalTimeMath, MediaAssetDescriptor, VideoClip, Transform } from "@workspace/video-contracts";
import { RemotionVideoComposition } from "./RemotionVideoComposition";
import { CanvasGizmoOverlay } from "./CanvasGizmoOverlay";
import { MotionPathOverlay } from "./MotionPathOverlay";

interface CanvasViewportProps {
  editIR: EditIR;
  assets?: MediaAssetDescriptor[];
  currentTimeSeconds: number;
  isPlaying: boolean;
  aspectRatio: "16:9" | "9:16" | "1:1";
  selectedClipId?: string | null;
  onUpdateTransform?: (transform: Transform) => void;
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
  onStepFrame?: (direction: -1 | 1) => void;
  onAspectRatioChange?: (aspect: "16:9" | "9:16" | "1:1") => void;
  onOpenImport?: () => void;
}

export const CanvasViewport: React.FC<CanvasViewportProps> = ({
  editIR,
  assets = [],
  currentTimeSeconds,
  isPlaying,
  aspectRatio,
  selectedClipId,
  onUpdateTransform,
  onTogglePlay,
  onSeek,
  onOpenImport,
}) => {
  const playerRef = useRef<PlayerRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  const totalDurationSec = Math.max(1, RationalTimeMath.toSeconds(editIR.meta.totalDuration));
  const fps = editIR.meta.fps.numerator / editIR.meta.fps.denominator || 30;
  const durationInFrames = Math.max(1, Math.round(totalDurationSec * fps));

  const hasMedia = (editIR.tracks.videoTracks[0]?.clips?.length ?? 0) > 0 || assets.length > 0;

  // Track container dimensions for gizmo overlay positioning
  useEffect(() => {
    if (!containerRef.current) return;
    const updateSize = () => {
      if (containerRef.current) {
        setContainerSize({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [aspectRatio]);

  // Find active selected clip and track type
  let selectedClip: VideoClip | null = null;
  let isMainTrack = true;
  if (selectedClipId) {
    for (const track of editIR.tracks.videoTracks) {
      const found = track.clips.find((c) => c.id === selectedClipId);
      if (found) {
        selectedClip = found;
        isMainTrack = track.type === "MAIN_VIDEO";
        break;
      }
    }
  }

  // Compute Composition Dimensions based on Target Aspect Ratio
  const { compWidth, compHeight, aspectClass } = useMemo(() => {
    switch (aspectRatio) {
      case "9:16":
        return { compWidth: 1080, compHeight: 1920, aspectClass: "aspect-[9/16]" };
      case "1:1":
        return { compWidth: 1080, compHeight: 1080, aspectClass: "aspect-square" };
      case "16:9":
      default:
        return { compWidth: 1920, compHeight: 1080, aspectClass: "aspect-video" };
    }
  }, [aspectRatio]);

  // Sync isPlaying state with Remotion Player
  useEffect(() => {
    if (!playerRef.current) return;
    if (isPlaying && !playerRef.current.isPlaying()) {
      playerRef.current.play();
    } else if (!isPlaying && playerRef.current.isPlaying()) {
      playerRef.current.pause();
    }
  }, [isPlaying]);

  // Sync external seek time with Remotion Player
  useEffect(() => {
    if (!playerRef.current) return;
    const targetFrame = Math.round(currentTimeSeconds * fps);
    const currentFrame = playerRef.current.getCurrentFrame();
    if (Math.abs(targetFrame - currentFrame) > 1) {
      playerRef.current.seekTo(targetFrame);
    }
  }, [currentTimeSeconds, fps]);

  // Sync event listeners with Remotion Player
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;

    const onPlayHandler = () => {
      if (!isPlaying) onTogglePlay();
    };
    const onPauseHandler = () => {
      if (isPlaying) onTogglePlay();
    };
    const onFrameUpdateHandler = (e: { detail: { frame: number } }) => {
      const currentSec = e.detail.frame / fps;
      if (Math.abs(currentSec - currentTimeSeconds) > 0.05) {
        onSeek(currentSec);
      }
    };

    player.addEventListener("play", onPlayHandler);
    player.addEventListener("pause", onPauseHandler);
    player.addEventListener("frameupdate", onFrameUpdateHandler);

    return () => {
      player.removeEventListener("play", onPlayHandler);
      player.removeEventListener("pause", onPauseHandler);
      player.removeEventListener("frameupdate", onFrameUpdateHandler);
    };
  }, [fps, isPlaying, currentTimeSeconds, onTogglePlay, onSeek]);

  return (
    <div className="w-full h-full bg-[#050608] flex items-center justify-center p-3 relative overflow-hidden select-none">
      {/* Viewport Frame Container */}
      <div
        ref={containerRef}
        className={`relative ${aspectClass} max-h-[92%] max-w-[94%] w-auto h-auto rounded-xl overflow-hidden shadow-2xl bg-black border border-[#1C1C22] flex items-center justify-center`}
      >
        {hasMedia ? (
          <div className="w-full h-full relative">
            <Player
              ref={playerRef}
              component={RemotionVideoComposition}
              inputProps={{
                editIR,
                assets,
                selectedClipId,
              }}
              durationInFrames={durationInFrames}
              compositionWidth={compWidth}
              compositionHeight={compHeight}
              fps={fps}
              style={{
                width: "100%",
                height: "100%",
                backgroundColor: "#000000",
              }}
              controls={false}
              autoPlay={false}
              loop={false}
              clickToPlay={true}
              errorFallback={({ error }) => (
                <div className="w-full h-full bg-[#0B0C10] flex flex-col items-center justify-center p-6 text-center text-zinc-300">
                  <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mb-3">
                    <AlertTriangle className="w-6 h-6 text-amber-400" />
                  </div>
                  <h3 className="text-sm font-semibold text-zinc-100">Media Playback Notice</h3>
                  <p className="text-xs text-zinc-400 mt-1 max-w-sm leading-relaxed">
                    {error.message?.includes("DEMUXER")
                      ? "A media clip's temporary session URL has expired. Re-link media or add new clips."
                      : error.message || "An error occurred during composition playback."}
                  </p>
                  <div className="mt-4 flex items-center space-x-2">
                    {onOpenImport && (
                      <button
                        onClick={onOpenImport}
                        className="px-3.5 py-1.5 rounded-xl bg-white hover:bg-zinc-200 text-black text-xs font-semibold shadow transition cursor-pointer"
                      >
                        Re-link Media
                      </button>
                    )}
                    <button
                      onClick={() => window.location.reload()}
                      className="px-3.5 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold border border-zinc-700 transition cursor-pointer"
                    >
                      Reload Canvas
                    </button>
                  </div>
                </div>
              )}
            />

            {/* Motion Path Trajectory Overlay */}
            {selectedClip && containerSize.width > 0 && selectedClip.transform?.keyframes && (
              <MotionPathOverlay
                keyframes={selectedClip.transform.keyframes}
                clipDurationSec={RationalTimeMath.toSeconds(selectedClip.timelineRange.duration)}
                canvasWidth={containerSize.width}
                canvasHeight={containerSize.height}
                currentClipOffsetSec={Math.max(
                  0,
                  currentTimeSeconds - RationalTimeMath.toSeconds(selectedClip.timelineRange.start)
                )}
              />
            )}

            {/* CapCut Direct-Manipulation Canvas Gizmo Overlay */}
            {selectedClip && onUpdateTransform && containerSize.width > 0 && (
              <CanvasGizmoOverlay
                selectedClip={selectedClip}
                onUpdateTransform={onUpdateTransform}
                containerWidth={containerSize.width}
                containerHeight={containerSize.height}
                isMainTrack={isMainTrack}
              />
            )}
          </div>
        ) : (
          /* Obsidian Empty State when no clips exist */
          <div className="w-full h-full bg-[#000000] flex flex-col items-center justify-center relative p-6 text-center">
            <div className="absolute inset-0 bg-[radial-gradient(#1F1F24_1px,transparent_1px)] [background-size:24px_24px] opacity-35 pointer-events-none" />

            <div className="z-10 flex flex-col items-center max-w-sm px-4">
              <div className="w-16 h-16 sm:w-20 sm:h-20 mb-3 sm:mb-4 flex items-center justify-center relative group">
                <img
                  src="/white-icon.svg"
                  onError={(e) => {
                    e.currentTarget.src = "/white icon.svg";
                  }}
                  alt="180 Media Studio"
                  className="w-14 h-14 sm:w-16 sm:h-16 object-contain drop-shadow-[0_0_25px_rgba(255,255,255,0.18)] opacity-90 group-hover:opacity-100 transition-opacity"
                />
              </div>

              <h3 className="text-sm sm:text-base font-semibold text-zinc-100 tracking-tight">
                No Media in Timeline
              </h3>
              <p className="text-xs text-zinc-400 mt-1 mb-4 leading-relaxed">
                Import video clips or images to start cutting, arranging, and directing with AI.
              </p>

              {onOpenImport && (
                <button
                  onClick={onOpenImport}
                  className="flex items-center space-x-2 px-4 py-2 rounded-xl bg-white hover:bg-zinc-200 text-black font-semibold text-xs transition active:scale-95 shadow-lg shadow-white/10 group cursor-pointer"
                  title="Import Video or Image Files"
                >
                  <Plus className="w-4 h-4 text-black group-hover:rotate-90 transition-transform duration-200" />
                  <span>Add Media</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
