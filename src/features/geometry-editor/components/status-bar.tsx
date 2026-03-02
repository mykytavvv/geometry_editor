"use client";

import React from "react";
import type { ToolMode } from "../types";

const TOOL_LABELS: Record<ToolMode, string> = {
  select: "選択",
  pan: "パン",
  draw_point: "ポイント描画",
  draw_line: "ライン描画",
  draw_polygon: "ポリゴン描画",
  move: "移動",
  vertex_edit: "頂点編集",
  continue_drawing: "描画延長",
  measure_distance: "距離測定",
  measure_area: "面積測定",
  coordinate_input: "座標入力",
  draw_clip_polygon: "クリップ領域描画",
};

interface StatusBarProps {
  cursorPosition: [number, number] | null;
  activeTool: ToolMode;
  liveMeasurement: string | null;
  isDrawing: boolean;
  featureCount: number;
  selectedCount: number;
  multiDrawPartCount?: number;
  multiDrawType?: "line" | "polygon" | null;
}

export function StatusBar({
  cursorPosition,
  activeTool,
  liveMeasurement,
  isDrawing,
  featureCount,
  selectedCount,
  multiDrawPartCount = 0,
  multiDrawType = null,
}: StatusBarProps) {
  return (
    <div className="absolute bottom-16 left-1/2 z-10 -translate-x-1/2">
      <div className="flex items-center gap-4 rounded-lg border border-border/30 bg-background/80 px-3 py-1 text-[11px] text-muted-foreground backdrop-blur-sm">
        {/* Cursor coordinates */}
        <span className="font-mono tabular-nums">
          {cursorPosition
            ? `${cursorPosition[1].toFixed(6)}°N, ${cursorPosition[0].toFixed(6)}°E`
            : "─"}
        </span>

        <span className="text-border">|</span>

        {/* Active tool */}
        <span className="font-medium text-foreground/80">
          {TOOL_LABELS[activeTool]}
          {isDrawing && multiDrawPartCount > 0 && (
            <span className="ml-1 text-park">
              {multiDrawType === "polygon" ? "マルチポリゴン" : "マルチライン"}描画中 — パート {multiDrawPartCount + 1}
            </span>
          )}
          {isDrawing && multiDrawPartCount === 0 && (
            <span className="ml-1 text-park">描画中...</span>
          )}
          {!isDrawing && multiDrawPartCount > 0 && (
            <span className="ml-1 text-park">
              {multiDrawPartCount} パート完了 — 続けて描画、または Enter で確定
            </span>
          )}
          {activeTool === "vertex_edit" && (
            <span className="ml-1 text-amber-600">
              ドラッグで移動 / 中間点クリックで追加 / 選択+Deleteで削除 / 選択+G/Lで延長描画
            </span>
          )}
          {activeTool === "continue_drawing" && (
            <span className="ml-1 text-amber-600">
              クリックで頂点を追加 / Enterで確定 / Escでキャンセル / Backspaceで戻す
            </span>
          )}
        </span>

        {/* Live measurement */}
        {liveMeasurement && (
          <>
            <span className="text-border">|</span>
            <span className="font-medium text-amber-600">
              {liveMeasurement}
            </span>
          </>
        )}

        <span className="text-border">|</span>

        {/* Feature count */}
        <span>
          {featureCount} 件
          {selectedCount > 0 && (
            <span className="ml-1 text-park">({selectedCount} 選択)</span>
          )}
        </span>
      </div>
    </div>
  );
}
