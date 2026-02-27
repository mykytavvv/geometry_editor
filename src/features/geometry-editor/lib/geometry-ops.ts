import * as turf from "@turf/turf";
import type { Feature, Geometry, Polygon, MultiPolygon, LineString, MultiLineString, Position } from "geojson";
import { v4 as uuidv4 } from "uuid";
import type { ParkFeature, ParkFeatureProperties, ParkFeatureType, DrawingPartsType } from "../types";

/**
 * Duplicate a feature with a slight offset and a new ID.
 */
export function duplicateFeature(feature: ParkFeature): ParkFeature {
  const clone = JSON.parse(JSON.stringify(feature)) as ParkFeature;
  clone.id = uuidv4();
  if (clone.properties.label) {
    clone.properties.label = `${clone.properties.label} (コピー)`;
  }

  // Offset geometry slightly so the copy is visible
  const offset = 0.0003; // ~30m
  offsetGeometry(clone, offset, offset);

  return clone;
}

/**
 * Offset all coordinates in a feature.
 */
function offsetGeometry(feature: ParkFeature, lngOffset: number, latOffset: number) {
  const geom = feature.geometry;
  if (geom.type === "Point") {
    geom.coordinates[0] += lngOffset;
    geom.coordinates[1] += latOffset;
  } else if (geom.type === "LineString") {
    for (const coord of geom.coordinates) {
      coord[0] += lngOffset;
      coord[1] += latOffset;
    }
  } else if (geom.type === "MultiLineString") {
    for (const line of geom.coordinates) {
      for (const coord of line) {
        coord[0] += lngOffset;
        coord[1] += latOffset;
      }
    }
  } else if (geom.type === "Polygon") {
    for (const ring of geom.coordinates) {
      for (const coord of ring) {
        coord[0] += lngOffset;
        coord[1] += latOffset;
      }
    }
  } else if (geom.type === "MultiPolygon") {
    for (const polygon of geom.coordinates) {
      for (const ring of polygon) {
        for (const coord of ring) {
          coord[0] += lngOffset;
          coord[1] += latOffset;
        }
      }
    }
  }
}

/**
 * Extract individual polygon turf features from a ParkFeature.
 * Handles both Polygon and MultiPolygon geometries.
 */
function extractPolygons(feature: ParkFeature): Feature<Polygon>[] {
  if (feature.geometry.type === "Polygon") {
    return [turf.polygon((feature.geometry as Polygon).coordinates)];
  }
  if (feature.geometry.type === "MultiPolygon") {
    return (feature.geometry as MultiPolygon).coordinates.map((coords) =>
      turf.polygon(coords)
    );
  }
  return [];
}

/**
 * Merge multiple polygons into one using turf.union.
 * Returns a new ParkFeature with merged geometry, or null if merge fails.
 * Disjoint parts become a MultiPolygon — no fragments are discarded.
 * Accepts both Polygon and MultiPolygon inputs.
 */
export function mergePolygons(features: ParkFeature[]): ParkFeature | null {
  const polygonFeatures = features.filter(
    (f) => f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon"
  );

  if (polygonFeatures.length < 2) return null;

  try {
    // Flatten all inputs into individual polygon features
    const allPolygons = polygonFeatures.flatMap(extractPolygons);
    if (allPolygons.length < 2) return null;

    // Iteratively union all polygons using reduce
    let merged: Feature<Polygon | MultiPolygon> = allPolygons[0];

    for (let i = 1; i < allPolygons.length; i++) {
      const result = turf.union(
        turf.featureCollection([merged, allPolygons[i]])
      );
      if (!result) return null;
      merged = result as Feature<Polygon | MultiPolygon>;
    }

    // Always produce MultiPolygon when merging
    let finalGeometry: MultiPolygon;
    if (merged.geometry.type === "Polygon") {
      finalGeometry = {
        type: "MultiPolygon",
        coordinates: [(merged.geometry as Polygon).coordinates],
      };
    } else {
      finalGeometry = merged.geometry as MultiPolygon;
    }
    const propType: ParkFeatureType = "multipolygon";

    const firstProps = polygonFeatures[0].properties;
    const newFeature: ParkFeature = {
      id: uuidv4(),
      type: "Feature",
      geometry: finalGeometry,
      properties: {
        ...firstProps,
        type: propType,
        label: firstProps.label
          ? `${firstProps.label} (結合)`
          : undefined,
      },
    };

    return newFeature;
  } catch {
    console.error("Failed to merge polygons");
    return null;
  }
}

/**
 * Extract individual line coordinate arrays from a ParkFeature.
 * Handles both LineString and MultiLineString geometries.
 */
function extractLineCoords(feature: ParkFeature): Position[][] {
  if (feature.geometry.type === "LineString") {
    return [(feature.geometry as LineString).coordinates];
  }
  if (feature.geometry.type === "MultiLineString") {
    return (feature.geometry as MultiLineString).coordinates;
  }
  return [];
}

/**
 * Merge multiple lines into one by concatenating coordinates.
 * Connected endpoints are deduplicated.
 * Disjoint lines become a MultiLineString.
 * Accepts both LineString and MultiLineString inputs.
 */
export function mergeLines(features: ParkFeature[]): ParkFeature | null {
  const lineFeatures = features.filter(
    (f) => f.geometry.type === "LineString" || f.geometry.type === "MultiLineString"
  );

  if (lineFeatures.length < 2) return null;

  try {
    // Flatten all inputs into individual line coordinate arrays
    const allLines = lineFeatures.flatMap(extractLineCoords);
    if (allLines.length < 2) return null;

    // Try to connect lines that share endpoints, otherwise keep as separate parts
    const connected: Position[][] = [allLines[0]];

    for (let i = 1; i < allLines.length; i++) {
      const coords = allLines[i];
      const lastSegment = connected[connected.length - 1];
      const lastCoord = lastSegment[lastSegment.length - 1];
      const firstCoord = coords[0];

      // If endpoints connect, extend the current segment
      if (lastCoord[0] === firstCoord[0] && lastCoord[1] === firstCoord[1]) {
        lastSegment.push(...coords.slice(1));
      } else {
        // Disjoint — start a new segment
        connected.push(coords);
      }
    }

    // Always produce MultiLineString when merging
    const propType: ParkFeatureType = "multiline";
    const geometry: MultiLineString = {
      type: "MultiLineString",
      coordinates: connected,
    };

    const firstProps = lineFeatures[0].properties;
    const newFeature: ParkFeature = {
      id: uuidv4(),
      type: "Feature",
      geometry,
      properties: {
        ...firstProps,
        type: propType,
        label: firstProps.label
          ? `${firstProps.label} (結合)`
          : undefined,
      },
    };

    return newFeature;
  } catch {
    console.error("Failed to merge lines");
    return null;
  }
}

/**
 * Normalize a Turf result geometry into a Polygon or MultiPolygon.
 *
 * - Polygon → returned as-is
 * - MultiPolygon → returned as-is
 * - GeometryCollection → extract all Polygon/MultiPolygon parts and
 *   combine into a single MultiPolygon (or Polygon if only one part)
 * - Anything else → null
 */
export function normalizeToPolygonGeometry(
  geom: Geometry
): Polygon | MultiPolygon | null {
  if (geom.type === "Polygon") return geom;
  if (geom.type === "MultiPolygon") return geom;

  if (geom.type === "GeometryCollection") {
    const polygonCoords: Position[][][] = [];
    for (const g of geom.geometries) {
      if (g.type === "Polygon") {
        polygonCoords.push(g.coordinates);
      } else if (g.type === "MultiPolygon") {
        polygonCoords.push(...g.coordinates);
      }
    }
    if (polygonCoords.length === 0) return null;
    if (polygonCoords.length === 1) {
      return { type: "Polygon", coordinates: polygonCoords[0] };
    }
    return { type: "MultiPolygon", coordinates: polygonCoords };
  }

  return null;
}

/**
 * Clip (subtract) a polygon region from a target feature.
 *
 * The cutter polygon is subtracted from the source using turf.difference.
 * The result is a SINGLE feature with the same id and properties — only
 * the geometry is updated.
 *
 * - If the clip produces disjoint parts → MultiPolygon (still ONE feature)
 * - If the clip creates a hole → Polygon with interior ring (still ONE feature)
 * - If the entire geometry is removed → returns null
 *
 * @param feature - The polygon (or multi-polygon) feature to clip
 * @param cutter  - The polygon drawn by the user as the "cookie cutter"
 * @returns The same feature with updated geometry, or null if clip fails
 */
export function clipPolygon(
  feature: ParkFeature,
  cutter: Feature<Polygon | MultiPolygon>
): ParkFeature | null {
  if (
    feature.geometry.type !== "Polygon" &&
    feature.geometry.type !== "MultiPolygon"
  ) {
    return null;
  }

  try {
    // Build a Turf feature from the source geometry
    const source =
      feature.geometry.type === "Polygon"
        ? turf.polygon((feature.geometry as Polygon).coordinates)
        : turf.multiPolygon((feature.geometry as MultiPolygon).coordinates);

    // Direct boolean difference — subtract the cutter polygon from the source
    const result = turf.difference(turf.featureCollection([source, cutter]));
    if (!result) return null; // Entire geometry was removed by the cutter

    // Normalize the result to Polygon | MultiPolygon
    const normalizedGeometry = normalizeToPolygonGeometry(result.geometry);
    if (!normalizedGeometry) return null;

    // Determine the property type based on result geometry
    const propType: ParkFeatureType =
      normalizedGeometry.type === "MultiPolygon" ? "multipolygon" : "polygon";

    // Return the SAME feature with updated geometry
    // Preserves: id, label, layer, parkId, all other properties
    return {
      ...feature,
      geometry: normalizedGeometry,
      properties: {
        ...feature.properties,
        type: propType,
      },
    };
  } catch (e) {
    console.error("Failed to clip polygon:", e);
    return null;
  }
}

/**
 * Create a new empty feature with default properties.
 */
export function createDefaultFeature(
  geometryType: "Point" | "LineString" | "MultiLineString" | "Polygon" | "MultiPolygon",
  coordinates: Position | Position[] | Position[][] | Position[][][],
  overrides?: Partial<ParkFeatureProperties>
): ParkFeature {
  const typeMap: Record<string, ParkFeatureType> = {
    Point: "point",
    LineString: "line",
    MultiLineString: "multiline",
    Polygon: "polygon",
    MultiPolygon: "multipolygon",
  };

  return {
    id: uuidv4(),
    type: "Feature",
    geometry: {
      type: geometryType,
      coordinates,
    } as ParkFeature["geometry"],
    properties: {
      type: typeMap[geometryType],
      layer: "draft",
      ...overrides,
    },
  };
}

/**
 * Normalize drawing parts into the correct GeoJSON geometry.
 *
 * - 1 line part  → LineString
 * - 2+ line parts → MultiLineString
 * - 1 polygon part → Polygon
 * - 2+ polygon parts → MultiPolygon
 */
export function normalizeDrawingParts(
  partsType: DrawingPartsType,
  parts: Position[][] | Position[][][]
): { geometry: ParkFeature["geometry"]; featureType: ParkFeatureType } {
  if (partsType === "line") {
    const lineParts = parts as Position[][];
    if (lineParts.length === 1) {
      return {
        geometry: { type: "LineString", coordinates: lineParts[0] },
        featureType: "line",
      };
    }
    return {
      geometry: { type: "MultiLineString", coordinates: lineParts },
      featureType: "multiline",
    };
  }

  // polygon
  const polygonParts = parts as Position[][][];
  if (polygonParts.length === 1) {
    return {
      geometry: { type: "Polygon", coordinates: polygonParts[0] },
      featureType: "polygon",
    };
  }
  return {
    geometry: { type: "MultiPolygon", coordinates: polygonParts },
    featureType: "multipolygon",
  };
}
