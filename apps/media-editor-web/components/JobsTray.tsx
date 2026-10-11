import React, { useEffect, useState } from "react";
import { Loader2, RotateCcw, X } from "lucide-react";
import { JOB_STATE_LABEL, StudioJob, StudioJobRegistry, isTerminal } from "../services/studio-jobs";

interface Props {
  registry: StudioJobRegistry;
  /** Runs an interrupted job again with its saved input (e.g. an export that was cut off by closing the app). */
  onResume?: (job: StudioJob) => void;
}

const stateTone = (job: StudioJob) =>
  job.state === "FAILED" ? "text-red-300" : job.state === "CANCELLED" ? "text-slate-500" : job.state === "COMPLETED" ? "text-emerald-300" : "text-indigo-300";

/** Running and recent Studio jobs (director runs, analysis, exports, downloads, uploads) with cancel and resume. */
export const JobsTray: React.FC<Props> = ({ registry, onResume }) => {
  const [jobs, setJobs] = useState<StudioJob[]>([]);
  useEffect(() => registry.subscribe(setJobs), [registry]);

  const visible = jobs.filter((j) => !isTerminal(j.state) || j.state === "FAILED").slice(0, 5);
  if (!visible.length) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-[#222838] bg-[#0E1118] shadow-2xl" aria-live="polite">
      <div className="h-8 px-3 flex items-center border-b border-[#222838] text-[11px] font-semibold text-slate-300">Jobs</div>
      <ul className="max-h-72 overflow-y-auto">
        {visible.map((job) => (
          <li key={job.id} className="px-3 py-2 border-b border-[#141822] last:border-b-0">
            <div className="flex items-center gap-2">
              {!isTerminal(job.state) && <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-300 shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-slate-200 truncate">{job.label}</p>
                <p className={`text-[10px] ${stateTone(job)}`}>
                  {JOB_STATE_LABEL[job.state]}
                  {job.progress != null && !isTerminal(job.state) ? ` · ${job.progress}%` : ""}
                  {job.detail && !isTerminal(job.state) ? ` · ${job.detail}` : ""}
                </p>
              </div>
              {!isTerminal(job.state) ? (
                <button
                  type="button"
                  onClick={() => registry.cancel(job.id)}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-[#1C2230]"
                  title="Cancel"
                  aria-label={`Cancel ${job.label}`}
                >
                  <X className="w-4 h-4" />
                </button>
              ) : (
                <>
                  {job.interrupted && job.resume && onResume && (
                    <button
                      type="button"
                      onClick={() => {
                        registry.dismiss(job.id);
                        onResume(job);
                      }}
                      className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-indigo-300 hover:bg-[#1C2230]"
                      title="Run again"
                      aria-label={`Run ${job.label} again`}
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => registry.dismiss(job.id)}
                    className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-slate-500 hover:text-white hover:bg-[#1C2230]"
                    title="Dismiss"
                    aria-label={`Dismiss ${job.label}`}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
            {job.state === "FAILED" && job.error && (
              <p role="alert" className="mt-1 text-[10px] text-red-300/90 line-clamp-2">
                {job.error}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};
