import { EventEmitter } from "events";
import * as os from "os";
import crypto from "crypto";

export type JobPriority = "high" | "normal" | "low";
export type JobType = "render" | "ingest" | "transcribe" | "auto-clip";
export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface QueueJob<T = any> {
  id: string;
  type: JobType;
  priority: JobPriority;
  status: JobStatus;
  progress: number;
  data?: any;
  result?: T;
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  execute: (updateProgress: (p: number) => void) => Promise<T>;
}

export interface JobTicket {
  jobId: string;
  status: JobStatus;
  position: number;
  estimatedWaitSeconds: number;
}

export class ProductionRenderQueue extends EventEmitter {
  private static instance: ProductionRenderQueue | null = null;

  private queue: QueueJob[] = [];
  private activeJobs = new Map<string, QueueJob>();
  private completedJobs = new Map<string, QueueJob>();
  private maxConcurrent: number;

  constructor(maxConcurrent?: number) {
    super();
    // Default to min(4, CPU cores) to prevent OOM when under high simultaneous load
    const cpuCount = os.cpus().length || 4;
    this.maxConcurrent = maxConcurrent || Math.max(2, Math.min(4, Math.floor(cpuCount / 2)));

    // Background sweep every 10 minutes to prune old completed jobs
    setInterval(() => this.pruneOldJobs(), 10 * 60 * 1000).unref();
  }

  static getInstance(): ProductionRenderQueue {
    if (!this.instance) {
      this.instance = new ProductionRenderQueue();
    }
    return this.instance;
  }

  /**
   * Enqueues a heavy operation with sub-millisecond ticket return.
   * Hundreds of concurrent requests can hit this with zero latency.
   */
  enqueue<T = any>(
    type: JobType,
    execute: (updateProgress: (p: number) => void) => Promise<T>,
    options: { priority?: JobPriority; data?: any } = {}
  ): JobTicket {
    const id = `job_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`;
    const job: QueueJob<T> = {
      id,
      type,
      priority: options.priority || "normal",
      status: "queued",
      progress: 0,
      data: options.data,
      createdAt: Date.now(),
      execute,
    };

    if (job.priority === "high") {
      // High priority jumps ahead of normal/low
      const insertIdx = this.queue.findIndex((j) => j.priority !== "high");
      if (insertIdx === -1) this.queue.push(job);
      else this.queue.splice(insertIdx, 0, job);
    } else {
      this.queue.push(job);
    }

    const position = this.queue.indexOf(job) + 1;
    const estimatedWaitSeconds = Math.max(0, (position - 1) * 3);

    this.emit("jobEnqueued", { jobId: id, type, position });
    process.nextTick(() => this.processNext());

    return {
      jobId: id,
      status: "queued",
      position,
      estimatedWaitSeconds,
    };
  }

  /**
   * Dispatches pending jobs up to maxConcurrent workers.
   */
  private async processNext(): Promise<void> {
    if (this.activeJobs.size >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    const job = this.queue.shift();
    if (!job) return;

    job.status = "running";
    job.startedAt = Date.now();
    this.activeJobs.set(job.id, job);

    this.emit("jobStarted", { jobId: job.id, type: job.type });

    const updateProgress = (p: number) => {
      job.progress = Math.min(100, Math.max(0, p));
      this.emit("jobProgress", { jobId: job.id, progress: job.progress });
    };

    try {
      const result = await job.execute(updateProgress);
      job.status = "completed";
      job.progress = 100;
      job.result = result;
      job.completedAt = Date.now();
      this.emit("jobCompleted", { jobId: job.id, result });
    } catch (err: any) {
      job.status = "failed";
      job.error = err?.message || String(err);
      job.completedAt = Date.now();
      this.emit("jobFailed", { jobId: job.id, error: job.error });
    } finally {
      this.activeJobs.delete(job.id);
      this.completedJobs.set(job.id, job);
      // Immediately check for next queued item
      this.processNext();
    }
  }

  getJob(jobId: string): QueueJob | undefined {
    return (
      this.activeJobs.get(jobId) ||
      this.completedJobs.get(jobId) ||
      this.queue.find((j) => j.id === jobId)
    );
  }

  cancelJob(jobId: string): boolean {
    const queueIdx = this.queue.findIndex((j) => j.id === jobId);
    if (queueIdx !== -1) {
      const [removed] = this.queue.splice(queueIdx, 1);
      removed.status = "cancelled";
      this.completedJobs.set(removed.id, removed);
      this.emit("jobCancelled", { jobId });
      return true;
    }
    return false;
  }

  getStats(): { queued: number; active: number; completed: number; maxConcurrent: number } {
    return {
      queued: this.queue.length,
      active: this.activeJobs.size,
      completed: this.completedJobs.size,
      maxConcurrent: this.maxConcurrent,
    };
  }

  private pruneOldJobs(): void {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    for (const [id, job] of this.completedJobs.entries()) {
      if ((job.completedAt || 0) < oneHourAgo) {
        this.completedJobs.delete(id);
      }
    }
  }
}

