import * as fs from "fs";
import * as path from "path";
import crypto from "crypto";
import type { RenderMotionGraphicOp } from "@workspace/video-contracts";
import { buildHyperFramesSvg, HyperFramesTemplateId } from "./templates";

export interface HyperFramesOverlayDescriptor {
  svgPath: string;
  width: number;
  height: number;
  timelineStartSec: number;
  durationSec: number;
  filterComplexString: string;
}

export class HyperFramesRunner {
  /**
   * Generates a creator-grade kinetic motion graphic SVG card on disk
   * and compiles the hardware-accelerated FFmpeg overlay filter with spring motion.
   */
  static generateCard(
    op: RenderMotionGraphicOp,
    outputDir: string,
    canvas: { width: number; height: number } = { width: 1080, height: 1920 }
  ): HyperFramesOverlayDescriptor {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const { templateId, title, subtitle, metricValue, metricLabel, tag, accentColor, timelineStartSec, durationSec, position } = op;
    const cardId = crypto.randomUUID().slice(0, 8);

    const { svg, width, height, defaultYOffset } = buildHyperFramesSvg(templateId as HyperFramesTemplateId, {
      title,
      subtitle,
      metricValue,
      metricLabel,
      tag,
      accentColor,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
    });

    const svgFileName = `hyperframe_${templateId}_${cardId}.svg`;
    const svgPath = path.join(outputDir, svgFileName);
    fs.writeFileSync(svgPath, svg, "utf8");

    // Compute coordinate positioning
    const endSec = timelineStartSec + durationSec;
    let xExpr = `(W-w)/2`;
    let targetY = canvas.height - height - defaultYOffset;

    if (position === "center") {
      targetY = (canvas.height - height) / 2;
    } else if (position === "top_right") {
      xExpr = `W-w-40`;
      targetY = 120;
    } else if (position === "bottom_left") {
      xExpr = `40`;
      targetY = canvas.height - height - 120;
    }

    // Dynamic kinetic slide-up entrance: starts 60px lower and springs into targetY over 0.25s
    const easeStart = timelineStartSec;
    const easeDur = 0.25;
    const yExpr = `if(lte(t,${easeStart}+${easeDur}), ${targetY}+60*(1-(t-${easeStart})/${easeDur}), ${targetY})`;

    // Filter syntax for FFmpeg overlay with enable timing
    // Windows file paths in FFmpeg filter require escaping backslashes or forward slashes
    const normalizedSvgPath = svgPath.replace(/\\/g, "/").replace(/:/g, "\\:");
    const filterComplexString = `movie='${normalizedSvgPath}'[card_${cardId}];[in][card_${cardId}]overlay=x='${xExpr}':y='${yExpr}':enable='between(t,${timelineStartSec},${endSec})'[out]`;

    return {
      svgPath,
      width,
      height,
      timelineStartSec,
      durationSec,
      filterComplexString,
    };
  }
}

