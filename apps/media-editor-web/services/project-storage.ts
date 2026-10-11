import { ProjectPackageManifest, RationalTimeMath } from "@workspace/video-contracts";

export interface ProjectFolder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  color?: string;
}

export interface SavedProjectSummary {
  id: string;
  name: string;
  folderId: string | null;
  durationSeconds: number;
  resolution: { width: number; height: number };
  fps: number;
  aspectRatio: "16:9" | "9:16" | "1:1";
  thumbnailUrl?: string;
  createdAt: string;
  updatedAt: string;
  manifest: ProjectPackageManifest;
}

const STORAGE_FOLDERS_KEY = "180_media_studio_folders";
const STORAGE_PROJECTS_KEY = "180_media_studio_projects";
const STORAGE_CLOUD_ASSETS_KEY = "180_media_studio_cloud_assets";

export interface CloudMediaAsset {
  id: string;
  name: string;
  type: "video" | "audio" | "image";
  duration?: string;
  size: string;
  resolution?: string;
  uploadedAt: string;
  url?: string;
}

export class ProjectStorageService {
  // Cloud Media Asset Operations
  static getCloudAssets(): CloudMediaAsset[] {
    if (typeof window === "undefined") return [];
    try {
      const stored = localStorage.getItem(STORAGE_CLOUD_ASSETS_KEY);
      if (!stored) return [];
      const parsed: CloudMediaAsset[] = JSON.parse(stored);
      // Filter out any legacy mock assets
      return parsed.filter(
        (a) => !["asset_01", "asset_02", "asset_03", "asset_04"].includes(a.id)
      );
    } catch {
      return [];
    }
  }

  static saveCloudAsset(asset: CloudMediaAsset): void {
    if (typeof window === "undefined") return;
    const existing = this.getCloudAssets().filter((a) => a.id !== asset.id);
    localStorage.setItem(STORAGE_CLOUD_ASSETS_KEY, JSON.stringify([asset, ...existing]));
  }

  static deleteCloudAsset(id: string): void {
    if (typeof window === "undefined") return;
    const existing = this.getCloudAssets().filter((a) => a.id !== id);
    localStorage.setItem(STORAGE_CLOUD_ASSETS_KEY, JSON.stringify(existing));
  }

  // Folder Operations
  static getFolders(): ProjectFolder[] {
    if (typeof window === "undefined") return [];
    try {
      const stored = localStorage.getItem(STORAGE_FOLDERS_KEY);
      if (!stored) {
        return [];
      }
      const parsed: ProjectFolder[] = JSON.parse(stored);
      // Clean old default mock folders if present
      const cleaned = parsed.filter(
        (f) => !["folder_social", "folder_product", "folder_client"].includes(f.id)
      );
      return cleaned;
    } catch {
      return [];
    }
  }

  static createFolder(name: string, parentId: string | null = null): ProjectFolder {
    const folders = this.getFolders();
    const newFolder: ProjectFolder = {
      id: `folder_${Date.now()}`,
      name: name.trim() || "Untitled Folder",
      parentId,
      createdAt: new Date().toISOString(),
      color: "#3B82F6",
    };
    const updated = [newFolder, ...folders];
    localStorage.setItem(STORAGE_FOLDERS_KEY, JSON.stringify(updated));
    return newFolder;
  }

  static renameFolder(id: string, newName: string): void {
    const folders = this.getFolders().map((f) => (f.id === id ? { ...f, name: newName.trim() } : f));
    localStorage.setItem(STORAGE_FOLDERS_KEY, JSON.stringify(folders));
  }

  static deleteFolder(id: string): void {
    const folders = this.getFolders().filter((f) => f.id !== id && f.parentId !== id);
    localStorage.setItem(STORAGE_FOLDERS_KEY, JSON.stringify(folders));

    // Move projects in this folder to root (null)
    const projects = this.getProjects().map((p) => (p.folderId === id ? { ...p, folderId: null } : p));
    localStorage.setItem(STORAGE_PROJECTS_KEY, JSON.stringify(projects));
  }

  // Project Operations
  static getProjects(): SavedProjectSummary[] {
    if (typeof window === "undefined") return [];
    try {
      const stored = localStorage.getItem(STORAGE_PROJECTS_KEY);
      if (!stored) {
        return [];
      }
      const parsed: SavedProjectSummary[] = JSON.parse(stored);
      // Clean legacy mock projects
      const filtered = parsed.filter(
        (p) =>
          p.id !== "proj_auton_showcase" &&
          !p.id?.startsWith("proj_sample_") &&
          p.name !== "180 Studio Showcase"
      );
      return filtered;
    } catch {
      return [];
    }
  }

  static getProjectById(id: string): SavedProjectSummary | null {
    const all = this.getProjects();
    return all.find((p) => p.id === id) || null;
  }

  static createBlankProject(name: string, folderId: string | null = null, aspect: "16:9" | "9:16" | "1:1" = "16:9"): SavedProjectSummary {
    const id = `proj_${Date.now()}`;
    const cleanName = name.trim() || "Untitled Project";
    const res = aspect === "9:16" ? { width: 1080, height: 1920 } : aspect === "1:1" ? { width: 1080, height: 1080 } : { width: 1920, height: 1080 };

    const manifest: ProjectPackageManifest = {
      schemaVersion: 1,
      engineVersion: "0.1.0",
      project: {
        id,
        name: cleanName,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      assets: [],
      editIR: {
        version: "1.0.0",
        meta: {
          projectId: id,
          title: cleanName,
          targetAspect: aspect,
          resolution: res,
          fps: { numerator: 30, denominator: 1 },
          totalDuration: RationalTimeMath.fromSeconds(5.0),
        },
        directorStyle: {
          preset: "CUSTOM",
          pacingMultiplier: 1.0,
          zoomAggressiveness: 0.5,
          brollFrequencySeconds: 10.0,
        },
        tracks: {
          videoTracks: [
            {
              id: "track_v1",
              type: "MAIN_VIDEO",
              zIndex: 0,
              clips: [],
            },
          ],
          audioTracks: [
            {
              id: "track_a1",
              type: "PRIMARY_VOICE",
              volumeDb: 0.0,
              duckWithSpeech: false,
              clips: [],
            },
            {
              id: "track_a2",
              type: "BGM",
              volumeDb: -6.0,
              duckWithSpeech: true,
              clips: [],
            },
          ],
          cameraTrack: [],
          captionTrack: [],
        },
      },
      history: [],
    };

    const newSummary: SavedProjectSummary = {
      id,
      name: cleanName,
      folderId,
      durationSeconds: 5.0,
      resolution: res,
      fps: 30,
      aspectRatio: aspect,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      manifest,
    };

    const projects = [newSummary, ...this.getProjects()];
    localStorage.setItem(STORAGE_PROJECTS_KEY, JSON.stringify(projects));

    // Asynchronously sync with PostgreSQL backend DB
    this.syncProjectToDatabase(newSummary.manifest).catch((err) => {
      console.warn("[ProjectStorageService] Background DB sync:", err.message);
    });

    return newSummary;
  }

  static async syncProjectToDatabase(manifest: ProjectPackageManifest): Promise<void> {
    if (typeof window === "undefined") return;
    try {
      const companyId = localStorage.getItem("platform_company_id") || "default_company";
      const token = localStorage.getItem("platform_auth_token");
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "x-company-id": companyId,
      };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      await fetch("/api/v1/media-editor/projects", {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: manifest.project.id,
          name: manifest.project.name,
          templatePreset: manifest.editIR.directorStyle.preset || "CUSTOM",
          editIR: manifest.editIR,
        }),
      }).catch(async () => {
        // Fallback route
        await fetch("/api/v1/workspace-tools/video-studio/projects", {
          method: "POST",
          headers,
          body: JSON.stringify({
            id: manifest.project.id,
            name: manifest.project.name,
            templatePreset: manifest.editIR.directorStyle.preset || "CUSTOM",
            editIR: manifest.editIR,
          }),
        });
      });
    } catch (e: any) {
      console.warn("[ProjectStorageService] Database sync error:", e.message);
    }
  }

  static loadProjectManifest(id: string): ProjectPackageManifest | null {
    const proj = this.getProjectById(id);
    return proj?.manifest || null;
  }

  static saveProject(manifest: ProjectPackageManifest): void {
    this.saveProjectManifest(manifest);
  }

  static saveProjectManifest(manifest: ProjectPackageManifest): void {
    const projects = this.getProjects();
    const duration = RationalTimeMath.toSeconds(manifest.editIR.meta.totalDuration);
    const aspect = (manifest.editIR.meta.targetAspect as any) || "16:9";

    const idx = projects.findIndex((p) => p.id === manifest.project.id);
    if (idx !== -1) {
      projects[idx] = {
        ...projects[idx],
        name: manifest.project.name,
        durationSeconds: duration,
        resolution: manifest.editIR.meta.resolution,
        aspectRatio: aspect,
        updatedAt: new Date().toISOString(),
        manifest,
      };
    } else {
      projects.unshift({
        id: manifest.project.id,
        name: manifest.project.name,
        folderId: null,
        durationSeconds: duration,
        resolution: manifest.editIR.meta.resolution,
        fps: manifest.editIR.meta.fps.numerator / manifest.editIR.meta.fps.denominator,
        aspectRatio: aspect,
        createdAt: manifest.project.createdAt,
        updatedAt: new Date().toISOString(),
        manifest,
      });
    }

    localStorage.setItem(STORAGE_PROJECTS_KEY, JSON.stringify(projects));

    // Asynchronously sync with PostgreSQL backend DB
    this.syncProjectToDatabase(manifest).catch((err) => {
      console.warn("[ProjectStorageService] Background DB sync:", err.message);
    });
  }

  static duplicateProject(id: string): SavedProjectSummary | null {
    const original = this.getProjectById(id);
    if (!original) return null;

    const dupId = `proj_${Date.now()}`;
    const dupName = `${original.name} (Copy)`;

    const dupManifest: ProjectPackageManifest = {
      ...original.manifest,
      project: {
        ...original.manifest.project,
        id: dupId,
        name: dupName,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      editIR: {
        ...original.manifest.editIR,
        meta: {
          ...original.manifest.editIR.meta,
          projectId: dupId,
          title: dupName,
        },
      },
    };

    const dupSummary: SavedProjectSummary = {
      ...original,
      id: dupId,
      name: dupName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      manifest: dupManifest,
    };

    const projects = [dupSummary, ...this.getProjects()];
    localStorage.setItem(STORAGE_PROJECTS_KEY, JSON.stringify(projects));
    return dupSummary;
  }

  static deleteProject(id: string): void {
    const projects = this.getProjects().filter((p) => p.id !== id);
    localStorage.setItem(STORAGE_PROJECTS_KEY, JSON.stringify(projects));
  }

  static moveProjectToFolder(projectId: string, folderId: string | null): void {
    const projects = this.getProjects().map((p) => (p.id === projectId ? { ...p, folderId } : p));
    localStorage.setItem(STORAGE_PROJECTS_KEY, JSON.stringify(projects));
  }

  // Export / Download .vproj Bundle
  static downloadProjectBundle(id: string): void {
    const project = this.getProjectById(id);
    if (!project) return;

    const jsonString = JSON.stringify(project.manifest, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.vproj`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Import .vproj Bundle File
  static async importProjectFile(file: File): Promise<SavedProjectSummary> {
    const text = await file.text();
    const manifest = JSON.parse(text) as ProjectPackageManifest;
    const id = manifest.project?.id || `proj_imported_${Date.now()}`;
    const name = manifest.project?.name || file.name.replace(/\.vproj$/i, "");

    const summary: SavedProjectSummary = {
      id,
      name,
      folderId: null,
      durationSeconds: manifest.editIR ? RationalTimeMath.toSeconds(manifest.editIR.meta.totalDuration) : 10.0,
      resolution: manifest.editIR?.meta.resolution || { width: 1920, height: 1080 },
      fps: 30,
      aspectRatio: (manifest.editIR?.meta.targetAspect as any) || "16:9",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      manifest,
    };

    const projects = [summary, ...this.getProjects().filter((p) => p.id !== id)];
    localStorage.setItem(STORAGE_PROJECTS_KEY, JSON.stringify(projects));
    return summary;
  }
}
