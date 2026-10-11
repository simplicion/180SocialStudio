import React, { useState, useEffect } from "react";

interface ResizableSplitterProps {
  direction: "horizontal" | "vertical";
  onResize: (deltaPx: number) => void;
  onDoubleClick?: () => void;
  className?: string;
  title?: string;
}

export const ResizableSplitter: React.FC<ResizableSplitterProps> = ({
  direction,
  onResize,
  onDoubleClick,
  className = "",
  title,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartPos, setDragStartPos] = useState<number>(0);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    setDragStartPos(direction === "horizontal" ? e.clientX : e.clientY);
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const currentPos = direction === "horizontal" ? e.clientX : e.clientY;
      const delta = currentPos - dragStartPos;
      if (Math.abs(delta) >= 1) {
        onResize(delta);
        setDragStartPos(currentPos);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = direction === "horizontal" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isDragging, dragStartPos, direction, onResize]);

  if (direction === "horizontal") {
    return (
      <div
        onMouseDown={handleMouseDown}
        onDoubleClick={onDoubleClick}
        title={title || "Drag to resize panel (Double-click to reset)"}
        className={`w-1.5 hover:w-2 bg-[#16161A] hover:bg-indigo-500/60 active:bg-indigo-500 cursor-col-resize transition-all shrink-0 relative group z-30 flex items-center justify-center select-none ${
          isDragging ? "!bg-indigo-500 !w-2 shadow-lg shadow-indigo-500/40" : ""
        } ${className}`}
      >
        <div className="h-6 w-0.5 bg-zinc-600 group-hover:bg-white rounded-full transition-colors" />
      </div>
    );
  }

  return (
    <div
      onMouseDown={handleMouseDown}
      onDoubleClick={onDoubleClick}
      title={title || "Drag to resize panel (Double-click to reset)"}
      className={`h-1.5 hover:h-2 bg-[#16161A] hover:bg-indigo-500/60 active:bg-indigo-500 cursor-row-resize transition-all shrink-0 relative group z-30 flex items-center justify-center select-none ${
        isDragging ? "!bg-indigo-500 !h-2 shadow-lg shadow-indigo-500/40" : ""
      } ${className}`}
    >
      <div className="w-8 h-0.5 bg-zinc-600 group-hover:bg-white rounded-full transition-colors" />
    </div>
  );
};
