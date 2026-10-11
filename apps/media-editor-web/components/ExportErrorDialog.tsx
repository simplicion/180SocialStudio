"use client";

import React from "react";
import { AlertTriangle, RefreshCw, X } from "lucide-react";

export interface ExportFailure {
  message: string;
  /** true = the export was refused on purpose (it would have lost audio); false = it failed while running. */
  blocked: boolean;
  settings: { format: string; resolution: string; fps: number };
}

/** Export failure with a retry and a second way forward (desktop app download, or copying the details). */
export function ExportErrorDialog({
  failure,
  onRetry,
  onClose,
}: {
  failure: ExportFailure;
  onRetry: () => void;
  onClose: () => void;
}) {
  const copyDetails = () => {
    void navigator.clipboard?.writeText(failure.message).catch(() => undefined);
  };
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="export-error-title" aria-describedby="export-error-body"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950 p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 id="export-error-title" className="text-base font-semibold text-white">
              {failure.blocked ? "This export can't run here" : "The export failed"}
            </h2>
            <p id="export-error-body" className="mt-2 text-sm leading-relaxed text-zinc-300">{failure.message}</p>
          </div>
          <button aria-label="Close" onClick={onClose} className="-m-2 flex h-11 w-11 items-center justify-center rounded-xl text-zinc-400 hover:bg-white/5">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button onClick={copyDetails} className="min-h-[44px] rounded-xl px-4 text-sm text-zinc-200 hover:bg-white/5">
            Copy error details
          </button>
          <button onClick={onRetry}
            className="flex min-h-[44px] items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-black hover:bg-zinc-200">
            <RefreshCw className="h-4 w-4" /> {failure.blocked ? "I changed it, export again" : "Try again"}
          </button>
        </div>
      </div>
    </div>
  );
}
