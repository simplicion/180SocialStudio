import { CaptionSegment, RationalTimeMath } from "@workspace/video-contracts";

export class AssSubtitleGenerator {
  static generate(
    captions: CaptionSegment[],
    options: { preset?: string; fontSize?: number; resolution?: { width: number; height: number } } = {}
  ): string {
    return this.generateAss(captions, options.resolution || { width: 1920, height: 1080 });
  }

  /**
   * Converts standard CSS hex colors (#RRGGBB) to ASS color format (&H00BBGGRR&).
   */
  private static hexToAssBgr(hex: string, defaultBgr = "&H0000FFFF&"): string {
    if (!hex) return defaultBgr;
    const clean = hex.replace("#", "").trim();
    if (clean.length === 6) {
      const r = clean.substring(0, 2);
      const g = clean.substring(2, 4);
      const b = clean.substring(4, 6);
      return `&H00${b}${g}${r}&`;
    }
    return defaultBgr;
  }

  /**
   * Generates a complete, compliant Advanced SubStation Alpha (.ass v4.00+) script
   * with karaoke word timing, bounce popups, safe-zone margins, and high-retention styling.
   */
  static generateAss(
    captions: CaptionSegment[],
    resolution: { width: number; height: number } = { width: 1920, height: 1080 }
  ): string {
    const lines: string[] = [];
    const isVertical = resolution.height > resolution.width;
    const marginV = isVertical ? Math.round(resolution.height * 0.235) : 70;
    const fontSize = isVertical ? Math.max(42, Math.round(resolution.width * 0.062)) : 52;
    const outlineSize = isVertical ? 5 : 4;

    // 1. Script Info Header
    lines.push("[Script Info]");
    lines.push("Title: 180 Workspace Autonomous Kinetic Subtitles");
    lines.push("ScriptType: v4.00+");
    lines.push("WrapStyle: 0");
    lines.push("ScaledBorderAndShadow: yes");
    lines.push(`PlayResX: ${resolution.width}`);
    lines.push(`PlayResY: ${resolution.height}`);
    lines.push("");

    // 2. V4+ Styles Definition
    lines.push("[V4+ Styles]");
    lines.push("Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding");
    
    // Hormozi Heavy (Crisp White text, Deep Black 5px outline & 4px shadow for maximum legibility on scrubs)
    lines.push(`Style: HormoziBounce,Arial Black,${fontSize},&H00FFFFFF,&H0000FFFF,&H00000000,&HB0000000,-1,0,0,0,100,100,0,0,1,${outlineSize},4,2,30,30,${marginV},1`);
    // Ali Abdaal Clean (Refined White with subtle 3px outline)
    lines.push(`Style: AbdaalClean,Arial Black,${Math.round(fontSize * 0.88)},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,3,2,30,30,${marginV},1`);
    // Neon Punch (Vibrant Cyan text with pure black border)
    lines.push(`Style: NeonPunch,Arial Black,${fontSize},&H00FFFF00,&H00FFFF00,&H00000000,&HB0000000,-1,0,0,0,100,100,0,0,1,${outlineSize},4,2,30,30,${marginV},1`);
    lines.push("");

    // 3. Dialogue Events
    lines.push("[Events]");
    lines.push("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text");

    captions.forEach((cap) => {
      const startSec = RationalTimeMath.toSeconds(cap.timeRange.start);
      const endSec = startSec + RationalTimeMath.toSeconds(cap.timeRange.duration);

      const startTimeStr = this.formatAssTime(startSec);
      const endTimeStr = this.formatAssTime(endSec);

      const styleName =
        cap.style?.preset === "ALI_ABDAAL_CLEAN"
          ? "AbdaalClean"
          : cap.style?.preset === "BOLD_CENTER"
          ? "NeonPunch"
          : "HormoziBounce";

      let dialogueText = "";

      if (cap.words && cap.words.length > 0) {
        // Build Karaoke string with word timings & dynamic highlight scale
        dialogueText = cap.words
          .map((w) => {
            const wStart = RationalTimeMath.toSeconds(w.start);
            const wEnd = RationalTimeMath.toSeconds(w.end);
            const durationCs = Math.max(1, Math.round((wEnd - wStart) * 100)); // Centiseconds

            const highlightColor = this.hexToAssBgr(w.color || cap.style?.highlightColor || "#FFE600");
            const normalColor = this.hexToAssBgr(cap.style?.textColor || "#FFFFFF", "&H00FFFFFF&");
            const highlightTag = w.highlight
              ? `{\\c${highlightColor}\\fscx124\\fscy124\\bord${outlineSize + 1}}`
              : `{\\c${normalColor}\\fscx100\\fscy100}`;
            return `{\\k${durationCs}}${highlightTag}${w.word}{\\r}`;
          })
          .join(" ");
      } else {
        dialogueText = cap.text;
      }

      lines.push(`Dialogue: 0,${startTimeStr},${endTimeStr},${styleName},,0,0,0,,${dialogueText}`);
    });

    return lines.join("\n");
  }

  private static formatAssTime(seconds: number): string {
    const totalCs = Math.floor(seconds * 100);
    const cs = totalCs % 100;
    const s = Math.floor(seconds) % 60;
    const m = Math.floor(seconds / 60) % 60;
    const h = Math.floor(seconds / 3600);

    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
  }
}

