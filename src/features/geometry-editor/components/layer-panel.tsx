"use client";

import React, { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Circle,
  Minus,
  Pentagon,
  Type,
  MapPin,
  Trees,
  GripVertical,
  LocateFixed,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { LAYER_CONFIG } from "../constants";
import type { ParkFeature, ParkFeatureCollection, ParkLayer } from "../types";

const FEATURE_TYPE_ICONS: Record<string, React.ReactNode> = {
  point: <Circle className="h-3 w-3" />,
  line: <Minus className="h-3 w-3" />,
  multiline: <Minus className="h-3 w-3" />,
  polygon: <Pentagon className="h-3 w-3" />,
  multipolygon: <Pentagon className="h-3 w-3" />,
  text: <Type className="h-3 w-3" />,
};

interface LayerPanelProps {
  open: boolean;
  onToggle: () => void;
  features: ParkFeatureCollection;
  selectedFeatureIds: string[];
  layerVisibility: Record<ParkLayer, boolean>;
  parkVisibility: Record<string, boolean>;
  onSelectFeature: (ids: string[]) => void;
  onToggleLayerVisibility: (layer: ParkLayer) => void;
  onToggleParkVisibility: (parkId: string) => void;
  onReassignFeature: (featureId: string, parkId: string | null) => void;
  onFlyToFeatures?: (features: ParkFeature[]) => void;
}

interface ParkGroup {
  parkFeature: ParkFeature;
  /** Park sub-features (e.g. text labels with layer: "park" and parkId) */
  parkSubFeatures: ParkFeature[];
  /** Facility features belonging to this park */
  facilities: ParkFeature[];
}

// Droppable zone IDs use a prefix so we can parse them
const UNASSIGNED_DROP_ID = "drop:unassigned";
const parkDropId = (parkId: string) => `drop:park:${parkId}`;
const parseParkDropId = (dropId: string): string | null => {
  if (dropId === UNASSIGNED_DROP_ID) return null; // null = unassign
  const match = dropId.match(/^drop:park:(.+)$/);
  return match ? match[1] : undefined as unknown as null;
};

export function LayerPanel({
  open,
  onToggle,
  features,
  selectedFeatureIds,
  layerVisibility,
  parkVisibility,
  onSelectFeature,
  onToggleLayerVisibility,
  onToggleParkVisibility,
  onReassignFeature,
  onFlyToFeatures,
}: LayerPanelProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(["draft"])
  );
  const [activeFeature, setActiveFeature] = useState<ParkFeature | null>(null);

  // Configure pointer sensor with activation distance to avoid interfering with clicks
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  // Build park groups and draft features
  const { parkGroups, draftFeatures, unassignedFacilities } = useMemo(() => {
    const parkMap = new Map<string, ParkGroup>();
    const drafts: ParkFeature[] = [];
    const unassigned: ParkFeature[] = [];

    // First pass: collect park-defining features (layer: "park" without parkId)
    for (const f of features.features) {
      if (f.properties.layer === "park" && !f.properties.parkId) {
        parkMap.set(f.id, {
          parkFeature: f,
          parkSubFeatures: [],
          facilities: [],
        });
      }
    }

    // Second pass: assign other features
    for (const f of features.features) {
      const layer = f.properties.layer || "draft";

      if (layer === "park" && !f.properties.parkId) {
        // Already handled as park group header
        continue;
      }

      if (layer === "draft") {
        drafts.push(f);
        continue;
      }

      if (layer === "park" && f.properties.parkId) {
        // Park sub-feature (e.g. text label)
        const group = parkMap.get(f.properties.parkId);
        if (group) {
          group.parkSubFeatures.push(f);
        } else {
          unassigned.push(f);
        }
        continue;
      }

      if (layer === "facilities") {
        if (f.properties.parkId) {
          const group = parkMap.get(f.properties.parkId);
          if (group) {
            group.facilities.push(f);
          } else {
            unassigned.push(f);
          }
        } else {
          unassigned.push(f);
        }
        continue;
      }

      // Fallback
      unassigned.push(f);
    }

    // Expand all park groups by default on first render
    const groups = Array.from(parkMap.values());

    return {
      parkGroups: groups,
      draftFeatures: drafts,
      unassignedFacilities: unassigned,
    };
  }, [features.features]);

  // Auto-expand park groups on first render
  React.useEffect(() => {
    if (parkGroups.length > 0) {
      setExpandedGroups((prev) => {
        const next = new Set(prev);
        for (const g of parkGroups) {
          next.add(g.parkFeature.id);
        }
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalFeatures = features.features.length;
  const parkConfig = LAYER_CONFIG.park;
  const draftConfig = LAYER_CONFIG.draft;

  // ─── DnD handlers ──────────────────────────────────────
  const handleDragStart = (event: DragStartEvent) => {
    const featureId = event.active.id as string;
    const feature = features.features.find((f) => f.id === featureId);
    if (feature) {
      setActiveFeature(feature);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveFeature(null);

    const { active, over } = event;
    if (!over) return;

    const featureId = active.id as string;
    const dropZoneId = over.id as string;
    const targetParkId = parseParkDropId(dropZoneId);

    // If parseParkDropId returned undefined (invalid drop zone), do nothing
    if (targetParkId === (undefined as unknown as null)) return;

    // Find current feature to check if it's actually moving
    const feature = features.features.find((f) => f.id === featureId);
    if (!feature) return;

    const currentParkId = feature.properties.parkId || null;

    // Don't fire if dropping back to the same location
    if (currentParkId === targetParkId) return;

    onReassignFeature(featureId, targetParkId);
  };

  const handleDragCancel = () => {
    setActiveFeature(null);
  };

  return (
    <div
      className={cn(
        "absolute left-0 top-0 z-10 h-full w-[260px] transition-transform duration-200",
        open ? "translate-x-0" : "-translate-x-full"
      )}
    >
      {/* Pill toggle button on right edge */}
      {open && (
        <button
          onClick={onToggle}
          className={cn(
            "absolute top-1/2 -translate-y-1/2 -right-6 z-20 flex h-12 w-6 items-center justify-center",
            "rounded-r-lg bg-white border border-l-0 border-border/60 shadow-md",
            "text-muted-foreground hover:text-foreground hover:bg-gray-50 transition-colors"
          )}
          aria-label="レイヤーパネルを閉じる"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}

      <div className="flex h-full flex-col border-r border-border/30 bg-background/95 backdrop-blur-sm">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-park" />
            <h3 className="text-sm font-semibold">レイヤー</h3>
          </div>
          <Badge variant="secondary" className="text-[10px]">
            {totalFeatures} 件
          </Badge>
        </div>

        <ScrollArea className="flex-1">
          <DndContext
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <div className="space-y-0.5 p-2">
              {/* ─── Park Groups ─────────────────────────── */}
              {parkGroups.map((group) => {
                const parkId = group.parkFeature.id;
                const isExpanded = expandedGroups.has(parkId);
                const isParkVisible = parkVisibility[parkId] ?? true;
                const childCount =
                  group.facilities.length + group.parkSubFeatures.length;
                const parkLabel =
                  group.parkFeature.properties.label ||
                  `公園 #${parkId.slice(-4)}`;

                return (
                  <DroppableParkGroup
                    key={parkId}
                    parkId={parkId}
                    isExpanded={isExpanded}
                    onToggleExpand={() => toggleGroup(parkId)}
                    isParkVisible={isParkVisible}
                    childCount={childCount}
                    parkLabel={parkLabel}
                    parkConfig={parkConfig}
                    selectedFeatureIds={selectedFeatureIds}
                    onSelectFeature={onSelectFeature}
                    onToggleParkVisibility={onToggleParkVisibility}
                    parkSubFeatures={group.parkSubFeatures}
                    parkFeature={group.parkFeature}
                    facilities={group.facilities}
                    isDragging={!!activeFeature}
                    onFlyToFeatures={onFlyToFeatures}
                  />
                );
              })}

              {/* ─── Unassigned Facilities ───────────────── */}
              <DroppableUnassigned
                isExpanded={expandedGroups.has("unassigned")}
                onToggleExpand={() => toggleGroup("unassigned")}
                unassignedFacilities={unassignedFacilities}
                selectedFeatureIds={selectedFeatureIds}
                onSelectFeature={onSelectFeature}
                isDragging={!!activeFeature}
                onFlyToFeatures={onFlyToFeatures}
              />

              {/* ─── Draft Layer ─────────────────────────── */}
              <Collapsible
                open={expandedGroups.has("draft")}
                onOpenChange={() => toggleGroup("draft")}
              >
                <div className="flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-muted/50">
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 shrink-0"
                    >
                      {expandedGroups.has("draft") ? (
                        <ChevronLeft className="h-3 w-3 -rotate-90" />
                      ) : (
                        <ChevronRight className="h-3 w-3" />
                      )}
                    </Button>
                  </CollapsibleTrigger>

                  <div
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: draftConfig.color }}
                  />

                  <span className="flex-1 truncate text-xs font-medium">
                    {draftConfig.label}
                  </span>

                  <Badge
                    variant="outline"
                    className="h-4 px-1 text-[9px]"
                  >
                    {draftFeatures.length}
                  </Badge>

                  {onFlyToFeatures && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 shrink-0"
                      disabled={draftFeatures.length === 0}
                      title="下書きに移動"
                      onClick={(e) => {
                        e.stopPropagation();
                        onFlyToFeatures(draftFeatures);
                      }}
                    >
                      <LocateFixed className="h-3 w-3" />
                    </Button>
                  )}

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleLayerVisibility("draft");
                    }}
                  >
                    {layerVisibility.draft ? (
                      <Eye className="h-3 w-3" />
                    ) : (
                      <EyeOff className="h-3 w-3 text-muted-foreground/50" />
                    )}
                  </Button>
                </div>

                <CollapsibleContent>
                  <div className="ml-4 space-y-0.5 border-l border-border pl-2">
                    {draftFeatures.map((feature) => (
                      <FeatureItem
                        key={feature.id}
                        feature={feature}
                        isSelected={selectedFeatureIds.includes(feature.id)}
                        onSelect={() => onSelectFeature([feature.id])}
                        onFlyTo={onFlyToFeatures ? () => onFlyToFeatures([feature]) : undefined}
                        draggable={false}
                      />
                    ))}
                    {draftFeatures.length === 0 && (
                      <p className="px-2 py-1 text-[10px] italic text-muted-foreground/50">
                        なし
                      </p>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>

            {/* Drag overlay: floating ghost of the dragged item */}
            <DragOverlay dropAnimation={null}>
              {activeFeature ? (
                <div className="rounded-md border border-blue-300 bg-blue-50/90 px-2 py-1 shadow-lg backdrop-blur-sm">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-blue-700">
                    <GripVertical className="h-3 w-3" />
                    {FEATURE_TYPE_ICONS[activeFeature.properties.type]}
                    <span className="truncate">
                      {activeFeature.properties.label ||
                        `${activeFeature.properties.type} #${activeFeature.id.slice(-4)}`}
                    </span>
                  </div>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </ScrollArea>
      </div>
    </div>
  );
}

// ─── Droppable Park Group ───────────────────────────────────
function DroppableParkGroup({
  parkId,
  isExpanded,
  onToggleExpand,
  isParkVisible,
  childCount,
  parkLabel,
  parkConfig,
  selectedFeatureIds,
  onSelectFeature,
  onToggleParkVisibility,
  parkSubFeatures,
  parkFeature,
  facilities,
  isDragging,
  onFlyToFeatures,
}: {
  parkId: string;
  isExpanded: boolean;
  onToggleExpand: () => void;
  isParkVisible: boolean;
  childCount: number;
  parkLabel: string;
  parkConfig: { color: string; label: string };
  selectedFeatureIds: string[];
  onSelectFeature: (ids: string[]) => void;
  onToggleParkVisibility: (parkId: string) => void;
  parkSubFeatures: ParkFeature[];
  parkFeature: ParkFeature;
  facilities: ParkFeature[];
  isDragging: boolean;
  onFlyToFeatures?: (features: ParkFeature[]) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: parkDropId(parkId),
  });

  return (
    <Collapsible
      open={isExpanded}
      onOpenChange={onToggleExpand}
    >
      <div
        ref={setNodeRef}
        className={cn(
          "flex items-center gap-1 rounded-md px-1 py-0.5 transition-colors",
          isOver
            ? "bg-blue-100 ring-1 ring-blue-400"
            : isDragging
              ? "bg-muted/30 ring-1 ring-dashed ring-muted-foreground/20"
              : "hover:bg-muted/50"
        )}
      >
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 shrink-0"
          >
            {isExpanded ? (
              <ChevronLeft className="h-3 w-3 -rotate-90" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </Button>
        </CollapsibleTrigger>

        <Trees
          className="h-3 w-3 shrink-0"
          style={{ color: parkConfig.color }}
        />

        <button
          onClick={() => onSelectFeature([parkId])}
          className={cn(
            "flex-1 truncate text-left text-xs font-medium",
            selectedFeatureIds.includes(parkId) ? "text-park" : ""
          )}
        >
          {parkLabel}
        </button>

        <Badge variant="outline" className="h-4 px-1 text-[9px]">
          {childCount}
        </Badge>

        {onFlyToFeatures && (
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 shrink-0"
            title="このグループに移動"
            onClick={(e) => {
              e.stopPropagation();
              onFlyToFeatures([parkFeature, ...parkSubFeatures, ...facilities]);
            }}
          >
            <LocateFixed className="h-3 w-3" />
          </Button>
        )}

        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onToggleParkVisibility(parkId);
          }}
        >
          {isParkVisible ? (
            <Eye className="h-3 w-3" />
          ) : (
            <EyeOff className="h-3 w-3 text-muted-foreground/50" />
          )}
        </Button>
      </div>

      <CollapsibleContent>
        <div className="ml-4 space-y-0.5 border-l border-border pl-2">
          {/* Park sub-features (text labels, etc.) */}
          {parkSubFeatures.map((feature) => (
            <FeatureItem
              key={feature.id}
              feature={feature}
              isSelected={selectedFeatureIds.includes(feature.id)}
              onSelect={() => onSelectFeature([feature.id])}
              onFlyTo={onFlyToFeatures ? () => onFlyToFeatures([feature]) : undefined}
              draggable
            />
          ))}
          {/* Facilities */}
          {facilities.map((feature) => (
            <FeatureItem
              key={feature.id}
              feature={feature}
              isSelected={selectedFeatureIds.includes(feature.id)}
              onSelect={() => onSelectFeature([feature.id])}
              onFlyTo={onFlyToFeatures ? () => onFlyToFeatures([feature]) : undefined}
              draggable
            />
          ))}
          {childCount === 0 && (
            <p className="px-2 py-1 text-[10px] italic text-muted-foreground/50">
              施設なし
            </p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─── Droppable Unassigned Section ───────────────────────────
function DroppableUnassigned({
  isExpanded,
  onToggleExpand,
  unassignedFacilities,
  selectedFeatureIds,
  onSelectFeature,
  isDragging,
  onFlyToFeatures,
}: {
  isExpanded: boolean;
  onToggleExpand: () => void;
  unassignedFacilities: ParkFeature[];
  selectedFeatureIds: string[];
  onSelectFeature: (ids: string[]) => void;
  isDragging: boolean;
  onFlyToFeatures?: (features: ParkFeature[]) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: UNASSIGNED_DROP_ID,
  });

  // Always show the unassigned section when dragging (as a drop target)
  // or when there are unassigned facilities
  const shouldShow = unassignedFacilities.length > 0 || isDragging;
  if (!shouldShow) return null;

  return (
    <Collapsible
      open={isExpanded || isDragging}
      onOpenChange={onToggleExpand}
    >
      <div
        ref={setNodeRef}
        className={cn(
          "flex items-center gap-1 rounded-md px-1 py-0.5 transition-colors",
          isOver
            ? "bg-amber-100 ring-1 ring-amber-400"
            : isDragging
              ? "bg-muted/30 ring-1 ring-dashed ring-muted-foreground/20"
              : "hover:bg-muted/50"
        )}
      >
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 shrink-0"
          >
            {(isExpanded || isDragging) ? (
              <ChevronLeft className="h-3 w-3 -rotate-90" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </Button>
        </CollapsibleTrigger>

        <div
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: "#f59e0b" }}
        />

        <span className="flex-1 truncate text-xs font-medium">
          未割当
        </span>

        <Badge variant="outline" className="h-4 px-1 text-[9px]">
          {unassignedFacilities.length}
        </Badge>

        {onFlyToFeatures && (
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 shrink-0"
            disabled={unassignedFacilities.length === 0}
            title="未割当に移動"
            onClick={(e) => {
              e.stopPropagation();
              onFlyToFeatures(unassignedFacilities);
            }}
          >
            <LocateFixed className="h-3 w-3" />
          </Button>
        )}
      </div>

      <CollapsibleContent>
        <div className="ml-4 space-y-0.5 border-l border-border pl-2">
          {unassignedFacilities.map((feature) => (
            <FeatureItem
              key={feature.id}
              feature={feature}
              isSelected={selectedFeatureIds.includes(feature.id)}
              onSelect={() => onSelectFeature([feature.id])}
              onFlyTo={onFlyToFeatures ? () => onFlyToFeatures([feature]) : undefined}
              draggable
            />
          ))}
          {unassignedFacilities.length === 0 && isDragging && (
            <p className="px-2 py-1 text-[10px] italic text-muted-foreground/50">
              ここにドロップして公園から切り離す
            </p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─── Feature Item (shared) ──────────────────────────────────
function FeatureItem({
  feature,
  isSelected,
  onSelect,
  onFlyTo,
  draggable: isDraggable = false,
}: {
  feature: ParkFeature;
  isSelected: boolean;
  onSelect: () => void;
  onFlyTo?: () => void;
  draggable?: boolean;
}) {
  if (isDraggable) {
    return (
      <DraggableFeatureItem
        feature={feature}
        isSelected={isSelected}
        onSelect={onSelect}
        onFlyTo={onFlyTo}
      />
    );
  }

  return (
    <div
      className={cn(
        "group flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-xs transition-colors",
        isSelected
          ? "bg-park/10 text-park font-medium"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      )}
    >
      <button
        onClick={onSelect}
        className="flex flex-1 items-center gap-1.5 truncate"
      >
        {FEATURE_TYPE_ICONS[feature.properties.type]}
        <span className="flex-1 truncate">
          {feature.properties.label ||
            `${feature.properties.type} #${feature.id.slice(-4)}`}
        </span>
      </button>
      {onFlyTo && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onFlyTo();
          }}
          className={cn(
            "flex h-4 w-4 shrink-0 items-center justify-center rounded",
            "opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
          )}
          title="フィーチャーに移動"
        >
          <LocateFixed className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

// ─── Draggable Feature Item ─────────────────────────────────
function DraggableFeatureItem({
  feature,
  isSelected,
  onSelect,
  onFlyTo,
}: {
  feature: ParkFeature;
  isSelected: boolean;
  onSelect: () => void;
  onFlyTo?: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
  } = useDraggable({
    id: feature.id,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "group flex w-full items-center gap-0.5 rounded-md px-0.5 py-1 text-left text-xs transition-colors",
        isDragging
          ? "opacity-30"
          : isSelected
            ? "bg-park/10 text-park font-medium"
            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      )}
    >
      {/* Drag handle */}
      <span
        className={cn(
          "flex h-4 w-4 shrink-0 cursor-grab items-center justify-center rounded",
          "opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity",
          "active:cursor-grabbing"
        )}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3 w-3" />
      </span>

      <button
        onClick={onSelect}
        className="flex flex-1 items-center gap-1.5 truncate"
      >
        {FEATURE_TYPE_ICONS[feature.properties.type]}
        <span className="flex-1 truncate">
          {feature.properties.label ||
            `${feature.properties.type} #${feature.id.slice(-4)}`}
        </span>
      </button>

      {onFlyTo && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onFlyTo();
          }}
          className={cn(
            "flex h-4 w-4 shrink-0 items-center justify-center rounded",
            "opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
          )}
          title="フィーチャーに移動"
        >
          <LocateFixed className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
