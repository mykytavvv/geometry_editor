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
 * Find the nearest point on any edge within threshold.
 * Useful for edge snapping (future extension).
 *
 * TODO: Implement edge snapping for mid-draw vertex placement.
 * This would project the cursor onto the nearest line segment
 * and return the projected point if within threshold.
 *
 * @param _point - The cursor position [lng, lat]
 * @param _features - The feature collection to search
 * @param _project - Function to convert lng/lat to screen pixels
 * @param _thresholdPx - Maximum distance in pixels for snapping
 * @returns SnapResult
 */
export function findNearestEdge(
  _point: Position,
  _features: ParkFeatureCollection,
  _project: ProjectFn,
  _thresholdPx: number = 10
): SnapResult {
  // TODO: Implement edge snapping
  // For each line segment in each feature:
  //   1. Project both endpoints to screen
  //   2. Find nearest point on the projected segment to cursor
  //   3. If within threshold, convert back to geographic coords
  //   4. Return the nearest result
  return {
    snapped: null,
    original: _point,
    distancePx: Infinity,
  };
}

/**
 * Combined snapping: tries vertex snap first, then edge snap.
 * Returns the best result (closest).
 */
export function snapPoint(
  point: Position,
  features: ParkFeatureCollection,
  project: ProjectFn,
  thresholdPx: number = 10,
  excludeFeatureId?: string
): SnapResult {
  const vertexSnap = findNearestVertex(
    point,
    features,
    project,
    thresholdPx,
    excludeFeatureId
  );

  // TODO: When edge snapping is implemented, compare distances
  // const edgeSnap = findNearestEdge(point, features, project, thresholdPx);
  // return vertexSnap.distancePx <= edgeSnap.distancePx ? vertexSnap : edgeSnap;

  return vertexSnap;
}
