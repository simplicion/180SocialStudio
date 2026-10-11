/**
 * One job model for the Media Studio's long-running work (AI Director runs, media analysis, exports, stock downloads,
 * calendar uploads), with the same states the mobile app uses:
 *
 *   QUEUED → ANALYZING → PLANNING → EDITING → RENDERING → CRITIQUING → REPAIRING → COMPLETED | FAILED | CANCELLED
 *
 * Every job carries an AbortController, so anything running can be cancelled from the jobs tray. Jobs that were still
 * running when the app closed are restored as FAILED ("interrupted") with their resume input, so the UI can offer to
 * run them again (an FFmpeg encode cannot continue half-way; "resume" re-runs it with the same settings).
 */

export const JOB_STATES = [
  "QUEUED", "ANALYZING", "PLANNING", "EDITING", "RENDERING", "CRITIQUING", "REPAIRING", "COMPLETED", "FAILED", "CANCELLED",
] as const;
export type JobState = (typeof JOB_STATES)[number];
export type JobKind = "director" | "analysis" | "export" | "download" | "attach";

export const TERMINAL_STATES: ReadonlySet<JobState> = new Set(["COMPLETED", "FAILED", "CANCELLED"]);
export const isTerminal = (s: JobState) => TERMINAL_STATES.has(s);

/** Allowed moves. Work states may repeat or step back (a repair round goes REPAIRING → PLANNING → EDITING ...). */
const WORK: JobState[] = ["ANALYZING", "PLANNING", "EDITING", "RENDERING", "CRITIQUING", "REPAIRING"];
export function canTransition(from: JobState, to: JobState): boolean {
  if (isTerminal(from)) return false;
  if (to === "QUEUED") return false;
  return from === "QUEUED" || WORK.includes(from);
}

export const JOB_STATE_LABEL: Record<JobState, string> = {
  QUEUED: "Queued",
  ANALYZING: "Analyzing",
  PLANNING: "Planning",
  EDITING: "Editing",
  RENDERING: "Rendering",
  CRITIQUING: "Checking",
  REPAIRING: "Repairing",
  COMPLETED: "Done",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

export interface StudioJob {
  id: string;
  kind: JobKind;
  label: string;
  state: JobState;
  /** 0..100 when known */
  progress?: number;
  detail?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  /** Serializable input to run the job again after an interruption (e.g. export settings). */
  resume?: Record<string, unknown>;
  interrupted?: boolean;
}

type Listener = (jobs: StudioJob[]) => void;

const STORAGE_KEY = "media-studio.jobs.v1";
const MAX_KEPT = 30;

export class StudioJobRegistry {
  private jobs = new Map<string, StudioJob>();
  private controllers = new Map<string, AbortController>();
  private listeners = new Set<Listener>();
  private seq = 0;
  private restored = false;

  constructor(private storage: Pick<Storage, "getItem" | "setItem"> | null = null, private now: () => number = () => Date.now()) {}

  /** Restores the last session's jobs; the ones that were still running become FAILED + interrupted. */
  restore(): StudioJob[] {
    // Once per app session: a remount of the Studio must not mark this session's running jobs as interrupted.
    if (!this.storage || this.restored) return [];
    this.restored = true;
    let saved: StudioJob[] = [];
    try {
      saved = JSON.parse(this.storage.getItem(STORAGE_KEY) || "[]");
    } catch {
      saved = [];
    }
    if (!Array.isArray(saved)) saved = [];
    const interrupted: StudioJob[] = [];
    for (const j of saved) {
      if (!j || typeof j.id !== "string" || !JOB_STATES.includes(j.state)) continue;
      const job: StudioJob = isTerminal(j.state)
        ? j
        : { ...j, state: "FAILED", interrupted: true, error: "Interrupted: the app closed before this finished.", updatedAt: this.now() };
      if (job.interrupted && !isTerminal(j.state)) interrupted.push(job);
      this.jobs.set(job.id, job);
    }
    this.emit();
    return interrupted;
  }

  list(): StudioJob[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id: string): StudioJob | undefined {
    return this.jobs.get(id);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.list());
    return () => this.listeners.delete(fn);
  }

  /** Creates a QUEUED job and returns it with the AbortSignal the work must honour. */
  create(kind: JobKind, label: string, resume?: Record<string, unknown>): { job: StudioJob; signal: AbortSignal } {
    const t = this.now();
    const id = `${kind}-${t.toString(36)}-${(this.seq++).toString(36)}`;
    const job: StudioJob = { id, kind, label, state: "QUEUED", createdAt: t, updatedAt: t, ...(resume ? { resume } : {}) };
    const controller = new AbortController();
    this.jobs.set(id, job);
    this.controllers.set(id, controller);
    this.prune();
    this.emit();
    return { job, signal: controller.signal };
  }

  /** Moves a job to `state` (ignored when the move is not allowed, e.g. after it was cancelled). */
  transition(id: string, state: JobState, patch: Partial<Pick<StudioJob, "progress" | "detail" | "error" | "label">> = {}): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    if (job.state !== state && !canTransition(job.state, state)) return false;
    Object.assign(job, patch, { state, updatedAt: this.now() });
    if (isTerminal(state)) this.controllers.delete(id);
    this.emit();
    return true;
  }

  /** Progress/detail within the current state. */
  update(id: string, patch: Partial<Pick<StudioJob, "progress" | "detail">>): void {
    const job = this.jobs.get(id);
    if (!job || isTerminal(job.state)) return;
    Object.assign(job, patch, { updatedAt: this.now() });
    this.emit();
  }

  complete(id: string, detail?: string) {
    return this.transition(id, "COMPLETED", { progress: 100, ...(detail ? { detail } : {}) });
  }

  fail(id: string, error: string) {
    return this.transition(id, "FAILED", { error });
  }

  /** Aborts the job's work and marks it CANCELLED. */
  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || isTerminal(job.state)) return false;
    this.controllers.get(id)?.abort();
    return this.transition(id, "CANCELLED");
  }

  isCancelled(id: string): boolean {
    return this.jobs.get(id)?.state === "CANCELLED";
  }

  dismiss(id: string) {
    const job = this.jobs.get(id);
    if (job && !isTerminal(job.state)) return;
    this.jobs.delete(id);
    this.emit();
  }

  private prune() {
    const done = this.list().filter((j) => isTerminal(j.state));
    for (const j of done.slice(MAX_KEPT)) this.jobs.delete(j.id);
  }

  private emit() {
    const list = this.list();
    if (this.storage) {
      try {
        this.storage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_KEPT)));
      } catch {
        /* storage full or blocked: jobs still work for this session */
      }
    }
    for (const fn of this.listeners) fn(list);
  }
}

/** The Studio's registry (browser storage when available). */
export const studioJobs = new StudioJobRegistry(typeof window !== "undefined" ? safeStorage() : null);

function safeStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Runs `work` as a job: FAILED on error, CANCELLED on abort, COMPLETED when it resolves (unless already terminal). */
export async function runJob<T>(
  registry: StudioJobRegistry,
  kind: JobKind,
  label: string,
  work: (ctx: { id: string; signal: AbortSignal; to: (s: JobState, detail?: string) => void; progress: (pct: number, detail?: string) => void }) => Promise<T>,
  resume?: Record<string, unknown>
): Promise<T> {
  const { job, signal } = registry.create(kind, label, resume);
  const id = job.id;
  try {
    const result = await work({
      id,
      signal,
      to: (s, detail) => void registry.transition(id, s, { ...(detail ? { detail } : {}) }),
      progress: (pct, detail) => registry.update(id, { progress: Math.max(0, Math.min(100, Math.round(pct))), ...(detail ? { detail } : {}) }),
    });
    if (!isTerminal(registry.get(id)!.state)) registry.complete(id);
    return result;
  } catch (err: any) {
    const cancelled = signal.aborted || /cancel/i.test(err?.name || "") || err?.name === "AbortError";
    if (cancelled) registry.transition(id, "CANCELLED");
    else registry.fail(id, String(err?.message || err));
    throw err;
  }
}
