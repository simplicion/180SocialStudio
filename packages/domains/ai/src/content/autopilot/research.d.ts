/**
 * Optional web research for the autopilot calendar.
 * A WebSearchProvider is chosen from env: TAVILY_API_KEY, then BRAVE_SEARCH_API_KEY, then the trend-worker's free
 * keyless search. With none of them the research stage is skipped and the job records researchUsed:false. Sources are only ever URLs that the
 * search provider actually returned; the digest agent cannot invent them (checked below).
 */
import { AutopilotLLM, UsageMeter } from './llm';
import { ResearchDigest } from './schemas';
export interface WebSearchResult {
    title: string;
    url: string;
    snippet: string;
    publishedAt?: string;
}
export interface WebSearchProvider {
    name: string;
    search(query: string, opts?: {
        maxResults?: number;
        recencyDays?: number;
    }): Promise<WebSearchResult[]>;
}
type FetchLike = (url: string, init?: any) => Promise<{
    ok: boolean;
    status: number;
    json(): Promise<any>;
    text(): Promise<string>;
}>;
export declare class TavilySearchProvider implements WebSearchProvider {
    private readonly apiKey;
    private readonly fetchImpl;
    readonly name = "tavily";
    constructor(apiKey: string, fetchImpl?: FetchLike);
    search(query: string, opts?: {
        maxResults?: number;
        recencyDays?: number;
    }): Promise<WebSearchResult[]>;
}
export declare class BraveSearchProvider implements WebSearchProvider {
    private readonly apiKey;
    private readonly fetchImpl;
    readonly name = "brave";
    constructor(apiKey: string, fetchImpl?: FetchLike);
    search(query: string, opts?: {
        maxResults?: number;
        recencyDays?: number;
    }): Promise<WebSearchResult[]>;
}
/** Returns the configured provider, or null when no search key is set (research is then skipped). */
export declare class WorkerSearchProvider implements WebSearchProvider {
    private readonly worker;
    readonly name = "open-web";
    constructor(worker: {
        search(params: { queries: string[]; days?: number; maxResults?: number }): Promise<{ results: { title: string; url: string; snippet: string; publishedAt: string | null }[] }>;
    });
    search(query: string, opts?: { maxResults?: number; recencyDays?: number }): Promise<WebSearchResult[]>;
}
export declare function createWebSearchProviderFromEnv(env?: NodeJS.ProcessEnv): WebSearchProvider | null;
export interface ResearchOutcome {
    researchUsed: boolean;
    provider?: string;
    digest?: ResearchDigest;
    error?: string;
}
export declare function runResearchAgent(params: {
    llm: AutopilotLLM;
    search: WebSearchProvider | null;
    industry: string;
    audience: string;
    positioning: string;
    meter?: UsageMeter;
}): Promise<ResearchOutcome>;
export {};
