"use client";

import React from "react";
import { ChevronDown, User } from "lucide-react";
import { Button } from "@/components/ui/button";

interface HeaderProps {
  breadcrumbs?: string[];
  onSave: () => void;
  onCancel: () => void;
}

export function Header({ breadcrumbs = ["公園", "名城公園", "ジオメトリエディター"], onSave, onCancel }: HeaderProps) {
  return (
    <header className="flex h-14 min-h-14 items-center justify-between border-b border-border bg-background px-4">
      {/* Breadcrumb */}
      <nav className="flex items-center text-sm text-muted-foreground">
        {breadcrumbs.map((crumb, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="mx-1.5">/</span>}
            <span
              className={
                i === breadcrumbs.length - 1
                  ? "font-medium text-foreground"
                  : "hover:text-foreground cursor-pointer"
              }
            >
              {crumb}
            </span>
          </React.Fragment>
        ))}
      </nav>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={onCancel}>
          キャンセル
        </Button>
        <Button
          size="sm"
          onClick={onSave}
          className="bg-park text-park-foreground hover:bg-park/90"
        >
          保存
        </Button>

        {/* User */}
        <div className="ml-2 flex items-center gap-2 border-l border-border pl-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
            <User className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="hidden text-right sm:block">
            <p className="text-xs font-medium leading-tight">山田 太郎</p>
            <p className="text-[10px] text-muted-foreground">公園管理者</p>
          </div>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </div>
      </div>
    </header>
  );
}
