import React from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";

export interface QualityIssueItem {
  id: string;
  /** critical | warning | info (any case; CRITICAL/WARNING/SUGGESTION from the server critic are accepted) */
  severity: string;
  title: string;
  timeRangeMs?: [number, number];
}

interface Props {
  heading: string;
  /** 0..100 when the source gives a score */
  score?: number;
  issues: QualityIssueItem[];
  /** Checks that could not run (shown so "no issues" is never overstated). */
  unavailable?: string[];
  /** Clicking an issue with a time range seeks the playhead there. */
  onSeekMs?: (ms: number) => void;
  emptyText?: string;
  children?: React.ReactNode;
}

const tone = (severity: string) => {
  const s = severity.toLowerCase();
  if (s === "critical" || s === "error") return { Icon: XCircle, cls: "text-red-300" };
  if (s === "warning") return { Icon: AlertTriangle, cls: "text-amber-300" };
  return { Icon: Info, cls: "text-slate-400" };
};

const fmt = (ms: number) => {
  const s = ms / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
};

/** Issues from the post-export QA or the AI Director's critic; items with a time range seek the timeline. */
export const QualityIssuesList: React.FC<Props> = ({ heading, score, issues, unavailable, onSeekMs, emptyText, children }) => (
  <section className="p-3 rounded-xl bg-[#0E1118] border border-[#222838] space-y-2" aria-live="polite">
    <div className="flex items-center justify-between">
      <h4 className="text-[11px] font-semibold text-slate-200">{heading}</h4>
      {score != null && <span className="font-mono text-[11px] text-slate-300">{Math.round(score)}/100</span>}
    </div>
    {issues.length === 0 ? (
      <p className="flex items-center gap-1.5 text-[11px] text-emerald-300">
        <CheckCircle2 className="w-3.5 h-3.5" /> {emptyText ?? "No issues found."}
      </p>
    ) : (
      <ul className="space-y-1" role="list">
        {issues.map((issue) => {
          const { Icon, cls } = tone(issue.severity);
          const seekable = !!issue.timeRangeMs && !!onSeekMs;
          const body = (
            <>
              <Icon className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${cls}`} />
              <span className="flex-1 text-left text-[11px] text-slate-300">{issue.title}</span>
              {issue.timeRangeMs && <span className="font-mono text-[10px] text-slate-500 shrink-0">{fmt(issue.timeRangeMs[0])}</span>}
            </>
          );
          return (
            <li key={issue.id}>
              {seekable ? (
                <button
                  type="button"
                  onClick={() => onSeekMs!(issue.timeRangeMs![0])}
                  className="w-full min-h-[44px] px-2 py-1.5 rounded-lg flex items-start gap-2 hover:bg-[#1C2230] transition"
                  title="Jump to this moment"
                >
                  {body}
                </button>
              ) : (
                <div className="px-2 py-1.5 flex items-start gap-2">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    )}
    {unavailable && unavailable.length > 0 && <p className="text-[10px] text-slate-500">Not checked: {unavailable.join("; ")}.</p>}
    {children}
  </section>
);
