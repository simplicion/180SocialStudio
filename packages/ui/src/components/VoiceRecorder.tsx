"use client";

import React, { useState, useRef, useEffect } from 'react';
import { Mic, Square, Trash2, Send, Play, Pause, Lock, CheckCircle2 } from 'lucide-react';
import clsx from 'clsx';
import { LogoLoader } from './LogoLoader';

export interface VoiceRecorderProps {
    onRecordingComplete: (blob: Blob) => void;
    onDiscard?: () => void;
}

export function VoiceRecorder({ onRecordingComplete, onDiscard }: VoiceRecorderProps) {
    const [isRecording, setIsRecording] = useState(false);
    const [isLocked, setIsLocked] = useState(false);
    const [recordingTime, setRecordingTime] = useState(0);
    const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
    const startYRef = useRef<number | null>(null);

    // Formats seconds into M:SS
    const formatTime = (time: number) => {
        const mins = Math.floor(time / 60);
        const secs = time % 60;
        return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    };

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorderRef.current = new MediaRecorder(stream);
            audioChunksRef.current = [];

            mediaRecorderRef.current.ondataavailable = (e) => {
                if (e.data.size > 0) audioChunksRef.current.push(e.data);
            };

            mediaRecorderRef.current.onstop = () => {
                const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                setAudioBlob(blob);
                onRecordingComplete(blob);
                stream.getTracks().forEach(track => track.stop());
            };

            mediaRecorderRef.current.start();
            setIsRecording(true);
            setIsLocked(false);
            setRecordingTime(0);

            timerRef.current = setInterval(() => {
                setRecordingTime(prev => prev + 1);
            }, 1000);
        } catch (err) {
            console.error("Failed to access microphone", err);
            alert("Microphone access is required to record audio.");
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            if (timerRef.current) clearInterval(timerRef.current);
        }
    };

    const discardRecording = () => {
        if (isRecording) stopRecording();
        setAudioBlob(null);
        setRecordingTime(0);
        setIsLocked(false);
        setIsPlaying(false);
        if (audioPlayerRef.current) {
            audioPlayerRef.current.pause();
            audioPlayerRef.current.src = "";
        }
        if (onDiscard) onDiscard();
    };

    const togglePlay = () => {
        if (audioBlob) {
            if (!audioPlayerRef.current) {
                audioPlayerRef.current = new Audio(URL.createObjectURL(audioBlob));
                audioPlayerRef.current.onended = () => setIsPlaying(false);
            }
            if (isPlaying) {
                audioPlayerRef.current.pause();
                setIsPlaying(false);
            } else {
                audioPlayerRef.current.play();
                setIsPlaying(true);
            }
        }
    };

    // Clean up
    useEffect(() => {
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
            if (mediaRecorderRef.current?.state === "recording") {
                mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
            }
        };
    }, []);

    const handlePointerDown = (e: React.PointerEvent) => {
        if (audioBlob) return; // Already recorded
        e.currentTarget.setPointerCapture(e.pointerId);
        startYRef.current = e.clientY;
        startRecording();
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!isRecording || isLocked || !startYRef.current) return;
        // If dragged up by 40 pixels, lock it
        if (startYRef.current - e.clientY > 40) {
            setIsLocked(true);
        }
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        startYRef.current = null;
        if (isRecording && !isLocked) {
            // Stop recording normally if released
            stopRecording();
        }
    };

    if (audioBlob) {
        return (
            <div className="flex items-center gap-3 bg-indigo-50 dark:bg-zinc-900 border border-indigo-100 dark:border-zinc-800 rounded-full py-1.5 px-3">
                <button type="button" onClick={togglePlay} className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center hover:bg-indigo-700 transition-colors">
                    {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                </button>
                <div className="flex-1 h-1.5 bg-indigo-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-600 rounded-full" style={{ width: '100%' }} />
                </div>
                <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 w-10">{formatTime(recordingTime)}</span>
                <button type="button" onClick={discardRecording} className="text-gray-400 hover:text-red-500 transition-colors">
                    <Trash2 className="w-4 h-4" />
                </button>
                <span className="text-emerald-500 ml-1">
                    <CheckCircle2 className="w-5 h-5" />
                </span>
            </div>
        );
    }

    return (
        <div className="flex items-center justify-end">
            <div 
                className={clsx(
                    "flex items-center gap-4 transition-all duration-300 ease-in-out",
                    isRecording ? "opacity-100 translate-x-0" : "opacity-0 translate-x-10 pointer-events-none"
                )}
            >
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-sm font-semibold text-gray-700 dark:text-zinc-300 min-w-[40px]">
                    {formatTime(recordingTime)}
                </span>
                {isLocked ? (
                    <button type="button" onClick={stopRecording} className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-950/50 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 flex items-center justify-center transition-colors">
                        <Square className="w-4 h-4" />
                    </button>
                ) : (
                    <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-zinc-500 font-medium animate-bounce pr-4">
                        <Lock className="w-3 h-3" /> Swipe up to lock
                    </div>
                )}
            </div>

            <button
                type="button"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                className={clsx(
                    "w-10 h-10 rounded-full flex items-center justify-center transition-all touch-none select-none",
                    isRecording && !isLocked ? "bg-red-500 text-white scale-125 shadow-xl ml-4" : 
                    isRecording && isLocked ? "bg-indigo-600 text-white ml-4" : 
                    "bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 hover:bg-indigo-50 dark:hover:bg-zinc-700 hover:text-indigo-600 dark:hover:text-zinc-100"
                )}
                title="Hold to record voice message"
            >
                <Mic className="w-5 h-5" />
            </button>
        </div>
    );
}
