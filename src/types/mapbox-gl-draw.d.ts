declare module "@mapbox/mapbox-gl-draw" {
  import type { Feature, FeatureCollection, GeoJsonProperties, Geometry } from "geojson";

  interface DrawOptions {
    displayControlsDefault?: boolean;
    controls?: {
      point?: boolean;
      line_string?: boolean;
      polygon?: boolean;
      trash?: boolean;
      combine_features?: boolean;
      uncombine_features?: boolean;
    };
    styles?: object[];
    userProperties?: boolean;
    defaultMode?: string;
  }

  interface DrawEvent {
    features: Feature[];
  }

  interface DrawModeChangeEvent {
    mode: string;
  }

  class MapboxDraw {
    constructor(options?: DrawOptions);

    add(geojson: Feature | FeatureCollection): string[];
    get(featureId: string): Feature | undefined;
    getFeatureIdsAt(point: { x: number; y: number }): string[];
    getSelectedIds(): string[];
    getSelected(): FeatureCollection;
    getSelectedPoints(): FeatureCollection;
    getAll(): FeatureCollection;
    delete(ids: string | string[]): this;
    deleteAll(): this;
    set(featureCollection: FeatureCollection): string[];
    trash(): this;
    combineFeatures(): this;
    uncombineFeatures(): this;
    getMode(): string;
    changeMode(mode: string, options?: object): this;
    setFeatureProperty(
      featureId: string,
      property: string,
      value: unknown
    ): this;

    onAdd(map: unknown): HTMLElement;
    onRemove(map: unknown): void;
  }

  export default MapboxDraw;
}
