'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

export interface PlatformDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    title: React.ReactNode;
    icon?: React.ElementType;
    iconColorClass?: string;
    iconBgClass?: string;
    subHeader?: React.ReactNode;
    children: React.ReactNode;
    footer?: React.ReactNode;
    maxWidthClass?: string; // e.g. 'max-w-lg', 'max-w-xl', 'max-w-2xl'
    onSubmit?: (e: React.FormEvent) => void;
    bodyClassName?: string;
    position?: 'right' | 'left';
    zIndex?: string;
}

export function PlatformDrawer({
    isOpen,
    onClose,
    title,
    icon: Icon,
    iconColorClass = 'text-blue-600 dark:text-blue-400',
    iconBgClass = 'bg-blue-500/10',
    subHeader,
    children,
    footer,
    maxWidthClass = 'max-w-lg',
    onSubmit,
    bodyClassName = 'space-y-5',
    position = 'right',
    zIndex = 'z-[99999]'
}: PlatformDrawerProps) {
    const [mounted, setMounted] = useState(false);
    const isLeft = position === 'left';

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
        return () => {
            document.body.style.overflow = 'unset';
        };
    }, [isOpen]);

    // Handle escape key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    if (!mounted) return null;

    const ContentWrapper = (onSubmit ? 'form' : 'div') as any;

    return createPortal(
        <AnimatePresence>
            {isOpen && (
                <div className={`fixed inset-0 ${zIndex} flex ${isLeft ? 'justify-start' : 'justify-end'}`}>
                    {/* Backdrop */}
                    <motion.div
                        className="fixed inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-sm"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        onClick={onClose}
                    />

                    {/* Drawer Panel */}
                    <motion.div
                        className={`relative bg-white dark:bg-zinc-950 w-full ${maxWidthClass} h-full shadow-2xl flex flex-col z-10 border-l border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 overflow-hidden`}
                        initial={{ x: isLeft ? '-100%' : '100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: isLeft ? '-100%' : '100%' }}
                        transition={{ type: 'spring', damping: 26, stiffness: 220 }}
                    >
                        {/* Drawer Header */}
                        <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-100 dark:border-zinc-800/80 bg-white/95 dark:bg-zinc-950/95 backdrop-blur-md shrink-0">
                            <div className="flex items-center gap-3 min-w-0">
                                {Icon && (
                                    <div className={`w-10 h-10 rounded-2xl ${iconBgClass} flex items-center justify-center shrink-0`}>
                                        <Icon className={`w-5 h-5 ${iconColorClass}`} />
                                    </div>
                                )}
                                <h2 className="text-lg font-bold text-zinc-900 dark:text-white tracking-tight truncate">
                                    {title}
                                </h2>
                            </div>
                            <button
                                onClick={onClose}
                                type="button"
                                aria-label="Close drawer"
                                title="Close drawer"
                                className="w-10 h-10 min-h-[40px] min-w-[40px] rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-900 flex items-center justify-center transition-colors shrink-0 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer"
                            >
                                <X className="w-5 h-5" aria-hidden="true" />
                            </button>
                        </div>

                        {subHeader && (
                            <div className="shrink-0 border-b border-zinc-100 dark:border-zinc-800/80 bg-zinc-50/50 dark:bg-zinc-900/30">
                                {subHeader}
                            </div>
                        )}

                        {/* Drawer Content */}
                        <ContentWrapper
                            onSubmit={onSubmit}
                            className="flex flex-col flex-1 min-h-0 overflow-hidden"
                        >
                            <div className={`flex-1 overflow-y-auto px-6 py-6 custom-scrollbar ${bodyClassName}`}>
                                {children}
                            </div>

                            {footer && (
                                <div className="px-6 py-4 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-end gap-3 shrink-0 bg-zinc-50/80 dark:bg-zinc-900/60 backdrop-blur-xs">
                                    {footer}
                                </div>
                            )}
                        </ContentWrapper>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>,
        document.body
    );
}

export default PlatformDrawer;
