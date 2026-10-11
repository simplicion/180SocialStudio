'use client';

import { X } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export interface PlatformModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: React.ReactNode;
    icon?: React.ElementType;
    iconColorClass?: string;
    iconBgClass?: string;
    subHeader?: React.ReactNode;
    children: React.ReactNode;
    footer?: React.ReactNode;
    maxWidthClass?: string;
    onSubmit?: (e: React.FormEvent) => void;
    bodyClassName?: string;
}

export function PlatformModal({
    isOpen,
    onClose,
    title,
    icon: Icon,
    iconColorClass = 'text-indigo-600',
    iconBgClass = 'bg-indigo-50',
    subHeader,
    children,
    footer,
    maxWidthClass = 'max-w-lg',
    onSubmit,
    bodyClassName = 'space-y-4'
}: PlatformModalProps) {
    const [mounted, setMounted] = useState(false);

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
            if (e.key === 'Escape' && isOpen) onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    if (!mounted || !isOpen) return null;

    const ContentWrapper = (onSubmit ? 'form' : 'div') as any;

    return createPortal(
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 dark:bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
            <div className={`bg-white dark:bg-zinc-950 rounded-3xl shadow-2xl w-full ${maxWidthClass} max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-200 border border-gray-100 dark:border-white/10 overflow-hidden text-zinc-900 dark:text-zinc-100`}>
                <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 dark:border-white/10 flex-shrink-0">
                    <div className="flex items-center gap-3">
                        {Icon && (
                            <div className={`w-10 h-10 rounded-2xl ${iconBgClass} flex items-center justify-center flex-shrink-0`}>
                                <Icon className={`w-5 h-5 ${iconColorClass}`} />
                            </div>
                        )}
                        <h2 className="text-lg font-bold text-gray-900 dark:text-white tracking-tight">{title}</h2>
                    </div>
                    <button 
                        onClick={onClose} 
                        type="button"
                        aria-label="Close modal" 
                        title="Close modal" 
                        className="w-11 h-11 min-h-[44px] min-w-[44px] rounded-xl hover:bg-gray-100 dark:hover:bg-zinc-900 flex items-center justify-center transition-colors flex-shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 cursor-pointer"
                    >
                        <X className="w-5 h-5" aria-hidden="true" />
                    </button>
                </div>

                {subHeader && (
                    <div className="flex-shrink-0 border-b border-gray-100 dark:border-white/10">
                        {subHeader}
                    </div>
                )}

                <ContentWrapper 
                    onSubmit={onSubmit} 
                    className="flex flex-col flex-1 min-h-0 overflow-hidden"
                >
                    <div className={`flex-1 overflow-y-auto px-6 py-6 custom-scrollbar ${bodyClassName}`}>
                        {children}
                    </div>

                    {footer && (
                        <div className="px-6 py-4 border-t border-gray-100 dark:border-white/10 flex items-center justify-end gap-3 flex-shrink-0 bg-gray-50 dark:bg-zinc-900/80">
                            {footer}
                        </div>
                    )}
                </ContentWrapper>
            </div>
        </div>,
        document.body
    );
}

export default PlatformModal;
