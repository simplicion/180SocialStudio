'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
    FolderKanban, Plus, Search, Filter, Calendar, CheckCircle2, Clock, 
    AlertCircle, Sparkles, Layers, ArrowRight, Instagram, Linkedin, 
    Youtube, MessageSquare, ShieldCheck, ChevronRight, User, Users, Share2,
    Zap, X, Trash2, Info, ExternalLink, RefreshCw
} from 'lucide-react';
import { socialProjectService, SocialProject } from '@/lib/services/social-project.service';
import { UniversalSkeleton, SkeletonBoundary } from '@workspace/ui';
import { useSubscription } from '@/lib/useSubscription';
import toast from 'react-hot-toast';

export default function SocialProjectsListPage() {
    const { hasApp } = useSubscription();
    const [projects, setProjects] = useState<SocialProject[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');

    // Modals state
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [projectToDelete, setProjectToDelete] = useState<SocialProject | null>(null);
    const [projectForDetails, setProjectForDetails] = useState<SocialProject | null>(null);

    // Create form state
    const [newProjectName, setNewProjectName] = useState('');
    const [newProjectDesc, setNewProjectDesc] = useState('');
    const [submittingCreate, setSubmittingCreate] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const loadProjects = async () => {
        try {
            setLoading(true);
            const data = await socialProjectService.getProjects({
                search: search || undefined,
                status: statusFilter !== 'all' ? statusFilter : undefined
            });
            setProjects(data.projects || []);
        } catch (err: any) {
            toast.error(err.response?.data?.error || 'Failed to load social projects');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadProjects();
    }, [statusFilter]);

    const handleSearchSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        loadProjects();
    };

    const handleCreateProject = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newProjectName.trim()) {
            toast.error('Please enter a project name');
            return;
        }

        try {
            setSubmittingCreate(true);
            await socialProjectService.createProject({
                name: newProjectName.trim(),
                description: newProjectDesc.trim() || undefined,
                status: 'in_progress',
                priority: 'medium'
            });
            toast.success('Creator project created successfully');
            setIsCreateModalOpen(false);
            setNewProjectName('');
            setNewProjectDesc('');
            loadProjects();
        } catch (err: any) {
            toast.error(err.response?.data?.error || 'Failed to create project');
        } finally {
            setSubmittingCreate(false);
        }
    };

    const handleDeleteProject = async () => {
        if (!projectToDelete) return;
        try {
            setDeletingId(projectToDelete.id);
            await socialProjectService.deleteProject(projectToDelete.id);
            toast.success(`Project "${projectToDelete.name}" deleted`);
            setProjectToDelete(null);
            loadProjects();
        } catch (err: any) {
            toast.error(err.response?.data?.error || 'Failed to delete project');
        } finally {
            setDeletingId(null);
        }
    };



    const getStatusColor = (status: string) => {
        switch (status) {
            case 'in_progress':
            case 'active':
                return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
            case 'in_review':
                return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
            case 'completed':
                return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
            default:
                return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
        }
    };

    // Aggregate metrics
    const totalScheduled = projects.reduce((acc, p) => acc + (p.metrics?.scheduledPosts || 0), 0);

    return (
        <div className="min-h-screen p-6 md:p-10 space-y-8 bg-zinc-50/50 dark:bg-black">
            {/* Top Navigation Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 mb-1">
                        <Share2 className="w-4 h-4" />
                        <span>180 Workspace Suite</span>
                    </div>
                    <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-100">
                        180 Creator Studio
                    </h1>
                    <p className="text-zinc-500 dark:text-zinc-400 text-sm mt-1">
                        Centralized creator dashboard. Manage channels, campaigns, and launch full AI video editing and social publishing.
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setIsCreateModalOpen(true)}
                        className="inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 rounded-xl shadow-lg shadow-indigo-600/20 transition-all duration-200 active:scale-95 cursor-pointer"
                    >
                        <Plus className="w-4 h-4" />
                        <span>Create Project</span>
                    </button>
                </div>
            </div>

            {/* Quick Metrics Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-5 rounded-2xl bg-white/70 dark:bg-zinc-900/70 border border-zinc-200/80 dark:border-zinc-800/80 backdrop-blur-md">
                    <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Total Projects</p>
                    <p className="text-2xl font-black text-zinc-900 dark:text-zinc-100 mt-1">{projects.length}</p>
                    <p className="text-xs text-indigo-500 mt-1">Creator channels</p>
                </div>
                <div className="p-5 rounded-2xl bg-white/70 dark:bg-zinc-900/70 border border-zinc-200/80 dark:border-zinc-800/80 backdrop-blur-md">
                    <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Scheduled Posts</p>
                    <p className="text-2xl font-black text-emerald-500 mt-1">{totalScheduled}</p>
                    <p className="text-xs text-zinc-400 mt-1">Across all channels</p>
                </div>
                <div className="p-5 rounded-2xl bg-gradient-to-br from-indigo-500/10 to-violet-500/10 border border-indigo-500/20 backdrop-blur-md">
                    <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">Active Campaigns</p>
                    <p className="text-2xl font-black text-indigo-600 dark:text-indigo-400 mt-1">{projects.filter(p => p.status === 'active' || p.status === 'in_progress').length}</p>
                    <p className="text-xs text-zinc-400 mt-1">In active production</p>
                </div>
            </div>

            {/* Filter & Search Bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-2xl bg-white/60 dark:bg-zinc-900/60 backdrop-blur-md border border-zinc-200/80 dark:border-zinc-800/80 shadow-sm">
                <form onSubmit={handleSearchSubmit} className="relative w-full sm:w-96">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                    <input
                        type="text"
                        placeholder="Search projects by name..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 text-sm bg-zinc-100/70 dark:bg-zinc-800/70 border border-transparent focus:border-indigo-500 rounded-xl outline-none transition text-zinc-900 dark:text-zinc-100 placeholder-zinc-400"
                    />
                </form>

                <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto">
                    {['all', 'in_progress', 'completed'].map((status) => (
                        <button
                            key={status}
                            onClick={() => setStatusFilter(status)}
                            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg capitalize whitespace-nowrap transition cursor-pointer ${
                                statusFilter === status
                                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                            }`}
                        >
                            {status.replace('_', ' ')}
                        </button>
                    ))}
                    <button
                        onClick={loadProjects}
                        title="Refresh projects"
                        className="p-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition cursor-pointer"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {/* Projects Grid */}
            {loading ? (
                <UniversalSkeleton type="projects" />
            ) : projects.length === 0 ? (
                <div className="text-center py-16 px-4 bg-white/40 dark:bg-zinc-900/40 rounded-3xl border border-dashed border-zinc-300 dark:border-zinc-800 backdrop-blur-md">
                    <div className="w-16 h-16 mx-auto rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400 mb-4 shadow-inner">
                        <FolderKanban className="w-8 h-8" />
                    </div>
                    <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">No Social Projects Found</h3>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-md mx-auto mt-1 mb-6">
                        Create your first social media project to link client content calendars, video editing tasks, approvals, and multi-platform publishing.
                    </p>
                    <button
                        onClick={() => setIsCreateModalOpen(true)}
                        className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl transition shadow-lg shadow-indigo-600/25 cursor-pointer"
                    >
                        <Plus className="w-4 h-4" />
                        <span>Create Social Project</span>
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {projects.map((project) => {
                        const metrics = project.metrics || {
                            scheduledPosts: 0,
                            pendingApprovals: 0,
                            outstandingTasks: 0,
                            publishedPosts: 0
                        };

                        return (
                            <div
                                key={project.id}
                                className="group relative flex flex-col justify-between p-6 rounded-3xl bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md border border-zinc-200/80 dark:border-zinc-800/80 hover:border-indigo-500/50 dark:hover:border-indigo-500/50 transition-all duration-300 hover:shadow-xl hover:shadow-indigo-500/5"
                            >
                                <div>
                                    {/* Card Header: Project Badge, Status & Actions */}
                                    <div className="flex items-center justify-between gap-2 mb-3">
                                        <span className="px-2.5 py-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 rounded-lg">
                                            Creator Project
                                        </span>
                                        <div className="flex items-center gap-2">
                                            <span className={`px-2.5 py-0.5 text-xs font-medium border rounded-full capitalize ${getStatusColor(project.status)}`}>
                                                {project.status.replace('_', ' ')}
                                            </span>
                                            <button
                                                onClick={() => setProjectToDelete(project)}
                                                className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/50 transition"
                                                title="Delete Project"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Title & Description */}
                                    <h3 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
                                        {project.name}
                                    </h3>
                                    <p className="text-sm text-zinc-500 dark:text-zinc-400 line-clamp-2 mt-1 mb-5">
                                        {project.description || 'Comprehensive social media growth and content production engagement.'}
                                    </p>

                                    {/* Connected Platforms Row */}
                                    <div className="flex items-center gap-1.5 mb-6">
                                        <span className="text-xs text-zinc-400 mr-1">Platforms:</span>
                                        {project.socialAccounts && project.socialAccounts.length > 0 ? (
                                            project.socialAccounts.map((acc: any) => (
                                                <div
                                                    key={acc.id}
                                                    title={`${acc.platform} (@${acc.username})`}
                                                    className="w-6 h-6 rounded-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center text-zinc-700 dark:text-zinc-300"
                                                >
                                                    {getPlatformIcon(acc.platform)}
                                                </div>
                                            ))
                                        ) : (
                                            <span className="text-xs text-zinc-400 italic">No accounts linked</span>
                                        )}
                                    </div>
                                </div>

                                {/* Micro-Metrics Footer */}
                                <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800/80">
                                    <div className="grid grid-cols-2 gap-2 text-center mb-4">
                                        <div className="p-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/50">
                                            <p className="text-xs text-zinc-400">Scheduled</p>
                                            <p className="text-base font-bold text-zinc-900 dark:text-zinc-100 mt-0.5">
                                                {metrics.scheduledPosts}
                                            </p>
                                        </div>
                                        <div className="p-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/50">
                                            <p className="text-xs text-zinc-400">Published</p>
                                            <p className="text-base font-bold text-emerald-500 mt-0.5">
                                                {metrics.publishedPosts || 0}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Action Row */}
                                    <div className="flex items-center justify-between pt-2">
                                        <button
                                            type="button"
                                            onClick={() => setProjectForDetails(project)}
                                            className="flex items-center text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 font-medium transition"
                                        >
                                            <Info className="w-3.5 h-3.5 mr-1" />
                                            <span>Details</span>
                                        </button>

                                        <Link
                                            href={`/social-projects/${project.id}/command-center`}
                                            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-zinc-700 dark:text-zinc-200 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-xl transition"
                                            title="Monitor, create and check for every platform"
                                        >
                                            <Sparkles className="w-3.5 h-3.5" />
                                            <span>Command Center</span>
                                        </Link>

                                        <Link
                                            href={`/media-editor?project=${project.id}`}
                                            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 rounded-xl shadow-md shadow-indigo-600/20 transition active:scale-95"
                                            title="Open in 180 Media Studio"
                                        >
                                            <Zap className="w-3.5 h-3.5 text-amber-300" />
                                            <span>Open Media Studio</span>
                                        </Link>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* In-Place Create Project Modal */}
            {isCreateModalOpen && (
                <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                                <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600">
                                    <Plus className="w-5 h-5" />
                                </div>
                                <div>
                                    <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                                        Create Creator Project
                                    </h3>
                                    <p className="text-xs text-zinc-400">Start a new creator project or channel campaign</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setIsCreateModalOpen(false)}
                                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <form onSubmit={handleCreateProject} className="space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                                    Project Name *
                                </label>
                                <input
                                    type="text"
                                    required
                                    placeholder="e.g. YouTube Main Channel or TikTok Growth"
                                    value={newProjectName}
                                    onChange={(e) => setNewProjectName(e.target.value)}
                                    className="w-full px-3.5 py-2.5 text-sm bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 rounded-xl outline-none focus:border-indigo-500 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                                    Description (Optional)
                                </label>
                                <textarea
                                    rows={3}
                                    placeholder="Brief summary of creative direction and social targets..."
                                    value={newProjectDesc}
                                    onChange={(e) => setNewProjectDesc(e.target.value)}
                                    className="w-full px-3.5 py-2.5 text-sm bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 rounded-xl outline-none focus:border-indigo-500 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 resize-none"
                                />
                            </div>

                            <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-100 dark:border-zinc-800">
                                <button
                                    type="button"
                                    onClick={() => setIsCreateModalOpen(false)}
                                    className="px-4 py-2 text-xs font-semibold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={submittingCreate}
                                    className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl transition shadow-md shadow-indigo-600/20"
                                >
                                    {submittingCreate ? 'Creating...' : 'Create Project'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Delete Project Confirmation Modal */}
            {projectToDelete && (
                <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
                        <div className="w-12 h-12 rounded-2xl bg-red-50 dark:bg-red-950/60 text-red-500 flex items-center justify-center mx-auto">
                            <Trash2 className="w-6 h-6" />
                        </div>
                        <div className="text-center">
                            <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                                Delete Project?
                            </h3>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                                Are you sure you want to delete <span className="font-semibold text-zinc-800 dark:text-zinc-200">"{projectToDelete.name}"</span>? This will archive the project workspace and associated media files.
                            </p>
                        </div>
                        <div className="flex items-center gap-3 pt-2">
                            <button
                                type="button"
                                onClick={() => setProjectToDelete(null)}
                                className="flex-1 px-4 py-2.5 text-xs font-semibold text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 rounded-xl hover:bg-zinc-200 dark:hover:bg-zinc-700 transition"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleDeleteProject}
                                disabled={deletingId === projectToDelete.id}
                                className="flex-1 px-4 py-2.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-500 disabled:opacity-50 rounded-xl transition shadow-md shadow-red-600/20"
                            >
                                {deletingId === projectToDelete.id ? 'Deleting...' : 'Yes, Delete'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Project Details Modal */}
            {projectForDetails && (
                <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="w-full max-w-md rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <FolderKanban className="w-5 h-5 text-indigo-500" />
                                <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                                    {projectForDetails.name}
                                </h3>
                            </div>
                            <button
                                onClick={() => setProjectForDetails(null)}
                                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="space-y-3 text-xs">
                            <div className="p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 space-y-1.5">
                                <div className="flex justify-between">
                                    <span className="text-zinc-400">Type:</span>
                                    <span className="font-semibold text-zinc-800 dark:text-zinc-200">Creator Project</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-zinc-400">Status:</span>
                                    <span className="font-semibold capitalize text-zinc-800 dark:text-zinc-200">{projectForDetails.status.replace('_', ' ')}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-zinc-400">Project ID:</span>
                                    <span className="font-mono text-[10px] text-zinc-500">{projectForDetails.id}</span>
                                </div>
                            </div>

                            {projectForDetails.description && (
                                <div>
                                    <span className="text-zinc-400 block mb-1">Description:</span>
                                    <p className="text-zinc-600 dark:text-zinc-300 leading-relaxed p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/40">
                                        {projectForDetails.description}
                                    </p>
                                </div>
                            )}

                            <div className="pt-2">
                                <Link
                                    href={`/media-editor?project=${projectForDetails.id}`}
                                    onClick={() => setProjectForDetails(null)}
                                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 shadow-md shadow-indigo-600/20 transition active:scale-95"
                                >
                                    <Zap className="w-4 h-4 text-amber-300" />
                                    <span>Open in Media Studio</span>
                                </Link>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function ShareIcon(props: any) {
    return (
        <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
        </svg>
    );
}

function getPlatformIcon(platform: string) {
    switch (platform?.toLowerCase()) {
        case 'instagram':
            return <Instagram className="w-3.5 h-3.5 text-pink-500" />;
        case 'linkedin':
            return <Linkedin className="w-3.5 h-3.5 text-sky-600" />;
        case 'youtube':
            return <Youtube className="w-3.5 h-3.5 text-red-500" />;
        case 'tiktok':
            return <span className="text-[10px] font-black">TT</span>;
        default:
            return <ShareIcon className="w-3.5 h-3.5 text-zinc-400" />;
    }
}
