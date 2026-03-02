import * as turf from "@turf/turf";
import type { Polygon, MultiPolygon, Point, LineString, MultiLineString } from "geojson";
import type { ParkFeature } from "../types";

/**
 * Find the park polygon that contains the given feature.
 * Uses turf.js for point-in-polygon and polygon/line containment checks.
 * Handles Point, LineString, MultiLineString, Polygon, and MultiPolygon geometries.
 *
 * @param feature - The feature to check
 * @param parkFeatures - Array of park features (layer: "park") with polygon geometries
 * @returns The containing park feature, or null if none found
 */
export function findContainingPark(
  feature: ParkFeature,
  parkFeatures: ParkFeature[]
): ParkFeature | null {
  const parkPolygons = parkFeatures.filter(
    (p) => p.geometry.type === "Polygon" || p.geometry.type === "MultiPolygon"
  );

  if (parkPolygons.length === 0) return null;

  // Get a representative point (centroid) from the feature
  let centroidPoint: ReturnType<typeof turf.point> | null = null;
  try {
    const geom = feature.geometry;
    if (geom.type === "Point") {
      centroidPoint = turf.point((geom as Point).coordinates);
    } else if (geom.type === "LineString") {
      const line = turf.lineString((geom as LineString).coordinates);
      centroidPoint = turf.centroid(line);
    } else if (geom.type === "MultiLineString") {
      // Use centroid of first line segment
      const firstLine = turf.lineString((geom as MultiLineString).coordinates[0]);
      centroidPoint = turf.centroid(firstLine);
    } else if (geom.type === "Polygon") {
      const poly = turf.polygon((geom as Polygon).coordinates);
      centroidPoint = turf.centroid(poly);
    } else if (geom.type === "MultiPolygon") {
      // Use centroid of first polygon
      const firstPoly = turf.polygon((geom as MultiPolygon).coordinates[0]);
      centroidPoint = turf.centroid(firstPoly);
    }
  } catch {
    return null;
  }

  if (!centroidPoint) return null;

  for (const park of parkPolygons) {
    try {
      let parkPoly;
      if (park.geometry.type === "Polygon") {
        parkPoly = turf.polygon((park.geometry as Polygon).coordinates);
      } else {
        // MultiPolygon — check against first polygon for containment
        parkPoly = turf.polygon((park.geometry as MultiPolygon).coordinates[0]);
      }

      if (turf.booleanPointInPolygon(centroidPoint, parkPoly)) {
        return park;
      }
    } catch {
      continue;
    }
  }

  return null;
}
