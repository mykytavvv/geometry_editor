"use client";

import { useEffect, useRef, useCallback } from "react";
import maplibregl, { type Map as MaplibreMap, type MapMouseEvent } from "maplibre-gl";
import type { Position } from "geojson";
import type { ParkFeature, ParkFeatureCollection } from "../types";
import {
  VERTEX_EDIT_SOURCE_ID,
  VERTEX_EDIT_OUTLINE_LAYER,
  VERTEX_EDIT_VERTEX_LAYER,
  VERTEX_EDIT_MIDPOINT_LAYER,
  VERTEX_EDIT_SELECTED_VERTEX_LAYER,
  SNAP_THRESHOLD_PX,
} from "../constants";
import { findNearestVertex, type ProjectFn } from "../lib/snapping";

// ─── Types ──────────────────────────────────────────────────
interface VertexDragState {
  vertexIndex: number;
  ringIndex: number;
  startLngLat: [number, number];
}

interface UseVertexEditProps {
  map: MaplibreMap | null;
  mapLoaded: boolean;
  feature: ParkFeature | null; // The feature being edited (null = inactive)
  partIndex: number | null; // For MultiPolygon/MultiLineString: which part to edit
  allFeatures: ParkFeatureCollection;
  snappingEnabled: boolean;
  onUpdateFeature: (feature: ParkFeature) => void;
  onExit: () => void;
}

/** Whether the feature geometry is a line type (open path, no closure). */
export function isLineGeometry(feature: ParkFeature): boolean {
  return feature.geometry.type === "LineString" || feature.geometry.type === "MultiLineString";
}

/** Whether the feature geometry is a polygon type (closed ring). */
export function isPolygonGeometry(feature: ParkFeature): boolean {
  return feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon";
}

/**
 * Reconstruct a full ParkFeature from the edited coordinate arrays.
 * `editedCoords` has the same shape returned by getEditableCoords().
 */
function rebuildFeatureWithCoords(
  feature: ParkFeature,
  partIndex: number | null,
  editedCoords: Position[][],
): ParkFeature {
  const geomType = feature.geometry.type;
  let updatedGeometry: ParkFeature["geometry"];

  if (geomType === "MultiPolygon" && partIndex !== null) {
    const allParts = JSON.parse(JSON.stringify(feature.geometry.coordinates)) as Position[][][];
    allParts[partIndex] = editedCoords;
    updatedGeometry = { type: "MultiPolygon", coordinates: allParts };
  } else if (geomType === "Polygon") {
    updatedGeometry = { type: "Polygon", coordinates: editedCoords };
  } else if (geomType === "MultiLineString" && partIndex !== null) {
    const allParts = JSON.parse(JSON.stringify(feature.geometry.coordinates)) as Position[][];
    // editedCoords is [[...vertices]] for lines; unwrap the single array
    allParts[partIndex] = editedCoords[0];
    updatedGeometry = { type: "MultiLineString", coordinates: allParts };
  } else if (geomType === "LineString") {
    // editedCoords is [[...vertices]]; unwrap
    updatedGeometry = { type: "LineString", coordinates: editedCoords[0] };
  } else {
    // Fallback: shouldn't happen
    updatedGeometry = feature.geometry;
  }

  return { ...feature, geometry: updatedGeometry };
}

// ─── Helpers ────────────────────────────────────────────────

/**
 * Extract the editable coordinate arrays from a feature.
 *
 * Returns a Position[][] where each inner array is one "ring" (for polygons)
 * or one "line part" (for lines). This uniform shape lets the vertex/midpoint
 * logic work identically for both geometry families.
 *
 * - Polygon: returns coordinates (array of rings, each ring is closed).
 * - MultiPolygon: returns coordinates[partIndex] (one polygon's rings).
 * - LineString: wraps coordinates in an array → [[...vertices]].
 * - MultiLineString: wraps coordinates[partIndex] → [[...vertices]].
 */
export function getEditableCoords(feature: ParkFeature, partIndex: number | null): Position[][] | null {
  const geomType = feature.geometry.type;
  if (geomType === "Polygon") {
    return feature.geometry.coordinates as Position[][];
  }
  if (geomType === "MultiPolygon" && partIndex !== null) {
    const coords = feature.geometry.coordinates as Position[][][];
    if (partIndex >= 0 && partIndex < coords.length) {
      return coords[partIndex] as Position[][];
    }
  }
  if (geomType === "LineString") {
    // Wrap the single coordinate array so the shape matches polygon rings
    return [feature.geometry.coordinates as Position[]];
  }
  if (geomType === "MultiLineString" && partIndex !== null) {
    const coords = feature.geometry.coordinates as Position[][];
    if (partIndex >= 0 && partIndex < coords.length) {
      return [coords[partIndex]];
    }
  }
  return null;
}

/** Build GeoJSON features for the vertex edit overlay. */
function buildVertexEditData(feature: ParkFeature, partIndex: number | null, selectedVertexIndex: number | null) {
  const coords = getEditableCoords(feature, partIndex);
  if (!coords) return { type: "FeatureCollection" as const, features: [] };

  const isLine = isLineGeometry(feature);
  const geoFeatures: GeoJSON.Feature[] = [];

  // 0. For Multi* types: show other parts as faded context outlines
  if (feature.geometry.type === "MultiPolygon" && partIndex !== null) {
    const allParts = feature.geometry.coordinates as Position[][][];
    for (let i = 0; i < allParts.length; i++) {
      if (i === partIndex) continue;
      geoFeatures.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: allParts[i] },
        properties: { role: "context" },
      });
    }
  } else if (feature.geometry.type === "MultiLineString" && partIndex !== null) {
    const allParts = feature.geometry.coordinates as Position[][];
    for (let i = 0; i < allParts.length; i++) {
      if (i === partIndex) continue;
      geoFeatures.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: allParts[i] },
        properties: { role: "context" },
      });
    }
  }

  // 1. Active part outline (solid highlight)
  if (isLine) {
    // For lines: outline is a LineString
    geoFeatures.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: coords[0] },
      properties: { role: "outline" },
    });
  } else {
    // For polygons: outline is a Polygon
    geoFeatures.push({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: coords },
      properties: { role: "outline" },
    });
  }

  // 2. Vertex handles
  for (let ringIdx = 0; ringIdx < coords.length; ringIdx++) {
    const ring = coords[ringIdx];
    // For polygons: skip closing vertex (same as first). For lines: use all vertices.
    const vertexCount = isLine ? ring.length : ring.length - 1;
    for (let i = 0; i < vertexCount; i++) {
      geoFeatures.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: ring[i] },
        properties: {
          role: "vertex",
          ringIndex: ringIdx,
          vertexIndex: i,
          selected: selectedVertexIndex === i && ringIdx === 0 ? "true" : "false",
        },
      });
    }
  }

  // 3. Midpoint handles (between consecutive vertices)
  for (let ringIdx = 0; ringIdx < coords.length; ringIdx++) {
    const ring = coords[ringIdx];
    if (isLine) {
      // For lines: midpoints between consecutive pairs (no wrap-around)
      for (let i = 0; i < ring.length - 1; i++) {
        const midLng = (ring[i][0] + ring[i + 1][0]) / 2;
        const midLat = (ring[i][1] + ring[i + 1][1]) / 2;
        geoFeatures.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [midLng, midLat] },
          properties: {
            role: "midpoint",
            ringIndex: ringIdx,
            afterVertexIndex: i,
          },
        });
      }
    } else {
      // For polygons: midpoints wrap around (last→first edge included)
      const vertexCount = ring.length - 1;
      for (let i = 0; i < vertexCount; i++) {
        const next = (i + 1) % vertexCount;
        const midLng = (ring[i][0] + ring[next][0]) / 2;
        const midLat = (ring[i][1] + ring[next][1]) / 2;
        geoFeatures.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [midLng, midLat] },
          properties: {
            role: "midpoint",
            ringIndex: ringIdx,
            afterVertexIndex: i,
          },
        });
      }
    }
  }

  return {
    type: "FeatureCollection" as const,
    features: geoFeatures,
  };
}

// ─── Hook ───────────────────────────────────────────────────

export function useVertexEdit({
  map,
  mapLoaded,
  feature,
  partIndex,
  allFeatures,
  snappingEnabled,
  onUpdateFeature,
  onExit,
}: UseVertexEditProps) {
  const dragRef = useRef<VertexDragState | null>(null);
  const selectedVertexRef = useRef<{ ringIndex: number; vertexIndex: number } | null>(null);
  // Keep a mutable copy of the editable part's ring coordinates for live preview during drag
  const liveCoordinatesRef = useRef<Position[][] | null>(null);
  const isActiveRef = useRef(false);
  const partIndexRef = useRef(partIndex);
  partIndexRef.current = partIndex;

  // Store callbacks in refs so event handlers always see latest
  const onUpdateFeatureRef = useRef(onUpdateFeature);
  onUpdateFeatureRef.current = onUpdateFeature;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const featureRef = useRef(feature);
  featureRef.current = feature;
  const allFeaturesRef = useRef(allFeatures);
  allFeaturesRef.current = allFeatures;
  const snappingEnabledRef = useRef(snappingEnabled);
  snappingEnabledRef.current = snappingEnabled;

  // ─── Setup / teardown source and layers ────────────────
  useEffect(() => {
    if (!map || !mapLoaded) return;

    const isActive = feature !== null;
    isActiveRef.current = isActive;

    if (isActive) {
      // Create source + layers if they don't exist
      if (!map.getSource(VERTEX_EDIT_SOURCE_ID)) {
        map.addSource(VERTEX_EDIT_SOURCE_ID, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });

        // Outline layer
        map.addLayer({
          id: VERTEX_EDIT_OUTLINE_LAYER,
          type: "line",
          source: VERTEX_EDIT_SOURCE_ID,
          filter: ["==", ["get", "role"], "outline"],
          paint: {
            "line-color": "#f59e0b",
            "line-width": 3,
          },
        });

        // Vertex circles
        map.addLayer({
          id: VERTEX_EDIT_VERTEX_LAYER,
          type: "circle",
          source: VERTEX_EDIT_SOURCE_ID,
          filter: [
            "all",
            ["==", ["get", "role"], "vertex"],
            ["!=", ["get", "selected"], "true"],
          ],
          paint: {
            "circle-radius": 6,
            "circle-color": "#ffffff",
            "circle-stroke-color": "#f59e0b",
            "circle-stroke-width": 2.5,
          },
        });

        // Selected vertex circle
        map.addLayer({
          id: VERTEX_EDIT_SELECTED_VERTEX_LAYER,
          type: "circle",
          source: VERTEX_EDIT_SOURCE_ID,
          filter: [
            "all",
            ["==", ["get", "role"], "vertex"],
            ["==", ["get", "selected"], "true"],
          ],
          paint: {
            "circle-radius": 7,
            "circle-color": "#f59e0b",
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2.5,
          },
        });

        // Midpoint circles
        map.addLayer({
          id: VERTEX_EDIT_MIDPOINT_LAYER,
          type: "circle",
          source: VERTEX_EDIT_SOURCE_ID,
          filter: ["==", ["get", "role"], "midpoint"],
          paint: {
            "circle-radius": 4,
            "circle-color": "#f59e0b",
            "circle-opacity": 0.6,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 1.5,
          },
        });
      }

      // Set initial data
      selectedVertexRef.current = null;
      liveCoordinatesRef.current = null;
      const data = buildVertexEditData(feature, partIndexRef.current, null);
      const source = map.getSource(VERTEX_EDIT_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      source?.setData(data);
    } else {
      // Remove layers and source
      cleanupLayers(map);
      selectedVertexRef.current = null;
      liveCoordinatesRef.current = null;
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, mapLoaded, feature?.id]);

  // ─── Update overlay when feature geometry changes (e.g. after commit) ──
  useEffect(() => {
    if (!map || !mapLoaded || !feature) return;
    if (dragRef.current) return; // Don't overwrite during active drag
    const source = map.getSource(VERTEX_EDIT_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    const selIdx = selectedVertexRef.current?.vertexIndex ?? null;
    const data = buildVertexEditData(feature, partIndexRef.current, selIdx);
    source.setData(data);
  }, [map, mapLoaded, feature]);

  // ─── Mouse event handlers ─────────────────────────────
  useEffect(() => {
    if (!map || !mapLoaded || !feature) return;

    const getProjectFn = (): ProjectFn => {
      return (lngLat: [number, number]) => map.project(lngLat);
    };

    /** Update the GeoJSON source from live coordinates */
    const updateSourceLive = () => {
      const feat = featureRef.current;
      if (!feat || !liveCoordinatesRef.current) return;

      // Build a temporary feature with the live-edited coordinates
      const liveFeat = rebuildFeatureWithCoords(feat, partIndexRef.current, liveCoordinatesRef.current);

      const selIdx = selectedVertexRef.current?.vertexIndex ?? null;
      const data = buildVertexEditData(liveFeat, partIndexRef.current, selIdx);
      const source = map.getSource(VERTEX_EDIT_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      source?.setData(data);
    };

    // ── mousedown: start dragging a vertex ──
    const handleMouseDown = (e: MapMouseEvent) => {
      if (!isActiveRef.current) return;

      // Query vertex handles
      const vertexFeatures = map.queryRenderedFeatures(e.point, {
        layers: [VERTEX_EDIT_VERTEX_LAYER, VERTEX_EDIT_SELECTED_VERTEX_LAYER],
      });

      if (vertexFeatures.length > 0) {
        const props = vertexFeatures[0].properties;
        if (props?.role === "vertex") {
          e.preventDefault();
          map.dragPan.disable();

          const ringIndex = props.ringIndex as number;
          const vertexIndex = props.vertexIndex as number;

          selectedVertexRef.current = { ringIndex, vertexIndex };
          dragRef.current = {
            vertexIndex,
            ringIndex,
            startLngLat: [e.lngLat.lng, e.lngLat.lat],
          };

          // Initialize live coordinates from the editable part
          const feat = featureRef.current;
          if (feat) {
            const editCoords = getEditableCoords(feat, partIndexRef.current);
            if (editCoords) {
              liveCoordinatesRef.current = JSON.parse(JSON.stringify(editCoords));
            }
          }

          const canvas = map.getCanvasContainer();
          canvas.style.cursor = "grabbing";
          return;
        }
      }
    };

    // ── mousemove: drag vertex to new position ──
    const handleMouseMove = (e: MapMouseEvent) => {
      const drag = dragRef.current;

      if (!drag) {
        // Hover cursor: show grab on vertex handles, pointer on midpoints
        if (!isActiveRef.current) return;
        const hovered = map.queryRenderedFeatures(e.point, {
          layers: [VERTEX_EDIT_VERTEX_LAYER, VERTEX_EDIT_SELECTED_VERTEX_LAYER, VERTEX_EDIT_MIDPOINT_LAYER],
        });
        const canvas = map.getCanvasContainer();
        if (hovered.length > 0) {
          const role = hovered[0].properties?.role;
          canvas.style.cursor = role === "midpoint" ? "pointer" : "grab";
        } else {
          canvas.style.cursor = "crosshair";
        }
        return;
      }

      // Dragging
      if (!liveCoordinatesRef.current) return;

      let newLng = e.lngLat.lng;
      let newLat = e.lngLat.lat;

      // Try snapping (exclude the feature being edited)
      if (snappingEnabledRef.current) {
        const project = getProjectFn();
        const snapResult = findNearestVertex(
          [newLng, newLat],
          allFeaturesRef.current,
          project,
          SNAP_THRESHOLD_PX,
          featureRef.current?.id
        );
        if (snapResult.snapped) {
          newLng = snapResult.snapped[0];
          newLat = snapResult.snapped[1];
        }
      }

      const ring = liveCoordinatesRef.current[drag.ringIndex];
      if (!ring) return;

      // Update vertex position
      ring[drag.vertexIndex] = [newLng, newLat];

      // If polygon: keep closure in sync (first == last). Lines don't have closure.
      const feat = featureRef.current;
      if (feat && isPolygonGeometry(feat)) {
        const vertexCount = ring.length - 1;
        if (drag.vertexIndex === 0) {
          ring[vertexCount] = [newLng, newLat];
        } else if (drag.vertexIndex === vertexCount) {
          ring[0] = [newLng, newLat];
        }
      }

      updateSourceLive();
    };

    // ── mouseup: commit vertex move ──
    const handleMouseUp = () => {
      const drag = dragRef.current;
      if (!drag) return;

      map.dragPan.enable();
      const canvas = map.getCanvasContainer();
      canvas.style.cursor = "crosshair";

      dragRef.current = null;

      // Commit the updated geometry
      const feat = featureRef.current;
      if (feat && liveCoordinatesRef.current) {
        const editedCoords = JSON.parse(JSON.stringify(liveCoordinatesRef.current)) as Position[][];
        const updated = rebuildFeatureWithCoords(feat, partIndexRef.current, editedCoords);
        onUpdateFeatureRef.current(updated);
      }

      liveCoordinatesRef.current = null;
    };

    // ── click: handle midpoint click (add vertex) or vertex selection ──
    const handleClick = (e: MapMouseEvent) => {
      if (!isActiveRef.current) return;

      // Check midpoints first
      const midpointFeatures = map.queryRenderedFeatures(e.point, {
        layers: [VERTEX_EDIT_MIDPOINT_LAYER],
      });

      if (midpointFeatures.length > 0) {
        const props = midpointFeatures[0].properties;
        if (props?.role === "midpoint") {
          e.preventDefault();
          const ringIndex = props.ringIndex as number;
          const afterVertexIndex = props.afterVertexIndex as number;

          const feat = featureRef.current;
          if (!feat) return;
          const isLine = isLineGeometry(feat);
          const isPoly = isPolygonGeometry(feat);
          if (!isLine && !isPoly) return;

          // Get the editable coords for this part
          const editCoords = getEditableCoords(feat, partIndexRef.current);
          if (!editCoords) return;
          const coords = JSON.parse(JSON.stringify(editCoords)) as Position[][];
          const ring = coords[ringIndex];
          if (!ring) return;

          // Compute the midpoint position
          let nextIdx: number;
          if (isLine) {
            nextIdx = afterVertexIndex + 1;
          } else {
            const vertexCount = ring.length - 1;
            nextIdx = (afterVertexIndex + 1) % vertexCount;
          }
          const midLng = (ring[afterVertexIndex][0] + ring[nextIdx][0]) / 2;
          const midLat = (ring[afterVertexIndex][1] + ring[nextIdx][1]) / 2;

          // Insert new vertex after afterVertexIndex
          ring.splice(afterVertexIndex + 1, 0, [midLng, midLat]);

          // Fix polygon closure: last element must equal first (lines don't need this)
          if (isPoly) {
            ring[ring.length - 1] = [...ring[0]];
          }

          // Reconstruct the full geometry
          const updated = rebuildFeatureWithCoords(feat, partIndexRef.current, coords);

          // Select the newly added vertex
          selectedVertexRef.current = {
            ringIndex,
            vertexIndex: afterVertexIndex + 1,
          };

          onUpdateFeatureRef.current(updated);
          return;
        }
      }

      // Check vertex click (for selection)
      const vertexFeatures = map.queryRenderedFeatures(e.point, {
        layers: [VERTEX_EDIT_VERTEX_LAYER, VERTEX_EDIT_SELECTED_VERTEX_LAYER],
      });

      if (vertexFeatures.length > 0) {
        const props = vertexFeatures[0].properties;
        if (props?.role === "vertex") {
          e.preventDefault();
          selectedVertexRef.current = {
            ringIndex: props.ringIndex as number,
            vertexIndex: props.vertexIndex as number,
          };
          // Update visual selection
          const feat = featureRef.current;
          if (feat) {
            const data = buildVertexEditData(feat, partIndexRef.current, props.vertexIndex as number);
            const source = map.getSource(VERTEX_EDIT_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
            source?.setData(data);
          }
          return;
        }
      }

      // Clicked on empty space inside the polygon or outside -> deselect vertex
      // But don't exit — only Escape or explicit exit action does that
      if (selectedVertexRef.current) {
        selectedVertexRef.current = null;
        const feat = featureRef.current;
        if (feat) {
          const data = buildVertexEditData(feat, partIndexRef.current, null);
          const source = map.getSource(VERTEX_EDIT_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
          source?.setData(data);
        }
      }
    };

    // ── contextmenu: select vertex on right-click ──
    const handleContextMenu = (e: MapMouseEvent) => {
      if (!isActiveRef.current) return;

      const vertexFeatures = map.queryRenderedFeatures(e.point, {
        layers: [VERTEX_EDIT_VERTEX_LAYER, VERTEX_EDIT_SELECTED_VERTEX_LAYER],
      });

      if (vertexFeatures.length > 0) {
        const props = vertexFeatures[0].properties;
        if (props?.role === "vertex") {
          e.preventDefault();
          selectedVertexRef.current = {
            ringIndex: props.ringIndex as number,
            vertexIndex: props.vertexIndex as number,
          };
          const feat = featureRef.current;
          if (feat) {
            const data = buildVertexEditData(feat, partIndexRef.current, props.vertexIndex as number);
            const source = map.getSource(VERTEX_EDIT_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
            source?.setData(data);
          }
        }
      }
    };

    map.on("mousedown", handleMouseDown);
    map.on("mousemove", handleMouseMove);
    map.on("mouseup", handleMouseUp);
    map.on("click", handleClick);
    map.on("contextmenu", handleContextMenu);

    return () => {
      map.off("mousedown", handleMouseDown);
      map.off("mousemove", handleMouseMove);
      map.off("mouseup", handleMouseUp);
      map.off("click", handleClick);
      map.off("contextmenu", handleContextMenu);
    };
    // Re-register when feature ID changes (not on every geometry update)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, mapLoaded, feature?.id]);

  // ─── Keyboard handler for vertex deletion ────────────
  useEffect(() => {
    if (!feature) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      // Delete selected vertex
      if (e.key === "Delete" || e.key === "Backspace") {
        const sel = selectedVertexRef.current;
        const feat = featureRef.current;
        if (!sel || !feat) return;

        const isLine = isLineGeometry(feat);
        const isPoly = isPolygonGeometry(feat);
        if (!isLine && !isPoly) return;

        // Get the editable coords for this part
        const editCoords = getEditableCoords(feat, partIndexRef.current);
        if (!editCoords) return;

        const coords = JSON.parse(JSON.stringify(editCoords)) as Position[][];
        const ring = coords[sel.ringIndex];
        if (!ring) return;

        if (isLine) {
          // Minimum 2 vertices for a line
          if (ring.length <= 2) return;
        } else {
          // Minimum 3 vertices for a polygon (4 including closure)
          const vertexCount = ring.length - 1;
          if (vertexCount <= 3) return;
        }

        e.preventDefault();

        // Remove the vertex
        ring.splice(sel.vertexIndex, 1);

        // Fix polygon closure (lines don't need this)
        if (isPoly) {
          ring[ring.length - 1] = [...ring[0]];
        }

        // Reconstruct the full geometry
        const updated = rebuildFeatureWithCoords(feat, partIndexRef.current, coords);

        selectedVertexRef.current = null;
        onUpdateFeatureRef.current(updated);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [feature?.id]);

  // ─── Cleanup helper ───────────────────────────────────
  const cleanupLayersCallback = useCallback(() => {
    if (map) cleanupLayers(map);
  }, [map]);

  /** Getter for the currently selected vertex (reads the ref synchronously). */
  const getSelectedVertex = useCallback(
    () => selectedVertexRef.current,
    []
  );

  return {
    isActive: feature !== null,
    selectedVertex: selectedVertexRef.current,
    getSelectedVertex,
    cleanup: cleanupLayersCallback,
  };
}

// ─── Layer cleanup ──────────────────────────────────────────
function cleanupLayers(map: MaplibreMap) {
  const layers = [
    VERTEX_EDIT_MIDPOINT_LAYER,
    VERTEX_EDIT_SELECTED_VERTEX_LAYER,
    VERTEX_EDIT_VERTEX_LAYER,
    VERTEX_EDIT_OUTLINE_LAYER,
  ];
  for (const layerId of layers) {
    try {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
    } catch {
      // Ignore
    }
  }
  try {
    if (map.getSource(VERTEX_EDIT_SOURCE_ID)) {
      map.removeSource(VERTEX_EDIT_SOURCE_ID);
    }
  } catch {
    // Ignore
  }
}
