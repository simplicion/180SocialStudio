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
exports.sanitizeInlineUntrusted = exports.looksLikePromptInjection = exports.neutraliseUntrustedText = exports.fenceUntrusted = exports.NEUTRALISED_MARKER = exports.UNTRUSTED_DATA_POLICY = void 0;
__exportStar(require("./agent-events"), exports);
// Untrusted-content fencing, re-exported so domains without a video-contracts dependency (social-media) can use it
// through a light deep import (`@workspace/ai/dist/agent-runs`).
var video_contracts_1 = require("@workspace/video-contracts");
Object.defineProperty(exports, "UNTRUSTED_DATA_POLICY", { enumerable: true, get: function () { return video_contracts_1.UNTRUSTED_DATA_POLICY; } });
Object.defineProperty(exports, "NEUTRALISED_MARKER", { enumerable: true, get: function () { return video_contracts_1.NEUTRALISED_MARKER; } });
Object.defineProperty(exports, "fenceUntrusted", { enumerable: true, get: function () { return video_contracts_1.fenceUntrusted; } });
Object.defineProperty(exports, "neutraliseUntrustedText", { enumerable: true, get: function () { return video_contracts_1.neutraliseUntrustedText; } });
Object.defineProperty(exports, "looksLikePromptInjection", { enumerable: true, get: function () { return video_contracts_1.looksLikePromptInjection; } });
Object.defineProperty(exports, "sanitizeInlineUntrusted", { enumerable: true, get: function () { return video_contracts_1.sanitizeInlineUntrusted; } });
