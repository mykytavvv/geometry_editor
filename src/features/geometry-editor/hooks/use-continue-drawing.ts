"use client";

import { useEffect, useRef, useCallback } from "react";
import maplibregl from "maplibre-gl";
import type { Map as MaplibreMap, MapMouseEvent, GeoJSONSource } from "maplibre-gl";
import type { Position } from "geojson";
import type {
  ParkFeatureCollection,
  ContinueDrawingState,
  VertexAnchorInfo,
  EdgeAnchorInfo,
} from "../types";
import {
  CONTINUE_DRAW_SOURCE_ID,
  CONTINUE_DRAW_EXISTING_LINE_LAYER,
  CONTINUE_DRAW_NEW_LINE_LAYER,
  CONTINUE_DRAW_VERTEX_LAYER,
  CONTINUE_DRAW_RUBBERBAND_SOURCE_ID,
  CONTINUE_DRAW_RUBBERBAND_LAYER,
  CONTINUE_DRAW_SNAP_INDICATOR_LAYER,
  CONTINUE_DRAW_EDGE_HIGHLIGHT_LAYER,
  SNAP_THRESHOLD_PX,
} from "../constants";
import {
  findNearestVertex,
  findNearestEdge,
  type ProjectFn,
  type EdgeSnapResult,
} from "../lib/snapping";

// ─── Types ──────────────────────────────────────────────────

interface UseContinueDrawingProps {
  map: MaplibreMap | null;
  mapLoaded: boolean;
  /** The continue drawing state — null means inactive */
  continueDrawingState: ContinueDrawingState | null;
  /** All features for snapping */
  allFeatures: ParkFeatureCollection;
  snappingEnabled: boolean;
  /** Callback when a new vertex is placed */
  onAddVertex: (position: Position) => void;
  /** Callback to undo the last vertex */
  onUndoVertex: () => void;
  /** Callback to finish drawing — receives finish info */
  onFinish: (finishType: "vertex" | "edge" | "free", finishVertex: VertexAnchorInfo | null, finishEdge: EdgeAnchorInfo | null) => void;
  /** Callback to cancel drawing */
  onCancel: () => void;
}

// ─── Snap helper ────────────────────────────────────────────

interface SnapInfo {
  position: Position;
  snapType: "vertex" | "edge" | "none";
  featureId?: string;
  /** Vertex info if snapped to vertex */
  vertexInfo: VertexAnchorInfo | null;
  /** Edge info if snapped to edge */
  edgeInfo: EdgeAnchorInfo | null;
}

/**
 * Perform combined vertex + edge snapping for the drawing system.
 * Vertex snap is preferred when distances are close.
 */
function performSnap(
  cursorPos: Position,
  allFeatures: ParkFeatureCollection,
  map: MaplibreMap,
): SnapInfo {
  const project: ProjectFn = (lngLat) => {
    const p = map.project(lngLat);
    return { x: p.x, y: p.y };
  };

  // Try vertex snap first
  const vertexResult = findNearestVertex(
    cursorPos,
    allFeatures,
    project,
    SNAP_THRESHOLD_PX,
  );

  // Try edge snap
  const edgeResult: EdgeSnapResult = findNearestEdge(
    cursorPos,
    allFeatures,
    project,
    SNAP_THRESHOLD_PX,
  );

  // Vertex priority: prefer vertex if within 3px of edge distance
  const VERTEX_PRIORITY_PX = 3;

  if (vertexResult.snapped && edgeResult.snapped) {
    if (vertexResult.distancePx <= edgeResult.distancePx + VERTEX_PRIORITY_PX) {
      return buildVertexSnapInfo(
        { snapped: vertexResult.snapped, featureId: vertexResult.featureId, distancePx: vertexResult.distancePx },
        allFeatures,
      );
    }
    return buildEdgeSnapInfo(edgeResult);
  }

  if (vertexResult.snapped) {
    return buildVertexSnapInfo(
      { snapped: vertexResult.snapped, featureId: vertexResult.featureId, distancePx: vertexResult.distancePx },
      allFeatures,
    );
  }

  if (edgeResult.snapped) {
    return buildEdgeSnapInfo(edgeResult);
  }

  return {
    position: cursorPos,
    snapType: "none",
    vertexInfo: null,
    edgeInfo: null,
  };
}

function buildVertexSnapInfo(
  result: { snapped: Position; featureId?: string; distancePx: number },
  allFeatures: ParkFeatureCollection,
): SnapInfo {
  // We need to find the exact vertex index in the feature
  const feature = allFeatures.features.find((f) => f.id === result.featureId);
  let vertexInfo: VertexAnchorInfo | null = null;

  if (feature && result.snapped) {
    vertexInfo = findVertexInFeature(feature, result.snapped);
  }

  return {
    position: result.snapped!,
    snapType: "vertex",
    featureId: result.featureId,
    vertexInfo,
    edgeInfo: null,
  };
}

function buildEdgeSnapInfo(result: EdgeSnapResult): SnapInfo {
  let edgeInfo: EdgeAnchorInfo | null = null;

  if (result.snapped && result.featureId && result.edgeStartIndex !== undefined && result.edgeT !== undefined) {
    edgeInfo = {
      featureId: result.featureId,
      partIndex: result.partIndex ?? null,
      ringIndex: result.ringIndex ?? 0,
      edgeStartIndex: result.edgeStartIndex,
      position: result.snapped,
      edgeT: result.edgeT,
    };
  }

  return {
    position: result.snapped!,
    snapType: "edge",
    featureId: result.featureId,
    vertexInfo: null,
    edgeInfo,
  };
}

/**
 * Find the vertex index info for a position that exactly matches a vertex in a feature.
 */
function findVertexInFeature(
  feature: import("../types").ParkFeature,
  position: Position,
): VertexAnchorInfo | null {
  const geom = feature.geometry;

  const match = (v: Position) => v[0] === position[0] && v[1] === position[1];

  switch (geom.type) {
    case "Point":
      if (match(geom.coordinates)) {
        return { featureId: feature.id, partIndex: null, ringIndex: 0, vertexIndex: 0, position };
      }
      break;
    case "LineString":
      for (let i = 0; i < geom.coordinates.length; i++) {
        if (match(geom.coordinates[i])) {
          return { featureId: feature.id, partIndex: null, ringIndex: 0, vertexIndex: i, position };
        }
      }
      break;
    case "MultiLineString":
      for (let p = 0; p < geom.coordinates.length; p++) {
        for (let i = 0; i < geom.coordinates[p].length; i++) {
          if (match(geom.coordinates[p][i])) {
            return { featureId: feature.id, partIndex: p, ringIndex: 0, vertexIndex: i, position };
          }
        }
      }
      break;
    case "Polygon":
      for (let r = 0; r < geom.coordinates.length; r++) {
        const ring = geom.coordinates[r];
        // Skip closing vertex
        for (let i = 0; i < ring.length - 1; i++) {
          if (match(ring[i])) {
            return { featureId: feature.id, partIndex: null, ringIndex: r, vertexIndex: i, position };
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
              return { featureId: feature.id, partIndex: p, ringIndex: r, vertexIndex: i, position };
            }
          }
        }
      }
      break;
  }
  return null;
}

// ─── Overlay builder ────────────────────────────────────────

function buildOverlayData(cds: ContinueDrawingState) {
  const features: GeoJSON.Feature[] = [];

  // Get the anchor position
  const anchor = getAnchorPosition(cds);
  if (!anchor) return { type: "FeatureCollection" as const, features };

  // 1. New path drawn so far
  if (cds.newVertices.length > 0) {
    const newPath = [anchor, ...cds.newVertices];
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: newPath },
      properties: { role: "new" },
    });
  }

  // 2. Vertex handles for new vertices
  for (let i = 0; i < cds.newVertices.length; i++) {
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: cds.newVertices[i] },
      properties: { role: "vertex", index: i },
    });
  }

  // 3. Anchor point (highlight)
  features.push({
    type: "Feature",
    geometry: { type: "Point", coordinates: anchor },
    properties: { role: "anchor" },
  });

  return { type: "FeatureCollection" as const, features };
}

function getAnchorPosition(cds: ContinueDrawingState): Position | null {
  switch (cds.anchorType) {
    case "vertex":
      return cds.anchorVertex?.position ?? null;
    case "edge":
      return cds.anchorEdge?.position ?? null;
    case "free":
      return cds.anchorPosition ?? null;
  }
}

// ─── Layer cleanup ──────────────────────────────────────────

function cleanupLayers(map: MaplibreMap) {
  const layers = [
    CONTINUE_DRAW_EDGE_HIGHLIGHT_LAYER,
    CONTINUE_DRAW_SNAP_INDICATOR_LAYER,
    CONTINUE_DRAW_RUBBERBAND_LAYER,
    CONTINUE_DRAW_VERTEX_LAYER,
    CONTINUE_DRAW_NEW_LINE_LAYER,
    CONTINUE_DRAW_EXISTING_LINE_LAYER,
  ];
  for (const layerId of layers) {
    try {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
    } catch { /* ignore */ }
  }
  for (const sourceId of [CONTINUE_DRAW_SOURCE_ID, CONTINUE_DRAW_RUBBERBAND_SOURCE_ID]) {
    try {
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    } catch { /* ignore */ }
  }
}

// ─── Hook ───────────────────────────────────────────────────

export function useContinueDrawing({
  map,
  mapLoaded,
  continueDrawingState,
  allFeatures,
  snappingEnabled,
  onAddVertex,
  onUndoVertex,
  onFinish,
  onCancel,
}: UseContinueDrawingProps) {
  const isActive = continueDrawingState !== null;
  const isActiveRef = useRef(false);
  isActiveRef.current = isActive;

  const cdsRef = useRef(continueDrawingState);
  cdsRef.current = continueDrawingState;
  const allFeaturesRef = useRef(allFeatures);
  allFeaturesRef.current = allFeatures;
  const snappingEnabledRef = useRef(snappingEnabled);
  snappingEnabledRef.current = snappingEnabled;

  const onAddVertexRef = useRef(onAddVertex);
  onAddVertexRef.current = onAddVertex;
  const onUndoVertexRef = useRef(onUndoVertex);
  onUndoVertexRef.current = onUndoVertex;
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  // Track current snap state for click handler
  const currentSnapRef = useRef<SnapInfo | null>(null);

  // ─── Setup / update layers ────────────────────────────
  useEffect(() => {
    if (!map || !mapLoaded) return;

    if (!isActive || !continueDrawingState) {
      cleanupLayers(map);
      return;
    }

    const data = buildOverlayData(continueDrawingState);

    // ── Create or update main source ──
    const source = map.getSource(CONTINUE_DRAW_SOURCE_ID) as GeoJSONSource | undefined;
    if (source) {
      source.setData(data);
    } else {
      map.addSource(CONTINUE_DRAW_SOURCE_ID, {
        type: "geojson",
        data,
      });

      // Existing geometry outline (dimmed) - not used in new system but keep layer for consistency
      map.addLayer({
        id: CONTINUE_DRAW_EXISTING_LINE_LAYER,
        type: "line",
        source: CONTINUE_DRAW_SOURCE_ID,
        filter: ["==", ["get", "role"], "existing"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#f59e0b",
          "line-width": 2,
          "line-opacity": 0.4,
          "line-dasharray": [3, 2],
        },
      });

      // New line being drawn
      map.addLayer({
        id: CONTINUE_DRAW_NEW_LINE_LAYER,
        type: "line",
        source: CONTINUE_DRAW_SOURCE_ID,
        filter: ["in", ["get", "role"], ["literal", ["new", "closing"]]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": [
            "case",
            ["==", ["get", "role"], "closing"], "#f59e0b",
            "#3b82f6",
          ],
          "line-width": [
            "case",
            ["==", ["get", "role"], "closing"], 1.5,
            2.5,
          ],
          "line-dasharray": [
            "case",
            ["==", ["get", "role"], "closing"], ["literal", [4, 3]],
            ["literal", [1]],
          ],
        },
      } as maplibregl.LayerSpecification);

      // Vertex handles
      map.addLayer({
        id: CONTINUE_DRAW_VERTEX_LAYER,
        type: "circle",
        source: CONTINUE_DRAW_SOURCE_ID,
        filter: ["in", ["get", "role"], ["literal", ["vertex", "anchor"]]],
        paint: {
          "circle-radius": [
            "case",
            ["==", ["get", "role"], "anchor"], 7,
            5,
          ],
          "circle-color": [
            "case",
            ["==", ["get", "role"], "anchor"], "#3b82f6",
            "#ffffff",
          ],
          "circle-stroke-color": [
            "case",
            ["==", ["get", "role"], "anchor"], "#1d4ed8",
            "#3b82f6",
          ],
          "circle-stroke-width": 2,
        },
      });
    }

    // ── Create or update rubberband source ──
    const rbSource = map.getSource(CONTINUE_DRAW_RUBBERBAND_SOURCE_ID) as GeoJSONSource | undefined;
    const emptyCollection: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [],
    };
    if (!rbSource) {
      map.addSource(CONTINUE_DRAW_RUBBERBAND_SOURCE_ID, {
        type: "geojson",
        data: emptyCollection,
      });

      // Rubberband line
      map.addLayer({
        id: CONTINUE_DRAW_RUBBERBAND_LAYER,
        type: "line",
        source: CONTINUE_DRAW_RUBBERBAND_SOURCE_ID,
        filter: ["==", ["geometry-type"], "LineString"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#3b82f6",
          "line-width": 1.5,
          "line-dasharray": [4, 3],
          "line-opacity": 0.7,
        },
      });

      // Snap indicator circle (vertex or edge snap)
      map.addLayer({
        id: CONTINUE_DRAW_SNAP_INDICATOR_LAYER,
        type: "circle",
        source: CONTINUE_DRAW_RUBBERBAND_SOURCE_ID,
        filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "role"], "snap-target"]],
        paint: {
          "circle-radius": 9,
          "circle-color": "#3b82f6",
          "circle-opacity": 0.25,
          "circle-stroke-color": "#3b82f6",
          "circle-stroke-width": 2.5,
        },
      });

      // Edge highlight line (when hovering over an edge)
      map.addLayer({
        id: CONTINUE_DRAW_EDGE_HIGHLIGHT_LAYER,
        type: "line",
        source: CONTINUE_DRAW_RUBBERBAND_SOURCE_ID,
        filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "role"], "edge-highlight"]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#f59e0b",
          "line-width": 3,
          "line-opacity": 0.8,
        },
      });
    }

    return () => {
      // Cleanup handled by isActive check at top
    };
  }, [map, mapLoaded, isActive, continueDrawingState]);

  // ─── Cleanup on deactivation ──────────────────────────
  useEffect(() => {
    return () => {
      if (map) cleanupLayers(map);
    };
  }, [map]);

  // ─── Mouse / click event handlers ─────────────────────
  useEffect(() => {
    if (!map || !mapLoaded || !isActive) return;

    const handleMouseMove = (e: MapMouseEvent) => {
      if (!isActiveRef.current) return;
      const cds = cdsRef.current;
      if (!cds) return;

      const anchor = getAnchorPosition(cds);
      let cursorPos: Position = [e.lngLat.lng, e.lngLat.lat];
      let snapInfo: SnapInfo = { position: cursorPos, snapType: "none", vertexInfo: null, edgeInfo: null };

      // Snapping
      if (snappingEnabledRef.current) {
        snapInfo = performSnap(
          cursorPos,
          allFeaturesRef.current,
          map,
        );
        cursorPos = snapInfo.position;
      }

      currentSnapRef.current = snapInfo;

      // Get the tip point (last new vertex, or anchor if no new vertices yet)
      const tip = cds.newVertices.length > 0
        ? cds.newVertices[cds.newVertices.length - 1]
        : anchor;

      // Build rubberband features
      const rbFeatures: GeoJSON.Feature[] = [];

      if (tip) {
        // Rubberband line from tip to cursor
        rbFeatures.push({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [tip, cursorPos],
          },
          properties: { role: "rubberband" },
        });
      }

      // Snap indicator
      if (snapInfo.snapType === "vertex") {
        rbFeatures.push({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: cursorPos,
          },
          properties: { role: "snap-target" },
        });
      } else if (snapInfo.snapType === "edge" && snapInfo.edgeInfo) {
        // Show point on edge
        rbFeatures.push({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: cursorPos,
          },
          properties: { role: "snap-target" },
        });

        // Highlight the edge being snapped to
        const edgeFeature = allFeaturesRef.current.features.find(
          (f) => f.id === snapInfo.edgeInfo!.featureId
        );
        if (edgeFeature) {
          const edgeCoords = getEdgeCoordinates(edgeFeature, snapInfo.edgeInfo!);
          if (edgeCoords) {
            rbFeatures.push({
              type: "Feature",
              geometry: {
                type: "LineString",
                coordinates: edgeCoords,
              },
              properties: { role: "edge-highlight" },
            });
          }
        }
      }

      // Update rubberband source
      const rbSource = map.getSource(CONTINUE_DRAW_RUBBERBAND_SOURCE_ID) as GeoJSONSource | undefined;
      if (rbSource) {
        rbSource.setData({
          type: "FeatureCollection",
          features: rbFeatures,
        });
      }

      // Update cursor style
      const canvas = map.getCanvasContainer();
      canvas.style.cursor = snapInfo.snapType !== "none" ? "pointer" : "crosshair";
    };

    const handleClick = (e: MapMouseEvent) => {
      if (!isActiveRef.current) return;
      const cds = cdsRef.current;
      if (!cds) return;

      let pos: Position = [e.lngLat.lng, e.lngLat.lat];
      let snapInfo: SnapInfo = { position: pos, snapType: "none", vertexInfo: null, edgeInfo: null };

      // Snapping
      if (snappingEnabledRef.current) {
        snapInfo = performSnap(
          pos,
          allFeaturesRef.current,
          map,
        );
        pos = snapInfo.position;
      }

      e.preventDefault();

      // Check if this should finish drawing:
      // - Clicking on a vertex or edge of an existing polygon (when we already have vertices)
      if (cds.newVertices.length > 0 && snapInfo.snapType !== "none") {
        // Finish drawing by connecting to this snap target
        if (snapInfo.snapType === "vertex" && snapInfo.vertexInfo) {
          onFinishRef.current("vertex", snapInfo.vertexInfo, null);
        } else if (snapInfo.snapType === "edge" && snapInfo.edgeInfo) {
          onFinishRef.current("edge", null, snapInfo.edgeInfo);
        } else {
          // Add as normal vertex
          onAddVertexRef.current(pos);
        }
      } else {
        // Normal: add a new vertex
        onAddVertexRef.current(pos);
      }
    };

    const handleDblClick = (e: MapMouseEvent) => {
      if (!isActiveRef.current) return;
      e.preventDefault();

      const cds = cdsRef.current;
      if (!cds || cds.newVertices.length === 0) {
        // No vertices placed — just cancel
        onCancelRef.current();
        return;
      }

      // Finish drawing in free mode (double-click to close)
      onFinishRef.current("free", null, null);
    };

    map.on("mousemove", handleMouseMove);
    map.on("click", handleClick);
    map.on("dblclick", handleDblClick);

    return () => {
      map.off("mousemove", handleMouseMove);
      map.off("click", handleClick);
      map.off("dblclick", handleDblClick);
      // Reset cursor when cleaning up handlers
      const canvas = map.getCanvasContainer();
      canvas.style.cursor = "";
    };
  }, [map, mapLoaded, isActive]);

  // ─── Keyboard handler ─────────────────────────────────
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        onCancelRef.current();
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        const cds = cdsRef.current;
        if (cds && cds.newVertices.length > 0) {
          onFinishRef.current("free", null, null);
        } else {
          onCancelRef.current();
        }
        return;
      }

      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        onUndoVertexRef.current();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isActive]);

  // ─── Cleanup callback ─────────────────────────────────
  const cleanup = useCallback(() => {
    if (map) cleanupLayers(map);
  }, [map]);

  return {
    isActive,
    cleanup,
  };
}

// ─── Helpers ────────────────────────────────────────────────

/**
 * Get the coordinates [start, end] of a specific edge in a feature.
 */
function getEdgeCoordinates(
  feature: import("../types").ParkFeature,
  edgeInfo: EdgeAnchorInfo,
): Position[] | null {
  const geom = feature.geometry;

  switch (geom.type) {
    case "LineString": {
      const coords = geom.coordinates;
      const i = edgeInfo.edgeStartIndex;
      if (i >= 0 && i < coords.length - 1) {
        return [coords[i], coords[i + 1]];
      }
      break;
    }
    case "MultiLineString": {
      if (edgeInfo.partIndex === null) break;
      const part = geom.coordinates[edgeInfo.partIndex];
      if (!part) break;
      const i = edgeInfo.edgeStartIndex;
      if (i >= 0 && i < part.length - 1) {
        return [part[i], part[i + 1]];
      }
      break;
    }
    case "Polygon": {
      const ring = geom.coordinates[edgeInfo.ringIndex];
      if (!ring) break;
      const i = edgeInfo.edgeStartIndex;
      if (i >= 0 && i < ring.length - 1) {
        return [ring[i], ring[i + 1]];
      }
      break;
    }
    case "MultiPolygon": {
      if (edgeInfo.partIndex === null) break;
      const part = geom.coordinates[edgeInfo.partIndex];
      if (!part) break;
      const ring = part[edgeInfo.ringIndex];
      if (!ring) break;
      const i = edgeInfo.edgeStartIndex;
      if (i >= 0 && i < ring.length - 1) {
        return [ring[i], ring[i + 1]];
      }
      break;
    }
  }
  return null;
}
