"use client";

import React, { useRef, useEffect, useCallback, useState, useMemo } from "react";
import maplibregl, { Map as MaplibreMap, type LngLatLike } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";

import {
  MAP_CENTER,
  MAP_ZOOM,
  MAP_STYLE,
  SOURCE_ID,
  POLYGON_FILL_LAYER,
  POLYGON_OUTLINE_LAYER,
  LINE_LAYER,
  POINT_LAYER,
  TEXT_LAYER,
  SELECTED_FILL_LAYER,
  SELECTED_OUTLINE_LAYER,
  SELECTED_POINT_LAYER,
  FACILITY_POINT_LAYER,
  SELECTED_FACILITY_POINT_LAYER,
  MEASUREMENT_SOURCE_ID,
  MEASUREMENT_LINE_LAYER,
  MEASUREMENT_FILL_LAYER,
  MEASUREMENT_POINT_LAYER,
  MULTI_DRAW_SOURCE_ID,
  MULTI_DRAW_FILL_LAYER,
  MULTI_DRAW_LINE_LAYER,
  MULTI_DRAW_POINT_LAYER,
  LAYER_CONFIG,
  SELECTED_PARTS_SOURCE_ID,
  SELECTED_PARTS_FILL_LAYER,
  SELECTED_PARTS_OUTLINE_LAYER,
  PARK_BACKGROUND_SOURCE_ID,
  PARK_BACKGROUND_FILL_LAYER,
  PARK_BACKGROUND_OUTLINE_LAYER,
} from "../constants";
import type {
  ParkFeatureCollection,
  ParkFeature,
  ToolMode,
  MeasurementState,
  ParkLayer,
  EditorMode,
} from "../types";
import { useMapDraw } from "../hooks/use-map-draw";
import { useVertexEdit } from "../hooks/use-vertex-edit";
import { useContinueDrawing } from "../hooks/use-continue-drawing";
import type { EditorActions } from "../hooks/use-editor-state";
import {
  VERTEX_EDIT_VERTEX_LAYER,
  VERTEX_EDIT_SELECTED_VERTEX_LAYER,
  VERTEX_EDIT_MIDPOINT_LAYER,
  SNAP_THRESHOLD_PX,
} from "../constants";
import { clipPolygon } from "../lib/geometry-ops";
import { findNearestVertex, findNearestEdge, type ProjectFn } from "../lib/snapping";
import type { VertexAnchorInfo, EdgeAnchorInfo } from "../types";
import type { Feature, LineString, Polygon as GeoPolygon, Position } from "geojson";
import { toast } from "sonner";
import { booleanPointInPolygon, point as turfPoint, polygon as turfPolygon } from "@turf/turf";

// ─── Find vertex info in a feature collection ──────────────────
/**
 * Given a snapped position and (optionally) the feature ID it snapped to,
 * find the full VertexAnchorInfo (partIndex, ringIndex, vertexIndex).
 */
function findVertexInfoInCollection(
  collection: ParkFeatureCollection,
  position: Position,
  featureId?: string,
): VertexAnchorInfo | null {
  const match = (v: Position) => v[0] === position[0] && v[1] === position[1];

  const searchFeature = (f: ParkFeature): VertexAnchorInfo | null => {
    const geom = f.geometry;
    switch (geom.type) {
      case "Point":
        if (match(geom.coordinates)) {
          return { featureId: f.id, partIndex: null, ringIndex: 0, vertexIndex: 0, position };
        }
        break;
      case "LineString":
        for (let i = 0; i < geom.coordinates.length; i++) {
          if (match(geom.coordinates[i])) {
            return { featureId: f.id, partIndex: null, ringIndex: 0, vertexIndex: i, position };
          }
        }
        break;
      case "MultiLineString":
        for (let p = 0; p < geom.coordinates.length; p++) {
          for (let i = 0; i < geom.coordinates[p].length; i++) {
            if (match(geom.coordinates[p][i])) {
              return { featureId: f.id, partIndex: p, ringIndex: 0, vertexIndex: i, position };
            }
          }
        }
        break;
      case "Polygon":
        for (let r = 0; r < geom.coordinates.length; r++) {
          const ring = geom.coordinates[r];
          for (let i = 0; i < ring.length - 1; i++) {
            if (match(ring[i])) {
              return { featureId: f.id, partIndex: null, ringIndex: r, vertexIndex: i, position };
            }
          }
        }
        break;
      case "MultiPolygon":
        for (let p = 0; p < geom.coordinates.length; p++) {
          for (let r = 0; r < geom.coordinates[p].length; r++) {
            const ring = geom.coordinates[p][r];
            for (let i = 0; i < ring.length - 1; i++) {
              if (match(ring[i])) {
                return { featureId: f.id, partIndex: p, ringIndex: r, vertexIndex: i, position };
              }
            }
          }
        }
        break;
    }
    return null;
  };

  // If we know the feature ID, search that feature first
  if (featureId) {
    const feat = collection.features.find((f) => f.id === featureId);
    if (feat) {
      const result = searchFeature(feat);
      if (result) return result;
    }
  }

  // Fall back to searching all features
  for (const feat of collection.features) {
    const result = searchFeature(feat);
    if (result) return result;
  }

  return null;
}

// ─── Point-to-segment distance (for MultiLineString part detection) ──
/** Approximate squared distance from a point to a line segment in lng/lat space. */
function pointToSegmentDistance(
  p: [number, number],
  a: [number, number],
  b: [number, number]
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    // a and b are the same point
    const ex = p[0] - a[0];
    const ey = p[1] - a[1];
    return Math.sqrt(ex * ex + ey * ey);
  }
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a[0] + t * dx;
  const projY = a[1] + t * dy;
  const ex = p[0] - projX;
  const ey = p[1] - projY;
  return Math.sqrt(ex * ex + ey * ey);
}

// ─── Geometry translation helper ──────────────────────────────
function translateCoordinates(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  coords: any,
  deltaLng: number,
  deltaLat: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  if (typeof coords[0] === "number") {
    // Single coordinate [lng, lat]
    return [coords[0] + deltaLng, coords[1] + deltaLat];
  }
  // Nested array of coordinates
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return coords.map((c: any) => translateCoordinates(c, deltaLng, deltaLat));
}

function translateFeatureGeometry(
  feature: ParkFeature,
  deltaLng: number,
  deltaLat: number
): ParkFeature {
  return {
    ...feature,
    geometry: {
      ...feature.geometry,
      coordinates: translateCoordinates(
        feature.geometry.coordinates,
        deltaLng,
        deltaLat
      ),
    } as ParkFeature["geometry"],
  };
}

// ─── Facility pin marker SVG helpers ─────────────────────────
// Creates a teardrop/pin marker SVG as an HTMLImageElement for use with map.addImage()
function createPinMarkerImage(
  outerColor: string,
  innerColor: string,
  size: number = 48
): Promise<HTMLImageElement> {
  // The pin shape: a teardrop pointing downward
  // Viewbox is 40x52 — a circle at top with a pointed tail at bottom
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${Math.round(size * 1.3)}" viewBox="0 0 40 52">
    <path d="M20 50 C20 50 2 30 2 18 C2 8.06 10.06 0 20 0 C29.94 0 38 8.06 38 18 C38 30 20 50 20 50Z" fill="${outerColor}" stroke="none"/>
    <circle cx="20" cy="18" r="12" fill="${innerColor}"/>
  </svg>`;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
}

// Load facility pin marker images into the map
async function loadFacilityPinImages(map: MaplibreMap) {
  try {
    const [defaultPin, selectedPin] = await Promise.all([
      // Default: white outer, dark green inner (matches screenshot 1)
      createPinMarkerImage("#ffffff", "#2f6846", 64),
      // Selected: blue outer, white inner (matches screenshot 2)
      createPinMarkerImage("#4a8af4", "#ffffff", 64),
    ]);

    if (!map.hasImage("facility-pin-default")) {
      map.addImage("facility-pin-default", defaultPin, { pixelRatio: 2 });
    }
    if (!map.hasImage("facility-pin-selected")) {
      map.addImage("facility-pin-selected", selectedPin, { pixelRatio: 2 });
    }
  } catch (e) {
    console.error("Failed to load facility pin images:", e);
  }
}

interface MapEditorProps {
  features: ParkFeatureCollection;
  visibleFeatures: ParkFeatureCollection;
  selectedFeatureIds: string[];
  activeTool: ToolMode;
  measurementState: MeasurementState | null;
  snappingEnabled: boolean;
  editor: EditorActions;
  onMapReady: (map: MaplibreMap) => void;
  splitTargetId?: string | null;
  /** Ref that MapEditor populates with a getter for the selected vertex in vertex edit mode. */
  getSelectedVertexRef?: React.MutableRefObject<(() => { ringIndex: number; vertexIndex: number } | null) | null>;
  /** Tools allowed in the current editor mode, used to gate keyboard shortcuts. */
  allowedTools?: ToolMode[];
  /** Current editor mode – determines default layer and behavior. */
  editorMode?: EditorMode;
  /** Fly-to callback for the F keyboard shortcut. */
  onFlyTo?: () => void;
  /** Non-editable park boundary shown as background context (facility mode). */
  backgroundParkBoundary?: ParkFeatureCollection;
}

export function MapEditor({
  features,
  visibleFeatures,
  selectedFeatureIds,
  activeTool,
  measurementState,
  snappingEnabled,
  editor,
  onMapReady,
  splitTargetId,
  getSelectedVertexRef,
  allowedTools,
  editorMode,
  onFlyTo,
  backgroundParkBoundary,
}: MapEditorProps) {
  // Derive mode-specific flags and default layer from editorMode
  const isParkMode = editorMode === "park";
  const isFacilityMode = editorMode === "facility";
  const defaultLayer: ParkLayer = editorMode === "facility" ? "facilities" : editorMode === "park" ? "park" : "draft";

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  // Split mode: ID of polygon being split
  const splitTargetIdRef = useRef<string | null>(null);
  splitTargetIdRef.current = splitTargetId ?? null;
  // Keep a ref to activeTool so callbacks can read the latest value
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;

  // Drag-to-move state
  const dragStateRef = useRef<{
    isDragging: boolean;
    featureId: string;
    startLngLat: [number, number];
    originalFeature: ParkFeature;
  } | null>(null);
  const justDraggedRef = useRef(false);
  const justCreatedFeatureRef = useRef(0);

  // ─── Initialize Map ────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: MAP_CENTER as LngLatLike,
      zoom: MAP_ZOOM,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 200 }), "bottom-left");

    map.on("load", () => {
      setMapLoaded(true);
      onMapReady(map);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Get existing feature helper ──────────────────────────
  const getExistingFeature = useCallback(
    (id: string) => features.features.find((f) => f.id === id),
    [features]
  );

  // ─── Draw integration ─────────────────────────────────────
  const handleFeatureCreated = useCallback(
    (feature: ParkFeature) => {
      // Record creation time so the click handler can ignore the
      // finishing double-click that would otherwise deselect the feature.
      justCreatedFeatureRef.current = Date.now();

      // ── Clip mode interception ──
      if (activeToolRef.current === "draw_clip_polygon") {
        const targetId = splitTargetIdRef.current;
        splitTargetIdRef.current = null;

        if (targetId && feature.geometry.type === "Polygon") {
          const targetFeature = features.features.find((f) => f.id === targetId);
          if (
            targetFeature &&
            (targetFeature.geometry.type === "Polygon" ||
              targetFeature.geometry.type === "MultiPolygon")
          ) {
            const cutter: Feature<GeoPolygon> = {
              type: "Feature",
              geometry: feature.geometry as GeoPolygon,
              properties: {},
            };
            const result = clipPolygon(targetFeature, cutter);
            if (result) {
              editor.updateFeature(result);
              editor.setTool("select");
              toast.success("クリップ完了", {
                description: "ポリゴンのジオメトリを更新しました",
              });
              return;
            } else {
              toast.error("クリップに失敗しました", {
                description:
                  "クリップ領域がポリゴンと重なっていることを確認してください",
              });
            }
          }
        }
        // Fall back to select mode on failure
        editor.setTool("select");
        return;
      }

      // ── Multi-part drawing: Line ──
      if (activeToolRef.current === "draw_line" && feature.geometry.type === "LineString") {
        const lineCoords = (feature.geometry as LineString).coordinates;
        editor.appendDrawingPart("line", lineCoords);
        // Briefly switch to select so MapboxDraw goes to simple_select,
        // preventing the double-click from bleeding into the next draw.
        // Then re-enter draw mode after the double-click event has settled.
        editor.setTool("select");
        setTimeout(() => {
          editor.setTool("draw_line");
        }, 300);
        toast.info("パートを追加しました", {
          description: "続けて次のラインを描画、または Enter / 完了ボタンで確定",
          duration: 2000,
        });
        return;
      }

      // Note: draw_polygon is now handled by the custom drawing system
      // (use-continue-drawing.ts), not by MapboxDraw. The polygon creation
      // path above has been removed.

      // ── Single-part creation (Point or other) ──
      editor.addFeature(feature);
      editor.selectFeatures([feature.id]);
      editor.setRightPanel(true);

      // In facility mode, switch to select after placing a point
      // (only one point allowed per facility).
      // In other modes, keep point tool active for continuous placement.
      if (isFacilityMode || activeToolRef.current !== "draw_point") {
        editor.setTool("select");
      }
    },
    [editor, features.features, isParkMode, isFacilityMode]
  );

  const handleFeatureUpdated = useCallback(
    (feature: ParkFeature) => {
      editor.updateFeature(feature);
    },
    [editor]
  );

  const handleSelectionChanged = useCallback(
    (ids: string[]) => {
      editor.selectFeatures(ids);
    },
    [editor]
  );

  const handleDrawingStateChanged = useCallback(
    (isDrawing: boolean) => {
      editor.setDrawing(isDrawing);
    },
    [editor]
  );

  const { loadFeatureForEditing, trashLastVertex, suppressNextCreateRef } = useMapDraw({
    map: mapRef.current,
    activeTool,
    onFeatureCreated: handleFeatureCreated,
    onFeatureUpdated: handleFeatureUpdated,
    onSelectionChanged: handleSelectionChanged,
    onDrawingStateChanged: handleDrawingStateChanged,
    getExistingFeature,
    defaultLayer,
  });

  // ─── Vertex edit integration ────────────────────────────────
  const vertexEditFeature = useMemo(() => {
    const id = editor.state.vertexEditFeatureId;
    if (!id) return null;
    return features.features.find((f) => f.id === id) ?? null;
  }, [editor.state.vertexEditFeatureId, features.features]);

  const { getSelectedVertex } = useVertexEdit({
    map: mapRef.current,
    mapLoaded,
    feature: vertexEditFeature,
    partIndex: editor.state.vertexEditPartIndex ?? null,
    allFeatures: features,
    snappingEnabled,
    onUpdateFeature: handleFeatureUpdated,
    onExit: editor.exitVertexEdit,
  });

  // Expose getSelectedVertex to the parent via a ref
  useEffect(() => {
    if (getSelectedVertexRef) {
      getSelectedVertexRef.current = getSelectedVertex;
    }
  }, [getSelectedVertex, getSelectedVertexRef]);

  // ─── Continue drawing integration (custom polygon drawing) ──
  useContinueDrawing({
    map: mapRef.current,
    mapLoaded,
    continueDrawingState: editor.state.continueDrawingState,
    allFeatures: features,
    snappingEnabled,
    onAddVertex: editor.addContinueVertex,
    onUndoVertex: editor.undoContinueVertex,
    onFinish: editor.finishContinueDrawing,
    onCancel: editor.cancelContinueDrawing,
  });

  // ─── Setup GeoJSON source and layers ──────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    // Add park background source and layers (facility mode context, rendered underneath)
    if (!map.getSource(PARK_BACKGROUND_SOURCE_ID)) {
      map.addSource(PARK_BACKGROUND_SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: PARK_BACKGROUND_FILL_LAYER,
        type: "fill",
        source: PARK_BACKGROUND_SOURCE_ID,
        paint: {
          "fill-color": LAYER_CONFIG.park.color,
          "fill-opacity": 0.12,
        },
      });

      map.addLayer({
        id: PARK_BACKGROUND_OUTLINE_LAYER,
        type: "line",
        source: PARK_BACKGROUND_SOURCE_ID,
        paint: {
          "line-color": LAYER_CONFIG.park.color,
          "line-width": 2,
          "line-dasharray": [4, 3],
        },
      });
    }

    // Add main features source
    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      // Polygon fill layer
      map.addLayer({
        id: POLYGON_FILL_LAYER,
        type: "fill",
        source: SOURCE_ID,
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: {
          "fill-color": [
            "match",
            ["get", "layer"],
            "park", LAYER_CONFIG.park.color,
            "facilities", LAYER_CONFIG.facilities.color,
            "draft", LAYER_CONFIG.draft.color,
            LAYER_CONFIG.draft.color,
          ],
          "fill-opacity": 0.25,
        },
      });

      // Polygon outline layer
      map.addLayer({
        id: POLYGON_OUTLINE_LAYER,
        type: "line",
        source: SOURCE_ID,
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: {
          "line-color": [
            "match",
            ["get", "layer"],
            "park", LAYER_CONFIG.park.color,
            "facilities", LAYER_CONFIG.facilities.color,
            "draft", LAYER_CONFIG.draft.color,
            LAYER_CONFIG.draft.color,
          ],
          "line-width": 2,
          "line-dasharray": [2, 1],
        },
      });

      // Line layer
      map.addLayer({
        id: LINE_LAYER,
        type: "line",
        source: SOURCE_ID,
        filter: [
          "all",
          ["==", ["geometry-type"], "LineString"],
          ["!=", ["get", "type"], "text"],
        ],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": [
            "match",
            ["get", "layer"],
            "park", LAYER_CONFIG.park.color,
            "facilities", LAYER_CONFIG.facilities.color,
            "draft", LAYER_CONFIG.draft.color,
            LAYER_CONFIG.draft.color,
          ],
          "line-width": 3,
        },
      });

      // Point layer (non-text, non-facility)
      map.addLayer({
        id: POINT_LAYER,
        type: "circle",
        source: SOURCE_ID,
        filter: [
          "all",
          ["==", ["geometry-type"], "Point"],
          ["!=", ["get", "type"], "text"],
          ["!=", ["get", "layer"], "facilities"],
        ],
        paint: {
          "circle-radius": ["coalesce", ["get", "size"], 8],
          "circle-color": [
            "match",
            ["get", "layer"],
            "park", LAYER_CONFIG.park.color,
            "draft", LAYER_CONFIG.draft.color,
            LAYER_CONFIG.draft.color,
          ],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });

      // Facility point layer (pin marker icon)
      loadFacilityPinImages(map).then(() => {
        if (!map.getLayer(FACILITY_POINT_LAYER)) {
          map.addLayer({
            id: FACILITY_POINT_LAYER,
            type: "symbol",
            source: SOURCE_ID,
            filter: [
              "all",
              ["==", ["geometry-type"], "Point"],
              ["!=", ["get", "type"], "text"],
              ["==", ["get", "layer"], "facilities"],
            ],
            layout: {
              "icon-image": "facility-pin-default",
              "icon-size": 1.0,
              "icon-anchor": "bottom",
              "icon-allow-overlap": true,
            },
          });
        }
      });

      // Text layer - show labels for point features that have a label (excluding facility points)
      map.addLayer({
        id: TEXT_LAYER,
        type: "symbol",
        source: SOURCE_ID,
        filter: [
          "all",
          ["==", ["geometry-type"], "Point"],
          ["has", "label"],
          ["!=", ["get", "label"], ""],
          ["!=", ["get", "layer"], "facilities"],
        ],
        layout: {
          "text-field": ["get", "label"],
          "text-size": [
            "match", ["get", "layer"],
            "park", ["coalesce", ["get", "size"], 18],
            "facilities", ["coalesce", ["get", "size"], 12],
            ["coalesce", ["get", "size"], 14],
          ],
          "text-anchor": "center",
          "text-allow-overlap": true,
        },
        paint: {
          "text-color": "#1a1a1a",
          "text-halo-color": "#ffffff",
          "text-halo-width": 2,
        },
      });

      // Text layer for line labels
      map.addLayer({
        id: TEXT_LAYER + "-lines",
        type: "symbol",
        source: SOURCE_ID,
        filter: [
          "all",
          ["==", ["geometry-type"], "LineString"],
          ["has", "label"],
          ["!=", ["get", "label"], ""],
        ],
        layout: {
          "text-field": ["get", "label"],
          "text-size": [
            "match", ["get", "layer"],
            "park", 14,
            "facilities", 11,
            11,
          ],
          "symbol-placement": "line-center",
          "text-allow-overlap": false,
          "text-anchor": "center",
          "text-offset": [0, -1],
        },
        paint: {
          "text-color": "#1a1a1a",
          "text-halo-color": "#ffffff",
          "text-halo-width": 2,
        },
      });

      // Text layer for polygon labels (placed at centroid via point placement)
      map.addLayer({
        id: TEXT_LAYER + "-polygons",
        type: "symbol",
        source: SOURCE_ID,
        filter: [
          "all",
          ["==", ["geometry-type"], "Polygon"],
          ["has", "label"],
          ["!=", ["get", "label"], ""],
        ],
        layout: {
          "text-field": ["get", "label"],
          "text-size": [
            "match", ["get", "layer"],
            "park", 16,
            "facilities", 12,
            12,
          ],
          "symbol-placement": "point",
          "text-allow-overlap": false,
          "text-anchor": "center",
        },
        paint: {
          "text-color": "#1a1a1a",
          "text-halo-color": "#ffffff",
          "text-halo-width": 2,
        },
      });

      // ─── Selected feature highlight layers ─────────────────
      map.addLayer({
        id: SELECTED_FILL_LAYER,
        type: "fill",
        source: SOURCE_ID,
        filter: ["==", ["get", "id"], ""],
        paint: {
          "fill-color": "#3d6b4f",
          "fill-opacity": 0.4,
        },
      });

      map.addLayer({
        id: SELECTED_OUTLINE_LAYER,
        type: "line",
        source: SOURCE_ID,
        filter: ["==", ["get", "id"], ""],
        paint: {
          "line-color": "#2d4a3a",
          "line-width": 3,
        },
      });

      map.addLayer({
        id: SELECTED_POINT_LAYER,
        type: "circle",
        source: SOURCE_ID,
        filter: [
          "all",
          ["==", ["get", "id"], ""],
          ["!=", ["get", "layer"], "facilities"],
        ],
        paint: {
          "circle-radius": 10,
          "circle-color": "#3d6b4f",
          "circle-stroke-width": 3,
          "circle-stroke-color": "#ffffff",
        },
      });

      // Selected facility point layer (pin marker icon - selected state)
      // This layer will be activated after facility pin images are loaded
      loadFacilityPinImages(map).then(() => {
        if (!map.getLayer(SELECTED_FACILITY_POINT_LAYER)) {
          map.addLayer({
            id: SELECTED_FACILITY_POINT_LAYER,
            type: "symbol",
            source: SOURCE_ID,
            filter: ["==", ["get", "id"], ""],
            layout: {
              "icon-image": "facility-pin-selected",
              "icon-size": 1.15,
              "icon-anchor": "bottom",
              "icon-allow-overlap": true,
            },
          });
        }
      });
    }

    // Add measurement source
    if (!map.getSource(MEASUREMENT_SOURCE_ID)) {
      map.addSource(MEASUREMENT_SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: MEASUREMENT_FILL_LAYER,
        type: "fill",
        source: MEASUREMENT_SOURCE_ID,
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: {
          "fill-color": "#f59e0b",
          "fill-opacity": 0.15,
        },
      });

      map.addLayer({
        id: MEASUREMENT_LINE_LAYER,
        type: "line",
        source: MEASUREMENT_SOURCE_ID,
        filter: ["==", ["geometry-type"], "LineString"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#f59e0b",
          "line-width": 2,
          "line-dasharray": [4, 2],
        },
      });

      map.addLayer({
        id: MEASUREMENT_POINT_LAYER,
        type: "circle",
        source: MEASUREMENT_SOURCE_ID,
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 5,
          "circle-color": "#f59e0b",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });
    }

    // Add multi-draw preview source (shows accumulated parts during multi-part drawing)
    if (!map.getSource(MULTI_DRAW_SOURCE_ID)) {
      map.addSource(MULTI_DRAW_SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: MULTI_DRAW_FILL_LAYER,
        type: "fill",
        source: MULTI_DRAW_SOURCE_ID,
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: {
          "fill-color": "#4a7c59",
          "fill-opacity": 0.2,
        },
      });

      map.addLayer({
        id: MULTI_DRAW_LINE_LAYER,
        type: "line",
        source: MULTI_DRAW_SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#4a7c59",
          "line-width": 2.5,
          "line-dasharray": [4, 3],
        },
      });

      map.addLayer({
        id: MULTI_DRAW_POINT_LAYER,
        type: "circle",
        source: MULTI_DRAW_SOURCE_ID,
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 4,
          "circle-color": "#4a7c59",
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#ffffff",
        },
      });
    }

    // Add selected parts source and layers (park mode part selection)
    if (!map.getSource(SELECTED_PARTS_SOURCE_ID)) {
      map.addSource(SELECTED_PARTS_SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: SELECTED_PARTS_FILL_LAYER,
        type: "fill",
        source: SELECTED_PARTS_SOURCE_ID,
        paint: {
          "fill-color": "#f59e0b",
          "fill-opacity": 0.45,
        },
      });

      map.addLayer({
        id: SELECTED_PARTS_OUTLINE_LAYER,
        type: "line",
        source: SELECTED_PARTS_SOURCE_ID,
        paint: {
          "line-color": "#d97706",
          "line-width": 3,
        },
      });
    }
  }, [mapLoaded]);

  // ─── Update GeoJSON data when features change ─────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (source) {
      // Add feature id to properties for filter matching
      const dataWithIds: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: visibleFeatures.features.map((f) => ({
          type: "Feature" as const,
          geometry: f.geometry,
          properties: { ...f.properties, id: f.id },
        })),
      };
      source.setData(dataWithIds);
    }
  }, [visibleFeatures, mapLoaded]);

  // ─── Update park background data (facility mode context) ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const source = map.getSource(PARK_BACKGROUND_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (source) {
      if (backgroundParkBoundary && backgroundParkBoundary.features.length > 0) {
        const data: GeoJSON.FeatureCollection = {
          type: "FeatureCollection",
          features: backgroundParkBoundary.features.map((f) => ({
            type: "Feature" as const,
            geometry: f.geometry,
            properties: { ...f.properties },
          })),
        };
        source.setData(data);
      } else {
        source.setData({ type: "FeatureCollection", features: [] });
      }
    }
  }, [backgroundParkBoundary, mapLoaded]);

  // ─── Update selection highlight ───────────────────────────
  const selectedPartIndices = editor.state.selectedPartIndices;

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    // When parts are selected, suppress the default feature-level highlight
    // so that only the part-level highlight is shown.
    const hasPartSelection = selectedPartIndices.length > 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filter: any =
      selectedFeatureIds.length > 0 && !hasPartSelection
        ? ["in", ["get", "id"], ["literal", selectedFeatureIds]]
        : ["==", ["get", "id"], ""];

    // Exclude facility points from the circle-based selected point layer
    // (facility points use their own pin-marker selected layer instead).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const selectedPointFilter: any =
      selectedFeatureIds.length > 0 && !hasPartSelection
        ? [
            "all",
            ["in", ["get", "id"], ["literal", selectedFeatureIds]],
            ["!=", ["get", "layer"], "facilities"],
          ]
        : ["==", ["get", "id"], ""];

    // Build a facility-only filter for the selected facility pin layer
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const facilityFilter: any =
      selectedFeatureIds.length > 0 && !hasPartSelection
        ? [
            "all",
            ["in", ["get", "id"], ["literal", selectedFeatureIds]],
            ["==", ["get", "layer"], "facilities"],
          ]
        : ["==", ["get", "id"], ""];

    // Hide the default facility pin for selected features so only the
    // selected pin is visible (prevents the default pin peeking through).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const facilityDefaultFilter: any =
      selectedFeatureIds.length > 0 && !hasPartSelection
        ? [
            "all",
            ["==", ["geometry-type"], "Point"],
            ["!=", ["get", "type"], "text"],
            ["==", ["get", "layer"], "facilities"],
            ["!", ["in", ["get", "id"], ["literal", selectedFeatureIds]]],
          ]
        : [
            "all",
            ["==", ["geometry-type"], "Point"],
            ["!=", ["get", "type"], "text"],
            ["==", ["get", "layer"], "facilities"],
          ];

    try {
      map.setFilter(SELECTED_FILL_LAYER, filter);
      map.setFilter(SELECTED_OUTLINE_LAYER, filter);
      map.setFilter(SELECTED_POINT_LAYER, selectedPointFilter);
      if (map.getLayer(SELECTED_FACILITY_POINT_LAYER)) {
        map.setFilter(SELECTED_FACILITY_POINT_LAYER, facilityFilter);
      }
      if (map.getLayer(FACILITY_POINT_LAYER)) {
        map.setFilter(FACILITY_POINT_LAYER, facilityDefaultFilter);
      }
    } catch {
      // Layers may not exist yet
    }
  }, [selectedFeatureIds, selectedPartIndices, mapLoaded]);

  // ─── Update selected parts highlight (park mode) ──────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const source = map.getSource(SELECTED_PARTS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    if (selectedPartIndices.length === 0 || selectedFeatureIds.length !== 1) {
      source.setData({ type: "FeatureCollection", features: [] });
      return;
    }

    const featureId = selectedFeatureIds[0];
    const feature = features.features.find((f) => f.id === featureId);
    if (!feature || feature.geometry.type !== "MultiPolygon") {
      source.setData({ type: "FeatureCollection", features: [] });
      return;
    }

    const allParts = (feature.geometry as import("geojson").MultiPolygon).coordinates;
    const partFeatures: GeoJSON.Feature[] = selectedPartIndices
      .filter((i) => i >= 0 && i < allParts.length)
      .map((i) => ({
        type: "Feature" as const,
        geometry: { type: "Polygon" as const, coordinates: allParts[i] },
        properties: { partIndex: i },
      }));

    source.setData({ type: "FeatureCollection", features: partFeatures });
  }, [selectedPartIndices, selectedFeatureIds, features, mapLoaded]);

  // ─── Update measurement visualization ─────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const source = map.getSource(MEASUREMENT_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    if (!measurementState || measurementState.points.length === 0) {
      source.setData({ type: "FeatureCollection", features: [] });
      return;
    }

    const features: GeoJSON.Feature[] = [];

    // Add point markers
    for (const point of measurementState.points) {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: point },
        properties: {},
      });
    }

    // Add line connecting points
    if (measurementState.points.length >= 2) {
      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: measurementState.points,
        },
        properties: {},
      });
    }

    // Add polygon fill for area measurement
    if (
      measurementState.mode === "area" &&
      measurementState.points.length >= 3
    ) {
      features.push({
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [...measurementState.points, measurementState.points[0]],
          ],
        },
        properties: {},
      });
    }

    source.setData({ type: "FeatureCollection", features });
  }, [measurementState, mapLoaded]);

  // ─── Update multi-draw preview when drawing parts change ───
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const source = map.getSource(MULTI_DRAW_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    const { drawingParts, drawingPartsType } = editor.state;

    if (!drawingParts || !drawingPartsType || drawingParts.length === 0) {
      source.setData({ type: "FeatureCollection", features: [] });
      return;
    }

    const previewFeatures: GeoJSON.Feature[] = [];

    if (drawingPartsType === "line") {
      const lineParts = drawingParts as Position[][];
      for (const part of lineParts) {
        previewFeatures.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: part },
          properties: {},
        });
        // Add vertex markers at each endpoint
        previewFeatures.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: part[0] },
          properties: {},
        });
        previewFeatures.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: part[part.length - 1] },
          properties: {},
        });
      }
    } else {
      const polygonParts = drawingParts as Position[][][];
      for (const part of polygonParts) {
        previewFeatures.push({
          type: "Feature",
          geometry: { type: "Polygon", coordinates: part },
          properties: {},
        });
      }
    }

    source.setData({ type: "FeatureCollection", features: previewFeatures });
  }, [editor.state.drawingParts, editor.state.drawingPartsType, mapLoaded]);

  // ─── Mouse move handler for cursor coords ─────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const handleMouseMove = (e: maplibregl.MapMouseEvent) => {
      editor.setCursor([e.lngLat.lng, e.lngLat.lat]);
    };

    map.on("mousemove", handleMouseMove);
    return () => {
      map.off("mousemove", handleMouseMove);
    };
  }, [editor]);

  // ─── Click handler for feature selection and measurement ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const handleClick = (e: maplibregl.MapMouseEvent) => {
      // Skip click if in continue drawing mode — that hook manages its own clicks
      if (activeTool === "continue_drawing") return;

      // Skip click if we just finished a drag
      if (justDraggedRef.current) return;

      // Skip click if a feature was just created (the finishing
      // double-click can propagate as a map click and deselect).
      if (
        justCreatedFeatureRef.current > 0 &&
        Date.now() - justCreatedFeatureRef.current < 300
      ) {
        justCreatedFeatureRef.current = 0;
        return;
      }

      const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat];

      // ── draw_polygon first click: start custom drawing session ──
      if (activeTool === "draw_polygon" && !editor.state.continueDrawingState) {
        e.preventDefault();
        const cursorPos: Position = [lngLat[0], lngLat[1]];
        const allFeats = visibleFeatures; // ParkFeatureCollection prop

        if (snappingEnabled && map) {
          const project: ProjectFn = (pos) => {
            const p = map.project(pos);
            return { x: p.x, y: p.y };
          };

          // Try vertex snap first (with priority)
          const vertexResult = findNearestVertex(cursorPos, allFeats, project, SNAP_THRESHOLD_PX);
          const edgeResult = findNearestEdge(cursorPos, allFeats, project, SNAP_THRESHOLD_PX);

          const VERTEX_PRIORITY_PX = 3;

          if (vertexResult.snapped && (!edgeResult.snapped || vertexResult.distancePx <= edgeResult.distancePx + VERTEX_PRIORITY_PX)) {
            // Snapped to vertex — find full vertex info
            const vertexInfo = findVertexInfoInCollection(allFeats, vertexResult.snapped, vertexResult.featureId);
            if (vertexInfo) {
              editor.startContinueDrawing("vertex", vertexInfo, null, null);
              return;
            }
          }

          if (edgeResult.snapped && edgeResult.featureId && edgeResult.edgeStartIndex !== undefined && edgeResult.edgeT !== undefined) {
            // Snapped to edge
            const edgeInfo: EdgeAnchorInfo = {
              featureId: edgeResult.featureId,
              partIndex: edgeResult.partIndex ?? null,
              ringIndex: edgeResult.ringIndex ?? 0,
              edgeStartIndex: edgeResult.edgeStartIndex,
              position: edgeResult.snapped,
              edgeT: edgeResult.edgeT,
            };
            editor.startContinueDrawing("edge", null, edgeInfo, null);
            return;
          }
        }

        // No snap — start from empty space
        editor.startContinueDrawing("free", null, null, cursorPos);
        return;
      }

      // Handle measurement clicks
      if (
        activeTool === "measure_distance" ||
        activeTool === "measure_area"
      ) {
        // The measurement hook handles this via the editor
        // We emit a custom event that the page can listen to
        const event = new CustomEvent("map:measurement-click", {
          detail: { lngLat },
        });
        window.dispatchEvent(event);
        return;
      }

      // Handle coordinate input
      if (activeTool === "coordinate_input") return;

      // In vertex edit mode, clicking empty space (not on vertex/midpoint handles)
      // exits vertex edit. The vertex edit hook handles clicks on its own handles.
      if (activeTool === "vertex_edit") {
        const map = mapRef.current;
        if (map) {
          const vertexHits = map.queryRenderedFeatures(e.point, {
            layers: [
              VERTEX_EDIT_VERTEX_LAYER,
              VERTEX_EDIT_SELECTED_VERTEX_LAYER,
              VERTEX_EDIT_MIDPOINT_LAYER,
            ].filter((layerId) => {
              try { return !!map.getLayer(layerId); } catch { return false; }
            }),
          });
          // If no vertex/midpoint hit, exit vertex edit
          if (vertexHits.length === 0) {
            editor.exitVertexEdit();
          }
        }
        return;
      }

      // Shift+click multi-select while in draw_point mode
      if (activeTool === "draw_point" && e.originalEvent.shiftKey) {
        const queryLayers = [
          POLYGON_FILL_LAYER,
          LINE_LAYER,
          POINT_LAYER,
          FACILITY_POINT_LAYER,
          SELECTED_FACILITY_POINT_LAYER,
          TEXT_LAYER,
        ].filter((id) => { try { return !!map.getLayer(id); } catch { return false; } });
        const hitFeatures = map.queryRenderedFeatures(e.point, {
          layers: queryLayers,
        });
        if (hitFeatures.length > 0) {
          const featureId = hitFeatures[0].properties?.id;
          if (featureId) {
            // Suppress the point that MapboxDraw will create from this click
            suppressNextCreateRef.current = true;
            // Toggle feature in/out of selection
            const currentIds = [...selectedFeatureIds];
            const idx = currentIds.indexOf(featureId);
            if (idx >= 0) {
              currentIds.splice(idx, 1);
            } else {
              currentIds.push(featureId);
            }
            editor.selectFeatures(currentIds);
            return;
          }
        }
        // No feature under cursor with shift held — let MapboxDraw
        // place a point as normal (fall through).
        return;
      }

      // Merge parts mode: click to toggle parts
      if (activeTool === "merge_parts") {
        const queryLayers = [POLYGON_FILL_LAYER];
        const hitFeatures = map.queryRenderedFeatures(e.point, { layers: queryLayers });
        if (hitFeatures.length > 0) {
          const featureId = hitFeatures[0].properties?.id;
          if (featureId) {
            const parkFeature = visibleFeatures.features.find((f) => f.id === featureId);
            if (parkFeature && parkFeature.geometry.type === "MultiPolygon") {
              const clickPoint = turfPoint([e.lngLat.lng, e.lngLat.lat]);
              const parts = parkFeature.geometry.coordinates as Position[][][];
              let clickedPartIndex = -1;
              for (let i = 0; i < parts.length; i++) {
                try {
                  const poly = turfPolygon(parts[i]);
                  if (booleanPointInPolygon(clickPoint, poly)) {
                    clickedPartIndex = i;
                    break;
                  }
                } catch {
                  // Invalid polygon part, skip
                }
              }
              if (clickedPartIndex >= 0) {
                const currentParts = [...editor.state.selectedPartIndices];
                const pidx = currentParts.indexOf(clickedPartIndex);
                if (pidx >= 0) {
                  currentParts.splice(pidx, 1);
                } else {
                  currentParts.push(clickedPartIndex);
                }
                editor.selectParts(featureId, currentParts);
              }
            }
          }
        }
        return;
      }

      // Feature selection (only in select mode)
      if (activeTool !== "select") return;

      const queryLayers = [
        POLYGON_FILL_LAYER,
        LINE_LAYER,
        POINT_LAYER,
        FACILITY_POINT_LAYER,
        SELECTED_FACILITY_POINT_LAYER,
        TEXT_LAYER,
      ].filter((id) => { try { return !!map.getLayer(id); } catch { return false; } });

      const features = map.queryRenderedFeatures(e.point, {
        layers: queryLayers,
      });

      if (features.length > 0) {
        const featureId = features[0].properties?.id;
        if (featureId) {
          // Multi-select with Shift key
          if (e.originalEvent.shiftKey) {
            const currentIds = [...selectedFeatureIds];
            const idx = currentIds.indexOf(featureId);
            if (idx >= 0) {
              currentIds.splice(idx, 1);
            } else {
              currentIds.push(featureId);
            }
            editor.selectFeatures(currentIds);
          } else {
            editor.selectFeatures([featureId]);
          }
        }
      } else {
        // Click on empty space -> deselect
        editor.selectFeatures([]);
      }
    };

    map.on("click", handleClick);
    return () => {
      map.off("click", handleClick);
    };
  }, [
    mapLoaded,
    activeTool,
    selectedFeatureIds,
    editor,
    isParkMode,
    visibleFeatures,
    snappingEnabled,
    features,
  ]);

  // ─── Double-click handler for vertex edit ───────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const handleDblClick = (e: maplibregl.MapMouseEvent) => {
      // Only enter vertex edit from select mode
      if (activeTool !== "select") return;

      // Check if we double-clicked on a polygon or line
      const queryLayers = [POLYGON_FILL_LAYER, LINE_LAYER];
      const hitFeatures = map.queryRenderedFeatures(e.point, {
        layers: queryLayers,
      });

      if (hitFeatures.length > 0) {
        const featureId = hitFeatures[0].properties?.id;
        if (featureId) {
          const parkFeature = features.features.find((f) => f.id === featureId);
          if (!parkFeature) return;

          const geomType = parkFeature.geometry.type;

          if (geomType === "Polygon" || geomType === "LineString") {
            e.preventDefault();
            editor.enterVertexEdit(featureId);
          } else if (geomType === "MultiPolygon") {
            e.preventDefault();
            // Determine which part was clicked using point-in-polygon test
            const clickPoint = turfPoint([e.lngLat.lng, e.lngLat.lat]);
            const parts = parkFeature.geometry.coordinates as Position[][][];
            let clickedPartIndex = 0; // Default to first part
            for (let i = 0; i < parts.length; i++) {
              try {
                const poly = turfPolygon(parts[i]);
                if (booleanPointInPolygon(clickPoint, poly)) {
                  clickedPartIndex = i;
                  break;
                }
              } catch {
                // Invalid polygon part, skip
              }
            }
            editor.enterVertexEdit(featureId, clickedPartIndex);
          } else if (geomType === "MultiLineString") {
            e.preventDefault();
            // Determine which part was clicked by finding nearest line part
            const clickLngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat];
            const parts = parkFeature.geometry.coordinates as Position[][];
            let closestPartIndex = 0;
            let closestDist = Infinity;
            for (let i = 0; i < parts.length; i++) {
              const line = parts[i];
              for (let j = 0; j < line.length - 1; j++) {
                const dist = pointToSegmentDistance(clickLngLat, line[j] as [number, number], line[j + 1] as [number, number]);
                if (dist < closestDist) {
                  closestDist = dist;
                  closestPartIndex = i;
                }
              }
            }
            editor.enterVertexEdit(featureId, closestPartIndex);
          }
        }
      }
    };

    map.on("dblclick", handleDblClick);
    return () => {
      map.off("dblclick", handleDblClick);
    };
  }, [mapLoaded, activeTool, features.features, editor]);

  // ─── Cursor style based on tool ───────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const canvas = map.getCanvasContainer();
    switch (activeTool) {
      case "draw_point":
      case "coordinate_input":
        canvas.style.cursor = "crosshair";
        break;
      case "draw_line":
      case "draw_polygon":
      case "draw_clip_polygon":
      case "measure_distance":
      case "measure_area":
        canvas.style.cursor = "crosshair";
        break;
      case "pan":
        canvas.style.cursor = "grab";
        break;
      case "move":
        canvas.style.cursor = "move";
        break;
      case "vertex_edit":
      case "continue_drawing":
        canvas.style.cursor = "crosshair";
        break;
      case "merge_parts":
        canvas.style.cursor = "pointer";
        break;
      default:
        canvas.style.cursor = "";
        break;
    }
  }, [activeTool]);

  // ─── Expand selection to include park children for moves ────
  const effectiveMoveIds = useMemo(() => {
    const ids = new Set(selectedFeatureIds);
    for (const id of selectedFeatureIds) {
      const f = features.features.find((feat) => feat.id === id);
      // If this is a park-defining feature, include all its children
      if (f?.properties.layer === "park" && !f.properties.parkId) {
        for (const child of features.features) {
          if (child.properties.parkId === id) {
            ids.add(child.id);
          }
        }
      }
    }
    return ids;
  }, [selectedFeatureIds, features.features]);

  // ─── Drag-to-move selected features ─────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const queryLayers = [
      POLYGON_FILL_LAYER,
      LINE_LAYER,
      POINT_LAYER,
      FACILITY_POINT_LAYER,
      SELECTED_FACILITY_POINT_LAYER,
      TEXT_LAYER,
    ].filter((id) => { try { return !!map.getLayer(id); } catch { return false; } });

    const handleMouseDown = (e: maplibregl.MapMouseEvent) => {
      // Only in select mode with a selection (not during vertex edit)
      if (activeTool !== "select" || selectedFeatureIds.length === 0) return;

      // Check if clicking on a selected feature
      const queriedFeatures = map.queryRenderedFeatures(e.point, {
        layers: queryLayers,
      });

      if (queriedFeatures.length === 0) return;

      const clickedId = queriedFeatures[0].properties?.id;
      if (!clickedId || !selectedFeatureIds.includes(clickedId)) return;

      // Find the actual park feature
      const parkFeature = features.features.find((f) => f.id === clickedId);
      if (!parkFeature) return;

      // Start drag
      e.preventDefault();
      map.dragPan.disable();

      dragStateRef.current = {
        isDragging: true,
        featureId: clickedId,
        startLngLat: [e.lngLat.lng, e.lngLat.lat],
        originalFeature: JSON.parse(JSON.stringify(parkFeature)),
      };

      const canvas = map.getCanvasContainer();
      canvas.style.cursor = "grabbing";
    };

    const handleMouseMove = (e: maplibregl.MapMouseEvent) => {
      const drag = dragStateRef.current;
      if (!drag || !drag.isDragging) {
        // Show grab cursor when hovering over a selected feature in select mode
        if (activeTool === "select" && selectedFeatureIds.length > 0) {
          const hoveredFeatures = map.queryRenderedFeatures(e.point, {
            layers: queryLayers,
          });
          const canvas = map.getCanvasContainer();
          if (
            hoveredFeatures.length > 0 &&
            selectedFeatureIds.includes(hoveredFeatures[0].properties?.id)
          ) {
            canvas.style.cursor = "grab";
          } else {
            canvas.style.cursor = "";
          }
        }
        return;
      }

      const deltaLng = e.lngLat.lng - drag.startLngLat[0];
      const deltaLat = e.lngLat.lat - drag.startLngLat[1];

      // Move all selected features + park children by the delta (live preview)
      // Update the source data directly for smooth visual feedback
      const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (source) {
        const updatedFeatures = visibleFeatures.features.map((f) => {
          if (effectiveMoveIds.has(f.id)) {
            const originalFromState = features.features.find((of) => of.id === f.id);
            if (originalFromState) {
              const moved = translateFeatureGeometry(originalFromState, deltaLng, deltaLat);
              return {
                type: "Feature" as const,
                geometry: moved.geometry,
                properties: { ...moved.properties, id: moved.id },
              };
            }
          }
          return {
            type: "Feature" as const,
            geometry: f.geometry,
            properties: { ...f.properties, id: f.id },
          };
        });

        source.setData({
          type: "FeatureCollection",
          features: updatedFeatures,
        });
      }
    };

    const handleMouseUp = (e: maplibregl.MapMouseEvent) => {
      const drag = dragStateRef.current;
      if (!drag || !drag.isDragging) return;

      const deltaLng = e.lngLat.lng - drag.startLngLat[0];
      const deltaLat = e.lngLat.lat - drag.startLngLat[1];

      // Re-enable map panning
      map.dragPan.enable();
      const canvas = map.getCanvasContainer();
      canvas.style.cursor = "";

      // Only commit if actually moved
      const didMove = Math.abs(deltaLng) > 0.0000001 || Math.abs(deltaLat) > 0.0000001;
      if (didMove) {
        // Update all selected features + park children with final positions
        for (const fId of effectiveMoveIds) {
          const original = features.features.find((f) => f.id === fId);
          if (original) {
            const moved = translateFeatureGeometry(original, deltaLng, deltaLat);
            editor.updateFeature(moved);
          }
        }
        // Prevent click from firing and deselecting
        justDraggedRef.current = true;
        setTimeout(() => { justDraggedRef.current = false; }, 50);
      }

      dragStateRef.current = null;
    };

    map.on("mousedown", handleMouseDown);
    map.on("mousemove", handleMouseMove);
    map.on("mouseup", handleMouseUp);

    return () => {
      map.off("mousedown", handleMouseDown);
      map.off("mousemove", handleMouseMove);
      map.off("mouseup", handleMouseUp);
    };
  }, [mapLoaded, activeTool, selectedFeatureIds, effectiveMoveIds, features, visibleFeatures, editor]);

  // ─── Keyboard shortcuts ───────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      // Skip all handling if in continue drawing mode — that hook manages its own keys
      if (editor.state.continueDrawingState) {
        return;
      }

      // Backspace: remove last vertex during drawing
      if (e.key === "Backspace" && editor.state.isDrawing) {
        e.preventDefault();
        trashLastVertex();
        return;
      }

      // Enter: finish merge parts
      if (e.key === "Enter" && activeTool === "merge_parts" && editor.state.selectedPartIndices.length >= 2) {
        e.preventDefault();
        const featureId = editor.state.selectedFeatureIds[0];
        if (featureId) {
          editor.mergeParts(featureId, editor.state.selectedPartIndices);
          editor.setTool("select");
        }
        return;
      }

      // Enter: finish multi-part drawing
      if (e.key === "Enter" && editor.state.drawingParts && editor.state.drawingParts.length > 0) {
        e.preventDefault();
        editor.finishMultiDrawing();
        return;
      }

      // Escape: cancel merge parts / vertex edit / multi-draw / draw / deselect
      if (e.key === "Escape") {
        if (activeTool === "merge_parts") {
          editor.setTool("select");
          return;
        }
        if (editor.state.vertexEditFeatureId) {
          editor.exitVertexEdit();
        } else if (editor.state.drawingParts && editor.state.drawingParts.length > 0) {
          // If we have accumulated parts, finalize them (don't discard work)
          editor.finishMultiDrawing();
        } else if (editor.state.isDrawing) {
          editor.clearDrawingParts();
          editor.setTool("select");
        } else if (measurementState) {
          editor.setMeasurementState(null);
          editor.setLiveMeasurement(null);
          editor.setTool("select");
        } else {
          editor.selectFeatures([]);
        }
        return;
      }

      // Delete: delete selected (but not during vertex edit — vertex edit hook handles its own deletion)
      if (e.key === "Delete" && selectedFeatureIds.length > 0 && !editor.state.vertexEditFeatureId) {
        e.preventDefault();
        editor.deleteSelected();
        return;
      }

      // Ctrl/Cmd shortcuts
      if (e.metaKey || e.ctrlKey) {
        if (e.key === "z" && !e.shiftKey) {
          e.preventDefault();
          // During active drawing, undo removes the last vertex instead of state-level undo
          if (editor.state.isDrawing) {
            trashLastVertex();
          } else {
            editor.undo();
          }
          return;
        }
        if ((e.key === "z" && e.shiftKey) || e.key === "y") {
          e.preventDefault();
          editor.redo();
          return;
        }
        if (e.key === "d") {
          e.preventDefault();
          editor.duplicateSelected();
          return;
        }
      }

      // Tool shortcuts (single keys, only when not drawing)
      // Gated by allowedTools when provided
      if (!editor.state.isDrawing && !e.metaKey && !e.ctrlKey) {
        // Fly-to shortcut
        if (e.key.toLowerCase() === "f" && onFlyTo) {
          e.preventDefault();
          onFlyTo();
          return;
        }

        const SHORTCUT_MAP: Record<string, ToolMode> = {
          v: "select",
          h: "pan",
          p: "draw_point",
          l: "draw_line",
          g: "draw_polygon",
          m: "measure_distance",
          a: "measure_area",
        };

        const targetTool = SHORTCUT_MAP[e.key.toLowerCase()];
        if (targetTool) {
          // Only activate if tool is allowed in current mode (or no filter is set)
          if (!allowedTools || allowedTools.includes(targetTool)) {
            editor.setTool(targetTool);
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    editor,
    activeTool,
    selectedFeatureIds,
    measurementState,
    trashLastVertex,
    allowedTools,
    onFlyTo,
  ]);

  return (
    <div ref={containerRef} className="h-full w-full" />
  );
}
