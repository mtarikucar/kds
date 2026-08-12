import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  ImageIcon,
  Loader2,
  Star,
  Trash2,
  Upload,
  FolderOpen,
} from 'lucide-react';
import { useUploadProductImages } from '../../features/upload/uploadApi';
import { getImageUrl } from '../../pages/admin/menuManagement/imageUrl';
import ImageLibraryModal from './ImageLibraryModal';
import type { ProductImage } from '../../types';
import { cn } from '../../lib/utils';

const ACCEPTED = 'image/jpeg,image/png,image/webp,image/avif';
const MAX_MB = 8;

interface Props {
  images: ProductImage[];
  onChange: (next: ProductImage[]) => void;
  /** Legacy single-URL image, shown when the product has no gallery rows yet. */
  legacyImageUrl?: string | null;
}

/**
 * A product's photos, edited where the product is.
 *
 * Before this, uploading meant leaving the product: go to a global "Görseller"
 * tab, upload there, come back to the product, open a library modal, find the
 * file, tick it. The library modal had no upload button of its own, so the
 * only path to a photo ran through a screen that has nothing to do with the
 * product you are editing — which is why it felt inside-out.
 *
 * Now the field IS the upload: drop a file on it, or click it. The library
 * stays as a second source for a photo you already uploaded (and for reusing
 * one across products), not as the only door.
 */
export default function ProductImageField({
  images,
  onChange,
  legacyImageUrl,
}: Props) {
  const { t } = useTranslation(['menu', 'common']);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const { mutateAsync: upload, isPending: uploading } = useUploadProductImages();

  const accept = useCallback(
    async (files: FileList | File[]) => {
      const picked = Array.from(files);
      if (picked.length === 0) return;

      // Reject before the round trip: the API answers with a 413 whose body
      // says nothing a restaurant owner can act on.
      const tooBig = picked.filter((f) => f.size > MAX_MB * 1024 * 1024);
      if (tooBig.length > 0) {
        toast.error(
          t('menu.imageTooLarge', {
            defaultValue: '{{name}} çok büyük — en fazla {{mb}} MB.',
            name: tooBig[0].name,
            mb: MAX_MB,
          }),
        );
        return;
      }
      const wrongType = picked.filter((f) => !f.type.startsWith('image/'));
      if (wrongType.length > 0) {
        toast.error(
          t('menu.imageWrongType', {
            defaultValue: '{{name}} bir görsel değil.',
            name: wrongType[0].name,
          }),
        );
        return;
      }

      const res = await upload(picked);
      // The upload endpoint returns rows in the gallery's own shape minus
      // createdAt; the field only needs id/url/filename to render and to send
      // imageIds on save.
      const uploaded = (res.images ?? []).map((img) => ({
        ...img,
        createdAt: new Date().toISOString(),
      })) as ProductImage[];
      onChange([...images, ...uploaded]);
    },
    [images, onChange, t, upload],
  );

  const remove = (id: string) => onChange(images.filter((i) => i.id !== id));

  /** First image is the primary one everywhere else in the product. */
  const makePrimary = (id: string) => {
    const picked = images.find((i) => i.id === id);
    if (!picked) return;
    onChange([picked, ...images.filter((i) => i.id !== id)]);
  };

  const hasGallery = images.length > 0;

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void accept(e.dataTransfer.files);
        }}
        className={cn(
          'rounded-xl border-2 border-dashed p-3 transition-colors',
          dragging
            ? 'border-primary-500 bg-primary-50'
            : 'border-slate-300 bg-slate-50/50',
        )}
      >
        {hasGallery ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {images.map((image, index) => (
              <div key={image.id} className="group relative">
                <div className="aspect-square overflow-hidden rounded-lg border border-slate-200 bg-white">
                  <img
                    src={getImageUrl(image.url)}
                    alt={image.filename}
                    className="h-full w-full object-cover"
                  />
                </div>
                {index === 0 ? (
                  <span className="absolute left-1 top-1 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    {t('menu.primary')}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => makePrimary(image.id)}
                    title={t('menu.makePrimary', { defaultValue: 'Kapak yap' })}
                    className="absolute left-1 top-1 rounded bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <Star className="h-3 w-3" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => remove(image.id)}
                  title={t('common:delete', { defaultValue: 'Kaldır' })}
                  className="absolute right-1 top-1 rounded bg-red-600 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}

            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 bg-white text-slate-500 hover:border-primary-400 hover:text-primary-600 disabled:opacity-60"
            >
              {uploading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Upload className="h-5 w-5" />
              )}
              <span className="text-[11px]">{t('menu.addPhoto', { defaultValue: 'Ekle' })}</span>
            </button>
          </div>
        ) : legacyImageUrl ? (
          // A product saved before the gallery existed carries a single URL.
          // Showing it as an ordinary tile (rather than hiding it behind an
          // empty state) keeps "what the customer sees" honest.
          <div className="flex items-center gap-3">
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-slate-200">
              <img
                src={getImageUrl(legacyImageUrl)}
                alt=""
                className="h-full w-full object-cover"
              />
            </div>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="text-sm font-medium text-primary-600 hover:underline disabled:opacity-60"
            >
              {t('menu.replacePhoto', { defaultValue: 'Yeni fotoğraf yükle' })}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="flex w-full flex-col items-center justify-center gap-2 py-6 text-center disabled:opacity-60"
          >
            {uploading ? (
              <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
            ) : (
              <ImageIcon className="h-8 w-8 text-slate-400" />
            )}
            <span className="text-sm font-medium text-slate-700">
              {t('menu.dropPhotoHere', {
                defaultValue: 'Fotoğrafı buraya sürükleyin veya seçin',
              })}
            </span>
            <span className="text-xs text-slate-500">
              {t('menu.photoHint', {
                defaultValue: 'JPG, PNG veya WEBP · en fazla {{mb}} MB',
                mb: MAX_MB,
              })}
            </span>
          </button>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          <Upload className="h-3.5 w-3.5" />
          {t('menu.uploadPhoto', { defaultValue: 'Yükle' })}
        </button>
        <button
          type="button"
          onClick={() => setLibraryOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          {t('menu.fromLibrary', { defaultValue: 'Kitaplıktan seç' })}
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void accept(e.target.files);
          // Reset so picking the SAME file twice still fires a change event.
          e.target.value = '';
        }}
      />

      <ImageLibraryModal
        isOpen={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        selectedImageIds={images.map((i) => i.id)}
        onSelectImages={(picked) => {
          // Union, keeping order: re-picking an attached image must not
          // duplicate it or move it out of the primary slot.
          const known = new Set(images.map((i) => i.id));
          onChange([...images, ...picked.filter((p) => !known.has(p.id))]);
          setLibraryOpen(false);
        }}
      />
    </div>
  );
}
