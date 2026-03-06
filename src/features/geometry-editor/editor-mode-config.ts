import type { EditorMode, ToolMode, ParkFeature } from "./types";

// ─── Edit Operations ─────────────────────────────────────────
export type EditOperation = "duplicate" | "delete" | "merge" | "split";

// ─── Editor Mode Configuration ───────────────────────────────
export interface EditorModeConfig {
  mode: EditorMode;
  label: string;
  breadcrumbSuffix: string;

  // Toolbar
  allowedTools: ToolMode[];
  showEditOps: EditOperation[];
  showMeasureTools: boolean;
  showSnapping: boolean;
  showCoordinateInput: boolean;
  showFlyTo: boolean;

  // Panels
  showLayerPanel: boolean;
  showPropertiesPanel: boolean;
  showLayerPanelToggle: boolean;

  // Constraints
  maxFeatureCount?: number;
  allowedGeometryTypes: string[];

  // Save validation
  validateOnSave: (features: ParkFeature[]) => { valid: boolean; message?: string };
}

// ─── Full Geometry Mode ──────────────────────────────────────
const FULL_MODE_CONFIG: EditorModeConfig = {
  mode: "full",
  label: "フルジオメトリ",
  breadcrumbSuffix: "ジオメトリエディター",

  allowedTools: [
    "select",
    "pan",
    "draw_point",
    "draw_line",
    "draw_polygon",
    "move",
    "vertex_edit",
    "continue_drawing",
    "measure_distance",
    "measure_area",
    "coordinate_input",
    "draw_clip_polygon",
  ],
  showEditOps: ["duplicate", "delete", "merge", "split"],
  showMeasureTools: true,
  showSnapping: true,
  showCoordinateInput: true,
  showFlyTo: false,

  showLayerPanel: true,
  showPropertiesPanel: true,
  showLayerPanelToggle: true,

  allowedGeometryTypes: ["Point", "LineString", "MultiLineString", "Polygon", "MultiPolygon"],

  validateOnSave: () => ({ valid: true }),
};

// ─── Park Editor Mode ────────────────────────────────────────
const PARK_MODE_CONFIG: EditorModeConfig = {
  mode: "park",
  label: "公園",
  breadcrumbSuffix: "公園エディター",

  allowedTools: [
    "select",
    "draw_polygon",
    "move",
    "vertex_edit",
    "continue_drawing",
    "draw_clip_polygon",
    "merge_parts",
  ],
  showEditOps: ["duplicate", "delete", "merge", "split"],
  showMeasureTools: false,
  showSnapping: true,
  showCoordinateInput: false,
  showFlyTo: true,

  showLayerPanel: false,
  showPropertiesPanel: false,
  showLayerPanelToggle: false,

  allowedGeometryTypes: ["Polygon", "MultiPolygon"],

  validateOnSave: (features) => {
    const hasPolygon = features.some(
      (f) => f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon"
    );
    if (!hasPolygon) {
      return {
        valid: false,
        message: "公園には少なくとも1つのジオメトリが必要です",
      };
    }
    return { valid: true };
  },
};

// ─── Facility Editor Mode ────────────────────────────────────
const FACILITY_MODE_CONFIG: EditorModeConfig = {
  mode: "facility",
  label: "施設",
  breadcrumbSuffix: "施設エディター",

  allowedTools: [
    "select",
    "draw_point",
  ],
  showEditOps: ["delete"],
  showMeasureTools: false,
  showSnapping: false,
  showCoordinateInput: false,
  showFlyTo: true,

  showLayerPanel: false,
  showPropertiesPanel: false,
  showLayerPanelToggle: false,

  maxFeatureCount: 1,
  allowedGeometryTypes: ["Point"],

  validateOnSave: (features) => {
    const points = features.filter((f) => f.geometry.type === "Point");
    if (points.length === 0) {
      return {
        valid: false,
        message: "施設には少なくとも1つのポイントが必要です",
      };
    }
    return { valid: true };
  },
};

// ─── Config Lookup ───────────────────────────────────────────
const MODE_CONFIGS: Record<EditorMode, EditorModeConfig> = {
  full: FULL_MODE_CONFIG,
  park: PARK_MODE_CONFIG,
  facility: FACILITY_MODE_CONFIG,
};

export function getEditorModeConfig(mode: EditorMode): EditorModeConfig {
  return MODE_CONFIGS[mode];
}

// ─── All Modes (for rendering mode switcher) ─────────────────
export const EDITOR_MODES: { mode: EditorMode; label: string }[] = [
  { mode: "full", label: "フルジオメトリ" },
  { mode: "park", label: "公園" },
  { mode: "facility", label: "施設" },
];
