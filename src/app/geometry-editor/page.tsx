"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

import { useEditorState } from "@/features/geometry-editor/hooks/use-editor-state";
import { useMeasurement } from "@/features/geometry-editor/hooks/use-measurement";
import { MOCK_FEATURES, PARK_MOCK_FEATURES, FACILITY_MOCK_FEATURES, FACILITY_PARK_BOUNDARY } from "@/features/geometry-editor/mock-data";
import { loadFeatures, saveFeatures } from "@/features/geometry-editor/lib/storage";
import { flyToLayer } from "@/features/geometry-editor/lib/camera";
import type { EditorMode, ParkFeature, ParkFeatureCollection } from "@/features/geometry-editor/types";
import { getEditorModeConfig } from "@/features/geometry-editor/editor-mode-config";

// ─── Mock data lookup per mode ───────────────────────────────
function getMockDataForMode(mode: EditorMode): ParkFeatureCollection {
  switch (mode) {
    case "full":
      return MOCK_FEATURES;
    case "park":
      return PARK_MOCK_FEATURES;
    case "facility":
      return FACILITY_MOCK_FEATURES;
  }
}

export default function GeometryEditorPage() {
  const [editorMode, setEditorMode] = useState<EditorMode>("full");
  const modeConfig = useMemo(() => getEditorModeConfig(editorMode), [editorMode]);

  const editor = useEditorState(MOCK_FEATURES);
  const { state } = editor;

  const [mapInstance, setMapInstance] = useState<MaplibreMap | null>(null);
  const [coordDialogOpen, setCoordDialogOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [splitTargetId, setSplitTargetId] = useState<string | null>(null);

  // Ref to access the selected vertex from vertex edit mode (populated by MapEditor)
  const getSelectedVertexRef = useRef<(() => { ringIndex: number; vertexIndex: number } | null) | null>(null);

  // ─── Breadcrumbs (mode-specific suffix) ────────────────────
  const breadcrumbs = useMemo(
    () => ["公園", "名城公園", modeConfig.breadcrumbSuffix],
    [modeConfig.breadcrumbSuffix]
  );

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

  // ─── Mode switching ────────────────────────────────────────
  const handleModeChange = useCallback(
    (mode: EditorMode) => {
      if (mode === editorMode) return;

      if (editor.isDirty) {
        const confirmed = window.confirm(
          "変更が保存されていません。モードを切り替えますか？"
        );
        if (!confirmed) return;
      }

      setEditorMode(mode);
      const mockData = getMockDataForMode(mode);
      editor.loadSaved(mockData);

      // Reset any active tool / drawing state
      editor.setTool("select");
      setSplitTargetId(null);
      setCoordDialogOpen(false);
    },
    [editorMode, editor]
  );

  // ─── Handle tool changes (start measurement modes) ─────────
  const handleSetTool = useCallback(
    (tool: typeof state.activeTool) => {
      // Guard: only allow tools that are in the current mode's allowed tools
      if (!modeConfig.allowedTools.includes(tool)) {
        return;
      }

      // Facility mode: block draw_point if feature limit reached
      if (
        modeConfig.mode === "facility" &&
        tool === "draw_point" &&
        modeConfig.maxFeatureCount !== undefined &&
        state.features.features.length >= modeConfig.maxFeatureCount
      ) {
        return;
      }

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

      // For draw_polygon: the first click in map-editor.tsx will detect
      // vertex/edge/free-space and start continue_drawing automatically.
      // No special handling needed here.

      editor.setTool(tool);
    },
    [editor, measurement, modeConfig, state.measurementState, state.drawingParts, state.drawingPartsType, state.activeTool, state.features.features]
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
  const saveValidation = useMemo(
    () => modeConfig.validateOnSave(state.features.features),
    [modeConfig, state.features.features]
  );
  const isSaveDisabled = !saveValidation.valid;

  const handleSave = useCallback(() => {
    // Mode-specific validation
    const validation = modeConfig.validateOnSave(state.features.features);
    if (!validation.valid) {
      toast.error("保存できません", {
        description: validation.message,
      });
      return;
    }

    editor.save();
    saveFeatures(state.features);
    toast.success("保存しました", {
      description: `${state.features.features.length} 件のフィーチャーを保存しました`,
    });
  }, [editor, state.features, modeConfig]);

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

  // ─── Fly to all features (toolbar action) ──────────────────
  const handleFlyToAll = useCallback(() => {
    if (mapInstance && state.features.features.length > 0) {
      flyToLayer(mapInstance, state.features.features);
    }
  }, [mapInstance, state.features.features]);

  const flyToDisabled = state.features.features.length === 0;

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

  // ─── Merge check (for non-park mode feature-level merge) ────
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

  const handleMerge = useCallback(() => {
    editor.mergeSelected();
  }, [editor]);

  // ─── Merge parts confirm (park mode merge_parts tool) ──────
  const handleMergePartsConfirm = useCallback(() => {
    if (state.selectedPartIndices.length >= 2 && state.selectedFeatureIds.length === 1) {
      editor.mergeParts(state.selectedFeatureIds[0], state.selectedPartIndices);
    }
    editor.setTool("select");
  }, [editor, state.selectedFeatureIds, state.selectedPartIndices]);

  const handleMergePartsCancel = useCallback(() => {
    editor.setTool("select");
  }, [editor]);

  // ─── Render ────────────────────────────────────────────────
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Side Navigation */}
      <SideNav
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((prev) => !prev)}
        layerPanelOpen={modeConfig.showLayerPanelToggle ? state.leftPanelOpen : false}
        onToggleLayerPanel={modeConfig.showLayerPanelToggle ? editor.toggleLeftPanel : undefined}
      />

      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <Header
          editorMode={editorMode}
          onModeChange={handleModeChange}
        />

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
            allowedTools={modeConfig.allowedTools}
            editorMode={editorMode}
            onFlyTo={modeConfig.showFlyTo && !flyToDisabled ? handleFlyToAll : undefined}
            backgroundParkBoundary={editorMode === "facility" ? FACILITY_PARK_BOUNDARY : undefined}
          />

          {/* Floating Breadcrumbs (top-left) */}
          <div className="absolute top-3 left-3 z-20">
            <div className="flex items-center rounded-2xl border border-border/50 bg-background/95 px-3 py-2 shadow-lg backdrop-blur-sm">
              <nav className="flex items-center text-sm text-muted-foreground">
                {breadcrumbs.map((crumb, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <span className="mx-1.5">/</span>}
                    <span
                      className={
                        i === breadcrumbs.length - 1
                          ? "font-medium text-foreground"
                          : "hover:text-foreground cursor-pointer"
                      }
                    >
                      {crumb}
                    </span>
                  </React.Fragment>
                ))}
              </nav>
            </div>
          </div>

          {/* Floating Save/Cancel (top-right) */}
          <div className="absolute top-3 right-3 z-20">
            <div className="flex items-center gap-2 rounded-2xl border border-border/50 bg-background/95 px-3 py-2 shadow-lg backdrop-blur-sm">
              <Button variant="outline" size="sm" onClick={handleCancel}>
                キャンセル
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  {isSaveDisabled ? (
                    <span className="inline-flex" tabIndex={0}>
                      <Button
                        size="sm"
                        disabled
                        className="bg-park text-park-foreground hover:bg-park/90"
                      >
                        保存
                      </Button>
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      onClick={handleSave}
                      className="bg-park text-park-foreground hover:bg-park/90"
                    >
                      保存
                    </Button>
                  )}
                </TooltipTrigger>
                {isSaveDisabled && saveValidation.message && (
                  <TooltipContent side="bottom" className="text-xs max-w-[220px]">
                    {saveValidation.message}
                  </TooltipContent>
                )}
              </Tooltip>
            </div>
          </div>

          {/* Layer Panel (left) — only in full mode */}
          {modeConfig.showLayerPanel && (
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
          )}

          {/* Properties Panel (right) — only in full mode */}
          {modeConfig.showPropertiesPanel && (
            <PropertiesPanel
              open={state.rightPanelOpen}
              onToggle={editor.toggleRightPanel}
              selectedFeatures={editor.selectedFeatures}
              allFeatures={state.features}
              onUpdateFeature={editor.updateFeature}
              onBulkUpdateProperties={editor.bulkUpdateProperties}
            />
          )}

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
            selectedPartCount={state.selectedPartIndices.length}
            totalPartCount={
              state.selectedFeatureIds.length === 1
                ? (() => {
                    const f = state.features.features.find((feat) => feat.id === state.selectedFeatureIds[0]);
                    return f?.geometry.type === "MultiPolygon"
                      ? (f.geometry as import("geojson").MultiPolygon).coordinates.length
                      : 0;
                  })()
                : 0
            }
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
            onMerge={handleMerge}
            onSplit={handleSplit}
            snappingEnabled={state.snappingEnabled}
            onToggleSnapping={editor.toggleSnapping}
            onCoordinateInput={handleCoordinateInput}
            onSaveAsMeasurement={measurement.saveAsGeometry}
            isMeasuring={!!state.measurementState && state.measurementState.points.length >= 2}
            modeConfig={modeConfig}
            featureCount={state.features.features.length}
            onFlyTo={handleFlyToAll}
            flyToDisabled={flyToDisabled}
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
                  onClick={() => editor.finishContinueDrawing("free", null, null)}
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

          {/* Merge parts actions (floating above toolbar) */}
          {state.activeTool === "merge_parts" && (
            <div className="absolute bottom-20 left-1/2 z-30 -translate-x-1/2 animate-in fade-in slide-in-from-bottom-2 duration-200">
              <div className="flex items-center gap-2 rounded-xl border border-park/30 bg-background/95 px-3 py-2 shadow-lg backdrop-blur-sm">
                <span className="text-xs font-medium text-muted-foreground">
                  {state.selectedPartIndices.length} パート
                </span>
                <div className="h-4 w-px bg-border" />
                <button
                  onClick={handleMergePartsCancel}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleMergePartsConfirm}
                  disabled={state.selectedPartIndices.length < 2}
                  className="flex items-center gap-1.5 rounded-lg bg-park px-3 py-1.5 text-xs font-medium text-park-foreground transition-colors hover:bg-park/90 disabled:opacity-50 disabled:cursor-not-allowed"
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

      {/* Dialogs — Coordinate input only shown if mode supports it */}
      {modeConfig.showCoordinateInput && (
        <CoordinateInputDialog
          open={coordDialogOpen}
          onClose={() => {
            setCoordDialogOpen(false);
            editor.setTool("select");
          }}
          onConfirm={handleCoordinateConfirm}
        />
      )}
    </div>
  );
}
