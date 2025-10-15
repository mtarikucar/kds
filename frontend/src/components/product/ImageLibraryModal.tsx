import React, { useState, useEffect } from 'react';
import { Check, Trash2, Image as ImageIcon, Loader2, Search } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { ProductImage } from '../../types';
import { useProductImages, useDeleteProductImage } from '../../features/upload/uploadApi';
import { cn } from '../../lib/utils';

interface ImageLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectImages: (images: ProductImage[]) => void;
  selectedImageIds?: string[];
  maxSelection?: number;
}

const ImageLibraryModal: React.FC<ImageLibraryModalProps> = ({
  isOpen,
  onClose,
  onSelectImages,
  selectedImageIds = [],
  maxSelection,
}) => {
  const [localSelection, setLocalSelection] = useState<Set<string>>(
    new Set(selectedImageIds)
  );
  const [searchTerm, setSearchTerm] = useState('');

  // Update local selection when modal opens or selectedImageIds changes
  useEffect(() => {
    if (isOpen) {
      setLocalSelection(new Set(selectedImageIds));
      setSearchTerm('');
    }
  }, [isOpen, selectedImageIds]);

  const { data: images = [], isLoading } = useProductImages();
  const deleteMutation = useDeleteProductImage();

  const getImageUrl = (url: string) => {
    if (url.startsWith('http')) return url;
    return `${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'}${url}`;
  };

  const toggleSelection = (imageId: string) => {
    const newSelection = new Set(localSelection);
    if (newSelection.has(imageId)) {
      newSelection.delete(imageId);
    } else {
      if (maxSelection && newSelection.size >= maxSelection) {
        return; // Don't add if max reached
      }
      newSelection.add(imageId);
    }
    setLocalSelection(newSelection);
  };

  const handleConfirm = () => {
    const selectedImages = images.filter((img) => localSelection.has(img.id));
    onSelectImages(selectedImages);
    onClose();
  };

  const handleDelete = async (imageId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('Are you sure you want to delete this image permanently?')) {
      await deleteMutation.mutateAsync(imageId);
      // Remove from local selection if it was selected
      const newSelection = new Set(localSelection);
      newSelection.delete(imageId);
      setLocalSelection(newSelection);
    }
  };

  const handleReset = () => {
    setLocalSelection(new Set());
    setSearchTerm('');
  };

  const filteredImages = images.filter((img) =>
    img.filename.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Image Library" size="xl">
      <div className="space-y-4">
        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search images..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {/* Selection Counter */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">
            {localSelection.size} selected
            {maxSelection && ` (max ${maxSelection})`}
          </span>
          {localSelection.size > 0 && (
            <button
              onClick={handleReset}
              className="text-blue-600 hover:text-blue-700 font-medium"
            >
              Clear Selection
            </button>
          )}
        </div>

        {/* Images Grid */}
        <div className="max-h-[60vh] overflow-y-auto">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-12 w-12 text-gray-400 animate-spin" />
              <p className="mt-4 text-sm text-gray-500">Loading images...</p>
            </div>
          ) : filteredImages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <ImageIcon className="h-12 w-12 text-gray-400" />
              <p className="mt-4 text-sm font-medium text-gray-900">
                {searchTerm ? 'No images found' : 'No images in library'}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {searchTerm
                  ? 'Try a different search term'
                  : 'Upload some images to get started'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {filteredImages.map((image) => {
                const isSelected = localSelection.has(image.id);
                return (
                  <div
                    key={image.id}
                    onClick={() => toggleSelection(image.id)}
                    className={cn(
                      'relative group rounded-lg border-2 overflow-hidden cursor-pointer transition-all',
                      isSelected
                        ? 'border-blue-500 ring-2 ring-blue-500'
                        : 'border-gray-200 hover:border-gray-300'
                    )}
                  >
                    {/* Selection Checkbox */}
                    <div
                      className={cn(
                        'absolute top-2 left-2 z-10 w-6 h-6 rounded-full flex items-center justify-center transition-all',
                        isSelected
                          ? 'bg-blue-500 text-white'
                          : 'bg-white bg-opacity-80 border-2 border-gray-300 group-hover:bg-opacity-100'
                      )}
                    >
                      {isSelected && <Check className="h-4 w-4" />}
                    </div>

                    {/* Delete Button */}
                    <button
                      onClick={(e) => handleDelete(image.id, e)}
                      disabled={deleteMutation.isPending}
                      className="absolute top-2 right-2 z-10 bg-red-600 text-white p-1.5 rounded-full hover:bg-red-700 transition-all opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>

                    {/* Image */}
                    <div className="aspect-square flex items-center justify-center bg-gray-100">
                      <img
                        src={getImageUrl(image.url)}
                        alt={image.filename}
                        className="w-full h-full object-cover"
                      />
                    </div>

                    {/* Info */}
                    <div className="p-2 bg-white">
                      <p className="text-xs truncate font-medium text-gray-900">
                        {image.filename}
                      </p>
                      <p className="text-xs text-gray-500">
                        {(image.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={handleConfirm}
            disabled={localSelection.size === 0}
          >
            Add Selected ({localSelection.size})
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default ImageLibraryModal;
