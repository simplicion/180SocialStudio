import React, { useEffect, useRef } from "react";
import { audioWaveformService } from "../services/audio-waveform";

interface VisibleWaveformCanvasProps {
  sourceUrl: string;
  durationSec: number;
  width: number;
  height: number;
  color?: "cyan" | "emerald" | "amber" | "purple";
  className?: string;
}

export const VisibleWaveformCanvas: React.FC<VisibleWaveformCanvasProps> = ({
  sourceUrl,
  durationSec,
  width,
  height,
  color = "emerald",
  className = "",
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let isCancelled = false;

    const renderWaveform = async () => {
      const canvas = canvasRef.current;
      if (!canvas || width <= 0 || height <= 0) return;

      const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      // Extract or compute peaks
      const sampleRate = Math.max(20, Math.min(100, Math.floor(width / 3.5)));
      const peaks = await audioWaveformService.getPeaks(sourceUrl, durationSec, sampleRate);
      if (isCancelled || !canvasRef.current) return;

      const barWidth = 2.0;
      const barGap = 1.5;
      const step = barWidth + barGap;
      const numBars = Math.floor(width / step);
      const centerY = height / 2;

      // Color scheme setup
      let strokeColor = "#10b981"; // emerald
      let fillColor = "rgba(16, 185, 129, 0.75)";
      if (color === "cyan") {
        strokeColor = "#06b6d4";
        fillColor = "rgba(6, 182, 212, 0.75)";
      } else if (color === "amber") {
        strokeColor = "#f59e0b";
        fillColor = "rgba(245, 158, 11, 0.75)";
      } else if (color === "purple") {
        strokeColor = "#a855f7";
        fillColor = "rgba(168, 85, 247, 0.75)";
      }

      ctx.fillStyle = fillColor;

      for (let i = 0; i < numBars; i++) {
        const peakIndex = Math.min(peaks.length - 1, Math.floor((i / numBars) * peaks.length));
        const amp = peaks[peakIndex] || 0.1;
        const barHeight = Math.max(3, amp * (height - 4));
        const x = i * step;
        const y = centerY - barHeight / 2;

        // Draw rounded capsule for each peak
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 1);
        ctx.fill();
      }
    };

    renderWaveform();

    return () => {
      isCancelled = true;
    };
  }, [sourceUrl, durationSec, width, height, color]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: `${width}px`, height: `${height}px` }}
      className={`pointer-events-none select-none ${className}`}
    />
  );
};
