import React, { useRef, useState, useEffect } from "react";
import { VideoClip, Transform } from "@workspace/video-contracts";

interface CanvasGizmoOverlayProps {
  selectedClip: VideoClip | null;
  onUpdateTransform: (transform: Transform) => void;
  containerWidth: number;
  containerHeight: number;
  isMainTrack: boolean;
}

export const CanvasGizmoOverlay: React.FC<CanvasGizmoOverlayProps> = ({
  selectedClip,
  onUpdateTransform,
  containerWidth,
  containerHeight,
  isMainTrack,
}) => {
  if (!selectedClip) return null;

  const { transform } = selectedClip;
  const scale = transform?.scale?.start ?? 1.0;
  const posX = transform?.position?.x ?? 0;
  const posY = transform?.position?.y ?? 0;
  const rot = transform?.rotationDeg ?? 0;

  const [isDragging, setIsDragging] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [isScaling, setIsScaling] = useState<string | null>(null);
  const [showSnapGuides, setShowSnapGuides] = useState({ x: false, y: false });

  const dragStartRef = useRef<{ mouseX: number; mouseY: number; startX: number; startY: number }>({
    mouseX: 0,
    mouseY: 0,
    startX: posX,
    startY: posY,
  });

  const rotateStartRef = useRef<{ centerX: number; centerY: number; startAngle: number; startRot: number }>({
    centerX: 0,
    centerY: 0,
    startAngle: 0,
    startRot: rot,
  });

  const scaleStartRef = useRef<{ mouseX: number; mouseY: number; startScale: number }>({
    mouseX: 0,
    mouseY: 0,
    startScale: scale,
  });

  // Base bounding box dimensions (relative to container)
  const baseW = isMainTrack ? containerWidth : containerWidth * 0.4;
  const baseH = isMainTrack ? containerHeight : containerHeight * 0.4;
  const baseLeft = isMainTrack ? 0 : containerWidth * 0.3;
  const baseTop = isMainTrack ? 0 : containerHeight * 0.3;

  // Center position of the element
  const centerX = baseLeft + baseW / 2 + posX;
  const centerY = baseTop + baseH / 2 + posY;

  // Handle Drag / Translate
  const handleMouseDownDrag = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startX: posX,
      startY: posY,
    };
  };

  // Handle Rotation Start
  const handleMouseDownRotate = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsRotating(true);
    const rad = Math.atan2(e.clientY - centerY, e.clientX - centerX);
    rotateStartRef.current = {
      centerX,
      centerY,
      startAngle: (rad * 180) / Math.PI,
      startRot: rot,
    };
  };

  // Handle Scale Start
  const handleMouseDownScale = (handle: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsScaling(handle);
    scaleStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startScale: scale,
    };
  };

  // Window Event Listeners during Active Manipulation
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const deltaX = e.clientX - dragStartRef.current.mouseX;
        const deltaY = e.clientY - dragStartRef.current.mouseY;
        let newX = Math.round(dragStartRef.current.startX + deltaX);
        let newY = Math.round(dragStartRef.current.startY + deltaY);

        // Magnetic Snapping near center (within 6px)
        const snapNearX = Math.abs(newX) < 6;
        const snapNearY = Math.abs(newY) < 6;
        if (snapNearX) newX = 0;
        if (snapNearY) newY = 0;

        setShowSnapGuides({ x: snapNearX, y: snapNearY });

        onUpdateTransform({
          ...transform,
          position: { ...transform.position, x: newX, y: newY },
        });
      } else if (isRotating) {
        const rad = Math.atan2(
          e.clientY - rotateStartRef.current.centerY,
          e.clientX - rotateStartRef.current.centerX
        );
        const currentAngle = (rad * 180) / Math.PI;
        let deltaAngle = currentAngle - rotateStartRef.current.startAngle;
        let newRot = Math.round(rotateStartRef.current.startRot + deltaAngle);

        // Snap to 0, 90, 180, -90 if within 3 degrees
        if (Math.abs(newRot) < 3) newRot = 0;
        else if (Math.abs(newRot - 90) < 3) newRot = 90;
        else if (Math.abs(newRot + 90) < 3) newRot = -90;
        else if (Math.abs(Math.abs(newRot) - 180) < 3) newRot = 180;

        onUpdateTransform({
          ...transform,
          rotationDeg: newRot,
        });
      } else if (isScaling) {
        const deltaDist =
          (e.clientX - scaleStartRef.current.mouseX) +
          (e.clientY - scaleStartRef.current.mouseY);
        const factor = isScaling.includes("s") || isScaling.includes("e") ? 0.005 : -0.005;
        let newScale = Math.max(0.1, Math.min(4.0, scaleStartRef.current.startScale + deltaDist * factor));

        // Snap to 1.0 (100%) if within 0.03
        if (Math.abs(newScale - 1.0) < 0.03) newScale = 1.0;

        onUpdateTransform({
          ...transform,
          scale: { ...transform.scale, start: parseFloat(newScale.toFixed(2)), end: parseFloat(newScale.toFixed(2)) },
        });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsRotating(false);
      setIsScaling(null);
      setShowSnapGuides({ x: false, y: false });
    };

    if (isDragging || isRotating || isScaling) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, isRotating, isScaling, onUpdateTransform, transform]);

  return (
    <div className="absolute inset-0 pointer-events-none z-40 overflow-hidden">
      {/* Center Alignment Snap Guidelines */}
      {showSnapGuides.x && (
        <div
          className="absolute top-0 bottom-0 border-l border-dashed border-cyan-400 pointer-events-none z-50 shadow-[0_0_8px_rgba(34,211,238,0.8)]"
          style={{ left: `${containerWidth / 2}px` }}
        />
      )}
      {showSnapGuides.y && (
        <div
          className="absolute left-0 right-0 border-t border-dashed border-cyan-400 pointer-events-none z-50 shadow-[0_0_8px_rgba(34,211,238,0.8)]"
          style={{ top: `${containerHeight / 2}px` }}
        />
      )}

      {/* 8-Point Bounding Box */}
      <div
        style={{
          position: "absolute",
          left: `${baseLeft}px`,
          top: `${baseTop}px`,
          width: `${baseW}px`,
          height: `${baseH}px`,
          transform: `translate(${posX}px, ${posY}px) scale(${scale}) rotate(${rot}deg)`,
          transformOrigin: "center center",
          pointerEvents: "auto",
        }}
        className="cursor-move group"
        onMouseDown={handleMouseDownDrag}
      >
        {/* Border Ring */}
        <div className="absolute inset-0 border-2 border-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.6)] rounded-sm pointer-events-none" />

        {/* Live HUD Badge (Coordinates, Scale, Rotation) */}
        {(isDragging || isRotating || isScaling) && (
          <div className="absolute -top-9 left-1/2 -translate-x-1/2 bg-black/90 backdrop-blur-md px-2.5 py-1 rounded-full border border-emerald-400/40 text-[10px] font-mono text-emerald-300 flex items-center space-x-2 pointer-events-none shadow-xl whitespace-nowrap z-50">
            <span>X: {posX > 0 ? `+${posX}` : posX}px</span>
            <span className="text-zinc-600">|</span>
            <span>Y: {posY > 0 ? `+${posY}` : posY}px</span>
            <span className="text-zinc-600">|</span>
            <span>{(scale * 100).toFixed(0)}%</span>
            <span className="text-zinc-600">|</span>
            <span>{rot}°</span>
          </div>
        )}

        {/* Rotation Arm & Knob */}
        <div
          className="absolute -top-7 left-1/2 -translate-x-1/2 flex flex-col items-center cursor-grab active:cursor-grabbing group/rot"
          onMouseDown={handleMouseDownRotate}
          title="Drag to Rotate (Degrees)"
        >
          <div className="w-3.5 h-3.5 rounded-full bg-emerald-400 border-2 border-black shadow-[0_0_8px_rgba(52,211,153,0.9)] hover:scale-125 transition-transform" />
          <div className="w-0.5 h-3.5 bg-emerald-400/80" />
        </div>

        {/* 4 Corner Scale Handles */}
        <div
          onMouseDown={(e) => handleMouseDownScale("nw", e)}
          className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-white border-2 border-emerald-500 rounded-sm cursor-nwse-resize hover:scale-125 transition-transform shadow-md"
        />
        <div
          onMouseDown={(e) => handleMouseDownScale("ne", e)}
          className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-white border-2 border-emerald-500 rounded-sm cursor-nesw-resize hover:scale-125 transition-transform shadow-md"
        />
        <div
          onMouseDown={(e) => handleMouseDownScale("sw", e)}
          className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-white border-2 border-emerald-500 rounded-sm cursor-nesw-resize hover:scale-125 transition-transform shadow-md"
        />
        <div
          onMouseDown={(e) => handleMouseDownScale("se", e)}
          className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-white border-2 border-emerald-500 rounded-sm cursor-nwse-resize hover:scale-125 transition-transform shadow-md"
        />

        {/* 4 Edge Midpoint Handles */}
        <div
          onMouseDown={(e) => handleMouseDownScale("n", e)}
          className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-white border border-emerald-500 rounded-sm cursor-ns-resize hover:scale-125 transition-transform shadow-sm"
        />
        <div
          onMouseDown={(e) => handleMouseDownScale("s", e)}
          className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-white border border-emerald-500 rounded-sm cursor-ns-resize hover:scale-125 transition-transform shadow-sm"
        />
        <div
          onMouseDown={(e) => handleMouseDownScale("w", e)}
          className="absolute top-1/2 -translate-y-1/2 -left-1 w-2 h-2 bg-white border border-emerald-500 rounded-sm cursor-ew-resize hover:scale-125 transition-transform shadow-sm"
        />
        <div
          onMouseDown={(e) => handleMouseDownScale("e", e)}
          className="absolute top-1/2 -translate-y-1/2 -right-1 w-2 h-2 bg-white border border-emerald-500 rounded-sm cursor-ew-resize hover:scale-125 transition-transform shadow-sm"
        />
      </div>
    </div>
  );
};
