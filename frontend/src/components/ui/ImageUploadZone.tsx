import React, { useCallback, useState } from 'react';
import { Upload, X, Image as ImageIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

interface ImageUploadZoneProps {
  onFilesSelected: (files: File[]) => void;
  maxFiles?: number;
  maxSizeMB?: number;
  acceptedTypes?: string[];
  disabled?: boolean;
  className?: string;
}

const ImageUploadZone: React.FC<ImageUploadZoneProps> = ({
  onFilesSelected,
  maxFiles = 10,
  maxSizeMB = 5,
  acceptedTypes = ['image/jpeg', 'image/png', 'image/webp'],
  disabled = false,
  className,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

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

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);

      if (disabled) return;

      const { valid, errors } = validateFiles(e.dataTransfer.files);
      setErrors(errors);

      if (valid.length > 0) {
        const newFiles = [...selectedFiles, ...valid];
        setSelectedFiles(newFiles);
        onFilesSelected(newFiles);
      }
    },
    [disabled, validateFiles, selectedFiles, onFilesSelected]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files || disabled) return;

      const { valid, errors } = validateFiles(e.target.files);
      setErrors(errors);

      if (valid.length > 0) {
        const newFiles = [...selectedFiles, ...valid];
        setSelectedFiles(newFiles);
        onFilesSelected(newFiles);
      }

      // Reset input
      e.target.value = '';
    },
    [disabled, validateFiles, selectedFiles, onFilesSelected]
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

  return (
    <div className={cn('space-y-4', className)}>
      {/* Drop Zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={cn(
          'relative border-2 border-dashed rounded-lg p-8 text-center transition-colors',
          isDragging && !disabled
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-300 hover:border-gray-400',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        <input
          type="file"
          id="file-upload"
          multiple
          accept={acceptedTypes.join(',')}
          onChange={handleFileInput}
          disabled={disabled}
          className="hidden"
        />

        <label
          htmlFor="file-upload"
          className={cn(
            'cursor-pointer',
            disabled && 'cursor-not-allowed'
          )}
        >
          <Upload className="mx-auto h-12 w-12 text-gray-400" />
          <p className="mt-2 text-sm font-medium text-gray-900">
            Drop images here or click to browse
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Max {maxFiles} files, up to {maxSizeMB}MB each (JPEG, PNG, WebP)
          </p>
        </label>
      </div>

      {/* Error Messages */}
      {errors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm font-medium text-red-800 mb-2">Upload Errors:</p>
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
            <p className="text-sm font-medium text-gray-700">
              Selected Files ({selectedFiles.length})
            </p>
            <button
              onClick={clearAll}
              className="text-xs text-red-600 hover:text-red-700 font-medium"
            >
              Clear All
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {selectedFiles.map((file, index) => (
              <div
                key={index}
                className="relative group rounded-lg border border-gray-200 overflow-hidden bg-gray-50"
              >
                <div className="aspect-square flex items-center justify-center">
                  {file.type.startsWith('image/') ? (
                    <img
                      src={URL.createObjectURL(file)}
                      alt={file.name}
                      className="w-full h-full object-cover"
                      onLoad={(e) => {
                        // Clean up object URL after image loads
                        URL.revokeObjectURL((e.target as HTMLImageElement).src);
                      }}
                    />
                  ) : (
                    <ImageIcon className="h-12 w-12 text-gray-400" />
                  )}
                </div>
                <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-40 transition-all flex items-center justify-center">
                  <button
                    onClick={() => removeFile(index)}
                    className="opacity-0 group-hover:opacity-100 bg-red-600 text-white p-2 rounded-full hover:bg-red-700 transition-all"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="absolute bottom-0 left-0 right-0 bg-gray-900 bg-opacity-75 text-white p-2">
                  <p className="text-xs truncate">{file.name}</p>
                  <p className="text-xs text-gray-300">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ImageUploadZone;
