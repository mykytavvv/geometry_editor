import type { ParkFeatureCollection } from "./types";

/**
 * Mock data for the geometry editor.
 * Features are centered around Chikusa Park (千種公園) in Nagoya.
 */
export const MOCK_FEATURES: ParkFeatureCollection = {
  type: "FeatureCollection",
  features: [
    // ─── Park Boundary (main polygon) ────────────────────────
    {
      id: "park-boundary-1",
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [136.9345, 35.1680],
            [136.9420, 35.1680],
            [136.9430, 35.1665],
            [136.9430, 35.1620],
            [136.9415, 35.1605],
            [136.9360, 35.1605],
            [136.9340, 35.1620],
            [136.9338, 35.1660],
            [136.9345, 35.1680],
          ],
        ],
      },
      properties: {
        type: "polygon",
        label: "千種公園",
        layer: "park",
        linkedAttributes: {
          "管理番号": "CHK-001",
          "面積(ha)": 12.8,
          "開園年": 1987,
        },
      },
    },

    // ─── Inner green area ────────────────────────────────────
    {
      id: "park-inner-1",
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [136.9360, 35.1670],
            [136.9400, 35.1670],
            [136.9410, 35.1650],
            [136.9405, 35.1630],
            [136.9370, 35.1625],
            [136.9355, 35.1640],
            [136.9360, 35.1670],
          ],
        ],
      },
      properties: {
        type: "polygon",
        label: "中央広場",
        layer: "park",
        linkedAttributes: {
          "種別": "広場",
          "面積(ha)": 3.2,
        },
      },
    },

    // ─── Walking path (line) ─────────────────────────────────
    {
      id: "path-1",
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [136.9350, 35.1615],
          [136.9365, 35.1625],
          [136.9380, 35.1640],
          [136.9395, 35.1660],
          [136.9410, 35.1670],
        ],
      },
      properties: {
        type: "line",
        label: "メイン遊歩道",
        layer: "facilities",
        parkId: "park-boundary-1",
        linkedAttributes: {
          "舗装": "アスファルト",
          "幅員(m)": 2.5,
        },
      },
    },

    // ─── Secondary path ──────────────────────────────────────
    {
      id: "path-2",
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [136.9370, 35.1615],
          [136.9385, 35.1635],
          [136.9400, 35.1645],
          [136.9415, 35.1650],
        ],
      },
      properties: {
        type: "line",
        label: "東側遊歩道",
        layer: "facilities",
        parkId: "park-boundary-1",
        linkedAttributes: {
          "舗装": "砂利",
          "幅員(m)": 1.8,
        },
      },
    },

    // ─── Playground equipment (point) ────────────────────────
    {
      id: "asset-playground-1",
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [136.9375, 35.1645],
      },
      properties: {
        type: "point",
        label: "遊具エリア",
        icon: "playground",
        size: 12,
        layer: "facilities",
        parkId: "park-boundary-1",
        linkedAttributes: {
          "設置年": 2015,
          "点検日": "2025-10-15",
          "状態": "要修繕",
        },
      },
    },

    // ─── Bench (point) ───────────────────────────────────────
    {
      id: "asset-bench-1",
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [136.9390, 35.1655],
      },
      properties: {
        type: "point",
        label: "ベンチ B-01",
        icon: "bench",
        size: 8,
        layer: "facilities",
        parkId: "park-boundary-1",
        linkedAttributes: {
          "材質": "木製",
          "設置年": 2019,
        },
      },
    },

    // ─── Toilet (point) ──────────────────────────────────────
    {
      id: "asset-toilet-1",
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [136.9405, 35.1625],
      },
      properties: {
        type: "point",
        label: "トイレ T-01",
        icon: "toilet",
        size: 10,
        layer: "facilities",
        parkId: "park-boundary-1",
        linkedAttributes: {
          "種別": "多目的",
          "バリアフリー": true,
        },
      },
    },

    // ─── Street light (point) ────────────────────────────────
    {
      id: "asset-light-1",
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [136.9365, 35.1630],
      },
      properties: {
        type: "point",
        label: "街灯 L-01",
        icon: "light",
        size: 6,
        layer: "facilities",
        parkId: "park-boundary-1",
        linkedAttributes: {
          "種別": "LED",
          "設置年": 2020,
          "ワット数": 60,
        },
      },
    },

    // ─── Asset marker (point) ─────────────────────────────
    {
      id: "incident-1",
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [136.9388, 35.1638],
      },
      properties: {
        type: "point",
        label: "倒木報告",
        icon: "marker",
        size: 10,
        layer: "facilities",
        parkId: "park-boundary-1",
        linkedAttributes: {
          "報告日": "2025-12-01",
          "種別": "倒木",
          "対応状況": "未対応",
        },
      },
    },

    // ─── Text label ──────────────────────────────────────────
    {
      id: "text-label-1",
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [136.9385, 35.1650],
      },
      properties: {
        type: "text",
        label: "Chikusa Park\n千種公園",
        size: 16,
        layer: "park",
        parkId: "park-boundary-1",
      },
    },
  ],
};
