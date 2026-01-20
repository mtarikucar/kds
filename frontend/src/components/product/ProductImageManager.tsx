import React, { useState, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { X, GripVertical, Star, Image as ImageIcon, FolderOpen } from 'lucide-react';
import { ProductImage } from '../../types';
import { cn } from '../../lib/utils';
import Button from '../ui/Button';
import ImageUploadZone from '../ui/ImageUploadZone';
import { useUploadProductImages } from '../../features/upload/uploadApi';

interface ProductImageManagerProps {
  images: ProductImage[];
  onImagesChange: (images: ProductImage[]) => void;
  onOpenLibrary?: () => void;
  disabled?: boolean;
  className?: string;
}

const ProductImageManager: React.FC<ProductImageManagerProps> = ({
  images: initialImages,
  onImagesChange,
  onOpenLibrary,
  disabled = false,
  className,
}) => {
  const [images, setImages] = useState<ProductImage[]>(initialImages);
  const uploadMutation = useUploadProductImages();

  useEffect(() => {
    setImages(initialImages);
  }, [initialImages]);

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination || disabled) return;

    const items = Array.from(images);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);

    // Update order property
    const reordered = items.map((item, index) => ({
      ...item,
      order: index,
    }));

    setImages(reordered);
    onImagesChange(reordered);
  };

  const handleRemoveImage = (imageId: string) => {
    if (disabled) return;
    const filtered = images.filter((img) => img.id !== imageId);
    setImages(filtered);
    onImagesChange(filtered);
  };

  const handleFilesSelected = async (files: File[]) => {
    if (disabled || files.length === 0) return;

    try {
      const result = await uploadMutation.mutateAsync(files);
      const newImages = result.images.map((img, index) => ({
        ...img,
        order: images.length + index,
        productId: null,
        createdAt: new Date().toISOString(),
      })) as ProductImage[];

      const updated = [...images, ...newImages];
      setImages(updated);
      onImagesChange(updated);
    } catch (error) {
      console.error('Failed to upload images:', error);
    }
  };

  const getPrimaryImage = () => {
    return images.length > 0 ? images[0] : null;
  };

  const getImageUrl = (url: string) => {
    // If URL is already absolute, use it
    if (url.startsWith('http')) return url;
    // Otherwise, prepend API base URL
    return `${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'}${url}`;
  };

  return (
    <div className={cn('space-y-4', className)}>
      {/* Upload Zone */}
      <ImageUploadZone
        onFilesSelected={handleFilesSelected}
        disabled={disabled || uploadMutation.isPending}
        maxFiles={10}
      />

      {/* Library Button */}
      {onOpenLibrary && (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            onClick={onOpenLibrary}
            disabled={disabled}
            className="inline-flex items-center gap-2"
          >
            <FolderOpen className="h-4 w-4" />
            Choose from Library
          </Button>
        </div>
      )}

      {/* Images Grid with Drag & Drop */}
      {images.length > 0 && (
        <div>
          <div className="mb-3">
            <p className="text-sm font-medium text-gray-700 flex items-center gap-2">
              <Star className="h-4 w-4 text-yellow-500" />
              First image is the primary image
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Drag and drop to reorder images
            </p>
          </div>

          <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId="product-images" direction="horizontal">
              {(provided, snapshot) => (
                <div
                  {...provided.droppableProps}
                  ref={provided.innerRef}
                  className={cn(
                    'grid grid-cols-2 md:grid-cols-4 gap-4 p-4 rounded-lg border-2 border-dashed transition-colors',
                    snapshot.isDraggingOver
                      ? 'border-primary-500 bg-primary-50'
                      : 'border-gray-300'
                  )}
                >
                  {images.map((image, index) => (
                    <Draggable
                      key={image.id}
                      draggableId={image.id}
                      index={index}
                      isDragDisabled={disabled}
                    >
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          className={cn(
                            'relative group rounded-lg border overflow-hidden bg-white transition-all',
                            snapshot.isDragging
                              ? 'shadow-2xl ring-2 ring-blue-500 scale-105'
                              : 'shadow-sm hover:shadow-md border-gray-200'
                          )}
                        >
                          {/* Drag Handle */}
                          <div
                            {...provided.dragHandleProps}
                            className="absolute top-2 left-2 z-10 bg-white bg-opacity-90 rounded p-1.5 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing"
                          >
                            <GripVertical className="h-4 w-4 text-gray-600" />
                          </div>

                          {/* Primary Badge */}
                          {index === 0 && (
                            <div className="absolute top-2 right-2 z-10 bg-yellow-500 text-white text-xs font-bold px-2 py-1 rounded flex items-center gap-1">
                              <Star className="h-3 w-3 fill-current" />
                              PRIMARY
                            </div>
                          )}

                          {/* Remove Button */}
                          {!disabled && (
                            <button
                              onClick={() => handleRemoveImage(image.id)}
                              className="absolute top-2 right-2 z-10 bg-red-600 text-white p-1.5 rounded-full hover:bg-red-700 transition-all opacity-0 group-hover:opacity-100"
                              style={{ display: index === 0 ? 'none' : undefined }}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}

                          {/* Image */}
                          <div className="aspect-square flex items-center justify-center bg-gray-100">
                            {image.url ? (
                              <img
                                src={getImageUrl(image.url)}
                                alt={image.filename}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <ImageIcon className="h-12 w-12 text-gray-400" />
                            )}
                          </div>

                          {/* Info */}
                          <div className="p-2 bg-neutral-50">
                            <p className="text-xs truncate font-medium text-foreground">
                              {image.filename}
                            </p>
                            <p className="text-xs text-gray-500">
                              {(image.size / 1024).toFixed(1)} KB
                            </p>
                          </div>

                          {/* Order Badge */}
                          <div className="absolute bottom-14 left-2 bg-neutral-900 bg-opacity-75 text-white text-xs font-bold px-2 py-1 rounded">
                            #{index + 1}
                          </div>
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        </div>
      )}

      {/* Empty State */}
      {images.length === 0 && (
        <div className="text-center py-8 px-4 border-2 border-dashed border-gray-300 rounded-lg">
          <ImageIcon className="mx-auto h-12 w-12 text-gray-400" />
          <p className="mt-2 text-sm font-medium text-foreground">No images added</p>
          <p className="mt-1 text-xs text-gray-500">
            Upload images or choose from library to get started
          </p>
        </div>
      )}
    </div>
  );
};

export default ProductImageManager;
