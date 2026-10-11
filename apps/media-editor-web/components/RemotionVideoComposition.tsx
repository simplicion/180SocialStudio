import React from "react";
import {
  AbsoluteFill,
  Sequence,
  Video,
  Audio,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { EditIR, RationalTimeMath, MediaAssetDescriptor } from "@workspace/video-contracts";
import { MediaCacheService } from "../services/media-cache";
import { effectVisualsAt, isTitleSegment } from "../services/editor-library";
import { STUDIO_FONTS_LINK_ID, STUDIO_FONTS_URL } from "../services/caption-raster";

export interface RemotionVideoCompositionProps extends Record<string, unknown> {
  editIR: EditIR;
  assets?: MediaAssetDescriptor[];
  selectedClipId?: string | null;
}

export const RemotionVideoComposition: React.FC<RemotionVideoCompositionProps> = ({
  editIR,
  assets = [],
  selectedClipId,
}) => {
  const [failedClipIds, setFailedClipIds] = React.useState<Record<string, boolean>>({});

  // Proactively check any blob URLs across timeline tracks to flag expired ones offline
  React.useEffect(() => {
    for (const track of editIR.tracks?.videoTracks || []) {
      for (const clip of track.clips || []) {
        if (clip.sourcePath && clip.sourcePath.startsWith("blob:") && !failedClipIds[clip.id]) {
          MediaCacheService.isBlobUrlLive(clip.sourcePath).then((isLive) => {
            if (!isLive) {
              setFailedClipIds((prev) => ({ ...prev, [clip.id]: true }));
            }
          });
        }
      }
    }
  }, [editIR]);

  React.useEffect(() => {
    if (typeof document === "undefined") return;
    const linkId = STUDIO_FONTS_LINK_ID;
    if (!document.getElementById(linkId)) {
      const link = document.createElement("link");
      link.id = linkId;
      link.rel = "stylesheet";
      link.href = STUDIO_FONTS_URL; // same fonts the exporters wait for (caption-raster.ts)
      document.head.appendChild(link);
    }
  }, []);

  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTimeSec = frame / fps;

  // Determine active camera keyframe for dynamic spring zoom
  const activeCameraKeyframe = editIR.tracks.cameraTrack?.find((k) => {
    const start = RationalTimeMath.toSeconds(k.timeRange.start);
    const dur = RationalTimeMath.toSeconds(k.timeRange.duration);
    return currentTimeSec >= start && currentTimeSec <= start + dur;
  });

  let zoomScale = 1.0;
  let zoomOriginX = 50;
  let zoomOriginY = 50;

  if (activeCameraKeyframe) {
    const kStart = RationalTimeMath.toSeconds(activeCameraKeyframe.timeRange.start);
    const kDur = RationalTimeMath.toSeconds(activeCameraKeyframe.timeRange.duration);

    // Spring interpolation for punch zoom
    const springVal = spring({
      frame: Math.round((currentTimeSec - kStart) * fps),
      fps,
      config: {
        damping: activeCameraKeyframe.spring?.damping ?? 18,
        mass: activeCameraKeyframe.spring?.mass ?? 1,
        stiffness: activeCameraKeyframe.spring?.stiffness ?? 180,
      },
    });

    zoomScale = interpolate(springVal, [0, 1], [1.0, activeCameraKeyframe.scale || 1.25], {
      extrapolateRight: "clamp",
    });

    zoomOriginX = (activeCameraKeyframe.targetCoords?.x ?? 0.5) * 100;
    zoomOriginY = (activeCameraKeyframe.targetCoords?.y ?? 0.5) * 100;
  }

  // Active Captions Segment
  const isActiveAt = (c: { timeRange: { start: any; duration: any } }) => {
    const start = RationalTimeMath.toSeconds(c.timeRange.start);
    const dur = RationalTimeMath.toSeconds(c.timeRange.duration);
    return currentTimeSec >= start && currentTimeSec <= start + dur;
  };
  // Speech captions use the kinetic caption box; titles (text templates / addText) are drawn with their own style.
  const activeCaption = editIR.tracks.captionTrack?.find((c) => !isTitleSegment(c) && isActiveAt(c));
  const activeTitles = (editIR.tracks.captionTrack ?? []).filter((c) => isTitleSegment(c) && isActiveAt(c));
  const fxv = effectVisualsAt(editIR.tracks.effectTrack, currentTimeSec);

  const sortedVideoTracks = [...(editIR.tracks.videoTracks || [])].sort(
    (a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0)
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#000000",
        overflow: "hidden",
        containerType: "size",
      }}
    >
      {/* 1. Video and Overlay Visual Tracks */}
      <div
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
          transformOrigin: `${zoomOriginX}% ${zoomOriginY}%`,
          transform: `translate(${(-fxv.shakeX * 100).toFixed(3)}%, ${(-fxv.shakeY * 100).toFixed(3)}%) scale(${zoomScale * fxv.zoom})`,
          filter: fxv.grayscale > 0 ? `grayscale(${fxv.grayscale})` : undefined,
          transition: "transform 0.05s linear",
        }}
      >
        {sortedVideoTracks.map((track) =>
          track.clips.map((clip) => {
            const startSec = RationalTimeMath.toSeconds(clip.timelineRange.start);
            const durationSec = RationalTimeMath.toSeconds(clip.timelineRange.duration);
            const fromFrame = Math.round(startSec * fps);
            const durationInFrames = Math.max(1, Math.round(durationSec * fps));

            const matchedAsset = assets.find((a) => a.id === clip.assetId) || {
              id: clip.assetId,
              name: clip.sourcePath ? clip.sourcePath.split(/[\/\\]/).pop() || "media" : "Offline Media",
              filePath: clip.sourcePath,
              mimeType: clip.sourcePath?.match(/\.(jpg|jpeg|png|webp|gif|svg)($|\?)/i)
                ? "image/jpeg"
                : "video/mp4",
            };

            const isOffline = Boolean(
              (clip as any).isOffline ||
                (clip as any).offline ||
                (matchedAsset as any)?.isOffline ||
                !clip.sourcePath ||
                !matchedAsset?.filePath ||
                failedClipIds[clip.id]
            );

            const isImage = Boolean(
              clip.mediaType === "image" ||
              matchedAsset?.mimeType?.startsWith("image/") ||
                matchedAsset?.filePath?.startsWith("data:image/") ||
                matchedAsset?.filePath?.match(/\.(jpg|jpeg|png|webp|gif|svg)($|\?)/i) ||
                clip.sourcePath?.startsWith("data:image/") ||
                clip.sourcePath?.match(/\.(jpg|jpeg|png|webp|gif|svg)($|\?)/i)
            );

            // Full-frame layout: main-track clips and photos (mediaType "image"), which cover the canvas like the export.
            const isMainTrack = track.type === "MAIN_VIDEO" || clip.mediaType === "image";
            const clipOffsetSec = Math.max(0, currentTimeSec - startSec);
            const keyframes = clip.transform?.keyframes || [];

            // Dynamic keyframe property interpolator (FreeCut Keyframing Engine)
            const getKeyframedVal = (
              prop: "scale" | "posX" | "posY" | "rotation" | "opacity" | "volume",
              defaultVal: number
            ): number => {
              const propKeys = keyframes.filter((k) => k.property === prop);
              if (propKeys.length === 0) return defaultVal;
              if (propKeys.length === 1) return propKeys[0].value;
              if (clipOffsetSec <= propKeys[0].timeOffsetSec) return propKeys[0].value;
              if (clipOffsetSec >= propKeys[propKeys.length - 1].timeOffsetSec) {
                return propKeys[propKeys.length - 1].value;
              }
              for (let i = 0; i < propKeys.length - 1; i++) {
                const k1 = propKeys[i];
                const k2 = propKeys[i + 1];
                if (clipOffsetSec >= k1.timeOffsetSec && clipOffsetSec <= k2.timeOffsetSec) {
                  const range = k2.timeOffsetSec - k1.timeOffsetSec;
                  const progress = range > 0 ? (clipOffsetSec - k1.timeOffsetSec) / range : 0;
                  return k1.value + (k2.value - k1.value) * progress;
                }
              }
              return defaultVal;
            };

            const scale = getKeyframedVal("scale", clip.transform?.scale?.start ?? 1.0);
            const posX = getKeyframedVal("posX", clip.transform?.position?.x ?? 0);
            const posY = getKeyframedVal("posY", clip.transform?.position?.y ?? 0);
            const rot = getKeyframedVal("rotation", clip.transform?.rotationDeg ?? 0);
            const opacity = getKeyframedVal("opacity", clip.transform?.opacity ?? 1.0);
            // The compiler's adjustVolume("original") sets the PRIMARY_VOICE track level: it applies to the main video's own sound.
            const voiceTrackDb = track.type === "MAIN_VIDEO" ? editIR.tracks.audioTracks?.find((t) => t.type === "PRIMARY_VOICE")?.volumeDb ?? 0 : 0;
            const dynamicVolumeDb = getKeyframedVal("volume", clip.volumeDb ?? 0.0) + voiceTrackDb;
            const isSelected = selectedClipId === clip.id;

            // Compute Color & Visual Filters (Exposure, Temperature, Tint, Brightness, Contrast, Saturation)
            const tempVal = clip.transform?.temperature ?? 0;
            const tintVal = clip.transform?.tint ?? 0;
            const exposureVal = clip.transform?.exposure ?? 0;
            const exposureMultiplier = Math.pow(2, exposureVal);

            // Color Wheels evaluation
            const wheels = clip.transform?.colorWheels;
            let wheelFilter = "";
            if (wheels) {
              if (wheels.offset?.amount && wheels.offset.amount > 0) {
                wheelFilter += ` hue-rotate(${Math.round(wheels.offset.hue * wheels.offset.amount * 0.5)}deg)`;
              }
              if (wheels.offset?.luma) {
                wheelFilter += ` brightness(${Math.max(0.2, 1 + wheels.offset.luma)})`;
              }
              if (wheels.gain?.luma) {
                wheelFilter += ` contrast(${Math.max(0.5, 1 + wheels.gain.luma * 0.5)})`;
              }
            }

            const filterCss = [
              clip.transform?.brightness !== undefined
                ? `brightness(${clip.transform.brightness * exposureMultiplier})`
                : exposureVal !== 0
                ? `brightness(${exposureMultiplier})`
                : "",
              clip.transform?.contrast !== undefined ? `contrast(${clip.transform.contrast})` : "",
              clip.transform?.saturation !== undefined ? `saturate(${clip.transform.saturation})` : "",
              tempVal > 0 ? `sepia(${tempVal * 0.4}%)` : tempVal < 0 ? `hue-rotate(${tempVal * 0.3}deg)` : "",
              tintVal !== 0 ? `hue-rotate(${tintVal * 0.4}deg)` : "",
              wheelFilter.trim(),
            ]
              .filter(Boolean)
              .join(" ") || "none";

            // Compute Crop Inset
            const cropTop = clip.transform?.crop?.top ?? 0;
            const cropBottom = clip.transform?.crop?.bottom ?? 0;
            const cropLeft = clip.transform?.crop?.left ?? 0;
            const cropRight = clip.transform?.crop?.right ?? 0;
            const hasCrop = cropTop > 0 || cropBottom > 0 || cropLeft > 0 || cropRight > 0;
            const clipPathStyle = hasCrop
              ? `inset(${cropTop}% ${cropRight}% ${cropBottom}% ${cropLeft}%)`
              : "none";

            // Visual Cut-Point Transitions evaluation (FreeCut GLSL Transition Emulation)
            const tInSec = clip.transitionIn ? RationalTimeMath.toSeconds(clip.transitionIn.duration) : 0;
            let inFactor = 1.0;
            let inExtraScale = 1.0;
            let inTranslateX = 0;
            let inTranslateY = 0;
            let inBlur = 0;
            let inWipeClip: string | null = null;
            let inGlitch = false;
            let inDip: "black" | "white" | null = null;

            if (tInSec > 0 && clipOffsetSec < tInSec && clip.transitionIn) {
              const p = Math.max(0, Math.min(1, clipOffsetSec / tInSec)); // 0 -> 1
              const tType = clip.transitionIn.type;
              if (tType === "CROSSFADE" || tType === "DISSOLVE") {
                inFactor = p;
              } else if (tType === "ZOOM_SWOOSH") {
                inExtraScale = 1.0 + (1 - p) * 0.45;
                inFactor = 0.3 + 0.7 * p;
              } else if (tType === "SLIDE_LEFT") {
                inTranslateX = (1 - p) * 100;
              } else if (tType === "SLIDE_UP") {
                inTranslateY = (1 - p) * 100;
              } else if (tType === "ZOOM_OUT") {
                inExtraScale = 1.0 + (1 - p) * (1 - p) * 0.3;
              } else if (tType === "BLUR_PUNCH") {
                inBlur = (1 - p) * 20;
              } else if (tType === "WIPE") {
                // wipe left: the new clip is revealed from the right edge (same as the native export)
                inWipeClip = `inset(0 0 0 ${(1 - p) * 100}%)`;
              } else if (tType === "WIPE_RIGHT") {
                inWipeClip = `inset(0 ${(1 - p) * 100}% 0 0)`;
              } else if (tType === "GLITCH") {
                inTranslateX = p < 1 ? Math.sin(clipOffsetSec * 90) * 14 * (1 - p) : 0;
                inGlitch = true;
              } else if (tType === "DIP_BLACK" || tType === "DIP_WHITE") {
                inFactor = Math.min(1, p * 2);
                inDip = tType === "DIP_WHITE" ? "white" : "black";
              }
            }

            const tOutSec = clip.transitionOut ? RationalTimeMath.toSeconds(clip.transitionOut.duration) : 0;
            const timeLeft = durationSec - clipOffsetSec;
            let outFactor = 1.0;
            let outExtraScale = 1.0;
            let outTranslateX = 0;
            let outTranslateY = 0;
            let outBlur = 0;
            let outWipeClip: string | null = null;
            let outGlitch = false;
            let outDip: "black" | "white" | null = null;

            if (tOutSec > 0 && timeLeft < tOutSec && clip.transitionOut) {
              const p = Math.max(0, Math.min(1, timeLeft / tOutSec)); // 1 -> 0
              const tType = clip.transitionOut.type;
              if (tType === "CROSSFADE" || tType === "DISSOLVE") {
                outFactor = p;
              } else if (tType === "ZOOM_SWOOSH") {
                outExtraScale = 1.0 + (1 - p) * 0.45;
                outFactor = 0.3 + 0.7 * p;
              } else if (tType === "SLIDE_LEFT") {
                outTranslateX = -(1 - p) * 100;
              } else if (tType === "SLIDE_UP") {
                outTranslateY = -(1 - p) * 100;
              } else if (tType === "ZOOM_OUT") {
                outExtraScale = 1.0 - (1 - p) * 0.15;
              } else if (tType === "BLUR_PUNCH") {
                outBlur = (1 - p) * 20;
              } else if (tType === "WIPE") {
                outWipeClip = `inset(0 ${(1 - p) * 100}% 0 0)`;
              } else if (tType === "WIPE_RIGHT") {
                outWipeClip = `inset(0 0 0 ${(1 - p) * 100}%)`;
              } else if (tType === "GLITCH") {
                outGlitch = true;
              } else if (tType === "DIP_BLACK" || tType === "DIP_WHITE") {
                outFactor = Math.min(1, p * 2);
                outDip = tType === "DIP_WHITE" ? "white" : "black";
              }
            }

            // Dip to white brightens instead of fading over the black canvas.
            const whiteDip = (inDip === "white" ? 1 - inFactor : 0) + (outDip === "white" ? 1 - outFactor : 0);
            const fadeIn = inDip === "white" ? 1 : inFactor;
            const fadeOut = outDip === "white" ? 1 : outFactor;
            const finalOpacity = Math.max(0, Math.min(1, opacity * fadeIn * fadeOut));
            const finalScale = scale * inExtraScale * outExtraScale;
            const finalPosX = posX + inTranslateX + outTranslateX;
            const finalPosY = posY + inTranslateY + outTranslateY;
            const totalBlur = inBlur + outBlur;
            const transitionBlur = [
              totalBlur > 0 ? `blur(${totalBlur.toFixed(1)}px)` : "",
              whiteDip > 0 ? `brightness(${(1 + whiteDip * 4).toFixed(2)})` : "",
              inGlitch || outGlitch ? `hue-rotate(${frame % 2 ? 90 : -90}deg) saturate(2)` : "",
            ]
              .filter(Boolean)
              .join(" ");
            const transitionClipPath = inWipeClip || outWipeClip || clipPathStyle;
            const finalFilterCss = [filterCss === "none" ? "" : filterCss, transitionBlur].filter(Boolean).join(" ") || "none";

            const borderRadiusVal = clip.transform?.borderRadius ?? (isMainTrack ? 0 : 12);
            const boxShadowVal = clip.transform?.shadow
              ? `${clip.transform.shadow.offsetX}px ${clip.transform.shadow.offsetY}px ${clip.transform.shadow.blur}px ${clip.transform.shadow.color}`
              : isMainTrack
              ? "none"
              : "0 20px 40px rgba(0,0,0,0.6)";

            const vignetteAmount = clip.transform?.vignette ?? 0;

            return (
              <Sequence
                key={clip.id}
                from={fromFrame}
                durationInFrames={durationInFrames}
                name={matchedAsset.name || clip.id}
              >
                <div
                  style={{
                    position: "absolute",
                    inset: isMainTrack ? 0 : "auto",
                    width: isMainTrack ? "100%" : "40%",
                    height: isMainTrack ? "100%" : "40%",
                    left: isMainTrack ? 0 : "30%",
                    top: isMainTrack ? 0 : "30%",
                    transform: `translate(${finalPosX}px, ${finalPosY}px) scale(${finalScale}) rotate(${rot}deg)`,
                    opacity: finalOpacity,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {isOffline ? (
                    /* NLE Graceful Media Offline Slate */
                    <div
                      style={{
                        width: "100%",
                        height: "100%",
                        backgroundColor: "#0B0C10",
                        backgroundImage:
                          "repeating-linear-gradient(45deg, rgba(239, 68, 68, 0.08) 0px, rgba(239, 68, 68, 0.08) 12px, transparent 12px, transparent 24px)",
                        border: "1px dashed rgba(239, 68, 68, 0.35)",
                        borderRadius: borderRadiusVal,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 16,
                        textAlign: "center",
                        color: "#FCA5A5",
                        userSelect: "none",
                        boxShadow: boxShadowVal,
                      }}
                    >
                      <div
                        style={{
                          padding: 10,
                          borderRadius: 12,
                          background: "rgba(239, 68, 68, 0.15)",
                          marginBottom: 8,
                        }}
                      >
                        <svg
                          width="26"
                          height="26"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="#EF4444"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                          <line x1="12" y1="9" x2="12" y2="13" />
                          <line x1="12" y1="17" x2="12.01" y2="17" />
                        </svg>
                      </div>
                      <div
                        style={{
                          fontFamily: "'Inter', sans-serif",
                          fontWeight: 800,
                          fontSize: 13,
                          letterSpacing: "0.08em",
                          color: "#F87171",
                        }}
                      >
                        MEDIA OFFLINE
                      </div>
                      <div
                        style={{
                          fontFamily: "'Inter', sans-serif",
                          fontSize: 11,
                          color: "rgba(255,255,255,0.65)",
                          marginTop: 4,
                          maxWidth: "85%",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {matchedAsset.name || clip.id}
                      </div>
                      <div
                        style={{
                          fontFamily: "'Inter', sans-serif",
                          fontSize: 10,
                          color: "rgba(255,255,255,0.4)",
                          marginTop: 4,
                        }}
                      >
                        Session URL expired • Re-link in Asset Bin
                      </div>
                    </div>
                  ) : isImage ? (
                    <Img
                      src={matchedAsset.filePath}
                      alt={matchedAsset.name}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: isMainTrack ? "cover" : "contain",
                        borderRadius: borderRadiusVal,
                        boxShadow: boxShadowVal,
                        filter: finalFilterCss,
                        clipPath: transitionClipPath,
                      }}
                    />
                  ) : (
                    <Video
                      src={matchedAsset.filePath}
                      volume={dynamicVolumeDb ? Math.pow(10, dynamicVolumeDb / 20) : 1.0}
                      playbackRate={clip.speedMultiplier || 1.0}
                      onError={(err) => {
                        console.warn(`[RemotionVideoComposition] Handled media playback error for clip ${clip.id}:`, err);
                        setFailedClipIds((prev) => ({ ...prev, [clip.id]: true }));
                      }}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: isMainTrack ? "cover" : "contain",
                        borderRadius: borderRadiusVal,
                        boxShadow: boxShadowVal,
                        filter: finalFilterCss,
                        clipPath: transitionClipPath,
                      }}
                    />
                  )}

                  {/* Vignette Overlay Layer */}
                  {vignetteAmount > 0 && (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        pointerEvents: "none",
                        background: `radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,${vignetteAmount / 100}) 100%)`,
                        borderRadius: borderRadiusVal,
                      }}
                    />
                  )}

                  {isSelected && (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        border: "2px solid #34D399",
                        borderRadius: isMainTrack ? 0 : 12,
                        pointerEvents: "none",
                      }}
                    />
                  )}
                </div>
              </Sequence>
            );
          })
        )}
      </div>

      {/* 2. Multitrack Audio (Voice, BGM, SFX) */}
      {editIR.tracks.audioTracks?.map((audioTrack) =>
        audioTrack.clips.map((clip) => {
          const startSec = RationalTimeMath.toSeconds(clip.timelineRange.start);
          const durationSec = RationalTimeMath.toSeconds(clip.timelineRange.duration);
          const fromFrame = Math.round(startSec * fps);
          const durationInFrames = Math.max(1, Math.round(durationSec * fps));

          const baseVolume = clip.volumeDb ? Math.pow(10, clip.volumeDb / 20) : 1.0;
          const trackVolume = audioTrack.volumeDb ? Math.pow(10, audioTrack.volumeDb / 20) : 1.0;
          const finalVol = Math.max(0, Math.min(1, baseVolume * trackVolume));

          return (
            <Sequence
              key={clip.id}
              from={fromFrame}
              durationInFrames={durationInFrames}
              name={clip.id}
            >
              <Audio
                src={clip.sourcePath}
                volume={finalVol}
                onError={(err) => {
                  console.warn(`[RemotionVideoComposition] Handled audio playback error for clip ${clip.id}:`, err);
                }}
              />
            </Sequence>
          );
        })
      )}

      {/* 2b. Effect track overlays (vignette, flash, dip to black) */}
      {fxv.vignette > 0 && (
        <AbsoluteFill
          style={{
            pointerEvents: "none",
            zIndex: 20,
            background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,${(0.85 * fxv.vignette).toFixed(3)}) 100%)`,
          }}
        />
      )}
      {fxv.white > 0 && <AbsoluteFill style={{ pointerEvents: "none", zIndex: 21, backgroundColor: "#FFFFFF", opacity: fxv.white }} />}
      {fxv.black > 0 && <AbsoluteFill style={{ pointerEvents: "none", zIndex: 21, backgroundColor: "#000000", opacity: fxv.black }} />}

      {/* 2c. Titles (text templates), positioned and styled from the segment */}
      {activeTitles.map((t) => {
        const st = t.style;
        const pad = st.pillPadding ?? 12;
        return (
          <div
            key={t.id}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: `${(st.position?.y ?? 0.5) * 100}%`,
              transform: "translateY(-50%)",
              display: "flex",
              justifyContent: "center",
              pointerEvents: "none",
              zIndex: 31,
            }}
          >
            <span
              style={{
                maxWidth: `${(st.maxWidthFraction ?? 0.86) * 100}%`,
                textAlign: "center",
                fontFamily: `'${st.fontFamily || "Inter"}', sans-serif`,
                fontWeight: st.fontWeight ?? 800,
                // px values are authored for a 1080-px short side (as on mobile)
                fontSize: `${((st.fontSize || 64) / 1080) * 100}cqmin`,
                lineHeight: 1.15,
                color: st.textColor || "#FFFFFF",
                textTransform: st.uppercase ? "uppercase" : "none",
                WebkitTextStroke: st.strokeWidth ? `${st.strokeWidth / 2}px ${st.strokeColor || "#000000"}` : undefined,
                paintOrder: "stroke fill",
                textShadow: st.shadow ? "0 4px 14px rgba(0,0,0,0.85)" : "none",
                backgroundColor: st.pillBackground || "transparent",
                padding: st.pillBackground ? `${pad}px ${pad * 1.4}px` : 0,
                borderRadius: st.pillBackground ? st.pillRadius ?? 12 : 0,
              }}
            >
              {t.text}
            </span>
          </div>
        );
      })}

      {/* 3. Kinetic Word-by-Word Bouncing Captions with Rich Google Fonts Typography */}
      {activeCaption && (
        <div
          style={{
            position: "absolute",
            bottom: "8%",
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
            padding: "0 24px",
            pointerEvents: "none",
            zIndex: 30,
          }}
        >
          <div
            style={{
              padding: activeCaption.style?.pillBackground
                ? `${activeCaption.style?.pillPadding || 10}px 24px`
                : "10px 20px",
              borderRadius: activeCaption.style?.pillRadius || 20,
              backgroundColor: activeCaption.style?.pillBackground || "rgba(0,0,0,0.85)",
              backdropFilter: "blur(12px)",
              border: activeCaption.style?.pillBackground
                ? "1px solid rgba(255,255,255,0.2)"
                : "1px solid rgba(255,255,255,0.18)",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              boxShadow: "0 15px 35px rgba(0,0,0,0.8)",
            }}
          >
            {activeCaption.words && activeCaption.words.length > 0 ? (
              activeCaption.words.map((w, idx) => {
                const wStart = RationalTimeMath.toSeconds(w.start);
                const wEnd = RationalTimeMath.toSeconds(w.end);
                const isWordActive = currentTimeSec >= wStart && currentTimeSec <= wEnd;
                const fontFamily = activeCaption.style?.fontFamily || "Inter";
                const activeColor = activeCaption.style?.highlightColor || "#FBBF24";
                const baseColor = activeCaption.style?.textColor || "#FFFFFF";
                const fontSize = activeCaption.style?.fontSize ? Math.round(activeCaption.style.fontSize * 0.7) : 26;

                return (
                  <span
                    key={idx}
                    style={{
                      fontFamily: `'${fontFamily}', sans-serif`,
                      fontWeight: 900,
                      textTransform: (activeCaption.style as any)?.uppercase !== false ? "uppercase" : "none",
                      fontSize,
                      letterSpacing: "0.03em",
                      color: isWordActive ? activeColor : baseColor,
                      WebkitTextStroke: activeCaption.style?.strokeWidth
                        ? `${activeCaption.style.strokeWidth}px ${activeCaption.style.strokeColor || "#000000"}`
                        : "none",
                      transform: isWordActive ? "scale(1.18)" : "scale(1.0)",
                      textShadow: activeCaption.style?.glow
                        ? `0 0 16px ${isWordActive ? activeColor : "#FFFFFF"}`
                        : activeCaption.style?.shadow
                        ? "0 4px 14px rgba(0,0,0,0.9)"
                        : "none",
                      filter: isWordActive
                        ? `drop-shadow(0 0 12px ${activeColor})`
                        : "none",
                      transition: "all 0.08s ease-out",
                    }}
                  >
                    {w.word}
                  </span>
                );
              })
            ) : (
              <span
                style={{
                  fontFamily: `'${activeCaption.style?.fontFamily || "Inter"}', sans-serif`,
                  fontWeight: 900,
                  textTransform: (activeCaption.style as any)?.uppercase !== false ? "uppercase" : "none",
                  fontSize: activeCaption.style?.fontSize ? Math.round(activeCaption.style.fontSize * 0.7) : 26,
                  letterSpacing: "0.03em",
                  color: activeCaption.style?.textColor || "#FBBF24",
                  WebkitTextStroke: activeCaption.style?.strokeWidth
                    ? `${activeCaption.style.strokeWidth}px ${activeCaption.style.strokeColor || "#000000"}`
                    : "none",
                  textShadow: activeCaption.style?.glow
                    ? `0 0 16px ${activeCaption.style?.highlightColor || "#FBBF24"}`
                    : activeCaption.style?.shadow
                    ? "0 4px 14px rgba(0,0,0,0.9)"
                    : "none",
                  filter: "drop-shadow(0 0 12px rgba(251,191,36,0.85))",
                }}
              >
                {activeCaption.text}
              </span>
            )}
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};
