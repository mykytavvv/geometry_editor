import * as turf from "@turf/turf";
import type { Map as MaplibreMap } from "maplibre-gl";
import type { Feature, FeatureCollection, Point } from "geojson";

/**
 * Fly the map camera to frame all geometries in the given features.
 *
 * - Single Point → map.flyTo (centered, zoom 17)
 * - Everything else → map.fitBounds using turf.bbox
 *
 * Padding: 80px — balanced breathing room that accounts for the 260px
 * layer panel overlay without wasting viewport on larger screens.
 *
 * Duration: 1000ms — smooth but not sluggish.
 *
 * maxZoom: 18 — prevents over-zooming on tiny polygons or short lines.
 *
 * essential: true — ensures animation completes even when the user has
 * prefers-reduced-motion enabled (this is an intentional user action).
 */
export function flyToLayer(map: MaplibreMap, features: Feature[]): void {
  if (!map || features.length === 0) return;

  try {
    // Single point — use flyTo for a cleaner animation
    if (
      features.length === 1 &&
      features[0].geometry &&
      features[0].geometry.type === "Point"
    ) {
      const coords = (features[0].geometry as Point).coordinates;
      map.flyTo({
        center: [coords[0], coords[1]],
        zoom: 17,
        duration: 1000,
        essential: true,
      });
      return;
    }

    // Build a FeatureCollection and compute its bounding box
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: features.filter((f) => f.geometry != null),
    };

    if (fc.features.length === 0) return;

    const [minX, minY, maxX, maxY] = turf.bbox(fc);

    // Guard against degenerate bbox (all points identical)
    if (minX === maxX && minY === maxY) {
      map.flyTo({
        center: [minX, minY],
        zoom: 17,
        duration: 1000,
        essential: true,
      });
      return;
    }

    map.fitBounds(
      [
        [minX, minY],
        [maxX, maxY],
      ],
      {
        padding: 80,
        duration: 1000,
        maxZoom: 18,
        essential: true,
      }
    );
  } catch {
    // Fail gracefully on invalid geometries — do nothing
  }
}
