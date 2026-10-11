"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HOOKS_DATA = void 0;
/**
 * Platform craft kit: deterministic, zero-dependency linters for hooks, timed beat sheets, per-platform copy,
 * AI-voice cleanup and profile audits. Hook formulas, slop lexicon and the Instagram rubric are ported from
 * github.com/Jakeschincariol/instagram-agent-skill (MIT, see NOTICE.md) and extended to every platform.
 */
__exportStar(require("./platform-specs"), exports);
__exportStar(require("./hook-scorer"), exports);
__exportStar(require("./beat-sheet"), exports);
__exportStar(require("./copy-linter"), exports);
__exportStar(require("./text-humanizer"), exports);
__exportStar(require("./profile-auditor"), exports);
__exportStar(require("./platform-profile-audit"), exports);
__exportStar(require("./swipe-classifier"), exports);
__exportStar(require("./craft-review"), exports);
var hooks_data_1 = require("./data/hooks.data");
Object.defineProperty(exports, "HOOKS_DATA", { enumerable: true, get: function () { return hooks_data_1.HOOKS_DATA; } });
