"use client";

import React, { useRef, useEffect, useCallback, useState } from "react";
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
  MEASUREMENT_SOURCE_ID,
  MEASUREMENT_LINE_LAYER,
  MEASUREMENT_FILL_LAYER,
  MEASUREMENT_POINT_LAYER,
  LAYER_CONFIG,
} from "../constants";
import type {
  ParkFeatureCollection,
  ParkFeature,
  ToolMode,
  MeasurementState,
  ParkLayer,
} from "../types";
import { useMapDraw } from "../hooks/use-map-draw";
import type { EditorActions } from "../hooks/use-editor-state";

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

interface MapEditorProps {
  features: ParkFeatureCollection;
  visibleFeatures: ParkFeatureCollection;
  selectedFeatureIds: string[];
  activeTool: ToolMode;
  measurementState: MeasurementState | null;
  snappingEnabled: boolean;
  editor: EditorActions;
  onMapReady: (map: MaplibreMap) => void;
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
}: MapEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

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
      editor.addFeature(feature);
      editor.selectFeatures([feature.id]);
      editor.setRightPanel(true);
      editor.setTool("select");
    },
    [editor]
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

  const { loadFeatureForEditing, trashLastVertex } = useMapDraw({
    map: mapRef.current,
    activeTool,
    onFeatureCreated: handleFeatureCreated,
    onFeatureUpdated: handleFeatureUpdated,
    onSelectionChanged: handleSelectionChanged,
    onDrawingStateChanged: handleDrawingStateChanged,
    getExistingFeature,
    defaultLayer: "draft",
  });

  // ─── Setup GeoJSON source and layers ──────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

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
            "park_boundaries", LAYER_CONFIG.park_boundaries.color,
            "assets", LAYER_CONFIG.assets.color,
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
            "park_boundaries", LAYER_CONFIG.park_boundaries.color,
            "assets", LAYER_CONFIG.assets.color,
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
            "park_boundaries", LAYER_CONFIG.park_boundaries.color,
            "assets", LAYER_CONFIG.assets.color,
            "draft", LAYER_CONFIG.draft.color,
            LAYER_CONFIG.draft.color,
          ],
          "line-width": 3,
        },
      });

      // Point layer (non-text)
      map.addLayer({
        id: POINT_LAYER,
        type: "circle",
        source: SOURCE_ID,
        filter: [
          "all",
          ["==", ["geometry-type"], "Point"],
          ["!=", ["get", "type"], "text"],
        ],
        paint: {
          "circle-radius": ["coalesce", ["get", "size"], 8],
          "circle-color": [
            "match",
            ["get", "layer"],
            "park_boundaries", LAYER_CONFIG.park_boundaries.color,
            "assets", LAYER_CONFIG.assets.color,
            "draft", LAYER_CONFIG.draft.color,
            LAYER_CONFIG.draft.color,
          ],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });

      // Text layer - show labels for point features that have a label
      map.addLayer({
        id: TEXT_LAYER,
        type: "symbol",
        source: SOURCE_ID,
        filter: [
          "all",
          ["==", ["geometry-type"], "Point"],
          ["has", "label"],
          ["!=", ["get", "label"], ""],
        ],
        layout: {
          "text-field": ["get", "label"],
          "text-size": ["coalesce", ["get", "size"], 14],
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
          "text-size": 12,
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
          "text-size": 12,
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
        filter: ["==", ["get", "id"], ""],
        paint: {
          "circle-radius": 10,
          "circle-color": "#3d6b4f",
          "circle-stroke-width": 3,
          "circle-stroke-color": "#ffffff",
        },
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

  // ─── Update selection highlight ───────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filter: any =
      selectedFeatureIds.length > 0
        ? ["in", ["get", "id"], ["literal", selectedFeatureIds]]
        : ["==", ["get", "id"], ""];

    try {
      map.setFilter(SELECTED_FILL_LAYER, filter);
      map.setFilter(SELECTED_OUTLINE_LAYER, filter);
      map.setFilter(SELECTED_POINT_LAYER, filter);
    } catch {
      // Layers may not exist yet
    }
  }, [selectedFeatureIds, mapLoaded]);

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

      // Feature selection (only in select mode)
      if (activeTool !== "select") return;

      const queryLayers = [
        POLYGON_FILL_LAYER,
        LINE_LAYER,
        POINT_LAYER,
        TEXT_LAYER,
      ];

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
  ]);

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
      default:
        canvas.style.cursor = "";
        break;
    }
  }, [activeTool]);

  // ─── Drag-to-move selected features ─────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const queryLayers = [
      POLYGON_FILL_LAYER,
      LINE_LAYER,
      POINT_LAYER,
      TEXT_LAYER,
    ];

    const handleMouseDown = (e: maplibregl.MapMouseEvent) => {
      // Only in select mode with a selection
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

      // Move all selected features by the delta (live preview)
      // Update the source data directly for smooth visual feedback
      const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (source) {
        const updatedFeatures = visibleFeatures.features.map((f) => {
          if (selectedFeatureIds.includes(f.id)) {
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
        // Update all selected features with final positions
        for (const fId of selectedFeatureIds) {
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
  }, [mapLoaded, activeTool, selectedFeatureIds, features, visibleFeatures, editor]);

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

      // Backspace: remove last vertex during drawing
      if (e.key === "Backspace" && editor.state.isDrawing) {
        e.preventDefault();
        trashLastVertex();
        return;
      }

      // Escape: cancel draw / deselect
      if (e.key === "Escape") {
        if (editor.state.isDrawing) {
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

      // Delete: delete selected
      if (e.key === "Delete" && selectedFeatureIds.length > 0) {
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
      if (!editor.state.isDrawing && !e.metaKey && !e.ctrlKey) {
        switch (e.key.toLowerCase()) {
          case "v":
            editor.setTool("select");
            break;
          case "h":
            editor.setTool("pan");
            break;
          case "p":
            editor.setTool("draw_point");
            break;
          case "l":
            editor.setTool("draw_line");
            break;
          case "g":
            editor.setTool("draw_polygon");
            break;
          case "m":
            editor.setTool("measure_distance");
            break;
          case "a":
            editor.setTool("measure_area");
            break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    editor,
    selectedFeatureIds,
    measurementState,
    trashLastVertex,
  ]);

  return (
    <div ref={containerRef} className="h-full w-full" />
  );
}
