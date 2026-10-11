export * from "./agent-events";
// Untrusted-content fencing, re-exported so domains without a video-contracts dependency (social-media) can use it
// through a light deep import (`@workspace/ai/dist/agent-runs`).
export {
  UNTRUSTED_DATA_POLICY,
  NEUTRALISED_MARKER,
  fenceUntrusted,
  neutraliseUntrustedText,
  looksLikePromptInjection,
  sanitizeInlineUntrusted,
} from "@workspace/video-contracts";
export type { UntrustedSource, FencedBlock } from "@workspace/video-contracts";
