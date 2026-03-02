"use client";

import React, { useState } from "react";
import {
  MapPin,
  Grid3X3,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Users,
  Building2,
  FileBarChart,
  Layers,
  PanelLeft,
  Clock,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface NavItem {
  icon: React.ReactNode;
  label: string;
  badge?: string;
  active?: boolean;
  children?: { label: string; active?: boolean }[];
}

const navItems: NavItem[] = [
  {
    icon: <MapPin className="h-4 w-4" />,
    label: "地図",
  },
  {
    icon: <Grid3X3 className="h-4 w-4" />,
    label: "資産台帳",
    children: [
      { label: "公園", active: true },
      { label: "施設" },
    ],
  },
  {
    icon: <Users className="h-4 w-4" />,
    label: "業者管理",
  },
  {
    icon: <Building2 className="h-4 w-4" />,
    label: "公園内建ぺい率一覧",
  },
  {
    icon: <FileBarChart className="h-4 w-4" />,
    label: "公園施設長寿命化計画",
  },
];

const recentItems = [
  "名城公園",
  "テーブル, 05-780",
  "志賀公園",
  "点検, 23563",
];

interface SideNavProps {
  collapsed?: boolean;
  onToggle?: () => void;
  layerPanelOpen?: boolean;
  onToggleLayerPanel?: () => void;
}

export function SideNav({
  collapsed = false,
  onToggle,
  layerPanelOpen = true,
  onToggleLayerPanel,
}: SideNavProps) {
  const [expandedItems, setExpandedItems] = useState<Set<string>>(
    new Set(["資産台帳"])
  );

  const toggleExpand = (label: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  };

  return (
    <div className="relative flex h-full flex-shrink-0">
      {/* Sidebar content */}
      <div
        className={cn(
          "flex h-full flex-col border-r border-sidebar-border bg-white text-sidebar-foreground transition-all duration-200 overflow-hidden",
          collapsed ? "w-[56px] min-w-[56px]" : "w-[208px] min-w-[208px]"
        )}
      >
        {/* Header area */}
        {collapsed ? (
          /* Collapsed header: show active page name + chevron */
          <div className="flex flex-col items-center border-b border-sidebar-border px-2 py-3">
            <span className="text-xs font-semibold text-sidebar-foreground whitespace-nowrap">
              公園
            </span>
            <ChevronDown className="mt-0.5 h-3 w-3 text-sidebar-foreground/50" />
          </div>
        ) : (
          /* Expanded header: logo + name + selector + collapse button */
          <div className="flex items-center gap-2 border-b border-sidebar-border px-4 py-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-park/10">
              <Layers className="h-4 w-4 text-park" />
            </div>
            <span className="text-sm font-semibold text-sidebar-foreground whitespace-nowrap">
              公園管理
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/50" />
            <button
              onClick={onToggle}
              className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded border border-sidebar-border text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
              aria-label="サイドバーを閉じる"
            >
              <PanelLeft className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <ScrollArea className="flex-1">
          {collapsed ? (
            /* Collapsed: icon-only navigation */
            <nav className="flex flex-col items-center gap-1 px-2 py-2">
              {/* Collapse toggle (PanelLeft) at top of icon list */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onToggle}
                    className="flex h-9 w-9 items-center justify-center rounded-md text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
                    aria-label="サイドバーを開く"
                  >
                    <PanelLeft className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  サイドバーを開く
                </TooltipContent>
              </Tooltip>

              {navItems.map((item) => (
                <Tooltip key={item.label}>
                  <TooltipTrigger asChild>
                    <button
                      className="flex h-9 w-9 items-center justify-center rounded-md text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors"
                    >
                      {item.icon}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="right"
                    sideOffset={8}
                    className={cn(
                      item.children && "p-0"
                    )}
                  >
                    {item.children ? (
                      <div className="py-1.5">
                        {item.children.map((child) => (
                          <button
                            key={child.label}
                            className={cn(
                              "flex w-full items-center px-3 py-1 text-xs transition-colors",
                              child.active
                                ? "text-background font-medium"
                                : "text-background/70 hover:text-background"
                            )}
                          >
                            {child.label}
                          </button>
                        ))}
                      </div>
                    ) : (
                      item.label
                    )}
                  </TooltipContent>
                </Tooltip>
              ))}

              {/* Recent items icon */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button className="mt-2 flex h-9 w-9 items-center justify-center rounded-md text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors">
                    <Clock className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  最近
                </TooltipContent>
              </Tooltip>
            </nav>
          ) : (
            /* Expanded: full navigation */
            <>
              <nav className="space-y-0.5 px-2 py-2">
                {navItems.map((item) => (
                  <div key={item.label}>
                    <button
                      onClick={() =>
                        item.children ? toggleExpand(item.label) : undefined
                      }
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors whitespace-nowrap",
                        "hover:bg-sidebar-accent/50 text-sidebar-foreground/80 hover:text-sidebar-foreground"
                      )}
                    >
                      {item.icon}
                      <span className="flex-1 text-left">{item.label}</span>
                      {item.badge && (
                        <Badge
                          variant="secondary"
                          className="h-5 bg-sidebar-accent text-[10px] text-sidebar-foreground/70"
                        >
                          {item.badge}
                        </Badge>
                      )}
                      {item.children &&
                        (expandedItems.has(item.label) ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        ))}
                    </button>
                    {item.children && expandedItems.has(item.label) && (
                      <div className="ml-4 mt-0.5 space-y-0.5 border-l border-sidebar-border pl-3">
                        {item.children.map((child) => (
                          <button
                            key={child.label}
                            className={cn(
                              "flex w-full items-center rounded-md px-2 py-1 text-sm transition-colors whitespace-nowrap",
                              child.active
                                ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium"
                                : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                            )}
                          >
                            {child.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </nav>

              {/* Recent section */}
              <div className="px-4 pb-4 pt-2">
                <p className="mb-2 text-xs font-medium text-sidebar-foreground/50 whitespace-nowrap">
                  最近
                </p>
                <div className="space-y-1">
                  {recentItems.map((item) => (
                    <button
                      key={item}
                      className="flex w-full items-center rounded-md px-2 py-1 text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-foreground whitespace-nowrap"
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </ScrollArea>
      </div>

      {/* Layer panel toggle button - pill on sidebar edge */}
      {onToggleLayerPanel && !layerPanelOpen && (
        <button
          onClick={onToggleLayerPanel}
          className={cn(
            "absolute top-1/2 -translate-y-1/2 z-30 flex h-12 w-6 items-center justify-center",
            "rounded-r-lg bg-white border border-l-0 border-border/60 shadow-md",
            "text-muted-foreground hover:text-foreground hover:bg-gray-50 transition-colors",
            collapsed ? "left-[56px]" : "left-[208px]"
          )}
          aria-label={
            layerPanelOpen
              ? "レイヤーパネルを閉じる"
              : "レイヤーパネルを開く"
          }
        >
          {layerPanelOpen ? (
            <ChevronLeft className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>
      )}
    </div>
  );
}
