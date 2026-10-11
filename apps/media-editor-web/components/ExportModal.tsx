import React, { useState } from "react";
import {
  X,
  Download,
  Zap,
  CheckCircle2,
  FileVideo,
  Layers,
  Archive,
  Subtitles,
  ExternalLink,
  Sliders,
  Sparkles,
  FileCode,
} from "lucide-react";
import {
  EditIR,
  OtioAdapter,
  VprojBundleSerializer,
  RationalTimeMath,
} from "@workspace/video-contracts";
import { ExportResult } from "../services/tauri-bridge";
import { QualityIssuesList } from "./QualityIssuesList";

/** Upload of the finished export to the calendar piece / post the Studio was opened from. */
export interface ExportAttachState {
  status: "uploading" | "done" | "error";
  /** 0..100 */
  progress: number;
  /** "calendar piece" | "post" */
  label: string;
  message?: string;
}

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  editIR: EditIR;
  onStartExport: (settings: { format: string; resolution: string; fps: number }) => Promise<void>;
  exportProgress: number | null;
  isExporting: boolean;
  exportedResult?: ExportResult | null;
  exportedPath?: string | null;
  onCancelExport?: () => void;
  attachState?: ExportAttachState | null;
  onRetryAttach?: () => void;
  /** Second recovery path: the user picks the exported MP4 from disk. */
  onAttachFile?: (file: File) => void;
  /** Sends the post-export QA to the AI Director as the next turn. */
  onAskDirectorFix?: () => void;
  /** Seeks the timeline (ms) from a QA issue. */
  onSeekMs?: (ms: number) => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  editIR,
  onStartExport,
  exportProgress,
  isExporting,
  exportedResult,
  exportedPath,
  onCancelExport,
  attachState,
  onRetryAttach,
  onAttachFile,
  onAskDirectorFix,
  onSeekMs,
}) => {
  const attachFileRef = React.useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<"video" | "nle" | "bundle" | "subtitles">("video");
  const [resolution, setResolution] = useState("1080p");
  const [fps, setFps] = useState(30);
  const [format, setFormat] = useState("mp4");

  if (!isOpen) return null;

  const handleExport = () => {
    onStartExport({
      format,
      resolution,
      fps,
    });
  };

  const handleDownloadFile = () => {
    if (!exportedResult) return;
    const a = document.createElement("a");
    a.href = exportedResult.blobUrl;
    a.download = exportedResult.downloadName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleExportOtio = () => {
    try {
      const otioJson = OtioAdapter.toOtioJson(editIR);
      const blob = new Blob([otioJson], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${editIR.meta.title || "timeline"}.otio`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert("Error exporting OTIO: " + err);
    }
  };

  const handleExportVproj = () => {
    try {
      const manifest = {
        manifestVersion: "1.0.0" as const,
        project: {
          id: editIR.meta.projectId,
          name: editIR.meta.title || "Project",
          folderId: null,
          aspectRatio: editIR.meta.targetAspect,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          editIR: editIR,
          mediaGraph: {
            nodes: [],
            edges: [],
            clusters: [],
          },
        },
        assets: [],
        generatedAt: new Date().toISOString(),
      };
      const vprojJson = VprojBundleSerializer.serialize(manifest as any);
      const blob = new Blob([vprojJson], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${editIR.meta.title || "project"}.180vproj`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert("Error exporting .180vproj: " + err);
    }
  };

  const handleExportSrt = () => {
    try {
      let srt = "";
      editIR.tracks.captionTrack.forEach((cap, idx) => {
        const start = RationalTimeMath.toSeconds(cap.timeRange.start);
        const dur = RationalTimeMath.toSeconds(cap.timeRange.duration);
        const end = start + dur;

        const formatTime = (sec: number) => {
          const hrs = Math.floor(sec / 3600);
          const mins = Math.floor((sec % 3600) / 60);
          const secs = Math.floor(sec % 60);
          const ms = Math.floor((sec % 1) * 1000);
          return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
        };

        srt += `${idx + 1}\n${formatTime(start)} --> ${formatTime(end)}\n${cap.text}\n\n`;
      });

      const blob = new Blob([srt || "1\n00:00:00,000 --> 00:00:02,000\nNo captions created\n\n"], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${editIR.meta.title || "subtitles"}.srt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert("Error exporting SRT: " + err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 select-none">
      <div className="w-full max-w-xl bg-[#0A0A0D] border border-[#1C1C22] rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-150">
        {/* Header */}
        <div className="p-4 border-b border-[#1C1C22] bg-[#08080A] flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <img
              src="/white-icon.svg"
              onError={(e) => {
                e.currentTarget.src = "/white icon.svg";
              }}
              alt="180"
              className="w-5 h-5 object-contain"
            />
            <div>
              <h3 className="text-sm font-semibold text-white">Export & Deliver</h3>
              <p className="text-[11px] text-zinc-400">Stream-Copy Master & NLE Timeline Adapter</p>
            </div>
          </div>
          {!isExporting && (
            <button
              onClick={onClose}
              className="text-zinc-400 hover:text-white p-1.5 rounded-lg hover:bg-[#16161C] transition"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Tab Selector */}
        {!isExporting && !exportedResult && !exportedPath && (
          <div className="flex border-b border-[#1C1C22] bg-[#08080A] px-4 pt-1">
            {[
              { id: "video", label: "Master Video", icon: FileVideo },
              { id: "nle", label: "NLE Timeline (OTIO)", icon: Layers },
              { id: "bundle", label: "Project Bundle", icon: Archive },
              { id: "subtitles", label: "Subtitles (SRT)", icon: Subtitles },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center space-x-1.5 py-2.5 px-3 border-b-2 text-xs font-semibold transition ${
                    isActive
                      ? "border-white text-white"
                      : "border-transparent text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Body */}
        <div className="p-5 space-y-4 max-h-[80vh] overflow-y-auto bg-[#0A0A0D]">
          {/* TAB 1: MASTER VIDEO */}
          {activeTab === "video" && (
            <>
              {/* Smart Stream-Copy Banner */}
              <div className="p-3 rounded-xl bg-[#0E0E12] border border-[#1C1C22] flex items-center space-x-3">
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0">
                  <Zap className="w-4 h-4" />
                </div>
                <div className="text-xs">
                  <p className="font-semibold text-emerald-300">Lossless Stream-Copy Enabled</p>
                  <p className="text-zinc-400 text-[11px] leading-relaxed">
                    Untouched video segments bypass re-encoding and render at &gt;500 FPS with master source fidelity.
                  </p>
                </div>
              </div>

              {!isExporting && !exportedResult && !exportedPath && (
                <div className="space-y-4">
                  {/* Resolution Setting */}
                  <div>
                    <label className="text-xs font-semibold text-zinc-200 block mb-2">
                      Export Resolution
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { id: "1080p", label: "1080p (Full HD)", tag: "Recommended" },
                        { id: "4K", label: "4K (Ultra HD)", tag: "Crisp Master" },
                        { id: "720p", label: "720p (Standard)", tag: "Fast Render" },
                        { id: "9:16", label: "Vertical 1080x1920", tag: "Shorts / TikTok" },
                      ].map((res) => (
                        <button
                          key={res.id}
                          onClick={() => setResolution(res.id)}
                          className={`p-3 rounded-xl border text-left transition ${
                            resolution === res.id
                              ? "bg-[#181822] border-zinc-500 text-white shadow-sm"
                              : "bg-[#111114] border-[#1C1C22] text-zinc-400 hover:text-zinc-200 hover:bg-[#16161C]"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold">{res.label}</span>
                            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#08080A] border border-[#1C1C22] text-zinc-400">
                              {res.tag}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Framerate & Format Controls */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-zinc-200 block mb-1.5">
                        Framerate
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        {[30, 60].map((rate) => (
                          <button
                            key={rate}
                            onClick={() => setFps(rate)}
                            className={`p-2 rounded-xl border text-xs font-bold transition text-center ${
                              fps === rate
                                ? "bg-[#181822] border-zinc-500 text-white"
                                : "bg-[#111114] border-[#1C1C22] text-zinc-400 hover:text-zinc-200 hover:bg-[#16161C]"
                            }`}
                          >
                            {rate} FPS
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-zinc-200 block mb-1.5">
                        Container Format
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        {["mp4", "webm"].map((fmt) => (
                          <button
                            key={fmt}
                            onClick={() => setFormat(fmt)}
                            className={`p-2 rounded-xl border text-xs font-bold uppercase transition text-center ${
                              format === fmt
                                ? "bg-[#181822] border-zinc-500 text-white"
                                : "bg-[#111114] border-[#1C1C22] text-zinc-400 hover:text-zinc-200 hover:bg-[#16161C]"
                            }`}
                          >
                            {fmt}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* TAB 2: NLE TIMELINE (OTIO) */}
          {activeTab === "nle" && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-[#0E0E12] border border-[#1C1C22] space-y-2">
                <div className="flex items-center space-x-2 text-indigo-400">
                  <Layers className="w-5 h-5" />
                  <h4 className="text-xs font-bold text-white">OpenTimelineIO (OTIO) Interchange</h4>
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Export complete non-destructive edit decisions, video tracks, audio stems, and timecode offsets compatible with:
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {["Adobe Premiere Pro", "DaVinci Resolve", "Final Cut Pro", "Avid Media Composer"].map((nle) => (
                    <span key={nle} className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-[#16161E] border border-[#242432] text-indigo-300">
                      {nle}
                    </span>
                  ))}
                </div>
              </div>

              <button
                onClick={handleExportOtio}
                className="w-full py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-98 text-white text-xs font-bold shadow-lg flex items-center justify-center space-x-2 transition"
              >
                <Download className="w-4 h-4" />
                <span>Download OpenTimelineIO (.otio) File</span>
              </button>
            </div>
          )}

          {/* TAB 3: PROJECT BUNDLE */}
          {activeTab === "bundle" && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-[#0E0E12] border border-[#1C1C22] space-y-2">
                <div className="flex items-center space-x-2 text-amber-400">
                  <Archive className="w-5 h-5" />
                  <h4 className="text-xs font-bold text-white">Portable .180vproj Project Bundle</h4>
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Self-contained, checksum-verified project archive containing full intermediate representation (Edit IR), transcript alignment graphs, and creative director history.
                </p>
              </div>

              <button
                onClick={handleExportVproj}
                className="w-full py-3 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 active:scale-98 text-white text-xs font-bold shadow-lg flex items-center justify-center space-x-2 transition"
              >
                <Download className="w-4 h-4" />
                <span>Download Project Archive (.180vproj)</span>
              </button>
            </div>
          )}

          {/* TAB 4: SUBTITLES */}
          {activeTab === "subtitles" && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-[#0E0E12] border border-[#1C1C22] space-y-2">
                <div className="flex items-center space-x-2 text-cyan-400">
                  <Subtitles className="w-5 h-5" />
                  <h4 className="text-xs font-bold text-white">Synchronized SubRip Subtitles (.srt)</h4>
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Export standard timecoded `.srt` subtitle file with {editIR.tracks.captionTrack.length} captions for YouTube, Vimeo, and social video players.
                </p>
              </div>

              <button
                onClick={handleExportSrt}
                className="w-full py-3 px-4 rounded-xl bg-cyan-600 hover:bg-cyan-500 active:scale-98 text-white text-xs font-bold shadow-lg flex items-center justify-center space-x-2 transition"
              >
                <Download className="w-4 h-4" />
                <span>Download Subtitles (.srt)</span>
              </button>
            </div>
          )}

          {/* Export Rendering Progress State */}
          {isExporting && (
            <div className="py-6 space-y-4 text-center">
              <div className="relative flex items-center justify-center w-14 h-14 mx-auto">
                <div className="w-14 h-14 rounded-full border-2 border-[#1C1C22] border-t-white animate-spin absolute inset-0" />
                <img
                  src="/white-icon.svg"
                  onError={(e) => {
                    e.currentTarget.src = "/white icon.svg";
                  }}
                  alt="180"
                  className="w-7 h-7 object-contain"
                />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-zinc-100">Rendering Master Video...</h4>
                <p className="text-[11px] text-zinc-400 mt-0.5">Synthesizing audio, spring zoom framing & kinetic captions</p>
              </div>

              <div className="w-full bg-[#111114] h-2.5 rounded-full overflow-hidden border border-[#1C1C22]">
                <div
                  className="bg-white h-full transition-all duration-150 rounded-full"
                  style={{ width: `${exportProgress || 0}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-xs font-mono text-zinc-400 px-1">
                <span>{exportProgress || 0}% Completed</span>
                <span className="text-emerald-400">Stream-Copy @ &gt;500 FPS</span>
              </div>
            </div>
          )}

          {/* Export Completed State with Video Preview & Download */}
          {(exportedResult || exportedPath) && (
            <div className="py-2 space-y-3">
              <div className="flex items-center space-x-3 p-3 rounded-xl bg-[#0E0E12] border border-[#1C1C22]">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-emerald-300">Video Rendered Successfully!</h4>
                  <p className="text-[11px] text-zinc-400">
                    {exportedResult?.downloadName || "master_render.mp4"} • {exportedResult ? `${(exportedResult.sizeBytes / (1024 * 1024)).toFixed(2)} MB` : "Ready"}
                  </p>
                </div>
              </div>

              {/* Video Player Preview */}
              {exportedResult?.blobUrl && (
                <div className="rounded-xl overflow-hidden border border-[#1C1C22] bg-black shadow-xl">
                  <video
                    src={exportedResult.blobUrl}
                    controls
                    autoPlay
                    playsInline
                    className="w-full max-h-52 object-contain bg-black"
                  />
                </div>
              )}

              {exportedResult?.qa && (
                <QualityIssuesList
                  heading="Quality check"
                  issues={exportedResult.qa.issues}
                  unavailable={exportedResult.qa.unavailable}
                  onSeekMs={onSeekMs}
                  emptyText="No black frames, frozen picture, missing audio or loudness problems found."
                >
                  {exportedResult.qa.issues.length > 0 && onAskDirectorFix && (
                    <button
                      type="button"
                      onClick={onAskDirectorFix}
                      className="w-full min-h-[44px] rounded-lg bg-[#4F46E5] hover:bg-indigo-500 text-white text-[11px] font-semibold transition"
                    >
                      Ask AI Director to fix
                    </button>
                  )}
                </QualityIssuesList>
              )}

              {/* Primary Download Button */}
              {exportedResult && !exportedResult.savedPath ? (
                <button
                  onClick={handleDownloadFile}
                  className="w-full py-3 px-4 rounded-xl bg-white hover:bg-zinc-200 active:scale-98 text-black text-xs font-semibold shadow-lg flex items-center justify-center space-x-2 transition"
                >
                  <Download className="w-4 h-4" />
                  <span>Download Video File ({exportedResult.downloadName})</span>
                </button>
              ) : (
                <div className="text-xs text-zinc-400 font-mono break-all bg-[#111114] p-2.5 rounded-xl border border-[#1C1C22]">
                  {exportedResult?.savedPath ? `Saved to ${exportedResult.savedPath}` : exportedPath}
                </div>
              )}

              {attachState && (
                <div className="p-3 rounded-xl bg-[#0E0E12] border border-[#1C1C22] space-y-2" aria-live="polite">
                  {attachState.status === "uploading" && (
                    <>
                      <p className="text-[11px] text-zinc-300">Attaching to the {attachState.label}... {attachState.progress}%</p>
                      <div className="h-1.5 rounded-full bg-[#1C1C22] overflow-hidden">
                        <div className="h-full bg-indigo-500 transition-all" style={{ width: `${attachState.progress}%` }} />
                      </div>
                    </>
                  )}
                  {attachState.status === "done" && (
                    <p className="text-[11px] text-emerald-300">Attached to the {attachState.label} and sent for review.</p>
                  )}
                  {attachState.status === "error" && (
                    <>
                      <p className="text-[11px] text-red-300">Could not attach the export: {attachState.message}</p>
                      <div className="flex flex-wrap gap-2">
                        {onRetryAttach && (
                          <button
                            onClick={onRetryAttach}
                            className="min-h-[44px] px-4 rounded-xl bg-white hover:bg-zinc-200 text-black text-xs font-semibold transition"
                          >
                            Retry upload
                          </button>
                        )}
                        {onAttachFile && (
                          <button
                            onClick={() => attachFileRef.current?.click()}
                            className="min-h-[44px] px-4 rounded-xl border border-[#2A2A32] text-xs font-semibold text-zinc-300 hover:bg-[#16161C] transition"
                          >
                            Pick the MP4 file
                          </button>
                        )}
                        <input
                          ref={attachFileRef}
                          type="file"
                          accept="video/mp4,video/quicktime"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.target.value = "";
                            if (f && onAttachFile) onAttachFile(f);
                          }}
                        />
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#1C1C22] bg-[#08080A] flex items-center justify-end space-x-2.5">
          {isExporting && onCancelExport && (
            <button
              onClick={onCancelExport}
              className="px-4 py-2 rounded-xl border border-[#2A2A32] text-xs font-semibold text-zinc-300 hover:bg-[#16161C] transition"
            >
              Cancel export
            </button>
          )}
          {!isExporting && !exportedResult && !exportedPath && activeTab === "video" && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-medium text-zinc-400 hover:text-white transition"
              >
                Cancel
              </button>
              <button
                onClick={handleExport}
                className="px-5 py-2 rounded-xl text-xs font-semibold text-black bg-white hover:bg-zinc-200 active:scale-95 shadow-sm transition"
              >
                Start Render
              </button>
            </>
          )}

          {(!isExporting || exportedResult || exportedPath) && activeTab !== "video" && (
            <button
              onClick={onClose}
              className="px-5 py-2 rounded-xl text-xs font-medium text-zinc-200 bg-[#141418] hover:bg-[#1C1C22] border border-[#1C1C22] transition"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
