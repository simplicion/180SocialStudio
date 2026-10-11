import { SLOP_DATA as slopLexicon } from './data/slop.data';

export interface HumanizerHit {
  type: 'invisible' | 'typographic' | 'lexical' | 'structural';
  name: string;
  count: number;
  replacement?: string;
}

export interface HumanizerResult {
  originalText: string;
  cleanedText: string;
  hits: HumanizerHit[];
  totalCleaned: number;
}

export interface DetectionCheck {
  name: string;
  humanScore: number; // 0 - 100
  detail: string;
  status: 'PASS' | 'WARN' | 'FAIL';
}

export interface AiDetectionReport {
  overallScore: number; // 0 - 100 (higher = more human)
  verdict: 'HUMAN' | 'SLIGHT_AI_PATTERNS' | 'HEAVY_AI_SLOP';
  checks: DetectionCheck[];
  recommendations: string[];
}

const URL_RE = /(?:https?:\/\/\S+|www\.\S+|\S+@\S+\.\S+)/g;
const SENT_RE = /[^.!?\n]+[.!?]*/g;
const WORD_RE = /[A-Za-z']+/g;
const CONTRACTIONS = /\b\w+'(?:s|t|re|ve|ll|d|m)\b/gi;
const PRONOUNS = /\b(i|me|my|mine|we|us|our|you|your)\b/gi;
const NUMBERS = /(?:\b\d[\d,.]*%?\b|\$\d)/g;
const PROPER = /(?<![.!?]\s)(?<!^)\b[A-Z][a-z]{2,}\b/g;

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

function scaleScore(val: number, human: number, machine: number): number {
  if (human === machine) return 50.0;
  return clamp(((val - machine) / (human - machine)) * 100);
}

export interface HumanizeOptions {
  /** 'all' (default) normalises every typographic tell; 'dashes' only em/en dashes, keeping quotes, bullets and arrows. */
  typographic?: 'all' | 'dashes' | 'none';
  /** Replace stock AI words/phrases (default true). Turn off when the caller only wants to flag them. */
  lexical?: boolean;
}

const DASHES = new Set(['—', '–']);

export class TextHumanizer {
  /**
   * Run 3 passes of cleansing: Invisible -> Typographic -> Lexical
   */
  public static humanize(rawText: string, options: HumanizeOptions = {}): HumanizerResult {
    const typographicMode = options.typographic || 'all';
    const lexical = options.lexical !== false;
    let text = rawText;
    const hits: HumanizerHit[] = [];

    // Protect URLs with placeholders
    const urls: string[] = [];
    text = text.replace(URL_RE, match => {
      urls.push(match);
      return `\u0000URL_${urls.length - 1}\u0000`;
    });

    // Pass 1: Invisible Characters
    for (const entry of slopLexicon.invisible || []) {
      const cpStr = entry.cp;
      let regex: RegExp;
      if (cpStr.includes('-')) {
        const [startHex, endHex] = cpStr.split('-');
        const start = parseInt(startHex.replace('U+', ''), 16);
        const end = parseInt(endHex.replace('U+', ''), 16);
        regex = new RegExp(`[\\u{${start.toString(16)}}-\\u{${end.toString(16)}}]`, 'gu');
      } else {
        const code = parseInt(cpStr.replace('U+', ''), 16);
        regex = new RegExp(`\\u{${code.toString(16)}}`, 'gu');
      }

      const matchCount = (text.match(regex) || []).length;
      if (matchCount > 0) {
        hits.push({
          type: 'invisible',
          name: `${entry.cp} ${entry.name}`,
          count: matchCount
        });
        text = text.replace(regex, entry.action === 'delete' ? '' : ' ');
      }
    }

    // Pass 2: Typographic (Em dash, curly quotes, ellipsis)
    for (const entry of typographicMode === 'none' ? [] : slopLexicon.typographic || []) {
      if (typographicMode === 'dashes' && !DASHES.has(entry.from)) continue;
      const fromChar = entry.from;
      const toChar = entry.to;
      const count = (text.split(fromChar).length - 1);
      if (count > 0) {
        hits.push({
          type: 'typographic',
          name: `Typographic '${fromChar}' -> '${toChar}'`,
          count,
          replacement: toChar
        });
        // Swallow the spaces around a dash so "a — b" becomes "a, b" rather than "a ,  b".
        text = DASHES.has(fromChar)
          ? text.replace(new RegExp(`[ \\t]*${fromChar}[ \\t]*`, 'g'), toChar.trim() === ',' ? ', ' : toChar)
          : text.split(fromChar).join(toChar);
      }
    }

    // Pass 3: Lexical slop replacement
    const allLexEntries = lexical ? [...(slopLexicon.words || []), ...(slopLexicon.phrases || [])] : [];
    for (const entry of allLexEntries) {
      const escaped = entry.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
      const pattern = new RegExp(`\\b${escaped}\\b`, 'gi');
      const matches = text.match(pattern);
      if (matches && matches.length > 0) {
        hits.push({
          type: 'lexical',
          name: `Slop: "${entry.find}" -> "${entry.replace}"`,
          count: matches.length,
          replacement: entry.replace
        });

        // Replace while preserving basic capitalization
        text = text.replace(pattern, matchedWord => {
          if (matchedWord[0] === matchedWord[0].toUpperCase()) {
            return entry.replace.charAt(0).toUpperCase() + entry.replace.slice(1);
          }
          return entry.replace;
        });
      }
    }

    // Restore protected URLs
    urls.forEach((url, i) => {
      text = text.replace(`\u0000URL_${i}\u0000`, url);
    });

    const totalCleaned = hits.reduce((acc, h) => acc + h.count, 0);

    return {
      originalText: rawText,
      cleanedText: text,
      hits,
      totalCleaned
    };
  }

  /** Stock AI words/phrases present in the text, without changing it (for "rewrite this line" feedback). */
  public static findSlop(text: string): string[] {
    const found: string[] = [];
    for (const entry of [...(slopLexicon.words || []), ...(slopLexicon.phrases || [])]) {
      const escaped = entry.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
      if (new RegExp(`\\b${escaped}\\b`, 'i').test(text)) found.push(entry.find);
    }
    return found;
  }

  /**
   * 5-factor AI detector panel
   */
  public static detect(text: string): AiDetectionReport {
    const rawSentences = (text.match(SENT_RE) || [])
      .map(s => s.trim())
      .filter(s => s.split(/\s+/).length > 2);
    const words = text.match(WORD_RE) || [];
    const wordCount = words.length;

    const checks: DetectionCheck[] = [];

    // 1. Burstiness (Sentence length variation)
    if (rawSentences.length < 4) {
      checks.push({
        name: 'BURSTINESS',
        humanScore: 50,
        detail: 'Sample too brief for sentence variance test',
        status: 'WARN'
      });
    } else {
      const lengths = rawSentences.map(s => s.split(/\s+/).length);
      const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
      const variance = lengths.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / lengths.length;
      const stdDev = Math.sqrt(variance);
      const cv = mean > 0 ? stdDev / mean : 0;
      const burstScore = Math.round(scaleScore(cv, 0.70, 0.22));

      checks.push({
        name: 'BURSTINESS',
        humanScore: burstScore,
        detail: `Sentence length variance CV: ${cv.toFixed(2)} across ${rawSentences.length} sentences (target: >0.55)`,
        status: burstScore >= 70 ? 'PASS' : burstScore >= 45 ? 'WARN' : 'FAIL'
      });
    }

    // 2. Specificity (Density of concrete numbers, proper nouns)
    if (wordCount < 20) {
      checks.push({
        name: 'SPECIFICITY',
        humanScore: 50,
        detail: 'Text too short to judge concreteness',
        status: 'WARN'
      });
    } else {
      const numbersCount = (text.match(NUMBERS) || []).length;
      const properCount = new Set(text.match(PROPER) || []).size;
      const concreteHits = numbersCount + properCount;
      const density = (concreteHits / wordCount) * 100;
      const specScore = Math.round(scaleScore(density, 6.0, 0.5));

      checks.push({
        name: 'SPECIFICITY',
        humanScore: specScore,
        detail: `${concreteHits} concrete markers (${density.toFixed(1)} per 100 words; target: >4.0)`,
        status: specScore >= 65 ? 'PASS' : specScore >= 40 ? 'WARN' : 'FAIL'
      });
    }

    // 3. Slop Density (Stock buzzwords from lexicon)
    if (wordCount === 0) {
      checks.push({
        name: 'SLOP_DENSITY',
        humanScore: 50,
        detail: 'Empty text',
        status: 'WARN'
      });
    } else {
      let slopHits = 0;
      const allLex = [...(slopLexicon.words || []), ...(slopLexicon.phrases || [])];
      for (const entry of allLex) {
        const escaped = entry.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
        const pattern = new RegExp(`\\b${escaped}\\b`, 'gi');
        const m = text.match(pattern);
        if (m) slopHits += m.length;
      }
      const slopDensity = (slopHits / wordCount) * 100;
      const slopScore = Math.round(scaleScore(slopDensity, 0.0, 4.0));

      checks.push({
        name: 'SLOP_DENSITY',
        humanScore: slopScore,
        detail: `${slopHits} buzzword markers detected (${slopDensity.toFixed(1)}% density)`,
        status: slopScore >= 75 ? 'PASS' : slopScore >= 50 ? 'WARN' : 'FAIL'
      });
    }

    // 4. Fingerprint (Invisible chars + em dashes + typical formatting tells)
    let fingerprintPenalties = 0;
    if (/—/.test(text)) fingerprintPenalties += 25; // Em dash
    if (/[\u200B-\u200D\uFEFF\u00AD]/.test(text)) fingerprintPenalties += 40; // Hidden Unicode tags
    if (/\b(not only .+? but also|it's not just .+?, it's)\b/i.test(text)) fingerprintPenalties += 20;

    const fingerprintScore = Math.max(0, 100 - fingerprintPenalties);
    checks.push({
      name: 'TYPOGRAPHIC_FINGERPRINT',
      humanScore: fingerprintScore,
      detail: fingerprintPenalties === 0
        ? 'Clean typography, no AI syntax tells'
        : `Detected ${fingerprintPenalties} penalty points (e.g. em dashes, synthetic dualisms)`,
      status: fingerprintScore >= 75 ? 'PASS' : fingerprintScore >= 50 ? 'WARN' : 'FAIL'
    });

    // 5. Voice (Contractions and Pronouns)
    const contractionsCount = (text.match(CONTRACTIONS) || []).length;
    const pronounCount = (text.match(PRONOUNS) || []).length;
    const voiceMarkers = contractionsCount + pronounCount;
    const voiceDensity = wordCount > 0 ? (voiceMarkers / wordCount) * 100 : 0;
    const voiceScore = Math.round(scaleScore(voiceDensity, 8.0, 1.5));

    checks.push({
      name: 'VOICE_AND_CONVERSATION',
      humanScore: voiceScore,
      detail: `${contractionsCount} contractions, ${pronounCount} personal pronouns (${voiceDensity.toFixed(1)}% density)`,
      status: voiceScore >= 65 ? 'PASS' : voiceScore >= 40 ? 'WARN' : 'FAIL'
    });

    // Composite Human Score
    const overallScore = Math.round(
      checks.reduce((acc, c) => acc + c.humanScore, 0) / checks.length
    );

    let verdict: AiDetectionReport['verdict'] = 'HEAVY_AI_SLOP';
    if (overallScore >= 75) verdict = 'HUMAN';
    else if (overallScore >= 55) verdict = 'SLIGHT_AI_PATTERNS';

    const recommendations: string[] = [];
    if (checks.find(c => c.name === 'BURSTINESS')?.status !== 'PASS') {
      recommendations.push('Vary sentence rhythms: mix 3-word punchy statements with longer narrative lines.');
    }
    if (checks.find(c => c.name === 'SPECIFICITY')?.status !== 'PASS') {
      recommendations.push('Ground claims in verifiable numbers, costs, or named tools instead of generalizations.');
    }
    if (checks.find(c => c.name === 'SLOP_DENSITY')?.status !== 'PASS') {
      recommendations.push('Run Humanizer to swap mechanical buzzwords with plain-spoken vocabulary.');
    }
    if (checks.find(c => c.name === 'VOICE_AND_CONVERSATION')?.status !== 'PASS') {
      recommendations.push('Speak directly to the audience: use contractions ("don\'t", "it\'s") and "you/I".');
    }

    return {
      overallScore,
      verdict,
      checks,
      recommendations
    };
  }
}
