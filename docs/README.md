# 180 Social Studio Documentation & Engineering Specifications

Welcome to the documentation hub for **180 Social Studio** — the autonomous AI social media and video production workstation built for creators, media brands, growth marketing agencies, and modern marketing teams.

---

## Technical Specifications (`docs/specifications/`)

1. **[Architecture & Platform Overview](specifications/01-overview.md)**: Full system topology, 8-Agent AI Director, client layers, microservices ports (`:4005`), and Work Graph CRM integration.
2. **[Auto-DM Automation & Viral Lead Capture](specifications/02-auto-dm-automation.md)**: Real-time Meta webhook ingestion (<150ms), keyword comment triggers, conversational lead qualification, and CRM opportunity creation.
3. **[1-Click Multi-Platform Publishing](specifications/03-multi-platform-publishing.md)**: Unified publishing to Instagram, YouTube, TikTok, X, LinkedIn, and Facebook, with smart best-time queueing and video transcoding.
4. **[AI Script Director & Creative Ideation](specifications/04-ai-script-director.md)**: Multi-agent prompt pipelines (Trend Researcher, Hook Architect, Narrative Dramatist, Retention Critic, etc.) with calibrated brand voice.
5. **[Inbuilt Teleprompter Camera & Recording](specifications/05-inbuilt-teleprompter-camera.md)**: 4K mobile recording with speech-recognition auto-scrolling (Vosk/Whisper), multi-take bookmarking, and front-camera mirror mode.
6. **[Analytics & Interactive Content Calendar](specifications/06-analytics-and-calendar.md)**: Audience retention curves, cross-platform engagement heatmaps, drag-and-drop editorial calendar, and closed-loop ROI tracking.
7. **[Multi-Track Video Timeline Engine](specifications/07-video-editor-and-timeline.md)**: 60fps WebGPU rendering, lossless stream-copy splicing (>500 FPS export), kinetic captions, and multi-track audio ducking.
8. **[Creator Playbook & End-to-End Workflows](specifications/08-creator-playbook-and-workflows.md)**: The 15-minute concept-to-cash operational playbook: ideate, record, edit, publish, and convert viral comments into paying leads.
9. **[Mobile App & 180 Core SSO Architecture](specifications/09-mobile-app-and-sso.md)**: Flutter cross-platform architecture, CameraX integration, and RFC 7636 OAuth 2.0 PKCE authentication via `profile.180core.cloud`.

---

## Internal & Mobile App Documents
- [`docs/social-studio-mobile/`](social-studio-mobile/): Mobile development architecture, consciousness API contracts, CapCut feature parity plans, and production readiness audits.
- [`docs/social/`](social/): User-assisted social publishing workflows and token configurations.

