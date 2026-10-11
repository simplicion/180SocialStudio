import React from "react";
import {
  Folder,
  Sparkles,
  RotateCcw,
  RotateCw,
  Download,
  Sliders,
  Subtitles,
  FileCode,
  Save,
  CheckCircle2,
  Puzzle,
  Database,
  ExternalLink,
} from "lucide-react";
import { CompanyAIStatus } from "../services/tauri-bridge";

interface HeaderBarProps {
  projectName: string;
  onUpdateProjectName?: (name: string) => void;
  authSession?: {
    userName?: string;
    companyId?: string;
    isAuthenticated?: boolean;
  };
  companyAIStatus?: CompanyAIStatus | null;
  isAiProcessing: boolean;
  canUndo: boolean;
  canRedo: boolean;
  aspectRatio?: "16:9" | "9:16" | "1:1";
  onAspectRatioChange?: (aspect: "16:9" | "9:16" | "1:1") => void;
  onOpenExport: () => void;
  onOpenCaptions?: () => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onNavigateHome?: () => void;
  isRightPanelOpen?: boolean;
  onToggleRightPanel?: () => void;
  activeRightTab?: string;
  onSelectRightTab?: (tab: "assets" | "inspector" | "critic" | "captions" | "mixer" | "plugins") => void;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  projectName,
  onUpdateProjectName,
  authSession,
  companyAIStatus,
  isAiProcessing,
  canUndo,
  canRedo,
  onOpenExport,
  onOpenCaptions,
  onSave,
  onUndo,
  onRedo,
  onNavigateHome,
  isRightPanelOpen = false,
  onToggleRightPanel,
  activeRightTab = "assets",
  onSelectRightTab,
}) => {
  const [isEditingTitle, setIsEditingTitle] = React.useState(false);
  const [titleInput, setTitleInput] = React.useState(projectName);

  React.useEffect(() => {
    setTitleInput(projectName);
  }, [projectName]);

  const handleFinishRename = () => {
    setIsEditingTitle(false);
    if (titleInput.trim() && onUpdateProjectName && titleInput.trim() !== projectName) {
      onUpdateProjectName(titleInput.trim());
    } else {
      setTitleInput(projectName);
    }
  };

  return (
    <header className="h-12 border-b border-[#1C1C22] bg-[#08080A] flex items-center justify-between px-3 z-30 select-none">
      {/* Left: Folder Navigation & Real Project Title */}
      <div className="flex items-center space-x-3">
        {onNavigateHome && (
          <button
            onClick={onNavigateHome}
            className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-[#111114] hover:bg-[#18181E] text-zinc-300 hover:text-white border border-[#1C1C22] text-xs font-medium transition active:scale-95 shadow-sm group"
            title="Back to Projects & Files"
          >
            <Folder className="w-3.5 h-3.5 text-zinc-400 group-hover:text-indigo-400 transition-colors" />
            <span className="font-medium">Projects & Files</span>
          </button>
        )}

        <div className="h-4 w-px bg-[#1C1C22]" />

        {/* 180 Brand Mark & Real Project Name */}
        <div className="flex items-center space-x-2.5">
          <img
            src="/white-icon.svg"
            onError={(e) => {
              e.currentTarget.src = "/white icon.svg";
            }}
            alt="180"
            className="w-5 h-5 object-contain shrink-0"
          />

          {isEditingTitle ? (
            <input
              type="text"
              autoFocus
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              onBlur={handleFinishRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleFinishRename();
                if (e.key === "Escape") {
                  setTitleInput(projectName);
                  setIsEditingTitle(false);
                }
              }}
              className="bg-[#141418] border border-indigo-500/50 rounded px-2 py-0.5 text-xs font-semibold text-white outline-none max-w-[240px]"
            />
          ) : (
            <span
              onClick={() => setIsEditingTitle(true)}
              className="text-xs font-semibold text-zinc-100 max-w-[220px] sm:max-w-[320px] truncate cursor-pointer hover:text-indigo-300 hover:underline decoration-dotted transition"
              title="Click to rename project"
            >
              {projectName || "Untitled Project"}
            </span>
          )}
        </div>
      </div>

      {/* Center: Clean & Uncluttered (Critic/Saved/Creator removed) */}
      <div className="flex items-center space-x-1.5" />

      {/* Right: History Undo/Redo, Engine Status & Actions */}
      <div className="flex items-center space-x-2">
        {/* Undo / Redo Group */}
        <div className="flex items-center bg-[#111114] p-0.5 rounded-lg border border-[#1F1F24]">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            className="p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-[#1C1C22] disabled:opacity-25 disabled:pointer-events-none transition"
            title="Undo (Ctrl+Z)"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <div className="h-3 w-px bg-[#1F1F24]" />
          <button
            onClick={onRedo}
            disabled={!canRedo}
            className="p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-[#1C1C22] disabled:opacity-25 disabled:pointer-events-none transition"
            title="Redo (Ctrl+Y)"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="h-4 w-px bg-[#1C1C22]" />

        {/* Engine Status */}
        {isAiProcessing ? (
          <div className="flex items-center space-x-1.5 bg-[#141418] border border-[#22222A] text-zinc-300 text-xs px-2.5 py-1 rounded-md">
            <Sparkles className="w-3.5 h-3.5 animate-spin text-zinc-300" />
            <span className="font-medium">Processing...</span>
          </div>
        ) : companyAIStatus?.isConfigured ? (
          <div
            className="flex items-center space-x-1.5 text-xs text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-md border border-emerald-500/20 cursor-default"
            title="Studio Engine Online"
          >
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span className="font-medium text-emerald-300">Ready</span>
          </div>
        ) : (
          <button
            onClick={() => window.open("/?drawer=ai-credits", "_blank")}
            className="flex items-center space-x-1.5 text-xs text-zinc-400 hover:text-zinc-200 bg-[#111114] hover:bg-[#18181E] px-2.5 py-1 rounded-md border border-[#1C1C22] transition active:scale-95"
            title="Configure Cloud Intelligence in Platform Settings"
          >
            <div className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
            <span>Setup Engine</span>
            <ExternalLink className="w-2.5 h-2.5 text-zinc-500" />
          </button>
        )}

        {/* Subtitles & Typography */}
        {onOpenCaptions && (
          <button
            onClick={onOpenCaptions}
            className="flex items-center space-x-1.5 text-xs font-medium text-cyan-300 bg-[#0E161C] hover:bg-[#14232C] hover:text-cyan-200 px-2.5 py-1 rounded-md border border-cyan-500/30 transition shadow-sm active:scale-95"
            title="Open Subtitle & Typography Studio (Google Fonts, Strokes, Glows)"
          >
            <Subtitles className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden sm:inline">Captions</span>
          </button>
        )}

        {/* Save */}
        <button
          onClick={onSave}
          className="flex items-center space-x-1.5 text-xs font-medium text-zinc-200 bg-[#111114] hover:bg-[#18181E] hover:text-white px-3 py-1 rounded-md border border-[#1C1C22] transition shadow-sm active:scale-95"
          title="Save Project (Ctrl+S)"
        >
          <Save className="w-3.5 h-3.5 text-zinc-400" />
          <span>Save</span>
        </button>

        {/* Primary Export */}
        <button
          onClick={onOpenExport}
          className="flex items-center space-x-1.5 text-xs font-semibold text-black bg-white hover:bg-zinc-200 px-3.5 py-1 rounded-md shadow-sm transition active:scale-95"
          title="Export Video"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export</span>
        </button>
      </div>
    </header>
  );
};
