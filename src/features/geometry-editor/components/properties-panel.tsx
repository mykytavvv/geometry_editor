"use client";

import React, { useCallback, useMemo } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Circle,
  Minus,
  Pentagon,
  Type,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { LAYER_CONFIG, POINT_ICONS } from "../constants";
import { calculateFeatureMetrics, formatDistance, formatArea } from "../lib/measurement";
import { findContainingPark } from "../lib/spatial-utils";
import type { ParkFeature, ParkFeatureCollection, ParkFeatureProperties, ParkLayer } from "../types";

const MIXED = Symbol("mixed");

const TYPE_ICONS: Record<string, React.ReactNode> = {
  point: <Circle className="h-3.5 w-3.5" />,
  line: <Minus className="h-3.5 w-3.5" />,
  multiline: <Minus className="h-3.5 w-3.5" />,
  polygon: <Pentagon className="h-3.5 w-3.5" />,
  multipolygon: <Pentagon className="h-3.5 w-3.5" />,
  text: <Type className="h-3.5 w-3.5" />,
};

const TYPE_LABELS: Record<string, string> = {
  point: "ポイント",
  line: "ライン",
  multiline: "マルチライン",
  polygon: "ポリゴン",
  multipolygon: "マルチポリゴン",
  text: "テキスト",
};

/** Return the shared value if all features agree, or MIXED symbol. */
function sharedValue<T>(features: ParkFeature[], getter: (f: ParkFeature) => T): T | typeof MIXED {
  if (features.length === 0) return MIXED;
  const first = getter(features[0]);
  for (let i = 1; i < features.length; i++) {
    if (getter(features[i]) !== first) return MIXED;
  }
  return first;
}

interface PropertiesPanelProps {
  open: boolean;
  onToggle: () => void;
  selectedFeatures: ParkFeature[];
  allFeatures: ParkFeatureCollection;
  onUpdateFeature: (feature: ParkFeature) => void;
  onBulkUpdateProperties?: (ids: string[], properties: Partial<ParkFeatureProperties>) => void;
}

export function PropertiesPanel({
  open,
  onToggle,
  selectedFeatures,
  allFeatures,
  onUpdateFeature,
  onBulkUpdateProperties,
}: PropertiesPanelProps) {
  const feature = selectedFeatures.length === 1 ? selectedFeatures[0] : null;
  const multiSelect = selectedFeatures.length > 1;

  // Available parks for the parkId dropdown
  const parkFeatures = useMemo(
    () =>
      allFeatures.features.filter(
        (f) => f.properties.layer === "park" && !f.properties.parkId
      ),
    [allFeatures.features]
  );

  const updateProperty = useCallback(
    (key: string, value: string | number | undefined) => {
      if (!feature) return;
      const updated: ParkFeature = {
        ...feature,
        properties: {
          ...feature.properties,
          [key]: value,
        },
      };
      onUpdateFeature(updated);
    },
    [feature, onUpdateFeature]
  );

  // Handle layer change with auto-assignment
  const handleLayerChange = useCallback(
    (newLayer: string) => {
      if (!feature) return;
      const updatedProps = {
        ...feature.properties,
        layer: newLayer as ParkLayer,
      };

      // Auto-assign parkId when switching to "facilities"
      if (newLayer === "facilities" && !feature.properties.parkId) {
        const containingPark = findContainingPark(feature, parkFeatures);
        if (containingPark) {
          updatedProps.parkId = containingPark.id;
        }
      }

      // Clear parkId when switching away from "facilities" (unless it's a park sub-feature)
      if (newLayer === "draft") {
        updatedProps.parkId = undefined;
      }

      onUpdateFeature({ ...feature, properties: updatedProps });
    },
    [feature, onUpdateFeature, parkFeatures]
  );

  // ─── Bulk edit helpers ──────────────────────────────────────
  const bulkIds = useMemo(
    () => selectedFeatures.map((f) => f.id),
    [selectedFeatures]
  );

  const bulkShared = useMemo(() => {
    if (!multiSelect) return null;
    return {
      layer: sharedValue(selectedFeatures, (f) => f.properties.layer || "draft"),
      parkId: sharedValue(selectedFeatures, (f) => f.properties.parkId || ""),
      icon: sharedValue(selectedFeatures, (f) => f.properties.icon || "marker"),
      size: sharedValue(selectedFeatures, (f) => f.properties.size ?? 8),
    };
  }, [multiSelect, selectedFeatures]);

  const allPointsOrText = useMemo(
    () =>
      multiSelect &&
      selectedFeatures.every(
        (f) => f.properties.type === "point" || f.properties.type === "text"
      ),
    [multiSelect, selectedFeatures]
  );

  const allFacilities = useMemo(
    () =>
      multiSelect &&
      selectedFeatures.every((f) => f.properties.layer === "facilities"),
    [multiSelect, selectedFeatures]
  );

  // Type counts for multi-select header
  const typeCounts = useMemo(() => {
    if (!multiSelect) return [];
    const counts: Record<string, number> = {};
    for (const f of selectedFeatures) {
      counts[f.properties.type] = (counts[f.properties.type] || 0) + 1;
    }
    return Object.entries(counts).map(([type, count]) => ({
      type,
      count,
      label: TYPE_LABELS[type] || type,
    }));
  }, [multiSelect, selectedFeatures]);

  const handleBulkLayerChange = useCallback(
    (newLayer: string) => {
      if (!onBulkUpdateProperties) return;
      const props: Partial<ParkFeatureProperties> = {
        layer: newLayer as ParkLayer,
      };
      // Clear parkId when switching to draft
      if (newLayer === "draft") {
        props.parkId = undefined;
      }
      onBulkUpdateProperties(bulkIds, props);
    },
    [onBulkUpdateProperties, bulkIds]
  );

  const handleBulkParkChange = useCallback(
    (parkId: string) => {
      if (!onBulkUpdateProperties) return;
      onBulkUpdateProperties(bulkIds, { parkId: parkId || undefined });
    },
    [onBulkUpdateProperties, bulkIds]
  );

  const handleBulkIconChange = useCallback(
    (icon: string) => {
      if (!onBulkUpdateProperties) return;
      onBulkUpdateProperties(bulkIds, { icon });
    },
    [onBulkUpdateProperties, bulkIds]
  );

  const handleBulkSizeChange = useCallback(
    (size: number) => {
      if (!onBulkUpdateProperties) return;
      onBulkUpdateProperties(bulkIds, { size });
    },
    [onBulkUpdateProperties, bulkIds]
  );

  const metrics = feature ? calculateFeatureMetrics(feature) : null;

  return (
    <div
      className={cn(
        "absolute right-0 top-0 z-10 h-full w-[300px] transition-transform duration-200",
        open ? "translate-x-0" : "translate-x-full"
      )}
    >
      {/* Pill toggle button on left edge */}
      <button
        onClick={onToggle}
        className={cn(
          "absolute top-1/2 -translate-y-1/2 -left-6 z-20 flex h-12 w-6 items-center justify-center",
          "rounded-l-lg bg-white border border-r-0 border-border/60 shadow-md",
          "text-muted-foreground hover:text-foreground hover:bg-gray-50 transition-colors"
        )}
        aria-label={
          open ? "プロパティパネルを閉じる" : "プロパティパネルを開く"
        }
      >
        {open ? (
          <ChevronRight className="h-4 w-4" />
        ) : (
          <ChevronLeft className="h-4 w-4" />
        )}
      </button>

      <div className="flex h-full flex-col border-l border-border/30 bg-background/95 backdrop-blur-sm">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <h3 className="text-sm font-semibold">プロパティ</h3>
            {feature && (
              <div className="flex items-center gap-1.5">
                {TYPE_ICONS[feature.properties.type]}
                <Badge variant="secondary" className="text-[10px]">
                  {TYPE_LABELS[feature.properties.type]}
                </Badge>
              </div>
            )}
          </div>

          {/* Content */}
          {!feature && !multiSelect && (
            <div className="flex flex-1 items-center justify-center p-4 text-center">
              <p className="text-xs text-muted-foreground">
                フィーチャーを選択してプロパティを表示
              </p>
            </div>
          )}

          {multiSelect && (
            <ScrollArea className="flex-1">
              <div className="space-y-3 px-3 py-3">
                {/* Selection summary */}
                <div className="space-y-1.5">
                  <p className="text-sm font-medium">
                    {selectedFeatures.length} 件選択中
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {typeCounts.map(({ type, count, label }) => (
                      <Badge key={type} variant="secondary" className="text-[10px] gap-1">
                        {TYPE_ICONS[type]}
                        {count} {label}
                      </Badge>
                    ))}
                  </div>
                </div>

                <Separator />

                {/* Bulk Layer */}
                <div className="space-y-1">
                  <Label className="text-xs">レイヤー</Label>
                  <Select
                    value={bulkShared?.layer === MIXED ? "__mixed__" : (bulkShared?.layer as string) || "draft"}
                    onValueChange={(v) => {
                      if (v !== "__mixed__") handleBulkLayerChange(v);
                    }}
                  >
                    <SelectTrigger className={cn("h-8 text-sm", bulkShared?.layer === MIXED && "text-muted-foreground")}>
                      <SelectValue placeholder="混在" />
                    </SelectTrigger>
                    <SelectContent>
                      {bulkShared?.layer === MIXED && (
                        <SelectItem value="__mixed__" disabled>
                          <span className="text-muted-foreground">混在</span>
                        </SelectItem>
                      )}
                      {(Object.entries(LAYER_CONFIG) as [ParkLayer, (typeof LAYER_CONFIG)[ParkLayer]][]).map(
                        ([id, config]) => (
                          <SelectItem key={id} value={id}>
                            <div className="flex items-center gap-2">
                              <div
                                className="h-2 w-2 rounded-full"
                                style={{ backgroundColor: config.color }}
                              />
                              {config.label}
                            </div>
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">
                    全{selectedFeatures.length}件に適用されます
                  </p>
                </div>

                {/* Bulk Park assignment (shown when all selected are facilities) */}
                {allFacilities && (
                  <div className="space-y-1">
                    <Label className="text-xs">所属公園</Label>
                    <Select
                      value={bulkShared?.parkId === MIXED ? "__mixed__" : (bulkShared?.parkId as string) || ""}
                      onValueChange={(v) => {
                        if (v !== "__mixed__") handleBulkParkChange(v);
                      }}
                    >
                      <SelectTrigger className={cn("h-8 text-sm", bulkShared?.parkId === MIXED && "text-muted-foreground")}>
                        <SelectValue placeholder={bulkShared?.parkId === MIXED ? "混在" : "公園を選択..."} />
                      </SelectTrigger>
                      <SelectContent>
                        {bulkShared?.parkId === MIXED && (
                          <SelectItem value="__mixed__" disabled>
                            <span className="text-muted-foreground">混在</span>
                          </SelectItem>
                        )}
                        {parkFeatures.map((park) => (
                          <SelectItem key={park.id} value={park.id}>
                            <div className="flex items-center gap-2">
                              <div
                                className="h-2 w-2 rounded-full"
                                style={{
                                  backgroundColor: LAYER_CONFIG.park.color,
                                }}
                              />
                              {park.properties.label ||
                                `公園 #${park.id.slice(-4)}`}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Bulk Icon & Size (shown when all selected are points/text) */}
                {allPointsOrText && (
                  <>
                    <Separator />
                    <div className="space-y-1">
                      <Label className="text-xs">アイコン</Label>
                      <Select
                        value={bulkShared?.icon === MIXED ? "__mixed__" : (bulkShared?.icon as string) || "marker"}
                        onValueChange={(v) => {
                          if (v !== "__mixed__") handleBulkIconChange(v);
                        }}
                      >
                        <SelectTrigger className={cn("h-8 text-sm", bulkShared?.icon === MIXED && "text-muted-foreground")}>
                          <SelectValue placeholder="混在" />
                        </SelectTrigger>
                        <SelectContent>
                          {bulkShared?.icon === MIXED && (
                            <SelectItem value="__mixed__" disabled>
                              <span className="text-muted-foreground">混在</span>
                            </SelectItem>
                          )}
                          {POINT_ICONS.map((icon) => (
                            <SelectItem key={icon.value} value={icon.value}>
                              {icon.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs">サイズ</Label>
                      <Input
                        type="number"
                        value={bulkShared?.size === MIXED ? "" : (bulkShared?.size as number)}
                        onChange={(e) => {
                          const v = parseInt(e.target.value);
                          if (v) handleBulkSizeChange(v);
                        }}
                        placeholder={bulkShared?.size === MIXED ? "混在" : undefined}
                        min={4}
                        max={48}
                        className="h-8 text-sm"
                      />
                    </div>
                  </>
                )}
              </div>
            </ScrollArea>
          )}

          {feature && (
            <ScrollArea className="flex-1">
              <Tabs defaultValue="properties" className="w-full">
                <TabsList className="mx-3 mt-2 w-[calc(100%-24px)]">
                  <TabsTrigger value="properties" className="flex-1 text-xs">
                    プロパティ
                  </TabsTrigger>
                  <TabsTrigger value="geometry" className="flex-1 text-xs">
                    ジオメトリ
                  </TabsTrigger>
                </TabsList>

                {/* ─── Properties Tab ─────────────────────── */}
                <TabsContent value="properties" className="space-y-3 px-3 pb-4">
                  {/* Label */}
                  <div className="space-y-1">
                    <Label className="text-xs">ラベル</Label>
                    <Input
                      value={feature.properties.label || ""}
                      onChange={(e) => updateProperty("label", e.target.value)}
                      placeholder="ラベルを入力..."
                      className="h-8 text-sm"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      地図上にテキストとして表示されます
                    </p>
                  </div>

                  {/* Layer */}
                  <div className="space-y-1">
                    <Label className="text-xs">レイヤー</Label>
                    <Select
                      value={feature.properties.layer || "draft"}
                      onValueChange={handleLayerChange}
                    >
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.entries(LAYER_CONFIG) as [ParkLayer, (typeof LAYER_CONFIG)[ParkLayer]][]).map(
                          ([id, config]) => (
                            <SelectItem key={id} value={id}>
                              <div className="flex items-center gap-2">
                                <div
                                  className="h-2 w-2 rounded-full"
                                  style={{ backgroundColor: config.color }}
                                />
                                {config.label}
                              </div>
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Park assignment (shown for facilities and park sub-features) */}
                  {(feature.properties.layer === "facilities" ||
                    (feature.properties.layer === "park" && feature.properties.parkId)) && (
                    <div className="space-y-1">
                      <Label className="text-xs">所属公園</Label>
                      <Select
                        value={feature.properties.parkId || ""}
                        onValueChange={(v) =>
                          updateProperty("parkId", v || undefined)
                        }
                      >
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue placeholder="公園を選択..." />
                        </SelectTrigger>
                        <SelectContent>
                          {parkFeatures.map((park) => (
                            <SelectItem key={park.id} value={park.id}>
                              <div className="flex items-center gap-2">
                                <div
                                  className="h-2 w-2 rounded-full"
                                  style={{
                                    backgroundColor: LAYER_CONFIG.park.color,
                                  }}
                                />
                                {park.properties.label ||
                                  `公園 #${park.id.slice(-4)}`}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[10px] text-muted-foreground">
                        施設が所属する公園を選択
                      </p>
                    </div>
                  )}

                  {/* Icon (for points/text) */}
                  {(feature.properties.type === "point" ||
                    feature.properties.type === "text") && (
                    <>
                      <Separator />
                      <div className="space-y-1">
                        <Label className="text-xs">アイコン</Label>
                        <Select
                          value={feature.properties.icon || "marker"}
                          onValueChange={(v) => updateProperty("icon", v)}
                        >
                          <SelectTrigger className="h-8 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {POINT_ICONS.map((icon) => (
                              <SelectItem key={icon.value} value={icon.value}>
                                {icon.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs">サイズ</Label>
                        <Input
                          type="number"
                          value={feature.properties.size ?? 8}
                          onChange={(e) =>
                            updateProperty(
                              "size",
                              parseInt(e.target.value) || 8
                            )
                          }
                          min={4}
                          max={48}
                          className="h-8 text-sm"
                        />
                      </div>
                    </>
                  )}
                </TabsContent>

                {/* ─── Geometry Tab ───────────────────────── */}
                <TabsContent value="geometry" className="space-y-3 px-3 pb-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">タイプ</span>
                      <span className="font-medium">
                        {feature.geometry.type}
                      </span>
                    </div>

                    {metrics && (
                      <>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">頂点数</span>
                          <span className="font-medium font-mono">
                            {metrics.vertexCount}
                          </span>
                        </div>

                        {metrics.length !== null && (
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">長さ</span>
                            <span className="font-medium font-mono">
                              {formatDistance(metrics.length)}
                            </span>
                          </div>
                        )}

                        {metrics.area !== null && (
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">面積</span>
                            <span className="font-medium font-mono">
                              {formatArea(metrics.area)}
                            </span>
                          </div>
                        )}

                        {metrics.perimeter !== null && (
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">周長</span>
                            <span className="font-medium font-mono">
                              {formatDistance(metrics.perimeter)}
                            </span>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  <Separator />

                   {/* Coordinates preview */}
                   <div className="space-y-1">
                     <Label className="text-xs">座標</Label>
                     <div className="max-h-40 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-[10px]">
                       {feature.geometry.type === "Point" && (
                         <p>
                           [{feature.geometry.coordinates[0].toFixed(6)},{" "}
                           {feature.geometry.coordinates[1].toFixed(6)}]
                         </p>
                       )}
                       {feature.geometry.type === "LineString" &&
                         feature.geometry.coordinates.map((c, i) => (
                           <p key={i}>
                             [{c[0].toFixed(6)}, {c[1].toFixed(6)}]
                           </p>
                         ))}
                       {feature.geometry.type === "MultiLineString" &&
                         feature.geometry.coordinates.map((line, li) => (
                           <div key={li}>
                             <p className="text-muted-foreground mt-1">パート {li + 1}:</p>
                             {line.map((c, i) => (
                               <p key={i}>
                                 [{c[0].toFixed(6)}, {c[1].toFixed(6)}]
                               </p>
                             ))}
                           </div>
                         ))}
                       {feature.geometry.type === "Polygon" &&
                         feature.geometry.coordinates[0].map((c, i) => (
                           <p key={i}>
                             [{c[0].toFixed(6)}, {c[1].toFixed(6)}]
                           </p>
                         ))}
                       {feature.geometry.type === "MultiPolygon" &&
                         feature.geometry.coordinates.map((poly, pi) => (
                           <div key={pi}>
                             <p className="text-muted-foreground mt-1">パート {pi + 1}:</p>
                             {poly[0].map((c, i) => (
                               <p key={i}>
                                 [{c[0].toFixed(6)}, {c[1].toFixed(6)}]
                               </p>
                             ))}
                           </div>
                         ))}
                     </div>
                   </div>

                  <p className="text-[10px] text-muted-foreground">
                    ID: {feature.id}
                  </p>
                </TabsContent>
              </Tabs>
            </ScrollArea>
          )}
        </div>
    </div>
  );
}
