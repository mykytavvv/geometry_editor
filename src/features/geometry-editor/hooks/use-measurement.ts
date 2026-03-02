"use client";

import { useCallback } from "react";
import type { Position } from "geojson";
import { v4 as uuidv4 } from "uuid";
import type { MeasurementState, ParkFeature } from "../types";
import {
  calculateDistance,
  calculateArea,
  calculatePerimeter,
  formatDistance,
  formatArea,
} from "../lib/measurement";

interface UseMeasurementProps {
  measurementState: MeasurementState | null;
  setMeasurementState: (state: MeasurementState | null) => void;
  setLiveMeasurement: (measurement: string | null) => void;
  addFeature: (feature: ParkFeature) => void;
}

export function useMeasurement({
  measurementState,
  setMeasurementState,
  setLiveMeasurement,
  addFeature,
}: UseMeasurementProps) {
  const startMeasurement = useCallback(
    (mode: "distance" | "area") => {
      setMeasurementState({
        mode,
        points: [],
        totalDistance: null,
        area: null,
        perimeter: null,
      });
      setLiveMeasurement(mode === "distance" ? "距離測定: クリックして点を追加" : "面積測定: クリックして頂点を追加");
    },
    [setMeasurementState, setLiveMeasurement]
  );

  const addMeasurementPoint = useCallback(
    (point: Position) => {
      if (!measurementState) return;

      const newPoints = [...measurementState.points, point];
      const distance = calculateDistance(newPoints);
      const area =
        measurementState.mode === "area" && newPoints.length >= 3
          ? calculateArea(newPoints)
          : null;
      const perimeter =
        measurementState.mode === "area" && newPoints.length >= 3
          ? calculatePerimeter(newPoints)
          : null;

      const newState: MeasurementState = {
        ...measurementState,
        points: newPoints,
        totalDistance: distance,
        area,
        perimeter,
      };

      setMeasurementState(newState);

      // Update live measurement display
      if (measurementState.mode === "distance") {
        setLiveMeasurement(`距離: ${formatDistance(distance)} (${newPoints.length} 点)`);
      } else {
        const parts: string[] = [];
        if (area !== null) parts.push(`面積: ${formatArea(area)}`);
        if (perimeter !== null) parts.push(`周長: ${formatDistance(perimeter)}`);
        setLiveMeasurement(
          parts.length > 0
            ? parts.join(" | ")
            : `面積測定: ${newPoints.length} 点`
        );
      }
    },
    [measurementState, setMeasurementState, setLiveMeasurement]
  );

  const removeLastMeasurementPoint = useCallback(() => {
    if (!measurementState || measurementState.points.length === 0) return;

    const newPoints = measurementState.points.slice(0, -1);
    const distance = calculateDistance(newPoints);
    const area =
      measurementState.mode === "area" && newPoints.length >= 3
        ? calculateArea(newPoints)
        : null;
    const perimeter =
      measurementState.mode === "area" && newPoints.length >= 3
        ? calculatePerimeter(newPoints)
        : null;

    setMeasurementState({
      ...measurementState,
      points: newPoints,
      totalDistance: distance,
      area,
      perimeter,
    });
  }, [measurementState, setMeasurementState]);

  const finishMeasurement = useCallback(() => {
    setMeasurementState(null);
    setLiveMeasurement(null);
  }, [setMeasurementState, setLiveMeasurement]);

  const saveAsGeometry = useCallback(() => {
    if (!measurementState || measurementState.points.length < 2) return;

    if (measurementState.mode === "distance") {
      const feature: ParkFeature = {
        id: uuidv4(),
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: measurementState.points,
        },
        properties: {
          type: "line",
          label: `測定ライン (${formatDistance(measurementState.totalDistance ?? 0)})`,
          layer: "draft",
        },
      };
      addFeature(feature);
    } else if (
      measurementState.mode === "area" &&
      measurementState.points.length >= 3
    ) {
      const closed = [...measurementState.points, measurementState.points[0]];
      const feature: ParkFeature = {
        id: uuidv4(),
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [closed],
        },
        properties: {
          type: "polygon",
          label: `測定エリア (${formatArea(measurementState.area ?? 0)})`,
          layer: "draft",
        },
      };
      addFeature(feature);
    }

    finishMeasurement();
  }, [measurementState, addFeature, finishMeasurement]);

  return {
    startMeasurement,
    addMeasurementPoint,
    removeLastMeasurementPoint,
    finishMeasurement,
    saveAsGeometry,
  };
}
