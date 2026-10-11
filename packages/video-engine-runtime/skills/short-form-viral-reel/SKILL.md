---
name: short-form-viral-reel
genre: Reels / TikTok / Shorts / Hormozi Style
description: Designed for maximum viral retention. Embeds 3D animated emojis, rapid spring camera punches every 3-5s, Hormozi-style bouncing captions, and crisp high-transient sound design.
triggers:
  - viral
  - reel
  - tiktok
  - shorts
  - hormozi
  - mrbeast
  - hook
  - retention
  - fast
  - punchy
  - growth
  - instagram
pacingMultiplier: 1.30
deadAirTrimThresholdSeconds: 0.30
zoomFrequencySeconds: 4.5
zoomScale: 1.30
captionPreset: HORMOZI_BOUNCE
captionColors:
  primary: "#FFFFFF"
  highlight: "#00FF88"
safeMarginVPercent: 0.22
soundDesignEnabled: true
duckingDb: -18.0
retentionRules:
  maxVisualStagnationSeconds: 3.5
  requireHookInFirstSeconds: 2.0
  targetOverlayDensityPerMinute: 6
visualCueRules:
  - keywords: ["money", "dollar", "profit", "cash", "sales", "revenue", "grow", "scale", "rich"]
    category: EMOJI_3D
    suggestedAssetQuery: fluent_money_bag_3d
    mood: EXCITED_VIRAL
    preferredPosition: UPPER_RIGHT
    durationSeconds: 2.5
    sfxType: DING
  - keywords: ["secret", "hack", "trick", "unlock", "hidden", "key", "strategy"]
    category: EMOJI_3D
    suggestedAssetQuery: fluent_glowing_key_3d
    mood: EXCITED_VIRAL
    preferredPosition: UPPER_LEFT
    durationSeconds: 2.5
    sfxType: POP
  - keywords: ["warning", "mistake", "stop", "never", "fail", "wrong", "trap"]
    category: WARNING_BADGE
    suggestedAssetQuery: medical_caution_warning_badge
    mood: URGENT_WARNING
    preferredPosition: UPPER_LEFT
    durationSeconds: 2.5
    sfxType: ALERT
  - keywords: ["fire", "insane", "crazy", "huge", "massive", "unbelievable", "boom"]
    category: EMOJI_3D
    suggestedAssetQuery: fluent_fire_flame_3d
    mood: EXCITED_VIRAL
    preferredPosition: UPPER_RIGHT
    durationSeconds: 2.2
    sfxType: WHOOSH
  - keywords: ["ant", "bug", "insect", "small", "tiny"]
    category: ICON_VECTOR
    suggestedAssetQuery: ant_insect_danger_icon
    mood: URGENT_WARNING
    preferredPosition: UPPER_RIGHT
    durationSeconds: 2.5
    sfxType: POP
---

# Short-Form Viral Reel Skill

Designed for high-impact social media reels with rapid pattern interrupts, 3D emojis, and dynamic punch zooms.
