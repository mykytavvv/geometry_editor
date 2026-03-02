# Agent Guide: Park Geometry Editor

## Project Overview

A Japanese-language park management geometry editor built with Next.js 16 (App Router), MapLibre GL, and MapboxDraw. The application allows municipal park administrators to view, create, edit, and measure geographic features (points, lines, polygons, text labels) on an interactive map centered on Chikusa Park (千種公園) in Nagoya, Japan.

The UI is entirely in Japanese. The app title is "公園管理 - ジオメトリエディター".

**Current stage**: Functional MVP with mock data. No backend/API — features are persisted to `localStorage`. Some features are scaffolded (see "Incomplete Features" below). Multi-geometry support (MultiLineString, MultiPolygon) has been implemented with unified drawing UX and vertex editing. Vertex editing supports all editable geometry types: Polygon, MultiPolygon, LineString, and MultiLineString. Continue drawing from a selected vertex is supported (Figma-style: select vertex in vertex edit, press G/L to extend). Polygon clipping (boolean subtraction) has been implemented. Point tool is persistent (continuous placement). Multi-select supports shift+click in both select and draw_point modes. Bulk property editing is supported for multi-selected features.

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router) | 16.1.6 |
| Language | TypeScript | ^5 |
| React | React | 19.2.3 |
| Map Engine | MapLibre GL | ^5.19.0 |
| Drawing | @mapbox/mapbox-gl-draw | ^1.5.1 |
| Geo Calculations | @turf/turf | ^7.3.4 |
| UI Components | shadcn/ui (New York style) + Radix UI | ^1.4.3 |
| Icons | lucide-react | ^0.575.0 |
| Styling | Tailwind CSS v4 + CSS variables | ^4 |
| Toasts | sonner | ^2.0.7 |
| IDs | uuid | ^13.0.0 |
| Font | Noto Sans JP (via next/font/google) | — |

---

## File Tree

```
src/
├── app/
│   ├── favicon.ico
│   ├── globals.css                          # Tailwind v4 + shadcn theme + park color tokens
│   ├── layout.tsx                           # Root layout: Noto Sans JP font, TooltipProvider, Toaster
│   ├── page.tsx                             # Redirects to /geometry-editor
│   └── geometry-editor/
│       └── page.tsx                         # Main editor page (orchestrator): multi-draw auto-finalize, canMerge for Multi*, floating 完了/キャンセル element, fly-to handler
├── components/
│   ├── layout/
│   │   ├── header.tsx                       # Top bar: breadcrumbs, save/cancel, user display
│   │   └── side-nav.tsx                     # Left sidebar: app navigation, collapses to icon-only (56px), hosts layer panel pill toggle
│   └── ui/                                  # shadcn/ui primitives (do not modify directly)
│       ├── badge.tsx
│       ├── button.tsx
│       ├── card.tsx
│       ├── collapsible.tsx
│       ├── dialog.tsx
│       ├── dropdown-menu.tsx
│       ├── input.tsx
│       ├── label.tsx
│       ├── scroll-area.tsx
│       ├── select.tsx
│       ├── separator.tsx
│       ├── sheet.tsx
│       ├── sonner.tsx
│       ├── tabs.tsx
│       ├── textarea.tsx
│       ├── toggle.tsx
│       └── tooltip.tsx
├── features/
│   └── geometry-editor/
│       ├── constants.ts                     # Map config, layer colors, tool groups, snap thresholds, multi-draw layer IDs, continue-draw layer IDs
│       ├── mock-data.ts                     # 10 sample features around Chikusa Park (facilities linked to parks via parkId)
│       ├── types.ts                         # All type definitions (ToolMode incl. draw_clip_polygon + continue_drawing, ParkFeature w/ Multi* geometry, EditorState incl. ContinueDrawingState, EditorAction incl. BULK_UPDATE_PROPERTIES + continue drawing actions, DrawingPartsType)
│       ├── components/
│       │   ├── attribute-editor.tsx          # Key-value attribute editor for linkedAttributes
│       │   ├── coordinate-input-dialog.tsx   # Dialog for WGS84 coordinate entry (point only)
│       │   ├── floating-toolbar.tsx          # Bottom-center toolbar: tools, edit ops, measure, history, precision
│       │   ├── layer-panel.tsx               # Left overlay: park-based hierarchy (each park is a collapsible group with nested facilities), per-park visibility toggles, per-group & per-feature fly-to buttons (LocateFixed icon), draft as top-level group. Multi* type icons.
│       │   ├── map-editor.tsx               # Core map component: MapLibre init, layers, events, keyboard shortcuts, drag-to-move, vertex edit integration, continue drawing integration, multi-part drawing lifecycle, clip polygon interception
│       │   ├── properties-panel.tsx          # Right overlay: 2-tab panel (properties, geometry), layer dropdown + parkId selector with auto-assign, pill toggle on left edge. Multi* type icons/labels and coordinate display. Bulk editing UI for multi-select (layer, parkId, icon, size).
│       │   ├── status-bar.tsx               # Bottom status: cursor coords, active tool (incl. クリップ領域描画), live measurement, feature count, multi-part drawing state
│       │   └── text-input-dialog.tsx         # Dialog for text label placement
│       ├── hooks/
│       │   ├── use-continue-drawing.ts       # Continue drawing from vertex: custom MapLibre overlay (rubber-band, snap indicator, snap-to-finish on same-feature vertices)
│       │   ├── use-editor-state.ts           # Central state management (useReducer, 36 actions, undo/redo, multi-draw parts, continue drawing, bulk property updates)
│       │   ├── use-map-draw.ts              # MapboxDraw integration and lifecycle
│       │   ├── use-measurement.ts            # Measurement workflow (start, add point, finish, save as geometry)
│       │   ├── use-snapping.ts              # Vertex snapping wrapper
│       │   └── use-vertex-edit.ts           # Vertex editing for Polygon/MultiPolygon/LineString/MultiLineString (drag, add, delete vertices via custom MapLibre layers, part-aware). Exports getSelectedVertex(), isLineGeometry(), isPolygonGeometry(), getEditableCoords().
│       └── lib/
│           ├── camera.ts                    # Map camera utilities: flyToLayer() — fly/zoom to fit a set of features (turf.bbox + MapLibre flyTo/fitBounds)
│           ├── geometry-ops.ts              # Duplicate, merge, clip (boolean subtraction), create features, normalizeDrawingParts, normalizeToPolygonGeometry (Turf.js). Multi* geometry support.
│           ├── measurement.ts               # Distance/area/perimeter calculation + formatting (Turf.js). Multi* geometry metrics.
│           ├── snapping.ts                  # Vertex snapping logic (edge snapping stubbed)
│           ├── spatial-utils.ts             # Spatial utilities: findContainingPark() for auto-assigning facilities to parks (Turf.js). Handles all 5 geometry types.
│           └── storage.ts                   # localStorage persistence: saveFeatures(), loadFeatures()
├── lib/
│   └── utils.ts                             # cn() utility (clsx + tailwind-merge)
└── types/
    └── mapbox-gl-draw.d.ts                  # TypeScript declarations for @mapbox/mapbox-gl-draw
```

---

## Architecture

### Routing

- `/` redirects to `/geometry-editor` via `next/navigation redirect()`.
- `/geometry-editor` is the only real page — a `"use client"` component that renders the entire editor.
- The app is effectively a single-page application.

### State Management

No external state library (no Redux, Zustand, or Context). All state lives in a single `useReducer` hook (`use-editor-state.ts`).

**State shape** (`EditorState`):
```typescript
{
  features: ParkFeatureCollection;           // All features
  selectedFeatureIds: string[];              // Currently selected
  activeTool: ToolMode;                      // Active tool (13 modes)
  cursorPosition: [number, number] | null;   // Mouse [lng, lat]
  liveMeasurement: string | null;            // Measurement display string
  undoStack: ParkFeatureCollection[];        // Max 50 snapshots
  redoStack: ParkFeatureCollection[];        // Redo snapshots
  savedSnapshot: ParkFeatureCollection;      // Last saved state (for dirty detection)
  layerVisibility: Record<ParkLayer, boolean>;
  parkVisibility: Record<string, boolean>;   // Per-park visibility keyed by park feature id
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  isDrawing: boolean;
  snappingEnabled: boolean;
  measurementState: MeasurementState | null;
  vertexEditFeatureId: string | null;       // ID of feature in vertex edit mode
  vertexEditPartIndex: number | null;       // For MultiPolygon/MultiLineString: which part is being edited
  drawingParts: Position[][] | Position[][][] | null;  // Accumulated parts during multi-part drawing
  drawingPartsType: "line" | "polygon" | null;          // Type of parts being drawn
  continueDrawingState: ContinueDrawingState | null;    // Active continue-drawing session
}
```

**`ContinueDrawingState`**:
```typescript
{
  featureId: string;                         // Feature being extended
  partIndex: number | null;                  // For Multi* types: which part
  ringIndex: number;                         // Which ring (0 for lines, 0+ for polygon holes)
  vertexIndex: number;                       // The vertex we're continuing from
  insertDirection: "append" | "prepend";     // For lines: append at end or prepend at start
  newVertices: Position[];                   // Vertices placed so far (in drawing order)
  geometryType: "line" | "polygon";
}
```

**Reducer actions** (36 types): `SET_TOOL`, `ADD_FEATURE`, `UPDATE_FEATURE`, `BULK_UPDATE_PROPERTIES`, `DELETE_FEATURES`, `SELECT_FEATURES`, `SET_CURSOR`, `SET_LIVE_MEASUREMENT`, `SET_FEATURES`, `UNDO`, `REDO`, `SAVE`, `CANCEL`, `TOGGLE_LEFT_PANEL`, `TOGGLE_RIGHT_PANEL`, `SET_RIGHT_PANEL`, `SET_DRAWING`, `TOGGLE_SNAPPING`, `TOGGLE_LAYER_VISIBILITY`, `TOGGLE_PARK_VISIBILITY`, `SET_MEASUREMENT_STATE`, `DUPLICATE_FEATURES`, `MERGE_FEATURES`, `REPLACE_FEATURES`, `REASSIGN_FEATURE`, `LOAD_SAVED`, `ENTER_VERTEX_EDIT`, `EXIT_VERTEX_EDIT`, `APPEND_DRAWING_PART`, `FINISH_MULTI_DRAWING`, `CLEAR_DRAWING_PARTS`, `START_CONTINUE_DRAWING`, `ADD_CONTINUE_VERTEX`, `UNDO_CONTINUE_VERTEX`, `FINISH_CONTINUE_DRAWING`, `CANCEL_CONTINUE_DRAWING`.

**Undo/redo**: Before any feature mutation, the entire features collection is deep-cloned (`JSON.parse(JSON.stringify(...))`) and pushed to the undo stack. Redo stack is cleared on new actions.

**Derived state** (via `useMemo`): `selectedFeatures`, `visibleFeatures` (filtered by both layer visibility and per-park visibility), `canUndo`, `canRedo`, `isDirty`.

The `useEditorState` hook returns `state`, `dispatch`, 36 memoized action callbacks (including `enterVertexEdit(featureId, partIndex?)`, `exitVertexEdit()`, `appendDrawingPart()`, `finishMultiDrawing()`, `clearDrawingParts()`, `bulkUpdateProperties(ids, properties)`, `startContinueDrawing()`, `addContinueVertex()`, `undoContinueVertex()`, `finishContinueDrawing()`, `cancelContinueDrawing()`), and derived state. The return type is exported as `EditorActions`.

### Component Hierarchy

```
GeometryEditorPage (orchestrator)
├── SideNav (collapsible left sidebar: 208px expanded / 56px icon-only collapsed)
│   ├── PanelLeft icon button in header → collapses sidebar
│   ├── Icon-only nav with tooltips (collapsed state, hover shows sub-items)
│   └── Pill button on right edge → toggles LayerPanel (only visible when panel closed)
├── Header (breadcrumbs, save/cancel buttons, user info)
├── MapEditor (map + all map interactions)
│   ├── useMapDraw (MapboxDraw integration)
│   ├── useVertexEdit (vertex editing overlay for Polygon/MultiPolygon/LineString/MultiLineString)
│   └── useContinueDrawing (continue drawing overlay with rubber-band and snap-to-finish)
├── LayerPanel (left overlay, park-based hierarchy: each park as collapsible group with nested facilities, draft as top-level, fly-to buttons on group headers and feature rows)
│   └── Pill button on right edge → closes panel (only visible when panel open)
├── PropertiesPanel (right overlay, 2-tab property editor: properties + geometry, bulk editing for multi-select)
│   └── Pill button on left edge → toggles panel
├── StatusBar (bottom info bar)
├── FloatingToolbar (bottom-center tool palette)
├── Floating 完了/キャンセル element (bottom-20, above toolbar, visible during multi-draw)
├── Floating 描画延長中 element (bottom-20, amber-themed, visible during continue drawing — shows vertex count, 確定/キャンセル buttons)
├── TextInputDialog (modal for text placement)
└── CoordinateInputDialog (modal for coordinate entry)
```

### Data Flow

1. `useEditorState(MOCK_FEATURES)` initializes state with mock data (ensures SSR/client match).
2. On mount, a `useEffect` calls `loadFeatures()` from `localStorage`. If saved data exists, it dispatches `LOAD_SAVED` to replace features and savedSnapshot (no undo entry, no dirty state).
3. `visibleFeatures` is derived by filtering features by `layerVisibility` and `parkVisibility`.
4. `MapEditor` receives `visibleFeatures` and syncs them to the MapLibre GeoJSON source.
5. User interactions (clicks, draws, drags) in `MapEditor` call editor action callbacks.
6. State updates flow back down as new props.
7. On save, `saveFeatures()` writes the current features to `localStorage`.
8. Measurement clicks are routed via `CustomEvent("map:measurement-click")` on `window`.
9. Fly-to: `LayerPanel` calls `onFlyToFeatures(features)` → `page.tsx` handler → `flyToLayer(map, features)` → MapLibre `flyTo`/`fitBounds`. Pure camera movement, no state mutations.

---

## Domain Model

### ParkFeature (GeoJSON-compatible)
```typescript
interface ParkFeature {
  id: string;                                // UUID
  type: "Feature";
  geometry: Point | LineString | Polygon | MultiLineString | MultiPolygon;
  properties: {
    type: "point" | "line" | "polygon" | "text" | "multiline" | "multipolygon";
    label?: string;
    icon?: string;                           // For points: marker, tree, bench, fountain, etc.
    size?: number;                           // Circle radius or text font size
    linkedAttributes?: Record<string, string | number | boolean>;  // Custom key-value data
    layer?: "park" | "facilities" | "draft";
    parkId?: string;                         // For facilities: references the id of a parent park feature
  };
}
```

### Layers (3)
| ID | Japanese Label | Color | Purpose |
|---|---|---|---|
| `park` | 公園 | `#4a7c59` (green) | Park boundary polygons (each becomes a group in layer panel) and park sub-features (e.g. text labels with `parkId`) |
| `facilities` | 施設 | `#2563eb` (blue) | Equipment, paths, facilities — nested under their parent park via `parkId` |
| `draft` | 下書き | `#9333ea` (purple) | New/unsaved features (default, top-level) |

### Layer Panel Hierarchy
Parks are groups, facilities are children. Each park boundary feature (layer: `"park"`, no `parkId`) defines a collapsible group in the layer panel. Features with `parkId` matching a park's `id` appear as children under that park. Draft features appear in a separate top-level "下書き" group. Unassigned facilities (no valid `parkId`) appear in an "未割当" section.

Each group header has a fly-to button (LocateFixed icon) that moves the map camera to frame all features in that group. Individual feature rows also have a fly-to button (visible on hover). The fly-to buttons use `flyToLayer()` from `lib/camera.ts` — pure camera movement that does not affect selection, drawing mode, or geometry state.

```
📁 千種公園 (8)            ← park group (visibility toggle hides park + all children)
   Chikusa Park 千種公園   ← park sub-feature (text label, parkId → park)
   メイン遊歩道            ← facility (parkId → park)
   東側遊歩道
   遊具エリア
   ベンチ B-01
   トイレ T-01
   街灯 L-01
   倒木報告
📁 中央広場 (0)            ← separate park group
📁 下書き (0)              ← draft layer (top-level)
```

### Park-Facility Association
- Facilities reference their parent park via `parkId` (string matching the park feature's `id`).
- When a feature's layer is changed to `"facilities"` in the properties panel, the system auto-assigns `parkId` by checking which park polygon contains the feature (using Turf.js `booleanPointInPolygon`).
- Users can manually override `parkId` via a dropdown in the properties panel listing all park features.

### Tool Modes (13)
| Mode | Label | Shortcut | Status |
|---|---|---|---|
| `select` | 選択 | V | Implemented |
| `pan` | パン | H | Implemented |
| `draw_point` | ポイント | P | Implemented (persistent — stays in point mode after each placement) |
| `draw_line` | ライン | L | Implemented |
| `draw_polygon` | ポリゴン | G | Implemented |
| `draw_text` | テキスト | T | Implemented |
| `move` | 移動 | — | Defined, not toolbar-exposed (drag in select mode instead) |
| `vertex_edit` | 頂点編集 | Dbl-click | Implemented for Polygon/MultiPolygon/LineString/MultiLineString (custom MapLibre layers, not MapboxDraw) |
| `continue_drawing` | 描画延長 | G/L from vertex edit | Implemented — extends existing geometry from a selected vertex |
| `measure_distance` | 距離測定 | M | Implemented |
| `measure_area` | 面積測定 | A | Implemented |
| `coordinate_input` | 座標入力 | — | Implemented (point only) |
| `draw_clip_polygon` | クリップ領域描画 | — | Implemented (scissors button, draws polygon cutter for boolean subtraction) |

---

## Map Integration

### Map Setup (`map-editor.tsx`)
- **Engine**: MapLibre GL with OSM raster tiles (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`)
- **Center**: `[136.9389, 35.1644]` (Chikusa Park, Nagoya)
- **Default zoom**: 15
- **Controls**: NavigationControl (top-right, no compass), ScaleControl (bottom-left)

### GeoJSON Sources and Layers
Four GeoJSON sources (three permanent, one dynamic) with 13+ layers.

**Note on Multi* geometry and layer filters**: MapLibre layer filters like `["==", ["geometry-type"], "Polygon"]` automatically match both `Polygon` and `MultiPolygon`. Same for `LineString`/`MultiLineString`. No layer filter changes were needed for Multi* support.

**Source `park-features`** (main data):
- `park-polygons-fill` — per-layer colored fill, opacity 0.25
- `park-polygons-outline` — per-layer dashed outline
- `park-lines` — per-layer colored lines, width 3
- `park-points` — circles (non-text), radius from `size` property
- `park-text` — symbol layer for point labels, layer-aware text sizing (park: 18px, facilities: 12px, draft: 14px default)
- `park-text-lines` — symbol layer for line labels along path, layer-aware sizing (park: 14px, facilities: 11px)
- `park-text-polygons` — symbol layer for polygon labels at centroid, layer-aware sizing (park: 16px, facilities: 12px)
- `selected-fill` / `selected-outline` / `selected-point` — selection highlights (green `#3d6b4f`)

**Source `measurement-features`** (measurement overlay):
- `measurement-fill` — amber fill (`#f59e0b`, opacity 0.15)
- `measurement-line` — amber dashed line
- `measurement-points` — amber circles

**Source `multi-draw-preview`** (multi-part drawing preview):
- `multi-draw-fill` — green fill (`#4a7c59`, opacity 0.2) for accumulated polygon parts
- `multi-draw-line` — green dashed line for accumulated line parts
- `multi-draw-points` — green circles at line endpoints

**Source `continue-draw-features`** (dynamic, created/destroyed on continue drawing enter/exit):
- `continue-draw-existing-line` — amber dashed outline of the existing geometry being extended (dimmed, opacity 0.4)
- `continue-draw-new-line` — green solid line for newly drawn path + amber dashed closing line for polygons
- `continue-draw-vertices` — white vertex handles for new vertices + amber anchor point (the vertex drawing continues from)

**Source `continue-draw-rubberband`** (dynamic, updated on every mousemove):
- `continue-draw-rubberband-line` — green dashed line from last placed vertex to cursor
- `continue-draw-snap-indicator` — green circle that appears when cursor hovers over an existing vertex of the same feature (snap-to-finish target)

**Source `vertex-edit-features`** (dynamic, created/destroyed on vertex edit enter/exit):
- `vertex-edit-outline` — amber solid outline of the feature part being edited (renders as Polygon for polygon types, LineString for line types)
- `vertex-edit-vertices` — white vertex handles at each vertex (stroke: amber)
- `vertex-edit-selected-vertex` — amber-filled circle for the selected vertex
- `vertex-edit-midpoints` — smaller semi-transparent amber circles on each edge midpoint (for polygons: wraps around; for lines: between consecutive pairs only)
- Context outlines — for Multi* types, non-edited parts are shown as faded context outlines (`role: "context"`, Polygon for MultiPolygon, LineString for MultiLineString)

### MapboxDraw Integration (`use-map-draw.ts`)
- Added as a map control with custom green-themed draw styles.
- Default UI controls hidden; modes switched programmatically.
- `draw.create` converts MapboxDraw features to `ParkFeature` with new UUID, then removes from draw. For points, re-enters `draw_point` mode after 50ms so the user can keep placing points continuously. A `suppressNextCreateRef` allows the map click handler to suppress unwanted point creation (e.g. when shift+clicking for multi-select).
- `draw.update` maps back to existing features via `_parkId` property.
- Mode mapping: `draw_point`→`draw_point`, `draw_line`→`draw_line_string`, `draw_polygon`/`draw_clip_polygon`→`draw_polygon`, `draw_text`→`draw_point`, all others→`simple_select`.
- **Post-creation selection guard** (`justCreatedAtRef`): When a feature is created, MapboxDraw fires spurious `draw.selectionchange` events with empty features (from its internal mode switch to `simple_select` and from our `activeTool` sync effect). A timestamp-based ref (`justCreatedAtRef`) suppresses empty selection-change events for 300ms after creation, and also skips the redundant `draw.changeMode("simple_select")` call in the tool-sync effect. Without this guard, newly created features would appear unselected.

### Persistent Point Tool
The point tool (`draw_point`) is persistent — after placing a point, the tool stays in `draw_point` mode so the user can keep placing points without re-selecting the tool. Each new point replaces the previous selection and opens the properties panel. MapboxDraw auto-exits to `simple_select` after placing a point, so the hook re-enters `draw_point` mode after 50ms.

**Shift+click multi-select in point mode**: While in `draw_point` mode, shift+clicking an existing feature toggles it in/out of the selection (same behavior as shift+click in `select` mode). The `suppressNextCreateRef` flag prevents MapboxDraw from placing an unwanted point on the shift+click. If shift+click hits empty space, no point is placed (prevents accidental placement while shift is held).

### Drag-to-Move
- In select mode, mousedown on a selected feature initiates drag.
- Disables `map.dragPan`, translates all coordinates in real-time via direct source update.
- On mouseup, commits via `editor.updateFeature()`.
- `justDraggedRef` prevents click-deselect after drag.
- **Park group drag**: An `effectiveMoveIds` memo expands the selected IDs to include all child features when a park boundary is selected. If any selected feature is a park-defining boundary (layer: `"park"`, no `parkId`), all features whose `parkId` matches that park's `id` are included in the move. Children move silently (not added to visual selection).

### Multi-Part Drawing (`map-editor.tsx` + `use-editor-state.ts`)
Unified drawing UX — existing Line (L) and Polygon (G) toolbar buttons support multi-part drawing. After double-click completes a part, the editor stays in drawing mode so the user can draw additional parts. Auto-normalize: 1 part → simple geometry (`LineString`/`Polygon`), 2+ parts → Multi* geometry (`MultiLineString`/`MultiPolygon`).

**Lifecycle**:
1. User selects Line or Polygon tool and draws a part (completed via double-click).
2. `handleFeatureCreated` intercepts the created feature, calls `editor.appendDrawingPart()` to store the coordinates.
3. Tool briefly switches to `select` (so MapboxDraw enters `simple_select` and the double-click event fully settles), then back to `draw_line`/`draw_polygon` after 300ms.
4. Accumulated parts are shown as a green dashed preview via the `multi-draw-preview` source.
5. User can finish via Enter key, 完了 button, or Escape (all finalize accumulated parts). Cancel button discards all parts.
6. `finishMultiDrawing()` calls `normalizeDrawingParts()` which produces the correct geometry type and adds the feature.

**Floating 完了/キャンセル element**: A separate floating element positioned above the main toolbar (`bottom-20`) with glassmorphism styling. Only visible when `drawingParts.length > 0`. Contains 完了 (Finish) and キャンセル (Cancel) buttons.

### Vertex Editing (`hooks/use-vertex-edit.ts` + `map-editor.tsx`)
Custom vertex editing for Polygon, MultiPolygon, LineString, and MultiLineString geometries, rendered entirely via native MapLibre layers (not MapboxDraw's `direct_select`). This avoids dual-state coordination between the app and MapboxDraw.

**Activation**: Double-click a Polygon, MultiPolygon, LineString, or MultiLineString while in `select` mode. Dispatches `ENTER_VERTEX_EDIT` which sets `vertexEditFeatureId`, `vertexEditPartIndex`, and switches `activeTool` to `"vertex_edit"`. For MultiPolygon, the clicked part is determined via `turf.booleanPointInPolygon` against each polygon part. For MultiLineString, the clicked part is determined by finding the nearest line segment (point-to-segment distance).

**Part-aware editing**: The `getEditableCoords()` helper extracts the correct coordinate arrays based on geometry type and `partIndex`, returning a uniform `Position[][]` shape:
- Polygon: returns coordinates directly (array of rings).
- MultiPolygon: returns `coordinates[partIndex]` (one polygon's rings).
- LineString: wraps coordinates as `[coordinates]` (single-element array to match ring shape).
- MultiLineString: wraps `coordinates[partIndex]` as `[coordinates[partIndex]]`.

All edit operations (drag, add, delete) work on the extracted coordinate arrays, then `rebuildFeatureWithCoords()` reconstructs the full geometry on commit, handling all four geometry types.

**Polygon vs Line differences**:
- Polygons have closed rings (first coord == last coord); vertex count excludes the closing vertex. Lines are open paths; all vertices are editable.
- Polygon midpoints wrap around (last→first edge included). Line midpoints only appear between consecutive vertices (no wrap).
- Polygon closure is maintained automatically when dragging/adding/deleting vertices. Lines have no closure.
- Minimum vertices: 3 for polygons (triangle), 2 for lines (segment).

**Interactions**:
- **Move vertex**: Mousedown on a vertex handle starts drag (disables `map.dragPan`). Mousemove updates vertex position in real-time via direct source update. Mouseup commits via `editor.updateFeature()` (creates undo entry). Snapping to other features' vertices is supported during drag.
- **Add vertex**: Click a midpoint handle to insert a new vertex at that position. The midpoint becomes a full vertex and is auto-selected.
- **Delete vertex**: Click or right-click a vertex to select it (turns amber), then press `Delete` or `Backspace`. Minimum 3 vertices for polygons, 2 for lines. For Multi* types, the full geometry is reconstructed after deletion.
- **Exit**: Press `Escape` or click empty map space (no vertex/midpoint hit). Dispatches `EXIT_VERTEX_EDIT`.

**Multi* context outlines**: For MultiPolygon, non-edited parts are shown as faded polygon context outlines. For MultiLineString, non-edited parts are shown as faded line context outlines.

**State cleanup**: `vertexEditFeatureId` and `vertexEditPartIndex` are cleared on undo, redo, cancel, and tool switch. The vertex edit layers/source are removed from the map when exiting.

### Continue Drawing from Vertex (`hooks/use-continue-drawing.ts` + `page.tsx` + `map-editor.tsx`)
Figma-style continue drawing: select a vertex in vertex edit mode, then press G (polygon) or L (line) to start extending the geometry from that vertex. New vertices are added to the existing feature in-place (same ID, same properties).

**Trigger** (`page.tsx` `handleSetTool`):
1. User is in `vertex_edit` mode with a vertex selected (via `getSelectedVertex()` getter exposed from `useVertexEdit` through `getSelectedVertexRef`).
2. User presses G (polygon) or L (line), which calls `handleSetTool("draw_polygon")` / `handleSetTool("draw_line")`.
3. `handleSetTool` detects: `vertexEditFeatureId` is set + a vertex is selected + the draw tool matches the geometry type (G for polygons, L for lines).
4. For **lines**: only endpoint vertices (first or last) trigger continue drawing. Mid-vertex selection falls through to normal fresh draw mode.
5. For **polygons**: any vertex is valid.
6. Dispatches `START_CONTINUE_DRAWING` instead of `SET_TOOL`, which enters `continue_drawing` mode.
7. If the geometry type doesn't match (e.g. pressing G while editing a line), falls through to normal draw mode.

**Drawing interaction** (`use-continue-drawing.ts`):
- Custom MapLibre overlay (not MapboxDraw) with 2 GeoJSON sources and 5 layers.
- **Click**: Places a new vertex. Position is snapped to all features (including the feature being edited).
- **Mousemove**: Updates rubber-band line from last placed vertex to cursor. Performs snapping.
- **Double-click**: Finishes drawing (the first click adds a vertex via the click handler, then finish is called).
- **Enter**: Finishes drawing.
- **Escape**: Cancels (discards all new vertices, restores original geometry).
- **Backspace/Delete**: Removes the last placed vertex.
- Cursor is `crosshair` during drawing, changes to `pointer` when hovering a snap-to-finish target.

**Snap-to-finish on existing vertices**:
When the cursor hovers near an existing vertex of the same feature being edited (excluding the anchor vertex):
- A green snap indicator circle (radius 9, semi-transparent fill + green stroke) appears on the vertex.
- The cursor changes to `pointer`.
- **Clicking finishes the drawing** instead of adding a new vertex. The new vertices are inserted into the geometry, connecting cleanly to the existing vertex. Requires at least 1 new vertex to have been placed.
- This uses `findNearestVertex()` **without** excluding the edited feature. The `performSnap()` helper identifies same-feature snaps while excluding the anchor point.

**Geometry modification** (`FINISH_CONTINUE_DRAWING` reducer):
- **Lines (append)**: New vertices appended at the end of the coordinate array.
- **Lines (prepend)**: New vertices reversed and prepended at the start.
- **Polygons**: New vertices spliced after `vertexIndex` in the ring. Polygon closure is maintained (last coord = first coord).
- For Multi* types, the specific part is updated via `partIndex`.
- An undo snapshot is pushed — one Ctrl+Z reverts the entire extension.
- If no new vertices were placed, no geometry change is made (exits cleanly).

**State cleanup**: `continueDrawingState` is cleared on finish, cancel, undo, redo, tool switch, and cancel-editor. The continue drawing layers/sources are removed from the map when exiting.

**Floating action bar** (`page.tsx`): Amber-themed bar positioned at `bottom-20` (above main toolbar). Shows "描画延長中" label with vertex count, キャンセル (Esc) and 確定 (Enter) buttons. Only visible when `continueDrawingState` is not null. 確定 button is disabled when no new vertices have been placed.

### Post-Creation Click Guard (`map-editor.tsx`)
- When finishing geometry creation (double-click to close polygon, etc.), the second click of the double-click can propagate as a regular map click. Since the new feature data may not yet be rendered in the map source, `queryRenderedFeatures` returns empty → "click on empty space" deselects.
- `justCreatedFeatureRef` (timestamp) suppresses map click events for 300ms after feature creation, similar pattern to `justDraggedRef` for drag-to-move.

### Keyboard Shortcuts
| Key | Action | Context |
|---|---|---|
| V | Select tool | Not drawing |
| H | Pan tool | Not drawing |
| P | Draw point (persistent) | Not drawing |
| L | Draw line (or continue drawing from line endpoint vertex) | Not drawing / vertex edit with endpoint selected |
| G | Draw polygon (or continue drawing from polygon vertex) | Not drawing / vertex edit with vertex selected |
| T | Draw text | Not drawing |
| M | Measure distance | Not drawing |
| A | Measure area | Not drawing |
| Ctrl+Z | Undo (or trash last vertex while drawing) | Always |
| Ctrl+Shift+Z / Ctrl+Y | Redo | Always |
| Ctrl+D | Duplicate selected | Always |
| Enter | Finish multi-part drawing / finish continue drawing | Multi-draw or continue drawing active |
| Delete | Delete selected feature (or delete selected vertex in vertex edit) | Has selection |
| Escape | Exit vertex edit / cancel continue drawing / finalize multi-draw / cancel draw / clear measurement / deselect | Always |
| Backspace | Remove last vertex (drawing) / remove last new vertex (continue drawing) / delete selected vertex (vertex edit) | While drawing / continue drawing / vertex edit |
| Double-click | Enter vertex edit mode on Polygon/MultiPolygon/LineString/MultiLineString | Select mode, polygon or line hit |

**Note**: During `continue_drawing` mode, all keyboard shortcuts are handled by the `useContinueDrawing` hook — the main keyboard handler in `map-editor.tsx` returns early. Tool shortcuts (V, H, etc.) are blocked during continue drawing.

---

## Key Subsystems

### Measurement (`lib/measurement.ts` + `hooks/use-measurement.ts`)
- **Pure functions**: `calculateDistance`, `calculateArea`, `calculatePerimeter`, `segmentDistance`, `formatDistance`, `formatArea`, `calculateFeatureMetrics` — all use Turf.js.
- **Formatting**: `< 1m` → cm, `< 1000m` → m, else km; `< 1m²` → cm², `< 10000m²` → m², else ha.
- **Workflow hook**: `startMeasurement(mode)` → click to `addMeasurementPoint()` → `finishMeasurement()` or `saveAsGeometry()`.
- **Save as geometry**: Distance measurement → LineString on draft layer; area measurement → Polygon on draft layer, with formatted label.

### Geometry Operations (`lib/geometry-ops.ts`)
| Function | Status | Notes |
|---|---|---|
| `duplicateFeature()` | Complete | Deep clone, new UUID, +0.0003 offset (~30m), "(コピー)" suffix. Handles all 5 geometry types including Multi*. |
| `mergePolygons()` | Complete | `turf.union`, produces MultiPolygon for disjoint parts (previously discarded smaller parts) |
| `mergeLines()` | Complete | Coordinate concatenation, deduplicates shared endpoints. Produces MultiLineString for disjoint lines. |
| `normalizeToPolygonGeometry()` | Complete | Normalizes Turf result geometry (Polygon, MultiPolygon, or GeometryCollection) into clean Polygon or MultiPolygon. Extracts polygon parts from GeometryCollection and combines into MultiPolygon. |
| `clipPolygon()` | Complete | Boolean subtraction via `turf.difference`. Accepts target Polygon/MultiPolygon + cutter Polygon/MultiPolygon. Returns SAME feature (preserved id, properties, layer, parkId) with updated geometry. Disjoint results → MultiPolygon, holes → interior rings. Uses `normalizeToPolygonGeometry()` for edge cases. |
| `createDefaultFeature()` | Complete | Factory with defaults, assigns to draft layer. Supports all 5 geometry types. |
| `normalizeDrawingParts()` | Complete | Converts accumulated drawing parts to the correct geometry: 1 part → simple (LineString/Polygon), 2+ parts → Multi* (MultiLineString/MultiPolygon) |
| `offsetGeometry()` | Complete | Handles all 5 geometry types for duplicate offset |

### Snapping (`lib/snapping.ts` + `hooks/use-snapping.ts`)
- **Vertex snapping**: Extracts all vertices from all features (Point, LineString, MultiLineString, Polygon, MultiPolygon), projects to screen coords via map's `project()`, finds nearest within `SNAP_THRESHOLD_PX` (10px).
- **Edge snapping**: Stubbed — `findNearestEdge()` always returns `{snapped: null}`.
- **Combined**: `snapPoint()` currently only does vertex snap (edge comparison commented out).

### Camera Utilities (`lib/camera.ts`)
- **`flyToLayer(map, features)`**: Moves the map camera to frame all geometries in the given features array. Pure camera movement — does not modify selection, drawing, or geometry state.
  - **Single Point**: Uses `map.flyTo({ center, zoom: 17, duration: 1000, essential: true })`.
  - **Degenerate bbox** (all coordinates identical): Falls back to `flyTo` as above.
  - **Everything else**: Computes `turf.bbox()` on a FeatureCollection, then `map.fitBounds()` with `padding: 80`, `duration: 1000`, `maxZoom: 18`, `essential: true`.
  - Handles all 5 geometry types (Point, LineString, MultiLineString, Polygon, MultiPolygon) and mixed collections.
  - Wrapped in `try/catch` for graceful failure on invalid geometries.
- **Integration**: Called from `page.tsx` via `handleFlyToFeatures` callback, passed to `LayerPanel` as `onFlyToFeatures` prop. Group headers and individual feature rows invoke this callback with the relevant feature(s).

### Clip Polygon (`lib/geometry-ops.ts` + `map-editor.tsx` + `page.tsx`)
Boolean subtraction: the user draws a polygon to define a region, and that region is subtracted from the target feature's geometry using `turf.difference`. The result is always **one feature** with preserved identity (id, properties, layer, parkId).

**Workflow**:
1. User selects a single Polygon or MultiPolygon feature.
2. Clicks the scissors button (floating toolbar) → tool switches to `draw_clip_polygon` → MapboxDraw enters `draw_polygon` mode.
3. Toast: "切り取る領域をポリゴンで描画してください（ダブルクリックで確定）".
4. User draws a polygon (the "cutter") over the area to remove. Double-click to finish.
5. `handleFeatureCreated` in `map-editor.tsx` intercepts the drawn polygon (never added as a feature).
6. Calls `clipPolygon(targetFeature, cutter)` which performs `turf.difference(source, cutter)`.
7. Result is normalized via `normalizeToPolygonGeometry()` (handles GeometryCollection edge cases).
8. `editor.updateFeature(result)` updates the original feature in-place (same ID → undo/redo works, layer panel unchanged).
9. `properties.type` is updated to `"polygon"` or `"multipolygon"` based on result geometry.

**Geometry outcomes**:
- Cutter fully inside target → Polygon with interior ring (hole)
- Cutter splits target into disjoint parts → MultiPolygon (still one feature)
- Cutter covers entire target → `turf.difference` returns `null` → error toast
- Re-clipping a previously clipped MultiPolygon is supported

**Key design principle**: Clipping modifies geometry, never creates new features. ONE FEATURE → ONE GEOMETRY.

### Bulk Property Editing (`properties-panel.tsx` + `use-editor-state.ts`)
When multiple features are selected, the properties panel shows a bulk editing UI instead of the single-feature editor:
- **Selection summary**: Feature count and type breakdown badges (e.g. "3 ポイント, 2 ポリゴン").
- **Layer**: Always shown. Displays the shared value or "混在" (mixed) placeholder when values differ across selected features. Changing applies to all selected features.
- **Park assignment** (`parkId`): Shown only when ALL selected features are on the `facilities` layer. Same shared/mixed logic.
- **Icon**: Shown only when ALL selected features are points or text. Same shared/mixed logic.
- **Size**: Shown only when ALL selected features are points or text. Shows empty input with "混在" placeholder when mixed.

The `BULK_UPDATE_PROPERTIES` reducer action accepts `ids: string[]` and `properties: Partial<ParkFeatureProperties>`, merges the partial properties into each matching feature, and pushes to undo as a single step. This enables one Ctrl+Z to undo a bulk change.

Label editing is intentionally excluded from bulk editing (bulk-setting the same label is rarely useful).

---

## Styling & Theme

### Approach
- Tailwind CSS v4 with `@tailwindcss/postcss`
- shadcn/ui components with CSS custom properties (`:root` in `globals.css`)
- `cn()` utility (clsx + tailwind-merge) for conditional classes
- Dark mode variant declared but no dark values defined (light only)

### Custom Park Theme Tokens
| Token | Value | Usage |
|---|---|---|
| `--park` | `#3d6b4f` | Primary brand green: active tools, buttons, badges |
| `--park-foreground` | `#ffffff` | Text on park backgrounds |
| `--park-dark` | `#1e3428` | Darker green |
| `--park-light` | `#e8f0eb` | Light green backgrounds |
| `--park-muted` | `rgba(74,124,89,0.15)` | Subtle green tints |

Used as Tailwind classes: `bg-park`, `text-park-foreground`, `bg-park/90`, `hover:bg-park/90`, etc.

### UI Patterns
- Floating panels: `bg-background/95 backdrop-blur-sm` (glassmorphism)
- Subtle borders: `border-border/30`, `border-border/50`
- Dense sizing: `text-xs`, `text-[10px]`, `text-[11px]`, `h-6`, `h-8`
- Monospace for data: `font-mono tabular-nums` on coordinates and measurements
- **Panel pill toggles**: Thin vertical pill buttons (h-12, w-6) attached to panel edges. White bg, rounded on outer side, shadow, border without inner-side border. Vertically centered (`top-1/2 -translate-y-1/2`). Used for LayerPanel (right edge, `rounded-r-lg`) and PropertiesPanel (left edge, `rounded-l-lg`). Only one pill visible per panel at a time (open pill vs closed pill).
- **Sidebar**: White (`bg-white`), 208px expanded / 56px collapsed (icon-only with tooltips). Collapse triggered by `PanelLeft` icon in header bar.

### Map CSS Overrides (`globals.css`)
- MapLibre map uses Noto Sans JP font
- Default MapLibre bottom controls hidden (custom controls used)
- MapboxDraw default button toolbar hidden (`display: none !important`)
- Canvas outline removed

---

## Incomplete Features & TODOs

### 1. Edge Snapping
**Location**: `src/features/geometry-editor/lib/snapping.ts:91-118`
- `findNearestEdge()` is a complete stub returning `{snapped: null}`.
- `snapPoint()` only does vertex snapping; edge comparison is commented out.
- Needs: project cursor onto nearest line segment, return projected point if within threshold.

### 2. Coordinate Input for Lines and Polygons
**Location**: `src/features/geometry-editor/components/coordinate-input-dialog.tsx:86-89`
- Line and Polygon options are disabled in the dialog's select dropdown.
- Only Point coordinate input works.
- Needs: multi-coordinate entry UI for lines and polygons.

### 3. Dark Mode
- `next-themes` is installed but not configured.
- Only light theme CSS variables are defined in `globals.css`.
- Dark variant is declared (`@custom-variant dark`) but has no values.

### 4. Backend / Persistence
- No backend API or database.
- Features are persisted to `localStorage` (key: `park-geometry-editor:features`) via `lib/storage.ts`.
- On save, `saveFeatures()` writes the full `ParkFeatureCollection` to `localStorage`.
- On page load, `loadFeatures()` reads from `localStorage` and dispatches `LOAD_SAVED` (after hydration, inside `useEffect`, to avoid SSR mismatch).
- Cancel reverts to last saved snapshot (which persists across reloads).
- Undo/redo stacks are in-memory only and do not survive reloads.

### 5. Static Navigation
- SideNav items (地図, 資産台帳 > [公園, 施設], 業者管理, etc.) are hardcoded and non-functional (clicking does nothing).
- Sidebar collapse/expand is functional (PanelLeft icon in header, icon-only mode with tooltips on hover).
- Layer panel toggle pill on sidebar edge is functional.
- Only provides visual context for the app's intended navigation structure.

---

## Development Commands

```bash
npm run dev      # Start dev server (http://localhost:3000)
npm run build    # Production build
npm run start    # Start production server
npm run lint     # Run ESLint
```

---

## Conventions

- **Language**: All UI text, labels, toasts, and status messages are in Japanese.
- **Feature IDs**: UUIDs generated via `uuid` package.
- **Deep cloning**: `JSON.parse(JSON.stringify(...))` throughout (no structuredClone).
- **Component pattern**: `"use client"` on all interactive components. Props interfaces defined inline. Memoized callbacks via `useCallback`.
- **File naming**: kebab-case for all files. Hooks prefixed with `use-`. Lib files are pure functions.
- **shadcn/ui components** in `src/components/ui/` are generated — avoid manual edits. Use `shadcn` CLI to add new ones.
- **Imports**: Use `@/` path aliases (`@/components`, `@/features`, `@/lib`).
- **No tests**: No test files, no test dependencies, no test scripts.
- **No CI/CD**: No GitHub Actions, no deployment config beyond default Vercel support.
