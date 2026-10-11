import React, { useState, useRef, useEffect } from "react";
import {
  Folder,
  Plus,
  Search,
  Download,
  Trash2,
  Copy,
  Film,
  Play,
  Monitor,
  Smartphone,
  Square,
  LayoutGrid,
  List as ListIcon,
  ChevronRight,
  Upload,
  X,
  HardDrive,
} from "lucide-react";
import { ProjectFolder, SavedProjectSummary, ProjectStorageService } from "../services/project-storage";
import { CompanyAIStatus } from "../services/tauri-bridge";

interface HomeScreenProps {
  onOpenProject: (projectId: string) => void;
  companyAIStatus?: CompanyAIStatus | null;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  onOpenProject,
}) => {
  const [folders, setFolders] = useState<ProjectFolder[]>(() => ProjectStorageService.getFolders());
  const [projects, setProjects] = useState<SavedProjectSummary[]>(() => ProjectStorageService.getProjects());
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  // Modals & Dialogs
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);
  const [isNewFolderModalOpen, setIsNewFolderModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectAspect, setNewProjectAspect] = useState<"16:9" | "9:16" | "1:1">("16:9");
  const [newFolderName, setNewFolderName] = useState("");

  const importFileInputRef = useRef<HTMLInputElement>(null);

  const refreshData = () => {
    setFolders(ProjectStorageService.getFolders());
    setProjects(ProjectStorageService.getProjects());
  };

  useEffect(() => {
    // Sync with database on mount
    const fetchDbProjects = async () => {
      try {
        const companyId = localStorage.getItem("platform_company_id") || "default_company";
        const token = localStorage.getItem("platform_auth_token");
        const headers: Record<string, string> = { "x-company-id": companyId };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const res = await fetch("/api/v1/media-editor/projects", { headers }).catch(async () => {
          return await fetch("/api/v1/workspace-tools/video-studio/projects", { headers });
        });
        const data = await res.json();
        if (data?.success && Array.isArray(data.data)) {
          for (const dbProj of data.data) {
            if (dbProj.editIR) {
              ProjectStorageService.saveProjectManifest({
                schemaVersion: 1,
                engineVersion: "0.1.0",
                project: {
                  id: dbProj.id,
                  name: dbProj.name,
                  createdAt: dbProj.createdAt || new Date().toISOString(),
                  updatedAt: dbProj.updatedAt || new Date().toISOString(),
                },
                assets: [],
                editIR: dbProj.editIR,
                history: [],
              });
            }
          }
          refreshData();
        }
      } catch (err) {
        console.warn("DB project sync on mount:", err);
      }
    };
    fetchDbProjects();
  }, []);

  const handleCreateFolder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    ProjectStorageService.createFolder(newFolderName, selectedFolderId);
    setNewFolderName("");
    setIsNewFolderModalOpen(false);
    refreshData();
  };

  const handleCreateProject = (e: React.FormEvent) => {
    e.preventDefault();
    const created = ProjectStorageService.createBlankProject(
      newProjectName || "Untitled Project",
      selectedFolderId,
      newProjectAspect
    );
    setNewProjectName("");
    setIsNewProjectModalOpen(false);
    refreshData();
    onOpenProject(created.id);
  };

  const handleDuplicate = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    ProjectStorageService.duplicateProject(id);
    refreshData();
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Are you sure you want to delete this project?")) {
      ProjectStorageService.deleteProject(id);
      refreshData();
    }
  };

  const handleDownload = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    ProjectStorageService.downloadProjectBundle(id);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      try {
        const imported = await ProjectStorageService.importProjectFile(e.target.files[0]);
        refreshData();
        onOpenProject(imported.id);
      } catch (err) {
        alert("Failed to parse .vproj project file: " + err);
      }
      e.target.value = "";
    }
  };

  const filteredProjects = projects.filter((p) => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFolder = selectedFolderId === null || p.folderId === selectedFolderId;
    return matchesSearch && matchesFolder;
  });

  const activeFolder = folders.find((f) => f.id === selectedFolderId);

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  return (
    <div className="h-screen w-screen bg-[#000000] text-zinc-100 flex flex-col select-none overflow-hidden font-sans">
      {/* Hidden File Input for Import */}
      <input
        type="file"
        ref={importFileInputRef}
        onChange={handleImportFile}
        accept=".vproj,.json,.otio"
        className="hidden"
      />

      {/* 1. Top Global Navigation Bar */}
      <header className="h-13 border-b border-[#1C1C22] bg-[#08080A] px-5 flex items-center justify-between z-20 shrink-0">
        {/* Brand & Studio Identity */}
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2.5">
            <img src="/white-icon.svg" alt="180" className="w-5 h-5 object-contain" />
            <span className="font-semibold text-sm tracking-tight text-white">180 Media Studio</span>
            <span className="text-[10px] px-2 py-0.5 rounded-md bg-[#121216] text-zinc-400 font-mono border border-[#1C1C22]">
              Projects Hub
            </span>
          </div>
        </div>

        {/* Center Search Bar */}
        <div className="flex-1 max-w-md mx-6">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search projects or folders..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#111114] border border-[#1C1C22] focus:border-zinc-500 text-xs text-zinc-200 placeholder-zinc-500 rounded-lg pl-8 pr-3 py-1.5 outline-none transition"
            />
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => importFileInputRef.current?.click()}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-300 bg-[#111114] hover:bg-[#18181E] hover:text-white border border-[#1C1C22] transition active:scale-95"
            title="Import existing .vproj or .otio bundle"
          >
            <Upload className="w-3.5 h-3.5 text-zinc-400" />
            <span>Import</span>
          </button>

          <button
            onClick={() => setIsNewFolderModalOpen(true)}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-300 bg-[#111114] hover:bg-[#18181E] hover:text-white border border-[#1C1C22] transition active:scale-95"
            title="Create New Folder"
          >
            <Folder className="w-3.5 h-3.5 text-zinc-400" />
            <span>New Folder</span>
          </button>

          <button
            onClick={() => setIsNewProjectModalOpen(true)}
            className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold text-black bg-white hover:bg-zinc-200 transition active:scale-95 shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Project</span>
          </button>
        </div>
      </header>

      {/* 2. Body: Left Folder Tree + Right Project Canvas */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left Folders Sidebar */}
        <aside className="w-60 border-r border-[#1C1C22] bg-[#08080A] flex flex-col shrink-0">
          <div className="p-3.5 border-b border-[#1C1C22] flex items-center justify-between">
            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
              Workspace Files
            </span>
            <button
              onClick={() => setIsNewFolderModalOpen(true)}
              className="p-1 rounded-md text-zinc-500 hover:text-white hover:bg-[#141418] transition"
              title="Create New Folder"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="p-2.5 overflow-y-auto flex-1 space-y-1 text-xs">
            <button
              onClick={() => setSelectedFolderId(null)}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition ${
                selectedFolderId === null
                  ? "bg-[#16161C] text-white font-medium border border-[#262630]"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-[#111114]"
              }`}
            >
              <div className="flex items-center space-x-2">
                <img src="/white-icon.svg" alt="180" className="w-3.5 h-3.5 object-contain opacity-70" />
                <span>All Projects</span>
              </div>
              <span className="text-[10px] font-mono text-zinc-500 px-1.5 py-0.2 rounded bg-[#111114]">
                {projects.length}
              </span>
            </button>

            <div className="pt-2.5 pb-1 px-2.5">
              <span className="text-[10px] font-mono font-bold text-zinc-600 uppercase">
                Folders ({folders.length})
              </span>
            </div>

            {folders.map((folder) => {
              const count = projects.filter((p) => p.folderId === folder.id).length;
              const isSelected = selectedFolderId === folder.id;

              return (
                <div
                  key={folder.id}
                  onClick={() => setSelectedFolderId(folder.id)}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg cursor-pointer transition group ${
                    isSelected
                      ? "bg-[#16161C] text-white font-medium border border-[#262630]"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-[#111114]"
                  }`}
                >
                  <div className="flex items-center space-x-2 truncate">
                    <Folder className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                    <span className="truncate">{folder.name}</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <span className="text-[10px] font-mono text-zinc-500 px-1.5 py-0.2 rounded bg-[#111114]">
                      {count}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete folder "${folder.name}"? (Projects will move to root)`)) {
                          ProjectStorageService.deleteFolder(folder.id);
                          if (selectedFolderId === folder.id) setSelectedFolderId(null);
                          refreshData();
                        }
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-rose-400 transition"
                      title="Delete Folder"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Storage Telemetry Footer */}
          <div className="p-3 border-t border-[#1C1C22] bg-[#060608] flex items-center space-x-2 text-[11px] text-zinc-500">
            <HardDrive className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
            <div className="truncate">
              <span className="font-medium text-zinc-400 block text-[10px]">Local NVRAM Storage</span>
              <span className="text-[9px] text-zinc-600">Offline-first auto-save</span>
            </div>
          </div>
        </aside>

        {/* Right Projects Area */}
        <main className="flex-1 flex flex-col min-w-0 bg-[#050505] overflow-hidden">
          {/* Breadcrumb & View Toggle Header */}
          <div className="h-10 border-b border-[#1C1C22] bg-[#08080A]/90 px-6 flex items-center justify-between shrink-0">
            <div className="flex items-center space-x-2 text-xs text-zinc-400">
              <button
                onClick={() => setSelectedFolderId(null)}
                className="hover:text-white transition font-medium"
              >
                Projects
              </button>
              {activeFolder && (
                <>
                  <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />
                  <span className="text-zinc-200 font-medium">{activeFolder.name}</span>
                </>
              )}
              <span className="text-zinc-700">•</span>
              <span className="text-zinc-500 font-mono text-[10px]">
                {filteredProjects.length} {filteredProjects.length === 1 ? "project" : "projects"}
              </span>
            </div>

            <div className="flex items-center space-x-1 bg-[#111114] p-0.5 rounded-lg border border-[#1C1C22]">
              <button
                onClick={() => setViewMode("grid")}
                className={`p-1.5 rounded-md transition ${
                  viewMode === "grid" ? "bg-[#1F1F26] text-white shadow" : "text-zinc-400 hover:text-white"
                }`}
                title="Grid View"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`p-1.5 rounded-md transition ${
                  viewMode === "list" ? "bg-[#1F1F26] text-white shadow" : "text-zinc-400 hover:text-white"
                }`}
                title="Table List View"
              >
                <ListIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Projects Viewport Container */}
          <div className="flex-1 p-6 overflow-y-auto">
            {filteredProjects.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-8">
                <div className="w-16 h-16 rounded-2xl bg-[#0D0D11] border border-[#1C1C22] flex items-center justify-center mb-4">
                  <img src="/white-icon.svg" alt="180" className="w-8 h-8 object-contain opacity-35" />
                </div>
                <h3 className="text-sm font-semibold text-zinc-200">No projects found</h3>
                <p className="text-xs text-zinc-500 max-w-sm mt-1 mb-4">
                  {selectedFolderId
                    ? "This folder is empty. Create a new project or move existing files into it."
                    : "Create your first project to start editing with precision cuts and kinetic captions."}
                </p>
                <button
                  onClick={() => setIsNewProjectModalOpen(true)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-black bg-white hover:bg-zinc-200 transition active:scale-95 shadow-lg shadow-white/5"
                >
                  Create New Project
                </button>
              </div>
            ) : viewMode === "grid" ? (
              /* Grid View */
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {filteredProjects.map((proj) => (
                  <div
                    key={proj.id}
                    onDoubleClick={() => onOpenProject(proj.id)}
                    className="group bg-[#0A0A0D] border border-[#1C1C22] hover:border-zinc-700 rounded-xl overflow-hidden shadow-lg hover:shadow-2xl hover:shadow-black transition-all flex flex-col cursor-pointer"
                  >
                    {/* Thumbnail Frame */}
                    <div
                      onClick={() => onOpenProject(proj.id)}
                      className="aspect-video w-full bg-[#050507] relative overflow-hidden flex items-center justify-center border-b border-[#141418]"
                    >
                      {/* Official White Logo Watermark (Always present as backdrop) */}
                      <div className="absolute inset-0 bg-gradient-to-b from-[#101014] to-[#060608] flex flex-col items-center justify-center p-4 select-none">
                        <div className="absolute inset-0 bg-[radial-gradient(#1E1E26_1px,transparent_1px)] [background-size:16px_16px] opacity-40 pointer-events-none" />
                        <img
                          src="/white-icon.svg"
                          alt="180"
                          className="w-10 h-10 object-contain opacity-25 group-hover:opacity-60 transition-opacity drop-shadow-md z-0"
                        />
                      </div>

                      {proj.thumbnailUrl && (
                        <img
                          src={proj.thumbnailUrl}
                          alt={proj.name}
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                          className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 z-10"
                        />
                      )}

                      {/* Hover Play Button Overlay */}
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <div className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center shadow-xl transform scale-90 group-hover:scale-100 transition-transform">
                          <Play className="w-4 h-4 ml-0.5 fill-black" />
                        </div>
                      </div>

                      {/* Aspect & Resolution Badge */}
                      <div className="absolute bottom-2 left-2 flex items-center space-x-1">
                        <span className="px-1.5 py-0.5 rounded bg-black/85 backdrop-blur-md border border-white/10 text-[9px] font-mono text-zinc-300 font-medium">
                          {proj.aspectRatio}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-black/85 backdrop-blur-md border border-white/10 text-[9px] font-mono text-zinc-400">
                          {proj.resolution.width}x{proj.resolution.height}
                        </span>
                      </div>

                      <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/90 backdrop-blur-md text-[10px] font-mono text-zinc-300">
                        {formatDuration(proj.durationSeconds)}
                      </div>
                    </div>

                    {/* Metadata & Actions */}
                    <div className="p-3 flex flex-col justify-between flex-1 space-y-2.5">
                      <div>
                        <h4
                          onClick={() => onOpenProject(proj.id)}
                          className="text-xs font-semibold text-zinc-200 group-hover:text-white transition-colors truncate"
                          title={proj.name}
                        >
                          {proj.name}
                        </h4>
                        <span className="text-[10px] text-zinc-500 block mt-0.5 font-mono">
                          Edited {new Date(proj.updatedAt).toLocaleDateString()}
                        </span>
                      </div>

                      <div className="pt-2 border-t border-[#16161C] flex items-center justify-between">
                        {/* Download Project File Button */}
                        <button
                          onClick={(e) => handleDownload(proj.id, e)}
                          className="flex items-center space-x-1 text-[11px] font-medium text-zinc-300 hover:text-white px-2 py-1 rounded-md bg-[#121216] hover:bg-[#1A1A22] border border-[#1C1C22] transition active:scale-95"
                          title="Download project manifest (.vproj bundle)"
                        >
                          <Download className="w-3 h-3 text-zinc-400" />
                          <span>Export .vproj</span>
                        </button>

                        <div className="flex items-center space-x-1">
                          <button
                            onClick={(e) => handleDuplicate(proj.id, e)}
                            className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-[#16161C] transition"
                            title="Duplicate Project"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => handleDelete(proj.id, e)}
                            className="p-1.5 rounded-md text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition"
                            title="Delete Project"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* List / Table View */
              <div className="bg-[#0A0A0D] border border-[#1C1C22] rounded-xl overflow-hidden shadow-lg">
                <table className="w-full text-left text-xs text-zinc-300">
                  <thead className="bg-[#0E0E12] border-b border-[#1C1C22] text-[10px] font-mono text-zinc-400 uppercase">
                    <tr>
                      <th className="py-2.5 px-4">Project Name</th>
                      <th className="py-2.5 px-4">Aspect</th>
                      <th className="py-2.5 px-4">Resolution</th>
                      <th className="py-2.5 px-4">Duration</th>
                      <th className="py-2.5 px-4">Last Modified</th>
                      <th className="py-2.5 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#141418]">
                    {filteredProjects.map((proj) => (
                      <tr
                        key={proj.id}
                        onDoubleClick={() => onOpenProject(proj.id)}
                        className="hover:bg-[#111116] transition cursor-pointer group"
                      >
                        <td className="py-2.5 px-4 flex items-center space-x-2 font-medium text-zinc-200">
                          <img src="/white-icon.svg" alt="180" className="w-3.5 h-3.5 object-contain opacity-70 shrink-0" />
                          <span className="truncate max-w-xs">{proj.name}</span>
                        </td>
                        <td className="py-2.5 px-4 font-mono text-zinc-400">{proj.aspectRatio}</td>
                        <td className="py-2.5 px-4 font-mono text-zinc-400">
                          {proj.resolution.width}x{proj.resolution.height}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-zinc-300">
                          {formatDuration(proj.durationSeconds)}
                        </td>
                        <td className="py-2.5 px-4 text-zinc-500 font-mono text-[11px]">
                          {new Date(proj.updatedAt).toLocaleDateString()}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <div className="flex items-center justify-end space-x-1.5">
                            <button
                              onClick={(e) => handleDownload(proj.id, e)}
                              className="p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-[#16161C] transition"
                              title="Export .vproj"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => handleDuplicate(proj.id, e)}
                              className="p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-[#16161C] transition"
                              title="Duplicate Project"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => handleDelete(proj.id, e)}
                              className="p-1.5 rounded-md text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 transition"
                              title="Delete Project"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Modal: Create New Project */}
      {isNewProjectModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#0A0A0D] border border-[#1C1C22] rounded-2xl shadow-2xl p-6 space-y-4 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between border-b border-[#1C1C22] pb-3">
              <h3 className="text-sm font-semibold text-zinc-100 flex items-center space-x-2">
                <img src="/white-icon.svg" alt="180" className="w-4 h-4 object-contain" />
                <span>Create New Video Project</span>
              </h3>
              <button
                onClick={() => setIsNewProjectModalOpen(false)}
                className="text-zinc-500 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateProject} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-zinc-300 block mb-1.5">
                  Project Title
                </label>
                <input
                  type="text"
                  placeholder="e.g. My Next YouTube Short"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  autoFocus
                  className="w-full bg-[#111114] border border-[#1C1C22] focus:border-zinc-500 text-xs text-zinc-200 rounded-lg px-3 py-2 outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-zinc-300 block mb-1.5">
                  Aspect Ratio
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: "16:9", label: "16:9 Landscape", icon: Monitor },
                    { id: "9:16", label: "9:16 Vertical", icon: Smartphone },
                    { id: "1:1", label: "1:1 Square", icon: Square },
                  ].map((asp) => (
                    <button
                      key={asp.id}
                      type="button"
                      onClick={() => setNewProjectAspect(asp.id as any)}
                      className={`p-2.5 rounded-xl border text-center text-xs font-medium flex flex-col items-center space-y-1 transition ${
                        newProjectAspect === asp.id
                          ? "bg-[#181822] border-zinc-500 text-white font-semibold shadow-sm"
                          : "bg-[#111114] border-[#1C1C22] text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      <asp.icon className="w-4 h-4" />
                      <span>{asp.id}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-[#1C1C22]">
                <button
                  type="button"
                  onClick={() => setIsNewProjectModalOpen(false)}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-white transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg text-xs font-semibold text-black bg-white hover:bg-zinc-200 transition active:scale-95 shadow-sm"
                >
                  Create & Launch
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Create New Folder */}
      {isNewFolderModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-[#0A0A0D] border border-[#1C1C22] rounded-2xl shadow-2xl p-6 space-y-4 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between border-b border-[#1C1C22] pb-3">
              <h3 className="text-sm font-semibold text-zinc-100 flex items-center space-x-2">
                <Folder className="w-4 h-4 text-zinc-400" />
                <span>New Project Folder</span>
              </h3>
              <button
                onClick={() => setIsNewFolderModalOpen(false)}
                className="text-zinc-500 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateFolder} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-zinc-300 block mb-1.5">
                  Folder Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Client Deliverables"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  autoFocus
                  className="w-full bg-[#111114] border border-[#1C1C22] focus:border-zinc-500 text-xs text-zinc-200 rounded-lg px-3 py-2 outline-none"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-[#1C1C22]">
                <button
                  type="button"
                  onClick={() => setIsNewFolderModalOpen(false)}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-white transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg text-xs font-semibold text-black bg-white hover:bg-zinc-200 transition active:scale-95 shadow-sm"
                >
                  Create Folder
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
