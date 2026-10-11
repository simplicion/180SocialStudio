"use client";
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { LogoLoader } from "./LogoLoader";
import { X, AlertTriangle, AlertCircle, Info, CheckCircle } from 'lucide-react';
import clsx from 'clsx';

interface Props {
    isOpen: boolean;
    title: string;
    message?: string;
    description?: string;
    confirmText?: string;
    cancelText?: string;
    onConfirm: (value?: string) => void;
    onCancel?: () => void;
    onClose?: () => void;
    loading?: boolean;
    isDestructive?: boolean;
    variant?: 'danger' | 'warning' | 'info' | 'success';
    type?: 'confirm' | 'alert' | 'prompt';
    defaultValue?: string;
    placeholder?: string;
    customActions?: {
        label: string;
        onClick: () => Promise<void> | void;
        className?: string;
    }[];
}

export function ConfirmModal({
    isOpen,
    title,
    message,
    description,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    onConfirm,
    onCancel,
    onClose,
    loading = false,
    isDestructive,
    variant = 'danger',
    type = 'confirm',
    defaultValue = '',
    placeholder = 'Enter value...',
    customActions
}: Props) {
    const handleClose = onCancel || onClose;
    const displayMessage = message || description || '';
    const activeVariant = isDestructive ? 'danger' : variant;
    const [mounted, setMounted] = useState(false);
    const [promptValue, setPromptValue] = useState(defaultValue);

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        if (isOpen) setPromptValue(defaultValue);
    }, [isOpen, defaultValue]);

    if (!isOpen || !mounted) return null;

    const variantStyles = {
        danger: {
            bg: 'bg-red-50',
            border: 'border-red-100',
            icon: 'text-red-600',
            btn: 'bg-red-600 hover:bg-red-700 focus:ring-red-500',
            Icon: AlertCircle
        },
        warning: {
            bg: 'bg-amber-50',
            border: 'border-amber-100',
            icon: 'text-amber-600',
            btn: 'bg-amber-600 hover:bg-amber-700 focus:ring-amber-500',
            Icon: AlertTriangle
        },
        info: {
            bg: 'bg-blue-50',
            border: 'border-blue-100',
            icon: 'text-blue-600',
            btn: 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500',
            Icon: Info
        },
        success: {
            bg: 'bg-emerald-50',
            border: 'border-emerald-100',
            icon: 'text-emerald-600',
            btn: 'bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-500',
            Icon: CheckCircle
        }
    };

    const currentVariant = variantStyles[activeVariant] || variantStyles.danger;
    const { Icon } = currentVariant;

    return createPortal(
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 dark:bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white dark:bg-zinc-950 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 duration-300 border border-gray-100 dark:border-white/10 text-zinc-900 dark:text-zinc-100">
                {/* Header/Icon */}
                <div className="p-6 text-center">
                    <div className={clsx(
                        "w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 border",
                        currentVariant.bg,
                        currentVariant.border,
                        "dark:bg-opacity-20"
                    )}>
                        <Icon className={clsx("w-6 h-6", currentVariant.icon)} />
                    </div>

                    <h2 className="text-xl font-bold text-gray-900 dark:text-zinc-100 mb-2">{title}</h2>
                    <p className="text-gray-500 dark:text-zinc-400 text-sm leading-relaxed mb-4">{displayMessage}</p>

                    {type === 'prompt' && (
                        <input
                            autoFocus
                            type="text"
                            value={promptValue}
                            onChange={(e) => setPromptValue(e.target.value)}
                            placeholder={placeholder}
                            className="w-full bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition-all shadow-sm"
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !loading) onConfirm(promptValue);
                                if (e.key === 'Escape' && handleClose) handleClose();
                            }}
                        />
                    )}
                </div>

                {/* Actions */}
                <div className="px-6 py-4 bg-gray-50 dark:bg-zinc-900/80 border-t border-gray-100 dark:border-white/10 flex flex-col sm:flex-row items-center justify-center gap-3">
                    {type !== 'alert' && (
                        <button
                            onClick={handleClose}
                            disabled={loading}
                            className="w-full sm:w-auto flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-700 dark:text-zinc-300 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50 min-h-[44px] cursor-pointer"
                        >
                            {cancelText}
                        </button>
                    )}
                    {customActions ? (
                        <>
                            {customActions.map((action, i) => (
                                <button
                                    key={i}
                                    onClick={action.onClick}
                                    disabled={loading}
                                    className={clsx(
                                        "w-full sm:w-auto px-4 py-2.5 rounded-xl text-sm font-semibold transition-all focus:ring-2 focus:ring-offset-2 disabled:opacity-50 flex items-center justify-center gap-2 min-h-[44px] cursor-pointer",
                                        action.className || currentVariant.btn
                                    )}
                                >
                                    {loading && <LogoLoader className="w-4 h-4 animate-spin" />}
                                    {action.label}
                                </button>
                            ))}
                        </>
                    ) : (
                        <button
                            onClick={() => onConfirm(type === 'prompt' ? promptValue : undefined)}
                            disabled={loading}
                            className={clsx(
                                "w-full sm:w-auto px-4 py-2.5 rounded-xl text-white text-sm font-semibold transition-all focus:ring-2 focus:ring-offset-2 disabled:opacity-50 flex items-center justify-center gap-2 min-h-[44px] cursor-pointer",
                                type !== 'alert' ? "flex-1" : "min-w-[120px]",
                                currentVariant.btn
                            )}
                        >
                            {loading && <LogoLoader className="w-4 h-4 animate-spin" />}
                            {confirmText}
                        </button>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
}

export default ConfirmModal;
