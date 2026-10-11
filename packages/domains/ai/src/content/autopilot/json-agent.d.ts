import type { ZodType } from 'zod';
import { AgentRole, AutopilotLLM, UsageMeter } from './llm';
export interface JsonAgentCall<T> {
    llm: AutopilotLLM;
    role: AgentRole;
    system: string;
    prompt: string;
    schema: ZodType<T>;
    maxTokens: number;
    meter?: UsageMeter;
    /** Optional hook to normalize/repair raw data before schema validation. */
    normalize?: (raw: any, opts?: {
        attempt: number;
    }) => any;
    /** Extra semantic checks after schema validation; return a list of problems (empty = ok). */
    check?: (value: T) => string[];
    /** If true, soft semantic check warnings on attempt 2 are logged as warnings rather than throwing AI_INVALID_OUTPUT (as long as schema validation passed). */
    tolerateCheckOnRepair?: boolean;
    log?: (event: string, data: Record<string, unknown>) => void;
}
export interface JsonAgentResult<T> {
    value: T;
    repaired: boolean;
}
/** Pulls and repairs the first JSON object/array out of a model reply (tolerates ```json fences, trailing commas, truncated outputs, and leading prose). */
export declare function extractJson(text: string): unknown;
export interface ValidationResult<T> {
    ok: boolean;
    value?: T;
    errors: string[];
    schemaPassedData?: T;
}
export declare function runJsonAgent<T>(call: JsonAgentCall<T>): Promise<JsonAgentResult<T>>;
