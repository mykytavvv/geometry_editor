"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { toast } from "sonner";
import type { Map as MaplibreMap } from "maplibre-gl";

import { SideNav } from "@/components/layout/side-nav";
import { Header } from "@/components/layout/header";
import { MapEditor } from "@/features/geometry-editor/components/map-editor";
import { FloatingToolbar } from "@/features/geometry-editor/components/floating-toolbar";
import { LayerPanel } from "@/features/geometry-editor/components/layer-panel";
import { PropertiesPanel } from "@/features/geometry-editor/components/properties-panel";
import { StatusBar } from "@/features/geometry-editor/components/status-bar";
import { CoordinateInputDialog } from "@/features/geometry-editor/components/coordinate-input-dialog";

import { useEditorState } from "@/features/geometry-editor/hooks/use-editor-state";
import { useMeasurement } from "@/features/geometry-editor/hooks/use-measurement";
import { MOCK_FEATURES } from "@/features/geometry-editor/mock-data";
import { loadFeatures, saveFeatures } from "@/features/geometry-editor/lib/storage";
import { flyToLayer } from "@/features/geometry-editor/lib/camera";
import type { ParkFeature } from "@/features/geometry-editor/types";
import { isLineGeometry, isPolygonGeometry, getEditableCoords } from "@/features/geometry-editor/hooks/use-vertex-edit";

export default function GeometryEditorPage() {
  const editor = useEditorState(MOCK_FEATURES);
  const { state } = editor;

  const [mapInstance, setMapInstance] = useState<MaplibreMap | null>(null);
  const [coordDialogOpen, setCoordDialogOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [splitTargetId, setSplitTargetId] = useState<string | null>(null);

  // Ref to access the selected vertex from vertex edit mode (populated by MapEditor)
  const getSelectedVertexRef = useRef<(() => { ringIndex: number; vertexIndex: number } | null) | null>(null);

  // ─── Load saved features from localStorage after hydration ──
  useEffect(() => {
    const saved = loadFeatures();
    if (saved) {
      editor.loadSaved(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Resize map when sidebar toggles ─────────────────────
  useEffect(() => {
    if (mapInstance) {
      // Small delay to let CSS transition complete
      const timer = setTimeout(() => mapInstance.resize(), 220);
      return () => clearTimeout(timer);
    }
  }, [sidebarCollapsed, mapInstance]);

  // ─── Clear clip target when leaving clip mode ──────────────
  useEffect(() => {
    if (state.activeTool !== "draw_clip_polygon") {
      setSplitTargetId(null);
    }
  }, [state.activeTool]);

  // ─── Measurement hook ──────────────────────────────────────
  const measurement = useMeasurement({
    measurementState: state.measurementState,
    setMeasurementState: editor.setMeasurementState,
    setLiveMeasurement: editor.setLiveMeasurement,
    addFeature: editor.addFeature,
  });

  // ─── Handle tool changes (start measurement modes) ─────────
  const handleSetTool = useCallback(
    (tool: typeof state.activeTool) => {
      // If switching away from a multi-part draw with accumulated parts, finalize them
      if (
        state.drawingParts &&
        state.drawingParts.length > 0 &&
        tool !== state.activeTool
      ) {
        editor.finishMultiDrawing();
        // If switching to the same draw tool, let it continue rather than finalizing and re-entering
        if (tool === "draw_line" || tool === "draw_polygon") {
          // The finishMultiDrawing already set tool to "select", so we let this setTool below apply the new draw tool
        }
      } else if (state.drawingParts?.length === 0 || (state.drawingPartsType && !state.drawingParts)) {
        // Clean up any empty drawing state
        editor.clearDrawingParts();
      }

      // If switching away from measurement, finish it
      if (
        state.measurementState &&
        tool !== "measure_distance" &&
        tool !== "measure_area"
      ) {
        measurement.finishMeasurement();
      }

      // If switching away from clip mode, clear clip target
      if (tool !== "draw_clip_polygon") {
        setSplitTargetId(null);
      }

      // If switching to measurement tool, start measurement
      if (tool === "measure_distance") {
        measurement.startMeasurement("distance");
      } else if (tool === "measure_area") {
        measurement.startMeasurement("area");
      }

      // ── Continue drawing from selected vertex ──
      // If in vertex edit mode with a selected vertex, and user switches to a
      // matching draw tool (G for polygon, L for line), start continue drawing
      // from that vertex instead of entering fresh draw mode.
      if (
        (tool === "draw_polygon" || tool === "draw_line") &&
        state.vertexEditFeatureId
      ) {
        const selectedVertex = getSelectedVertexRef.current?.();
        if (selectedVertex) {
          const feat = state.features.features.find((f) => f.id === state.vertexEditFeatureId);
          if (feat) {
            const isLine = isLineGeometry(feat);
            const isPoly = isPolygonGeometry(feat);
            const matchesGeometry =
              (tool === "draw_polygon" && isPoly) ||
              (tool === "draw_line" && isLine);

            if (matchesGeometry) {
              // For lines: only endpoints are valid for continuing
              if (isLine) {
                const editCoords = getEditableCoords(feat, state.vertexEditPartIndex);
                if (editCoords) {
                  const ring = editCoords[selectedVertex.ringIndex];
                  if (ring) {
                    const lastIdx = ring.length - 1;
                    if (selectedVertex.vertexIndex === 0 || selectedVertex.vertexIndex === lastIdx) {
                      const insertDirection = selectedVertex.vertexIndex === lastIdx ? "append" as const : "prepend" as const;
                      editor.startContinueDrawing(
                        feat.id,
                        state.vertexEditPartIndex,
                        selectedVertex.ringIndex,
                        selectedVertex.vertexIndex,
                        "line",
                        insertDirection,
                      );
                      return; // Don't fall through to setTool
                    }
                  }
                }
              } else {
                // Polygon: any vertex is valid
                editor.startContinueDrawing(
                  feat.id,
                  state.vertexEditPartIndex,
                  selectedVertex.ringIndex,
                  selectedVertex.vertexIndex,
                  "polygon",
                  "append",
                );
                return; // Don't fall through to setTool
              }
            }
          }
        }
      }

      editor.setTool(tool);
    },
    [editor, measurement, state.measurementState, state.drawingParts, state.drawingPartsType, state.activeTool, state.vertexEditFeatureId, state.vertexEditPartIndex, state.features.features]
  );

  // ─── Measurement click listener ────────────────────────────
  useEffect(() => {
    const handleMeasurementClick = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.lngLat) {
        measurement.addMeasurementPoint(detail.lngLat);
      }
    };

    window.addEventListener("map:measurement-click", handleMeasurementClick);
    return () => {
      window.removeEventListener(
        "map:measurement-click",
        handleMeasurementClick
      );
    };
  }, [measurement]);

  // ─── Coordinate input ─────────────────────────────────────
  const handleCoordinateInput = useCallback(() => {
    setCoordDialogOpen(true);
  }, []);

  const handleCoordinateConfirm = useCallback(
    (lng: number, lat: number, type: "point" | "line" | "polygon") => {
      if (type === "point") {
        const feature: ParkFeature = {
          id: uuidv4(),
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [lng, lat],
          },
          properties: {
            type: "point",
            layer: "draft",
          },
        };
        editor.addFeature(feature);
        editor.selectFeatures([feature.id]);
        editor.setRightPanel(true);

        // Fly to the new point
        if (mapInstance) {
          mapInstance.flyTo({ center: [lng, lat], zoom: 16 });
        }
      }
      // TODO: Line and Polygon coordinate input requires multi-coordinate UI
      setCoordDialogOpen(false);
      editor.setTool("select");
    },
    [editor, mapInstance]
  );

  // ─── Save / Cancel ─────────────────────────────────────────
  const handleSave = useCallback(() => {
    editor.save();
    saveFeatures(state.features);
    toast.success("保存しました", {
      description: `${state.features.features.length} 件のフィーチャーを保存しました`,
    });
  }, [editor, state.features]);

  const handleCancel = useCallback(() => {
    if (editor.isDirty) {
      const confirmed = window.confirm(
        "変更が保存されていません。キャンセルしますか？"
      );
      if (!confirmed) return;
    }
    editor.cancel();
    toast.info("変更を取り消しました");
  }, [editor]);

  // ─── Fly to features (layer-level camera movement) ─────────
  const handleFlyToFeatures = useCallback(
    (features: ParkFeature[]) => {
      if (mapInstance) {
        flyToLayer(mapInstance, features);
      }
    },
    [mapInstance]
  );

  // ─── Split handler ─────────────────────────────────────────
  const handleSplit = useCallback(() => {
    if (state.selectedFeatureIds.length !== 1) return;
    const targetId = state.selectedFeatureIds[0];
    const target = state.features.features.find((f) => f.id === targetId);
    if (!target || (target.geometry.type !== "Polygon" && target.geometry.type !== "MultiPolygon")) {
      toast.error("ポリゴンを選択してください");
      return;
    }
    setSplitTargetId(targetId);
    editor.setTool("draw_clip_polygon");
    toast.info("クリップツール", {
      description: "切り取る領域をポリゴンで描画してください（ダブルクリックで確定）",
    });
  }, [editor, state.selectedFeatureIds, state.features.features]);

  // ─── Merge check ──────────────────────────────────────────
  const canMerge =
    state.selectedFeatureIds.length >= 2 &&
    (() => {
      const selected = editor.selectedFeatures;
      const allPolygons = selected.every(
        (f) => f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon"
      );
      const allLines = selected.every(
        (f) => f.geometry.type === "LineString" || f.geometry.type === "MultiLineString"
      );
      return allPolygons || allLines;
    })();

  // ─── Render ────────────────────────────────────────────────
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Side Navigation */}
      <SideNav
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((prev) => !prev)}
        layerPanelOpen={state.leftPanelOpen}
        onToggleLayerPanel={editor.toggleLeftPanel}
      />

      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <Header onSave={handleSave} onCancel={handleCancel} />

        {/* Map Area */}
        <div className="relative flex-1 overflow-hidden">
          {/* Map */}
          <MapEditor
            features={state.features}
            visibleFeatures={editor.visibleFeatures}
            selectedFeatureIds={state.selectedFeatureIds}
            activeTool={state.activeTool}
            measurementState={state.measurementState}
            snappingEnabled={state.snappingEnabled}
            editor={editor}
            onMapReady={setMapInstance}
            splitTargetId={splitTargetId}
            getSelectedVertexRef={getSelectedVertexRef}
          />

          {/* Layer Panel (left) */}
          <LayerPanel
            open={state.leftPanelOpen}
            onToggle={editor.toggleLeftPanel}
            features={state.features}
            selectedFeatureIds={state.selectedFeatureIds}
            layerVisibility={state.layerVisibility}
            parkVisibility={state.parkVisibility}
            onSelectFeature={editor.selectFeatures}
            onToggleLayerVisibility={editor.toggleLayerVisibility}
            onToggleParkVisibility={editor.toggleParkVisibility}
            onReassignFeature={editor.reassignFeature}
            onFlyToFeatures={handleFlyToFeatures}
          />

          {/* Properties Panel (right) */}
          <PropertiesPanel
            open={state.rightPanelOpen}
            onToggle={editor.toggleRightPanel}
            selectedFeatures={editor.selectedFeatures}
            allFeatures={state.features}
            onUpdateFeature={editor.updateFeature}
            onBulkUpdateProperties={editor.bulkUpdateProperties}
          />

          {/* Status Bar */}
          <StatusBar
            cursorPosition={state.cursorPosition}
            activeTool={state.activeTool}
            liveMeasurement={state.liveMeasurement}
            isDrawing={state.isDrawing}
            featureCount={state.features.features.length}
            selectedCount={state.selectedFeatureIds.length}
            multiDrawPartCount={state.drawingParts?.length ?? 0}
            multiDrawType={state.drawingPartsType}
          />

          {/* Floating Toolbar */}
          <FloatingToolbar
            activeTool={state.activeTool}
            onSetTool={handleSetTool}
            canUndo={editor.canUndo}
            canRedo={editor.canRedo}
            onUndo={editor.undo}
            onRedo={editor.redo}
            hasSelection={state.selectedFeatureIds.length > 0}
            selectionCount={state.selectedFeatureIds.length}
            canMerge={canMerge}
            onDuplicate={editor.duplicateSelected}
            onDelete={editor.deleteSelected}
            onMerge={editor.mergeSelected}
            onSplit={handleSplit}
            snappingEnabled={state.snappingEnabled}
            onToggleSnapping={editor.toggleSnapping}
            onCoordinateInput={handleCoordinateInput}
            onSaveAsMeasurement={measurement.saveAsGeometry}
            isMeasuring={!!state.measurementState && state.measurementState.points.length >= 2}
          />

          {/* Continue drawing actions (floating above toolbar) */}
          {state.continueDrawingState && (
            <div className="absolute bottom-20 left-1/2 z-30 -translate-x-1/2 animate-in fade-in slide-in-from-bottom-2 duration-200">
              <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-background/95 px-3 py-2 shadow-lg backdrop-blur-sm">
                <span className="text-xs font-medium text-amber-600">
                  描画延長中{state.continueDrawingState.newVertices.length > 0
                    ? ` (${state.continueDrawingState.newVertices.length} 頂点)`
                    : ""}
                </span>
                <div className="h-4 w-px bg-border" />
                <button
                  onClick={editor.cancelContinueDrawing}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  キャンセル
                  <kbd className="ml-1 rounded bg-muted px-1 py-0.5 text-[10px] font-mono text-muted-foreground">
                    Esc
                  </kbd>
                </button>
                <button
                  onClick={editor.finishContinueDrawing}
                  disabled={state.continueDrawingState.newVertices.length === 0}
                  className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-500/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  確定
                  <kbd className="ml-1 rounded bg-white/20 px-1 py-0.5 text-[10px] font-mono">
                    Enter
                  </kbd>
                </button>
              </div>
            </div>
          )}

          {/* Multi-draw actions (floating above toolbar) */}
          {state.drawingParts && state.drawingParts.length > 0 && (
            <div className="absolute bottom-20 left-1/2 z-30 -translate-x-1/2 animate-in fade-in slide-in-from-bottom-2 duration-200">
              <div className="flex items-center gap-2 rounded-xl border border-park/30 bg-background/95 px-3 py-2 shadow-lg backdrop-blur-sm">
                <span className="text-xs font-medium text-muted-foreground">
                  {state.drawingParts.length} パート
                </span>
                <div className="h-4 w-px bg-border" />
                <button
                  onClick={() => {
                    editor.clearDrawingParts();
                    editor.setTool("select");
                  }}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  キャンセル
                </button>
                <button
                  onClick={editor.finishMultiDrawing}
                  className="flex items-center gap-1.5 rounded-lg bg-park px-3 py-1.5 text-xs font-medium text-park-foreground transition-colors hover:bg-park/90"
                >
                  完了
                  <kbd className="ml-1 rounded bg-park-foreground/20 px-1 py-0.5 text-[10px] font-mono">
                    Enter
                  </kbd>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Dialogs */}
      <CoordinateInputDialog
        open={coordDialogOpen}
        onClose={() => {
          setCoordDialogOpen(false);
          editor.setTool("select");
        }}
        onConfirm={handleCoordinateConfirm}
      />
    </div>
  );
}
