import React from "react";
import {
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  X,
  Flame,
  Wand2,
  ArrowRight,
  TrendingUp,
  Clock,
  Scissors,
  Volume2,
  Zap,
} from "lucide-react";
import {
  EditIR,
  EditCommand,
  VideoCriticService,
  VideoCritiqueReport,
  QualityIssue,
} from "@workspace/video-contracts";

interface AICriticDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  editIR: EditIR;
  onApplyRepairs: (repairs: EditCommand[]) => void;
  onExecutePrompt?: (prompt: string) => void;
}

export const AICriticDrawer: React.FC<AICriticDrawerProps> = ({
  isOpen,
  onClose,
  editIR,
  onApplyRepairs,
  onExecutePrompt,
}) => {
  if (!isOpen) return null;

  const report: VideoCritiqueReport = VideoCriticService.analyze(editIR);

  return (
    <div className="h-full w-full bg-[#0A0A0D] flex flex-col select-none">
      {/* Drawer Header */}
      <div className="p-4 border-b border-[#1C1C22] flex items-center justify-between bg-[#08080A]">
        <div className="flex items-center space-x-2 text-pink-400">
          <Sparkles className="w-4 h-4" />
          <div>
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">Critic & Retention QA</h3>
            <p className="text-[10px] text-zinc-400">Pacing & viewer retention analyzer</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-[#16161C] transition"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Retention Score Cards */}
      <div className="p-4 overflow-y-auto flex-1 space-y-4">
        <div className="p-4 rounded-2xl bg-gradient-to-br from-pink-500/10 via-purple-500/10 to-indigo-500/10 border border-pink-500/30 flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold text-pink-400 uppercase tracking-wider block mb-0.5">
              Predicted Retention
            </span>
            <p className="text-3xl font-black text-white">{report.retentionPrediction}%</p>
            <p className="text-[11px] text-zinc-400 mt-1 flex items-center space-x-1">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              <span>Pacing Score: {report.overallScore}/100</span>
            </p>
          </div>

          <div className="w-14 h-14 rounded-full bg-[#08080A] border border-pink-500/40 flex items-center justify-center font-black text-lg text-pink-300 shadow-lg shadow-pink-500/20">
            {report.overallScore >= 80 ? "A+" : report.overallScore >= 60 ? "B" : "C"}
          </div>
        </div>

        {/* Auto Repair CTA */}
        {report.recommendedRepairs.length > 0 && (
          <div className="p-3.5 rounded-xl bg-[#0E0E12] border border-[#1C1C22] flex items-center justify-between">
            <div className="text-xs">
              <p className="font-semibold text-zinc-200">
                {report.recommendedRepairs.length} Automated Fixes Ready
              </p>
              <p className="text-[10px] text-zinc-400">Injects missing zooms & repairs pacing</p>
            </div>
            <button
              onClick={() => onApplyRepairs(report.recommendedRepairs)}
              className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-pink-500 to-indigo-500 text-white font-bold text-xs shadow-md shadow-pink-500/20 flex items-center space-x-1 hover:from-pink-600 hover:to-indigo-600 transition"
            >
              <Wand2 className="w-3 h-3" />
              <span>Auto-Fix</span>
            </button>
          </div>
        )}

        {/* Quick Intelligence Actions */}
        {onExecutePrompt && (
          <div className="space-y-2">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">
              Quick AI Director Enhancements
            </span>
            <div className="grid grid-cols-1 gap-2">
              <button
                onClick={() => onExecutePrompt("Clean all filler words, ums, uhs, and false starts")}
                className="p-2.5 rounded-xl bg-[#111114] hover:bg-[#181822] border border-[#1C1C22] hover:border-indigo-500/50 text-left transition flex items-center space-x-2.5 group"
              >
                <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 group-hover:bg-indigo-500/20">
                  <Scissors className="w-3.5 h-3.5" />
                </div>
                <div>
                  <p className="text-xs font-bold text-zinc-200">Clean Vocal Fillers & Ums</p>
                  <p className="text-[10px] text-zinc-400">Ripple-cut awkward speech stumbles</p>
                </div>
              </button>

              <button
                onClick={() => onExecutePrompt("Add auto sound design, whooshes on zooms and pop sound effects")}
                className="p-2.5 rounded-xl bg-[#111114] hover:bg-[#181822] border border-[#1C1C22] hover:border-emerald-500/50 text-left transition flex items-center space-x-2.5 group"
              >
                <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 group-hover:bg-emerald-500/20">
                  <Volume2 className="w-3.5 h-3.5" />
                </div>
                <div>
                  <p className="text-xs font-bold text-zinc-200">Auto Sound Design (SFX)</p>
                  <p className="text-[10px] text-zinc-400">Inject whooshes & kinetic pop transients</p>
                </div>
              </button>

              <button
                onClick={() => onExecutePrompt("Turn this into a 30 second viral hook teaser for Instagram Reels")}
                className="p-2.5 rounded-xl bg-[#111114] hover:bg-[#181822] border border-[#1C1C22] hover:border-amber-500/50 text-left transition flex items-center space-x-2.5 group"
              >
                <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 group-hover:bg-amber-500/20">
                  <Zap className="w-3.5 h-3.5" />
                </div>
                <div>
                  <p className="text-xs font-bold text-zinc-200">Extract 30s Hook Teaser</p>
                  <p className="text-[10px] text-zinc-400">Condense to highest-retention moments</p>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* Diagnostic Issues List */}
        <div className="space-y-2.5">
          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">
            Pacing & Retention Diagnostics ({report.issues.length})
          </span>

          {report.issues.length === 0 ? (
            <div className="p-5 text-center border border-dashed border-emerald-500/30 rounded-xl bg-emerald-500/5">
              <CheckCircle2 className="w-6 h-6 text-emerald-400 mx-auto mb-1.5" />
              <p className="text-xs font-bold text-zinc-200">Timeline Optimized!</p>
              <p className="text-[10px] text-zinc-400 mt-0.5">Zero dead air or jarring cuts detected.</p>
            </div>
          ) : (
            report.issues.map((issue: QualityIssue) => (
              <div
                key={issue.id}
                className="p-3 rounded-xl bg-[#0E0E12] border border-[#1C1C22] space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                      issue.severity === "CRITICAL"
                        ? "bg-red-500/20 text-red-300 border border-red-500/40"
                        : issue.severity === "WARNING"
                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                        : "bg-blue-500/20 text-blue-300 border border-blue-500/40"
                    }`}
                  >
                    {issue.category} • {issue.severity}
                  </span>
                  <span className="text-[10px] font-mono text-zinc-500 flex items-center space-x-0.5">
                    <Clock className="w-2.5 h-2.5" />
                    <span>{issue.timeRangeSec.start.toFixed(1)}s</span>
                  </span>
                </div>

                <h4 className="text-xs font-bold text-zinc-200">{issue.title}</h4>
                <p className="text-[11px] text-zinc-400 leading-relaxed">{issue.description}</p>

                {issue.suggestedAction && (
                  <div className="pt-1 text-[10px] text-pink-300 font-medium flex items-center space-x-1">
                    <ArrowRight className="w-3 h-3 shrink-0" />
                    <span>Suggestion: {issue.suggestedAction}</span>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
