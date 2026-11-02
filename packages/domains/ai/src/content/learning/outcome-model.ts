/**
 * Small, dependency-free outcome modelling used to learn from real post performance:
 *   - outlier labels relative to each project's OWN median (never across accounts, same rule as competitor radar)
 *   - categorical lift tables (which hook types / jobs / formats over-perform, with sample sizes)
 *   - L2 logistic regression with k-fold cross-validated AUC
 *
 * Used offline by the corpus analysis script and at runtime by calibration (reaction simulator). A model is only
 * worth using when its cross-validated AUC beats the baseline; callers must check that, this module reports it.
 */

export interface OutcomeSample {
    /** Grouping key for the "own median" baseline, e.g. `${projectId}:${platform}`. */
    group: string;
    /** Raw performance value (views, or likes+comments when views are unavailable). */
    value: number;
    categorical: Record<string, string | null | undefined>;
    numeric: Record<string, number | null | undefined>;
}

export interface LabelledSample extends OutcomeSample {
    multiple: number;
    /** Top quartile of its own group. */
    top: boolean;
}

export const median = (xs: number[]): number => {
    if (!xs.length) return 0;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function quantile(xs: number[], q: number): number {
    const s = [...xs].sort((a, b) => a - b);
    if (!s.length) return 0;
    const pos = (s.length - 1) * q;
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** Labels every sample against its own group; groups smaller than `minGroup` are dropped (no stable median). */
export function labelAgainstOwnBaseline(samples: OutcomeSample[], minGroup = 5): LabelledSample[] {
    const groups = new Map<string, OutcomeSample[]>();
    for (const s of samples) {
        if (!Number.isFinite(s.value) || s.value < 0) continue;
        (groups.get(s.group) || groups.set(s.group, []).get(s.group)!).push(s);
    }
    const out: LabelledSample[] = [];
    for (const g of groups.values()) {
        if (g.length < minGroup) continue;
        const values = g.map((s) => s.value);
        const med = median(values);
        const q3 = quantile(values, 0.75);
        for (const s of g) out.push({ ...s, multiple: med > 0 ? s.value / med : 0, top: s.value >= q3 && s.value > med });
    }
    return out;
}

export interface LiftRow { feature: string; value: string; n: number; topRate: number; meanMultiple: number; lift: number }

/** Per categorical value: share of top-quartile posts vs the overall share. Rows below `minN` are omitted. */
export function liftTable(samples: LabelledSample[], minN = 8): LiftRow[] {
    if (!samples.length) return [];
    const baseRate = samples.filter((s) => s.top).length / samples.length;
    const buckets = new Map<string, LabelledSample[]>();
    for (const s of samples) {
        for (const [feature, v] of Object.entries(s.categorical)) {
            if (v === null || v === undefined || v === '') continue;
            const k = `${feature}\u0000${v}`;
            (buckets.get(k) || buckets.set(k, []).get(k)!).push(s);
        }
    }
    const rows: LiftRow[] = [];
    for (const [k, b] of buckets) {
        if (b.length < minN) continue;
        const [feature, value] = k.split('\u0000');
        const topRate = b.filter((s) => s.top).length / b.length;
        rows.push({ feature, value, n: b.length, topRate: round(topRate, 3), meanMultiple: round(b.reduce((a, s) => a + s.multiple, 0) / b.length, 2), lift: round(baseRate ? topRate / baseRate : 0, 2) });
    }
    return rows.sort((a, b) => a.feature.localeCompare(b.feature) || b.lift - a.lift);
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

// ------------------------------------------------------------------ features

export interface FeatureSpace { categorical: Record<string, string[]>; numeric: string[]; means: Record<string, number>; stds: Record<string, number> }

export function buildFeatureSpace(samples: OutcomeSample[], minCount = 5): FeatureSpace {
    const cat: Record<string, Map<string, number>> = {};
    const numeric = new Set<string>();
    for (const s of samples) {
        for (const [f, v] of Object.entries(s.categorical)) if (v) (cat[f] ||= new Map()).set(v, ((cat[f].get(v) || 0) + 1));
        for (const [f, v] of Object.entries(s.numeric)) if (typeof v === 'number' && Number.isFinite(v)) numeric.add(f);
    }
    const categorical: Record<string, string[]> = {};
    for (const [f, m] of Object.entries(cat)) categorical[f] = [...m].filter(([, n]) => n >= minCount).map(([v]) => v).sort();
    const means: Record<string, number> = {}, stds: Record<string, number> = {};
    for (const f of numeric) {
        const xs = samples.map((s) => s.numeric[f]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
        const m = xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
        means[f] = m;
        stds[f] = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length || 1)) || 1;
    }
    return { categorical, numeric: [...numeric].sort(), means, stds };
}

export function featureNames(space: FeatureSpace): string[] {
    return [...space.numeric, ...Object.entries(space.categorical).flatMap(([f, vs]) => vs.map((v) => `${f}=${v}`))];
}

export function vectorize(s: OutcomeSample, space: FeatureSpace): number[] {
    const x: number[] = [];
    for (const f of space.numeric) {
        const v = s.numeric[f];
        // Missing numeric values sit at the mean (0 after standardising).
        x.push(typeof v === 'number' && Number.isFinite(v) ? (v - space.means[f]) / space.stds[f] : 0);
    }
    for (const [f, vs] of Object.entries(space.categorical)) for (const v of vs) x.push(s.categorical[f] === v ? 1 : 0);
    return x;
}

// ------------------------------------------------------------------ logistic regression

export interface LogisticModel { weights: number[]; bias: number; names: string[] }

const sigmoid = (z: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));

export function trainLogistic(X: number[][], y: number[], names: string[], opts: { l2?: number; epochs?: number; lr?: number } = {}): LogisticModel {
    const l2 = opts.l2 ?? 0.5, epochs = opts.epochs ?? 400, lr = opts.lr ?? 0.1;
    const d = names.length, n = X.length;
    const w = new Array(d).fill(0);
    let b = Math.log((y.filter(Boolean).length + 1) / (n - y.filter(Boolean).length + 1));
    for (let e = 0; e < epochs; e++) {
        const gw = new Array(d).fill(0);
        let gb = 0;
        for (let i = 0; i < n; i++) {
            let z = b;
            for (let j = 0; j < d; j++) z += w[j] * X[i][j];
            const err = sigmoid(z) - y[i];
            gb += err;
            for (let j = 0; j < d; j++) gw[j] += err * X[i][j];
        }
        b -= (lr * gb) / n;
        for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / n + (l2 * w[j]) / n);
    }
    return { weights: w, bias: b, names };
}

export function predict(m: LogisticModel, x: number[]): number {
    let z = m.bias;
    for (let j = 0; j < m.weights.length; j++) z += m.weights[j] * x[j];
    return sigmoid(z);
}

/** Area under the ROC curve (Mann-Whitney), ties counted as half. Returns 0.5 when one class is missing. */
export function auc(scores: number[], labels: number[]): number {
    const pos = scores.filter((_, i) => labels[i] === 1), neg = scores.filter((_, i) => labels[i] === 0);
    if (!pos.length || !neg.length) return 0.5;
    let wins = 0;
    for (const p of pos) for (const q of neg) wins += p > q ? 1 : p === q ? 0.5 : 0;
    return wins / (pos.length * neg.length);
}

/** Deterministic k-fold AUC (folds by index modulo k). */
export function crossValidatedAuc(samples: LabelledSample[], space: FeatureSpace, k = 5): number {
    const names = featureNames(space);
    const X = samples.map((s) => vectorize(s, space));
    const y = samples.map((s) => (s.top ? 1 : 0));
    const scores = new Array(samples.length).fill(0);
    for (let f = 0; f < k; f++) {
        const trainIdx = samples.map((_, i) => i).filter((i) => i % k !== f);
        const testIdx = samples.map((_, i) => i).filter((i) => i % k === f);
        if (!testIdx.length) continue;
        const m = trainLogistic(trainIdx.map((i) => X[i]), trainIdx.map((i) => y[i]), names);
        for (const i of testIdx) scores[i] = predict(m, X[i]);
    }
    return round(auc(scores, y), 3);
}

/** AUC of a single numeric feature used directly as the score (e.g. the HookScorer total), for comparison. */
export function singleFeatureAuc(samples: LabelledSample[], feature: string): number {
    const idx = samples.map((s, i) => [s.numeric[feature], i] as const).filter(([v]) => typeof v === 'number' && Number.isFinite(v));
    return round(auc(idx.map(([v]) => v as number), idx.map(([, i]) => (samples[i].top ? 1 : 0))), 3);
}
