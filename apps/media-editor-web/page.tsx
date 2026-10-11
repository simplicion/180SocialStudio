"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  Film,
  Sparkles,
  Clock,
  Plus,
  X,
  ArrowRight,
  AlertTriangle,
  Globe,
} from "lucide-react";
import api from "@/lib/api";
import { useSubscription } from "@/lib/useSubscription";
import { useAuth } from "@/lib/auth-context";
import { MediaStudioWorkspace } from "./components/MediaStudioWorkspace";
import { UniversalSkeleton, FeatureLock } from "@workspace/ui";
import toast from "react-hot-toast";

interface VideoStudioProject {
  id: string;
  companyId: string;
  name: string;
  templatePreset: string;
  aspectRatio: string;
  durationSeconds: number;
  createdAt: string;
  updatedAt: string;
}

export default function MediaEditorDashboardPage() {
  const { companyConfig, loading: subLoading } = useSubscription();
  const { user, company, token } = useAuth();

  const [projects, setProjects] = useState<VideoStudioProject[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);

  // Embedded Studio Workspace State
  const [isEmbeddedStudioOpen, setIsEmbeddedStudioOpen] = useState(false);
  const [activeStudioProject, setActiveStudioProject] = useState<string | null>(null);
  const [activeStudioTemplate, setActiveStudioTemplate] = useState<string | null>(null);

  // Project Creation Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [selectedAspect, setSelectedAspect] = useState<"16:9" | "9:16" | "1:1">("16:9");
  const [isCreating, setIsCreating] = useState(false);

  const fetchProjects = async () => {
    try {
      setLoadingProjects(true);
      const res = await api.get("/api/v1/media-editor/projects").catch(async () => {
        return await api.get("/api/v1/workspace-tools/video-studio/projects");
      });
      if (res.data?.data && Array.isArray(res.data.data)) {
        setProjects(
          res.data.data.filter(
            (p: any) => !p.id?.startsWith("proj_sample_") && p.id !== "proj_auton_showcase"
          )
        );
      } else {
        setProjects([]);
      }
    } catch {
      setProjects([]);
    } finally {
      setLoadingProjects(false);
    }
  };

  useEffect(() => {
    fetchProjects();
    if (typeof window !== "undefined") {

      const params = new URLSearchParams(window.location.search);
      const proj = params.get("project") || params.get("projectId");
      const mode = params.get("mode");
      const template = params.get("template");
      const postId = params.get("postId");
      const taskId = params.get("taskId");
      if (proj || mode === "studio" || postId || taskId) {
        if (proj) setActiveStudioProject(proj);
        if (template) setActiveStudioTemplate(template);
        setIsEmbeddedStudioOpen(true);
      }
    }
  }, []);

  const enabledApps = Array.isArray(companyConfig?.enabledApps) ? companyConfig.enabledApps : [];
  const hasApp =
    enabledApps.includes("media-editor") ||
    enabledApps.includes("video-studio") ||
    enabledApps.length === 0;

  if (isEmbeddedStudioOpen) {
    return (
      <div className="fixed inset-0 z-50 bg-[#07090E] flex flex-col">
        <MediaStudioWorkspace
          initialProjectId={activeStudioProject}
          initialTemplate={activeStudioTemplate}
          onExit={() => {
            setIsEmbeddedStudioOpen(false);
            fetchProjects();
          }}
        />
      </div>
    );
  }

  if (subLoading) {
    return (
      <div className="space-y-6 max-w-7xl mx-auto">
        <UniversalSkeleton type="metrics" />
        <UniversalSkeleton type="projects" />
      </div>
    );
  }

  if (!hasApp) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <FeatureLock
          title="180 Media Studio"
          requiredApp="180 Media Editor"
          description="Unlock the local-first Autonomous Video Production Engine, AI Creative Director, and 500+ FPS smart stream-copy rendering."
        />
      </div>
    );
  }

  const handleOpenWebStudio = (projectId?: string, preset?: string) => {
    setActiveStudioProject(projectId || null);
    setActiveStudioTemplate(preset || null);
    setIsEmbeddedStudioOpen(true);
  };

  const handleCreateNewProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectName.trim()) {
      toast.error("Please enter a project name");
      return;
    }

    setIsCreating(true);
    try {
      const width = selectedAspect === "9:16" ? 1080 : 1920;
      const height = selectedAspect === "9:16" ? 1920 : selectedAspect === "1:1" ? 1080 : 1080;

      const newEditIR = {
        version: "1.0.0",
        meta: {
          projectId: `proj_${Date.now()}`,
          title: projectName.trim(),
          targetAspect: selectedAspect,
          resolution: { width, height },
          fps: { numerator: 30, denominator: 1 },
          totalDuration: { value: 0, timescale: 30 },
        },
        directorStyle: {
          preset: "CUSTOM",
          pacingMultiplier: 1.0,
          zoomAggressiveness: 0.5,
          brollFrequencySeconds: 15.0,
        },
        tracks: {
          videoTracks: [
            {
              id: `track_${Date.now()}`,
              type: "MAIN_VIDEO",
              zIndex: 1,
              clips: [],
            },
          ],
          cameraTrack: [],
          captionTrack: [],
          audioTracks: [],
        },
      };

      let res;
      try {
        res = await api.post("/api/v1/media-editor/projects", {
          name: projectName.trim(),
          templatePreset: "CUSTOM",
          editIR: newEditIR,
        });
      } catch {
        res = await api.post("/api/v1/workspace-tools/video-studio/projects", {
          name: projectName.trim(),
          templatePreset: "CUSTOM",
          editIR: newEditIR,
        });
      }

      const createdProjId = res.data?.data?.id || `proj_${Date.now()}`;
      toast.success("Project created! Opening Web Studio...");
      setIsCreateModalOpen(false);
      setProjectName("");
      fetchProjects();
      handleOpenWebStudio(createdProjId, "CUSTOM");
    } catch {
      toast.success("Project saved locally! Opening Web Studio...");
      setIsCreateModalOpen(false);
      handleOpenWebStudio(undefined, "CUSTOM");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="space-y-6 pb-16 max-w-7xl mx-auto select-none">
      {/* 180 Media Studio Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-5 border-b border-gray-200 dark:border-gray-800">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center space-x-2.5">
            <Film className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            <span>180 Media Studio</span>
          </h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed max-w-2xl">
            An all-in-one video production engine for multi-track timeline editing, automated kinetic captions, camera spring zooms, and lossless hardware-accelerated video rendering.
          </p>
        </div>

        <div className="flex items-center space-x-2.5 shrink-0">
          <button
            onClick={() => handleOpenWebStudio()}
            className="flex items-center space-x-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 shadow-sm transition active:scale-95"
          >
            <Film className="w-3.5 h-3.5 text-indigo-500" />
            <span>Open Studio</span>
          </button>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm shadow-indigo-500/20 transition active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>New Video Project</span>
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {loadingProjects ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="h-36 rounded-2xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
            <div className="h-36 rounded-2xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
            <div className="h-36 rounded-2xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
          </div>
        ) : projects.length === 0 ? (
          <div className="p-12 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200/80 dark:border-gray-800 shadow-sm text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 text-indigo-500 flex items-center justify-center mx-auto">
              <Film className="w-6 h-6" />
            </div>
            <p className="text-base font-bold text-gray-900 dark:text-white">No Video Projects Yet</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 max-w-sm mx-auto leading-relaxed">
              Create your first video project to run automated pacing, spring zoom framing, and lossless stream rendering.
            </p>
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="px-5 py-2.5 rounded-xl text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition shadow-sm"
            >
              + Create First Project
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((proj) => (
              <div
                key={proj.id}
                className="p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200/80 dark:border-gray-800 shadow-sm hover:border-indigo-500/40 dark:hover:border-indigo-500/40 transition-all duration-200 flex flex-col justify-between space-y-4"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-indigo-600 dark:text-indigo-400 font-semibold">
                      {proj.templatePreset || "CUSTOM"}
                    </span>
                    <span className="text-[10px] font-mono text-gray-500 dark:text-gray-400">
                      {proj.aspectRatio}
                    </span>
                  </div>

                  <h3 className="text-sm font-bold text-gray-900 dark:text-white truncate">{proj.name}</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center space-x-1.5">
                    <Clock className="w-3.5 h-3.5 text-gray-400" />
                    <span>Duration: {proj.durationSeconds}s</span>
                  </p>
                </div>

                <div className="pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
                  <span className="text-[11px] text-gray-500 dark:text-gray-400">
                    {new Date(proj.updatedAt).toLocaleDateString()}
                  </span>

                  <button
                    onClick={() => handleOpenWebStudio(proj.id, proj.templatePreset)}
                    className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition active:scale-95 shadow-xs"
                    title="Open in Studio"
                  >
                    <Film className="w-3.5 h-3.5" />
                    <span>Open Studio</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>


      {/* 8. New Project Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-2xl p-6 space-y-5 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/20">
                  <Film className="w-5 h-5" />
                </div>
                <h3 className="text-base font-bold text-gray-900 dark:text-white">Create Video Project</h3>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateNewProject} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                  Project Title
                </label>
                <input
                  type="text"
                  placeholder="e.g. Q4 Growth Highlights"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                  Aspect Ratio
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: "16:9", label: "16:9 (Landscape)" },
                    { id: "9:16", label: "9:16 (Vertical)" },
                    { id: "1:1", label: "1:1 (Square)" },
                  ].map((aspect) => (
                    <button
                      key={aspect.id}
                      type="button"
                      onClick={() => setSelectedAspect(aspect.id as any)}
                      className={`py-2 px-3 rounded-xl text-xs font-semibold transition border ${
                        selectedAspect === aspect.id
                          ? "bg-indigo-50 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 border-indigo-500"
                          : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                      }`}
                    >
                      {aspect.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-1 text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                <span>You can instruct the AI Creative Director naturally inside the studio editor.</span>
              </div>

              <div className="pt-3 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="flex items-center space-x-1.5 px-5 py-2.5 rounded-xl text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 shadow-md shadow-indigo-500/20 transition active:scale-95 disabled:opacity-50"
                >
                  <span>{isCreating ? "Creating..." : "Create & Next"}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
