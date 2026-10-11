export interface BeatRow {
  index: number;
  timecode: string;
  startSec: number;
  durationSec: number;
  wordCount: number;
  text: string;
  isConcrete: boolean;
  flags: string[];
}

export interface BeatSheetAnalysis {
  beats: BeatRow[];
  totalSeconds: number;
  totalWords: number;
  estimatedWpm: number;
  hookDurationSec: number;
  flags: string[];
  passed: boolean;
  loopDetected: boolean;
  loopWord?: string;
  summary: {
    hookStatus: 'PASS' | 'WARN' | 'FAIL';
    pacingStatus: 'PASS' | 'WARN' | 'FAIL';
    concretenessStatus: 'PASS' | 'WARN' | 'FAIL';
  };
}

const WORD_RE = /[A-Za-z0-9$%'’-]+/g;
const SENT_RE = /[^.!?]+[.!?]*/g;
const CONCRETE_RE = /(?:\$\s?\d|\b\d[\d,.]*\b|(?<!^)\b[A-Z][a-z]{2,}\b)/;

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'for',
  'with', 'that', 'this', 'it', 'is', 'are', 'was', 'were', 'be', 'been',
  'you', 'your', 'i', 'my', 'me', 'we', 'our', 'they', 'them', 'he', 'she',
  'so', 'just', 'not', 'no', 'do', 'did', 'does', 'have', 'has', 'had',
  'will', 'can', 'at', 'as', 'by', 'from', 'out', 'up', 'off', 'one', 'all'
]);

const HOOK_WINDOW = 3.0;
const MAX_BEAT = 4.0;
const ABSTRACT_RUN_LIMIT = 3;

function getWords(text: string): string[] {
  const normalized = text.replace(/(?<=\d),(?=\d)/g, '');
  const matches = normalized.match(WORD_RE);
  return matches || [];
}

function formatTimecode(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
}

export class BeatSheetLinter {
  public static splitBeats(raw: string, wps: number): string[] {
    const beats: string[] = [];
    const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    for (const line of lines) {
      const wordsCount = getWords(line).length;
      if (wordsCount / wps <= MAX_BEAT * 1.5) {
        beats.push(line);
        continue;
      }

      // Sentence splitting for overly long lines
      const parts = line.match(SENT_RE)?.map(p => p.trim()).filter(Boolean) || [line];
      let buf = '';
      for (const part of parts) {
        const candidate = (buf ? `${buf} ${part}` : part).trim();
        if (buf && getWords(candidate).length / wps > MAX_BEAT) {
          beats.push(buf);
          buf = part;
        } else {
          buf = candidate;
        }
      }
      if (buf) {
        beats.push(buf);
      }
    }
    return beats;
  }

  public static analyze(raw: string, options: { wpm?: number; targetSeconds?: number } = {}): BeatSheetAnalysis {
    const wpm = options.wpm || 165;
    const wps = wpm / 60.0;
    const beatsRaw = this.splitBeats(raw, wps);

    const rows: BeatRow[] = [];
    let clock = 0.0;
    const overallFlags: string[] = [];

    let consecutiveAbstract = 0;

    for (let i = 0; i < beatsRaw.length; i++) {
      const text = beatsRaw[i];
      const words = getWords(text);
      const n = words.length;
      const dur = n / wps;
      const startSec = Math.round(clock * 10) / 10;
      const durationSec = Math.round(dur * 10) / 10;
      const isConcrete = CONCRETE_RE.test(text);
      const beatFlags: string[] = [];

      // Hook window check (Beat 1)
      if (i === 0 && dur > HOOK_WINDOW) {
        const flag = `Hook runs ${dur.toFixed(1)}s (target is <${HOOK_WINDOW}s). The thumb will swipe away before the claim lands.`;
        beatFlags.push(flag);
        overallFlags.push(flag);
      }

      // Beat duration stall
      if (dur > MAX_BEAT) {
        const flag = `Beat stalls for ${dur.toFixed(1)}s with no frame/pacing change (limit is ${MAX_BEAT}s).`;
        beatFlags.push(flag);
        overallFlags.push(flag);
      }

      // Abstract run tracking
      if (!isConcrete) {
        consecutiveAbstract++;
        if (consecutiveAbstract >= ABSTRACT_RUN_LIMIT) {
          const flag = `${consecutiveAbstract} abstract beats with no concrete facts, numbers, or actions.`;
          beatFlags.push(flag);
          overallFlags.push(flag);
        }
      } else {
        consecutiveAbstract = 0;
      }

      rows.push({
        index: i + 1,
        timecode: formatTimecode(startSec),
        startSec,
        durationSec,
        wordCount: n,
        text,
        isConcrete,
        flags: beatFlags
      });

      clock += dur;
    }

    const totalSeconds = Math.round(clock * 10) / 10;
    const totalWords = rows.reduce((acc, r) => acc + r.wordCount, 0);
    const hookDurationSec = rows[0]?.durationSec || 0;

    // Target duration check
    if (options.targetSeconds) {
      const diff = Math.abs(totalSeconds - options.targetSeconds);
      if (diff > options.targetSeconds * 0.25) {
        overallFlags.push(`Script runs ${totalSeconds}s vs target of ${options.targetSeconds}s.`);
      }
    }

    // Loop check: check if the last line repeats a significant word from the hook
    let loopDetected = false;
    let loopWord: string | undefined;
    if (rows.length > 1) {
      const hookWords = new Set(
        getWords(rows[0].text)
          .map(w => w.toLowerCase())
          .filter(w => !STOPWORDS.has(w) && w.length > 3)
      );
      const lastLineWords = getWords(rows[rows.length - 1].text).map(w => w.toLowerCase());
      for (const lw of lastLineWords) {
        if (hookWords.has(lw)) {
          loopDetected = true;
          loopWord = lw;
          break;
        }
      }
    }

    if (!loopDetected && rows.length > 2) {
      overallFlags.push('No loop echo detected. End on a word echoing the hook so the replay loop is seamless.');
    }

    const hookStatus = hookDurationSec <= HOOK_WINDOW ? 'PASS' : 'FAIL';
    const pacingStatus = rows.some(r => r.durationSec > MAX_BEAT) ? 'WARN' : 'PASS';
    const concretenessStatus = consecutiveAbstract >= ABSTRACT_RUN_LIMIT ? 'WARN' : 'PASS';

    return {
      beats: rows,
      totalSeconds,
      totalWords,
      estimatedWpm: wpm,
      hookDurationSec,
      flags: overallFlags,
      passed: overallFlags.length === 0,
      loopDetected,
      loopWord,
      summary: {
        hookStatus,
        pacingStatus,
        concretenessStatus
      }
    };
  }
}
