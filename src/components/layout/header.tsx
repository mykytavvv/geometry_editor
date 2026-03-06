"use client";

import React from "react";
import { ChevronDown, User } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EditorMode } from "@/features/geometry-editor/types";
import { EDITOR_MODES } from "@/features/geometry-editor/editor-mode-config";

interface HeaderProps {
  editorMode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
}

export function Header({ editorMode, onModeChange }: HeaderProps) {
  return (
    <header className="flex h-14 min-h-14 items-center justify-between border-b border-border bg-background px-4">
      {/* Mode Switcher */}
      <div className="flex items-center rounded-lg border border-border/60 bg-muted/50 p-0.5">
        {EDITOR_MODES.map(({ mode, label }) => (
          <button
            key={mode}
            onClick={() => onModeChange(mode)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-all",
              editorMode === mode
                ? "bg-park text-park-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-background/80"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* User */}
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
          <User className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="hidden text-right sm:block">
          <p className="text-xs font-medium leading-tight">山田 太郎</p>
          <p className="text-[10px] text-muted-foreground">公園管理者</p>
        </div>
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </div>
    </header>
  );
}
