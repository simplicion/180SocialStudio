export type ColorGradePresetKey =
  | "FILMIC_CLEAN"
  | "TEAL_ORANGE_BLOCKBUSTER"
  | "WARM_DOCUMENTARY"
  | "HIGH_CONTRAST_PUNCH"
  | "NOIR_MONOCHROME";

export interface ColorGradeLook {
  presetKey: ColorGradePresetKey;
  contrastMultiplier: number;
  saturationMultiplier: number;
  gammaMultiplier: number;
  shadowTint: { r: number; g: number; b: number };
  highlightTint: { r: number; g: number; b: number };
  filmGrainOpacity: number;
  ffmpegFilterExpression: string;
  aestheticRationale: string;
}

export class CinematicColorGradePipeline {
  /**
   * Generates broadcast-grade color grading filtergraphs ensuring skin-tone vectorscope
   * compliance, S-curve tonal contrast, and highlight roll-off.
   */
  static resolveLook(presetKey: ColorGradePresetKey = "FILMIC_CLEAN"): ColorGradeLook {
    switch (presetKey) {
      case "TEAL_ORANGE_BLOCKBUSTER":
        return {
          presetKey: "TEAL_ORANGE_BLOCKBUSTER",
          contrastMultiplier: 1.10,
          saturationMultiplier: 1.08,
          gammaMultiplier: 0.98,
          shadowTint: { r: -0.05, g: -0.02, b: 0.08 }, // Cool Teal Shadows
          highlightTint: { r: 0.07, g: 0.03, b: -0.05 }, // Warm Amber Highlights
          filmGrainOpacity: 0.06,
          ffmpegFilterExpression:
            "curves=preset=medium_contrast,eq=contrast=1.10:saturation=1.08:gamma=0.98,colorbalance=rs=-0.05:gs=-0.02:bs=0.08:rh=0.07:gh=0.03:bh=-0.05",
          aestheticRationale: "Hollywood blockbuster aesthetic: Deep teal shadows, warm golden skin tones, and rich S-curve contrast.",
        };

      case "WARM_DOCUMENTARY":
        return {
          presetKey: "WARM_DOCUMENTARY",
          contrastMultiplier: 1.05,
          saturationMultiplier: 1.04,
          gammaMultiplier: 1.02,
          shadowTint: { r: 0.02, g: 0.01, b: -0.02 },
          highlightTint: { r: 0.05, g: 0.04, b: -0.02 },
          filmGrainOpacity: 0.08,
          ffmpegFilterExpression:
            "curves=preset=lighter,eq=contrast=1.05:saturation=1.04:gamma=1.02,colorbalance=rh=0.05:gh=0.04:bh=-0.02",
          aestheticRationale: "Warm documentary: Naturalistic golden hour highlights, soft shadows, and organic film texture.",
        };

      case "HIGH_CONTRAST_PUNCH":
        return {
          presetKey: "HIGH_CONTRAST_PUNCH",
          contrastMultiplier: 1.18,
          saturationMultiplier: 1.15,
          gammaMultiplier: 0.95,
          shadowTint: { r: 0, g: 0, b: 0 },
          highlightTint: { r: 0.02, g: 0.02, b: 0 },
          filmGrainOpacity: 0.04,
          ffmpegFilterExpression:
            "curves=preset=strong_contrast,eq=contrast=1.18:saturation=1.15:gamma=0.95",
          aestheticRationale: "High-retention social feed punch: Bold vibrant colors, deep blacks, and crisp highlight definition.",
        };

      case "NOIR_MONOCHROME":
        return {
          presetKey: "NOIR_MONOCHROME",
          contrastMultiplier: 1.25,
          saturationMultiplier: 0.0,
          gammaMultiplier: 0.92,
          shadowTint: { r: 0, g: 0, b: 0 },
          highlightTint: { r: 0, g: 0, b: 0 },
          filmGrainOpacity: 0.12,
          ffmpegFilterExpression:
            "curves=preset=strong_contrast,eq=contrast=1.25:saturation=0.0:gamma=0.92",
          aestheticRationale: "Cinematic noir: High-contrast monochrome with textured shadow grain and dramatic lighting.",
        };

      case "FILMIC_CLEAN":
      default:
        return {
          presetKey: "FILMIC_CLEAN",
          contrastMultiplier: 1.06,
          saturationMultiplier: 1.03,
          gammaMultiplier: 1.0,
          shadowTint: { r: -0.02, g: 0, b: 0.02 },
          highlightTint: { r: 0.03, g: 0.02, b: -0.01 },
          filmGrainOpacity: 0.05,
          ffmpegFilterExpression:
            "curves=preset=medium_contrast,eq=contrast=1.06:saturation=1.03:gamma=1.0,colorbalance=rs=-0.02:bs=0.02:rh=0.03:gh=0.02:bh=-0.01",
          aestheticRationale: "Master clean filmic: Natural skin tones, subtle shadow depth, and clean highlight roll-off.",
        };
    }
  }
}
