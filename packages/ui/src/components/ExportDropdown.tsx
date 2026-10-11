"use client";

import React, { useState, useRef, useEffect } from 'react';
import { Download, FileSpreadsheet, FileText, FileCode, ChevronDown, Check, Loader2 } from 'lucide-react';
import clsx from 'clsx';

export type ExportFormat = 'excel' | 'pdf' | 'docx' | 'csv';

export interface ExportDropdownProps {
  onExport: (format: ExportFormat) => Promise<void> | void;
  disabled?: boolean;
  className?: string;
  buttonLabel?: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  align?: 'left' | 'right';
  formats?: ExportFormat[];
}

const FORMAT_CONFIG: Record<ExportFormat, { label: string; ext: string; desc: string; icon: any; color: string }> = {
  excel: {
    label: 'Excel Spreadsheet',
    ext: '.xlsx',
    desc: 'Formatted workbook with branding & KPI stats',
    icon: FileSpreadsheet,
    color: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60'
  },
  pdf: {
    label: 'PDF Document',
    ext: '.pdf',
    desc: 'Print-ready executive summary & table',
    icon: FileText,
    color: 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/60'
  },
  docx: {
    label: 'Word Document',
    ext: '.docx',
    desc: 'Editable Microsoft Word format',
    icon: FileText,
    color: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60'
  },
  csv: {
    label: 'CSV Data File',
    ext: '.csv',
    desc: 'Raw comma-separated table data',
    icon: FileCode,
    color: 'text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800'
  }
};

export function ExportDropdown({
  onExport,
  disabled = false,
  className,
  buttonLabel = 'Export',
  size = 'sm',
  variant = 'secondary',
  align = 'right',
  formats = ['excel', 'pdf', 'docx', 'csv']
}: ExportDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleSelect = async (format: ExportFormat) => {
    try {
      setExportingFormat(format);
      await onExport(format);
    } catch (err) {
      console.error('Export error:', err);
    } finally {
      setExportingFormat(null);
      setIsOpen(false);
    }
  };

  const sizeClasses = {
    sm: 'px-3 py-1.5 text-xs gap-1.5 rounded-xl',
    md: 'px-4 py-2 text-xs font-semibold gap-2 rounded-xl',
    lg: 'px-5 py-2.5 text-sm font-bold gap-2.5 rounded-2xl'
  }[size];

  const variantClasses = {
    primary: 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm shadow-indigo-500/20',
    secondary: 'bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 border border-zinc-200/60 dark:border-zinc-700/60',
    outline: 'bg-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 border border-zinc-300 dark:border-zinc-700',
    ghost: 'bg-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300'
  }[variant];

  return (
    <div className={clsx("relative inline-block text-left", className)} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled || exportingFormat !== null}
        className={clsx(
          "inline-flex items-center justify-center font-medium transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500/50 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
          sizeClasses,
          variantClasses
        )}
      >
        {exportingFormat ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500" />
        ) : (
          <Download className="w-3.5 h-3.5" />
        )}
        <span>{exportingFormat ? `Exporting ${FORMAT_CONFIG[exportingFormat]?.ext}...` : buttonLabel}</span>
        <ChevronDown className={clsx("w-3.5 h-3.5 transition-transform duration-200", isOpen && "rotate-180")} />
      </button>

      {isOpen && (
        <div
          className={clsx(
            "absolute z-50 mt-2 w-64 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl shadow-black/10 dark:shadow-black/40 p-1.5 animate-in fade-in zoom-in-95 duration-150 backdrop-blur-md",
            align === 'right' ? 'right-0' : 'left-0'
          )}
        >
          <div className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-800/80 mb-1">
            <p className="text-[11px] font-bold text-zinc-900 dark:text-zinc-100 uppercase tracking-wider">Export Format</p>
            <p className="text-[10px] text-zinc-400">Download formatted leads & analytics</p>
          </div>

          <div className="space-y-0.5">
            {formats.map((fmt) => {
              const cfg = FORMAT_CONFIG[fmt];
              if (!cfg) return null;
              const Icon = cfg.icon;
              const isCurrentExporting = exportingFormat === fmt;

              return (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => handleSelect(fmt)}
                  disabled={exportingFormat !== null}
                  className="w-full flex items-start gap-2.5 px-3 py-2 text-left rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-800/70 transition-colors group cursor-pointer disabled:opacity-50"
                >
                  <div className={clsx("p-1.5 rounded-lg shrink-0 mt-0.5 transition-transform group-hover:scale-110", cfg.color)}>
                    {isCurrentExporting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Icon className="w-4 h-4" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                        {cfg.label}
                      </span>
                      <span className="text-[10px] font-mono text-zinc-400 px-1 py-0.2 bg-zinc-100 dark:bg-zinc-800 rounded">
                        {cfg.ext}
                      </span>
                    </div>
                    <p className="text-[10px] text-zinc-400 dark:text-zinc-500 truncate mt-0.5">
                      {cfg.desc}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default ExportDropdown;
