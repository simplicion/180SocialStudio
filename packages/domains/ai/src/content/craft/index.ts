/**
 * Platform craft kit: deterministic, zero-dependency linters for hooks, timed beat sheets, per-platform copy,
 * AI-voice cleanup and profile audits. Hook formulas, slop lexicon and the Instagram rubric are ported from
 * github.com/Jakeschincariol/instagram-agent-skill (MIT, see NOTICE.md) and extended to every platform.
 */
export * from './platform-specs';
export * from './hook-scorer';
export * from './beat-sheet';
export * from './copy-linter';
export * from './text-humanizer';
export * from './profile-auditor';
export * from './platform-profile-audit';
export * from './swipe-classifier';
export * from './craft-review';
export { HOOKS_DATA } from './data/hooks.data';
