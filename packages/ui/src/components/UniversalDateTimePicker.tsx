"use client";

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
  Calendar as CalendarIcon, Clock, ChevronLeft, ChevronRight, 
  X, Check, Sparkles 
} from 'lucide-react';
import clsx from 'clsx';

export type PickerMode = 'datetime' | 'date' | 'time';

export interface UniversalDateTimePickerProps {
  value?: string | Date | null;
  onChange: (isoString: string | null) => void;
  mode?: PickerMode;
  placeholder?: string;
  disablePast?: boolean;
  minDate?: Date | string;
  maxDate?: Date | string;
  className?: string;
  presets?: { label: string; offsetHours: number }[];
  label?: string;
  disabled?: boolean;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const DAYS_OF_WEEK = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export function UniversalDateTimePicker({
  value,
  onChange,
  mode = 'datetime',
  placeholder,
  disablePast = false,
  minDate,
  maxDate,
  className,
  presets = [
    { label: '+6h', offsetHours: 6 },
    { label: '+12h', offsetHours: 12 },
    { label: '+24h', offsetHours: 24 },
    { label: '+48h', offsetHours: 48 },
  ],
  label,
  disabled = false
}: UniversalDateTimePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Parse initial date from value prop
  const selectedDate = useMemo(() => {
    if (!value) return null;
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }, [value]);

  // Internal view state
  const [viewDate, setViewDate] = useState<Date>(() => selectedDate || new Date());
  const [hours, setHours] = useState<number>(() => (selectedDate ? selectedDate.getHours() : 12));
  const [minutes, setMinutes] = useState<number>(() => (selectedDate ? selectedDate.getMinutes() : 0));
  const [isPm, setIsPm] = useState<boolean>(() => (selectedDate ? selectedDate.getHours() >= 12 : false));
  const [activeTab, setActiveTab] = useState<'calendar' | 'time'>(mode === 'time' ? 'time' : 'calendar');

  // Sync internal state when external value changes
  useEffect(() => {
    if (selectedDate) {
      setViewDate(selectedDate);
      const h = selectedDate.getHours();
      setHours(h);
      setIsPm(h >= 12);
      setMinutes(selectedDate.getMinutes());
    }
  }, [selectedDate]);

  // Click outside listener
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
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

  const now = new Date();
  const minDateTime = useMemo(() => {
    if (minDate) return new Date(minDate);
    if (disablePast) {
      const d = new Date();
      d.setSeconds(0, 0);
      return d;
    }
    return null;
  }, [minDate, disablePast]);

  const maxDateTime = useMemo(() => {
    return maxDate ? new Date(maxDate) : null;
  }, [maxDate]);

  // Month navigation
  const currentMonth = viewDate.getMonth();
  const currentYear = viewDate.getFullYear();

  const handlePrevMonth = () => {
    setViewDate(new Date(currentYear, currentMonth - 1, 1));
  };

  const handleNextMonth = () => {
    setViewDate(new Date(currentYear, currentMonth + 1, 1));
  };

  // Calendar Grid generation
  const calendarDays = useMemo(() => {
    const firstDayIndex = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(currentYear, currentMonth, 0).getDate();

    const days: { date: Date; isCurrentMonth: boolean; isToday: boolean; isSelected: boolean; isDisabled: boolean }[] = [];

    // Previous month filler days
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const d = new Date(currentYear, currentMonth - 1, daysInPrevMonth - i);
      const isPast = minDateTime ? d < new Date(minDateTime.getFullYear(), minDateTime.getMonth(), minDateTime.getDate()) : false;
      days.push({
        date: d,
        isCurrentMonth: false,
        isToday: false,
        isSelected: false,
        isDisabled: isPast
      });
    }

    // Current month days
    for (let i = 1; i <= daysInMonth; i++) {
      const d = new Date(currentYear, currentMonth, i);
      const isToday = d.toDateString() === now.toDateString();
      const isSelected = selectedDate ? d.toDateString() === selectedDate.toDateString() : false;
      
      let isDisabled = false;
      if (minDateTime) {
        const checkDay = new Date(currentYear, currentMonth, i, 23, 59, 59);
        if (checkDay < minDateTime) isDisabled = true;
      }
      if (maxDateTime && d > maxDateTime) {
        isDisabled = true;
      }

      days.push({
        date: d,
        isCurrentMonth: true,
        isToday,
        isSelected,
        isDisabled
      });
    }

    // Next month filler days (grid up to 42 cells)
    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
      const d = new Date(currentYear, currentMonth + 1, i);
      days.push({
        date: d,
        isCurrentMonth: false,
        isToday: false,
        isSelected: false,
        isDisabled: false
      });
    }

    return days;
  }, [currentYear, currentMonth, minDateTime, maxDateTime, selectedDate, now]);

  // Date selection handler
  const handleSelectDay = (day: Date) => {
    const targetHours = mode === 'date' ? 0 : (isPm ? (hours % 12) + 12 : hours % 12);
    const targetMinutes = mode === 'date' ? 0 : minutes;

    const newDate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), targetHours, targetMinutes, 0);
    
    // Check if newDate violates minDateTime
    if (minDateTime && newDate < minDateTime) {
      // Adjust to now + 5 minutes
      const adjusted = new Date(minDateTime.getTime() + 5 * 60 * 1000);
      onChange(adjusted.toISOString());
      setHours(adjusted.getHours());
      setIsPm(adjusted.getHours() >= 12);
      setMinutes(adjusted.getMinutes());
    } else {
      onChange(newDate.toISOString());
    }

    if (mode === 'date') {
      setIsOpen(false);
    } else if (mode === 'datetime') {
      // Auto-switch to time view if user hasn't set time
      setActiveTab('time');
    }
  };

  // Time change handler
  const handleTimeChange = (newHours: number, newMinutes: number, newIsPm: boolean) => {
    setHours(newHours);
    setMinutes(newMinutes);
    setIsPm(newIsPm);

    const baseDate = selectedDate || new Date();
    const normalizedH = newIsPm ? (newHours % 12) + 12 : newHours % 12;
    const newDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), normalizedH, newMinutes, 0);

    if (minDateTime && newDate < minDateTime) {
      return; // Do not apply invalid past time
    }

    onChange(newDate.toISOString());
  };

  // Preset handler
  const handleApplyPreset = (offsetHours: number) => {
    const target = new Date(Date.now() + offsetHours * 3600 * 1000);
    onChange(target.toISOString());
    setViewDate(target);
    const h = target.getHours();
    setHours(h);
    setIsPm(h >= 12);
    setMinutes(target.getMinutes());
    setIsOpen(false);
  };

  // Clear handler
  const handleClear = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    onChange(null);
    setIsOpen(false);
  };

  // Formatted display string
  const displayString = useMemo(() => {
    if (!selectedDate) return '';
    
    const dayName = selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const timeStr = selectedDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

    if (mode === 'date') return dayName;
    if (mode === 'time') return timeStr;
    return `${dayName} • ${timeStr}`;
  }, [selectedDate, mode]);

  // Display 12-hour display value
  const display12Hour = hours % 12 === 0 ? 12 : hours % 12;

  return (
    <div ref={containerRef} className={clsx("relative inline-block text-left", className)}>
      {label && (
        <label className="block text-[11px] font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
          {label}
        </label>
      )}

      {/* Trigger Button */}
      <div
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={clsx(
          "group flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg border text-xs font-mono transition-all cursor-pointer select-none",
          disabled && "opacity-50 cursor-not-allowed pointer-events-none",
          isOpen
            ? "border-purple-500 ring-2 ring-purple-500/20 bg-white dark:bg-zinc-900 text-gray-900 dark:text-white"
            : selectedDate
            ? "border-purple-200 dark:border-purple-900/60 bg-purple-50/40 dark:bg-purple-950/20 text-purple-900 dark:text-purple-200 font-semibold hover:border-purple-300"
            : "border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-gray-400 dark:text-zinc-500 hover:border-gray-300 dark:hover:border-zinc-700"
        )}
      >
        <div className="flex items-center gap-1.5 truncate">
          {mode === 'time' ? (
            <Clock className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0" />
          ) : (
            <CalendarIcon className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0" />
          )}
          <span className="truncate">
            {displayString || placeholder || (mode === 'date' ? 'Select date' : mode === 'time' ? 'Select time' : 'Select date & time')}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {selectedDate && (
            <button
              type="button"
              onClick={handleClear}
              className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-zinc-700 text-gray-400 hover:text-gray-600 dark:hover:text-zinc-300 transition"
              title="Clear date"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Popover Dropdown */}
      {isOpen && (
        <div className="absolute z-[9999] mt-2 left-0 sm:right-0 sm:left-auto w-[310px] p-3.5 rounded-2xl bg-white/95 dark:bg-zinc-950/95 backdrop-blur-md border border-gray-200 dark:border-zinc-800 shadow-2xl animate-in fade-in zoom-in-95 duration-150 space-y-3">
          
          {/* Quick Presets Bar (for datetime mode) */}
          {mode === 'datetime' && presets.length > 0 && (
            <div className="flex items-center justify-between gap-1 pb-2 border-b border-gray-100 dark:border-gray-800">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-amber-500" /> Presets
              </span>
              <div className="flex items-center gap-1">
                {presets.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => handleApplyPreset(preset.offsetHours)}
                    className="px-2 py-0.5 rounded-md bg-purple-50 dark:bg-purple-950/50 hover:bg-purple-100 dark:hover:bg-purple-900/60 text-purple-700 dark:text-purple-300 font-mono text-[10px] font-bold transition"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Mode Switcher Tabs (for datetime mode) */}
          {mode === 'datetime' && (
            <div className="grid grid-cols-2 p-0.5 rounded-xl bg-gray-100 dark:bg-zinc-800/80 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setActiveTab('calendar')}
                className={clsx(
                  "py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition",
                  activeTab === 'calendar'
                    ? "bg-white dark:bg-zinc-900 text-purple-600 dark:text-purple-400 shadow-xs"
                    : "text-gray-500 hover:text-gray-800 dark:hover:text-zinc-200"
                )}
              >
                <CalendarIcon className="w-3.5 h-3.5" /> Date
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('time')}
                className={clsx(
                  "py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition",
                  activeTab === 'time'
                    ? "bg-white dark:bg-zinc-900 text-purple-600 dark:text-purple-400 shadow-xs"
                    : "text-gray-500 hover:text-gray-800 dark:hover:text-zinc-200"
                )}
              >
                <Clock className="w-3.5 h-3.5" /> Time
              </button>
            </div>
          )}

          {/* TAB 1: CALENDAR VIEW */}
          {(mode === 'date' || (mode === 'datetime' && activeTab === 'calendar')) && (
            <div className="space-y-2.5 animate-in fade-in duration-150">
              {/* Month / Year Navigation */}
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-bold text-gray-900 dark:text-white">
                  {MONTH_NAMES[currentMonth]} {currentYear}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handlePrevMonth}
                    className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800 text-gray-500 hover:text-gray-900 dark:hover:text-white transition"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={handleNextMonth}
                    className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800 text-gray-500 hover:text-gray-900 dark:hover:text-white transition"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Day Names Row */}
              <div className="grid grid-cols-7 text-center">
                {DAYS_OF_WEEK.map((d) => (
                  <span key={d} className="text-[10px] font-bold text-gray-400 dark:text-zinc-500 py-1">
                    {d}
                  </span>
                ))}
              </div>

              {/* Calendar Days Matrix */}
              <div className="grid grid-cols-7 gap-1 text-center">
                {calendarDays.map((item, idx) => (
                  <button
                    key={idx}
                    type="button"
                    disabled={item.isDisabled}
                    onClick={() => handleSelectDay(item.date)}
                    className={clsx(
                      "h-7 w-7 mx-auto rounded-lg text-[11px] font-mono flex items-center justify-center transition-all",
                      item.isDisabled
                        ? "text-gray-300 dark:text-zinc-600 cursor-not-allowed opacity-40"
                        : item.isSelected
                        ? "bg-purple-600 text-white font-bold shadow-md shadow-purple-500/20"
                        : item.isToday
                        ? "border border-purple-500 text-purple-600 dark:text-purple-400 font-bold hover:bg-purple-50 dark:hover:bg-purple-950/50"
                        : item.isCurrentMonth
                        ? "text-gray-700 dark:text-zinc-200 hover:bg-gray-100 dark:hover:bg-zinc-800"
                        : "text-gray-300 dark:text-zinc-600 hover:bg-gray-50 dark:hover:bg-zinc-800/40"
                    )}
                  >
                    {item.date.getDate()}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: INTERACTIVE TIME / CLOCK DIAL VIEW */}
          {(mode === 'time' || (mode === 'datetime' && activeTab === 'time')) && (
            <div className="space-y-3.5 animate-in fade-in duration-150 py-1">
              {/* Digital Time Preview Card */}
              <div className="p-3 rounded-xl bg-purple-50 dark:bg-purple-950/40 border border-purple-100 dark:border-purple-900/40 text-center space-y-1">
                <span className="text-[10px] font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wider">
                  Target Time
                </span>
                <div className="text-2xl font-black font-mono text-purple-900 dark:text-purple-200">
                  {String(display12Hour).padStart(2, '0')}:{String(minutes).padStart(2, '0')}{' '}
                  <span className="text-sm font-bold">{isPm ? 'PM' : 'AM'}</span>
                </div>
              </div>

              {/* AM / PM Pill Toggle */}
              <div className="grid grid-cols-2 p-0.5 rounded-lg bg-gray-100 dark:bg-zinc-800 text-xs font-bold font-mono">
                <button
                  type="button"
                  onClick={() => handleTimeChange(display12Hour === 12 ? 0 : display12Hour, minutes, false)}
                  className={clsx(
                    "py-1 rounded-md transition",
                    !isPm
                      ? "bg-white dark:bg-zinc-900 text-purple-600 shadow-xs"
                      : "text-gray-500 hover:text-gray-800 dark:hover:text-zinc-200"
                  )}
                >
                  AM
                </button>
                <button
                  type="button"
                  onClick={() => handleTimeChange((display12Hour % 12) + 12, minutes, true)}
                  className={clsx(
                    "py-1 rounded-md transition",
                    isPm
                      ? "bg-white dark:bg-zinc-900 text-purple-600 shadow-xs"
                      : "text-gray-500 hover:text-gray-800 dark:hover:text-zinc-200"
                  )}
                >
                  PM
                </button>
              </div>

              {/* Hour Selection Grid */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 dark:text-zinc-500 uppercase tracking-wider">Hour</label>
                <div className="grid grid-cols-6 gap-1 text-center">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => handleTimeChange(isPm ? (h % 12) + 12 : (h % 12), minutes, isPm)}
                      className={clsx(
                        "h-7 rounded-lg text-xs font-mono font-bold transition",
                        display12Hour === h
                          ? "bg-purple-600 text-white shadow-xs"
                          : "bg-gray-50 dark:bg-zinc-800 hover:bg-gray-100 dark:hover:bg-zinc-700 text-gray-700 dark:text-zinc-300"
                      )}
                    >
                      {h}
                    </button>
                  ))}
                </div>
              </div>

              {/* Minute Selection Grid (5-minute steps) */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 dark:text-zinc-500 uppercase tracking-wider">Minutes</label>
                <div className="grid grid-cols-6 gap-1 text-center">
                  {[0, 10, 15, 20, 30, 45].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => handleTimeChange(hours, m, isPm)}
                      className={clsx(
                        "h-7 rounded-lg text-xs font-mono font-bold transition",
                        minutes === m
                          ? "bg-purple-600 text-white shadow-xs"
                          : "bg-gray-50 dark:bg-zinc-800 hover:bg-gray-100 dark:hover:bg-zinc-700 text-gray-700 dark:text-zinc-300"
                      )}
                    >
                      :{String(m).padStart(2, '0')}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Footer Action Buttons */}
          <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-800 text-xs">
            <button
              type="button"
              onClick={handleClear}
              className="text-gray-400 hover:text-rose-500 font-medium transition"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-semibold shadow-sm transition"
            >
              <Check className="w-3.5 h-3.5" /> Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default UniversalDateTimePicker;
