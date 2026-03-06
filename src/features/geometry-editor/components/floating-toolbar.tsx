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
  LocateFixed,
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
import type { EditorModeConfig } from "../editor-mode-config";

interface ToolButtonProps {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  disabledTooltip?: string;
  onClick: () => void;
  variant?: "default" | "destructive";
}

function ToolButton({
  icon,
  label,
  shortcut,
  active,
  disabled,
  disabledTooltip,
  onClick,
  variant,
}: ToolButtonProps) {
  const button = (
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
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Wrap in a span so the tooltip still works when the button is disabled
            (disabled buttons have pointer-events: none which blocks tooltip hover). */}
        {disabled ? (
          <span className="inline-flex" tabIndex={0}>
            {button}
          </span>
        ) : (
          button
        )}
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs max-w-[220px]">
        {disabled && disabledTooltip ? (
          <span>{disabledTooltip}</span>
        ) : (
          <>
            <span>{label}</span>
            {shortcut && (
              <kbd className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] font-mono text-muted-foreground">
                {shortcut}
              </kbd>
            )}
          </>
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
  modeConfig: EditorModeConfig;
  featureCount: number;
  onFlyTo: () => void;
  flyToDisabled: boolean;
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
  modeConfig,
  featureCount,
  onFlyTo,
  flyToDisabled,
}: FloatingToolbarProps) {
  const { allowedTools, showEditOps, showMeasureTools, showSnapping, showCoordinateInput } = modeConfig;

  const hasTool = (tool: ToolMode) => allowedTools.includes(tool);
  const hasEditOp = (op: string) => showEditOps.includes(op as typeof showEditOps[number]);

  // Navigation group: select, pan
  const showNavGroup = hasTool("select") || hasTool("pan");

  // Draw + Edit group: draw tools and edit operations combined
  const showDrawEditGroup =
    hasTool("draw_point") || hasTool("draw_line") || hasTool("draw_polygon") || showEditOps.length > 0;

  // Measure group: measure_distance, measure_area
  const showMeasureGroup = showMeasureTools;

  // Precision group: snapping, coordinate input, fly-to
  const showPrecisionGroup = showSnapping || showCoordinateInput || modeConfig.showFlyTo;

  // Facility mode: disable point tool when a point already exists
  const isPointDisabledByLimit =
    modeConfig.mode === "facility" &&
    modeConfig.maxFeatureCount !== undefined &&
    featureCount >= modeConfig.maxFeatureCount;

  // Track which groups are rendered to add separators correctly
  const groups: React.ReactNode[] = [];

  // ─── Navigation Group ──────────────────────────────────────
  if (showNavGroup) {
    groups.push(
      <React.Fragment key="nav">
        {hasTool("select") && (
          <ToolButton
            icon={<MousePointer2 className="h-4 w-4" />}
            label="選択"
            shortcut="V"
            active={activeTool === "select"}
            onClick={() => onSetTool("select")}
          />
        )}
        {hasTool("pan") && (
          <ToolButton
            icon={<Hand className="h-4 w-4" />}
            label="パン"
            shortcut="H"
            active={activeTool === "pan"}
            onClick={() => onSetTool("pan")}
          />
        )}
      </React.Fragment>
    );
  }

  // ─── Draw + Edit Group ───────────────────────────────────────
  if (showDrawEditGroup) {
    groups.push(
      <React.Fragment key="draw-edit">
        {hasTool("draw_point") && (
          <ToolButton
            icon={<Circle className="h-4 w-4" />}
            label="ポイント"
            shortcut="P"
            active={activeTool === "draw_point"}
            disabled={isPointDisabledByLimit}
            disabledTooltip="施設には1つのポイントのみ配置できます。新しいポイントを追加するには、既存のポイントを削除してください"
            onClick={() => onSetTool("draw_point")}
          />
        )}
        {hasTool("draw_line") && (
          <ToolButton
            icon={<Minus className="h-4 w-4" />}
            label="ライン"
            shortcut="L"
            active={activeTool === "draw_line"}
            onClick={() => onSetTool("draw_line")}
          />
        )}
        {hasTool("draw_polygon") && (
          <ToolButton
            icon={<Pentagon className="h-4 w-4" />}
            label="ポリゴン"
            shortcut="G"
            active={activeTool === "draw_polygon"}
            onClick={() => onSetTool("draw_polygon")}
          />
        )}
        {hasEditOp("duplicate") && (
          <ToolButton
            icon={<Copy className="h-4 w-4" />}
            label="複製"
            shortcut="Ctrl+D"
            disabled={!hasSelection}
            onClick={onDuplicate}
          />
        )}
        {hasEditOp("delete") && (
          <ToolButton
            icon={<Trash2 className="h-4 w-4" />}
            label="削除"
            shortcut="Delete"
            disabled={!hasSelection}
            onClick={onDelete}
            variant="destructive"
          />
        )}
        {hasEditOp("merge") && (
          hasTool("merge_parts") ? (
            <ToolButton
              icon={<Merge className="h-4 w-4" />}
              label="結合"
              active={activeTool === "merge_parts"}
              onClick={() => {
                if (activeTool === "merge_parts") {
                  onSetTool("select");
                } else {
                  onSetTool("merge_parts");
                }
              }}
            />
          ) : (
            <ToolButton
              icon={<Merge className="h-4 w-4" />}
              label="結合"
              disabled={!canMerge}
              onClick={onMerge}
            />
          )
        )}
        {hasEditOp("split") && (
          <ToolButton
            icon={<Scissors className="h-4 w-4" />}
            label="分割"
            active={activeTool === "draw_clip_polygon"}
            disabled={selectionCount !== 1 && activeTool !== "draw_clip_polygon"}
            onClick={onSplit}
          />
        )}
      </React.Fragment>
    );
  }

  // ─── Measure Group ─────────────────────────────────────────
  if (showMeasureGroup) {
    groups.push(
      <React.Fragment key="measure">
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
      </React.Fragment>
    );
  }

  // ─── History Group (always shown) ──────────────────────────
  groups.push(
    <React.Fragment key="history">
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
    </React.Fragment>
  );

  // ─── Precision Group ───────────────────────────────────────
  if (showPrecisionGroup) {
    groups.push(
      <React.Fragment key="precision">
        {showSnapping && (
          <ToolButton
            icon={<Magnet className="h-4 w-4" />}
            label={`スナップ ${snappingEnabled ? "ON" : "OFF"}`}
            active={snappingEnabled}
            onClick={onToggleSnapping}
          />
        )}
        {showCoordinateInput && (
          <ToolButton
            icon={<Crosshair className="h-4 w-4" />}
            label="座標入力"
            active={activeTool === "coordinate_input"}
            onClick={onCoordinateInput}
          />
        )}
        {modeConfig.showFlyTo && (
          <ToolButton
            icon={<LocateFixed className="h-4 w-4" />}
            label="全体表示"
            shortcut="F"
            disabled={flyToDisabled}
            disabledTooltip="ジオメトリがありません"
            onClick={onFlyTo}
          />
        )}
      </React.Fragment>
    );
  }

  return (
    <div className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2">
      <div className="flex items-center gap-0.5 rounded-2xl border border-border/50 bg-background/95 px-2 py-1.5 shadow-lg backdrop-blur-sm">
        {groups.map((group, i) => (
          <React.Fragment key={i}>
            {i > 0 && <Separator orientation="vertical" className="mx-1 h-6" />}
            {group}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
