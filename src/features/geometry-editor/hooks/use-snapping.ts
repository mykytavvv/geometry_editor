"use client";

import { useCallback, useRef } from "react";
import type { Position } from "geojson";
import type { ParkFeatureCollection } from "../types";
import { findNearestVertex, type ProjectFn, type SnapResult } from "../lib/snapping";
import { SNAP_THRESHOLD_PX } from "../constants";

interface UseSnappingProps {
  features: ParkFeatureCollection;
  enabled: boolean;
}

export function useSnapping({ features, enabled }: UseSnappingProps) {
  const projectRef = useRef<ProjectFn | null>(null);

  const setProjectFn = useCallback((fn: ProjectFn) => {
    projectRef.current = fn;
  }, []);

  /**
   * Attempt to snap a point to the nearest vertex in the feature collection.
   * Returns the snapped point if within threshold, otherwise the original point.
   */
  const trySnap = useCallback(
    (point: Position, excludeFeatureId?: string): SnapResult => {
      if (!enabled || !projectRef.current) {
        return { snapped: null, original: point, distancePx: Infinity };
      }

      return findNearestVertex(
        point,
        features,
        projectRef.current,
        SNAP_THRESHOLD_PX,
        excludeFeatureId
      );
    },
    [features, enabled]
  );

  /**
   * Get the snapped or original point.
   */
  const snapOrOriginal = useCallback(
    (point: Position, excludeFeatureId?: string): Position => {
      const result = trySnap(point, excludeFeatureId);
      return result.snapped ?? result.original;
    },
    [trySnap]
  );

  return {
    setProjectFn,
    trySnap,
    snapOrOriginal,
  };
}
