import type { ZodType } from 'zod';
import { jsonrepair } from 'jsonrepair';
import { AgentRole, AutopilotError, AutopilotLLM, UsageMeter } from './llm';

export interface JsonAgentCall<T> {
    llm: AutopilotLLM;
    role: AgentRole;
    system: string;
    prompt: string;
    schema: ZodType<T>;
    maxTokens: number;
    meter?: UsageMeter;
    /** Optional hook to normalize/repair raw data before schema validation. */
    normalize?: (raw: any, opts?: { attempt: number }) => any;
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
export function extractJson(text: string): unknown {
    const trimmed = (text || '').trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1].trim() : trimmed;

    // Fast-path: direct parse
    try {
        return JSON.parse(candidate);
    } catch {
        // Fall through
    }

    // Isolate JSON starting from first [ or {
    let jsonTarget = candidate;
    const firstBracket = candidate.search(/[[{]/);
    if (firstBracket !== -1 && !candidate.startsWith('{') && !candidate.startsWith('[')) {
        jsonTarget = candidate.slice(firstBracket);
    }

    // Try direct parse of targeted JSON
    try {
        return JSON.parse(jsonTarget);
    } catch {
        // Fall through
    }

    // Try jsonrepair on jsonTarget
    try {
        const repaired = jsonrepair(jsonTarget);
        return JSON.parse(repaired);
    } catch {
        // Fall through
    }

    // Handle unterminated / truncated JSON
    const start = jsonTarget.search(/[[{]/);
    if (start === -1) throw new Error('no JSON found in reply');
    const open = jsonTarget[start];
    const close = open === '{' ? '}' : ']';
    const end = jsonTarget.lastIndexOf(close);
    if (end > start) {
        const sliced = jsonTarget.slice(start, end + 1);
        try {
            return JSON.parse(sliced);
        } catch {
            try {
                return JSON.parse(jsonrepair(sliced));
            } catch {
                // fall through
            }
        }
    }

    // If sliced to last safe boundary (closing brace or comma of array item)
    const lastComma = jsonTarget.lastIndexOf(',');
    const lastBrace = jsonTarget.lastIndexOf('}');
    const cutPoint = Math.max(lastComma, lastBrace);
    if (cutPoint > 0) {
        try {
            const cut = jsonTarget.slice(0, cutPoint + (cutPoint === lastBrace ? 1 : 0));
            return JSON.parse(jsonrepair(cut));
        } catch {
            // fall through
        }
    }

    throw new Error('unterminated JSON in reply');
}

export interface ValidationResult<T> {
    ok: boolean;
    value?: T;
    errors: string[];
    schemaPassedData?: T;
}

function validate<T>(
    text: string,
    schema: ZodType<T>,
    check?: (v: T) => string[],
    normalize?: (raw: any, opts?: { attempt: number }) => any,
    attempt: number = 1,
): ValidationResult<T> {
    let raw: unknown;
    try {
        raw = extractJson(text);
    } catch (e: any) {
        return { ok: false, errors: [`Reply was not valid JSON: ${e?.message || e}`] };
    }

    if (normalize) {
        try {
            raw = normalize(raw, { attempt });
        } catch (normErr: any) {
            // If normalization fails, proceed with raw to let zod provide path errors
        }
    }

    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        const errors = parsed.error.issues.slice(0, 20).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
        return { ok: false, errors };
    }
    const problems = check ? check(parsed.data) : [];
    if (problems.length) {
        return { ok: false, errors: problems.slice(0, 20), schemaPassedData: parsed.data };
    }
    return { ok: true, value: parsed.data, errors: [] };
}

export async function runJsonAgent<T>(call: JsonAgentCall<T>): Promise<JsonAgentResult<T>> {
    const first = await call.llm.complete({ role: call.role, system: call.system, prompt: call.prompt, maxTokens: call.maxTokens });
    call.meter?.record(call.role, first.usage);
    const v1 = validate(first.text, call.schema, call.check, call.normalize, 1);
    if (v1.ok && v1.value !== undefined) return { value: v1.value, repaired: false };
    const errors1 = v1.errors;

    call.log?.('agent_repair', { role: call.role, errors: errors1 });
    const repairPrompt = [
        call.prompt,
        '',
        'YOUR PREVIOUS REPLY WAS REJECTED. Specific errors:',
        ...errors1.map((e) => `- ${e}`),
        '',
        'Return the corrected, complete JSON only. No prose, no markdown fences.',
    ].join('\n');
    const second = await call.llm.complete({ role: call.role, system: call.system, prompt: repairPrompt, maxTokens: call.maxTokens });
    call.meter?.record(call.role, second.usage);
    const v2 = validate(second.text, call.schema, call.check, call.normalize, 2);
    if (v2.ok && v2.value !== undefined) return { value: v2.value, repaired: true };

    // Recovery path 1: Attempt 2 matched schema, only check heuristics reported warnings (if allowed)
    if (call.tolerateCheckOnRepair && v2.schemaPassedData !== undefined) {
        call.log?.('agent_repaired_with_warnings', { role: call.role, warnings: v2.errors });
        return { value: v2.schemaPassedData, repaired: true };
    }

    // Recovery path 2: Attempt 1 had valid schema data (only check heuristics had warnings) and attempt 2 failed
    if (call.tolerateCheckOnRepair && v1.schemaPassedData !== undefined) {
        call.log?.('agent_fallback_v1_schema_data', { role: call.role, v2Errors: v2.errors, v1Warnings: v1.errors });
        return { value: v1.schemaPassedData, repaired: true };
    }

    throw new AutopilotError('AI_INVALID_OUTPUT', `The ${call.role} agent returned invalid output twice`, { errors: v2.errors });
}
