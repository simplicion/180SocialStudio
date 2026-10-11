"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BraveSearchProvider = exports.TavilySearchProvider = void 0;
exports.createWebSearchProviderFromEnv = createWebSearchProviderFromEnv;
exports.runResearchAgent = runResearchAgent;
const json_agent_1 = require("./json-agent");
const schemas_1 = require("./schemas");
const video_contracts_1 = require("@workspace/video-contracts");
class TavilySearchProvider {
    apiKey;
    fetchImpl;
    name = 'tavily';
    constructor(apiKey, fetchImpl = globalThis.fetch) {
        this.apiKey = apiKey;
        this.fetchImpl = fetchImpl;
        if (!apiKey)
            throw new Error('TavilySearchProvider requires an API key');
    }
    async search(query, opts = {}) {
        const res = await this.fetchImpl('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
            body: JSON.stringify({
                query,
                max_results: opts.maxResults ?? 5,
                search_depth: 'basic',
                topic: 'news',
                days: opts.recencyDays ?? 30,
            }),
        });
        if (!res.ok)
            throw new Error(`Tavily search failed with HTTP ${res.status}`);
        const body = await res.json();
        return (body?.results || [])
            .filter((r) => typeof r?.url === 'string' && /^https?:\/\//.test(r.url))
            .map((r) => ({ title: String(r.title || ''), url: r.url, snippet: String(r.content || '').slice(0, 500), publishedAt: r.published_date }));
    }
}
exports.TavilySearchProvider = TavilySearchProvider;
class BraveSearchProvider {
    apiKey;
    fetchImpl;
    name = 'brave';
    constructor(apiKey, fetchImpl = globalThis.fetch) {
        this.apiKey = apiKey;
        this.fetchImpl = fetchImpl;
        if (!apiKey)
            throw new Error('BraveSearchProvider requires an API key');
    }
    async search(query, opts = {}) {
        const freshness = (opts.recencyDays ?? 30) <= 7 ? 'pw' : 'pm';
        const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${opts.maxResults ?? 5}&freshness=${freshness}`;
        const res = await this.fetchImpl(url, { headers: { Accept: 'application/json', 'X-Subscription-Token': this.apiKey } });
        if (!res.ok)
            throw new Error(`Brave search failed with HTTP ${res.status}`);
        const body = await res.json();
        return (body?.web?.results || [])
            .filter((r) => typeof r?.url === 'string' && /^https?:\/\//.test(r.url))
            .map((r) => ({ title: String(r.title || ''), url: r.url, snippet: String(r.description || '').replace(/<[^>]+>/g, '').slice(0, 500), publishedAt: r.age }));
    }
}
exports.BraveSearchProvider = BraveSearchProvider;
/** Returns the configured provider, or null when no search key is set (research is then skipped). */
function createWebSearchProviderFromEnv(env = process.env) {
    if (env.TAVILY_API_KEY)
        return new TavilySearchProvider(env.TAVILY_API_KEY);
    if (env.BRAVE_SEARCH_API_KEY)
        return new BraveSearchProvider(env.BRAVE_SEARCH_API_KEY);
    return null;
}
async function runResearchAgent(params) {
    if (!params.search)
        return { researchUsed: false };
    const year = new Date().getUTCFullYear();
    const queries = [
        `${params.industry} trends ${year}`,
        `${params.industry} news this month`,
        `what ${params.audience} are talking about ${params.industry}`,
    ];
    let results = [];
    try {
        const batches = await Promise.all(queries.map((q) => params.search.search(q, { maxResults: 5, recencyDays: 30 })));
        const seen = new Set();
        for (const r of batches.flat()) {
            if (seen.has(r.url))
                continue;
            seen.add(r.url);
            results.push(r);
        }
        results = results.slice(0, 12);
    }
    catch (err) {
        return { researchUsed: false, provider: params.search.name, error: `search failed: ${err?.message || err}` };
    }
    if (!results.length)
        return { researchUsed: false, provider: params.search.name, error: 'search returned no results' };
    const allowed = new Set(results.map((r) => r.url));
    const { value } = await (0, json_agent_1.runJsonAgent)({
        llm: params.llm,
        role: 'research',
        meter: params.meter,
        maxTokens: 1500,
        schema: schemas_1.ResearchDigestSchema,
        system: `You are a social media trend researcher. You only use the search results given to you and cite them by exact URL. ${video_contracts_1.UNTRUSTED_DATA_POLICY}`,
        prompt: [
            `Industry: ${params.industry}`,
            `Audience: ${params.audience}`,
            `Brand positioning: ${params.positioning}`,
            '',
            'Search results (title | url | snippet), fenced as untrusted web data:',
            // Web pages can contain prompt injection: titles/snippets are neutralised and fenced; URLs are only
            // ever used as citations and checked against this exact list.
            (0, video_contracts_1.fenceUntrusted)('research', results.map((r) => `- ${(0, video_contracts_1.sanitizeInlineUntrusted)(r.title, 200)} | ${r.url} | ${(0, video_contracts_1.sanitizeInlineUntrusted)(r.snippet, 600)}`).join('\n'), { maxChars: 12000 }).block,
            '',
            'Pick up to 6 current topics this brand could credibly post about. Every sourceUrls entry MUST be one of the URLs above.',
            'Return JSON: {"trends":[{"topic":"...","whyNow":"...","sourceUrls":["https://..."]}]}',
        ].join('\n'),
        check: (d) => d.trends.flatMap((t) => t.sourceUrls.filter((u) => !allowed.has(u)).map((u) => `sourceUrls contains a URL that was not in the search results: ${u}`)),
    });
    return { researchUsed: value.trends.length > 0, provider: params.search.name, digest: value };
}
