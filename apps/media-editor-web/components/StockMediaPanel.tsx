"use client";

import React, { useState } from "react";
import {
  Search,
  Film,
  Music,
  Image as ImageIcon,
  Sparkles,
  Plus,
  Play,
  Pause,
  ExternalLink,
  Volume2,
  Layers,
  Clock,
  Radio,
  RefreshCw,
} from "lucide-react";
import api from "@/lib/api";
import toast from "react-hot-toast";
import { MediaAssetDescriptor } from "@workspace/video-contracts";

interface StockMediaPanelProps {
  onAddAssetToProject: (asset: MediaAssetDescriptor) => void;
  onAddClipToTimeline: (asset: MediaAssetDescriptor) => void;
  aspectRatio?: "16:9" | "9:16" | "1:1";
}

export const StockMediaPanel: React.FC<StockMediaPanelProps> = ({
  onAddAssetToProject,
  onAddClipToTimeline,
  aspectRatio = "16:9",
}) => {
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "video" | "music" | "sfx" | "photo">("all");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<{
    videos: any[];
    photos: any[];
    illustrations: any[];
    audio: any[];
  }>({
    videos: [],
    photos: [],
    illustrations: [],
    audio: [],
  });

  const [previewAudioUrl, setPreviewAudioUrl] = useState<string | null>(null);
  const [audioPlayer, setAudioPlayer] = useState<HTMLAudioElement | null>(null);

  const handleSearch = async (searchQuery?: string) => {
    const q = (searchQuery ?? query).trim();
    if (!q) return;

    setLoading(true);
    try {
      const orientation = aspectRatio === "9:16" ? "portrait" : aspectRatio === "1:1" ? "square" : "landscape";
      const { data } = await api.get("/api/v1/media-editor/stock/unified", {
        params: {
          query: q,
          type: activeTab === "all" ? "all" : activeTab,
          orientation,
          perPage: 12,
        },
      });

      if (data && data.success) {
        setResults({
          videos: data.unifiedVideos || [],
          photos: data.unifiedPhotos || [],
          illustrations: data.unifiedIllustrations || [],
          audio: data.unifiedAudio || [],
        });
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || "Failed to search stock media");
    } finally {
      setLoading(false);
    }
  };

  const toggleAudioPreview = (url: string) => {
    if (previewAudioUrl === url) {
      audioPlayer?.pause();
      setPreviewAudioUrl(null);
    } else {
      audioPlayer?.pause();
      const player = new Audio(url);
      player.play();
      player.onended = () => setPreviewAudioUrl(null);
      setAudioPlayer(player);
      setPreviewAudioUrl(url);
    }
  };

  const [hoveredVideoId, setHoveredVideoId] = useState<string | null>(null);

  const getVideoThumb = (vid: any): string | null => {
    return vid.thumbnailUrl || vid.previewUrl || vid.image || null;
  };

  const getVideoDownloadUrl = (vid: any): string | null => {
    return vid.downloadUrl || vid.previewVideoUrl || vid.video_files?.[0]?.link || vid.url || null;
  };

  const getMediaProvider = (item: any): string => {
    if (item.provider) return String(item.provider).toUpperCase();
    const id = String(item.id || "").toLowerCase();
    if (id.startsWith("pexels")) return "PEXELS";
    if (id.startsWith("pixabay")) return "PIXABAY";
    if (id.startsWith("freesound")) return "FREESOUND";
    return "STOCK";
  };

  const getVideoAuthor = (vid: any): string => {
    return vid.photographer || vid.user?.name || (typeof vid.user === "string" ? vid.user : null) || "Creator";
  };

  const getPhotoThumb = (photo: any): string | null => {
    return (
      photo.thumbnailUrl ||
      photo.previewUrl ||
      photo.webformatUrl ||
      photo.webformatURL ||
      photo.src?.medium ||
      photo.downloadUrl ||
      (typeof photo.url === "string" && !photo.url.includes("pexels.com/photo/") ? photo.url : null)
    );
  };

  const getPhotoDownloadUrl = (photo: any): string | null => {
    return (
      photo.downloadUrl ||
      photo.largeImageUrl ||
      photo.src?.large2x ||
      photo.src?.large ||
      photo.webformatUrl ||
      photo.previewUrl ||
      null
    );
  };

  const getPhotoAuthor = (photo: any): string => {
    return (
      photo.photographer ||
      photo.attribution ||
      (typeof photo.user === "string" ? photo.user : photo.user?.name) ||
      "Creator"
    );
  };

  const handleAddVideo = (video: any, directToTimeline = false) => {
    const downloadUrl = getVideoDownloadUrl(video);
    if (!downloadUrl) {
      toast.error("Video stream URL not available");
      return;
    }

    const descriptor: MediaAssetDescriptor = {
      id: `stock_vid_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      name: video.title || `Stock: ${query || "Clip"} (${video.duration || 10}s)`,
      filePath: downloadUrl,
      mimeType: "video/mp4",
      durationSeconds: Number(video.durationSec || video.duration) || 10,
      width: video.width || (aspectRatio === "9:16" ? 1080 : 1920),
      height: video.height || (aspectRatio === "9:16" ? 1920 : 1080),
      fps: 30,
      fileSizeBytes: 5 * 1024 * 1024,
      hasAudio: true,
      sha256Hash: `hash_vid_${Date.now()}`,
    };

    onAddAssetToProject(descriptor);
    if (directToTimeline) {
      onAddClipToTimeline(descriptor);
      toast.success("Added stock video to timeline!");
    } else {
      toast.success("Added stock video to asset bin!");
    }
  };

  const handleAddAudio = (track: any, directToTimeline = false) => {
    const streamUrl = track.url || track.previewUrl;
    if (!streamUrl) {
      toast.error("Audio preview URL not available");
      return;
    }

    const descriptor: MediaAssetDescriptor = {
      id: `stock_audio_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      name: `${track.kind === "sfx" ? "SFX" : "Music"}: ${track.title || "Track"}`,
      filePath: streamUrl,
      mimeType: "audio/mp3",
      durationSeconds: Number(track.durationSec) || 30,
      width: 0,
      height: 0,
      fps: 0,
      fileSizeBytes: 1 * 1024 * 1024,
      hasAudio: true,
      sha256Hash: `hash_audio_${Date.now()}`,
    };

    onAddAssetToProject(descriptor);
    if (directToTimeline) {
      onAddClipToTimeline(descriptor);
      toast.success(`Added ${track.kind === "sfx" ? "SFX" : "music"} to audio track!`);
    } else {
      toast.success(`Added ${track.kind === "sfx" ? "SFX" : "music"} to asset bin!`);
    }
  };

  const handleAddPhoto = (photo: any, directToTimeline = false) => {
    const imageUrl = getPhotoDownloadUrl(photo);
    if (!imageUrl) {
      toast.error("Photo download URL not available");
      return;
    }

    const descriptor: MediaAssetDescriptor = {
      id: `stock_img_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      name: photo.title ? `Stock: ${photo.title}` : `Stock Photo: ${query || "Visual"}`,
      filePath: imageUrl,
      mimeType: "image/jpeg",
      durationSeconds: 5,
      width: photo.width || 1920,
      height: photo.height || 1080,
      fps: 0,
      fileSizeBytes: 2 * 1024 * 1024,
      hasAudio: false,
      sha256Hash: `hash_img_${Date.now()}`,
    };

    onAddAssetToProject(descriptor);
    if (directToTimeline) {
      onAddClipToTimeline(descriptor);
      toast.success("Added photo to timeline!");
    } else {
      toast.success("Added photo to asset bin!");
    }
  };

  const filteredAudio =
    activeTab === "music"
      ? results.audio.filter((a) => a.kind === "music")
      : activeTab === "sfx"
      ? results.audio.filter((a) => a.kind === "sfx")
      : results.audio;

  const totalResults =
    results.videos.length + results.photos.length + results.illustrations.length + results.audio.length;

  return (
    <div className="w-full flex-1 flex flex-col select-none relative bg-[#090A0E] text-gray-200 overflow-hidden font-sans">
      {/* Header */}
      <div className="px-3.5 py-3 border-b border-[#1A1C24] bg-[#0C0E15] shrink-0 flex items-center justify-between">
        <div className="flex items-center space-x-2.5">
          <div className="p-1 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-indigo-400" />
          </div>
          <div>
            <div className="flex items-center space-x-1.5">
              <span className="font-semibold text-xs tracking-wide text-white">Stock Media & Audio</span>
              <span className="px-1.5 py-0.2 rounded text-[9px] bg-emerald-950/80 text-emerald-400 border border-emerald-500/30 font-mono">
                ROYALTY-FREE
              </span>
            </div>
            <span className="text-[10px] text-gray-400 block">Pexels 4K • Pixabay • Freesound</span>
          </div>
        </div>

        <div className="px-2 py-0.5 rounded-full bg-[#141722] border border-[#212638] text-[10px] text-gray-400 font-mono">
          {aspectRatio}
        </div>
      </div>

      {/* Search Input */}
      <div className="p-3 border-b border-[#1A1C24] bg-[#0C0E16] shrink-0 space-y-2">
        <div className="relative flex items-center">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Search B-roll, music, SFX (e.g. 'cyberpunk', 'office drone')..."
            className="w-full bg-[#131622] text-xs text-gray-100 placeholder-gray-500 pl-8 pr-9 py-2 rounded-xl border border-[#202538] focus:border-indigo-500 focus:outline-none transition"
          />
          <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5" />
          <button
            onClick={() => handleSearch()}
            disabled={loading || !query.trim()}
            className="absolute right-1.5 p-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 transition"
            title="Search"
          >
            {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center space-x-1 overflow-x-auto no-scrollbar pt-0.5 text-[10px]">
          {[
            { id: "all", label: "All" },
            { id: "video", label: `Videos (${results.videos.length})` },
            { id: "music", label: `Music (${results.audio.filter((a) => a.kind === "music").length})` },
            { id: "sfx", label: `SFX (${results.audio.filter((a) => a.kind === "sfx").length})` },
            { id: "photo", label: `Photos (${results.photos.length + results.illustrations.length})` },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id as any);
                if (query.trim()) handleSearch();
              }}
              className={`px-2.5 py-1 rounded-lg font-medium transition whitespace-nowrap ${
                activeTab === tab.id
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "bg-[#141722] text-gray-400 hover:text-white hover:bg-[#1D2132]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Results Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 scrollbar-thin scrollbar-thumb-[#1F222E] scrollbar-track-transparent">
        {loading ? (
          <div className="py-16 text-center space-y-3">
            <RefreshCw className="w-6 h-6 animate-spin text-indigo-400 mx-auto" />
            <p className="text-xs text-gray-400">Searching global HD footage & audio...</p>
          </div>
        ) : totalResults === 0 ? (
          <div className="py-12 text-center p-4 border border-dashed border-[#202538] rounded-2xl bg-[#0D0F17] space-y-3">
            <Sparkles className="w-8 h-8 text-indigo-400 mx-auto opacity-75" />
            <div>
              <p className="text-xs font-semibold text-gray-200">Instant Stock & Audio Library</p>
              <p className="text-[11px] text-gray-400 mt-1 max-w-xs mx-auto leading-relaxed">
                Search context-matched B-roll, background music, or SFX.
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5 justify-center pt-2">
              {["tech workspace", "upbeat vlog", "whoosh transition", "city drone", "ambient lo-fi"].map((tag) => (
                <button
                  key={tag}
                  onClick={() => {
                    setQuery(tag);
                    handleSearch(tag);
                  }}
                  className="px-2.5 py-1 rounded-full bg-[#151926] hover:bg-indigo-950 text-[10px] text-indigo-300 border border-indigo-500/20 transition"
                >
                  #{tag}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* 1. Video Section */}
            {(activeTab === "all" || activeTab === "video") && results.videos.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-gray-300">
                  <span className="flex items-center gap-1.5">
                    <Film className="w-3.5 h-3.5 text-indigo-400" />
                    <span>HD & 4K Video Clips</span>
                  </span>
                  <span className="text-[10px] text-gray-500 font-mono">{results.videos.length} clips</span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {results.videos.map((vid, idx) => {
                    const thumb = getVideoThumb(vid);
                    const provider = getMediaProvider(vid);
                    const author = getVideoAuthor(vid);
                    const isHovered = hoveredVideoId === (vid.id || String(idx));
                    return (
                      <div
                        key={vid.id || idx}
                        onMouseEnter={() => setHoveredVideoId(vid.id || String(idx))}
                        onMouseLeave={() => setHoveredVideoId(null)}
                        className="group relative rounded-xl overflow-hidden bg-[#11131C] border border-[#1E212E] hover:border-indigo-500/50 transition-all flex flex-col justify-between"
                      >
                        <div className="relative aspect-video bg-black/40 overflow-hidden">
                          {thumb ? (
                            <img
                              src={thumb}
                              alt={vid.title || "Stock Video"}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-600">
                              <Film className="w-6 h-6" />
                            </div>
                          )}

                          <span className="absolute top-1 left-1 px-1.5 py-0.2 rounded text-[8px] font-mono uppercase bg-black/80 text-emerald-400 border border-emerald-500/30">
                            {provider}
                          </span>

                          <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/70 text-[9px] font-mono text-gray-300">
                            {vid.duration ? `${vid.duration}s` : "HD"}
                          </span>
                        </div>

                        <div className="p-2 space-y-1.5">
                          <div className="flex items-center justify-between text-[10px] text-gray-400">
                            <span className="truncate max-w-[105px]" title={author}>
                              {author}
                            </span>
                            <span className="uppercase text-[9px] font-mono text-indigo-400">
                              {vid.width && vid.height ? `${vid.width >= 3840 ? "4K" : "HD"}` : "HD"}
                            </span>
                          </div>

                          <div className="flex items-center space-x-1">
                            <button
                              onClick={() => handleAddVideo(vid, true)}
                              className="flex-1 py-1 px-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white text-[10px] font-semibold flex items-center justify-center gap-1 transition"
                            >
                              <Plus className="w-3 h-3" />
                              <span>+ Track</span>
                            </button>
                            <button
                              onClick={() => handleAddVideo(vid, false)}
                              className="py-1 px-2 rounded-lg bg-[#191D2B] hover:bg-[#23293D] text-gray-300 text-[10px] font-medium transition"
                              title="Add to Project Asset Bin"
                            >
                              Bin
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 2. Audio Section (Music & SFX) */}
            {(activeTab === "all" || activeTab === "music" || activeTab === "sfx") && filteredAudio.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-gray-300">
                  <span className="flex items-center gap-1.5">
                    <Music className="w-3.5 h-3.5 text-emerald-400" />
                    <span>{activeTab === "sfx" ? "Sound Effects" : activeTab === "music" ? "Royalty-Free Music" : "Audio & Sound Effects"}</span>
                  </span>
                  <span className="text-[10px] text-gray-500 font-mono">{filteredAudio.length} tracks</span>
                </div>

                <div className="space-y-1.5">
                  {filteredAudio.map((track, idx) => {
                    const isPlaying = previewAudioUrl === (track.url || track.previewUrl);
                    const provider = getMediaProvider(track);
                    return (
                      <div
                        key={idx}
                        className="p-2 rounded-xl bg-[#11131C] border border-[#1E212E] hover:border-emerald-500/40 transition flex items-center justify-between gap-2"
                      >
                        <button
                          onClick={() => toggleAudioPreview(track.url || track.previewUrl)}
                          className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition ${
                            isPlaying ? "bg-emerald-500 text-white" : "bg-[#181C2A] text-emerald-400 hover:bg-[#202538]"
                          }`}
                        >
                          {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
                        </button>

                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-gray-200 truncate">{track.title || "Audio Track"}</p>
                          <div className="flex items-center space-x-1.5 text-[9px] text-gray-400 font-mono mt-0.5">
                            <span className="px-1 py-0.2 rounded bg-black/40 text-emerald-300 uppercase">
                              {track.kind || "audio"}
                            </span>
                            <span className="px-1 py-0.2 rounded bg-indigo-950/60 text-indigo-300 uppercase text-[8px]">
                              {provider}
                            </span>
                            {track.durationSec && <span>{track.durationSec.toFixed(1)}s</span>}
                            {track.genre && <span>• {track.genre}</span>}
                          </div>
                        </div>

                        <div className="flex items-center space-x-1 shrink-0">
                          <button
                            onClick={() => handleAddAudio(track, true)}
                            className="py-1 px-2 rounded-lg bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white text-[10px] font-semibold transition"
                            title="Add directly to audio track"
                          >
                            + Track
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 3. Photos & Graphics Section */}
            {(activeTab === "all" || activeTab === "photo") && (results.photos.length > 0 || results.illustrations.length > 0) && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-gray-300">
                  <span className="flex items-center gap-1.5">
                    <ImageIcon className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Photos & Graphics</span>
                  </span>
                  <span className="text-[10px] text-gray-500 font-mono">
                    {results.photos.length + results.illustrations.length} items
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {[...results.photos, ...results.illustrations].map((photo, idx) => {
                    const imgSrc = getPhotoThumb(photo);
                    const provider = getMediaProvider(photo);
                    const author = getPhotoAuthor(photo);
                    return (
                      <div
                        key={photo.id || idx}
                        className="group relative rounded-xl overflow-hidden bg-[#11131C] border border-[#1E212E] hover:border-cyan-500/50 transition flex flex-col justify-between"
                      >
                        <div className="relative aspect-video bg-black/40 overflow-hidden">
                          {imgSrc ? (
                            <img
                              src={imgSrc}
                              alt={photo.title || "Stock Visual"}
                              className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-600">
                              <ImageIcon className="w-6 h-6" />
                            </div>
                          )}

                          <span className="absolute top-1 left-1 px-1.5 py-0.2 rounded text-[8px] font-mono uppercase bg-black/80 text-cyan-400 border border-cyan-500/30">
                            {provider}
                          </span>
                        </div>
                        <div className="p-1.5 flex items-center justify-between">
                          <span className="text-[9px] text-gray-400 truncate max-w-[80px]" title={author}>
                            {author}
                          </span>
                          <button
                            onClick={() => handleAddPhoto(photo, true)}
                            className="px-2 py-0.5 rounded bg-cyan-600/20 hover:bg-cyan-600 text-cyan-300 hover:text-white text-[9px] font-semibold transition"
                          >
                            + Track
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

