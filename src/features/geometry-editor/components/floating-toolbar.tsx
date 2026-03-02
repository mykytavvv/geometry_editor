"use client";

import React from "react";
import {
  MousePointer2,
  Hand,
  Circle,
  Minus,
  Pentagon,
  Copy,
  Trash2,
  Merge,
  Scissors,
  Ruler,
  Square,
  Undo2,
  Redo2,
  Magnet,
  Crosshair,
  Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ToolMode } from "../types";

interface ToolButtonProps {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  variant?: "default" | "destructive";
}

function ToolButton({
  icon,
  label,
  shortcut,
  active,
  disabled,
  onClick,
  variant,
}: ToolButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={disabled}
          onClick={onClick}
          className={cn(
            "h-8 w-8 rounded-lg transition-all",
            active && "bg-park text-park-foreground hover:bg-park/90",
            variant === "destructive" && "hover:bg-destructive/10 hover:text-destructive",
            !active && !disabled && "text-foreground/70 hover:text-foreground hover:bg-muted"
          )}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        <span>{label}</span>
        {shortcut && (
          <kbd className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] font-mono text-muted-foreground">
            {shortcut}
          </kbd>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

interface FloatingToolbarProps {
  activeTool: ToolMode;
  onSetTool: (tool: ToolMode) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  hasSelection: boolean;
  selectionCount: number;
  canMerge: boolean;
  onDuplicate: () => void;
  onDelete: () => void;
  onMerge: () => void;
  onSplit: () => void;
  snappingEnabled: boolean;
  onToggleSnapping: () => void;
  onCoordinateInput: () => void;
  onSaveAsMeasurement: () => void;
  isMeasuring: boolean;
}

export function FloatingToolbar({
  activeTool,
  onSetTool,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  hasSelection,
  selectionCount,
  canMerge,
  onDuplicate,
  onDelete,
  onMerge,
  onSplit,
  snappingEnabled,
  onToggleSnapping,
  onCoordinateInput,
  onSaveAsMeasurement,
  isMeasuring,
}: FloatingToolbarProps) {
  return (
    <div className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2">
      <div className="flex items-center gap-0.5 rounded-2xl border border-border/50 bg-background/95 px-2 py-1.5 shadow-lg backdrop-blur-sm">
        {/* ─── Navigation ─────────────────────────────────── */}
        <ToolButton
          icon={<MousePointer2 className="h-4 w-4" />}
          label="選択"
          shortcut="V"
          active={activeTool === "select"}
          onClick={() => onSetTool("select")}
        />
        <ToolButton
          icon={<Hand className="h-4 w-4" />}
          label="パン"
          shortcut="H"
          active={activeTool === "pan"}
          onClick={() => onSetTool("pan")}
        />

        <Separator orientation="vertical" className="mx-1 h-6" />

        {/* ─── Draw ───────────────────────────────────────── */}
        <ToolButton
          icon={<Circle className="h-4 w-4" />}
          label="ポイント"
          shortcut="P"
          active={activeTool === "draw_point"}
          onClick={() => onSetTool("draw_point")}
        />
        <ToolButton
          icon={<Minus className="h-4 w-4" />}
          label="ライン"
          shortcut="L"
          active={activeTool === "draw_line"}
          onClick={() => onSetTool("draw_line")}
        />
        <ToolButton
          icon={<Pentagon className="h-4 w-4" />}
          label="ポリゴン"
          shortcut="G"
          active={activeTool === "draw_polygon"}
          onClick={() => onSetTool("draw_polygon")}
        />

        <Separator orientation="vertical" className="mx-1 h-6" />

        {/* ─── Edit Operations ────────────────────────────── */}
        <ToolButton
          icon={<Copy className="h-4 w-4" />}
          label="複製"
          shortcut="Ctrl+D"
          disabled={!hasSelection}
          onClick={onDuplicate}
        />
        <ToolButton
          icon={<Trash2 className="h-4 w-4" />}
          label="削除"
          shortcut="Delete"
          disabled={!hasSelection}
          onClick={onDelete}
          variant="destructive"
        />
        <ToolButton
          icon={<Merge className="h-4 w-4" />}
          label="結合"
          disabled={!canMerge}
          onClick={onMerge}
        />
        <ToolButton
          icon={<Scissors className="h-4 w-4" />}
          label="分割"
          active={activeTool === "draw_clip_polygon"}
          disabled={selectionCount !== 1 && activeTool !== "draw_clip_polygon"}
          onClick={onSplit}
        />

        <Separator orientation="vertical" className="mx-1 h-6" />

        {/* ─── Measure ────────────────────────────────────── */}
        <ToolButton
          icon={<Ruler className="h-4 w-4" />}
          label="距離測定"
          shortcut="M"
          active={activeTool === "measure_distance"}
          onClick={() => onSetTool("measure_distance")}
        />
        <ToolButton
          icon={<Square className="h-4 w-4" />}
          label="面積測定"
          shortcut="A"
          active={activeTool === "measure_area"}
          onClick={() => onSetTool("measure_area")}
        />
        {isMeasuring && (
          <ToolButton
            icon={<Save className="h-4 w-4" />}
            label="測定をジオメトリとして保存"
            onClick={onSaveAsMeasurement}
          />
        )}

        <Separator orientation="vertical" className="mx-1 h-6" />

        {/* ─── History ────────────────────────────────────── */}
        <ToolButton
          icon={<Undo2 className="h-4 w-4" />}
          label="元に戻す"
          shortcut="Ctrl+Z"
          disabled={!canUndo}
          onClick={onUndo}
        />
        <ToolButton
          icon={<Redo2 className="h-4 w-4" />}
          label="やり直す"
          shortcut="Ctrl+Shift+Z"
          disabled={!canRedo}
          onClick={onRedo}
        />

        <Separator orientation="vertical" className="mx-1 h-6" />

        {/* ─── Precision ──────────────────────────────────── */}
        <ToolButton
          icon={<Magnet className="h-4 w-4" />}
          label={`スナップ ${snappingEnabled ? "ON" : "OFF"}`}
          active={snappingEnabled}
          onClick={onToggleSnapping}
        />
        <ToolButton
          icon={<Crosshair className="h-4 w-4" />}
          label="座標入力"
          active={activeTool === "coordinate_input"}
          onClick={onCoordinateInput}
        />
      </div>
    </div>
  );
}
