/**
 * Deterministic comment / DM triage into the six buckets of the /ig-reply workflow. It only classifies and says
 * what kind of response the bucket deserves; it never writes the reply (replies come from the engagement AI
 * agent with the account's real offer, or from the human).
 */
export const COMMENT_BUCKETS = ['KEYWORD', 'LEAD', 'QUESTION', 'SUBSTANCE', 'SUPPORT', 'NOISE'] as const;
export type CommentBucket = (typeof COMMENT_BUCKETS)[number];

export interface TriageInput { id: string; author: string; text: string }
export interface TriagedComment extends TriageInput { bucket: CommentBucket; nextStep: string; contentIdea: boolean }

const NEXT_STEP: Record<CommentBucket, string> = {
    KEYWORD: 'Deliver the promised asset by DM now.',
    LEAD: 'Answer in public, then continue in DM. This person is asking to buy.',
    QUESTION: 'Answer fully in the thread; repeated questions are your next post.',
    SUBSTANCE: 'Reply with a real point; long threads lift the post.',
    SUPPORT: 'Like and acknowledge briefly.',
    NOISE: 'Hide or ignore.',
};

const NOISE_RE = /\b(crypto|forex|telegram|whatsapp me|dm to promote|promote it on|check my (bio|page|profile)|earn \$?\d+|investment plan|sugar (daddy|mommy))\b/i;
const LEAD_RE = /\b(price|pricing|cost|how much|rates?|quote|hire|book(ing)?|available|work with you|your services?|do you (offer|do|take)|can you (help|do|build|make)|interested|sign ?up|buy|purchase|demo)\b/i;
const QUESTION_RE = /\?|^(how|why|what|when|where|which|who|can|does|do|is|are|should)\b/i;
const SUBSTANCE_RE = /\b(actually|in my experience|we found|i found|disagree|agree but|the problem is|what worked|we tried|i tried)\b/i;

export function triageComment(c: TriageInput, keywords: string[] = []): TriagedComment {
    const text = (c.text || '').trim();
    const words = text.split(/\s+/).filter(Boolean);
    let bucket: CommentBucket = 'SUPPORT';
    if (NOISE_RE.test(text)) bucket = 'NOISE';
    else if (keywords.some((k) => k.trim() && text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').trim() === k.trim().toLowerCase())) bucket = 'KEYWORD';
    else if (LEAD_RE.test(text)) bucket = 'LEAD';
    else if (QUESTION_RE.test(text) && words.length >= 3) bucket = 'QUESTION';
    else if (words.length >= 15 || SUBSTANCE_RE.test(text)) bucket = 'SUBSTANCE';
    else if (!/[\p{L}\p{N}]/u.test(text)) bucket = 'SUPPORT';
    return { ...c, bucket, nextStep: NEXT_STEP[bucket], contentIdea: bucket === 'QUESTION' };
}

export function triageComments(comments: TriageInput[], keywords: string[] = []) {
    const triaged = comments.map((c) => triageComment(c, keywords));
    const bucketCounts = Object.fromEntries(COMMENT_BUCKETS.map((b) => [b, 0])) as Record<CommentBucket, number>;
    for (const t of triaged) bucketCounts[t.bucket] += 1;
    const order = (b: CommentBucket) => COMMENT_BUCKETS.indexOf(b);
    return { triaged: triaged.sort((a, b) => order(a.bucket) - order(b.bucket)), bucketCounts, contentIdeas: triaged.filter((t) => t.contentIdea) };
}
