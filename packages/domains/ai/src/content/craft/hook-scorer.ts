import { HOOKS_DATA as hooksData } from './data/hooks.data';

export interface HookScoreBreakdown {
  lengthScore: number;
  lengthDetail: string;
  concretenessScore: number;
  concretenessDetail: string;
  stakesScore: number;
  stakesDetail: string;
  frontLoadScore: number;
  frontLoadDetail: string;
  audienceScore: number;
  audienceDetail: string;
}

export interface HookEvaluation {
  hook: string;
  totalScore: number;
  grade: 'EXCELLENT' | 'STRONG' | 'MEDIOCRE' | 'WEAK' | 'FAIL';
  dealbreaker?: string;
  formulaId?: number;
  formulaName?: string;
  breakdown: HookScoreBreakdown;
  recommendations: string[];
}

const WORD_RE = /[A-Za-z0-9$%'’-]+/g;
const NUMBER_RE = /(?:\$\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?(?:%|k\b|x\b|hrs?\b|hours?\b|mins?\b|minutes?\b|days?\b|weeks?\b|months?\b|years?\b)?)/i;
const PROPER_RE = /(?<!^)\b[A-Z][a-z]{2,}\b/g;
const HASHTAG_RE = /(?:^|\s)#\w+/;
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

const SPOKEN_NUMBERS = new Set([
  'zero', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'fifteen', 'twenty', 'thirty', 'forty', 'fifty',
  'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'thousand', 'million',
  'billion', 'dozen', 'half', 'twice', 'triple'
]);

const MONEY_WORDS = new Set([
  'dollars', 'dollar', 'bucks', 'grand', 'percent', 'cents',
  'millionaire', 'billionaire', 'revenue', 'profit', 'salary', 'rent'
]);

const STAKES = new Set([
  'stop', 'never', 'wrong', 'mistake', 'mistakes', 'lost', 'lose', 'losing',
  'cost', 'costs', 'broke', 'broken', 'failed', 'failure', 'fail', 'nobody',
  'no', 'not', "don't", 'dont', "doesn't", "didn't", "can't", "won't",
  'quit', 'quitting', 'fired', 'deleted', 'delete', 'killed', 'kills', 'kill',
  'replaced', 'replaces', 'cut', 'beat', 'free', 'paid', 'charged', 'hired',
  'saved', 'first', 'banned', 'illegal', 'worst', 'hate', 'hated', 'wasted',
  'waste', 'scam', 'lie', 'lied', 'lying', 'truth', 'secret', 'hidden',
  'stole', 'stolen', 'before', 'until', 'instead', 'but', 'except', 'unless',
  'problem', 'risk', 'danger', 'warning', 'regret', 'wish', 'should', "shouldn't",
  'still', 'already', 'only', 'without', 'versus', 'vs', 'actually'
]);

const WEAK_OPENERS = [
  'so', 'ok', 'okay', 'hey', 'hi', 'hello', 'guys', 'yo', 'alright',
  'welcome', 'today', 'basically', 'honestly', 'look', 'listen', 'um',
  'just', 'let', 'lets', "let's", 'i wanted', 'i want', 'one of',
  'have you', 'did you', 'do you', 'are you', 'in this', 'in today',
  'the thing', 'a lot', 'there is', 'there are', 'this is', 'it is',
  'as a', 'when it', "if you've", 'you know'
];

const IMPERATIVES = new Set([
  'stop', 'steal', 'copy', 'delete', 'try', 'watch', 'read', 'save',
  'use', 'build', 'make', 'write', 'send', 'take', 'start', 'quit',
  'never', 'always', "don't", 'dont', 'do', 'put', 'run', 'check'
]);

function getWords(text: string): string[] {
  const normalized = text.replace(/(?<=\d),(?=\d)/g, '');
  const matches = normalized.match(WORD_RE);
  return matches || [];
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

export class HookScorer {
  private static formulas = (hooksData.hooks || []).map(h => ({
    id: h.id,
    name: h.name,
    pattern: new RegExp(h.match, 'i')
  }));

  public static classifyFormula(hook: string): { id: number; name: string } | undefined {
    for (const formula of this.formulas) {
      if (formula.pattern.test(hook)) {
        return { id: formula.id, name: formula.name };
      }
    }
    return undefined;
  }

  /**
   * Scores a hook 0-100. `spoken` (default) is a line said on camera: hashtags/emoji are dealbreakers and the
   * 3-second window caps it at 15 words. Text posts (LinkedIn/X/Facebook opening lines) pass spoken: false and
   * the platform's opening-line word budget as maxWords.
   */
  public static score(hook: string, options: { spoken?: boolean; maxWords?: number } = {}): HookEvaluation {
    const spoken = options.spoken !== false;
    const maxWords = options.maxWords ?? 15;
    const raw = hook.trim();
    const words = getWords(raw);
    const wordCount = words.length;
    const lower = raw.toLowerCase();

    // Check dealbreakers
    let dealbreaker: string | undefined;
    if (/^\s*(?:stop scrolling|don'?t scroll)/i.test(raw)) {
      dealbreaker = 'Opens with "stop scrolling". Asking for attention proves you have not earned it.';
    } else if (spoken && HASHTAG_RE.test(raw)) {
      dealbreaker = 'Hashtag in a spoken hook. Read what you wrote out loud.';
    } else if (spoken && EMOJI_RE.test(raw)) {
      dealbreaker = 'Emoji in a spoken hook. Write words you can actually speak.';
    } else if (wordCount > (spoken ? maxWords : maxWords + 10)) {
      dealbreaker = spoken
        ? `Too long to say in under three seconds (${wordCount} words; target is under 12).`
        : `Opening line is ${wordCount} words; readers decide within the first ${maxWords}.`;
    }

    // 1. Length score (target ~6-9 words, ~165 WPM = ~2.5s)
    let lengthScore = 50;
    let lengthDetail = '';
    const ideal = spoken ? 9 : Math.max(9, maxWords - 4);
    if (wordCount >= 5 && wordCount <= ideal) {
      lengthScore = 100;
      lengthDetail = `Optimal punchy length (${wordCount} words)`;
    } else if (wordCount >= 4 && wordCount <= ideal + 3) {
      lengthScore = 80;
      lengthDetail = `Good delivery length (${wordCount} words)`;
    } else if (wordCount < 4) {
      lengthScore = 40;
      lengthDetail = `Too abrupt (${wordCount} words), may lack context`;
    } else {
      lengthScore = Math.max(10, 100 - (wordCount - ideal) * 12);
      lengthDetail = `Sluggish delivery (${wordCount} words, thumb will swipe past)`;
    }

    // 2. Concreteness (numbers, money, specifics)
    let concreteHits = 0;
    if (NUMBER_RE.test(raw)) concreteHits += 2;
    for (const w of words) {
      const wLower = w.toLowerCase();
      if (SPOKEN_NUMBERS.has(wLower)) concreteHits += 1.5;
      if (MONEY_WORDS.has(wLower)) concreteHits += 2;
    }
    const properMatches = raw.match(PROPER_RE);
    if (properMatches) concreteHits += properMatches.length;

    let concretenessScore = clamp(concreteHits * 25);
    const concretenessDetail = concreteHits > 0
      ? `${concreteHits.toFixed(1)} concrete markers (numbers/metrics/proper nouns)`
      : 'Abstract claim with no checkable figure, dollar amount, or specific marker';

    // 3. Stakes (conflict, loss, pain, warning, price)
    const stakesHits = words
      .map(w => w.toLowerCase().replace(/^['’]|['’]$/g, ''))
      .filter(w => STAKES.has(w));
    const uniqueStakes = new Set(stakesHits);
    if (NUMBER_RE.test(raw) || /\$\s?\d/.test(raw)) {
      uniqueStakes.add('price_tag');
    }
    const stakesCount = uniqueStakes.size;
    const stakesScore = stakesCount === 0 ? 20 : stakesCount === 1 ? 70 : 100;
    const stakesDetail = stakesCount > 0
      ? `${stakesCount} tension/stake marker(s)`
      : 'Passive statement with low urgency/stakes';

    // 4. Front load (payload at position <= 3)
    let payloadPos = -1;
    for (let i = 0; i < words.length; i++) {
      const token = words[i].toLowerCase().replace(/^['’]|['’]$/g, '');
      if (
        STAKES.has(token) ||
        SPOKEN_NUMBERS.has(token) ||
        MONEY_WORDS.has(token) ||
        NUMBER_RE.test(words[i]) ||
        (i > 0 && PROPER_RE.test(words[i]))
      ) {
        payloadPos = i;
        break;
      }
    }

    let frontLoadBase = 30;
    let frontLoadDetail = 'No payload word in the line';
    if (payloadPos >= 0 && payloadPos <= 3) {
      frontLoadBase = 100;
      frontLoadDetail = `Payload at word ${payloadPos + 1} (front-loaded)`;
    } else if (payloadPos > 3 && payloadPos <= 6) {
      frontLoadBase = 70;
      frontLoadDetail = `Payload at word ${payloadPos + 1}, could move forward`;
    } else if (payloadPos > 6) {
      frontLoadBase = 40;
      frontLoadDetail = `Payload at word ${payloadPos + 1}, too late in delivery`;
    }

    let penalty = 0;
    const isWeakOpener = WEAK_OPENERS.some(op => lower.startsWith(op) || words[0]?.toLowerCase() === op);
    if (isWeakOpener) {
      penalty = 30;
      frontLoadDetail += '; weak opener wastes opening frame';
    }
    const frontLoadScore = clamp(frontLoadBase - penalty);

    // 5. Audience relevance (viewer address)
    let audienceScore = 35;
    let audienceDetail = 'Third person, nobody named';
    if (/\b(you|your|you're|youre|yourself)\b/i.test(lower)) {
      audienceScore = 100;
      audienceDetail = 'Speaks directly to the viewer ("you")';
    } else if (IMPERATIVES.has(words[0]?.toLowerCase() || '')) {
      audienceScore = 90;
      audienceDetail = `Imperative opener ("${words[0]}")`;
    } else if (/\b(i|my|me|we|our)\b/i.test(lower)) {
      audienceScore = 70;
      audienceDetail = 'First person confession, no viewer named';
    }

    // Weighted composite
    let totalScore = dealbreaker ? 0 : Math.round(
      lengthScore * 0.20 +
      concretenessScore * 0.25 +
      stakesScore * 0.25 +
      frontLoadScore * 0.15 +
      audienceScore * 0.15
    );

    let grade: HookEvaluation['grade'] = 'FAIL';
    if (totalScore >= 80) grade = 'EXCELLENT';
    else if (totalScore >= 65) grade = 'STRONG';
    else if (totalScore >= 50) grade = 'MEDIOCRE';
    else if (totalScore >= 35) grade = 'WEAK';

    const recommendations: string[] = [];
    if (dealbreaker) recommendations.push(dealbreaker);
    if (concretenessScore < 50) recommendations.push('Add an exact number, dollar cost, or named entity.');
    if (stakesScore < 50) recommendations.push('Inject consequence: what was lost, failed, or uncomfortable?');
    if (frontLoadScore < 60) recommendations.push('Cut the preamble: begin directly on the imperative verb or claim.');
    if (audienceScore < 60) recommendations.push('Target the viewer directly ("you") or frame as an unfiltered confession.');

    const formula = this.classifyFormula(raw);

    return {
      hook: raw,
      totalScore,
      grade,
      dealbreaker,
      formulaId: formula?.id,
      formulaName: formula?.name,
      breakdown: {
        lengthScore,
        lengthDetail,
        concretenessScore,
        concretenessDetail,
        stakesScore,
        stakesDetail,
        frontLoadScore,
        frontLoadDetail,
        audienceScore,
        audienceDetail
      },
      recommendations
    };
  }

  public static rank(hooks: string[], options: { spoken?: boolean; maxWords?: number } = {}): HookEvaluation[] {
    return hooks
      .map(h => this.score(h, options))
      .sort((a, b) => b.totalScore - a.totalScore);
  }
}
