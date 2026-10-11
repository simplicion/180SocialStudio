import React, { useState } from "react";
import {
  Sparkles,
  Sliders,
  Folder,
  ChevronsLeft,
  ChevronsRight,
  Bot,
  Video,
  Layers,
  Wand2,
  FolderOpen,
  Search,
  Type,
  Zap,
} from "lucide-react";
import { EditIR, DirectorStylePreset, MediaAssetDescriptor, VideoClip, Transition, EffectEvent, VideoEffectType } from "@workspace/video-contracts";
import { TextTemplatesPanel } from "./TextTemplatesPanel";
import { EffectsPanel } from "./EffectsPanel";
import type { BrandLook } from "../services/editor-library";
import { AIDirectorPanel, DirectorChatMessage, DirectorPromptOptions } from "./AIDirectorPanel";
import { ClipInspector } from "./ClipInspector";
import { AICriticDrawer } from "./AICriticDrawer";
import { StockMediaPanel } from "./StockMediaPanel";
import { AssetBin } from "./AssetBin";
import { CompanyAIStatus, AIDirectorProgressEvent } from "../services/tauri-bridge";

export type LeftSidebarTab = "director" | "inspector" | "critic" | "assets" | "stock" | "text" | "effects";

interface LeftSidebarDockProps {
  activeTab: LeftSidebarTab;
  onTabChange: (tab: LeftSidebarTab) => void;
  isOpen: boolean;
  onToggleOpen: () => void;
  width: number;
  // Director Props
  currentPreset?: DirectorStylePreset;
  onSelectPreset?: (preset: DirectorStylePreset) => void;
  onApplyPrompt: (prompt: string, options?: DirectorPromptOptions) => Promise<void> | void;
  isAiProcessing: boolean;
  aiProgress?: AIDirectorProgressEvent | null;
  companyAIStatus?: CompanyAIStatus | null;
  onRefreshAIStatus?: () => void;
  aiMessages: DirectorChatMessage[];
  onRevertToAiMessage?: (msg: DirectorChatMessage) => void;
  onClearAiMessages?: () => void;
  currentAspect?: "16:9" | "9:16" | "1:1";
  timelineDurationSec?: number;
  clipsCount?: number;
  userProfile?: {
    name?: string;
    photoUrl?: string;
    email?: string;
  } | null;
  onConfirmAutonomousEdit?: (msg: DirectorChatMessage) => void;
  onCancelAutonomousEdit?: (msg: DirectorChatMessage) => void;
  onCancelDirectorRun?: () => void;
  onSeekMs?: (ms: number) => void;
  directorLockCount?: number;
  // Inspector Props
  selectedClip: VideoClip | null;
  selectedClipId: string | null;
  currentTimeSeconds?: number;
  onUpdateTransform?: (transform: any) => void;
  onUpdateSpeed?: (speed: number) => void;
  onUpdateVolume?: (vol: number) => void;
  onUpdateTransitions?: (transitionIn?: Transition, transitionOut?: Transition) => void;
  onDetachAudio?: () => void;
  onDuplicateClip?: () => void;
  onDeleteClip?: () => void;
  onCloseInspector?: () => void;
  // Critic Props
  editIR: EditIR;
  onApplyCriticRepairs?: (repairs: any[]) => void;
  // Assets & Stock Props
  assets?: MediaAssetDescriptor[];
  onImportFiles?: () => void;
  onAddAssetToProject?: (asset: MediaAssetDescriptor) => void;
  onAddClipToTimeline?: (asset: MediaAssetDescriptor) => void;
  onDeleteAsset?: (assetId: string) => void;
  onAddAssetToTimeline?: (asset: MediaAssetDescriptor) => void;
  // Text templates & effects
  brandLook?: BrandLook;
  onAddTitle?: (templateId: string, text: string) => void;
  selectedEffect?: EffectEvent | null;
  onAddEffect?: (type: VideoEffectType, intensity: number) => void;
  onUpdateEffectIntensity?: (id: string, intensity: number) => void;
  onDeleteEffect?: (id: string) => void;
}

export const LeftSidebarDock: React.FC<LeftSidebarDockProps> = ({
  activeTab,
  onTabChange,
  isOpen,
  onToggleOpen,
  width,
  currentPreset,
  onSelectPreset,
  onApplyPrompt,
  isAiProcessing,
  aiProgress,
  companyAIStatus,
  onRefreshAIStatus,
  aiMessages,
  onRevertToAiMessage,
  onClearAiMessages,
  currentAspect = "16:9",
  timelineDurationSec = 0,
  clipsCount = 0,
  userProfile,
  onConfirmAutonomousEdit,
  onCancelAutonomousEdit,
  onCancelDirectorRun,
  onSeekMs,
  directorLockCount,
  selectedClip,
  selectedClipId,
  currentTimeSeconds = 0,
  onUpdateTransform,
  onUpdateSpeed,
  onUpdateVolume,
  onUpdateTransitions,
  onDetachAudio,
  onDuplicateClip,
  onDeleteClip,
  onCloseInspector,
  editIR,
  onApplyCriticRepairs,
  assets = [],
  onImportFiles,
  onAddAssetToProject,
  onAddClipToTimeline,
  onDeleteAsset,
  onAddAssetToTimeline,
  brandLook = {},
  onAddTitle,
  selectedEffect = null,
  onAddEffect,
  onUpdateEffectIntensity,
  onDeleteEffect,
}) => {
  if (!isOpen) {
    return (
      <div className="w-11 border-r border-[#1C1C22] bg-[#090A0F] flex flex-col items-center py-3 space-y-3 shrink-0 select-none z-20">
        {/* Expand Button with 180 Logo */}
        <button
          onClick={onToggleOpen}
          className="p-1.5 rounded-lg text-indigo-400 hover:text-white hover:bg-[#181824] border border-indigo-500/20 transition flex flex-col items-center space-y-1 group"
          title="Expand Side Menu (<>)"
        >
          <img
            src="/white-icon.svg"
            onError={(e) => {
              e.currentTarget.src = "/white icon.svg";
            }}
            alt="180 AI"
            className="w-4 h-4 object-contain"
          />
          <ChevronsRight className="w-3.5 h-3.5 text-indigo-400 group-hover:translate-x-0.5 transition-transform" />
        </button>

        <div className="w-5 h-px bg-[#1C1C22]" />

        {/* Quick Tab Selectors when collapsed */}
        <button
          onClick={() => {
            onTabChange("director");
            onToggleOpen();
          }}
          className={`p-2 rounded-lg transition ${
            activeTab === "director"
              ? "bg-indigo-600/20 text-indigo-300 border border-indigo-500/30"
              : "text-zinc-500 hover:text-zinc-300 hover:bg-[#15151C]"
          }`}
          title="Creative Director AI"
        >
          <Wand2 className="w-4 h-4" />
        </button>

        <button
          onClick={() => {
            onTabChange("inspector");
            onToggleOpen();
          }}
          className={`p-2 rounded-lg transition relative ${
            activeTab === "inspector"
              ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
              : "text-zinc-500 hover:text-zinc-300 hover:bg-[#15151C]"
          }`}
          title="Clip Inspector"
        >
          <Sliders className="w-4 h-4" />
          {selectedClipId && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 absolute top-1 right-1" />
          )}
        </button>

        <button
          onClick={() => {
            onTabChange("critic");
            onToggleOpen();
          }}
          className={`p-2 rounded-lg transition ${
            activeTab === "critic"
              ? "bg-pink-500/20 text-pink-300 border border-pink-500/30"
              : "text-zinc-500 hover:text-zinc-300 hover:bg-[#15151C]"
          }`}
          title="AICritic QA & Retention"
        >
          <Sparkles className="w-4 h-4" />
        </button>

        <div className="w-5 h-px bg-[#1C1C22]" />

        <button
          onClick={() => {
            onTabChange("assets");
            onToggleOpen();
          }}
          className={`p-2 rounded-lg transition relative ${
            activeTab === "assets"
              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
              : "text-zinc-500 hover:text-zinc-300 hover:bg-[#15151C]"
          }`}
          title="Project Assets"
        >
          <FolderOpen className="w-4 h-4" />
          {assets.length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] rounded-full bg-emerald-500 text-[8px] text-white font-bold flex items-center justify-center px-0.5">
              {assets.length}
            </span>
          )}
        </button>

        <button
          onClick={() => {
            onTabChange("stock");
            onToggleOpen();
          }}
          className={`p-2 rounded-lg transition ${
            activeTab === "stock"
              ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
              : "text-zinc-500 hover:text-zinc-300 hover:bg-[#15151C]"
          }`}
          title="Stock Media & Audio"
        >
          <Search className="w-4 h-4" />
        </button>

        <button
          onClick={() => {
            onTabChange("text");
            onToggleOpen();
          }}
          className={`p-2 rounded-lg transition ${
            activeTab === "text" ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30" : "text-zinc-500 hover:text-zinc-300 hover:bg-[#15151C]"
          }`}
          title="Text templates"
        >
          <Type className="w-4 h-4" />
        </button>

        <button
          onClick={() => {
            onTabChange("effects");
            onToggleOpen();
          }}
          className={`p-2 rounded-lg transition ${
            activeTab === "effects" ? "bg-violet-500/20 text-violet-300 border border-violet-500/30" : "text-zinc-500 hover:text-zinc-300 hover:bg-[#15151C]"
          }`}
          title="Video effects"
        >
          <Zap className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      style={{ width: `${width}px` }}
      className="h-full border-r border-[#1C1C22] bg-[#090A0F] flex flex-col shrink-0 relative select-none overflow-hidden"
    >
      {/* 1. Universal Top Navigation Bar with 3 Tabs + Collapse Toggle */}
      <div className="h-11 border-b border-[#1C1C22] bg-[#0C0D14] flex items-center justify-between px-2 shrink-0">
        {/* Tab Pills */}
        <div className="flex items-center space-x-1 bg-[#12131C] p-0.5 rounded-lg border border-[#1F202B] min-w-0 overflow-x-auto">
          {/* Tab 1: Creative Director */}
          <button
            onClick={() => onTabChange("director")}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition ${
              activeTab === "director"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-[#181926]"
            }`}
            title="AI Creative Director"
          >
            <img
              src="/white-icon.svg"
              onError={(e) => {
                e.currentTarget.src = "/white icon.svg";
              }}
              alt="AI"
              className="w-3.5 h-3.5 object-contain"
            />
            <span>Director</span>
          </button>

          {/* Tab 2: Inspector */}
          <button
            onClick={() => onTabChange("inspector")}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition relative ${
              activeTab === "inspector"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-[#181926]"
            }`}
            title="Clip Transform & Audio Inspector"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Inspector</span>
            {selectedClipId && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
            )}
          </button>

          {/* Tab 3: Critic */}
          <button
            onClick={() => onTabChange("critic")}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition ${
              activeTab === "critic"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-[#181926]"
            }`}
            title="AICritic Retention QA"
          >
            <Sparkles className="w-3.5 h-3.5 text-pink-400" />
            <span>Critic</span>
          </button>

          {/* Separator */}
          <div className="w-px h-5 bg-[#1F202B] mx-0.5" />

          {/* Tab 4: Assets */}
          <button
            onClick={() => onTabChange("assets")}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition relative ${
              activeTab === "assets"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-[#181926]"
            }`}
            title="Project Assets"
          >
            <FolderOpen className="w-3.5 h-3.5 text-emerald-400" />
            <span>Assets</span>
            {assets.length > 0 && (
              <span className="min-w-[16px] h-[16px] rounded-full bg-emerald-500/80 text-[9px] text-white font-bold flex items-center justify-center px-1">
                {assets.length}
              </span>
            )}
          </button>

          {/* Tab 5: Stock Media */}
          <button
            onClick={() => onTabChange("stock")}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition ${
              activeTab === "stock"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-[#181926]"
            }`}
            title="Stock Media & Audio Search"
          >
            <Search className="w-3.5 h-3.5 text-cyan-400" />
            <span>Stock</span>
          </button>

          <button
            onClick={() => onTabChange("text")}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition ${
              activeTab === "text"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-[#181926]"
            }`}
            title="Text templates"
          >
            <Type className="w-3.5 h-3.5 text-cyan-400" />
            <span>Text</span>
          </button>

          <button
            onClick={() => onTabChange("effects")}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition ${
              activeTab === "effects"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-[#181926]"
            }`}
            title="Video effects"
          >
            <Zap className="w-3.5 h-3.5 text-violet-300" />
            <span>FX</span>
          </button>
        </div>

        {/* Collapse Button (<>) */}
        <button
          onClick={onToggleOpen}
          className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-[#181926] border border-[#1F202B] transition"
          title="Collapse Side Menu (<>)"
        >
          <ChevronsLeft className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 2. Body based on activeTab */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {activeTab === "director" && (
          <AIDirectorPanel
            currentPreset={currentPreset}
            onSelectPreset={onSelectPreset}
            onApplyPrompt={onApplyPrompt}
            isProcessing={isAiProcessing}
            currentProgress={aiProgress}
            companyAIStatus={companyAIStatus}
            onRefreshAIStatus={onRefreshAIStatus}
            messages={aiMessages}
            onRevertToMessage={onRevertToAiMessage}
            onClearMessages={onClearAiMessages}
            currentAspect={currentAspect}
            timelineDurationSec={timelineDurationSec}
            clipsCount={clipsCount}
            selectedClipId={selectedClipId}
            userProfile={userProfile}
            onToggleCollapse={onToggleOpen}
            onConfirmAutonomousEdit={onConfirmAutonomousEdit}
            onCancelAutonomousEdit={onCancelAutonomousEdit}
            onCancelRun={onCancelDirectorRun}
            onSeekMs={onSeekMs}
            lockCount={directorLockCount}
          />
        )}

        {activeTab === "inspector" && (
          <div className="h-full flex flex-col overflow-y-auto">
            {selectedClip ? (
              <ClipInspector
                selectedClip={selectedClip}
                currentTimeSeconds={currentTimeSeconds}
                onUpdateTransform={onUpdateTransform || (() => {})}
                onUpdateSpeed={onUpdateSpeed || (() => {})}
                onUpdateVolume={onUpdateVolume || (() => {})}
                onUpdateTransitions={onUpdateTransitions}
                onDetachAudio={onDetachAudio || (() => {})}
                onDuplicateClip={onDuplicateClip || (() => {})}
                onDeleteClip={onDeleteClip || (() => {})}
                onClose={onCloseInspector || (() => {})}
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-zinc-400 space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-[#141419] border border-[#22222A] flex items-center justify-center text-zinc-500">
                  <Sliders className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-semibold text-zinc-200">No Clip Selected</h4>
                <p className="text-xs text-zinc-500 max-w-[220px]">
                  Click any clip on the Remotion timeline to adjust scale, position, rotation, speed, and audio volume.
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === "critic" && (
          <div className="h-full flex flex-col overflow-y-auto">
            <AICriticDrawer
              isOpen={true}
              onClose={onToggleOpen}
              editIR={editIR}
              onExecutePrompt={onApplyPrompt}
              onApplyRepairs={onApplyCriticRepairs || (() => {})}
            />
          </div>
        )}

        {activeTab === "assets" && (
          <div className="h-full flex flex-col overflow-hidden">
            <AssetBin
              assets={assets}
              onImportFiles={onImportFiles ? ((_files: FileList | File[]) => onImportFiles()) : (() => {})}
              onAddClipToTimeline={onAddAssetToTimeline || (() => {})}
              onRemoveAsset={onDeleteAsset}
            />
          </div>
        )}

        {activeTab === "stock" && (
          <div className="h-full flex flex-col overflow-hidden">
            <StockMediaPanel
              onAddAssetToProject={onAddAssetToProject || (() => {})}
              onAddClipToTimeline={onAddClipToTimeline || (() => {})}
              aspectRatio={currentAspect}
            />
          </div>
        )}

        {activeTab === "text" && (
          <TextTemplatesPanel brand={brandLook} currentTimeSeconds={currentTimeSeconds} onAddTitle={onAddTitle || (() => {})} />
        )}

        {activeTab === "effects" && (
          <EffectsPanel
            currentTimeSeconds={currentTimeSeconds}
            selectedEffect={selectedEffect}
            onAddEffect={onAddEffect || (() => {})}
            onUpdateIntensity={onUpdateEffectIntensity || (() => {})}
            onDeleteEffect={onDeleteEffect || (() => {})}
          />
        )}
      </div>
    </div>
  );
};
