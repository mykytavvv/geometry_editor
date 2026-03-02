"use client";

import { useReducer, useCallback, useMemo } from "react";
import type {
  EditorState,
  EditorAction,
  ParkFeature,
  ParkFeatureCollection,
  ParkFeatureProperties,
  ToolMode,
  ParkLayer,
  MeasurementState,
  DrawingPartsType,
  DrawingParts,
  ContinueDrawingState,
} from "../types";
import type { Position } from "geojson";
import { MAX_UNDO_STACK } from "../constants";
import { duplicateFeature, mergePolygons, mergeLines, normalizeDrawingParts } from "../lib/geometry-ops";
import { v4 as uuidv4 } from "uuid";

// ─── Helpers ─────────────────────────────────────────────────
function cloneCollection(fc: ParkFeatureCollection): ParkFeatureCollection {
  return JSON.parse(JSON.stringify(fc));
}

function pushUndo(
  state: EditorState,
  nextFeatures: ParkFeatureCollection
): Pick<EditorState, "undoStack" | "redoStack" | "features"> {
  const undoStack = [...state.undoStack, cloneCollection(state.features)];
  if (undoStack.length > MAX_UNDO_STACK) {
    undoStack.shift();
  }
  return {
    undoStack,
    redoStack: [], // clear redo on new action
    features: nextFeatures,
  };
}

// ─── Reducer ─────────────────────────────────────────────────
function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "SET_TOOL":
      return {
        ...state,
        activeTool: action.tool,
        // Exit vertex edit when switching to a different tool
        vertexEditFeatureId:
          action.tool !== "vertex_edit" ? null : state.vertexEditFeatureId,
        // Cancel continue drawing when switching to a different tool
        continueDrawingState:
          action.tool !== "continue_drawing" ? null : state.continueDrawingState,
        // Auto-open right panel on select tool if features are selected
        rightPanelOpen:
          action.tool === "select" && state.selectedFeatureIds.length > 0
            ? true
            : state.rightPanelOpen,
      };

    case "ADD_FEATURE": {
      const nextFeatures = cloneCollection(state.features);
      nextFeatures.features.push(action.feature);
      return {
        ...state,
        ...pushUndo(state, nextFeatures),
      };
    }

    case "UPDATE_FEATURE": {
      const nextFeatures = cloneCollection(state.features);
      const idx = nextFeatures.features.findIndex(
        (f) => f.id === action.feature.id
      );
      if (idx >= 0) {
        nextFeatures.features[idx] = action.feature;
      }
      return {
        ...state,
        ...pushUndo(state, nextFeatures),
      };
    }

    case "BULK_UPDATE_PROPERTIES": {
      const targetIds = new Set(action.ids);
      const nextFeatures = cloneCollection(state.features);
      for (let i = 0; i < nextFeatures.features.length; i++) {
        if (targetIds.has(nextFeatures.features[i].id)) {
          nextFeatures.features[i] = {
            ...nextFeatures.features[i],
            properties: {
              ...nextFeatures.features[i].properties,
              ...action.properties,
            },
          };
        }
      }
      return {
        ...state,
        ...pushUndo(state, nextFeatures),
      };
    }

    case "DELETE_FEATURES": {
      const toDelete = new Set(action.ids);
      const nextFeatures = cloneCollection(state.features);
      nextFeatures.features = nextFeatures.features.filter(
        (f) => !toDelete.has(f.id)
      );
      return {
        ...state,
        ...pushUndo(state, nextFeatures),
        selectedFeatureIds: state.selectedFeatureIds.filter(
          (id) => !toDelete.has(id)
        ),
      };
    }

    case "SELECT_FEATURES":
      return {
        ...state,
        selectedFeatureIds: action.ids,
        rightPanelOpen: action.ids.length > 0 ? true : state.rightPanelOpen,
      };

    case "SET_CURSOR":
      return { ...state, cursorPosition: action.position };

    case "SET_LIVE_MEASUREMENT":
      return { ...state, liveMeasurement: action.measurement };

    case "SET_FEATURES": {
      return {
        ...state,
        ...pushUndo(state, action.features),
      };
    }

    case "UNDO": {
      if (state.undoStack.length === 0) return state;
      const undoStack = [...state.undoStack];
      const prev = undoStack.pop()!;
      return {
        ...state,
        undoStack,
        redoStack: [...state.redoStack, cloneCollection(state.features)],
        features: prev,
        selectedFeatureIds: [],
        vertexEditFeatureId: null,
        vertexEditPartIndex: null,
        continueDrawingState: null,
        activeTool: (state.vertexEditFeatureId || state.continueDrawingState) ? "select" : state.activeTool,
      };
    }

    case "REDO": {
      if (state.redoStack.length === 0) return state;
      const redoStack = [...state.redoStack];
      const next = redoStack.pop()!;
      return {
        ...state,
        redoStack,
        undoStack: [...state.undoStack, cloneCollection(state.features)],
        features: next,
        selectedFeatureIds: [],
        vertexEditFeatureId: null,
        vertexEditPartIndex: null,
        continueDrawingState: null,
        activeTool: (state.vertexEditFeatureId || state.continueDrawingState) ? "select" : state.activeTool,
      };
    }

    case "SAVE":
      return {
        ...state,
        savedSnapshot: cloneCollection(state.features),
      };

    case "CANCEL":
      return {
        ...state,
        features: cloneCollection(state.savedSnapshot),
        selectedFeatureIds: [],
        undoStack: [],
        redoStack: [],
        activeTool: "select",
        vertexEditFeatureId: null,
        vertexEditPartIndex: null,
        drawingParts: null,
        drawingPartsType: null,
        continueDrawingState: null,
      };

    case "TOGGLE_LEFT_PANEL":
      return { ...state, leftPanelOpen: !state.leftPanelOpen };

    case "TOGGLE_RIGHT_PANEL":
      return { ...state, rightPanelOpen: !state.rightPanelOpen };

    case "SET_RIGHT_PANEL":
      return { ...state, rightPanelOpen: action.open };

    case "SET_DRAWING":
      return { ...state, isDrawing: action.isDrawing };

    case "TOGGLE_SNAPPING":
      return { ...state, snappingEnabled: !state.snappingEnabled };

    case "TOGGLE_LAYER_VISIBILITY":
      return {
        ...state,
        layerVisibility: {
          ...state.layerVisibility,
          [action.layer]: !state.layerVisibility[action.layer],
        },
      };

    case "TOGGLE_PARK_VISIBILITY": {
      const currentVisible = state.parkVisibility[action.parkId] ?? true;
      return {
        ...state,
        parkVisibility: {
          ...state.parkVisibility,
          [action.parkId]: !currentVisible,
        },
      };
    }

    case "SET_MEASUREMENT_STATE":
      return { ...state, measurementState: action.state };

    case "DUPLICATE_FEATURES": {
      const toDuplicate = state.features.features.filter((f) =>
        action.ids.includes(f.id)
      );
      if (toDuplicate.length === 0) return state;

      const nextFeatures = cloneCollection(state.features);
      const newIds: string[] = [];
      for (const feat of toDuplicate) {
        const dup = duplicateFeature(feat);
        nextFeatures.features.push(dup);
        newIds.push(dup.id);
      }
      return {
        ...state,
        ...pushUndo(state, nextFeatures),
        selectedFeatureIds: newIds,
      };
    }

    case "MERGE_FEATURES": {
      const toMerge = state.features.features.filter((f) =>
        action.ids.includes(f.id)
      );
      if (toMerge.length < 2) return state;

      // Determine if all are polygon-type or all are line-type
      const allPolygons = toMerge.every(
        (f) => f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon"
      );
      const allLines = toMerge.every(
        (f) => f.geometry.type === "LineString" || f.geometry.type === "MultiLineString"
      );

      let merged: ParkFeature | null = null;
      if (allPolygons) {
        merged = mergePolygons(toMerge);
      } else if (allLines) {
        merged = mergeLines(toMerge);
      }

      if (!merged) return state;

      const nextFeatures = cloneCollection(state.features);
      const mergeIds = new Set(action.ids);
      nextFeatures.features = nextFeatures.features.filter(
        (f) => !mergeIds.has(f.id)
      );
      nextFeatures.features.push(merged);

      return {
        ...state,
        ...pushUndo(state, nextFeatures),
        selectedFeatureIds: [merged.id],
      };
    }

    case "REPLACE_FEATURES": {
      const oldIds = new Set(action.oldIds);
      const nextFeatures = cloneCollection(state.features);
      nextFeatures.features = nextFeatures.features.filter(
        (f) => !oldIds.has(f.id)
      );
      nextFeatures.features.push(...action.newFeatures);
      return {
        ...state,
        ...pushUndo(state, nextFeatures),
        selectedFeatureIds: action.newFeatures.map((f) => f.id),
      };
    }

    case "LOAD_SAVED": {
      const loaded = action.features;
      return {
        ...state,
        features: cloneCollection(loaded),
        savedSnapshot: cloneCollection(loaded),
        selectedFeatureIds: [],
        undoStack: [],
        redoStack: [],
        parkVisibility: Object.fromEntries(
          loaded.features
            .filter((f) => f.properties.layer === "park" && !f.properties.parkId)
            .map((f) => [f.id, true])
        ),
      };
    }

    case "ENTER_VERTEX_EDIT": {
      // Only enter vertex edit if the feature exists and has an editable geometry
      const targetFeature = state.features.features.find(
        (f) => f.id === action.featureId
      );
      if (!targetFeature) return state;

      const geomType = targetFeature.geometry.type;
      const editableTypes = ["Polygon", "MultiPolygon", "LineString", "MultiLineString"];
      if (!editableTypes.includes(geomType)) {
        return state;
      }

      // For Multi* types, a partIndex is required
      const needsPartIndex = geomType === "MultiPolygon" || geomType === "MultiLineString";
      const partIndex = needsPartIndex ? (action.partIndex ?? 0) : null;

      return {
        ...state,
        vertexEditFeatureId: action.featureId,
        vertexEditPartIndex: partIndex,
        activeTool: "vertex_edit",
        selectedFeatureIds: [action.featureId],
      };
    }

    case "EXIT_VERTEX_EDIT":
      return {
        ...state,
        vertexEditFeatureId: null,
        vertexEditPartIndex: null,
        activeTool: "select",
      };

    case "REASSIGN_FEATURE": {
      const nextFeatures = cloneCollection(state.features);
      const idx = nextFeatures.features.findIndex(
        (f) => f.id === action.featureId
      );
      if (idx < 0) return state;

      const feature = nextFeatures.features[idx];
      const targetParkId = action.parkId;

      // Update parkId
      if (targetParkId === null) {
        delete feature.properties.parkId;
      } else {
        feature.properties.parkId = targetParkId;
      }

      // If assigning to a park and feature is currently draft, promote to facilities layer
      if (targetParkId !== null && feature.properties.layer === "draft") {
        feature.properties.layer = "facilities";
      }

      // If feature has no layer set and is being assigned, set to facilities
      if (targetParkId !== null && !feature.properties.layer) {
        feature.properties.layer = "facilities";
      }

      return {
        ...state,
        ...pushUndo(state, nextFeatures),
      };
    }

    case "APPEND_DRAWING_PART": {
      const { partType, coordinates } = action;

      if (partType === "line") {
        const lineCoords = coordinates as Position[];
        const existing = (state.drawingParts as Position[][] | null) ?? [];
        return {
          ...state,
          drawingParts: [...existing, lineCoords],
          drawingPartsType: "line",
        };
      }

      // polygon: coordinates come as Position[][] (rings including closing coord)
      const polyCoords = coordinates as Position[][];
      const existing = (state.drawingParts as Position[][][] | null) ?? [];
      return {
        ...state,
        drawingParts: [...existing, polyCoords],
        drawingPartsType: "polygon",
      };
    }

    case "FINISH_MULTI_DRAWING": {
      if (!state.drawingParts || !state.drawingPartsType || state.drawingParts.length === 0) {
        return {
          ...state,
          drawingParts: null,
          drawingPartsType: null,
        };
      }

      const { geometry, featureType } = normalizeDrawingParts(
        state.drawingPartsType,
        state.drawingParts
      );

      const newFeature: ParkFeature = {
        id: uuidv4(),
        type: "Feature",
        geometry,
        properties: {
          type: featureType,
          layer: "draft",
        },
      };

      const nextFeatures = cloneCollection(state.features);
      nextFeatures.features.push(newFeature);

      return {
        ...state,
        ...pushUndo(state, nextFeatures),
        drawingParts: null,
        drawingPartsType: null,
        selectedFeatureIds: [newFeature.id],
        rightPanelOpen: true,
        activeTool: "select",
      };
    }

    case "CLEAR_DRAWING_PARTS":
      return {
        ...state,
        drawingParts: null,
        drawingPartsType: null,
      };

    // ── Continue Drawing ────────────────────────────────────
    case "START_CONTINUE_DRAWING": {
      return {
        ...state,
        activeTool: "continue_drawing",
        vertexEditFeatureId: null,
        vertexEditPartIndex: null,
        continueDrawingState: {
          featureId: action.featureId,
          partIndex: action.partIndex,
          ringIndex: action.ringIndex,
          vertexIndex: action.vertexIndex,
          insertDirection: action.insertDirection,
          newVertices: [],
          geometryType: action.geometryType,
        },
        selectedFeatureIds: [action.featureId],
      };
    }

    case "ADD_CONTINUE_VERTEX": {
      if (!state.continueDrawingState) return state;
      return {
        ...state,
        continueDrawingState: {
          ...state.continueDrawingState,
          newVertices: [...state.continueDrawingState.newVertices, action.position],
        },
      };
    }

    case "UNDO_CONTINUE_VERTEX": {
      if (!state.continueDrawingState) return state;
      if (state.continueDrawingState.newVertices.length === 0) return state;
      return {
        ...state,
        continueDrawingState: {
          ...state.continueDrawingState,
          newVertices: state.continueDrawingState.newVertices.slice(0, -1),
        },
      };
    }

    case "FINISH_CONTINUE_DRAWING": {
      const cds = state.continueDrawingState;
      if (!cds || cds.newVertices.length === 0) {
        return {
          ...state,
          continueDrawingState: null,
          activeTool: "select",
        };
      }

      const feat = state.features.features.find((f) => f.id === cds.featureId);
      if (!feat) {
        return { ...state, continueDrawingState: null, activeTool: "select" };
      }

      const nextFeatures = cloneCollection(state.features);
      const idx = nextFeatures.features.findIndex((f) => f.id === cds.featureId);
      if (idx < 0) {
        return { ...state, continueDrawingState: null, activeTool: "select" };
      }

      const target = nextFeatures.features[idx];
      const geomType = target.geometry.type;

      if (cds.geometryType === "line") {
        // ── Line: append or prepend new vertices ──
        let coords: Position[];
        if (geomType === "LineString") {
          coords = [...(target.geometry.coordinates as Position[])];
        } else if (geomType === "MultiLineString" && cds.partIndex !== null) {
          coords = [...((target.geometry.coordinates as Position[][])[cds.partIndex])];
        } else {
          return { ...state, continueDrawingState: null, activeTool: "select" };
        }

        if (cds.insertDirection === "append") {
          coords.push(...cds.newVertices);
        } else {
          // prepend: newVertices were drawn "outward" from the start vertex,
          // so reverse them to get the correct order
          coords.unshift(...[...cds.newVertices].reverse());
        }

        if (geomType === "LineString") {
          target.geometry = { type: "LineString", coordinates: coords };
        } else {
          const allParts = target.geometry.coordinates as Position[][];
          allParts[cds.partIndex!] = coords;
          target.geometry = { type: "MultiLineString", coordinates: allParts };
        }
      } else {
        // ── Polygon: insert new vertices after the selected vertex ──
        let rings: Position[][];
        if (geomType === "Polygon") {
          rings = JSON.parse(JSON.stringify(target.geometry.coordinates)) as Position[][];
        } else if (geomType === "MultiPolygon" && cds.partIndex !== null) {
          rings = JSON.parse(JSON.stringify((target.geometry.coordinates as Position[][][])[cds.partIndex])) as Position[][];
        } else {
          return { ...state, continueDrawingState: null, activeTool: "select" };
        }

        const ring = rings[cds.ringIndex];
        if (!ring) {
          return { ...state, continueDrawingState: null, activeTool: "select" };
        }

        // Insert after vertexIndex (splice into the ring before the closing vertex)
        // For a polygon ring: [v0, v1, v2, ..., vN, v0] (closed)
        const insertAt = cds.vertexIndex + 1;
        ring.splice(insertAt, 0, ...cds.newVertices);
        // Fix closure
        ring[ring.length - 1] = [...ring[0]];

        if (geomType === "Polygon") {
          target.geometry = { type: "Polygon", coordinates: rings };
        } else {
          const allParts = target.geometry.coordinates as Position[][][];
          allParts[cds.partIndex!] = rings;
          target.geometry = { type: "MultiPolygon", coordinates: allParts };
        }
      }

      nextFeatures.features[idx] = target;

      return {
        ...state,
        ...pushUndo(state, nextFeatures),
        continueDrawingState: null,
        activeTool: "select",
        selectedFeatureIds: [cds.featureId],
      };
    }

    case "CANCEL_CONTINUE_DRAWING":
      return {
        ...state,
        continueDrawingState: null,
        activeTool: "select",
      };

    default:
      return state;
  }
}

// ─── Hook ────────────────────────────────────────────────────
export function useEditorState(initialFeatures: ParkFeatureCollection) {
  const initialState: EditorState = {
    features: cloneCollection(initialFeatures),
    selectedFeatureIds: [],
    activeTool: "select",
    cursorPosition: null,
    liveMeasurement: null,
    undoStack: [],
    redoStack: [],
    savedSnapshot: cloneCollection(initialFeatures),
    layerVisibility: {
      park: true,
      facilities: true,
      draft: true,
    },
    parkVisibility: Object.fromEntries(
      initialFeatures.features
        .filter((f) => f.properties.layer === "park" && !f.properties.parkId)
        .map((f) => [f.id, true])
    ),
    leftPanelOpen: true,
    rightPanelOpen: false,
    isDrawing: false,
    snappingEnabled: true,
    measurementState: null,
    vertexEditFeatureId: null,
    vertexEditPartIndex: null,
    drawingParts: null,
    drawingPartsType: null,
    continueDrawingState: null,
  };

  const [state, dispatch] = useReducer(editorReducer, initialState);

  // ─── Convenience action creators ────────────────────────
  const setTool = useCallback(
    (tool: ToolMode) => dispatch({ type: "SET_TOOL", tool }),
    []
  );

  const addFeature = useCallback(
    (feature: ParkFeature) => dispatch({ type: "ADD_FEATURE", feature }),
    []
  );

  const updateFeature = useCallback(
    (feature: ParkFeature) => dispatch({ type: "UPDATE_FEATURE", feature }),
    []
  );

  const bulkUpdateProperties = useCallback(
    (ids: string[], properties: Partial<ParkFeatureProperties>) =>
      dispatch({ type: "BULK_UPDATE_PROPERTIES", ids, properties }),
    []
  );

  const deleteFeatures = useCallback(
    (ids: string[]) => dispatch({ type: "DELETE_FEATURES", ids }),
    []
  );

  const selectFeatures = useCallback(
    (ids: string[]) => dispatch({ type: "SELECT_FEATURES", ids }),
    []
  );

  const setCursor = useCallback(
    (position: [number, number] | null) =>
      dispatch({ type: "SET_CURSOR", position }),
    []
  );

  const setLiveMeasurement = useCallback(
    (measurement: string | null) =>
      dispatch({ type: "SET_LIVE_MEASUREMENT", measurement }),
    []
  );

  const undo = useCallback(() => dispatch({ type: "UNDO" }), []);
  const redo = useCallback(() => dispatch({ type: "REDO" }), []);
  const save = useCallback(() => dispatch({ type: "SAVE" }), []);
  const cancel = useCallback(() => dispatch({ type: "CANCEL" }), []);

  const toggleLeftPanel = useCallback(
    () => dispatch({ type: "TOGGLE_LEFT_PANEL" }),
    []
  );
  const toggleRightPanel = useCallback(
    () => dispatch({ type: "TOGGLE_RIGHT_PANEL" }),
    []
  );
  const setRightPanel = useCallback(
    (open: boolean) => dispatch({ type: "SET_RIGHT_PANEL", open }),
    []
  );

  const setDrawing = useCallback(
    (isDrawing: boolean) => dispatch({ type: "SET_DRAWING", isDrawing }),
    []
  );

  const toggleSnapping = useCallback(
    () => dispatch({ type: "TOGGLE_SNAPPING" }),
    []
  );

  const toggleLayerVisibility = useCallback(
    (layer: ParkLayer) =>
      dispatch({ type: "TOGGLE_LAYER_VISIBILITY", layer }),
    []
  );

  const toggleParkVisibility = useCallback(
    (parkId: string) =>
      dispatch({ type: "TOGGLE_PARK_VISIBILITY", parkId }),
    []
  );

  const setMeasurementState = useCallback(
    (ms: MeasurementState | null) =>
      dispatch({ type: "SET_MEASUREMENT_STATE", state: ms }),
    []
  );

  const duplicateSelected = useCallback(
    () =>
      dispatch({
        type: "DUPLICATE_FEATURES",
        ids: state.selectedFeatureIds,
      }),
    [state.selectedFeatureIds]
  );

  const deleteSelected = useCallback(
    () =>
      dispatch({
        type: "DELETE_FEATURES",
        ids: state.selectedFeatureIds,
      }),
    [state.selectedFeatureIds]
  );

  const mergeSelected = useCallback(
    () =>
      dispatch({
        type: "MERGE_FEATURES",
        ids: state.selectedFeatureIds,
      }),
    [state.selectedFeatureIds]
  );

  const replaceFeatures = useCallback(
    (oldIds: string[], newFeatures: ParkFeature[]) =>
      dispatch({ type: "REPLACE_FEATURES", oldIds, newFeatures }),
    []
  );

  const setFeatures = useCallback(
    (features: ParkFeatureCollection) =>
      dispatch({ type: "SET_FEATURES", features }),
    []
  );

  const reassignFeature = useCallback(
    (featureId: string, parkId: string | null) =>
      dispatch({ type: "REASSIGN_FEATURE", featureId, parkId }),
    []
  );

  const loadSaved = useCallback(
    (features: ParkFeatureCollection) =>
      dispatch({ type: "LOAD_SAVED", features }),
    []
  );

  const enterVertexEdit = useCallback(
    (featureId: string, partIndex?: number) =>
      dispatch({ type: "ENTER_VERTEX_EDIT", featureId, partIndex }),
    []
  );

  const exitVertexEdit = useCallback(
    () => dispatch({ type: "EXIT_VERTEX_EDIT" }),
    []
  );

  const appendDrawingPart = useCallback(
    (partType: DrawingPartsType, coordinates: Position[] | Position[][]) =>
      dispatch({ type: "APPEND_DRAWING_PART", partType, coordinates }),
    []
  );

  const finishMultiDrawing = useCallback(
    () => dispatch({ type: "FINISH_MULTI_DRAWING" }),
    []
  );

  const clearDrawingParts = useCallback(
    () => dispatch({ type: "CLEAR_DRAWING_PARTS" }),
    []
  );

  const startContinueDrawing = useCallback(
    (featureId: string, partIndex: number | null, ringIndex: number, vertexIndex: number, geometryType: "line" | "polygon", insertDirection: "append" | "prepend") =>
      dispatch({ type: "START_CONTINUE_DRAWING", featureId, partIndex, ringIndex, vertexIndex, geometryType, insertDirection }),
    []
  );

  const addContinueVertex = useCallback(
    (position: Position) => dispatch({ type: "ADD_CONTINUE_VERTEX", position }),
    []
  );

  const undoContinueVertex = useCallback(
    () => dispatch({ type: "UNDO_CONTINUE_VERTEX" }),
    []
  );

  const finishContinueDrawing = useCallback(
    () => dispatch({ type: "FINISH_CONTINUE_DRAWING" }),
    []
  );

  const cancelContinueDrawing = useCallback(
    () => dispatch({ type: "CANCEL_CONTINUE_DRAWING" }),
    []
  );

  // ─── Derived state ─────────────────────────────────────
  const selectedFeatures = useMemo(
    () =>
      state.features.features.filter((f) =>
        state.selectedFeatureIds.includes(f.id)
      ),
    [state.features.features, state.selectedFeatureIds]
  );

  const canUndo = state.undoStack.length > 0;
  const canRedo = state.redoStack.length > 0;

  const isDirty = useMemo(() => {
    return (
      JSON.stringify(state.features) !==
      JSON.stringify(state.savedSnapshot)
    );
  }, [state.features, state.savedSnapshot]);

  // ─── Visible features based on layer + park visibility ─
  const visibleFeatures = useMemo((): ParkFeatureCollection => {
    return {
      type: "FeatureCollection",
      features: state.features.features.filter((f) => {
        const layer = f.properties.layer || "draft";
        // Layer-level visibility check
        if (!state.layerVisibility[layer]) return false;
        // Park-level visibility check
        if (layer === "park" && !f.properties.parkId) {
          // This is a park-defining feature — check its own visibility
          return state.parkVisibility[f.id] ?? true;
        }
        if (layer === "park" && f.properties.parkId) {
          // Park sub-feature (e.g. text label) — check parent park visibility
          return state.parkVisibility[f.properties.parkId] ?? true;
        }
        if (layer === "facilities" && f.properties.parkId) {
          // Facility — check parent park visibility
          return state.parkVisibility[f.properties.parkId] ?? true;
        }
        return true;
      }),
    };
  }, [state.features, state.layerVisibility, state.parkVisibility]);

  return {
    state,
    dispatch,
    // Actions
    setTool,
    addFeature,
    updateFeature,
    bulkUpdateProperties,
    deleteFeatures,
    selectFeatures,
    setCursor,
    setLiveMeasurement,
    undo,
    redo,
    save,
    cancel,
    toggleLeftPanel,
    toggleRightPanel,
    setRightPanel,
    setDrawing,
    toggleSnapping,
    toggleLayerVisibility,
    toggleParkVisibility,
    setMeasurementState,
    duplicateSelected,
    deleteSelected,
    mergeSelected,
    replaceFeatures,
    setFeatures,
    reassignFeature,
    loadSaved,
    enterVertexEdit,
    exitVertexEdit,
    appendDrawingPart,
    finishMultiDrawing,
    clearDrawingParts,
    startContinueDrawing,
    addContinueVertex,
    undoContinueVertex,
    finishContinueDrawing,
    cancelContinueDrawing,
    // Derived
    selectedFeatures,
    canUndo,
    canRedo,
    isDirty,
    visibleFeatures,
  };
}

export type EditorActions = ReturnType<typeof useEditorState>;
