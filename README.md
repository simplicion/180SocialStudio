# 180 Social Studio & AI Director

The standalone, autonomous AI-powered Social Media & Video Production Platform for 180 Workspace.

## Architecture

```
180 social studio/
├── apps/
│   ├── 180-social-studio-backend/  # Express API (Port 4005): Social Media, AI Director, Video Editor APIs
│   └── social-studio-mobile/       # Flutter Multi-Platform App (Android, iOS, Desktop)
├── packages/
│   ├── db-social-studio/           # Dedicated Prisma schema (Creator Profiles, Posts, Brand Voices, Review Sessions)
│   ├── domains/
│   │   ├── social-media/           # Multi-Channel Publishing, Content Calendar, Auto-pilot, Engagement, Analytics
│   │   ├── ai/                     # AI Director, 8-Agent Autopilot, Multi-model Kernel (Gemini, Claude, GPT)
│   │   ├── workspace-tools/        # Brand assets, calendar tools, cloud storage
│   │   └── rag/                    # RAG retrieval for brand voice
│   ├── video-contracts/            # Deterministic Edit-IR compiler, timeline schemas, director tools
│   ├── video-engine-runtime/       # FFmpeg intelligence, Stock footage sourcing, Edge test harness
│   ├── backend-common/             # EventBus, caching, infrastructure helpers
│   ├── ui/                         # Studio dark palette UI tokens & components
│   ├── typescript-config/          # Strict TSConfig presets
│   └── eslint-config/              # Shared linting
├── docs/                           # Architecture specs, AI Director contracts, Production audits
└── scripts/                        # Dev runner and automated test suites
```

## Quick Start

### 1. Install Dependencies
```bash
pnpm install
```

### 2. Generate Database Client & Push Schema
```bash
pnpm db:generate
pnpm db:push
```

### 3. Run Development Stack
```bash
pnpm dev
```

### 4. Run Automated Test Suite
```bash
pnpm test
```
