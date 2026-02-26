# Agent Guide: Park Geometry Editor

## Project Overview

A Japanese-language park management geometry editor built with Next.js 16 (App Router), MapLibre GL, and MapboxDraw. The application allows municipal park administrators to view, create, edit, and measure geographic features (points, lines, polygons, text labels) on an interactive map centered on Chikusa Park (千種公園) in Nagoya, Japan.

The UI is entirely in Japanese. The app title is "公園管理 - ジオメトリエディター".

**Current stage**: Functional MVP with mock data. No backend/API — save logs GeoJSON to console. Some features are scaffolded (see "Incomplete Features" below).

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
│       └── page.tsx                         # Main editor page (orchestrator, ~320 lines)
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
│       ├── constants.ts                     # Map config, layer colors, tool groups, snap thresholds
│       ├── mock-data.ts                     # 10 sample features around Chikusa Park
│       ├── types.ts                         # All type definitions (ToolMode, ParkFeature, EditorState, EditorAction)
│       ├── components/
│       │   ├── attribute-editor.tsx          # Key-value attribute editor for linkedAttributes
│       │   ├── coordinate-input-dialog.tsx   # Dialog for WGS84 coordinate entry (point only)
│       │   ├── floating-toolbar.tsx          # Bottom-center toolbar: tools, edit ops, measure, history, precision
│       │   ├── layer-panel.tsx               # Left overlay: feature list grouped by layer, visibility toggles, pill close button on right edge
│       │   ├── map-editor.tsx               # Core map component (~916 lines): MapLibre init, layers, events, keyboard shortcuts, drag-to-move
│       │   ├── properties-panel.tsx          # Right overlay: 3-tab panel (properties, geometry, attributes), pill toggle on left edge
│       │   ├── status-bar.tsx               # Bottom status: cursor coords, active tool, live measurement, feature count
│       │   └── text-input-dialog.tsx         # Dialog for text label placement
│       ├── hooks/
│       │   ├── use-editor-state.ts           # Central state management (useReducer, 18 actions, undo/redo)
│       │   ├── use-map-draw.ts              # MapboxDraw integration and lifecycle
│       │   ├── use-measurement.ts            # Measurement workflow (start, add point, finish, save as geometry)
│       │   └── use-snapping.ts              # Vertex snapping wrapper
│       └── lib/
│           ├── geometry-ops.ts              # Duplicate, merge, split, create features (Turf.js)
│           ├── measurement.ts               # Distance/area/perimeter calculation + formatting (Turf.js)
│           └── snapping.ts                  # Vertex snapping logic (edge snapping stubbed)
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
  activeTool: ToolMode;                      // Active tool (11 modes)
  cursorPosition: [number, number] | null;   // Mouse [lng, lat]
  liveMeasurement: string | null;            // Measurement display string
  undoStack: ParkFeatureCollection[];        // Max 50 snapshots
  redoStack: ParkFeatureCollection[];        // Redo snapshots
  savedSnapshot: ParkFeatureCollection;      // Last saved state (for dirty detection)
  layerVisibility: Record<ParkLayer, boolean>;
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  isDrawing: boolean;
  snappingEnabled: boolean;
  measurementState: MeasurementState | null;
}
```

**Reducer actions** (18 types): `SET_TOOL`, `ADD_FEATURE`, `UPDATE_FEATURE`, `DELETE_FEATURES`, `SELECT_FEATURES`, `SET_CURSOR`, `SET_LIVE_MEASUREMENT`, `SET_FEATURES`, `UNDO`, `REDO`, `SAVE`, `CANCEL`, `TOGGLE_LEFT_PANEL`, `TOGGLE_RIGHT_PANEL`, `SET_RIGHT_PANEL`, `SET_DRAWING`, `TOGGLE_SNAPPING`, `TOGGLE_LAYER_VISIBILITY`, `SET_MEASUREMENT_STATE`, `DUPLICATE_FEATURES`, `MERGE_FEATURES`, `REPLACE_FEATURES`.

**Undo/redo**: Before any feature mutation, the entire features collection is deep-cloned (`JSON.parse(JSON.stringify(...))`) and pushed to the undo stack. Redo stack is cleared on new actions.

**Derived state** (via `useMemo`): `selectedFeatures`, `visibleFeatures` (filtered by layer visibility), `canUndo`, `canRedo`, `isDirty`.

The `useEditorState` hook returns `state`, `dispatch`, 20+ memoized action callbacks, and derived state. The return type is exported as `EditorActions`.

### Component Hierarchy

```
GeometryEditorPage (orchestrator)
├── SideNav (collapsible left sidebar: 208px expanded / 56px icon-only collapsed)
│   ├── PanelLeft icon button in header → collapses sidebar
│   ├── Icon-only nav with tooltips (collapsed state, hover shows sub-items)
│   └── Pill button on right edge → toggles LayerPanel (only visible when panel closed)
├── Header (breadcrumbs, save/cancel buttons, user info)
├── MapEditor (map + all map interactions)
│   └── useMapDraw (MapboxDraw integration)
├── LayerPanel (left overlay, feature tree by layer)
│   └── Pill button on right edge → closes panel (only visible when panel open)
├── PropertiesPanel (right overlay, 3-tab property editor)
│   ├── Pill button on left edge → toggles panel
│   └── AttributeEditor (key-value pair editor)
├── StatusBar (bottom info bar)
├── FloatingToolbar (bottom-center tool palette)
├── TextInputDialog (modal for text placement)
└── CoordinateInputDialog (modal for coordinate entry)
```

### Data Flow

1. `useEditorState(MOCK_FEATURES)` initializes state with mock data.
2. `visibleFeatures` is derived by filtering features by `layerVisibility`.
3. `MapEditor` receives `visibleFeatures` and syncs them to the MapLibre GeoJSON source.
4. User interactions (clicks, draws, drags) in `MapEditor` call editor action callbacks.
5. State updates flow back down as new props.
6. Measurement clicks are routed via `CustomEvent("map:measurement-click")` on `window`.

---

## Domain Model

### ParkFeature (GeoJSON-compatible)
```typescript
interface ParkFeature {
  id: string;                                // UUID
  type: "Feature";
  geometry: Point | LineString | Polygon;
  properties: {
    type: "point" | "line" | "polygon" | "text";
    label?: string;
    icon?: string;                           // For points: marker, tree, bench, fountain, etc.
    size?: number;                           // Circle radius or text font size
    status?: "low" | "medium" | "high";      // Severity/condition indicator
    linkedAttributes?: Record<string, string | number | boolean>;  // Custom key-value data
    layer?: "park_boundaries" | "assets" | "incidents" | "draft";
  };
}
```

### Layers (4)
| ID | Japanese Label | Color | Purpose |
|---|---|---|---|
| `park_boundaries` | 公園境界 | `#4a7c59` (green) | Park outlines, major areas |
| `assets` | 資産 | `#2563eb` (blue) | Equipment, paths, facilities |
| `incidents` | 案件 | `#dc2626` (red) | Issue reports, incidents |
| `draft` | 下書き | `#9333ea` (purple) | New/unsaved features (default) |

### Tool Modes (11)
| Mode | Label | Shortcut | Status |
|---|---|---|---|
| `select` | 選択 | V | Implemented |
| `pan` | パン | H | Implemented |
| `draw_point` | ポイント | P | Implemented |
| `draw_line` | ライン | L | Implemented |
| `draw_polygon` | ポリゴン | G | Implemented |
| `draw_text` | テキスト | T | Implemented |
| `move` | 移動 | — | Defined, not toolbar-exposed (drag in select mode instead) |
| `vertex_edit` | 頂点編集 | — | Defined, available via MapboxDraw direct_select |
| `measure_distance` | 距離測定 | M | Implemented |
| `measure_area` | 面積測定 | A | Implemented |
| `coordinate_input` | 座標入力 | — | Implemented (point only) |

---

## Map Integration

### Map Setup (`map-editor.tsx`)
- **Engine**: MapLibre GL with OSM raster tiles (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`)
- **Center**: `[136.9389, 35.1644]` (Chikusa Park, Nagoya)
- **Default zoom**: 15
- **Controls**: NavigationControl (top-right, no compass), ScaleControl (bottom-left)

### GeoJSON Sources and Layers
Two GeoJSON sources with 10+ layers:

**Source `park-features`** (main data):
- `park-polygons-fill` — per-layer colored fill, opacity 0.25
- `park-polygons-outline` — per-layer dashed outline
- `park-lines` — per-layer colored lines, width 3
- `park-points` — circles (non-text), radius from `size` property
- `park-text` — symbol layer with text halo
- `selected-fill` / `selected-outline` / `selected-point` — selection highlights (green `#3d6b4f`)

**Source `measurement-features`** (measurement overlay):
- `measurement-fill` — amber fill (`#f59e0b`, opacity 0.15)
- `measurement-line` — amber dashed line
- `measurement-points` — amber circles

### MapboxDraw Integration (`use-map-draw.ts`)
- Added as a map control with custom green-themed draw styles.
- Default UI controls hidden; modes switched programmatically.
- `draw.create` converts MapboxDraw features to `ParkFeature` with new UUID, then removes from draw.
- `draw.update` maps back to existing features via `_parkId` property.
- Mode mapping: `draw_point`→`draw_point`, `draw_line`→`draw_line_string`, `draw_polygon`→`draw_polygon`, `draw_text`→`draw_point`, all others→`simple_select`.
- **Post-creation selection guard** (`justCreatedAtRef`): When a feature is created, MapboxDraw fires spurious `draw.selectionchange` events with empty features (from its internal mode switch to `simple_select` and from our `activeTool` sync effect). A timestamp-based ref (`justCreatedAtRef`) suppresses empty selection-change events for 300ms after creation, and also skips the redundant `draw.changeMode("simple_select")` call in the tool-sync effect. Without this guard, newly created features would appear unselected.

### Drag-to-Move
- In select mode, mousedown on a selected feature initiates drag.
- Disables `map.dragPan`, translates all coordinates in real-time via direct source update.
- On mouseup, commits via `editor.updateFeature()`.
- `justDraggedRef` prevents click-deselect after drag.

### Post-Creation Click Guard (`map-editor.tsx`)
- When finishing geometry creation (double-click to close polygon, etc.), the second click of the double-click can propagate as a regular map click. Since the new feature data may not yet be rendered in the map source, `queryRenderedFeatures` returns empty → "click on empty space" deselects.
- `justCreatedFeatureRef` (timestamp) suppresses map click events for 300ms after feature creation, similar pattern to `justDraggedRef` for drag-to-move.

### Keyboard Shortcuts
| Key | Action | Context |
|---|---|---|
| V | Select tool | Not drawing |
| H | Pan tool | Not drawing |
| P | Draw point | Not drawing |
| L | Draw line | Not drawing |
| G | Draw polygon | Not drawing |
| T | Draw text | Not drawing |
| M | Measure distance | Not drawing |
| A | Measure area | Not drawing |
| Ctrl+Z | Undo (or trash last vertex while drawing) | Always |
| Ctrl+Shift+Z / Ctrl+Y | Redo | Always |
| Ctrl+D | Duplicate selected | Always |
| Delete | Delete selected | Has selection |
| Escape | Cancel draw / clear measurement / deselect | Always |
| Backspace | Remove last vertex | While drawing |

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
| `duplicateFeature()` | Complete | Deep clone, new UUID, +0.0003 offset (~30m), "(コピー)" suffix |
| `mergePolygons()` | Complete | `turf.union`, handles MultiPolygon (keeps largest) |
| `mergeLines()` | Complete | Coordinate concatenation, deduplicates shared endpoints |
| `splitPolygon()` | Approximate | Buffer-based approach, TODO for polygon-clipping lib |
| `createDefaultFeature()` | Complete | Factory with defaults, assigns to draft layer |

### Snapping (`lib/snapping.ts` + `hooks/use-snapping.ts`)
- **Vertex snapping**: Extracts all vertices from all features, projects to screen coords via map's `project()`, finds nearest within `SNAP_THRESHOLD_PX` (10px).
- **Edge snapping**: Stubbed — `findNearestEdge()` always returns `{snapped: null}`.
- **Combined**: `snapPoint()` currently only does vertex snap (edge comparison commented out).

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

### 1. Split Polygon Workflow
**Location**: `src/app/geometry-editor/page.tsx:187-197`
- The split button shows a toast saying "スカフォールド段階" (scaffold stage).
- Needs: "draw split line" mode → user draws line across polygon → call `splitPolygon()` → replace original with pieces.
- `splitPolygon()` itself (`lib/geometry-ops.ts:173-240`) is approximate (buffer-based). Needs `polygon-clipping` library for production accuracy.

### 2. Edge Snapping
**Location**: `src/features/geometry-editor/lib/snapping.ts:91-118`
- `findNearestEdge()` is a complete stub returning `{snapped: null}`.
- `snapPoint()` only does vertex snapping; edge comparison is commented out.
- Needs: project cursor onto nearest line segment, return projected point if within threshold.

### 3. Coordinate Input for Lines and Polygons
**Location**: `src/features/geometry-editor/components/coordinate-input-dialog.tsx:86-89`
- Line and Polygon options are disabled in the dialog's select dropdown.
- Only Point coordinate input works.
- Needs: multi-coordinate entry UI for lines and polygons.

### 4. Dark Mode
- `next-themes` is installed but not configured.
- Only light theme CSS variables are defined in `globals.css`.
- Dark variant is declared (`@custom-variant dark`) but has no values.

### 5. Backend / Persistence
- Save action logs GeoJSON to `console.log`. No API, no database.
- Cancel reverts to last saved snapshot (in-memory only).

### 6. Static Navigation
- SideNav items (地図, 資産台帳, 案件管理, etc.) are hardcoded and non-functional (clicking does nothing).
- Sidebar collapse/expand is functional (PanelLeft icon in header, icon-only mode with tooltips on hover).
- Layer panel toggle pill on sidebar edge is functional.
- Only provides visual context for the app's intended navigation structure.

### 7. Vertex Editing UI
- `loadFeatureForEditing()` in `useMapDraw` is defined but never called from the UI.
- MapboxDraw's `direct_select` mode is available but not wired to any toolbar button.

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
