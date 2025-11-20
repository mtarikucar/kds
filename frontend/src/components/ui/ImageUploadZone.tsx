import React, { useCallback, useState, useEffect } from 'react';
import { Upload, X, Image as ImageIcon, Sparkles, Loader2, Info } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  initializeModel,
  removeBackground,
  isBackgroundRemovalSupported,
  disposeModel,
  type BackgroundRemovalProgress,
} from '../../lib/backgroundRemoval';

interface ImageUploadZoneProps {
  onFilesSelected: (files: File[]) => void;
  maxFiles?: number;
  maxSizeMB?: number;
  acceptedTypes?: string[];
  disabled?: boolean;
  className?: string;
  showBackgroundRemovalToggle?: boolean;
  requireConfirmation?: boolean;
  onUploadConfirm?: (files: File[]) => void;
}

interface ProcessingState {
  fileName: string;
  progress: BackgroundRemovalProgress;
}

const ImageUploadZone: React.FC<ImageUploadZoneProps> = ({
  onFilesSelected,
  maxFiles = 10,
  maxSizeMB = 5,
  acceptedTypes = ['image/jpeg', 'image/png', 'image/webp'],
  disabled = false,
  className,
  showBackgroundRemovalToggle = true,
  requireConfirmation = false,
  onUploadConfirm,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [removeBackgroundEnabled, setRemoveBackgroundEnabled] = useState(false);
  const [isModelInitialized, setIsModelInitialized] = useState(false);
  const [isInitializingModel, setIsInitializingModel] = useState(false);
  const [processingStates, setProcessingStates] = useState<Map<string, ProcessingState>>(new Map());
  const [isProcessing, setIsProcessing] = useState(false);

  const bgRemovalSupported = isBackgroundRemovalSupported();

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isModelInitialized) {
        disposeModel();
      }
    };
  }, [isModelInitialized]);

  const validateFiles = useCallback(
    (files: FileList | File[]): { valid: File[]; errors: string[] } => {
      const fileArray = Array.from(files);
      const valid: File[] = [];
      const errors: string[] = [];

      fileArray.forEach((file) => {
        // Check file type
        if (!acceptedTypes.includes(file.type)) {
          errors.push(`${file.name}: Invalid file type. Only JPEG, PNG, and WebP are allowed.`);
          return;
        }

        // Check file size
        const sizeMB = file.size / (1024 * 1024);
        if (sizeMB > maxSizeMB) {
          errors.push(`${file.name}: File size exceeds ${maxSizeMB}MB limit.`);
          return;
        }

        valid.push(file);
      });

      // Check total count
      if (selectedFiles.length + valid.length > maxFiles) {
        errors.push(`Maximum ${maxFiles} files allowed.`);
        return { valid: valid.slice(0, maxFiles - selectedFiles.length), errors };
      }

      return { valid, errors };
    },
    [acceptedTypes, maxSizeMB, maxFiles, selectedFiles.length]
  );

  // Process files with background removal
  const processFilesWithBackgroundRemoval = useCallback(
    async (files: File[]): Promise<File[]> => {
      setIsProcessing(true);
      const processedFiles: File[] = [];

      try {
        // Initialize model if not already done
        if (!isModelInitialized && !isInitializingModel) {
          setIsInitializingModel(true);
          await initializeModel((progress) => {
            // You could add global progress state here if needed
            console.log('Model initialization:', progress);
          });
          setIsModelInitialized(true);
          setIsInitializingModel(false);
        }

        // Process each file
        for (const file of files) {
          try {
            const processedFile = await removeBackground(file, (progress) => {
              setProcessingStates((prev) => {
                const newMap = new Map(prev);
                newMap.set(file.name, { fileName: file.name, progress });
                return newMap;
              });
            });
            processedFiles.push(processedFile);

            // Remove from processing states when done
            setProcessingStates((prev) => {
              const newMap = new Map(prev);
              newMap.delete(file.name);
              return newMap;
            });
          } catch (error) {
            console.error(`Failed to process ${file.name}:`, error);
            // Add original file if processing fails
            processedFiles.push(file);
            setErrors((prev) => [
              ...prev,
              `${file.name}: Background removal failed. Using original image.`,
            ]);
          }
        }
      } catch (error) {
        console.error('Failed to initialize model:', error);
        setErrors((prev) => [
          ...prev,
          'Failed to initialize AI model. Using original images.',
        ]);
        // Return original files if model init fails
        return files;
      } finally {
        setIsProcessing(false);
      }

      return processedFiles;
    },
    [isModelInitialized, isInitializingModel]
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);

      if (disabled) return;

      const { valid, errors } = validateFiles(e.dataTransfer.files);
      setErrors(errors);

      if (valid.length > 0) {
        let filesToAdd = valid;

        // Process with background removal if enabled
        if (removeBackgroundEnabled && bgRemovalSupported) {
          filesToAdd = await processFilesWithBackgroundRemoval(valid);
        }

        const newFiles = [...selectedFiles, ...filesToAdd];
        setSelectedFiles(newFiles);

        // Only call onFilesSelected immediately if NOT in confirmation mode
        if (!requireConfirmation) {
          onFilesSelected(newFiles);
        }
      }
    },
    [disabled, validateFiles, selectedFiles, onFilesSelected, removeBackgroundEnabled, bgRemovalSupported, processFilesWithBackgroundRemoval, requireConfirmation]
  );

  const handleFileInput = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files || disabled) return;

      const { valid, errors } = validateFiles(e.target.files);
      setErrors(errors);

      if (valid.length > 0) {
        let filesToAdd = valid;

        // Process with background removal if enabled
        if (removeBackgroundEnabled && bgRemovalSupported) {
          filesToAdd = await processFilesWithBackgroundRemoval(valid);
        }

        const newFiles = [...selectedFiles, ...filesToAdd];
        setSelectedFiles(newFiles);

        // Only call onFilesSelected immediately if NOT in confirmation mode
        if (!requireConfirmation) {
          onFilesSelected(newFiles);
        }
      }

      // Reset input
      e.target.value = '';
    },
    [disabled, validateFiles, selectedFiles, onFilesSelected, removeBackgroundEnabled, bgRemovalSupported, processFilesWithBackgroundRemoval, requireConfirmation]
  );

  const removeFile = useCallback(
    (index: number) => {
      const newFiles = selectedFiles.filter((_, i) => i !== index);
      setSelectedFiles(newFiles);
      onFilesSelected(newFiles);
    },
    [selectedFiles, onFilesSelected]
  );

  const clearAll = useCallback(() => {
    setSelectedFiles([]);
    setErrors([]);
    onFilesSelected([]);
  }, [onFilesSelected]);

  const handleConfirmUpload = useCallback(() => {
    if (requireConfirmation && onUploadConfirm) {
      onUploadConfirm(selectedFiles);
    } else {
      onFilesSelected(selectedFiles);
    }
    // Clear files after upload confirmation
    setSelectedFiles([]);
    setErrors([]);
  }, [selectedFiles, requireConfirmation, onUploadConfirm, onFilesSelected]);

  const handleCancelUpload = useCallback(() => {
    setSelectedFiles([]);
    setErrors([]);
  }, []);

  return (
    <div className={cn('space-y-4', className)}>
      {/* Background Removal Toggle */}
      {showBackgroundRemovalToggle && bgRemovalSupported && (
        <div className="flex items-center justify-between p-4 bg-white/80 border-2 border-warm-orange/20 rounded-2xl backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-warm-orange to-warm-brown rounded-xl flex items-center justify-center shadow-md">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <label
                htmlFor="bg-removal-toggle"
                className="text-sm font-semibold text-warm-dark cursor-pointer"
              >
                Remove Background (AI)
              </label>
              <p className="text-xs text-warm-brown/70">
                Processed locally in your browser
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="bg-removal-toggle"
              checked={removeBackgroundEnabled}
              onChange={(e) => setRemoveBackgroundEnabled(e.target.checked)}
              disabled={disabled || isProcessing}
              className="w-5 h-5 rounded border-warm-orange/30 text-warm-orange focus:ring-warm-orange focus:ring-offset-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <div className="group relative">
              <Info className="w-4 h-4 text-warm-brown/50 cursor-help" />
              <div className="absolute right-0 top-6 w-64 p-3 bg-warm-dark text-white text-xs rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
                <p className="mb-2 font-semibold">AI-Powered Background Removal</p>
                <p>Automatically removes backgrounds from product images using machine learning. The model (~175MB) will be downloaded once and cached in your browser.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Processing Indicator */}
      {(isInitializingModel || isProcessing) && (
        <div className="bg-warm-cream/50 border-2 border-warm-orange/30 rounded-2xl p-4">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-warm-orange animate-spin" />
            <div className="flex-1">
              {isInitializingModel && (
                <p className="text-sm font-semibold text-warm-dark">
                  Loading AI model... (first time only)
                </p>
              )}
              {isProcessing && (
                <>
                  <p className="text-sm font-semibold text-warm-dark">
                    Removing backgrounds...
                  </p>
                  {Array.from(processingStates.values()).map((state) => (
                    <p key={state.fileName} className="text-xs text-warm-brown/70 mt-1">
                      {state.fileName}: {state.progress.message}
                    </p>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Drop Zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled && !isProcessing) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={cn(
          'relative border-2 border-dashed rounded-2xl p-8 text-center transition-colors',
          isDragging && !disabled && !isProcessing
            ? 'border-warm-orange bg-warm-cream/30'
            : 'border-warm-orange/30 hover:border-warm-orange/50',
          (disabled || isProcessing) && 'opacity-50 cursor-not-allowed'
        )}
      >
        <input
          type="file"
          id="file-upload"
          multiple
          accept={acceptedTypes.join(',')}
          onChange={handleFileInput}
          disabled={disabled || isProcessing}
          className="hidden"
        />

        <label
          htmlFor="file-upload"
          className={cn(
            'cursor-pointer',
            (disabled || isProcessing) && 'cursor-not-allowed'
          )}
        >
          <Upload className="mx-auto h-12 w-12 text-warm-brown/50" />
          <p className="mt-2 text-sm font-semibold text-warm-dark">
            Drop images here or click to browse
          </p>
          <p className="mt-1 text-xs text-warm-brown/70">
            Max {maxFiles} files, up to {maxSizeMB}MB each (JPEG, PNG, WebP)
          </p>
          {removeBackgroundEnabled && (
            <p className="mt-2 text-xs text-warm-orange font-medium flex items-center justify-center gap-1">
              <Sparkles className="w-3 h-3" />
              Background removal enabled
            </p>
          )}
        </label>
      </div>

      {/* Error Messages */}
      {errors.length > 0 && (
        <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-4">
          <p className="text-sm font-semibold text-red-800 mb-2">Upload Errors:</p>
          <ul className="list-disc list-inside text-sm text-red-700 space-y-1">
            {errors.map((error, index) => (
              <li key={index}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Selected Files Preview */}
      {selectedFiles.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-warm-dark">
              Selected Files ({selectedFiles.length})
            </p>
            <button
              onClick={clearAll}
              className="text-xs text-red-600 hover:text-red-700 font-semibold transition-colors"
            >
              Clear All
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {selectedFiles.map((file, index) => (
              <div
                key={index}
                className="relative group rounded-2xl border-2 border-warm-orange/20 overflow-hidden bg-white/60 backdrop-blur-sm hover:border-warm-orange/40 transition-all"
              >
                <div className="aspect-square flex items-center justify-center bg-gradient-to-br from-warm-cream to-white">
                  {file.type.startsWith('image/') ? (
                    <img
                      src={URL.createObjectURL(file)}
                      alt={file.name}
                      className="w-full h-full object-cover"
                      style={{
                        // Checkerboard pattern for transparent images
                        background: file.name.includes('_nobg')
                          ? 'repeating-conic-gradient(#f0f0f0 0% 25%, #ffffff 0% 50%) 50% / 20px 20px'
                          : 'white',
                      }}
                      onLoad={(e) => {
                        // Clean up object URL after image loads
                        URL.revokeObjectURL((e.target as HTMLImageElement).src);
                      }}
                    />
                  ) : (
                    <ImageIcon className="h-12 w-12 text-warm-brown/40" />
                  )}
                </div>
                <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-40 transition-all flex items-center justify-center">
                  <button
                    onClick={() => removeFile(index)}
                    className="opacity-0 group-hover:opacity-100 bg-red-600 text-white p-2 rounded-full hover:bg-red-700 transition-all shadow-lg"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-warm-dark to-transparent text-white p-2">
                  <p className="text-xs truncate font-medium">{file.name}</p>
                  <p className="text-xs text-warm-cream/80">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                </div>
                {file.name.includes('_nobg') && (
                  <div className="absolute top-2 right-2 bg-warm-orange text-white px-2 py-0.5 rounded-full text-xs font-semibold shadow-md flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    AI
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upload Confirmation Buttons */}
      {requireConfirmation && selectedFiles.length > 0 && (
        <div className="flex items-center justify-end gap-3 pt-4 border-t-2 border-warm-orange/20">
          <button
            type="button"
            onClick={handleCancelUpload}
            disabled={disabled || isProcessing}
            className="px-4 py-2 text-sm font-semibold text-warm-dark bg-white border-2 border-warm-orange/30 rounded-xl hover:border-warm-orange/50 hover:bg-warm-cream/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirmUpload}
            disabled={disabled || isProcessing}
            className="px-4 py-2 text-sm font-semibold text-white bg-gradient-to-br from-warm-orange to-warm-brown rounded-xl hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            Upload {selectedFiles.length} Image{selectedFiles.length > 1 ? 's' : ''}
          </button>
        </div>
      )}
    </div>
  );
};

export default ImageUploadZone;
