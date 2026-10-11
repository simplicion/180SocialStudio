"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLATFORM_RULES = void 0;
exports.normalizePlatforms = normalizePlatforms;
exports.composeCaption = composeCaption;
const schemas_1 = require("./schemas");
/**
 * Conservative limits. Instagram and TikTok allow more text than we use, but hashtags beyond ~5 hurt reach
 * and Instagram caps posts at 5 hashtags. X counts hashtags inside the 280 characters.
 */
exports.PLATFORM_RULES = {
    instagram: { maxCaptionChars: 2200, maxHashtags: 5, formats: ['reel', 'carousel', 'static'] },
    facebook: { maxCaptionChars: 5000, maxHashtags: 3, formats: ['reel', 'carousel', 'static', 'text'] },
    tiktok: { maxCaptionChars: 2200, maxHashtags: 5, formats: ['reel', 'carousel'] },
    youtube: { maxCaptionChars: 5000, maxHashtags: 3, formats: ['reel'] },
    linkedin: { maxCaptionChars: 3000, maxHashtags: 5, formats: ['reel', 'carousel', 'static', 'text'] },
    x: { maxCaptionChars: 280, maxHashtags: 2, formats: ['reel', 'static', 'text'] },
};
const ALIASES = {
    instagram: 'instagram', ig: 'instagram', instagram_reels: 'instagram',
    facebook: 'facebook', fb: 'facebook', meta: 'facebook',
    tiktok: 'tiktok',
    youtube: 'youtube', youtube_shorts: 'youtube', shorts: 'youtube', yt: 'youtube',
    linkedin: 'linkedin',
    x: 'x', twitter: 'x',
    threads: 'facebook',
};
/** Maps free-form platform names ("YouTube Shorts", "Twitter") to autopilot platform ids. Unknown names are dropped. */
function normalizePlatforms(input) {
    const list = Array.isArray(input) ? input : [];
    const out = [];
    for (const raw of list) {
        const key = String(raw || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
        const p = ALIASES[key] || schemas_1.AUTOPILOT_PLATFORMS.find((x) => x === key);
        if (p && !out.includes(p))
            out.push(p);
    }
    return out;
}
/** Joins caption and hashtags the way it will be published. */
function composeCaption(caption, hashtags) {
    return hashtags.length ? `${caption.trim()}\n\n${hashtags.join(' ')}` : caption.trim();
}
