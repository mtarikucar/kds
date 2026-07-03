import { useTranslation } from "react-i18next";
import { Lock, Sparkles } from "lucide-react";

interface Props {
  /** Short labels of the tools that unlock once the product is saved. */
  tools: string[];
}

/**
 * Shown in the product editor's AI section when the feature IS configured but
 * we're adding a NEW product (no saved id yet). The AI generators key on a
 * saved productId, so instead of rendering nothing (the old behaviour — the
 * reason operators said "I can't see anything in add-item") we show a locked
 * teaser that advertises the tools and points at the save-then-enhance flow.
 */
export default function AiLockedTeaser({ tools }: Props) {
  const { t } = useTranslation(["menu", "common"]);
  return (
    <div className="mt-4 rounded-lg border border-dashed border-gray-300 bg-gray-50/60 p-4">
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-gray-700">
        <Sparkles className="h-4 w-4 text-primary-500" />
        {t("menu:ai.lockedTitle", "Yapay zeka araçları")}
        <Lock className="ml-auto h-4 w-4 text-gray-400" />
      </div>
      <p className="text-xs text-gray-500">
        {t(
          "menu:ai.lockedNew",
          "Ürünü kaydedince otomatik fotoğraf, içindekiler videosu ve 3D/AR modeli burada açılır.",
        )}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {tools.map((tool) => (
          <span
            key={tool}
            className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-400"
          >
            <Sparkles className="h-3 w-3" />
            {tool}
          </span>
        ))}
      </div>
    </div>
  );
}
