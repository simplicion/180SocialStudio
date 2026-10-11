import React from "react";
import { ClipKeyframe } from "@workspace/video-contracts";

interface MotionPathOverlayProps {
  keyframes?: ClipKeyframe[];
  clipDurationSec: number;
  canvasWidth: number;
  canvasHeight: number;
  currentClipOffsetSec?: number;
}

export const MotionPathOverlay: React.FC<MotionPathOverlayProps> = ({
  keyframes = [],
  clipDurationSec,
  canvasWidth,
  canvasHeight,
  currentClipOffsetSec = 0,
}) => {
  // Filter spatial keyframes (posX and posY)
  const posKeyframes = keyframes.filter((k) => k.property === "posX" || k.property === "posY");
  if (posKeyframes.length < 2) return null;

  // Group by timestamp to get (x, y) pairs
  const timeMap = new Map<number, { x: number; y: number }>();
  posKeyframes.forEach((k) => {
    const existing = timeMap.get(k.timeOffsetSec) || { x: 0, y: 0 };
    if (k.property === "posX") existing.x = k.value;
    if (k.property === "posY") existing.y = k.value;
    timeMap.set(k.timeOffsetSec, existing);
  });

  const sortedPoints = Array.from(timeMap.entries())
    .sort(([tA], [tB]) => tA - tB)
    .map(([timeOffset, pos]) => ({
      timeOffset,
      screenX: canvasWidth / 2 + pos.x,
      screenY: canvasHeight / 2 + pos.y,
    }));

  if (sortedPoints.length < 2) return null;

  // Build SVG path
  const pathD = sortedPoints
    .map((pt, i) => `${i === 0 ? "M" : "L"} ${pt.screenX.toFixed(1)} ${pt.screenY.toFixed(1)}`)
    .join(" ");

  return (
    <svg
      className="absolute inset-0 pointer-events-none select-none z-10"
      width={canvasWidth}
      height={canvasHeight}
      viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
    >
      <defs>
        <marker
          id="motion-arrow"
          viewBox="0 0 10 10"
          refX="5"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#818cf8" />
        </marker>
      </defs>

      {/* Trajectory Shadow / Contrast Line */}
      <path
        d={pathD}
        fill="none"
        stroke="rgba(0, 0, 0, 0.6)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Trajectory Glow Line */}
      <path
        d={pathD}
        fill="none"
        stroke="#818cf8"
        strokeWidth="2"
        strokeDasharray="4 3"
        strokeLinecap="round"
        strokeLinejoin="round"
        markerEnd="url(#motion-arrow)"
      />

      {/* Keyframe Spatial Coordinate Nodes */}
      {sortedPoints.map((pt, idx) => {
        const isNearPlayhead = Math.abs(currentClipOffsetSec - pt.timeOffset) < 0.1;
        return (
          <g key={idx}>
            <circle
              cx={pt.screenX}
              cy={pt.screenY}
              r={isNearPlayhead ? 6 : 4}
              fill={isNearPlayhead ? "#38bdf8" : "#fbbf24"}
              stroke="#000000"
              strokeWidth="2"
            />
            <text
              x={pt.screenX + 6}
              y={pt.screenY - 6}
              fill="#ffffff"
              fontSize="9"
              fontFamily="monospace"
              className="drop-shadow"
            >
              {pt.timeOffset.toFixed(1)}s
            </text>
          </g>
        );
      })}
    </svg>
  );
};
