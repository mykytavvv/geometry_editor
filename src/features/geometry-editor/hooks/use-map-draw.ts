"use client";

import { useRef, useEffect, useCallback } from "react";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import { v4 as uuidv4 } from "uuid";
import type { Map as MaplibreMap } from "maplibre-gl";
import type { ParkFeature, ParkFeatureProperties, ToolMode, ParkLayer } from "../types";

// Custom draw styles matching our park theme
const DRAW_STYLES = [
  // Polygon fill
  {
    id: "gl-draw-polygon-fill",
    type: "fill",
    filter: ["all", ["==", "$type", "Polygon"], ["!=", "mode", "static"]],
    paint: {
      "fill-color": "#4a7c59",
      "fill-outline-color": "#4a7c59",
      "fill-opacity": 0.15,
    },
  },
  // Polygon outline - active
  {
    id: "gl-draw-polygon-stroke-active",
    type: "line",
    filter: ["all", ["==", "$type", "Polygon"], ["!=", "mode", "static"]],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#3d6b4f", "line-dasharray": [0.2, 2], "line-width": 2 },
  },
  // Line - active
  {
    id: "gl-draw-line",
    type: "line",
    filter: ["all", ["==", "$type", "LineString"], ["!=", "mode", "static"]],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#3d6b4f", "line-dasharray": [0.2, 2], "line-width": 2 },
  },
  // Vertex points
  {
    id: "gl-draw-polygon-and-line-vertex-active",
    type: "circle",
    filter: ["all", ["==", "meta", "vertex"], ["==", "$type", "Point"], ["!=", "mode", "static"]],
    paint: { "circle-radius": 5, "circle-color": "#fff", "circle-stroke-color": "#3d6b4f", "circle-stroke-width": 2 },
  },
  // Midpoints
  {
    id: "gl-draw-polygon-midpoint",
    type: "circle",
    filter: ["all", ["==", "$type", "Point"], ["==", "meta", "midpoint"]],
    paint: { "circle-radius": 3, "circle-color": "#3d6b4f" },
  },
  // Point – hidden because we render points via custom map layers (facility pins, etc.)
  {
    id: "gl-draw-point",
    type: "circle",
    filter: ["all", ["==", "$type", "Point"], ["==", "meta", "feature"], ["!=", "mode", "static"]],
    paint: { "circle-radius": 0, "circle-color": "#3d6b4f", "circle-opacity": 0 },
  },
];

interface UseMapDrawProps {
  map: MaplibreMap | null;
  activeTool: ToolMode;
  onFeatureCreated: (feature: ParkFeature) => void;
  onFeatureUpdated: (feature: ParkFeature) => void;
  onSelectionChanged: (ids: string[]) => void;
  onDrawingStateChanged: (isDrawing: boolean) => void;
  getExistingFeature: (id: string) => ParkFeature | undefined;
  defaultLayer: ParkLayer;
}

export function useMapDraw({
  map,
  activeTool,
  onFeatureCreated,
  onFeatureUpdated,
  onSelectionChanged,
  onDrawingStateChanged,
  getExistingFeature,
  defaultLayer,
}: UseMapDrawProps) {
  const drawRef = useRef<MapboxDraw | null>(null);
  const isInitializedRef = useRef(false);
  const justCreatedAtRef = useRef(0);
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;
  // When set to true, the next draw.create event will be suppressed
  // (the created feature is deleted from draw but not added to state).
  // Used to prevent point placement when shift+clicking for multi-select.
  const suppressNextCreateRef = useRef(false);

  // Initialize MapboxDraw
  useEffect(() => {
    if (!map || isInitializedRef.current) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: {},
      styles: DRAW_STYLES,
      userProperties: true,
    } as any);

    // MapboxDraw expects mapboxgl-compatible API, MapLibre is compatible
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (map as any).addControl(draw as any);
    drawRef.current = draw;
    isInitializedRef.current = true;

    return () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (map as any).removeControl(draw as any);
      } catch {
        // Ignore cleanup errors
      }
      drawRef.current = null;
      isInitializedRef.current = false;
    };
  }, [map]);

  // Wire up draw events
  useEffect(() => {
    if (!map || !drawRef.current) return;

    const handleCreate = (e: { features: GeoJSON.Feature[] }) => {
      const draw = drawRef.current;
      if (!draw) return;

      // If creation was suppressed (e.g. shift+click for multi-select in
      // draw_point mode), just delete the feature from draw and bail out.
      if (suppressNextCreateRef.current) {
        suppressNextCreateRef.current = false;
        for (const drawFeature of e.features) {
          try {
            if (drawFeature.id) draw.delete(String(drawFeature.id));
          } catch { /* ignore */ }
        }
        // Re-enter draw_point so the user can keep placing points
        if (activeToolRef.current === "draw_point") {
          setTimeout(() => {
            try { draw.changeMode("draw_point"); } catch { /* ignore */ }
          }, 50);
        }
        return;
      }

      // Record creation time so we can ignore draw.selectionchange events
      // that MapboxDraw fires when switching to simple_select after creation.
      justCreatedAtRef.current = Date.now();

      for (const drawFeature of e.features) {
        const geomType = drawFeature.geometry.type;
        let featureType: ParkFeatureProperties["type"] = "point";
        if (geomType === "LineString") featureType = "line";
        else if (geomType === "Polygon") featureType = "polygon";

        const parkFeature: ParkFeature = {
          id: uuidv4(),
          type: "Feature",
          geometry: drawFeature.geometry as ParkFeature["geometry"],
          properties: {
            type: featureType,
            layer: defaultLayer,
          },
        };

        onFeatureCreated(parkFeature);

        // Remove from draw so it's managed by our state
        try {
          if (drawFeature.id) {
            draw.delete(String(drawFeature.id));
          }
        } catch {
          // Ignore
        }

        // Re-enter draw_point mode for continuous point placement.
        // MapboxDraw auto-exits to simple_select after placing a point.
        if (featureType === "point" && activeToolRef.current === "draw_point") {
          setTimeout(() => {
            if (draw && activeToolRef.current === "draw_point") {
              try {
                draw.changeMode("draw_point");
              } catch {
                // Ignore if mode change fails
              }
            }
          }, 50);
        }
      }
    };

    const handleUpdate = (e: { features: GeoJSON.Feature[] }) => {
      for (const drawFeature of e.features) {
        const existingId = drawFeature.properties?._parkId;
        if (existingId) {
          const existing = getExistingFeature(existingId);
          if (existing) {
            const updated: ParkFeature = {
              ...existing,
              geometry: drawFeature.geometry as ParkFeature["geometry"],
            };
            onFeatureUpdated(updated);
          }
        }
      }
    };

    const handleSelectionChange = (e: { features: GeoJSON.Feature[] }) => {
      // After geometry creation, MapboxDraw switches to simple_select and
      // fires selectionchange events with empty features — potentially more
      // than once (internal mode switch + our activeTool sync effect).
      // Ignore empty selection events within 300ms of creation so they
      // don't clear the app-level selection set by onFeatureCreated.
      if (
        e.features.length === 0 &&
        justCreatedAtRef.current > 0 &&
        Date.now() - justCreatedAtRef.current < 300
      ) {
        return;
      }
      justCreatedAtRef.current = 0;

      const ids = e.features
        .map((f) => f.properties?._parkId)
        .filter(Boolean) as string[];
      onSelectionChanged(ids);
    };

    const handleModeChange = (e: { mode: string }) => {
      const isDrawing = e.mode.startsWith("draw_");
      onDrawingStateChanged(isDrawing);
    };

    map.on("draw.create", handleCreate);
    map.on("draw.update", handleUpdate);
    map.on("draw.selectionchange", handleSelectionChange);
    map.on("draw.modechange", handleModeChange);

    return () => {
      map.off("draw.create", handleCreate);
      map.off("draw.update", handleUpdate);
      map.off("draw.selectionchange", handleSelectionChange);
      map.off("draw.modechange", handleModeChange);
    };
  }, [
    map,
    onFeatureCreated,
    onFeatureUpdated,
    onSelectionChanged,
    onDrawingStateChanged,
    getExistingFeature,
    defaultLayer,
  ]);

  // Sync tool mode to draw mode
  useEffect(() => {
    const draw = drawRef.current;
    if (!draw) return;

    switch (activeTool) {
      case "draw_point":
        draw.changeMode("draw_point");
        break;
      case "draw_line":
        draw.changeMode("draw_line_string");
        break;
      case "draw_polygon":
        // draw_polygon is handled by the custom continue-drawing system.
        // Keep MapboxDraw in simple_select so it doesn't interfere.
        try {
          draw.changeMode("simple_select");
        } catch { /* ignore */ }
        break;
      case "draw_clip_polygon":
        draw.changeMode("draw_polygon");
        break;
      case "select":
      case "pan":
      case "move":
      case "vertex_edit":
      case "continue_drawing":
      case "measure_distance":
      case "measure_area":
      case "coordinate_input":
      default:
        // After geometry creation MapboxDraw already switched to
        // simple_select internally. Calling changeMode again would fire
        // another draw.selectionchange with empty features, clearing our
        // app-level selection. Skip the redundant call.
        if (
          justCreatedAtRef.current > 0 &&
          Date.now() - justCreatedAtRef.current < 300
        ) {
          break;
        }
        try {
          draw.changeMode("simple_select");
        } catch {
          // Ignore if already in simple_select
        }
        break;
    }
  }, [activeTool]);

  // Load a feature into draw for editing
  const loadFeatureForEditing = useCallback(
    (feature: ParkFeature) => {
      const draw = drawRef.current;
      if (!draw) return;

      // Add the feature to draw with a reference to the park feature ID
      const drawFeature = {
        ...feature,
        id: `draw-${feature.id}`,
        properties: {
          ...feature.properties,
          _parkId: feature.id,
        },
      };

      try {
        draw.add(drawFeature as GeoJSON.Feature);
        draw.changeMode("direct_select", { featureId: `draw-${feature.id}` });
      } catch {
        // Ignore errors
      }
    },
    []
  );

  // Remove feature from draw
  const removeFeatureFromDraw = useCallback((featureId: string) => {
    const draw = drawRef.current;
    if (!draw) return;
    try {
      draw.delete(`draw-${featureId}`);
    } catch {
      // Ignore
    }
  }, []);

  // Trash last vertex during drawing (Backspace handler)
  const trashLastVertex = useCallback(() => {
    const draw = drawRef.current;
    if (!draw) return;
    try {
      draw.trash();
    } catch {
      // Ignore if not in a mode that supports trash
    }
  }, []);

  // Re-enter the current draw mode (used for multi-part drawing)
  const reenterDrawMode = useCallback((mode: "draw_line_string" | "draw_polygon") => {
    const draw = drawRef.current;
    if (!draw) return;
    try {
      draw.changeMode(mode);
    } catch {
      // Ignore if mode change fails
    }
  }, []);

  // Get draw instance for external use
  const getDraw = useCallback(() => drawRef.current, []);

  return {
    draw: drawRef.current,
    getDraw,
    loadFeatureForEditing,
    removeFeatureFromDraw,
    trashLastVertex,
    reenterDrawMode,
    suppressNextCreateRef,
  };
}
