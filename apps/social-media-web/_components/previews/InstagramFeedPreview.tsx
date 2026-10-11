'use client';

import React, { useState } from 'react';
import { Heart, MessageCircle, Send, Bookmark, MoreHorizontal, Sparkles, ShieldAlert, Music2 } from 'lucide-react';

interface InstagramFeedPreviewProps {
    username?: string;
    accountName?: string;
    profileImage?: string;
    caption: string;
    mediaUrls?: string[];
    finalVideoUrl?: string;
    thumbnailUrl?: string;
    isReel?: boolean;
    showSafeZone?: boolean;
}

export function InstagramFeedPreview({
    username = '180workspace',
    accountName = '180workspace Official',
    profileImage = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=100&auto=format&fit=crop&q=80',
    caption,
    mediaUrls = [],
    finalVideoUrl,
    thumbnailUrl,
    isReel = false,
    showSafeZone = false
}: InstagramFeedPreviewProps) {
    const [liked, setLiked] = useState(false);
    const [saved, setSaved] = useState(false);
    const [currentSlide, setCurrentSlide] = useState(0);

    const hasMedia = (mediaUrls && mediaUrls.length > 0) || finalVideoUrl || thumbnailUrl;
    const activeMedia = finalVideoUrl || thumbnailUrl || (mediaUrls && mediaUrls[0]) || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=80';

    if (isReel) {
        return (
            <div className="w-full max-w-[320px] mx-auto bg-black rounded-[28px] overflow-hidden border-[6px] border-slate-800 shadow-2xl relative text-white font-sans aspect-[9/16] flex flex-col justify-between select-none">
                {/* Background Video / Thumbnail */}
                <div className="absolute inset-0 z-0 bg-slate-900">
                    <img src={activeMedia} alt="Reel media" className="w-full h-full object-cover opacity-90" />
                    <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/80" />
                </div>

                {/* Safe-Zone Overlay if toggled */}
                {showSafeZone && (
                    <div className="absolute inset-x-4 top-16 bottom-28 border-2 border-dashed border-yellow-400/70 rounded-xl z-20 pointer-events-none flex flex-col items-center justify-center p-4 text-center bg-yellow-500/10 backdrop-blur-[1px]">
                        <ShieldAlert className="w-6 h-6 text-yellow-400 mb-1 animate-bounce" />
                        <span className="text-[11px] font-bold text-yellow-300 uppercase tracking-wider">Instagram Safe Zone</span>
                        <span className="text-[9px] text-yellow-200/80 mt-0.5">Keep crucial text & hooks inside this frame</span>
                    </div>
                )}

                {/* Top Bar */}
                <div className="relative z-10 flex items-center justify-between p-4 pt-5 text-sm font-semibold">
                    <span className="tracking-wide">Reels</span>
                    <MoreHorizontal className="w-5 h-5 cursor-pointer opacity-80 hover:opacity-100" />
                </div>

                {/* Right Action Stack */}
                <div className="relative z-10 self-end mr-3 flex flex-col items-center gap-4 text-center mb-16">
                    <button onClick={() => setLiked(!liked)} className="flex flex-col items-center gap-1 group">
                        <div className={`p-2 rounded-full transition-transform active:scale-125 ${liked ? 'text-rose-500' : 'text-white'}`}>
                            <Heart className={`w-7 h-7 ${liked ? 'fill-rose-500' : ''}`} />
                        </div>
                        <span className="text-[11px] font-medium">{liked ? '1,421' : '1,420'}</span>
                    </button>
                    <div className="flex flex-col items-center gap-1">
                        <MessageCircle className="w-7 h-7 cursor-pointer" />
                        <span className="text-[11px] font-medium">84</span>
                    </div>
                    <Send className="w-6 h-6 cursor-pointer hover:scale-110 transition-transform" />
                    <button onClick={() => setSaved(!saved)}>
                        <Bookmark className={`w-6 h-6 ${saved ? 'fill-white' : ''}`} />
                    </button>
                    <div className="w-8 h-8 rounded-lg border-2 border-white overflow-hidden mt-2 animate-spin-slow">
                        <img src={profileImage} alt="Audio" className="w-full h-full object-cover" />
                    </div>
                </div>

                {/* Bottom Creator Info & Caption */}
                <div className="relative z-10 p-4 pb-5 space-y-2 bg-gradient-to-t from-black/90 to-transparent">
                    <div className="flex items-center gap-2">
                        <img src={profileImage} alt={username} className="w-8 h-8 rounded-full border border-white/40 object-cover" />
                        <span className="font-bold text-xs">@{username}</span>
                        <button className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold border border-white/50 hover:bg-white hover:text-black transition-colors">
                            Follow
                        </button>
                    </div>
                    <p className="text-xs text-white/90 line-clamp-2 leading-relaxed">
                        {caption || 'Add your engaging caption and hooks here...'}
                    </p>
                    <div className="flex items-center gap-1.5 text-[11px] text-white/70">
                        <Music2 className="w-3.5 h-3.5" />
                        <span className="truncate">Original audio &bull; {username}</span>
                    </div>
                </div>
            </div>
        );
    }

    // Standard Feed Post
    return (
        <div className="w-full max-w-[360px] mx-auto bg-white rounded-2xl border border-slate-200 shadow-lg overflow-hidden font-sans text-slate-900">
            {/* Header */}
            <div className="flex items-center justify-between p-3.5 border-b border-slate-100">
                <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-full p-[2px] bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600">
                        <img src={profileImage} alt={username} className="w-full h-full rounded-full border border-white object-cover" />
                    </div>
                    <div>
                        <p className="text-xs font-bold leading-tight flex items-center gap-1">
                            {username}
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block" />
                        </p>
                        <p className="text-[10px] text-slate-400">{accountName}</p>
                    </div>
                </div>
                <MoreHorizontal className="w-4 h-4 text-slate-400 cursor-pointer" />
            </div>

            {/* Media Area */}
            <div className="relative aspect-square bg-slate-100 overflow-hidden">
                <img src={activeMedia} alt="Post media" className="w-full h-full object-cover" />
                {mediaUrls && mediaUrls.length > 1 && (
                    <div className="absolute top-3 right-3 bg-black/70 text-white text-[10px] font-semibold px-2 py-0.5 rounded-full backdrop-blur-sm">
                        {currentSlide + 1}/{mediaUrls.length}
                    </div>
                )}
            </div>

            {/* Action Bar */}
            <div className="p-3.5 pb-2">
                <div className="flex items-center justify-between mb-2.5">
                    <div className="flex items-center gap-4">
                        <button onClick={() => setLiked(!liked)} className={`transition-transform active:scale-125 ${liked ? 'text-rose-500 fill-rose-500' : 'text-slate-700 hover:text-slate-900'}`}>
                            <Heart className={`w-6 h-6 ${liked ? 'fill-rose-500' : ''}`} />
                        </button>
                        <MessageCircle className="w-6 h-6 text-slate-700 cursor-pointer hover:text-slate-900" />
                        <Send className="w-5 h-5 text-slate-700 cursor-pointer hover:text-slate-900" />
                    </div>
                    <button onClick={() => setSaved(!saved)}>
                        <Bookmark className={`w-5 h-5 text-slate-700 ${saved ? 'fill-slate-900 text-slate-900' : ''}`} />
                    </button>
                </div>
                <p className="text-xs font-bold mb-1.5">{liked ? '482 likes' : '481 likes'}</p>

                {/* Caption */}
                <div className="text-xs text-slate-800 leading-relaxed whitespace-pre-wrap">
                    <span className="font-bold mr-1.5">{username}</span>
                    {caption || 'Add your post caption and relevant hashtags here...'}
                </div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wider mt-2">Just now</p>
            </div>
        </div>
    );
}
