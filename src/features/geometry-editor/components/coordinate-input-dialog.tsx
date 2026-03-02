"use client";

import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface CoordinateInputDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (
    lng: number,
    lat: number,
    type: "point" | "line" | "polygon"
  ) => void;
}

export function CoordinateInputDialog({
  open,
  onClose,
  onConfirm,
}: CoordinateInputDialogProps) {
  const [lng, setLng] = useState("");
  const [lat, setLat] = useState("");
  const [featureType, setFeatureType] = useState<"point" | "line" | "polygon">(
    "point"
  );

  const isValid =
    lng.trim() !== "" &&
    lat.trim() !== "" &&
    !isNaN(Number(lng)) &&
    !isNaN(Number(lat)) &&
    Number(lat) >= -90 &&
    Number(lat) <= 90 &&
    Number(lng) >= -180 &&
    Number(lng) <= 180;

  const handleConfirm = () => {
    if (isValid) {
      onConfirm(Number(lng), Number(lat), featureType);
      setLng("");
      setLat("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[360px]">
        <DialogHeader>
          <DialogTitle>座標入力</DialogTitle>
          <DialogDescription>
            座標を入力してフィーチャーを追加します (WGS84)
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label className="text-xs">タイプ</Label>
            <Select
              value={featureType}
              onValueChange={(v) =>
                setFeatureType(v as "point" | "line" | "polygon")
              }
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="point">ポイント</SelectItem>
                <SelectItem value="line" disabled>
                  ライン (TODO: 複数座標入力)
                </SelectItem>
                <SelectItem value="polygon" disabled>
                  ポリゴン (TODO: 複数座標入力)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">経度 (Lng)</Label>
              <Input
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                placeholder="136.9389"
                className="font-mono text-sm"
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">緯度 (Lat)</Label>
              <Input
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                placeholder="35.1644"
                className="font-mono text-sm"
                onKeyDown={(e) => e.key === "Enter" && handleConfirm()}
              />
            </div>
          </div>

          {lng && lat && !isValid && (
            <p className="text-xs text-destructive">
              有効な座標を入力してください (経度: -180〜180, 緯度: -90〜90)
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            キャンセル
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={!isValid}
            className="bg-park text-park-foreground hover:bg-park/90"
          >
            追加
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
