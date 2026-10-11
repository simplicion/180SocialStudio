---
name: medical-doctor-authority
genre: Medical / Healthcare / Physiotherapy
description: Engineered for physicians, chiropractors, physical therapists, and healthcare authorities. Embeds anatomical diagrams, caution warning badges, clinical checkmarks, and authoritative pacing.
triggers:
  - doctor
  - dr.
  - dr
  - medical
  - clinic
  - pain
  - sciatica
  - nerve
  - spine
  - physio
  - therapy
  - massage
  - symptom
  - patient
  - hospital
  - healthcare
  - treatment
pacingMultiplier: 1.15
deadAirTrimThresholdSeconds: 0.45
zoomFrequencySeconds: 6.0
zoomScale: 1.25
captionPreset: HORMOZI_BOUNCE
captionColors:
  primary: "#FFFFFF"
  highlight: "#FFE600"
safeMarginVPercent: 0.22
soundDesignEnabled: true
duckingDb: -18.0
retentionRules:
  maxVisualStagnationSeconds: 5.0
  requireHookInFirstSeconds: 3.0
  targetOverlayDensityPerMinute: 4
visualCueRules:
  - keywords: ["sciatica", "nerve", "sciatic", "spine", "lumbar", "disc", "compression", "pinched", "floor", "baithte", "pair", "so jata", "नर्व", "स्पाइन", "पैरों", "दर्द", "spinal", "anesthesia", "पोजिशन"]
    category: ANATOMICAL_DIAGRAM
    suggestedAssetQuery: sciatica_spine_nerve_diagram
    mood: CLINICAL_AUTHORITY
    preferredPosition: UPPER_RIGHT
    durationSeconds: 3.5
    sfxType: POP
  - keywords: ["danger", "dangerous", "warning", "caution", "mistake", "wrong", "do not", "never", "worse", "irritate", "misconception", "क्लियर", "गलती", "सावधानी", "खतरा", "clear"]
    category: WARNING_BADGE
    suggestedAssetQuery: medical_caution_warning_badge
    mood: URGENT_WARNING
    preferredPosition: UPPER_LEFT
    durationSeconds: 2.8
    sfxType: ALERT
  - keywords: ["massage", "foam roller", "ball", "gluteal", "piriformis", "stretch", "therapy", "दबाव", "प्रेशर", "मसाज", "दवाई", "सिग्नल", "pressure"]
    category: ANATOMICAL_DIAGRAM
    suggestedAssetQuery: gluteal_massage_therapy_illustration
    mood: CLINICAL_AUTHORITY
    preferredPosition: UPPER_RIGHT
    durationSeconds: 3.2
    sfxType: POP
  - keywords: ["doctor", "physician", "clinic", "hospital", "specialist", "medical", "treatment", "diagnosis", "डॉक्टर", "अस्पताल", "इलाज", "सलाह", "consultation"]
    category: CALLOUT_CARD
    suggestedAssetQuery: verified_doctor_badge
    mood: CLINICAL_AUTHORITY
    preferredPosition: UPPER_RIGHT
    durationSeconds: 3.0
    sfxType: CHIME
  - keywords: ["pain", "relief", "cure", "heal", "better", "solution", "technique", "safe", "exercise", "एक्सरसाइज", "राहत", "सही", "safe", "cure"]
    category: ICON_VECTOR
    suggestedAssetQuery: medical_health_cross_checkmark
    mood: CALM_EDUCATIONAL
    preferredPosition: UPPER_RIGHT
    durationSeconds: 2.5
    sfxType: DING
---

# Medical Doctor Authority Skill

When directing content for healthcare professionals, physicians, and clinic authority branding:

## 1. Pacing & Rhythm
- Maintain a calm, high-credibility 1.15x rhythm.
- Do not make abrupt jittery cuts; preserve the speaker's authoritative cadence while trimming dead air (>0.45s).

## 2. Visual Layer & Safe Margins
- Position anatomical illustrations in upper-right or upper-left corners ($x = \pm 270, y = -560$).
- Never cover the doctor's face or lower-third caption zone.
- Render 3-word kinetic captions in white with high-contrast electric yellow highlights at $y = 0.76$ for Instagram 9:16 safe zone compliance.

## 3. Acoustic Sound Design
- Pair diagram entries with gentle acoustic pops.
- Trigger caution alert chimes on mistake/warning statements.
