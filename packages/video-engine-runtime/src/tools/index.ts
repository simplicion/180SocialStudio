export * from "./base-tool";
export * from "./registry";

// Analysis Tools
export * from "./analysis/probe-media.tool";
export * from "./analysis/speech-transcribe.tool";
export * from "./analysis/silence-detector.tool";
export * from "./analysis/mood-classifier.tool";

// Audio & Speech Tools
export * from "./audio/cartesia-voice.tool";

// Sourcing Tools
export * from "./sourcing/pexels-client";
export * from "./sourcing/pixabay-client";
export * from "./sourcing/stock-decision-broker";
export * from "./sourcing/broll-search.tool";
export * from "./sourcing/pixabay-media.tool";
export * from "./sourcing/freesound-sfx.tool";
export * from "./sourcing/asset-search.tool";
export * from "./sourcing/sfx-search.tool";
export * from "./sourcing/bgm-search.tool";
export * from "./sourcing/free-media-providers";
export * from "./sourcing/sticker-library";

// Composition Tools
export * from "./composition/take-curation.tool";
export * from "./composition/timeline-assembly.tool";
export * from "./composition/camera-zoom.tool";
export * from "./composition/kinetic-caption.tool";
export * from "./composition/motion-overlay.tool";
export * from "./composition/audio-ducking.tool";
export * from "./composition/generative-motion.tool";

// Quality Tools
export * from "./quality/critic-audit.tool";

// Render Tools
export * from "./render/lossless-render.tool";

import { DirectorToolRegistry } from "./registry";
import { CartesiaVoiceTool } from "./audio/cartesia-voice.tool";
import { ProbeMediaTool } from "./analysis/probe-media.tool";
import { SpeechTranscribeTool } from "./analysis/speech-transcribe.tool";
import { SilenceDetectorTool } from "./analysis/silence-detector.tool";
import { MoodClassifierTool } from "./analysis/mood-classifier.tool";
import { AssetSearchTool } from "./sourcing/asset-search.tool";
import { BrollSearchTool } from "./sourcing/broll-search.tool";
import { PixabayMediaTool } from "./sourcing/pixabay-media.tool";
import { FreesoundSfxTool } from "./sourcing/freesound-sfx.tool";
import { SfxSearchTool } from "./sourcing/sfx-search.tool";
import { BgmSearchTool } from "./sourcing/bgm-search.tool";
import { TakeCurationTool } from "./composition/take-curation.tool";
import { TimelineAssemblyTool } from "./composition/timeline-assembly.tool";
import { CameraZoomTool } from "./composition/camera-zoom.tool";
import { KineticCaptionTool } from "./composition/kinetic-caption.tool";
import { MotionOverlayTool } from "./composition/motion-overlay.tool";
import { AudioDuckingTool } from "./composition/audio-ducking.tool";
import { GenerativeMotionTool } from "./composition/generative-motion.tool";
import { CriticAuditTool } from "./quality/critic-audit.tool";
import { LosslessRenderTool } from "./render/lossless-render.tool";

/**
 * Initializes the default tools catalog in the singleton registry
 */
export function initializeDefaultDirectorTools(): DirectorToolRegistry {
  const registry = DirectorToolRegistry.getInstance();
  registry.register(new CartesiaVoiceTool());
  registry.register(new ProbeMediaTool());
  registry.register(new SpeechTranscribeTool());
  registry.register(new SilenceDetectorTool());
  registry.register(new MoodClassifierTool());
  registry.register(new AssetSearchTool());
  registry.register(new BrollSearchTool());
  registry.register(new PixabayMediaTool());
  registry.register(new FreesoundSfxTool());
  registry.register(new SfxSearchTool());
  registry.register(new BgmSearchTool());
  registry.register(new TakeCurationTool());
  registry.register(new TimelineAssemblyTool());
  registry.register(new CameraZoomTool());
  registry.register(new KineticCaptionTool());
  registry.register(new MotionOverlayTool());
  registry.register(new AudioDuckingTool());
  registry.register(new GenerativeMotionTool());
  registry.register(new CriticAuditTool());
  registry.register(new LosslessRenderTool());
  return registry;
}

// Auto-initialize on import
initializeDefaultDirectorTools();
