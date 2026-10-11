"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  ProjectPackageManifest,
  DirectorStylePreset,
  MediaAssetDescriptor,
  EditIR,
  EditCommand,
  RationalTimeMath,
  Transform,
  CaptionSegment,
  VideoClip,
  VideoEffectType,
} from "@workspace/video-contracts";
import { HeaderBar } from "./HeaderBar";
import { AIDirectorPanel, DirectorChatMessage, DirectorPromptOptions } from "./AIDirectorPanel";
import { AssetBin } from "./AssetBin";
import { CanvasViewport } from "./CanvasViewport";
import { Timeline } from "./Timeline";
import { ExportModal, ExportAttachState } from "./ExportModal";
import { ExportErrorDialog, ExportFailure } from "./ExportErrorDialog";
import { ClipInspector } from "./ClipInspector";
import { CaptionStudioModal } from "./CaptionStudioModal";
import { AudioMixerPanel } from "./AudioMixerPanel";
import { ProxyGeneratorModal } from "./ProxyGeneratorModal";
import { AICriticDrawer } from "./AICriticDrawer";
import { PluginManagerModal } from "./PluginManagerModal";
import { CacheManagerModal } from "./CacheManagerModal";
import { KeyboardShortcutsModal } from "./KeyboardShortcutsModal";
import { ColorScopesModal } from "./ColorScopesModal";
import { SilenceRemovalModal } from "./SilenceRemovalModal";
import { HomeScreen } from "./HomeScreen";
import { ResizableSplitter } from "./ResizableSplitter";
import { ProjectStorageService } from "../services/project-storage";
import { MediaCacheService } from "../services/media-cache";
import { Folder, Sparkles, ArrowLeft, Maximize2, Minimize2, ChevronsRight } from "lucide-react";
import { OtioService } from "../services/otio-service";
import {
  engineBridge,
  CompanyAIStatus,
  ExportResult,
  DirectorRequestError,
  DirectorHistoryTurn,
  directorContextFromUrl,
  sendDirectorFeedback,
} from "../services/tauri-bridge";
import { studioJobs, StudioJob } from "../services/studio-jobs";
import { buildDirectorConstraints, enforceLocksOnResult, locksFromTimelineKeys, normalizeRanges } from "../services/director-locks";
import { JobsTray } from "./JobsTray";
import toast from "react-hot-toast";
import {
  addEffect,
  addTitleFromTemplate,
  effectInfo,
  newTimelineItemIds,
  removeOverlayItem,
  retimeOverlayItem,
  setEffectIntensity,
  textTemplateById,
  type BrandLook,
} from "../services/editor-library";
import { hasNativeMedia } from "@/lib/native/desktop-media";

/** A short reply that confirms the pending proposal ("yes", "proceed", "apply it", ...). */
const CONFIRM_REPLY = /^(yes|yep|yeah|y|ok|okay|sure|proceed|go ahead|go|apply|apply it|do it|confirm|sounds good)[\s.!]*$/i;

function safeUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

interface MediaStudioWorkspaceProps {
  initialProjectId?: string | null;
  initialTemplate?: string | null;
  onNavigateHome?: () => void;
  onExit?: () => void;
}

import { LeftSidebarDock, LeftSidebarTab } from "./LeftSidebarDock";

export const MediaStudioWorkspace: React.FC<MediaStudioWorkspaceProps> = ({
  initialProjectId,
  initialTemplate,
  onNavigateHome,
  onExit,
}) => {
  const [activeView, setActiveView] = useState<"home" | "editor">(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("project") || params.get("projectId") || params.get("postId") || params.get("taskId")) return "editor";
    }
    return initialProjectId ? "editor" : "home";
  });

  const [leftPanelWidth, setLeftPanelWidth] = useState<number>(360);
  const [timelineHeight, setTimelineHeight] = useState<number>(280);
  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(true);
  const [leftSidebarTab, setLeftSidebarTab] = useState<LeftSidebarTab>("director");
  // Brand look for text templates, only from the brand the server returned (never invented).
  const [brandLook, setBrandLook] = useState<BrandLook>({});

  const [project, setProject] = useState<ProjectPackageManifest | null>(null);
  const [currentTimeSeconds, setCurrentTimeSeconds] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1.0);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "9:16" | "1:1">("16:9");
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [aiProgress, setAiProgress] = useState<any | null>(null);

  // Modals state
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isCaptionsModalOpen, setIsCaptionsModalOpen] = useState(false);
  const [isMixerModalOpen, setIsMixerModalOpen] = useState(false);
  const [isProxyModalOpen, setIsProxyModalOpen] = useState(false);
  const [isCriticDrawerOpen, setIsCriticDrawerOpen] = useState(false);
  const [isPluginModalOpen, setIsPluginModalOpen] = useState(false);
  const [isCacheModalOpen, setIsCacheModalOpen] = useState(false);
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false);
  const [isScopesModalOpen, setIsScopesModalOpen] = useState(false);
  const [isSilenceModalOpen, setIsSilenceModalOpen] = useState(false);
  const [isDuckingEnabled, setIsDuckingEnabled] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const exportAbortRef = useRef<AbortController | null>(null);

  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportFailure, setExportFailure] = useState<ExportFailure | null>(null);
  const [exportedPath, setExportedPath] = useState<string | null>(null);
  const [exportedResult, setExportedResult] = useState<ExportResult | null>(null);
  const [attachState, setAttachState] = useState<ExportAttachState | null>(null);

  // Timeline locks: not editable by drag, and sent to the AI Director as constraints (re-checked on every result).
  const [trackLocks, setTrackLocks] = useState<Record<string, boolean>>({});
  const [lockedRangesMs, setLockedRangesMs] = useState<Array<[number, number]>>([]);
  const directorJobRef = useRef<string | null>(null);
  const exportJobRef = useRef<string | null>(null);
  useEffect(() => {
    studioJobs.restore();
  }, []);
  const [companyAIStatus, setCompanyAIStatus] = useState<CompanyAIStatus | null>(null);

  // History stack for Undo/Redo
  const [history, setHistory] = useState<EditIR[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [aiMessages, setAiMessages] = useState<DirectorChatMessage[]>([]);

  const [authSession, setAuthSession] = useState<{
    userName?: string;
    companyId?: string;
    userEmail?: string;
    isAuthenticated: boolean;
  }>({
    isAuthenticated: false,
  });

  const fetchCompanyAIStatus = async (compId?: string) => {
    try {
      const status = await engineBridge.getAIStatus(compId || authSession.companyId);
      setCompanyAIStatus(status);
    } catch (err) {
      console.warn("Failed to retrieve company AI status:", err);
    }
  };

  useEffect(() => {
    if (typeof document !== "undefined") {
      const linkId = "google-fonts-180-studio";
      if (!document.getElementById(linkId)) {
        const link = document.createElement("link");
        link.id = linkId;
        link.rel = "stylesheet";
        link.href =
          "https://fonts.googleapis.com/css2?family=Anton&family=Bebas+Neue&family=Inter:wght@400;700;900&family=Montserrat:wght@700;900&family=Outfit:wght@600;800&family=Poppins:wght@700;900&family=Roboto:wght@700;900&family=Syne:wght@700;800&display=swap";
        document.head.appendChild(link);
      }
    }

    const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const projId = initialProjectId || params?.get("project");
    const template = initialTemplate || params?.get("template");
    const token = params?.get("token");
    const companyId = params?.get("companyId");
    const userName = params?.get("user");
    const userEmail = params?.get("email");

    if (token) localStorage.setItem("platform_auth_token", token);
    if (companyId) localStorage.setItem("platform_company_id", companyId);
    if (userName) localStorage.setItem("platform_user_name", userName);
    if (userEmail) localStorage.setItem("platform_user_email", userEmail);

    const resolvedUser = userName || localStorage.getItem("platform_user_name") || "Creator";
    const resolvedCompany = companyId || localStorage.getItem("platform_company_id") || "180 Workspace";
    const resolvedToken = token || localStorage.getItem("platform_auth_token");

    setAuthSession({
      userName: resolvedUser,
      companyId: resolvedCompany,
      userEmail: userEmail || localStorage.getItem("platform_user_email") || undefined,
      isAuthenticated: Boolean(resolvedToken || userName || companyId),
    });

    fetchCompanyAIStatus(resolvedCompany);

    if (projId) {
      loadProject(projId);
    } else {
      createNewProject(template || initialTemplate || "CUSTOM");
    }
  }, [initialProjectId, initialTemplate]);

  const applySocialMediaContext = async (manifest: ProjectPackageManifest, targetProjId?: string | null) => {
    let currentManifest = manifest;
    const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const rawVideoUrl = params?.get("rawVideoUrl");

    // 1. If rawVideoUrl provided, auto-inject as asset and video track clip
    if (rawVideoUrl) {
      const decodedRawUrl = decodeURIComponent(rawVideoUrl);
      const alreadyExists = currentManifest.assets.some((a) => a.filePath === decodedRawUrl);
      if (!alreadyExists && (decodedRawUrl.startsWith("http") || decodedRawUrl.startsWith("blob:"))) {
        const rawAsset: MediaAssetDescriptor = {
          id: safeUUID(),
          name: "Raw Social Footage",
          filePath: decodedRawUrl,
          mimeType: "video/mp4",
          durationSeconds: 15.0,
          width: 1080,
          height: 1920,
          fps: 30,
          fileSizeBytes: 10 * 1024 * 1024,
          hasAudio: true,
          sha256Hash: safeUUID(),
        };
        const updatedAssets = [...currentManifest.assets, rawAsset];
        let updatedIR = { ...currentManifest.editIR };
        const mainTrack = updatedIR.tracks.videoTracks[0];
        if (mainTrack && mainTrack.clips.length === 0) {
          const clipDur = RationalTimeMath.fromSeconds(15.0);
          const newClip: VideoClip = {
            id: safeUUID(),
            assetId: rawAsset.id,
            sourcePath: rawAsset.filePath,
            sourceRange: { start: RationalTimeMath.fromSeconds(0), duration: clipDur },
            timelineRange: { start: RationalTimeMath.fromSeconds(0), duration: clipDur },
            transform: {
              scale: { start: 1.0, end: 1.0, easing: "spring" },
              position: { x: 0, y: 0 },
              anchor: { x: 0.5, y: 0.5 },
              rotationDeg: 0,
              opacity: 1.0,
              crop: { top: 0, bottom: 0, left: 0, right: 0 },
            },
            speedMultiplier: 1.0,
            effects: [],
          };
          updatedIR = {
            ...updatedIR,
            meta: {
              ...updatedIR.meta,
              totalDuration: clipDur,
              targetAspect: "9:16",
            },
            tracks: {
              ...updatedIR.tracks,
              videoTracks: [{ ...mainTrack, clips: [newClip] }],
            },
          };
        }
        currentManifest = {
          ...currentManifest,
          assets: updatedAssets,
          editIR: updatedIR,
        };
      }
    }

    // 2. Brand + script greeting from the server (GET /media-editor/director-context). Its proposal waits for Apply.
    const directorCtx = directorContextFromUrl();
    if (directorCtx.projectId || directorCtx.calendarPieceId || directorCtx.postId) {
      try {
        const g = await engineBridge.getDirectorGreeting(directorCtx);
        if (g) {
          if (g.brand) setBrandLook({ font: g.brand.font || null, accentColor: g.brand.highlightColor || null });
          const parts: string[] = [];
          if (g.brand?.name) parts.push(`Brand: ${g.brand.name}`);
          if (g.piece?.headline) parts.push(`Piece: ${g.piece.headline}${g.piece.platform ? ` (${g.piece.platform})` : ""}`);
          if (g.piece?.hook) parts.push(`Hook: "${g.piece.hook}"`);
          const greetingMsg: DirectorChatMessage = {
            id: safeUUID(),
            sender: "director",
            text: g.greeting,
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            plannerSource: "deterministic",
            plannerReason: "brand and script greeting (no LLM call)",
            warnings: g.warnings,
            ...(g.suggestedPrompt
              ? {
                  pendingConfirmation: {
                    whatFound: parts.join(" \u00b7 "),
                    whatWillChange: g.steps.map((st) => `\u2022 ${st}`).join("\n"),
                    assumptions: "",
                    suggestedPrompt: g.suggestedPrompt,
                  },
                }
              : {}),
          };
          setAiMessages((prev) => (prev.length === 0 ? [greetingMsg] : prev));
        }
      } catch (err: any) {
        const msg: DirectorChatMessage = {
          id: safeUUID(),
          sender: "director",
          text: `I couldn't load the brand and script for this piece (${err?.message || "unknown error"}). You can still edit; reopen the Studio from the calendar to try again.`,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };
        setAiMessages((prev) => (prev.length === 0 ? [msg] : prev));
      }
    }

    return currentManifest;
  };

  const loadProject = async (id: string) => {
    const loaded = ProjectStorageService.loadProjectManifest(id);
    if (loaded) {
      // Re-hydrate any expired browser blob URLs from IndexedDB or replace with safe offline slate
      let repaired = await MediaCacheService.verifyAndRepairProjectManifest(loaded);
      repaired = await applySocialMediaContext(repaired, id);
      setProject(repaired);
      setHistory([repaired.editIR]);
      setHistoryIndex(0);
      const aspect = repaired.editIR.meta.targetAspect;
      if (aspect === "9:16" || aspect === "1:1" || aspect === "16:9") {
        setAspectRatio(aspect);
      } else {
        setAspectRatio("16:9");
      }
    } else {
      createNewProject("CUSTOM", id);
    }
  };

  const createNewProject = async (templatePreset: string, targetProjId?: string | null) => {
    const newProj = await engineBridge.openProject();
    newProj.editIR.directorStyle.preset = (templatePreset as DirectorStylePreset) || "CUSTOM";
    let repaired = await MediaCacheService.verifyAndRepairProjectManifest(newProj);
    repaired = await applySocialMediaContext(repaired, targetProjId);
    setProject(repaired);
    setHistory([repaired.editIR]);
    setHistoryIndex(0);
  };

  const lastDirectorApplyRef = useRef<{ runId?: string; index: number; summary?: string } | null>(null);
  const pushHistory = (newEditIR: EditIR) => {
    if (!project) return;
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newEditIR);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    const updated = { ...project, editIR: newEditIR };
    setProject(updated);
    ProjectStorageService.saveProject(updated);
  };

  const handleUndo = () => {
    // Undoing a director edit right after it landed is a "rejected" signal for the project's agent memory.
    const lastAi = lastDirectorApplyRef.current;
    if (lastAi && lastAi.index === historyIndex) {
      sendDirectorFeedback({ accepted: false, runId: lastAi.runId, summary: lastAi.summary });
      lastDirectorApplyRef.current = null;
    }
    if (historyIndex > 0 && project) {
      const nextIndex = historyIndex - 1;
      setHistoryIndex(nextIndex);
      const targetIR = history[nextIndex];
      setProject({ ...project, editIR: targetIR });
      ProjectStorageService.saveProject({ ...project, editIR: targetIR });
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1 && project) {
      const nextIndex = historyIndex + 1;
      setHistoryIndex(nextIndex);
      const targetIR = history[nextIndex];
      setProject({ ...project, editIR: targetIR });
      ProjectStorageService.saveProject({ ...project, editIR: targetIR });
    }
  };

  const handleRenameProject = (newName: string) => {
    if (!project) return;
    const cleanName = newName.trim() || "Untitled Project";
    const updated = {
      ...project,
      project: {
        ...project.project,
        name: cleanName,
        updatedAt: new Date().toISOString(),
      },
      editIR: {
        ...project.editIR,
        meta: {
          ...project.editIR.meta,
          title: cleanName,
        },
      },
    };
    setProject(updated);
    ProjectStorageService.saveProject(updated);
    engineBridge.saveProject(updated);
  };

  const handleSelectPreset = (preset: DirectorStylePreset) => {
    if (!project) return;
    pushHistory({
      ...project.editIR,
      directorStyle: {
        ...project.editIR.directorStyle,
        preset,
      },
    });
  };

  const handleApplyAiPrompt = async (prompt: string, options: DirectorPromptOptions = {}) => {
    if (!project) return;
    // A short "yes / proceed" confirms the latest pending proposal instead of starting a new turn.
    const pending = [...aiMessages].reverse().find((m) => m.pendingConfirmation);
    if (pending && !options.offline && CONFIRM_REPLY.test(prompt.trim())) {
      setAiMessages((prev) => [
        ...prev,
        { id: safeUUID(), sender: "user", text: prompt, timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) },
      ]);
      handleConfirmAutonomousEdit(pending);
      return;
    }
    setIsAiProcessing(true);
    setAiProgress(null);

    const userMsg: DirectorChatMessage = {
      id: safeUUID(),
      sender: "user",
      text: prompt,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    setAiMessages((prev) => [...prev, userMsg]);

    const mainTrack = project.editIR.tracks.videoTracks[0];
    const clips = mainTrack?.clips || [];
    const isZeroFootage = clips.length === 0 && (!project.assets || project.assets.length === 0);

    try {
      if (isZeroFootage) {
        // Zero-Footage Autonomous Creative Ad / Video Pipeline
        const result = await engineBridge.generateFromPrompt({
          prompt,
          companyId: authSession.companyId,
          targetAspect: aspectRatio,
          customStyleKey: project.editIR.directorStyle.preset,
          onProgress: (event: any) => setAiProgress(event),
        });

        if (result && result.editIR) {
          pushHistory(result.editIR);
          selectFirstNewItem(project.editIR, result.editIR);
          const replyMsg: DirectorChatMessage = {
            id: safeUUID(),
            sender: "director",
            text: describeGeneratedVideo(result.editIR, result.plan),
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            actions: (result.plan?.operations || []).map((op: any) => String(op?.type || "")).filter(Boolean).slice(0, 8),
            snapshotEditIR: result.editIR,
          };
          setAiMessages((prev) => [...prev, replyMsg]);
        }
      } else {
        const history: DirectorHistoryTurn[] = aiMessages
          .filter((m) => m.text && !m.retryPrompt)
          .slice(-12)
          .map((m) => ({ role: m.sender === "user" ? "user" : "assistant", content: m.text.slice(0, 2000) }));
        const pipelineOptions = {
          availableAssets: project.assets,
          selectedClipId,
          playheadSec: currentTimeSeconds,
          onProgress: (event: any) => setAiProgress(event),
        };
        const repairing = !!options.lastExportQa;
        const { job, signal } = studioJobs.create("director", repairing ? "AI Director: fixing the export" : "AI Director");
        directorJobRef.current = job.id;
        studioJobs.transition(job.id, repairing ? "REPAIRING" : "PLANNING");
        const before = project.editIR;
        const locks = locksFromTimelineKeys(before, trackLocks);
        const durationMs = Math.round(RationalTimeMath.toSeconds(before.meta.totalDuration) * 1000);
        const rangesToKeep = normalizeRanges([...lockedRangesMs, ...(locks.mainLocked ? [[0, durationMs] as [number, number]] : [])], durationMs);
        let result;
        try {
          result = options.offline
            ? await engineBridge.executeOfflineDirector(before.directorStyle.preset, prompt, before, pipelineOptions)
            : await engineBridge.executeAutonomousPipeline(project.assets[0]?.filePath || "input.mp4", before.directorStyle.preset, prompt, authSession.companyId, before, {
                ...pipelineOptions,
                context: directorContextFromUrl(),
                history,
                signal,
                constraints: buildDirectorConstraints(before, trackLocks, lockedRangesMs),
                lastExportQa: options.lastExportQa,
                onStage: (stage) => {
                  if (!repairing) studioJobs.transition(job.id, stage);
                },
              });
        } catch (err: any) {
          if (signal.aborted || studioJobs.isCancelled(job.id)) {
            studioJobs.transition(job.id, "CANCELLED");
            setAiMessages((prev) => [
              ...prev,
              { id: safeUUID(), sender: "director", text: "Stopped. Nothing was changed.", timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) },
            ]);
            return;
          }
          studioJobs.fail(job.id, String(err?.message || err));
          throw err;
        } finally {
          directorJobRef.current = null;
        }
        if (studioJobs.isCancelled(job.id)) return;

        // Defense in depth: the server enforces the locks; re-check the result before it can touch the timeline.
        const lockCheck = enforceLocksOnResult(before, result.editIR, { tracks: locks.tracks, rangesMs: rangesToKeep });
        if (lockCheck.blocked) {
          studioJobs.fail(job.id, "The result would change footage you locked.");
          setAiMessages((prev) => [
            ...prev,
            {
              id: safeUUID(),
              sender: "director",
              text: "I did not apply this edit: it would change footage you locked. Ask for a change outside the locked range, or remove the lock on the timeline ruler.",
              timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
              violations: lockCheck.rangeProblems,
              retryPrompt: prompt,
            },
          ]);
          return;
        }
        result = { ...result, editIR: lockCheck.editIR };
        const violations = [...(result.violations || []), ...lockCheck.restoredTracks.map((t) => `kept the locked ${t} (the result had changed it)`)];
        const provenance = {
          plannerSource: result.plannerSource,
          plannerReason: result.plannerReason,
          warnings: result.warnings.length ? result.warnings : undefined,
          autoApplied: result.autoApplied,
          critique: result.critique,
          runId: result.runId,
          violations: violations.length ? violations : undefined,
        };
        if (result.requiresConfirmation && !options.preconfirmed) {
          studioJobs.complete(job.id, "Waiting for your review");
        } else {
          studioJobs.transition(job.id, "EDITING");
          studioJobs.complete(job.id);
        }

        if (result.requiresConfirmation && !options.preconfirmed) {
          const confirmMsg: DirectorChatMessage = {
            id: safeUUID(),
            sender: "director",
            text: result.reply || "I have prepared the autonomous edit based on your request. Please review the planned changes below:",
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            actions: result.actions,
            ...provenance,
            pendingConfirmation: {
              whatFound: result.confirmationDetails?.whatFound || "",
              whatWillChange: result.confirmationDetails?.whatWillChange || (result.actions || []).map((a) => `\u2022 ${a}`).join("\n") || "See the reply above.",
              assumptions: result.confirmationDetails?.assumptions || "",
              targetEditIR: result.editIR,
            },
          };
          setAiMessages((prev) => [...prev, confirmMsg]);
        } else {
          pushHistory(result.editIR);
          lastDirectorApplyRef.current = { runId: result.runId, index: historyIndex + 1, summary: result.reply };
          selectFirstNewItem(project.editIR, result.editIR);
          const replyMsg: DirectorChatMessage = {
            id: safeUUID(),
            sender: "director",
            text: result.reply || "I reviewed your project and updated the edit to match your direction.",
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            actions: result.actions,
            ...provenance,
            snapshotEditIR: result.editIR,
          };
          setAiMessages((prev) => [...prev, replyMsg]);
        }
      }
    } catch (err: any) {
      console.error("AI Director pipeline failed:", err);
      const isCreditErr = err?.message?.includes("INSUFFICIENT_AI_CREDITS") || err?.message?.includes("Credit balance is too low");
      const errMsg: DirectorChatMessage = {
        id: safeUUID(),
        sender: "director",
        text: isCreditErr
          ? "⚠️ Insufficient AI Credits to generate this video. Please click 'Top Up' in the AI Credits widget above to recharge your balance."
          : `The AI Director could not complete this: ${err?.message || "Internal error"}${err instanceof DirectorRequestError && err.code !== "NETWORK_ERROR" && err.code !== "DIRECTOR_TIMEOUT" ? ` (${err.code})` : ""}. Retry, or use the offline rules on this device.`,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        ...(isCreditErr || isZeroFootage ? {} : { retryPrompt: prompt }),
      };
      setAiMessages((prev) => [...prev, errMsg]);
    } finally {
      setIsAiProcessing(false);
      setAiProgress(null);
    }
  };

  const handleConfirmAutonomousEdit = (message: DirectorChatMessage) => {
    const suggested = message.pendingConfirmation?.suggestedPrompt;
    if (!message.pendingConfirmation?.targetEditIR && suggested) {
      const hasFootage = !!project && (project.assets.length > 0 || (project.editIR.tracks.videoTracks[0]?.clips.length || 0) > 0);
      if (!hasFootage) {
        toast("Import your footage first, then press Apply.");
        return;
      }
      setAiMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, pendingConfirmation: undefined } : m)));
      void handleApplyAiPrompt(suggested, { preconfirmed: true });
      return;
    }
    if (!message.pendingConfirmation?.targetEditIR) return;
    if (project) selectFirstNewItem(project.editIR, message.pendingConfirmation.targetEditIR);
    pushHistory(message.pendingConfirmation.targetEditIR);
    lastDirectorApplyRef.current = { runId: message.runId, index: historyIndex + 1, summary: message.text };
    sendDirectorFeedback({ accepted: true, runId: message.runId, summary: message.text });
    setAiMessages((prev) =>
      prev.map((m) =>
        m.id === message.id
          ? {
              ...m,
              pendingConfirmation: undefined,
              text: `${m.text}\n\n✅ *Changes confirmed and applied to timeline.*`,
              snapshotEditIR: message.pendingConfirmation!.targetEditIR,
            }
          : m
      )
    );
  };

  const handleCancelDirectorRun = () => {
    if (directorJobRef.current) studioJobs.cancel(directorJobRef.current);
  };

  /** Sends the last export's QA to the director as a repair turn. */
  const handleAskDirectorFix = () => {
    const qa = exportedResult?.qa;
    if (!qa || !qa.issues.length) return;
    setIsExportModalOpen(false);
    setLeftSidebarTab("director");
    setIsLeftPanelOpen(true);
    const list = qa.issues.map((i) => `- ${i.title}${i.timeRangeMs ? ` (at ${(i.timeRangeMs[0] / 1000).toFixed(1)} s)` : ""}`).join("\n");
    void handleApplyAiPrompt(`Fix the problems the quality check found in the last export:\n${list}`, { lastExportQa: qa.report });
  };

  /** Locks the selected item's timeline range for the AI Director. */
  const handleLockSelectedRange = () => {
    if (!project || !selectedClipId) return;
    const t = project.editIR.tracks;
    const ranges = [
      ...t.videoTracks.flatMap((v) => v.clips.map((c) => ({ id: c.id, r: c.timelineRange }))),
      ...t.audioTracks.flatMap((a) => a.clips.map((c) => ({ id: c.id, r: c.timelineRange }))),
      ...(t.captionTrack ?? []).map((c) => ({ id: c.id, r: c.timeRange })),
      ...(t.effectTrack ?? []).map((e) => ({ id: e.id, r: e.timeRange })),
      ...(t.cameraTrack ?? []).map((e) => ({ id: e.id, r: e.timeRange })),
    ];
    const hit = ranges.find((x) => x.id === selectedClipId);
    if (!hit) return;
    const s0 = Math.round(RationalTimeMath.toSeconds(hit.r.start) * 1000);
    const e0 = s0 + Math.round(RationalTimeMath.toSeconds(hit.r.duration) * 1000);
    setLockedRangesMs((prev) => normalizeRanges([...prev, [s0, e0]], Math.round(RationalTimeMath.toSeconds(project.editIR.meta.totalDuration) * 1000)));
    toast.success(`Locked ${(s0 / 1000).toFixed(1)}–${(e0 / 1000).toFixed(1)} s for the AI Director`);
  };

  const handleCancelAutonomousEdit = (message: DirectorChatMessage) => {
    setAiMessages((prev) =>
      prev.map((m) =>
        m.id === message.id
          ? {
              ...m,
              pendingConfirmation: undefined,
              text: `${m.text}\n\n❌ *Edit discarded.*`,
            }
          : m
      )
    );
  };

  const handleRevertToAiMessage = (message: DirectorChatMessage) => {
    if (message.snapshotEditIR) {
      pushHistory(message.snapshotEditIR);
    }
  };

  const handleClearAiMessages = () => {
    setAiMessages([]);
  };

  const handleImportFiles = async (files: FileList | File[]) => {
    if (!project) return;
    const newAssets: MediaAssetDescriptor[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const descriptor = await engineBridge.probeBrowserFile(file);
      newAssets.push(descriptor);
    }

    addAssetsToProject(newAssets);
  };

  /** Desktop app: native file dialog, real paths and real ffprobe metadata, so the timeline can be rendered by FFmpeg. */
  const handleImportNative = async () => {
    try {
      const { assets, failures } = await engineBridge.importNativeAssets();
      if (assets.length > 0) addAssetsToProject(assets);
      for (const f of failures) toast.error(`Could not import ${f.name}: ${f.error}`);
    } catch (err: any) {
      toast.error(err?.message || "Could not open the file picker.");
    }
  };

  const openImportDialog = () => {
    if (hasNativeMedia()) void handleImportNative();
    else fileInputRef.current?.click();
  };

  const addAssetsToProject = (newAssets: MediaAssetDescriptor[]) => {
    if (!project) return;
    const updatedAssets = [...project.assets, ...newAssets];
    let updatedEditIR = { ...project.editIR };

    // Auto-populate video track if currently empty
    const mainTrack = updatedEditIR.tracks.videoTracks[0];
    if (mainTrack && mainTrack.clips.length === 0 && newAssets.length > 0) {
      let curTime = 0;
      const newClips: VideoClip[] = [];

      for (const asset of newAssets) {
        const isAudio = asset.mimeType?.startsWith("audio/") || Boolean(asset.name.match(/\.(mp3|wav|aac|m4a|flac)$/i));
        if (isAudio) continue;

        const durSec = Math.max(1, asset.durationSeconds || 5.0);
        const clipDur = RationalTimeMath.fromSeconds(durSec);
        newClips.push({
          id: safeUUID(),
          assetId: asset.id,
          sourcePath: asset.filePath,
          sourceRange: { start: RationalTimeMath.fromSeconds(0), duration: clipDur },
          timelineRange: { start: RationalTimeMath.fromSeconds(curTime), duration: clipDur },
          transform: {
            scale: { start: 1.0, end: 1.0, easing: "spring" },
            position: { x: 0, y: 0 },
            anchor: { x: 0.5, y: 0.5 },
            rotationDeg: 0,
            opacity: 1.0,
            crop: { top: 0, bottom: 0, left: 0, right: 0 },
          },
          speedMultiplier: 1.0,
          effects: [],
        });
        curTime += durSec;
      }

      if (newClips.length > 0) {
        updatedEditIR = {
          ...updatedEditIR,
          meta: {
            ...updatedEditIR.meta,
            totalDuration: RationalTimeMath.fromSeconds(curTime),
          },
          tracks: {
            ...updatedEditIR.tracks,
            videoTracks: [{ ...mainTrack, clips: newClips }],
          },
        };
      }
    }

    const updatedProject = {
      ...project,
      assets: updatedAssets,
      editIR: updatedEditIR,
    };

    setProject(updatedProject);
    pushHistory(updatedEditIR);
    ProjectStorageService.saveProject(updatedProject);
  };

  const handleAddClipToTimeline = (asset: MediaAssetDescriptor) => {
    if (!project) return;

    // 1. Ensure asset exists in project asset bin
    const assetExists = project.assets.some((a) => a.id === asset.id);
    const updatedAssets = assetExists ? project.assets : [...project.assets, asset];

    const updatedEditIR: EditIR = JSON.parse(JSON.stringify(project.editIR));

    const isAudio =
      asset.mimeType?.startsWith("audio/") ||
      Boolean(asset.name.match(/\.(mp3|wav|aac|m4a|flac|ogg)$/i)) ||
      asset.id.startsWith("stock_audio");

    const isSFX =
      asset.name.toLowerCase().startsWith("sfx:") ||
      asset.id.toLowerCase().includes("sfx") ||
      asset.name.toLowerCase().includes("sfx");

    const isImage =
      asset.mimeType?.startsWith("image/") ||
      Boolean(asset.name.match(/\.(jpg|jpeg|png|webp|gif|svg)$/i)) ||
      asset.id.startsWith("stock_img");

    if (isAudio) {
      // 2. Audio Asset handling (Background Music or SFX)
      const targetType = isSFX ? "SFX" : "BGM";
      let targetTrack = updatedEditIR.tracks.audioTracks.find((t) => t.type === targetType);

      if (!targetTrack) {
        targetTrack = {
          id: `track_audio_${targetType.toLowerCase()}_${Date.now()}`,
          type: targetType,
          volumeDb: targetType === "BGM" ? -18.0 : -4.0,
          duckWithSpeech: targetType === "BGM",
          duckingConfig:
            targetType === "BGM" ? { duckDb: -18, attackMs: 120, releaseMs: 350 } : undefined,
          clips: [],
        };
        updatedEditIR.tracks.audioTracks.push(targetTrack);
      }

      const clipDurSec = Math.max(0.5, asset.durationSeconds || (isSFX ? 1.5 : 30.0));
      const startSec = isSFX
        ? currentTimeSeconds
        : currentTimeSeconds > 0
        ? currentTimeSeconds
        : 0;

      const newAudioClip = {
        id: `aclip_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        sourcePath: asset.filePath,
        sourceRange: {
          start: RationalTimeMath.fromSeconds(0),
          duration: RationalTimeMath.fromSeconds(clipDurSec),
        },
        timelineRange: {
          start: RationalTimeMath.fromSeconds(startSec),
          duration: RationalTimeMath.fromSeconds(clipDurSec),
        },
        volumeDb: 0.0,
        sourceQuery: asset.name,
      };

      targetTrack.clips.push(newAudioClip);

      const currentTotalSec = RationalTimeMath.toSeconds(updatedEditIR.meta.totalDuration);
      if (startSec + clipDurSec > currentTotalSec) {
        updatedEditIR.meta.totalDuration = RationalTimeMath.fromSeconds(startSec + clipDurSec);
      }

      toast.success(
        `Added ${targetType === "SFX" ? "sound effect" : "background music"} to track at ${startSec.toFixed(1)}s!`
      );
    } else {
      // 3. Visual Asset handling (Video or Photo B-Roll / Overlay)
      const mainTrack = updatedEditIR.tracks.videoTracks[0];

      if (!mainTrack || mainTrack.clips.length === 0) {
        // Main track is empty: place as primary clip
        const durSec = isImage ? 4.0 : Math.max(1, asset.durationSeconds || 5.0);
        const newClip: VideoClip = {
          id: safeUUID(),
          assetId: asset.id,
          sourcePath: asset.filePath,
          sourceRange: {
            start: RationalTimeMath.fromSeconds(0),
            duration: RationalTimeMath.fromSeconds(durSec),
          },
          timelineRange: {
            start: RationalTimeMath.fromSeconds(0),
            duration: RationalTimeMath.fromSeconds(durSec),
          },
          transform: {
            scale: { start: 1.0, end: 1.0, easing: "spring" },
            position: { x: 0, y: 0 },
            anchor: { x: 0.5, y: 0.5 },
            rotationDeg: 0,
            opacity: 1.0,
            crop: { top: 0, bottom: 0, left: 0, right: 0 },
          },
          speedMultiplier: 1.0,
          effects: [],
          ...(isImage ? { mediaType: "image" as const } : {}),
        };

        if (!mainTrack) {
          updatedEditIR.tracks.videoTracks.unshift({
            id: "track_main_v1",
            type: "MAIN_VIDEO",
            zIndex: 1,
            clips: [newClip],
          });
        } else {
          mainTrack.clips.push(newClip);
        }

        updatedEditIR.meta.totalDuration = RationalTimeMath.fromSeconds(durSec);
        setSelectedClipId(newClip.id);
        toast.success("Added clip to main video track!");
      } else {
        // Main track has clips: add as B-Roll Overlay on V2 at current playhead!
        let brollTrack = updatedEditIR.tracks.videoTracks.find(
          (t) => t.type === "B_ROLL_OVERLAY"
        );
        if (!brollTrack) {
          brollTrack = {
            id: `track_broll_v2`,
            type: "B_ROLL_OVERLAY",
            zIndex: 10,
            clips: [],
          };
          updatedEditIR.tracks.videoTracks.push(brollTrack);
        }

        const durSec = isImage
          ? 3.0
          : Math.min(15, Math.max(1.5, asset.durationSeconds || 4.0));
        const startSec = currentTimeSeconds;

        const newClip: VideoClip = {
          id: safeUUID(),
          assetId: asset.id,
          sourcePath: asset.filePath,
          sourceRange: {
            start: RationalTimeMath.fromSeconds(0),
            duration: RationalTimeMath.fromSeconds(durSec),
          },
          timelineRange: {
            start: RationalTimeMath.fromSeconds(startSec),
            duration: RationalTimeMath.fromSeconds(durSec),
          },
          transform: {
            scale: { start: 1.0, end: 1.0, easing: "spring" },
            position: { x: 0, y: 0 },
            anchor: { x: 0.5, y: 0.5 },
            rotationDeg: 0,
            opacity: 1.0,
            crop: { top: 0, bottom: 0, left: 0, right: 0 },
          },
          speedMultiplier: 1.0,
          effects: [],
          // a still photo, held for its slot and drawn to cover the canvas (all renderers)
          ...(isImage ? { mediaType: "image" as const } : {}),
        };

        brollTrack.clips.push(newClip);

        const currentTotalSec = RationalTimeMath.toSeconds(updatedEditIR.meta.totalDuration);
        if (startSec + durSec > currentTotalSec) {
          updatedEditIR.meta.totalDuration = RationalTimeMath.fromSeconds(startSec + durSec);
        }

        setSelectedClipId(newClip.id);
        setLeftSidebarTab("inspector");
        setIsLeftPanelOpen(true);
        toast.success(`Added ${isImage ? "image" : "B-Roll"} overlay at ${startSec.toFixed(1)}s!`);
      }
    }

    const updatedProject = {
      ...project,
      assets: updatedAssets,
      editIR: updatedEditIR,
    };

    setProject(updatedProject);
    pushHistory(updatedEditIR);
    ProjectStorageService.saveProject(updatedProject);
  };

  const handleSplitClip = () => {
    if (!project) return;
    let targetTrackIdx = -1;
    let targetClip: VideoClip | undefined;

    for (let i = 0; i < project.editIR.tracks.videoTracks.length; i++) {
      const t = project.editIR.tracks.videoTracks[i];
      if (selectedClipId) {
        targetClip = t.clips.find((c) => c.id === selectedClipId);
        if (targetClip) {
          targetTrackIdx = i;
          break;
        }
      } else {
        targetClip = t.clips.find((c) => {
          const start = RationalTimeMath.toSeconds(c.timelineRange.start);
          const dur = RationalTimeMath.toSeconds(c.timelineRange.duration);
          return currentTimeSeconds > start && currentTimeSeconds < start + dur;
        });
        if (targetClip) {
          targetTrackIdx = i;
          break;
        }
      }
    }

    if (!targetClip || targetTrackIdx === -1) {
      toast.error("Place playhead over a clip to split it");
      return;
    }

    const clipStart = RationalTimeMath.toSeconds(targetClip.timelineRange.start);
    const clipDur = RationalTimeMath.toSeconds(targetClip.timelineRange.duration);
    const splitOffset = currentTimeSeconds - clipStart;

    if (splitOffset <= 0.05 || splitOffset >= clipDur - 0.05) return;

    const srcStart = RationalTimeMath.toSeconds(targetClip.sourceRange.start);

    const firstClip: VideoClip = {
      ...targetClip,
      sourceRange: {
        start: RationalTimeMath.fromSeconds(srcStart),
        duration: RationalTimeMath.fromSeconds(splitOffset),
      },
      timelineRange: {
        start: RationalTimeMath.fromSeconds(clipStart),
        duration: RationalTimeMath.fromSeconds(splitOffset),
      },
    };

    const secondClip: VideoClip = {
      ...targetClip,
      id: safeUUID(),
      sourceRange: {
        start: RationalTimeMath.fromSeconds(srcStart + splitOffset),
        duration: RationalTimeMath.fromSeconds(clipDur - splitOffset),
      },
      timelineRange: {
        start: RationalTimeMath.fromSeconds(currentTimeSeconds),
        duration: RationalTimeMath.fromSeconds(clipDur - splitOffset),
      },
    };

    const targetTrack = project.editIR.tracks.videoTracks[targetTrackIdx];
    const updatedClips = targetTrack.clips.flatMap((c) => (c.id === targetClip!.id ? [firstClip, secondClip] : [c]));
    const updatedVideoTracks = [...project.editIR.tracks.videoTracks];
    updatedVideoTracks[targetTrackIdx] = { ...targetTrack, clips: updatedClips };

    const updatedIR: EditIR = {
      ...project.editIR,
      tracks: {
        ...project.editIR.tracks,
        videoTracks: updatedVideoTracks,
      },
    };

    pushHistory(updatedIR);
    setSelectedClipId(secondClip.id);
  };

  const handleDeleteSelectedClip = () => {
    if (!project || !selectedClipId) return;

    // Effects and titles live outside the video/audio tracks.
    const withoutOverlay = removeOverlayItem(project.editIR, selectedClipId);
    if (withoutOverlay !== project.editIR) {
      pushHistory(withoutOverlay);
      setSelectedClipId(null);
      toast.success("Removed from timeline");
      return;
    }

    // Check video tracks
    let foundInVideo = false;
    const updatedVideoTracks = project.editIR.tracks.videoTracks.map((t, idx) => {
      if (t.clips.some((c) => c.id === selectedClipId)) {
        foundInVideo = true;
        const remaining = t.clips.filter((c) => c.id !== selectedClipId);
        // Only reindex timeline time on main video track
        if (idx === 0) {
          let curTime = 0;
          return {
            ...t,
            clips: remaining.map((c) => {
              const dur = RationalTimeMath.toSeconds(c.timelineRange.duration);
              const updated = {
                ...c,
                timelineRange: {
                  start: RationalTimeMath.fromSeconds(curTime),
                  duration: c.timelineRange.duration,
                },
              };
              curTime += dur;
              return updated;
            }),
          };
        }
        return { ...t, clips: remaining };
      }
      return t;
    });

    // Also check audio tracks
    const updatedAudioTracks = project.editIR.tracks.audioTracks.map((at) => ({
      ...at,
      clips: at.clips.filter((ac) => ac.id !== selectedClipId),
    }));

    const updatedIR: EditIR = {
      ...project.editIR,
      tracks: {
        ...project.editIR.tracks,
        videoTracks: updatedVideoTracks,
        audioTracks: updatedAudioTracks,
      },
    };

    pushHistory(updatedIR);
    setSelectedClipId(null);
    toast.success("Removed clip from timeline");
  };

  const handleDetachAudio = () => {
    if (!project || !selectedClipId) return;
    const mainTrack = project.editIR.tracks.videoTracks[0];
    if (!mainTrack) return;

    const clip = mainTrack.clips.find((c) => c.id === selectedClipId);
    if (!clip) return;

    const existingAudioTracks = [...(project.editIR.tracks.audioTracks || [])];
    let voiceTrack = existingAudioTracks.find((t) => t.type === "PRIMARY_VOICE");

    if (!voiceTrack) {
      voiceTrack = {
        id: safeUUID(),
        type: "PRIMARY_VOICE",
        volumeDb: 0.0,
        duckWithSpeech: false,
        clips: [],
      };
      existingAudioTracks.unshift(voiceTrack);
    }

    const targetVoiceTrackId = voiceTrack.id;
    const detachedAudioClip = {
      id: safeUUID(),
      sourcePath: clip.sourcePath,
      sourceRange: { ...clip.sourceRange },
      timelineRange: { ...clip.timelineRange },
      volumeDb: clip.volumeDb ?? 0.0,
    };

    const updatedAudioTracks = existingAudioTracks.map((t) =>
      t.id === targetVoiceTrackId ? { ...t, clips: [...t.clips, detachedAudioClip] } : t
    );

    // Mute the video clip
    const updatedClips = mainTrack.clips.map((c) =>
      c.id === selectedClipId ? { ...c, volumeDb: -60.0 } : c
    );

    const updatedIR: EditIR = {
      ...project.editIR,
      tracks: {
        ...project.editIR.tracks,
        videoTracks: [{ ...mainTrack, clips: updatedClips }],
        audioTracks: updatedAudioTracks,
      },
    };

    pushHistory(updatedIR);
  };

  const handleAddTextOverlay = () => {
    if (!project) return;
    const isVertical = aspectRatio === "9:16";
    const newCaption: CaptionSegment = {
      id: safeUUID(),
      timeRange: {
        start: RationalTimeMath.fromSeconds(currentTimeSeconds),
        duration: RationalTimeMath.fromSeconds(3.0),
      },
      text: "NEW TITLE OVERLAY",
      words: [
        {
          word: "NEW",
          start: RationalTimeMath.fromSeconds(currentTimeSeconds),
          end: RationalTimeMath.fromSeconds(currentTimeSeconds + 0.8),
          highlight: true,
          color: isVertical ? "#FFE600" : "#FACC15",
          scaleMultiplier: 1.1,
        },
        {
          word: "TITLE",
          start: RationalTimeMath.fromSeconds(currentTimeSeconds + 0.8),
          end: RationalTimeMath.fromSeconds(currentTimeSeconds + 1.8),
          highlight: false,
          color: "#FFFFFF",
          scaleMultiplier: 1.0,
        },
        {
          word: "OVERLAY",
          start: RationalTimeMath.fromSeconds(currentTimeSeconds + 1.8),
          end: RationalTimeMath.fromSeconds(currentTimeSeconds + 3.0),
          highlight: false,
          color: "#FFFFFF",
          scaleMultiplier: 1.0,
        },
      ],
      style: {
        preset: "HORMOZI_BOUNCE",
        fontFamily: "Inter",
        fontSize: isVertical ? 52 : 46,
        textColor: "#FFFFFF",
        highlightColor: isVertical ? "#FFE600" : "#FACC15",
        position: { x: 0.5, y: isVertical ? 0.76 : 0.8 },
        shadow: true,
      },
    };

    const updatedCaptions = [...(project.editIR.tracks.captionTrack || []), newCaption];
    const totalSec = RationalTimeMath.toSeconds(project.editIR.meta.totalDuration);
    const newTotal = RationalTimeMath.fromSeconds(Math.max(totalSec, currentTimeSeconds + 3.0));

    pushHistory({
      ...project.editIR,
      meta: { ...project.editIR.meta, totalDuration: newTotal },
      tracks: { ...project.editIR.tracks, captionTrack: updatedCaptions },
    });
    setIsCaptionsModalOpen(true);
    toast.success("Added kinetic text overlay! Customize typography and preset in Studio.");
  };

  /** After the AI Director edits, select what it placed so the user can adjust it straight away. */
  const selectFirstNewItem = (before: EditIR, after: EditIR) => {
    const added = newTimelineItemIds(before, after);
    if (added.length > 0) setSelectedClipId(added[0]);
  };

  const handleAddTemplateTitle = (templateId: string, text: string) => {
    if (!project) return;
    const { editIR, segment } = addTitleFromTemplate(project.editIR, templateId, text, currentTimeSeconds, brandLook);
    pushHistory(editIR);
    setSelectedClipId(segment.id);
    toast.success(`Added "${textTemplateById(templateId)?.name ?? "title"}" at ${currentTimeSeconds.toFixed(1)}s`);
  };

  const handleAddEffect = (type: VideoEffectType, intensity: number) => {
    if (!project) return;
    const { editIR, effect } = addEffect(project.editIR, type, currentTimeSeconds, intensity);
    pushHistory(editIR);
    setSelectedClipId(effect.id);
    toast.success(`Added ${effectInfo(type).name} at ${currentTimeSeconds.toFixed(1)}s`);
  };

  const handleAddMusicTrack = () => {
    setLeftSidebarTab("stock");
    setIsLeftPanelOpen(true);
  };

  // Real-time Playback Loop
  useEffect(() => {
    if (!isPlaying || !project) return;

    const totalSec = RationalTimeMath.toSeconds(project.editIR.meta.totalDuration);
    const interval = setInterval(() => {
      setCurrentTimeSeconds((prev) => {
        if (prev >= totalSec) {
          setIsPlaying(false);
          return 0;
        }
        return prev + 1 / 30;
      });
    }, 1000 / 30);

    return () => clearInterval(interval);
  }, [isPlaying, project]);

  // Keyboard Shortcuts Listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }

      if (e.code === "Space") {
        e.preventDefault();
        setIsPlaying((p) => !p);
      }

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        const step = e.shiftKey ? 1.0 : 1 / 30;
        setCurrentTimeSeconds((t) => Math.max(0, t - step));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        const step = e.shiftKey ? 1.0 : 1 / 30;
        const totalSec = project ? RationalTimeMath.toSeconds(project.editIR.meta.totalDuration) : 60;
        setCurrentTimeSeconds((t) => Math.min(totalSec, t + step));
      }

      if (e.key === "Home") {
        e.preventDefault();
        setCurrentTimeSeconds(0);
      } else if (e.key === "End") {
        e.preventDefault();
        if (project) {
          const totalSec = RationalTimeMath.toSeconds(project.editIR.meta.totalDuration);
          setCurrentTimeSeconds(totalSec);
        }
      }

      if ((e.key === "s" || e.key === "S") && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleSplitClip();
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedClipId) {
          e.preventDefault();
          handleDeleteSelectedClip();
        }
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        handleRedo();
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === "e" || e.key === "E")) {
        e.preventDefault();
        setIsExportModalOpen(true);
      }

      if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setIsShortcutsModalOpen(true);
      }

      if (e.key === "Escape") {
        setIsExportModalOpen(false);
        setIsCaptionsModalOpen(false);
        setIsMixerModalOpen(false);
        setIsProxyModalOpen(false);
        setIsPluginModalOpen(false);
        setIsCacheModalOpen(false);
        setIsShortcutsModalOpen(false);
        setIsCriticDrawerOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [project, historyIndex, history, selectedClipId, currentTimeSeconds]);

  const handlePerformExport = async (settings: { format: string; resolution: string; fps: number }) => {
    if (!project) return;
    setExportFailure(null);
    setIsExporting(true);
    setExportProgress(0);
    const controller = new AbortController();
    exportAbortRef.current = controller;
    const { job, signal: jobSignal } = studioJobs.create("export", `Export ${settings.resolution}`, { settings });
    exportJobRef.current = job.id;
    jobSignal.addEventListener("abort", () => controller.abort(), { once: true });

    try {
      const result = await engineBridge.renderExport(
        project.editIR,
        settings,
        (pct) => {
          setExportProgress(pct);
          studioJobs.update(job.id, { progress: pct });
        },
        {
          signal: controller.signal,
          onNotice: (message) => toast(message, { icon: "ℹ️", duration: 9000 }),
          onStage: (stage, detail) =>
            stage === "DOWNLOADING"
              ? studioJobs.update(job.id, { detail: detail ? `Downloading ${detail}` : "Downloading stock media" })
              : studioJobs.transition(job.id, stage, { detail: detail ?? "" }),
        }
      );
      studioJobs.complete(job.id, result.qa ? `${result.qa.issues.length} issue(s) found by the quality check` : undefined);
      setExportedResult(result);
      setExportedPath(result.savedPath || result.downloadName);

      setAttachState(null);
      const target = directorContextFromUrl();
      if (target.calendarPieceId || target.postId) void attachExport(result);
    } catch (err: any) {
      if (err?.name === "RenderCancelledError") {
        studioJobs.transition(job.id, "CANCELLED");
        toast("Export cancelled.");
      } else {
        studioJobs.fail(job.id, err?.message || "The export failed.");
        console.error("Export failed:", err);
        setExportFailure({ message: err?.message || "The export failed.", blocked: err?.name === "ExportBlockedError", settings });
      }
    } finally {
      exportAbortRef.current = null;
      exportJobRef.current = null;
      setIsExporting(false);
    }
  };

  const handleCancelExport = () => {
    if (exportJobRef.current) studioJobs.cancel(exportJobRef.current);
    exportAbortRef.current?.abort();
  };

  /** An export interrupted by closing the app: run it again with the same settings (FFmpeg cannot continue half-way). */
  const handleResumeJob = (job: StudioJob) => {
    const settings = (job.resume as any)?.settings;
    if (job.kind === "export" && settings && typeof settings.resolution === "string") {
      setIsExportModalOpen(true);
      void handlePerformExport(settings);
    }
  };

  /** Uploads the rendered MP4 (or a file the user picked) to the calendar piece / post it was opened from. */
  const attachExport = async (source: ExportResult | File) => {
    const { calendarPieceId, postId } = directorContextFromUrl();
    if (!calendarPieceId && !postId) return;
    const label = calendarPieceId ? "calendar piece" : "post";
    setAttachState({ status: "uploading", progress: 0, label });
    const { job, signal } = studioJobs.create("attach", `Upload to the ${label}`);
    studioJobs.transition(job.id, "RENDERING", { detail: "Uploading" });
    try {
      await engineBridge.attachExportToSocial({
        target: { calendarPieceId, postId },
        source,
        signal,
        onProgress: (pct) => {
          setAttachState({ status: "uploading", progress: pct, label });
          studioJobs.update(job.id, { progress: pct });
        },
      });
      studioJobs.complete(job.id);
      setAttachState({ status: "done", progress: 100, label });
      toast.success(`Export attached to the ${label} and sent for review.`);
    } catch (err: any) {
      if (err?.name === "AbortError") {
        studioJobs.transition(job.id, "CANCELLED");
        setAttachState(null);
        return;
      }
      studioJobs.fail(job.id, err?.message || "The upload failed.");
      setAttachState({ status: "error", progress: 0, label, message: err?.message || "The upload failed." });
    }
  };

  const handleNavigateHome = () => {
    if (onExit) {
      onExit();
    } else if (onNavigateHome) {
      onNavigateHome();
    } else {
      setActiveView("home");
    }
  };

  if (!project) {
    return (
      <div className="h-screen w-screen bg-[#07090E] flex flex-col items-center justify-center text-white space-y-4">
        <div className="w-10 h-10 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
        <p className="text-sm font-medium text-gray-400">Loading 180 Media Studio...</p>
      </div>
    );
  }

  if (activeView === "home") {
    return (
      <HomeScreen
        onOpenProject={(id) => {
          loadProject(id);
          setActiveView("editor");
        }}
        companyAIStatus={companyAIStatus}
      />
    );
  }

  const selectedClip =
    project.editIR.tracks.videoTracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === selectedClipId) || null;

  return (
    <div className="h-screen w-screen flex flex-col bg-[#07090E] text-white overflow-hidden select-none font-sans">
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,audio/*,image/*"
        multiple
        className="hidden"
        onChange={(e) => e.target.files && handleImportFiles(e.target.files)}
      />

      {/* Top Header */}
      <HeaderBar
        projectName={project.project.name || project.editIR.meta.title || "Untitled Project"}
        onUpdateProjectName={handleRenameProject}
        authSession={authSession}
        companyAIStatus={companyAIStatus}
        isAiProcessing={isAiProcessing}
        canUndo={historyIndex > 0}
        canRedo={historyIndex < history.length - 1}
        aspectRatio={aspectRatio}
        onAspectRatioChange={setAspectRatio}
        onOpenExport={() => setIsExportModalOpen(true)}
        onOpenCaptions={() => setIsCaptionsModalOpen(true)}
        onSave={() => {
          ProjectStorageService.saveProject(project);
          engineBridge.saveProject(project);
        }}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onNavigateHome={handleNavigateHome}
      />

      {/* Main Workspace Body */}
      <div className="flex-1 flex overflow-hidden w-full relative">
        {/* Left Side: Single Unified 3-Tab AI & Operations Dock */}
        <LeftSidebarDock
          activeTab={leftSidebarTab}
          onTabChange={setLeftSidebarTab}
          isOpen={isLeftPanelOpen}
          onToggleOpen={() => setIsLeftPanelOpen((o) => !o)}
          width={leftPanelWidth}
          currentPreset={project.editIR.directorStyle.preset}
          onSelectPreset={handleSelectPreset}
          onApplyPrompt={handleApplyAiPrompt}
          isAiProcessing={isAiProcessing}
          aiProgress={aiProgress}
          companyAIStatus={companyAIStatus}
          onRefreshAIStatus={() => fetchCompanyAIStatus(authSession.companyId)}
          aiMessages={aiMessages}
          onRevertToAiMessage={handleRevertToAiMessage}
          onClearAiMessages={handleClearAiMessages}
          currentAspect={aspectRatio}
          timelineDurationSec={RationalTimeMath.toSeconds(project.editIR.meta.totalDuration)}
          clipsCount={project.editIR.tracks.videoTracks.reduce((acc, t) => acc + (t.clips?.length || 0), 0)}
          userProfile={{
            name: authSession.userName,
            email: authSession.userEmail,
          }}
          onConfirmAutonomousEdit={handleConfirmAutonomousEdit}
          onCancelAutonomousEdit={handleCancelAutonomousEdit}
          onCancelDirectorRun={handleCancelDirectorRun}
          onSeekMs={(ms) => setCurrentTimeSeconds(ms / 1000)}
          directorLockCount={Object.values(trackLocks).filter(Boolean).length + lockedRangesMs.length}
          selectedClip={selectedClip}
          selectedClipId={selectedClipId}
          currentTimeSeconds={currentTimeSeconds}
          onUpdateTransform={(transform) => {
            if (!selectedClipId) return;
            const updatedTracks = project.editIR.tracks.videoTracks.map((t) => ({
              ...t,
              clips: t.clips.map((c) => (c.id === selectedClipId ? { ...c, transform } : c)),
            }));
            pushHistory({
              ...project.editIR,
              tracks: { ...project.editIR.tracks, videoTracks: updatedTracks },
            });
          }}
          onUpdateSpeed={(speed) => {
            if (!selectedClipId) return;
            const updatedTracks = project.editIR.tracks.videoTracks.map((t) => ({
              ...t,
              clips: t.clips.map((c) => (c.id === selectedClipId ? { ...c, speedMultiplier: speed } : c)),
            }));
            pushHistory({
              ...project.editIR,
              tracks: { ...project.editIR.tracks, videoTracks: updatedTracks },
            });
          }}
          onUpdateVolume={(volumeDb) => {
            if (!selectedClipId) return;
            const updatedTracks = project.editIR.tracks.videoTracks.map((t) => ({
              ...t,
              clips: t.clips.map((c) => (c.id === selectedClipId ? { ...c, volumeDb } : c)),
            }));
            pushHistory({
              ...project.editIR,
              tracks: { ...project.editIR.tracks, videoTracks: updatedTracks },
            });
          }}
          onUpdateTransitions={(transitionIn, transitionOut) => {
            if (!selectedClipId) return;
            const updatedTracks = project.editIR.tracks.videoTracks.map((t) => ({
              ...t,
              clips: t.clips.map((c) => (c.id === selectedClipId ? { ...c, transitionIn, transitionOut } : c)),
            }));
            pushHistory({
              ...project.editIR,
              tracks: { ...project.editIR.tracks, videoTracks: updatedTracks },
            });
          }}
          onDetachAudio={handleDetachAudio}
          onDuplicateClip={() => {
            if (!selectedClipId) return;
            let dupClip: VideoClip | null = null;
            const updatedTracks = project.editIR.tracks.videoTracks.map((t) => {
              const clip = t.clips.find((c) => c.id === selectedClipId);
              if (!clip) return t;
              const startSec =
                RationalTimeMath.toSeconds(clip.timelineRange.start) +
                RationalTimeMath.toSeconds(clip.timelineRange.duration);
              dupClip = {
                ...clip,
                id: safeUUID(),
                timelineRange: {
                  ...clip.timelineRange,
                  start: RationalTimeMath.fromSeconds(startSec),
                },
              };
              return {
                ...t,
                clips: [...t.clips, dupClip],
              };
            });
            if (dupClip) {
              pushHistory({
                ...project.editIR,
                tracks: { ...project.editIR.tracks, videoTracks: updatedTracks },
              });
              setSelectedClipId((dupClip as VideoClip).id);
            }
          }}
          onDeleteClip={handleDeleteSelectedClip}
          onCloseInspector={() => setSelectedClipId(null)}
          editIR={project.editIR}
          onApplyCriticRepairs={(repairs) => {
            let updated: EditIR = JSON.parse(JSON.stringify(project.editIR));
            for (const cmd of repairs) {
              if (cmd.type === "ADD_CAMERA_EVENT") {
                updated.tracks.cameraTrack = [...(updated.tracks.cameraTrack || []), cmd.event];
              } else if (cmd.type === "ADD_CAPTION") {
                updated.tracks.captionTrack = [...(updated.tracks.captionTrack || []), cmd.caption];
              } else if (cmd.type === "APPLY_STYLE") {
                updated.directorStyle.preset = cmd.preset;
                if (cmd.pacingMultiplier) updated.directorStyle.pacingMultiplier = cmd.pacingMultiplier;
                if (cmd.zoomAggressiveness) updated.directorStyle.zoomAggressiveness = cmd.zoomAggressiveness;
              } else if (cmd.type === "ADD_CLIP") {
                const track =
                  updated.tracks.videoTracks.find((t) => t.id === cmd.trackId) ||
                  updated.tracks.videoTracks[0];
                if (track) track.clips.push(cmd.clip);
              } else if (cmd.type === "REMOVE_CLIP") {
                const track =
                  updated.tracks.videoTracks.find((t) => t.id === cmd.trackId) ||
                  updated.tracks.videoTracks[0];
                if (track) track.clips = track.clips.filter((c) => c.id !== cmd.clipId);
              }
            }
            pushHistory(updated);
          }}
          // Assets & Stock Media Props
          assets={project.assets}
          onImportFiles={openImportDialog}
          onAddAssetToProject={(asset: MediaAssetDescriptor) => {
            addAssetsToProject([asset]);
          }}
          onAddClipToTimeline={(asset: MediaAssetDescriptor) => {
            handleAddClipToTimeline(asset);
          }}
          onDeleteAsset={(assetId: string) => {
            const filtered = project.assets.filter((a) => a.id !== assetId);
            const updated = { ...project, assets: filtered };
            setProject(updated);
            ProjectStorageService.saveProject(updated);
          }}
          onAddAssetToTimeline={(asset: MediaAssetDescriptor) => {
            handleAddClipToTimeline(asset);
          }}
          brandLook={brandLook}
          onAddTitle={handleAddTemplateTitle}
          selectedEffect={project.editIR.tracks.effectTrack?.find((e) => e.id === selectedClipId) ?? null}
          onAddEffect={handleAddEffect}
          onUpdateEffectIntensity={(id, intensity) => pushHistory(setEffectIntensity(project.editIR, id, intensity))}
          onDeleteEffect={(id) => {
            pushHistory(removeOverlayItem(project.editIR, id));
            if (selectedClipId === id) setSelectedClipId(null);
          }}
        />

        {isLeftPanelOpen && (
          <ResizableSplitter
            direction="horizontal"
            onResize={(delta) => setLeftPanelWidth((w) => Math.max(280, Math.min(560, w + delta)))}
          />
        )}

        {/* Center: Remotion Canvas Viewport & Multitrack Timeline (Auto-Expanding 100% Flex) */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-[#07090E]">
          <div className="flex-1 min-w-0 overflow-hidden">
            <CanvasViewport
              editIR={project.editIR}
              assets={project.assets}
              currentTimeSeconds={currentTimeSeconds}
              isPlaying={isPlaying}
              aspectRatio={aspectRatio}
              selectedClipId={selectedClipId}
              onUpdateTransform={(transform) => {
                if (!selectedClipId) return;
                const track = project.editIR.tracks.videoTracks[0];
                if (!track) return;
                const updated = track.clips.map((c) =>
                  c.id === selectedClipId ? { ...c, transform } : c
                );
                pushHistory({
                  ...project.editIR,
                  tracks: { ...project.editIR.tracks, videoTracks: [{ ...track, clips: updated }] },
                });
              }}
              onTogglePlay={() => setIsPlaying((p) => !p)}
              onSeek={setCurrentTimeSeconds}
              onStepFrame={(dir) => setCurrentTimeSeconds((t) => Math.max(0, t + dir * (1 / 30)))}
              onAspectRatioChange={setAspectRatio}
              onOpenImport={openImportDialog}
            />
          </div>

          <ResizableSplitter
            direction="vertical"
            onResize={(delta) => setTimelineHeight((h) => Math.max(160, Math.min(500, h - delta)))}
          />

          <div style={{ height: `${timelineHeight}px` }} className="border-t border-[#1F1F24] bg-[#0E0E10] shrink-0">
            <Timeline
              editIR={project.editIR}
              currentTimeSeconds={currentTimeSeconds}
              zoomLevel={zoomLevel}
              selectedClipId={selectedClipId}
              isPlaying={isPlaying}
              aspectRatio={aspectRatio}
              onSeek={setCurrentTimeSeconds}
              onZoomChange={setZoomLevel}
              onTogglePlay={() => setIsPlaying((p) => !p)}
              onStepFrame={(dir) => setCurrentTimeSeconds((t) => Math.max(0, t + dir * (1 / 30)))}
              onAspectRatioChange={setAspectRatio}
              onOpenScopes={() => setIsScopesModalOpen(true)}
              onOpenSilenceTrimmer={() => setIsSilenceModalOpen(true)}
              lockedTracks={trackLocks}
              onToggleTrackLock={(key) => setTrackLocks((prev) => ({ ...prev, [key]: !prev[key] }))}
              lockedRangesMs={lockedRangesMs}
              onLockRange={handleLockSelectedRange}
              onUnlockRange={(i) => setLockedRangesMs((prev) => prev.filter((_, j) => j !== i))}
              onSelectClip={(clipId) => {
                setSelectedClipId(clipId);
                if (clipId) {
                  setLeftSidebarTab("inspector");
                  setIsLeftPanelOpen(true);
                }
              }}
              onSplitClip={handleSplitClip}
              onDeleteSelectedClip={handleDeleteSelectedClip}
              onUpdateClipTiming={(clipId, newStart, newDur) => {
                const updatedVideoTracks = project.editIR.tracks.videoTracks.map((t) => ({
                  ...t,
                  clips: t.clips.map((c) =>
                    c.id === clipId
                      ? {
                          ...c,
                          timelineRange: {
                            start: RationalTimeMath.fromSeconds(newStart),
                            duration: RationalTimeMath.fromSeconds(newDur),
                          },
                        }
                      : c
                  ),
                }));

                const updatedAudioTracks = project.editIR.tracks.audioTracks.map((at) => ({
                  ...at,
                  clips: at.clips.map((ac) =>
                    ac.id === clipId
                      ? {
                          ...ac,
                          timelineRange: {
                            start: RationalTimeMath.fromSeconds(newStart),
                            duration: RationalTimeMath.fromSeconds(newDur),
                          },
                        }
                      : ac
                  ),
                }));

                pushHistory(
                  retimeOverlayItem(
                    {
                      ...project.editIR,
                      tracks: {
                        ...project.editIR.tracks,
                        videoTracks: updatedVideoTracks,
                        audioTracks: updatedAudioTracks,
                      },
                    },
                    clipId,
                    newStart,
                    newDur
                  )
                );
              }}
              onDuplicateClip={() => {
                if (!selectedClipId) return;
                let dupClip: VideoClip | null = null;
                const updatedTracks = project.editIR.tracks.videoTracks.map((t) => {
                  const clip = t.clips.find((c) => c.id === selectedClipId);
                  if (!clip) return t;
                  const startSec =
                    RationalTimeMath.toSeconds(clip.timelineRange.start) +
                    RationalTimeMath.toSeconds(clip.timelineRange.duration);
                  dupClip = {
                    ...clip,
                    id: safeUUID(),
                    timelineRange: {
                      ...clip.timelineRange,
                      start: RationalTimeMath.fromSeconds(startSec),
                    },
                  };
                  return {
                    ...t,
                    clips: [...t.clips, dupClip],
                  };
                });
                if (dupClip) {
                  pushHistory({
                    ...project.editIR,
                    tracks: { ...project.editIR.tracks, videoTracks: updatedTracks },
                  });
                  setSelectedClipId((dupClip as VideoClip).id);
                }
              }}
              onAddTextOverlay={handleAddTextOverlay}
              onAddAudioTrack={handleAddMusicTrack}
              onOpenCaptions={() => setIsCaptionsModalOpen(true)}
              onOpenShortcuts={() => setIsShortcutsModalOpen(true)}
              onUpdateClipTransition={(clipId, transitionIn, transitionOut) => {
                const updatedTracks = project.editIR.tracks.videoTracks.map((t) => ({
                  ...t,
                  clips: t.clips.map((c) =>
                    c.id === clipId ? { ...c, transitionIn, transitionOut } : c
                  ),
                }));
                pushHistory({
                  ...project.editIR,
                  tracks: { ...project.editIR.tracks, videoTracks: updatedTracks },
                });
              }}
            />
          </div>
        </div>
      </div>

      {/* Modals */}
      {exportFailure && (
        <ExportErrorDialog
          failure={exportFailure}
          onClose={() => setExportFailure(null)}
          onRetry={() => void handlePerformExport(exportFailure.settings)}
        />
      )}
      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        editIR={project.editIR}
        onStartExport={handlePerformExport}
        isExporting={isExporting}
        exportProgress={exportProgress}
        exportedPath={exportedPath}
        exportedResult={exportedResult}
        onCancelExport={handleCancelExport}
        attachState={attachState}
        onRetryAttach={exportedResult ? () => void attachExport(exportedResult) : undefined}
        onAttachFile={(file) => void attachExport(file)}
        onAskDirectorFix={handleAskDirectorFix}
        onSeekMs={(ms) => setCurrentTimeSeconds(ms / 1000)}
      />
      <JobsTray registry={studioJobs} onResume={handleResumeJob} />

      <CaptionStudioModal
        isOpen={isCaptionsModalOpen}
        onClose={() => setIsCaptionsModalOpen(false)}
        captions={project.editIR.tracks.captionTrack}
        onUpdateCaptions={(caps) => {
          pushHistory({
            ...project.editIR,
            tracks: { ...project.editIR.tracks, captionTrack: caps },
          });
        }}
      />

      <AudioMixerPanel
        isOpen={isMixerModalOpen}
        onClose={() => setIsMixerModalOpen(false)}
        audioTracks={project.editIR.tracks.audioTracks}
        onUpdateTrackVolume={(id, vol) => {
          const updated = project.editIR.tracks.audioTracks.map((t) => (t.id === id ? { ...t, volumeDb: vol } : t));
          pushHistory({ ...project.editIR, tracks: { ...project.editIR.tracks, audioTracks: updated } });
        }}
        onToggleDucking={setIsDuckingEnabled}
        isDuckingEnabled={isDuckingEnabled}
        onAutoSoundDesign={() => {
          setIsMixerModalOpen(false);
          handleApplyAiPrompt("Add auto sound design and psychoacoustic SFX");
        }}
      />

      <ProxyGeneratorModal isOpen={isProxyModalOpen} onClose={() => setIsProxyModalOpen(false)} assets={project.assets} />
      <PluginManagerModal isOpen={isPluginModalOpen} onClose={() => setIsPluginModalOpen(false)} />
      <CacheManagerModal isOpen={isCacheModalOpen} onClose={() => setIsCacheModalOpen(false)} />
      <KeyboardShortcutsModal isOpen={isShortcutsModalOpen} onClose={() => setIsShortcutsModalOpen(false)} />
      <ColorScopesModal isOpen={isScopesModalOpen} onClose={() => setIsScopesModalOpen(false)} />
      <SilenceRemovalModal
        isOpen={isSilenceModalOpen}
        onClose={() => setIsSilenceModalOpen(false)}
        editIR={project.editIR}
        onApplyTrim={(newIR) => pushHistory(newIR)}
      />
    </div>
  );
};

/** Summary of what the zero-footage pipeline actually produced (read from the timeline, never canned). */
function describeGeneratedVideo(editIR: EditIR, plan: any): string {
  const tracks = editIR.tracks;
  const videoClips = tracks.videoTracks.reduce((n, t) => n + t.clips.length, 0);
  const brollClips = tracks.videoTracks.filter((t) => t.type !== "MAIN_VIDEO").reduce((n, t) => n + t.clips.length, 0);
  const audio = tracks.audioTracks.map((t) => `${t.type.toLowerCase().replace("_", " ")} (${t.clips.length})`);
  const lines = [
    `Video created: ${videoClips} clip${videoClips === 1 ? "" : "s"}${brollClips ? `, ${brollClips} B-roll` : ""}.`,
    audio.length ? `Audio: ${audio.join(", ")}.` : "No audio tracks.",
    tracks.captionTrack.length ? `Captions: ${tracks.captionTrack.length} segments.` : "No captions.",
  ];
  if (plan?.explanation) lines.push("", String(plan.explanation));
  return lines.join("\n");
}
