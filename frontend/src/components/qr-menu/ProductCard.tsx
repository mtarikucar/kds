import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import { Check, UtensilsCrossed, Plus, Box, X } from "lucide-react";
import { Product } from "../../types";
import { formatCurrency, cn } from "../../lib/utils";
import ProgressiveImage from "./ui/ProgressiveImage";
import ModelViewerAR from "./ModelViewerAR";

interface ProductCardProps {
  product: Product;
  onClick: () => void;
  onQuickAdd: (e: React.MouseEvent) => void;
  primaryColor: string;
  secondaryColor: string;
  currency: string;
  showImages: boolean;
  showDescription: boolean;
  showPrices: boolean;
  enableCustomerOrdering: boolean;
  layoutStyle: "GRID" | "LIST" | "COMPACT";
  isAdded?: boolean;
}

const ProductCard: React.FC<ProductCardProps> = ({
  product,
  onClick,
  onQuickAdd,
  primaryColor,
  secondaryColor,
  currency,
  showImages,
  showDescription,
  showPrices,
  enableCustomerOrdering,
  layoutStyle,
  isAdded = false,
}) => {
  const { t } = useTranslation("common");
  const [arOpen, setArOpen] = useState(false);
  const [playingVideo, setPlayingVideo] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hasVideo = !!product.videoUrl;

  // Show the photo first; play the ingredients video on hover / focus.
  const startVideo = () => {
    if (!hasVideo) return;
    setPlayingVideo(true);
    videoRef.current?.play().catch(() => {});
  };
  const stopVideo = () => {
    if (!hasVideo) return;
    setPlayingVideo(false);
    const v = videoRef.current;
    if (v) {
      v.pause();
      v.currentTime = 0;
    }
  };
  const has3d = !!product.model3dUrl;

  const normalizeImageUrl = (url: string | null | undefined): string | null => {
    if (!url) return null;
    const normalizedPath = url.replace(/\\/g, "/");
    if (
      normalizedPath.startsWith("http://") ||
      normalizedPath.startsWith("https://")
    ) {
      return normalizedPath;
    }
    const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000/api";
    const BASE_URL = API_URL.replace(/\/api$/, "");
    const path = normalizedPath.startsWith("/")
      ? normalizedPath.substring(1)
      : normalizedPath;
    return `${BASE_URL}/${path}`;
  };

  const imageUrl = normalizeImageUrl(product.image || product.images?.[0]?.url);
  const isUnavailable = product.isAvailable === false;

  const handleQuickAdd = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isUnavailable) {
      onQuickAdd(e);
    }
  };

  return (
    <>
      <motion.article
        onClick={onClick}
        onMouseEnter={startVideo}
        onMouseLeave={stopVideo}
        onFocus={startVideo}
        onBlur={stopVideo}
        tabIndex={hasVideo ? 0 : undefined}
        className={cn(
          "relative overflow-hidden rounded-2xl bg-white shadow-sm hover:shadow-lg transition-all duration-300 cursor-pointer group outline-none",
          layoutStyle === "LIST" ? "flex flex-row h-28" : "flex flex-col",
          isUnavailable && "opacity-75",
        )}
        whileTap={{ scale: 0.98 }}
      >
        {/* Product Image */}
        {showImages && (
          <div
            className={cn(
              "relative overflow-hidden bg-slate-100 flex-shrink-0",
              layoutStyle === "LIST" ? "w-28 h-28" : "w-full aspect-[4/3]",
            )}
          >
            {/* Photo first (shown by default) */}
            {imageUrl ? (
              <ProgressiveImage
                src={imageUrl}
                alt={product.name}
                className={cn(
                  "group-hover:scale-105 transition-transform duration-500",
                  isUnavailable && "grayscale",
                )}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200">
                <UtensilsCrossed className="h-10 w-10 text-slate-300" />
              </div>
            )}
            {/* Ingredients video — fades in + plays only on hover / focus */}
            {hasVideo && (
              <video
                ref={videoRef}
                src={product.videoUrl as string}
                muted
                loop
                playsInline
                preload="metadata"
                className={cn(
                  "absolute inset-0 h-full w-full object-cover transition-opacity duration-300",
                  playingVideo ? "opacity-100" : "opacity-0",
                  isUnavailable && "grayscale",
                )}
              />
            )}

            {/* AR badge — a dish with a READY 3D model can be viewed in AR */}
            {has3d && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setArOpen(true);
                }}
                className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded-full bg-black/70 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm"
                aria-label={t("ar.view", "3D / AR") as string}
              >
                <Box className="h-3.5 w-3.5" />
                3D
              </button>
            )}

            {/* Unavailable Overlay */}
            {isUnavailable && (
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                <span className="text-white font-semibold text-xs px-3 py-1.5 bg-black/50 rounded-full backdrop-blur-sm">
                  {t("qrMenu.unavailable", "Unavailable")}
                </span>
              </div>
            )}

            {/* Price Badge - Only for grid layout */}
            {showPrices && layoutStyle !== "LIST" && (
              <div
                className="absolute bottom-2 right-2 rtl:right-auto rtl:left-2 px-2.5 py-1 rounded-lg font-bold text-sm text-white shadow-lg"
                style={{
                  backgroundColor: primaryColor,
                  boxShadow: `0 2px 10px ${primaryColor}50`,
                }}
              >
                {formatCurrency(product.price, currency)}
              </div>
            )}
          </div>
        )}

        {/* Content */}
        <div
          className={cn(
            "p-3 flex-1 flex flex-col",
            layoutStyle === "LIST" ? "justify-between" : "min-h-0",
          )}
        >
          <div>
            <h3
              className="font-semibold text-sm mb-1 line-clamp-2 leading-tight"
              style={{ color: secondaryColor }}
            >
              {product.name}
            </h3>

            {showDescription && product.description && (
              <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
                {product.description}
              </p>
            )}
          </div>

          {/* Price and Add Button for LIST layout */}
          {layoutStyle === "LIST" && (
            <div className="flex items-center justify-between mt-auto pt-2">
              {showPrices && (
                <span
                  className="font-bold text-sm"
                  style={{ color: primaryColor }}
                >
                  {formatCurrency(product.price, currency)}
                </span>
              )}

              {enableCustomerOrdering && (
                <motion.button
                  onClick={handleQuickAdd}
                  disabled={isUnavailable}
                  className="p-2 rounded-xl transition-all duration-200"
                  style={{
                    backgroundColor: isAdded ? "#10b981" : primaryColor,
                    opacity: isUnavailable ? 0.5 : 1,
                  }}
                  whileTap={{ scale: 0.9 }}
                >
                  <AnimatePresence mode="wait">
                    {isAdded ? (
                      <motion.div
                        key="check"
                        initial={{ scale: 0, rotate: -180 }}
                        animate={{ scale: 1, rotate: 0 }}
                        exit={{ scale: 0 }}
                      >
                        <Check className="h-4 w-4 text-white" />
                      </motion.div>
                    ) : (
                      <motion.div
                        key="plus"
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        exit={{ scale: 0 }}
                      >
                        <Plus className="h-4 w-4 text-white" />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.button>
              )}
            </div>
          )}
        </div>

        {/* Floating Add Button - For GRID layout */}
        {enableCustomerOrdering && layoutStyle !== "LIST" && (
          <motion.button
            onClick={handleQuickAdd}
            disabled={isUnavailable}
            className="absolute bottom-3 right-3 rtl:right-auto rtl:left-3 p-2.5 rounded-xl shadow-lg transition-all duration-200"
            style={{
              backgroundColor: isAdded ? "#10b981" : primaryColor,
              opacity: isUnavailable ? 0.5 : 1,
              boxShadow: `0 4px 15px ${isAdded ? "#10b98150" : primaryColor + "50"}`,
            }}
            whileTap={{ scale: 0.9 }}
            whileHover={{ scale: 1.1 }}
          >
            <AnimatePresence mode="wait">
              {isAdded ? (
                <motion.div
                  key="check"
                  initial={{ scale: 0, rotate: -180 }}
                  animate={{ scale: 1, rotate: 0 }}
                  exit={{ scale: 0 }}
                >
                  <Check className="h-4 w-4 text-white" />
                </motion.div>
              ) : (
                <motion.div
                  key="plus"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0 }}
                >
                  <Plus className="h-4 w-4 text-white" />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.button>
        )}
      </motion.article>

      {/* Full-screen AR / 3D viewer */}
      {arOpen && has3d && (
        <div
          className="fixed inset-0 z-[100] flex flex-col bg-black/90"
          onClick={(e) => {
            e.stopPropagation();
            setArOpen(false);
          }}
        >
          <div
            className="flex items-center justify-between p-4 text-white"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="font-semibold">{product.name}</span>
            <button
              type="button"
              onClick={() => setArOpen(false)}
              aria-label={t("common.close", "Kapat") as string}
            >
              <X className="h-6 w-6" />
            </button>
          </div>
          <div className="flex-1" onClick={(e) => e.stopPropagation()}>
            <ModelViewerAR
              glbUrl={product.model3dUrl as string}
              usdzUrl={product.model3dUsdzUrl}
              poster={imageUrl}
              alt={product.name}
            />
          </div>
        </div>
      )}
    </>
  );
};

export default ProductCard;
