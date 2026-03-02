import * as turf from "@turf/turf";
import type { Position } from "geojson";

/**
 * Calculate the total distance of a set of points forming a line.
 * @returns distance in meters
 */
export function calculateDistance(points: Position[]): number {
  if (points.length < 2) return 0;
  const line = turf.lineString(points);
  return turf.length(line, { units: "meters" });
}

/**
 * Calculate the area of a polygon defined by points.
 * @returns area in square meters
 */
export function calculateArea(points: Position[]): number {
  if (points.length < 3) return 0;
  // Close the ring if not already closed
  const closed = [...points];
  if (
    closed[0][0] !== closed[closed.length - 1][0] ||
    closed[0][1] !== closed[closed.length - 1][1]
  ) {
    closed.push(closed[0]);
  }
  try {
    const polygon = turf.polygon([closed]);
    return turf.area(polygon);
  } catch {
    return 0;
  }
}

/**
 * Calculate the perimeter of a polygon defined by points.
 * @returns perimeter in meters
 */
export function calculatePerimeter(points: Position[]): number {
  if (points.length < 3) return 0;
  const closed = [...points];
  if (
    closed[0][0] !== closed[closed.length - 1][0] ||
    closed[0][1] !== closed[closed.length - 1][1]
  ) {
    closed.push(closed[0]);
  }
  try {
    const line = turf.lineString(closed);
    return turf.length(line, { units: "meters" });
  } catch {
    return 0;
  }
}

/**
 * Calculate segment distance between two points.
 * @returns distance in meters
 */
export function segmentDistance(p1: Position, p2: Position): number {
  const from = turf.point(p1);
  const to = turf.point(p2);
  return turf.distance(from, to, { units: "meters" });
}

/**
 * Format a distance value for display.
 */
export function formatDistance(meters: number): string {
  if (meters < 1) {
    return `${(meters * 100).toFixed(1)} cm`;
  }
  if (meters < 1000) {
    return `${meters.toFixed(1)} m`;
  }
  return `${(meters / 1000).toFixed(3)} km`;
}

/**
 * Format an area value for display.
 */
export function formatArea(sqMeters: number): string {
  if (sqMeters < 1) {
    return `${(sqMeters * 10000).toFixed(1)} cm²`;
  }
  if (sqMeters < 10000) {
    return `${sqMeters.toFixed(1)} m²`;
  }
  return `${(sqMeters / 10000).toFixed(4)} ha`;
}

/**
 * Calculate area and length for a feature based on its geometry type.
 */
export function calculateFeatureMetrics(feature: GeoJSON.Feature): {
  area: number | null;
  length: number | null;
  perimeter: number | null;
  vertexCount: number;
} {
  const geom = feature.geometry;

  switch (geom.type) {
    case "Point":
      return { area: null, length: null, perimeter: null, vertexCount: 1 };

    case "LineString": {
      const line = turf.lineString(geom.coordinates);
      return {
        area: null,
        length: turf.length(line, { units: "meters" }),
        perimeter: null,
        vertexCount: geom.coordinates.length,
      };
    }

    case "MultiLineString": {
      let totalLength = 0;
      let totalVertices = 0;
      for (const lineCoords of geom.coordinates) {
        const line = turf.lineString(lineCoords);
        totalLength += turf.length(line, { units: "meters" });
        totalVertices += lineCoords.length;
      }
      return {
        area: null,
        length: totalLength,
        perimeter: null,
        vertexCount: totalVertices,
      };
    }

    case "Polygon": {
      const poly = turf.polygon(geom.coordinates);
      const boundary = turf.lineString(geom.coordinates[0]);
      return {
        area: turf.area(poly),
        length: null,
        perimeter: turf.length(boundary, { units: "meters" }),
        vertexCount: geom.coordinates[0].length - 1, // exclude closing vertex
      };
    }

    case "MultiPolygon": {
      let totalArea = 0;
      let totalPerimeter = 0;
      let totalVertices = 0;
      for (const polyCoords of geom.coordinates) {
        const poly = turf.polygon(polyCoords);
        totalArea += turf.area(poly);
        const boundary = turf.lineString(polyCoords[0]);
        totalPerimeter += turf.length(boundary, { units: "meters" });
        totalVertices += polyCoords[0].length - 1; // exclude closing vertex
      }
      return {
        area: totalArea,
        length: null,
        perimeter: totalPerimeter,
        vertexCount: totalVertices,
      };
    }

    default:
      return { area: null, length: null, perimeter: null, vertexCount: 0 };
  }
}
