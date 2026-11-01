export interface HyperFramesCardProps {
  title: string;
  subtitle?: string;
  metricValue?: string;
  metricLabel?: string;
  tag?: string;
  accentColor?: string;
  theme?: "dark" | "light" | "glass";
  canvasWidth?: number;
  canvasHeight?: number;
}

export type HyperFramesTemplateId =
  | "vox-explainer"
  | "hormozi-counter"
  | "saas-callout"
  | "quote-reveal"
  | "split-comparison";

export function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Builds high-production SVG motion graphics templates designed for creator videos.
 * Features kinetic typography, modern rounded geometry, gradient badges, and high-contrast styling.
 */
export function buildHyperFramesSvg(
  templateId: HyperFramesTemplateId,
  props: HyperFramesCardProps
): { svg: string; width: number; height: number; defaultYOffset: number } {
  const accent = props.accentColor || "#3B82F6";
  const title = escapeXml(props.title || "Key Takeaway");
  const subtitle = escapeXml(props.subtitle || "");
  const metricValue = escapeXml(props.metricValue || "10X");
  const metricLabel = escapeXml(props.metricLabel || "Performance Increase");
  const tag = escapeXml(props.tag || "INSIGHT");

  switch (templateId) {
    case "hormozi-counter": {
      const width = 720;
      const height = 300;
      const svg = `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="shadow" x="0" y="0" width="${width}" height="${height}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
      <feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="#000000" flood-opacity="0.6"/>
    </filter>
    <linearGradient id="metricGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#FACC15"/>
      <stop offset="100%" stop-color="#F59E0B"/>
    </linearGradient>
  </defs>
  <rect x="16" y="16" width="${width - 32}" height="${height - 32}" rx="28" fill="#090D16" fill-opacity="0.94" stroke="#FACC15" stroke-width="4" filter="url(#shadow)"/>
  <!-- Tag Pill -->
  <rect x="44" y="44" width="160" height="34" rx="17" fill="#FACC15" fill-opacity="0.2"/>
  <text x="124" y="66" fill="#FACC15" font-family="Montserrat, Impact, sans-serif" font-size="16" font-weight="900" text-anchor="middle" letter-spacing="0.1em">${tag.toUpperCase()}</text>
  <!-- Huge Metric Counter -->
  <text x="44" y="180" fill="url(#metricGrad)" font-family="Montserrat, Arial Black, sans-serif" font-size="92" font-weight="950" letter-spacing="-0.04em">${metricValue}</text>
  <!-- Metric Subtitle / Context -->
  <text x="44" y="235" fill="#FFFFFF" font-family="Inter, -apple-system, sans-serif" font-size="26" font-weight="800">${title}</text>
  <text x="44" y="265" fill="#94A3B8" font-family="Inter, -apple-system, sans-serif" font-size="18" font-weight="600">${metricLabel}</text>
</svg>`.trim();
      return { svg, width, height, defaultYOffset: 160 };
    }

    case "vox-explainer": {
      const width = 860;
      const height = 260;
      const svg = `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="voxShadow" x="0" y="0" width="${width}" height="${height}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
      <feDropShadow dx="0" dy="16" stdDeviation="24" flood-color="#000000" flood-opacity="0.75"/>
    </filter>
  </defs>
  <rect x="20" y="20" width="${width - 40}" height="${height - 40}" rx="24" fill="#0B0F17" fill-opacity="0.95" stroke="${accent}" stroke-width="2.5" filter="url(#voxShadow)"/>
  <!-- Left Accent Bar -->
  <rect x="20" y="20" width="12" height="${height - 40}" rx="6" fill="${accent}"/>
  <!-- Category Tag -->
  <rect x="56" y="48" width="140" height="30" rx="6" fill="${accent}" fill-opacity="0.25"/>
  <text x="126" y="68" fill="${accent}" font-family="Inter, sans-serif" font-size="14" font-weight="800" text-anchor="middle" letter-spacing="0.08em">${tag.toUpperCase()}</text>
  <!-- Main Bold Heading -->
  <text x="56" y="128" fill="#F8FAFC" font-family="Inter, -apple-system, sans-serif" font-size="34" font-weight="850">${title}</text>
  <!-- Supporting Subtitle -->
  ${subtitle ? `<text x="56" y="172" fill="#94A3B8" font-family="Inter, sans-serif" font-size="20" font-weight="500">${subtitle}</text>` : ""}
  <!-- Proven Badge footer -->
  <circle cx="68" cy="${height - 56}" r="6" fill="${accent}"/>
  <text x="84" y="${height - 51}" fill="#64748B" font-family="Inter, sans-serif" font-size="14" font-weight="600">180 SOCIAL STUDIO • VERIFIED INSIGHT</text>
</svg>`.trim();
      return { svg, width, height, defaultYOffset: 140 };
    }

    case "saas-callout": {
      const width = 680;
      const height = 190;
      const svg = `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="saasGlass" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1E293B" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="#0F172A" stop-opacity="0.95"/>
    </linearGradient>
  </defs>
  <rect x="12" y="12" width="${width - 24}" height="${height - 24}" rx="22" fill="url(#saasGlass)" stroke="${accent}" stroke-width="2" stroke-opacity="0.8"/>
  <circle cx="56" cy="${height / 2}" r="24" fill="${accent}" fill-opacity="0.2"/>
  <path d="M46 ${height / 2}L53 ${height / 2 + 7}L66 ${height / 2 - 6}" stroke="${accent}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="96" y="${height / 2 - 4}" fill="#FFFFFF" font-family="Inter, sans-serif" font-size="26" font-weight="750">${title}</text>
  <text x="96" y="${height / 2 + 26}" fill="#94A3B8" font-family="Inter, sans-serif" font-size="17" font-weight="500">${subtitle || "Automated Workflow Optimization"}</text>
</svg>`.trim();
      return { svg, width, height, defaultYOffset: 120 };
    }

    case "quote-reveal": {
      const width = 800;
      const height = 220;
      const svg = `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="16" y="16" width="${width - 32}" height="${height - 32}" rx="24" fill="#0A0F1D" fill-opacity="0.94" stroke="#475569" stroke-width="2"/>
  <!-- Decorative Quotation Mark -->
  <text x="48" y="80" fill="${accent}" font-family="Georgia, serif" font-size="72" font-weight="900" fill-opacity="0.5">“</text>
  <text x="96" y="78" fill="#F1F5F9" font-family="Inter, -apple-system, sans-serif" font-size="28" font-weight="700">${title}</text>
  ${subtitle ? `<text x="96" y="120" fill="#CBD5E1" font-family="Inter, sans-serif" font-size="20" font-weight="500">${subtitle}</text>` : ""}
  <text x="96" y="165" fill="${accent}" font-family="Inter, sans-serif" font-size="16" font-weight="700" letter-spacing="0.05em">— ${tag}</text>
</svg>`.trim();
      return { svg, width, height, defaultYOffset: 150 };
    }

    case "split-comparison":
    default: {
      const width = 820;
      const height = 240;
      const svg = `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="16" y="16" width="${width - 32}" height="${height - 32}" rx="24" fill="#0B1120" fill-opacity="0.95" stroke="#334155" stroke-width="2"/>
  <!-- Left Side: Old Way -->
  <rect x="36" y="36" width="350" height="${height - 72}" rx="16" fill="#1E293B" fill-opacity="0.6"/>
  <text x="56" y="76" fill="#EF4444" font-family="Inter, sans-serif" font-size="16" font-weight="800">❌ THE OLD WAY</text>
  <text x="56" y="116" fill="#94A3B8" font-family="Inter, sans-serif" font-size="20" font-weight="600">${subtitle || "Manual tedious editing"}</text>
  <!-- Right Side: 180 Studio Way -->
  <rect x="424" y="36" width="360" height="${height - 72}" rx="16" fill="#059669" fill-opacity="0.18" stroke="#10B981" stroke-width="2"/>
  <text x="444" y="76" fill="#10B981" font-family="Inter, sans-serif" font-size="16" font-weight="800">✨ 180 STUDIO WAY</text>
  <text x="444" y="116" fill="#ECFDF5" font-family="Inter, sans-serif" font-size="20" font-weight="750">${title}</text>
</svg>`.trim();
      return { svg, width, height, defaultYOffset: 140 };
    }
  }
}

