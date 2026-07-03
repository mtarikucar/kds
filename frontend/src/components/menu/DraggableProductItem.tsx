import React from "react";
import { Draggable } from "@hello-pangea/dnd";
import { GripVertical, Edit, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Product } from "../../types";
import { cn, formatCurrency } from "../../lib/utils";
import Button from "../ui/Button";
import Badge from "../ui/Badge";

interface DraggableProductItemProps {
  product: Product;
  index: number;
  onEdit: (product: Product) => void;
  onDelete: (product: Product) => void;
}

const DraggableProductItem: React.FC<DraggableProductItemProps> = ({
  product,
  index,
  onEdit,
  onDelete,
}) => {
  const { t } = useTranslation(["menu", "common"]);

  const primaryImage = product.images?.[0] || null;
  const imageUrl = primaryImage
    ? primaryImage.url.startsWith("http://") ||
      primaryImage.url.startsWith("https://")
      ? primaryImage.url
      : `${import.meta.env.VITE_API_BASE_URL || "http://localhost:3000"}${primaryImage.url}`
    : product.image || null;

  return (
    <Draggable draggableId={product.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          className={cn(
            "flex items-center gap-3 p-3 bg-white rounded-lg border transition-all",
            snapshot.isDragging
              ? "shadow-lg ring-2 ring-blue-500 border-blue-500"
              : "border-slate-200 hover:border-slate-300",
          )}
        >
          {/* Drag Handle */}
          <div
            {...provided.dragHandleProps}
            className="flex-shrink-0 p-1 cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600"
          >
            <GripVertical className="h-5 w-5" />
          </div>

          {/* Product Image */}
          <div className="flex-shrink-0 w-12 h-12 rounded-lg overflow-hidden bg-slate-100">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={product.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-slate-400">
                <span className="text-xs">No img</span>
              </div>
            )}
          </div>

          {/* Product Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="font-medium text-slate-900 truncate">
                {product.name}
              </h4>
              <Badge
                variant={product.isAvailable ? "success" : "danger"}
                className="flex-shrink-0 text-xs"
              >
                {product.isAvailable
                  ? t("menu.available")
                  : t("menu.unavailable")}
              </Badge>
            </div>
            {product.description && (
              <p className="text-sm text-slate-500 truncate mt-0.5">
                {product.description}
              </p>
            )}
            {/* AI-asset chips — which media this product has (green) vs is
                missing (dashed), so enrichment gaps are visible at a glance. */}
            <div className="mt-1 flex flex-wrap gap-1">
              {[
                {
                  on: !!(product.image || product.images?.length),
                  label: t("menu.assetPhoto", "Foto"),
                },
                { on: !!product.model3dUrl, label: t("menu.asset3d", "3D") },
                {
                  on: !!product.videoUrl,
                  label: t("menu.assetVideo", "Video"),
                },
              ].map((a) => (
                <span
                  key={a.label}
                  className={cn(
                    "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                    a.on
                      ? "bg-green-100 text-green-700"
                      : "border border-dashed border-slate-300 text-slate-400",
                  )}
                >
                  {a.label}
                </span>
              ))}
            </div>
          </div>

          {/* Price */}
          <div className="flex-shrink-0 text-right">
            <p className="font-semibold text-primary-600">
              {formatCurrency(product.price)}
            </p>
            <p className="text-xs text-slate-500">
              {t("menu.stock")}: {product.currentStock}
            </p>
          </div>

          {/* Actions */}
          <div className="flex-shrink-0 flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onEdit(product)}
              className="h-8 w-8 p-0"
            >
              <Edit className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDelete(product)}
              className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </Draggable>
  );
};

export default DraggableProductItem;
