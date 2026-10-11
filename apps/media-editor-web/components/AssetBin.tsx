import React, { useRef, useState } from "react";
import {
  Folder,
  Film,
  Music,
  Plus,
  Clock,
  Cpu,
  UploadCloud,
  Play,
  Trash2,
  Search,
  Sparkles,
  FileVideo,
  Layers,
  Image as ImageIcon,
} from "lucide-react";
import { MediaAssetDescriptor } from "@workspace/video-contracts";

interface AssetBinProps {
  assets: MediaAssetDescriptor[];
  onImportFiles: (files: FileList | File[]) => void;
  onAddClipToTimeline: (asset: MediaAssetDescriptor) => void;
  onRemoveAsset?: (assetId: string) => void;
}

export const AssetBin: React.FC<AssetBinProps> = ({
  assets,
  onImportFiles,
  onAddClipToTimeline,
  onRemoveAsset,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "video" | "image" | "audio">("all");

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onImportFiles(e.target.files);
      e.target.value = "";
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onImportFiles(e.dataTransfer.files);
    }
  };

  const filteredAssets = assets.filter((asset) => {
    const matchesSearch = asset.name.toLowerCase().includes(searchQuery.toLowerCase());
    const isImage = asset.mimeType?.startsWith("image/") || Boolean(asset.name.match(/\.(jpg|jpeg|png|webp|gif|svg)$/i));
    const isAudio = asset.mimeType?.startsWith("audio/");
    const isVideo = !isImage && !isAudio;
    if (filterType === "video") return matchesSearch && isVideo;
    if (filterType === "image") return matchesSearch && isImage;
    if (filterType === "audio") return matchesSearch && isAudio;
    return matchesSearch;
  });

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`w-full flex-1 flex flex-col select-none relative bg-[#0B0B0C] transition-colors ${
        isDragging ? "ring-2 ring-indigo-500 bg-indigo-950/20" : ""
      }`}
    >
      {/* Hidden Native File Input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="video/*,audio/*,image/*"
        multiple
        className="hidden"
      />

      {/* Header */}
      <div className="p-3 border-b border-[#1F1F24] flex items-center justify-between bg-[#0B0B0C]">
        <div className="flex items-center space-x-2 text-gray-200">
          <div className="p-1.5 rounded-md bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            <Folder className="w-3.5 h-3.5" />
          </div>
          <div>
            <span className="font-semibold text-xs text-gray-200">Media Assets</span>
            <span className="block text-[10px] text-gray-400">{assets.length} items</span>
          </div>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center space-x-1 px-2.5 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white text-xs font-semibold shadow-sm transition"
          title="Select files from your computer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Import</span>
        </button>
      </div>

      {/* Search & Filter Bar */}
      <div className="p-2.5 border-b border-[#1F1F24] space-y-2 bg-[#0E0E10]">
        <div className="relative">
          <Search className="w-3 h-3 text-gray-400 absolute left-2.5 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search footage..."
            className="w-full bg-[#141417] text-[11px] text-gray-200 placeholder-gray-500 pl-8 pr-2.5 py-1.5 rounded-md border border-[#1F1F24] focus:border-indigo-500 focus:outline-none transition"
          />
        </div>

        <div className="flex items-center space-x-1 text-[10px]">
          <button
            onClick={() => setFilterType("all")}
            className={`px-2 py-0.5 rounded-md font-medium transition ${
              filterType === "all"
                ? "bg-indigo-600/20 text-indigo-300 border border-indigo-500/30"
                : "text-gray-400 hover:text-gray-200 hover:bg-[#1F1F24]"
            }`}
          >
            All ({assets.length})
          </button>
          <button
            onClick={() => setFilterType("video")}
            className={`px-2 py-0.5 rounded-md font-medium transition ${
              filterType === "video"
                ? "bg-indigo-600/20 text-indigo-300 border border-indigo-500/30"
                : "text-gray-400 hover:text-gray-200 hover:bg-[#1F1F24]"
            }`}
          >
            Video
          </button>
          <button
            onClick={() => setFilterType("image")}
            className={`px-2 py-0.5 rounded-md font-medium transition ${
              filterType === "image"
                ? "bg-indigo-600/20 text-indigo-300 border border-indigo-500/30"
                : "text-gray-400 hover:text-gray-200 hover:bg-[#1F1F24]"
            }`}
          >
            Images
          </button>
          <button
            onClick={() => setFilterType("audio")}
            className={`px-2 py-0.5 rounded-md font-medium transition ${
              filterType === "audio"
                ? "bg-indigo-600/20 text-indigo-300 border border-indigo-500/30"
                : "text-gray-400 hover:text-gray-200 hover:bg-[#1F1F24]"
            }`}
          >
            Audio
          </button>
        </div>
      </div>

      {/* Asset List & Drag Overlay */}
      <div className="p-2 overflow-y-auto flex-1 space-y-1.5 relative">
        {isDragging && (
          <div className="absolute inset-2 z-30 rounded-lg bg-indigo-950/90 border-2 border-dashed border-indigo-400 flex flex-col items-center justify-center p-4 text-center backdrop-blur-sm animate-pulse">
            <UploadCloud className="w-8 h-8 text-indigo-300 mb-1.5" />
            <p className="text-xs font-bold text-white">Drop media to import</p>
            <p className="text-[10px] text-indigo-200 mt-0.5">MP4, WebM, MOV, MP3, WAV</p>
          </div>
        )}

        {filteredAssets.length === 0 ? (
          <div className="p-5 text-center border border-dashed border-[#1F1F24] rounded-lg mt-3 bg-[#111114] flex flex-col items-center justify-center">
            <div className="w-8 h-8 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mb-2">
              <UploadCloud className="w-4 h-4" />
            </div>
            <p className="text-xs font-semibold text-gray-200">No media in project</p>
            <p className="text-[10px] text-gray-400 mt-1 max-w-[180px]">
              Drag video files here or click Import to load footage.
            </p>

            <div className="flex flex-col w-full space-y-1.5 mt-3">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-1.5 px-3 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition shadow-sm"
              >
                Choose Local File...
              </button>
            </div>
          </div>
        ) : (
          filteredAssets.map((asset) => {
            const isAudio = asset.mimeType?.startsWith("audio/");
            const isImage = asset.mimeType?.startsWith("image/") || Boolean(asset.name.match(/\.(jpg|jpeg|png|webp|gif|svg)$/i));
            return (
              <div
                key={asset.id}
                className="p-2 rounded-lg bg-[#111114] hover:bg-[#16161A] border border-[#1F1F24] hover:border-indigo-500/50 transition-all group relative"
              >
                <div className="flex items-start space-x-2">
                  {/* Media Thumbnail or Icon */}
                  <div
                    onClick={() => onAddClipToTimeline(asset)}
                    className="w-10 h-10 rounded-md bg-[#0B0B0C] border border-[#1F1F24] flex items-center justify-center text-indigo-400 shrink-0 relative overflow-hidden group-hover:ring-1 group-hover:ring-indigo-500/50 cursor-pointer"
                  >
                    {isImage ? (
                      asset.filePath?.startsWith("blob:") || asset.filePath?.startsWith("http") ? (
                        <img src={asset.filePath} alt={asset.name} className="w-full h-full object-cover" />
                      ) : (
                        <ImageIcon className="w-4 h-4 text-cyan-400" />
                      )
                    ) : isAudio ? (
                      <Music className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Film className="w-4 h-4 text-indigo-400" />
                    )}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                      <Plus className="w-3.5 h-3.5 text-white" />
                    </div>
                  </div>

                  {/* Metadata */}
                  <div className="flex-1 min-w-0">
                    <p
                      onClick={() => onAddClipToTimeline(asset)}
                      className="text-xs font-medium text-gray-200 truncate group-hover:text-indigo-300 cursor-pointer"
                      title={asset.name}
                    >
                      {asset.name}
                    </p>

                    <div className="flex items-center space-x-1 text-[10px] text-gray-400 mt-0.5">
                      <span className="flex items-center space-x-0.5 bg-[#050505] px-1 py-0.2 rounded border border-[#1F1F24] font-mono text-[9px]">
                        <Clock className="w-2 h-2 text-gray-500" />
                        <span>{asset.durationSeconds.toFixed(1)}s</span>
                      </span>
                      <span>•</span>
                      <span>{isAudio ? "Audio Track" : `${asset.width}x${asset.height}`}</span>
                    </div>

                    <div className="flex items-center justify-between mt-1.5 pt-1 border-t border-[#1F1F24] text-[10px]">
                      <span className="text-gray-500 font-mono text-[9px]">
                        {asset.fileSizeBytes ? `${(asset.fileSizeBytes / (1024 * 1024)).toFixed(1)} MB` : "Stream Copy"}
                      </span>

                      <div className="flex items-center space-x-1">
                        <button
                          onClick={() => onAddClipToTimeline(asset)}
                          className="px-1.5 py-0.5 rounded bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 text-[10px] font-medium transition"
                          title="Add to Timeline"
                        >
                          + Track
                        </button>
                        {onRemoveAsset && (
                          <button
                            onClick={() => onRemoveAsset(asset.id)}
                            className="p-0.5 rounded text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition"
                            title="Remove Asset"
                          >
                            <Trash2 className="w-2.5 h-2.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Storage & Engine Status Footer */}
      <div className="p-2.5 border-t border-[#1F1F24] bg-[#0E0E10] text-[10px] text-gray-400 flex items-center justify-between">
        <span className="flex items-center space-x-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <Cpu className="w-3 h-3 text-emerald-400" />
          <span>Zero-Copy Native Pipeline</span>
        </span>
        <span className="font-mono text-gray-500 text-[9px]">{filteredAssets.length} Assets</span>
      </div>
    </div>
  );
};
