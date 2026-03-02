import type { ParkFeatureCollection } from "../types";

const STORAGE_KEY = "park-geometry-editor:features";

export function saveFeatures(features: ParkFeatureCollection): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(features));
  } catch (e) {
    console.error("Failed to save features to localStorage:", e);
  }
}

export function loadFeatures(): ParkFeatureCollection | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ParkFeatureCollection;
    // Basic validation
    if (
      parsed &&
      parsed.type === "FeatureCollection" &&
      Array.isArray(parsed.features)
    ) {
      return parsed;
    }
    return null;
  } catch (e) {
    console.error("Failed to load features from localStorage:", e);
    return null;
  }
}
