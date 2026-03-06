import type { ParkLayer } from "./types";

// ─── Map Settings ────────────────────────────────────────────
export const MAP_CENTER: [number, number] = [136.9389, 35.1644]; // Chikusa Park, Nagoya
export const MAP_ZOOM = 15;

export const MAP_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: "raster" as const,
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    },
  },
  layers: [
    {
      id: "osm",
      type: "raster" as const,
      source: "osm",
    },
  ],
};

// ─── Layer Configuration ─────────────────────────────────────
export const LAYER_CONFIG: Record<
  ParkLayer,
  { label: string; color: string; fillOpacity: number }
> = {
  park: {
    label: "公園",
    color: "#4a7c59",
    fillOpacity: 0.25,
  },
  facilities: {
    label: "施設",
    color: "#2563eb",
    fillOpacity: 0.2,
  },
  draft: {
    label: "下書き",
    color: "#9333ea",
    fillOpacity: 0.15,
  },
};

// ─── Source & Layer IDs ──────────────────────────────────────
export const SOURCE_ID = "park-features";
export const MEASUREMENT_SOURCE_ID = "measurement-features";

export const POLYGON_FILL_LAYER = "park-polygons-fill";
export const POLYGON_OUTLINE_LAYER = "park-polygons-outline";
export const LINE_LAYER = "park-lines";
export const POINT_LAYER = "park-points";
export const TEXT_LAYER = "park-text";
export const SELECTED_FILL_LAYER = "selected-fill";
export const SELECTED_OUTLINE_LAYER = "selected-outline";
export const SELECTED_POINT_LAYER = "selected-point";
export const FACILITY_POINT_LAYER = "facility-points";
export const SELECTED_FACILITY_POINT_LAYER = "selected-facility-point";
export const MEASUREMENT_LINE_LAYER = "measurement-line";
export const MEASUREMENT_FILL_LAYER = "measurement-fill";
export const MEASUREMENT_POINT_LAYER = "measurement-points";

// ─── Vertex Edit ─────────────────────────────────────────────
export const VERTEX_EDIT_SOURCE_ID = "vertex-edit-features";
export const VERTEX_EDIT_OUTLINE_LAYER = "vertex-edit-outline";
export const VERTEX_EDIT_VERTEX_LAYER = "vertex-edit-vertices";
export const VERTEX_EDIT_MIDPOINT_LAYER = "vertex-edit-midpoints";
export const VERTEX_EDIT_SELECTED_VERTEX_LAYER = "vertex-edit-selected-vertex";

// ─── Continue Drawing (custom polygon drawing system) ────────
export const CONTINUE_DRAW_SOURCE_ID = "continue-draw-features";
export const CONTINUE_DRAW_EXISTING_LINE_LAYER = "continue-draw-existing-line";
export const CONTINUE_DRAW_NEW_LINE_LAYER = "continue-draw-new-line";
export const CONTINUE_DRAW_VERTEX_LAYER = "continue-draw-vertices";
export const CONTINUE_DRAW_RUBBERBAND_SOURCE_ID = "continue-draw-rubberband";
export const CONTINUE_DRAW_RUBBERBAND_LAYER = "continue-draw-rubberband-line";
export const CONTINUE_DRAW_SNAP_INDICATOR_LAYER = "continue-draw-snap-indicator";
export const CONTINUE_DRAW_EDGE_HIGHLIGHT_LAYER = "continue-draw-edge-highlight";

// ─── Multi-Draw Preview ──────────────────────────────────────
export const MULTI_DRAW_SOURCE_ID = "multi-draw-preview";
export const MULTI_DRAW_FILL_LAYER = "multi-draw-fill";
export const MULTI_DRAW_LINE_LAYER = "multi-draw-line";
export const MULTI_DRAW_POINT_LAYER = "multi-draw-points";

// ─── Park Background (Facility Mode) ─────────────────────────
export const PARK_BACKGROUND_SOURCE_ID = "park-background";
export const PARK_BACKGROUND_FILL_LAYER = "park-background-fill";
export const PARK_BACKGROUND_OUTLINE_LAYER = "park-background-outline";

// ─── Selected Parts (Park Mode) ──────────────────────────────
export const SELECTED_PARTS_SOURCE_ID = "selected-parts";
export const SELECTED_PARTS_FILL_LAYER = "selected-parts-fill";
export const SELECTED_PARTS_OUTLINE_LAYER = "selected-parts-outline";

// ─── Snapping ────────────────────────────────────────────────
export const SNAP_THRESHOLD_PX = 10; // pixels
export const SNAP_SEARCH_RADIUS_PX = 20;

// ─── Undo/Redo ───────────────────────────────────────────────
export const MAX_UNDO_STACK = 50;

// ─── Icons for Points ────────────────────────────────────────
export const POINT_ICONS = [
  { value: "marker", label: "マーカー" },
  { value: "tree", label: "木" },
  { value: "bench", label: "ベンチ" },
  { value: "fountain", label: "噴水" },
  { value: "playground", label: "遊具" },
  { value: "toilet", label: "トイレ" },
  { value: "parking", label: "駐車場" },
  { value: "gate", label: "門" },
  { value: "light", label: "街灯" },
  { value: "camera", label: "カメラ" },
];
