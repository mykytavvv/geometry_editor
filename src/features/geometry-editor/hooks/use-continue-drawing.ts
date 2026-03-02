"use client";

import { useEffect, useRef, useCallback } from "react";
import maplibregl from "maplibre-gl";
import type { Map as MaplibreMap, MapMouseEvent, GeoJSONSource } from "maplibre-gl";
import type { Position } from "geojson";
import type { ParkFeature, ParkFeatureCollection, ContinueDrawingState } from "../types";
import {
  CONTINUE_DRAW_SOURCE_ID,
  CONTINUE_DRAW_EXISTING_LINE_LAYER,
  CONTINUE_DRAW_NEW_LINE_LAYER,
  CONTINUE_DRAW_VERTEX_LAYER,
  CONTINUE_DRAW_RUBBERBAND_SOURCE_ID,
  CONTINUE_DRAW_RUBBERBAND_LAYER,
  CONTINUE_DRAW_SNAP_INDICATOR_LAYER,
  SNAP_THRESHOLD_PX,
} from "../constants";
import { findNearestVertex, type ProjectFn, type SnapResult } from "../lib/snapping";

// ─── Types ──────────────────────────────────────────────────

interface UseContinueDrawingProps {
  map: MaplibreMap | null;
  mapLoaded: boolean;
  continueDrawingState: ContinueDrawingState | null;
  feature: ParkFeature | null; // The feature being extended
  allFeatures: ParkFeatureCollection;
  snappingEnabled: boolean;
  onAddVertex: (position: Position) => void;
  onUndoVertex: () => void;
  onFinish: () => void;
  onCancel: () => void;
}

// ─── Helpers ────────────────────────────────────────────────

/**
 * Get the coordinates of the existing part being extended.
 * Returns the relevant line or polygon ring coordinates.
 */
function getExistingCoords(feature: ParkFeature, cds: ContinueDrawingState): Position[] | null {
  const geomType = feature.geometry.type;

  if (geomType === "LineString") {
    return feature.geometry.coordinates as Position[];
  }
  if (geomType === "MultiLineString" && cds.partIndex !== null) {
    const parts = feature.geometry.coordinates as Position[][];
    return parts[cds.partIndex] ?? null;
  }
  if (geomType === "Polygon") {
    const rings = feature.geometry.coordinates as Position[][];
    return rings[cds.ringIndex] ?? null;
  }
  if (geomType === "MultiPolygon" && cds.partIndex !== null) {
    const parts = feature.geometry.coordinates as Position[][][];
    const rings = parts[cds.partIndex];
    return rings?.[cds.ringIndex] ?? null;
  }
  return null;
}

/**
 * Build the anchor point — the vertex from which drawing continues.
 * For lines: the first or last vertex depending on insertDirection.
 * For polygons: the selected vertex.
 */
function getAnchorPoint(existingCoords: Position[], cds: ContinueDrawingState): Position {
  if (cds.geometryType === "line") {
    return cds.insertDirection === "append"
      ? existingCoords[existingCoords.length - 1]
      : existingCoords[0];
  }
  // Polygon: the selected vertex
  return existingCoords[cds.vertexIndex];
}

/**
 * For polygons, get the "target" point — the next vertex after the insertion point,
 * which is where the new path should reconnect.
 */
function getPolygonTargetPoint(existingCoords: Position[], cds: ContinueDrawingState): Position | null {
  if (cds.geometryType !== "polygon") return null;
  // Ring is closed: [v0, v1, ..., vN, v0]
  const vertexCount = existingCoords.length - 1; // exclude closing vertex
  const nextIdx = (cds.vertexIndex + 1) % vertexCount;
  return existingCoords[nextIdx];
}

/**
 * Check if a position matches the anchor point (the vertex we're drawing from).
 * We don't want to snap-to-finish on the anchor itself.
 */
function isAnchorPosition(pos: Position, anchor: Position): boolean {
  return pos[0] === anchor[0] && pos[1] === anchor[1];
}

/**
 * Perform snapping, including same-feature vertices.
 * Returns the snap result and whether it's a same-feature vertex (snap-to-finish candidate).
 */
function performSnap(
  cursorPos: Position,
  allFeatures: ParkFeatureCollection,
  featureId: string,
  anchor: Position,
  map: MaplibreMap,
): { position: Position; isSameFeatureVertex: boolean } {
  const project: ProjectFn = (lngLat) => {
    const p = map.project(lngLat);
    return { x: p.x, y: p.y };
  };

  // Snap to ALL features (no exclusion)
  const result: SnapResult = findNearestVertex(
    cursorPos,
    allFeatures,
    project,
    SNAP_THRESHOLD_PX,
  );

  if (result.snapped) {
    const isSameFeature = result.featureId === featureId;
    const isAnchor = isAnchorPosition(result.snapped, anchor);

    // If it's the anchor vertex, don't snap to it — treat as no snap
    if (isSameFeature && isAnchor) {
      return { position: cursorPos, isSameFeatureVertex: false };
    }

    return {
      position: result.snapped,
      isSameFeatureVertex: isSameFeature,
    };
  }

  return { position: cursorPos, isSameFeatureVertex: false };
}

/**
 * Build GeoJSON for the continue drawing overlay.
 */
function buildOverlayData(
  existingCoords: Position[],
  cds: ContinueDrawingState,
) {
  const features: GeoJSON.Feature[] = [];
  const anchor = getAnchorPoint(existingCoords, cds);

  // 1. Show the existing geometry outline (dimmed)
  if (cds.geometryType === "line") {
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: existingCoords },
      properties: { role: "existing" },
    });
  } else {
    features.push({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [existingCoords] },
      properties: { role: "existing" },
    });
  }

  // 2. The new path drawn so far
  if (cds.newVertices.length > 0) {
    const newPath = [anchor, ...cds.newVertices];
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: newPath },
      properties: { role: "new" },
    });

    // For polygons: also show a "closing" line from the last new vertex to the target
    if (cds.geometryType === "polygon") {
      const target = getPolygonTargetPoint(existingCoords, cds);
      if (target) {
        features.push({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [cds.newVertices[cds.newVertices.length - 1], target],
          },
          properties: { role: "closing" },
        });
      }
    }
  }

  // 3. Vertex handles for new vertices
  for (let i = 0; i < cds.newVertices.length; i++) {
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: cds.newVertices[i] },
      properties: { role: "vertex", index: i },
    });
  }

  // 4. Anchor point (highlight)
  features.push({
    type: "Feature",
    geometry: { type: "Point", coordinates: anchor },
    properties: { role: "anchor" },
  });

  return { type: "FeatureCollection" as const, features };
}

// ─── Layer cleanup ──────────────────────────────────────────

function cleanupLayers(map: MaplibreMap) {
  const layers = [
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
  feature,
  allFeatures,
  snappingEnabled,
  onAddVertex,
  onUndoVertex,
  onFinish,
  onCancel,
}: UseContinueDrawingProps) {
  const isActive = continueDrawingState !== null && feature !== null;
  const isActiveRef = useRef(false);
  isActiveRef.current = isActive;

  const cdsRef = useRef(continueDrawingState);
  cdsRef.current = continueDrawingState;
  const featureRef = useRef(feature);
  featureRef.current = feature;
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

  // Track whether the cursor is currently snapped to a same-feature vertex
  const snapToFinishRef = useRef(false);

  // ─── Setup / update layers ────────────────────────────
  useEffect(() => {
    if (!map || !mapLoaded) return;

    if (!isActive || !continueDrawingState || !feature) {
      cleanupLayers(map);
      return;
    }

    const existingCoords = getExistingCoords(feature, continueDrawingState);
    if (!existingCoords) {
      cleanupLayers(map);
      return;
    }

    const data = buildOverlayData(existingCoords, continueDrawingState);

    // ── Create or update main source ──
    const source = map.getSource(CONTINUE_DRAW_SOURCE_ID) as GeoJSONSource | undefined;
    if (source) {
      source.setData(data);
    } else {
      map.addSource(CONTINUE_DRAW_SOURCE_ID, {
        type: "geojson",
        data,
      });

      // Existing geometry outline (dimmed)
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

      // New line being drawn + closing line for polygons
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
            "#22c55e",
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
            ["==", ["get", "role"], "anchor"], "#f59e0b",
            "#ffffff",
          ],
          "circle-stroke-color": [
            "case",
            ["==", ["get", "role"], "anchor"], "#b45309",
            "#22c55e",
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
          "line-color": "#22c55e",
          "line-width": 1.5,
          "line-dasharray": [4, 3],
          "line-opacity": 0.7,
        },
      });

      // Snap-to-finish indicator circle (shown on same-feature vertex hover)
      map.addLayer({
        id: CONTINUE_DRAW_SNAP_INDICATOR_LAYER,
        type: "circle",
        source: CONTINUE_DRAW_RUBBERBAND_SOURCE_ID,
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 9,
          "circle-color": "#22c55e",
          "circle-opacity": 0.25,
          "circle-stroke-color": "#22c55e",
          "circle-stroke-width": 2.5,
        },
      });
    }

    return () => {
      // Don't cleanup on every re-render — only when truly deactivating
      // The cleanup is handled by the isActive check at the top
    };
  }, [map, mapLoaded, isActive, continueDrawingState, feature]);

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
      const feat = featureRef.current;
      if (!cds || !feat) return;

      const existingCoords = getExistingCoords(feat, cds);
      if (!existingCoords) return;

      const anchor = getAnchorPoint(existingCoords, cds);
      let cursorPos: Position = [e.lngLat.lng, e.lngLat.lat];
      let isSameFeatureVertex = false;

      // Snapping (includes same-feature vertices)
      if (snappingEnabledRef.current) {
        const snapResult = performSnap(
          cursorPos,
          allFeaturesRef.current,
          cds.featureId,
          anchor,
          map,
        );
        cursorPos = snapResult.position;
        isSameFeatureVertex = snapResult.isSameFeatureVertex;
      }

      snapToFinishRef.current = isSameFeatureVertex;

      // Get the tip point (last new vertex, or anchor if no new vertices yet)
      const tip = cds.newVertices.length > 0
        ? cds.newVertices[cds.newVertices.length - 1]
        : anchor;

      // Build rubberband features
      const rbFeatures: GeoJSON.Feature[] = [
        // Rubberband line from tip to cursor
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [tip, cursorPos],
          },
          properties: {},
        },
      ];

      // If hovering over a same-feature vertex, show snap indicator
      if (isSameFeatureVertex) {
        rbFeatures.push({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: cursorPos,
          },
          properties: { role: "snap-target" },
        });
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
      canvas.style.cursor = isSameFeatureVertex ? "pointer" : "crosshair";
    };

    const handleClick = (e: MapMouseEvent) => {
      if (!isActiveRef.current) return;
      const cds = cdsRef.current;
      const feat = featureRef.current;
      if (!cds || !feat) return;

      const existingCoords = getExistingCoords(feat, cds);
      if (!existingCoords) return;

      const anchor = getAnchorPoint(existingCoords, cds);
      let pos: Position = [e.lngLat.lng, e.lngLat.lat];
      let isSameFeatureVertex = false;

      // Snapping (includes same-feature vertices)
      if (snappingEnabledRef.current) {
        const snapResult = performSnap(
          pos,
          allFeaturesRef.current,
          cds.featureId,
          anchor,
          map,
        );
        pos = snapResult.position;
        isSameFeatureVertex = snapResult.isSameFeatureVertex;
      }

      e.preventDefault();

      if (isSameFeatureVertex && cds.newVertices.length > 0) {
        // Clicking on an existing vertex of the same feature → finish drawing.
        // The new vertices already placed will be inserted; we don't add the
        // clicked vertex since it already exists in the geometry.
        onFinishRef.current();
      } else {
        // Normal: add a new vertex
        onAddVertexRef.current(pos);
      }
    };

    const handleDblClick = (e: MapMouseEvent) => {
      if (!isActiveRef.current) return;
      e.preventDefault();

      // The last click of the double-click already handled via handleClick.
      // If it was a snap-to-finish click, onFinish was already called.
      // If it was a normal vertex add, we finish now.
      onFinishRef.current();
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
        onFinishRef.current();
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
