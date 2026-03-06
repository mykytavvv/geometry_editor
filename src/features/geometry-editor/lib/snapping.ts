import type { Position } from "geojson";
import type { ParkFeature, ParkFeatureCollection } from "../types";

export interface SnapResult {
  /** The snapped coordinate, or null if no snap found */
  snapped: Position | null;
  /** The original coordinate */
  original: Position;
  /** Distance in pixels to the snap target */
  distancePx: number;
  /** The feature ID that was snapped to */
  featureId?: string;
}

/** Extended snap result that includes edge information for edge splitting. */
export interface EdgeSnapResult extends SnapResult {
  /** The index of the ring (0 for outer ring, 1+ for holes). Relevant for polygons. */
  ringIndex?: number;
  /** The index of the first vertex of the snapped edge. */
  edgeStartIndex?: number;
  /** For MultiPolygon/MultiLineString: which part. */
  partIndex?: number;
  /** Parametric t value along the edge (0 = start vertex, 1 = end vertex). */
  edgeT?: number;
}

/**
 * Extract all vertices from a ParkFeature.
 */
function extractVertices(feature: ParkFeature): Position[] {
  const geom = feature.geometry;
  switch (geom.type) {
    case "Point":
      return [geom.coordinates];
    case "LineString":
      return geom.coordinates;
    case "MultiLineString":
      return geom.coordinates.flat();
    case "Polygon":
      // Flatten all rings, skip closing vertex of each ring
      return geom.coordinates.flatMap((ring) => ring.slice(0, -1));
    case "MultiPolygon":
      // Flatten all parts' rings, skip closing vertex of each ring
      return geom.coordinates.flatMap((polygon) =>
        polygon.flatMap((ring) => ring.slice(0, -1))
      );
    default:
      return [];
  }
}

/**
 * An edge is a segment between two consecutive vertices.
 * Includes metadata for locating the edge within the geometry.
 */
interface EdgeInfo {
  start: Position;
  end: Position;
  /** For polygons: ring index (0=outer, 1+=holes). For lines: 0. */
  ringIndex: number;
  /** Index of the start vertex within the ring/line. */
  startIndex: number;
  /** For Multi* types: which part. null for non-multi. */
  partIndex: number | null;
}

/**
 * Extract all edges from a ParkFeature.
 */
function extractEdges(feature: ParkFeature): EdgeInfo[] {
  const geom = feature.geometry;
  const edges: EdgeInfo[] = [];

  switch (geom.type) {
    case "LineString": {
      const coords = geom.coordinates;
      for (let i = 0; i < coords.length - 1; i++) {
        edges.push({
          start: coords[i],
          end: coords[i + 1],
          ringIndex: 0,
          startIndex: i,
          partIndex: null,
        });
      }
      break;
    }
    case "MultiLineString": {
      const parts = geom.coordinates;
      for (let p = 0; p < parts.length; p++) {
        const coords = parts[p];
        for (let i = 0; i < coords.length - 1; i++) {
          edges.push({
            start: coords[i],
            end: coords[i + 1],
            ringIndex: 0,
            startIndex: i,
            partIndex: p,
          });
        }
      }
      break;
    }
    case "Polygon": {
      const rings = geom.coordinates;
      for (let r = 0; r < rings.length; r++) {
        const ring = rings[r];
        // Ring is closed: [v0, v1, ..., vN, v0]
        // Edges: v0-v1, v1-v2, ..., v(N-1)-vN, vN-v0
        for (let i = 0; i < ring.length - 1; i++) {
          edges.push({
            start: ring[i],
            end: ring[i + 1],
            ringIndex: r,
            startIndex: i,
            partIndex: null,
          });
        }
      }
      break;
    }
    case "MultiPolygon": {
      const parts = geom.coordinates;
      for (let p = 0; p < parts.length; p++) {
        const rings = parts[p];
        for (let r = 0; r < rings.length; r++) {
          const ring = rings[r];
          for (let i = 0; i < ring.length - 1; i++) {
            edges.push({
              start: ring[i],
              end: ring[i + 1],
              ringIndex: r,
              startIndex: i,
              partIndex: p,
            });
          }
        }
      }
      break;
    }
    default:
      break;
  }

  return edges;
}

/**
 * Project a point onto a line segment in screen space and return the
 * parametric t value and the distance in pixels.
 *
 * t=0 is the start of the segment, t=1 is the end. The projected point
 * is clamped to [0, 1].
 */
function projectOntoSegmentScreen(
  cursor: { x: number; y: number },
  segStart: { x: number; y: number },
  segEnd: { x: number; y: number },
): { t: number; distPx: number; projX: number; projY: number } {
  const dx = segEnd.x - segStart.x;
  const dy = segEnd.y - segStart.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    // Degenerate segment (zero length)
    const ex = cursor.x - segStart.x;
    const ey = cursor.y - segStart.y;
    return { t: 0, distPx: Math.sqrt(ex * ex + ey * ey), projX: segStart.x, projY: segStart.y };
  }

  let t = ((cursor.x - segStart.x) * dx + (cursor.y - segStart.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = segStart.x + t * dx;
  const projY = segStart.y + t * dy;
  const ex = cursor.x - projX;
  const ey = cursor.y - projY;

  return { t, distPx: Math.sqrt(ex * ex + ey * ey), projX, projY };
}

/**
 * Convert a geographic position to screen pixels using the map's project method.
 * This is a callback type that the map component provides.
 */
export type ProjectFn = (lngLat: [number, number]) => { x: number; y: number };

/**
 * Find the nearest vertex within a threshold distance (in pixels).
 *
 * @param point - The cursor position [lng, lat]
 * @param features - The feature collection to search
 * @param project - Function to convert lng/lat to screen pixels
 * @param thresholdPx - Maximum distance in pixels for snapping
 * @param excludeFeatureId - Optional feature ID to exclude from snapping
 * @returns SnapResult with the nearest vertex or null
 */
export function findNearestVertex(
  point: Position,
  features: ParkFeatureCollection,
  project: ProjectFn,
  thresholdPx: number = 10,
  excludeFeatureId?: string
): SnapResult {
  const cursorScreen = project([point[0], point[1]]);
  let nearest: SnapResult = {
    snapped: null,
    original: point,
    distancePx: Infinity,
  };

  for (const feature of features.features) {
    if (feature.id === excludeFeatureId) continue;

    const vertices = extractVertices(feature);
    for (const vertex of vertices) {
      const vertexScreen = project([vertex[0], vertex[1]]);
      const dx = cursorScreen.x - vertexScreen.x;
      const dy = cursorScreen.y - vertexScreen.y;
      const distPx = Math.sqrt(dx * dx + dy * dy);

      if (distPx < nearest.distancePx && distPx <= thresholdPx) {
        nearest = {
          snapped: vertex,
          original: point,
          distancePx: distPx,
          featureId: feature.id,
        };
      }
    }
  }

  return nearest;
}

/**
 * Find the nearest point on any edge within threshold distance (in pixels).
 *
 * Projects the cursor onto each line segment in screen space, finds the
 * nearest projected point, and converts back to geographic coordinates
 * via linear interpolation along the original segment.
 *
 * @param point - The cursor position [lng, lat]
 * @param features - The feature collection to search
 * @param project - Function to convert lng/lat to screen pixels
 * @param thresholdPx - Maximum distance in pixels for snapping
 * @param excludeFeatureId - Optional feature ID to exclude from snapping
 * @returns EdgeSnapResult with the nearest edge point or null
 */
export function findNearestEdge(
  point: Position,
  features: ParkFeatureCollection,
  project: ProjectFn,
  thresholdPx: number = 10,
  excludeFeatureId?: string
): EdgeSnapResult {
  const cursorScreen = project([point[0], point[1]]);
  let nearest: EdgeSnapResult = {
    snapped: null,
    original: point,
    distancePx: Infinity,
  };

  for (const feature of features.features) {
    if (feature.id === excludeFeatureId) continue;

    const edges = extractEdges(feature);
    for (const edge of edges) {
      const startScreen = project([edge.start[0], edge.start[1]]);
      const endScreen = project([edge.end[0], edge.end[1]]);

      const result = projectOntoSegmentScreen(cursorScreen, startScreen, endScreen);

      if (result.distPx < nearest.distancePx && result.distPx <= thresholdPx) {
        // Interpolate back to geographic coordinates
        const snappedLng = edge.start[0] + result.t * (edge.end[0] - edge.start[0]);
        const snappedLat = edge.start[1] + result.t * (edge.end[1] - edge.start[1]);

        nearest = {
          snapped: [snappedLng, snappedLat],
          original: point,
          distancePx: result.distPx,
          featureId: feature.id,
          ringIndex: edge.ringIndex,
          edgeStartIndex: edge.startIndex,
          partIndex: edge.partIndex ?? undefined,
          edgeT: result.t,
        };
      }
    }
  }

  return nearest;
}

/**
 * Combined snapping: tries vertex snap first, then edge snap.
 * Vertex snap is preferred when distances are close (within vertexPriorityPx).
 *
 * Returns a union type — callers can check for edge-specific fields.
 */
export function snapPoint(
  point: Position,
  features: ParkFeatureCollection,
  project: ProjectFn,
  thresholdPx: number = 10,
  excludeFeatureId?: string,
  vertexPriorityPx: number = 3,
): EdgeSnapResult {
  const vertexSnap = findNearestVertex(
    point,
    features,
    project,
    thresholdPx,
    excludeFeatureId
  );

  const edgeSnap = findNearestEdge(
    point,
    features,
    project,
    thresholdPx,
    excludeFeatureId
  );

  // If vertex snap found, prefer it unless edge snap is significantly closer
  if (vertexSnap.snapped && edgeSnap.snapped) {
    // Vertex gets priority if within vertexPriorityPx of the edge distance
    if (vertexSnap.distancePx <= edgeSnap.distancePx + vertexPriorityPx) {
      return {
        snapped: vertexSnap.snapped,
        original: vertexSnap.original,
        distancePx: vertexSnap.distancePx,
        featureId: vertexSnap.featureId,
        // No edge-specific fields → this is a vertex snap
      };
    }
    return edgeSnap;
  }

  if (vertexSnap.snapped) {
    return {
      snapped: vertexSnap.snapped,
      original: vertexSnap.original,
      distancePx: vertexSnap.distancePx,
      featureId: vertexSnap.featureId,
    };
  }

  return edgeSnap;
}

/**
 * Check if a snap result is an edge snap (has edge-specific metadata).
 */
export function isEdgeSnap(snap: EdgeSnapResult): boolean {
  return snap.edgeStartIndex !== undefined && snap.edgeT !== undefined;
}
