# 180 Media Studio Pro NLE Design System & Ergonomics Guide

This document defines the visual, tactile, and ergonomic design standards for **180 Media Studio** (`apps/desktop-editor`). All components, panels, modals, and toolbars MUST strictly adhere to these rules.

---

## 1. Design Philosophy: Professional Restraint & Zero Clutter

Professional Non-Linear Editors (e.g. DaVinci Resolve, Premiere Pro, Final Cut Pro) are high-efficiency production environments. The editor UI must never distract from the creative media itself.

- **No Gratuitous Gradients or Neon Highlights**: Decorative rainbow gradients, neon pink glows, and saturated badges are strictly prohibited in the core editing workspace.
- **Content Is Hero**: The video viewport, media thumbnails, and timeline clips must be the most visually prominent elements. All toolbars and headers should recede into clean, neutral surfaces.
- **High Information Density**: Compact padding (`px-2.5 py-1.5`, `h-8` to `h-10` toolbars), crisp borders, and monospace numeric labels.
- **Zero Redundant Helper Text**: Omit explanatory text blocks where icons, tooltips, and standard conventions suffice.

---

## 2. Color Palette (Dark Charcoal & Slate NLE Theme)

| Token | Hex Value | Semantic Usage |
| :--- | :--- | :--- |
| **`workspace-bg`** | `#080A0F` | Deepest root canvas, timeline track gutter, letterbox background |
| **`surface-base`** | `#0E1118` | Primary panel backgrounds (Inspector, Bins, Timeline footer) |
| **`surface-subtle`** | `#141822` | Toolbar backgrounds, track headers, input field fills |
| **`surface-hover`** | `#1C2230` | Hovered interactive states, active tab backgrounds |
| **`surface-border`** | `#222838` | Clean divider borders, subtle panel partitions |
| **`surface-border-active`**| `#38435C` | Focused input borders, highlighted boundaries |
| **`accent-primary`** | `#4F46E5` | Primary action buttons (Export, Selected tool), playhead indicator |
| **`accent-blue`** | `#3B82F6` | Selection bounding boxes, active video clip borders |
| **`accent-teal`** | `#10B981` | Audio track highlights, connected AI status, local sync pill |
| **`accent-amber`** | `#F59E0B` | Camera keyframe track, warning pills, caution states |
| **`accent-cyan`** | `#06B6D4` | Captions track, subtitles markers |
| **`text-primary`** | `#F1F5F9` | High-contrast headers, active labels, timecodes |
| **`text-secondary`** | `#94A3B8` | Subtitle text, track labels, input placeholders |
| **`text-muted`** | `#64748B` | Disabled controls, divider symbols, unit indicators |

---

## 3. Resizable Panels & Customizable Layout Architecture

The workspace consists of flexible panels separated by **Draggable Splitters**:

1. **Left Sidebar (Width: 240px - 480px, Default: 320px)**:
   - Houses Asset Bin, AI Director, and Folders via tabbed switcher.
   - Draggable horizontal right-edge splitter.
   - Double-click splitter to reset to default `320px`.
2. **Center Canvas Viewport (Flex 1)**:
   - Dynamically expands and contracts to fill remaining viewport dimensions.
   - Maintains fixed aspect ratio scaling (16:9, 9:16, 1:1) within letterboxed frame.
3. **Right Sidebar / Clip Inspector (Width: 220px - 420px, Default: 288px)**:
   - Contextual properties panel for selected clips.
   - Draggable horizontal left-edge splitter.
4. **Bottom Timeline (Height: 160px - 500px, Default: 280px)**:
   - Houses time ruler and stacked tracks.
   - Draggable vertical top-edge splitter.
   - Expands vertically to show more audio/video tracks.

---

## 4. Typography & Timecodes

- **UI Typography**: `font-sans` (`Inter`, system-ui). Neutral weighting (`font-medium`, `font-semibold`).
- **Timecode & Numeric Readouts**: `font-mono` (`JetBrains Mono`, monospace).
  - Format: `HH:MM:SS:FF` (30 FPS default).
  - High-contrast primary color (`text-indigo-400` or `text-slate-200`).
- **Hotkeys & Keyboard Badges**: Compact `<kbd>` tags with monospace font, subtle border, and muted text.

---

## 5. Home Screen & Project Hub Ergonomics

When the app launches without a specific project active, it displays the **Project Hub**:
- **Folder Navigation**: Tree / sidebar hierarchy supporting nested folders, item counts, and create/rename/delete actions.
- **Projects Grid & List**:
  - High-resolution video thumbnail preview.
  - Duration, resolution, aspect ratio, and last modified date.
  - 1-click **Open Project**, **Download Project (.vproj)**, **Duplicate**, and **Delete**.
- **Header Bar Navigation**: Dedicated `[ 🏠 Projects ]` button in the editor header allows instant navigation back to the hub without closing the workspace.
