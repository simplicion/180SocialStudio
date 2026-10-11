import React, { useState } from "react";
import { Plus, Type } from "lucide-react";
import { TEXT_TEMPLATES, type BrandLook, type TextTemplate } from "../services/editor-library";

interface TextTemplatesPanelProps {
  /** Brand font / colours when the project's brand is known; empty keeps the template defaults. */
  brand: BrandLook;
  currentTimeSeconds: number;
  onAddTitle: (templateId: string, text: string) => void;
}

/** Scaled-down live sample of a template, drawn with the same style fields the renderers use. */
function TemplatePreview({ tpl, brand, text }: { tpl: TextTemplate; brand: BrandLook; text: string }) {
  const st = tpl.build(brand);
  const scale = 0.24;
  const pad = (st.pillPadding ?? 12) * scale;
  return (
    <div className="relative h-20 rounded-md bg-[#080A0F] border border-[#222838] overflow-hidden flex justify-center">
      <span
        className="absolute max-w-[92%] text-center truncate"
        style={{
          top: `${(st.position?.y ?? 0.5) * 100}%`,
          transform: "translateY(-50%)",
          fontFamily: `'${st.fontFamily || "Inter"}', sans-serif`,
          fontWeight: st.fontWeight ?? 800,
          fontSize: Math.max(9, (st.fontSize || 64) * scale),
          lineHeight: 1.1,
          color: st.textColor || "#FFFFFF",
          textTransform: st.uppercase ? "uppercase" : "none",
          WebkitTextStroke: st.strokeWidth ? `${Math.max(0.5, st.strokeWidth * scale * 0.5)}px ${st.strokeColor || "#000"}` : undefined,
          textShadow: st.shadow ? "0 1px 4px rgba(0,0,0,0.85)" : "none",
          backgroundColor: st.pillBackground || "transparent",
          padding: st.pillBackground ? `${pad}px ${pad * 1.4}px` : 0,
          borderRadius: st.pillBackground ? (st.pillRadius ?? 12) * scale : 0,
        }}
      >
        {text || tpl.sample}
      </span>
    </div>
  );
}

export const TextTemplatesPanel: React.FC<TextTemplatesPanelProps> = ({ brand, currentTimeSeconds, onAddTitle }) => {
  const [selectedId, setSelectedId] = useState<string>(TEXT_TEMPLATES[0].id);
  const [text, setText] = useState("");
  const selected = TEXT_TEMPLATES.find((t) => t.id === selectedId) ?? TEXT_TEMPLATES[0];
  const hasBrand = Boolean(brand.font || brand.primaryColor || brand.accentColor);

  return (
    <div className="h-full flex flex-col bg-[#0E1118] text-slate-100">
      <div className="p-3 border-b border-[#222838] space-y-2">
        <label className="text-[11px] font-semibold text-slate-400" htmlFor="tpl-text">
          Text
        </label>
        <input
          id="tpl-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={selected.sample}
          maxLength={120}
          className="w-full h-11 px-3 rounded-md bg-[#141822] border border-[#222838] focus:border-[#38435C] outline-none text-sm"
        />
        <button
          onClick={() => onAddTitle(selected.id, text)}
          className="w-full min-h-[44px] rounded-md bg-[#4F46E5] hover:bg-[#4338CA] text-sm font-semibold flex items-center justify-center gap-2 transition"
        >
          <Plus className="w-4 h-4" />
          Add “{selected.name}” at <span className="font-mono">{currentTimeSeconds.toFixed(1)}s</span>
        </button>
        {hasBrand && <p className="text-[10px] text-slate-500">Brand font and colours applied.</p>}
      </div>
      <div className="flex-1 overflow-y-auto p-3 grid grid-cols-2 gap-2 content-start">
        {TEXT_TEMPLATES.map((tpl) => (
          <button
            key={tpl.id}
            onClick={() => setSelectedId(tpl.id)}
            onDoubleClick={() => onAddTitle(tpl.id, text)}
            className={`text-left rounded-lg p-1.5 border transition ${
              tpl.id === selected.id ? "border-[#3B82F6] bg-[#1C2230]" : "border-[#222838] bg-[#141822] hover:bg-[#1C2230]"
            }`}
            title="Click to select, double-click to add at the playhead"
          >
            <TemplatePreview tpl={tpl} brand={brand} text={text} />
            <div className="flex items-center gap-1.5 px-1 pt-1.5 text-[11px] font-medium text-slate-300">
              <Type className="w-3 h-3 text-cyan-400 shrink-0" />
              <span className="truncate">{tpl.name}</span>
              <span className="ml-auto font-mono text-[10px] text-slate-500">{tpl.defaultSeconds}s</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};
