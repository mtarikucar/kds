import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Trash2,
  Image as ImageIcon,
  Upload,
  Search,
  Sparkles,
  Loader2,
  X,
  Check,
  Grid3X3,
  LayoutList,
} from 'lucide-react';
import {
  initializeModel,
  removeBackground,
  isBackgroundRemovalSupported,
} from '../../../lib/backgroundRemoval';
import { cn } from '../../../lib/utils';
import {
  useProductImages,
  useDeleteProductImage,
  useUploadProductImages,
} from '../../../features/upload/uploadApi';
import { getImageUrl } from './imageUrl';

// Self-contained extraction of the "images" activeTab branch from
// MenuManagementPage. The image-library + background-removal state, the
// upload/delete query hooks, and the drag/drop + bg-removal helpers all move
// here (the parent rendered this branch independently of the rest of its
// state). The component is mounted only when the images tab is active, so the
// hooks run exactly when they did inline. Rendered markup is identical.
const ImagesTab = () => {
  const { t } = useTranslation(['menu', 'common']);

  // Image library state
  const [imageSearchTerm, setImageSearchTerm] = useState('');
  const [imageViewMode, setImageViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const [bgRemovalEnabled, setBgRemovalEnabled] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingFile, setProcessingFile] = useState<string | null>(null);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const bgRemovalSupported = isBackgroundRemovalSupported();

  const { data: allImages, isLoading: imagesLoading } = useProductImages();
  const { mutate: deleteImage } = useDeleteProductImage();
  const uploadImagesMutation = useUploadProductImages();

  const filteredImages = allImages?.filter((img) =>
    img.filename.toLowerCase().includes(imageSearchTerm.toLowerCase())
  ) || [];

  const toggleImageSelection = (id: string) => {
    const newSelection = new Set(selectedImages);
    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else {
      newSelection.add(id);
    }
    setSelectedImages(newSelection);
  };

  const handleDeleteImage = (imageId: string) => {
    if (confirm(t('menu.confirmDeleteImage'))) {
      deleteImage(imageId);
    }
  };

  const handleDeleteSelectedImages = async () => {
    if (selectedImages.size === 0) return;
    if (!window.confirm(t('menu.imageLibraryUI.deleteConfirm', { count: selectedImages.size }))) return;
    for (const id of selectedImages) {
      await deleteImage(id);
    }
    setSelectedImages(new Set());
  };

  const processWithBgRemoval = async (files: File[]): Promise<File[]> => {
    if (!bgRemovalEnabled || !bgRemovalSupported) return files;
    setIsProcessing(true);
    const processed: File[] = [];
    try {
      setIsModelLoading(true);
      await initializeModel();
      setIsModelLoading(false);
      for (const file of files) {
        setProcessingFile(file.name);
        try {
          const result = await removeBackground(file);
          processed.push(result);
        } catch {
          processed.push(file);
        }
      }
    } catch {
      return files;
    } finally {
      setIsProcessing(false);
      setProcessingFile(null);
    }
    return processed;
  };

  const handleImageFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files).filter(
      (f) => f.type.startsWith('image/') && f.size <= 5 * 1024 * 1024
    );
    if (fileArray.length === 0) return;
    const filesToUpload = await processWithBgRemoval(fileArray);
    uploadImagesMutation.mutate(filesToUpload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgRemovalEnabled, bgRemovalSupported, uploadImagesMutation]);

  const handleImageDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleImageFiles(e.dataTransfer.files);
  }, [handleImageFiles]);

  const handleImageFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleImageFiles(e.target.files);
      e.target.value = '';
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
      {/* Sidebar */}
      <div className="lg:col-span-1 space-y-4">
        {/* Upload Zone */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-medium text-slate-900 mb-3">Upload</h3>
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleImageDrop}
            className={cn(
              'border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer',
              isDragging ? 'border-blue-500 bg-blue-50' : 'border-slate-300 hover:border-slate-400',
              (isProcessing || uploadImagesMutation.isPending) && 'opacity-50 pointer-events-none'
            )}
          >
            <input
              type="file"
              id="image-upload"
              multiple
              accept="image/*"
              onChange={handleImageFileInput}
              className="hidden"
              disabled={isProcessing || uploadImagesMutation.isPending}
            />
            <label htmlFor="image-upload" className="cursor-pointer">
              {uploadImagesMutation.isPending ? (
                <Loader2 className="w-8 h-8 mx-auto text-slate-400 animate-spin" />
              ) : (
                <Upload className="w-8 h-8 mx-auto text-slate-400" />
              )}
              <p className="mt-2 text-sm text-slate-600">
                {uploadImagesMutation.isPending ? t('menu.imageLibraryUI.uploading') : t('menu.imageLibraryUI.dropOrClick')}
              </p>
              <p className="mt-1 text-xs text-slate-400">{t('menu.imageLibraryUI.uploadHint')}</p>
            </label>
          </div>
        </div>

        {/* Background Removal */}
        {bgRemovalSupported && (
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={cn(
                  'w-8 h-8 rounded-lg flex items-center justify-center',
                  bgRemovalEnabled ? 'bg-violet-100' : 'bg-slate-100'
                )}>
                  <Sparkles className={cn(
                    'w-4 h-4',
                    bgRemovalEnabled ? 'text-violet-600' : 'text-slate-400'
                  )} />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-900">{t('menu.imageLibraryUI.removeBg')}</p>
                  <p className="text-xs text-slate-500">{t('menu.imageLibraryUI.aiPowered')}</p>
                </div>
              </div>
              <button
                onClick={() => setBgRemovalEnabled(!bgRemovalEnabled)}
                disabled={isProcessing}
                className={cn(
                  'relative w-10 h-5 rounded-full transition-colors',
                  bgRemovalEnabled ? 'bg-violet-600' : 'bg-slate-200'
                )}
              >
                <span className={cn(
                  'absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform',
                  bgRemovalEnabled && 'translate-x-5'
                )} />
              </button>
            </div>
            {(isModelLoading || isProcessing) && (
              <div className="mt-3 p-2 bg-violet-50 rounded-lg">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-3 h-3 text-violet-600 animate-spin" />
                  <span className="text-xs text-violet-700">
                    {isModelLoading ? t('menu.imageLibraryUI.loadingModel') : processingFile}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Search */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search..."
              value={imageSearchTerm}
              onChange={(e) => setImageSearchTerm(e.target.value)}
              className="w-full pl-9 pr-8 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {imageSearchTerm && (
              <button onClick={() => setImageSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2">
                <X className="w-4 h-4 text-slate-400 hover:text-slate-600" />
              </button>
            )}
          </div>
        </div>

        {/* View Toggle */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex gap-2">
            <button
              onClick={() => setImageViewMode('grid')}
              className={cn(
                'flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-sm font-medium transition-colors',
                imageViewMode === 'grid' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
              )}
            >
              <Grid3X3 className="w-4 h-4" />
            </button>
            <button
              onClick={() => setImageViewMode('list')}
              className={cn(
                'flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-sm font-medium transition-colors',
                imageViewMode === 'list' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
              )}
            >
              <LayoutList className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Delete Selected */}
        {selectedImages.size > 0 && (
          <button
            onClick={handleDeleteSelectedImages}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100"
          >
            <Trash2 className="w-4 h-4" />
            Delete ({selectedImages.size})
          </button>
        )}
      </div>

      {/* Main Content */}
      <div className="lg:col-span-3">
        <div className="bg-white rounded-xl border border-slate-200 min-h-[500px]">
          {imagesLoading ? (
            <div className="flex items-center justify-center h-96">
              <Loader2 className="w-8 h-8 text-slate-400 animate-spin" />
            </div>
          ) : filteredImages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-96 text-center px-4">
              <div className="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                <ImageIcon className="w-7 h-7 text-slate-400" />
              </div>
              <h3 className="text-base font-medium text-slate-900">
                {imageSearchTerm ? t('menu.imageLibraryUI.noImagesFound') : t('menu.imageLibraryUI.noImagesYet')}
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                {imageSearchTerm ? t('menu.imageLibraryUI.tryDifferentSearch') : t('menu.imageLibraryUI.uploadToStart')}
              </p>
            </div>
          ) : imageViewMode === 'grid' ? (
            <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {filteredImages.map((image) => (
                <div
                  key={image.id}
                  onClick={() => toggleImageSelection(image.id)}
                  className={cn(
                    'group relative aspect-square rounded-xl overflow-hidden cursor-pointer border-2 transition-all',
                    selectedImages.has(image.id)
                      ? 'border-blue-500 ring-2 ring-blue-500/20'
                      : 'border-transparent hover:border-slate-300'
                  )}
                >
                  <div
                    className="absolute inset-0"
                    style={{ background: 'repeating-conic-gradient(#f3f4f6 0% 25%, #fff 0% 50%) 50% / 12px 12px' }}
                  />
                  <img src={getImageUrl(image.url)} alt={image.filename} className="relative w-full h-full object-cover" />

                  <div className={cn(
                    'absolute top-2 left-2 w-5 h-5 rounded-full flex items-center justify-center transition-all',
                    selectedImages.has(image.id)
                      ? 'bg-blue-500 text-white'
                      : 'bg-white/80 border border-slate-300 opacity-0 group-hover:opacity-100'
                  )}>
                    {selectedImages.has(image.id) && <Check className="w-3 h-3" />}
                  </div>

                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteImage(image.id); }}
                    className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded opacity-0 group-hover:opacity-100 hover:bg-red-600"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>

                  {image.filename.includes('_nobg') && (
                    <div className="absolute bottom-2 left-2 px-1.5 py-0.5 bg-violet-500 text-white text-[10px] font-medium rounded flex items-center gap-0.5">
                      <Sparkles className="w-2.5 h-2.5" /> AI
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filteredImages.map((image) => (
                <div
                  key={image.id}
                  onClick={() => toggleImageSelection(image.id)}
                  className={cn(
                    'flex items-center gap-4 p-3 cursor-pointer transition-colors',
                    selectedImages.has(image.id) ? 'bg-blue-50' : 'hover:bg-slate-50'
                  )}
                >
                  <div className={cn(
                    'w-5 h-5 rounded border flex items-center justify-center flex-shrink-0',
                    selectedImages.has(image.id) ? 'bg-blue-500 border-blue-500' : 'border-slate-300'
                  )}>
                    {selectedImages.has(image.id) && <Check className="w-3 h-3 text-white" />}
                  </div>
                  <div
                    className="w-10 h-10 rounded overflow-hidden flex-shrink-0"
                    style={{ background: 'repeating-conic-gradient(#f3f4f6 0% 25%, #fff 0% 50%) 50% / 6px 6px' }}
                  >
                    <img src={getImageUrl(image.url)} alt={image.filename} className="w-full h-full object-cover" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-slate-900 truncate">{image.filename}</p>
                      {image.filename.includes('_nobg') && (
                        <span className="px-1.5 py-0.5 bg-violet-100 text-violet-700 text-xs font-medium rounded">AI</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">{(image.size / 1024).toFixed(1)} KB</p>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteImage(image.id); }}
                    className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ImagesTab;
