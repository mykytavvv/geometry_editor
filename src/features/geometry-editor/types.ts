import type { Point, LineString, MultiLineString, Polygon, MultiPolygon, Position } from "geojson";

// ─── Tool Modes ──────────────────────────────────────────────
export type ToolMode =
  | "select"
  | "pan"
  | "draw_point"
  | "draw_line"
  | "draw_polygon"
  | "move"
  | "vertex_edit"
  | "continue_drawing"
  | "measure_distance"
  | "measure_area"
  | "coordinate_input"
  | "draw_clip_polygon";

// ─── Feature Types ───────────────────────────────────────────
export type ParkFeatureType = "point" | "line" | "multiline" | "polygon" | "multipolygon" | "text";
export type ParkLayer = "park" | "facilities" | "draft";

// ─── Drawing Parts ───────────────────────────────────────────
export type DrawingPartsType = "line" | "polygon";
export type DrawingParts = Position[][] | Position[][][];

// ─── Continue Drawing State ──────────────────────────────────
export interface ContinueDrawingState {
  featureId: string;
  partIndex: number | null;         // For Multi* types: which part
  ringIndex: number;                // Which ring (0 for lines, 0+ for polygon holes)
  vertexIndex: number;              // The vertex we're continuing from
  insertDirection: "append" | "prepend"; // For lines: append at end or prepend at start
  newVertices: Position[];          // Vertices placed so far (in drawing order)
  geometryType: "line" | "polygon";
}

export interface ParkFeatureProperties {
  type: ParkFeatureType;
  label?: string;
  icon?: string;
  size?: number;
  linkedAttributes?: Record<string, string | number | boolean>;
  layer?: ParkLayer;
  parkId?: string; // For facilities layer: references the id of a park feature
}

export interface ParkFeature {
  id: string;
  type: "Feature";
  geometry: Point | LineString | MultiLineString | Polygon | MultiPolygon;
  properties: ParkFeatureProperties;
}

export interface ParkFeatureCollection {
  type: "FeatureCollection";
  features: ParkFeature[];
}

// ─── Measurement State ───────────────────────────────────────
export interface MeasurementState {
  mode: "distance" | "area";
  points: Position[];
  totalDistance: number | null; // meters
  area: number | null; // square meters
  perimeter: number | null; // meters
}

// ─── Editor State ────────────────────────────────────────────
export interface EditorState {
  features: ParkFeatureCollection;
  selectedFeatureIds: string[];
  activeTool: ToolMode;
  cursorPosition: [number, number] | null; // [lng, lat]
  liveMeasurement: string | null;
  undoStack: ParkFeatureCollection[];
  redoStack: ParkFeatureCollection[];
  savedSnapshot: ParkFeatureCollection;
  layerVisibility: Record<ParkLayer, boolean>;
  parkVisibility: Record<string, boolean>; // per-park visibility keyed by park feature id
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  isDrawing: boolean;
  snappingEnabled: boolean;
  measurementState: MeasurementState | null;
  vertexEditFeatureId: string | null; // ID of feature currently in vertex edit mode
  vertexEditPartIndex: number | null; // For MultiPolygon/MultiLineString: which part is being edited
  drawingParts: DrawingParts | null; // accumulated multi-part coordinates
  drawingPartsType: DrawingPartsType | null; // what kind of multi-part drawing
  continueDrawingState: ContinueDrawingState | null; // active continue-drawing session
}

// ─── Editor Actions ──────────────────────────────────────────
export type EditorAction =
  | { type: "SET_TOOL"; tool: ToolMode }
  | { type: "ADD_FEATURE"; feature: ParkFeature }
  | { type: "UPDATE_FEATURE"; feature: ParkFeature }
  | { type: "DELETE_FEATURES"; ids: string[] }
  | { type: "SELECT_FEATURES"; ids: string[] }
  | { type: "SET_CURSOR"; position: [number, number] | null }
  | { type: "SET_LIVE_MEASUREMENT"; measurement: string | null }
  | { type: "SET_FEATURES"; features: ParkFeatureCollection }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "SAVE" }
  | { type: "CANCEL" }
  | { type: "TOGGLE_LEFT_PANEL" }
  | { type: "TOGGLE_RIGHT_PANEL" }
  | { type: "SET_RIGHT_PANEL"; open: boolean }
  | { type: "SET_DRAWING"; isDrawing: boolean }
  | { type: "TOGGLE_SNAPPING" }
  | { type: "TOGGLE_LAYER_VISIBILITY"; layer: ParkLayer }
  | { type: "TOGGLE_PARK_VISIBILITY"; parkId: string }
  | { type: "SET_MEASUREMENT_STATE"; state: MeasurementState | null }
  | { type: "DUPLICATE_FEATURES"; ids: string[] }
  | { type: "MERGE_FEATURES"; ids: string[] }
  | { type: "REPLACE_FEATURES"; oldIds: string[]; newFeatures: ParkFeature[] }
  | { type: "REASSIGN_FEATURE"; featureId: string; parkId: string | null }
  | { type: "LOAD_SAVED"; features: ParkFeatureCollection }
  | { type: "ENTER_VERTEX_EDIT"; featureId: string; partIndex?: number }
  | { type: "EXIT_VERTEX_EDIT" }
  | { type: "APPEND_DRAWING_PART"; partType: DrawingPartsType; coordinates: Position[] | Position[][] }
  | { type: "FINISH_MULTI_DRAWING" }
  | { type: "CLEAR_DRAWING_PARTS" }
  | { type: "BULK_UPDATE_PROPERTIES"; ids: string[]; properties: Partial<ParkFeatureProperties> }
  | { type: "START_CONTINUE_DRAWING"; featureId: string; partIndex: number | null; ringIndex: number; vertexIndex: number; geometryType: "line" | "polygon"; insertDirection: "append" | "prepend" }
  | { type: "ADD_CONTINUE_VERTEX"; position: Position }
  | { type: "UNDO_CONTINUE_VERTEX" }
  | { type: "FINISH_CONTINUE_DRAWING" }
  | { type: "CANCEL_CONTINUE_DRAWING" };
