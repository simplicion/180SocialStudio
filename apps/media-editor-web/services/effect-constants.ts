// Dependency-free so native-render-plan.ts stays importable without runtime packages.
/** Constants shared with the FFmpeg chains in native-render-plan.ts. */
export const EFFECT_CONSTANTS = {
  /** shake: crop margin as a fraction of each dimension; the offset amplitude is margin × intensity */
  shakeMargin: 0.04,
  shakeFreqX: 9,
  shakeFreqY: 7,
  /** zoom_pulse: peak extra zoom at intensity 1 */
  zoomPulsePeak: 0.25,
  /** flash: share of the range spent ramping up (the rest ramps down) */
  flashAttack: 0.25,
  /** vignette: FFmpeg `vignette` angle = base + span × intensity (radians) */
  vignetteAngleBase: 0.2,
  vignetteAngleSpan: 0.9,
} as const;
