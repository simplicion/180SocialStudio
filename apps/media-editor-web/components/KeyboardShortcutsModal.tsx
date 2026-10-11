import React from "react";
import { X, Keyboard, Play, Scissors, Trash2, Copy, Magnet, RotateCcw, RotateCw, ChevronLeft, ChevronRight, Monitor, Download } from "lucide-react";

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutItem {
  keys: string[];
  description: string;
  icon?: any;
}

const SHORTCUT_GROUPS: {
  category: string;
  shortcuts: ShortcutItem[];
}[] = [
  {
    category: "Playback & Navigation",
    shortcuts: [
      { keys: ["Space"], description: "Play / Pause playback", icon: Play },
      { keys: ["←", "→"], description: "Step backward / forward 1 frame", icon: ChevronRight },
      { keys: ["Home"], description: "Jump playhead to timeline start" },
      { keys: ["End"], description: "Jump playhead to timeline end" },
    ],
  },
  {
    category: "Timeline Editing",
    shortcuts: [
      { keys: ["S"], description: "Split active clip at playhead", icon: Scissors },
      { keys: ["Delete", "Backspace"], description: "Ripple delete selected clip", icon: Trash2 },
      { keys: ["Ctrl", "D"], description: "Duplicate selected clip", icon: Copy },
      { keys: ["N"], description: "Toggle magnetic timeline snapping", icon: Magnet },
      { keys: ["Drag Edges"], description: "Trim clip In-point / Out-point" },
    ],
  },
  {
    category: "History & Project",
    shortcuts: [
      { keys: ["Ctrl", "Z"], description: "Undo last edit action", icon: RotateCcw },
      { keys: ["Ctrl", "Y"], description: "Redo last undone action", icon: RotateCw },
      { keys: ["Ctrl", "E"], description: "Open video export dialog", icon: Download },
      { keys: ["?"], description: "Open keyboard shortcuts reference", icon: Keyboard },
    ],
  },
];

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 select-none">
      <div className="w-full max-w-xl bg-surface border border-surface-border rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-150">
        {/* Header */}
        <div className="p-4 border-b border-surface-border flex items-center justify-between bg-surface-subtle">
          <div className="flex items-center space-x-2.5 text-indigo-400">
            <div className="p-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
              <Keyboard className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-100">Keyboard Shortcuts Reference</h3>
              <p className="text-[11px] text-gray-400">High-speed editor hotkeys for pro editing workflows</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-surface-hover transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.category} className="space-y-2.5">
              <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                {group.category}
              </h4>
              <div className="space-y-1.5">
                {group.shortcuts.map((sc, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-surface-subtle border border-surface-border"
                  >
                    <div className="flex items-center space-x-2 text-xs text-gray-200">
                      {sc.icon && <sc.icon className="w-3.5 h-3.5 text-indigo-400" />}
                      <span>{sc.description}</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      {sc.keys.map((k, kIdx) => (
                        <kbd
                          key={kIdx}
                          className="px-2 py-0.5 rounded-md bg-surface border border-surface-border text-[11px] font-mono font-bold text-indigo-300 shadow-sm"
                        >
                          {k}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-surface-border bg-surface-subtle flex items-center justify-between">
          <span className="text-[11px] text-gray-500">
            Press <kbd className="font-mono text-gray-400">Esc</kbd> anytime to close modals
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl text-xs font-semibold text-white bg-brand hover:bg-brand-hover transition shadow-md"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
};
