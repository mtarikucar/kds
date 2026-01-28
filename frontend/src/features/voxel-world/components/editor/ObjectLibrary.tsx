import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Table2,
  Armchair,
  ChefHat,
  Coffee,
  TreePine,
  Square,
  ChevronDown,
  ChevronUp,
  Box,
  Sofa,
  Flower,
  Upload,
} from 'lucide-react'
import { useVoxelStore } from '../../store/voxelStore'
import { FURNITURE_LIBRARY, DEFAULT_WORLD_DIMENSIONS, type LibraryItem, type VoxelObject, type VoxelTable, type VoxelModelObject, type ModelLibraryItem, type ModelCategory } from '../../types/voxel'
import { suggestPosition } from '../../utils/placementEngine'
import { MODEL_LIBRARY, MODEL_CATEGORIES, getModelsByCategory } from '../../data/modelLibrary'
import { TableStatus } from '@/types'
import { cn } from '@/lib/utils'

interface ObjectLibraryProps {
  onObjectSelect?: (item: LibraryItem) => void
}

const ICON_MAP: Record<string, typeof Table2> = {
  table: Table2,
  armchair: Armchair,
  'chef-hat': ChefHat,
  coffee: Coffee,
  'tree-pine': TreePine,
  square: Square,
  box: Box,
  sofa: Sofa,
  flower: Flower,
  upload: Upload,
}

const CATEGORY_ICON_MAP: Record<ModelCategory, typeof Box> = {
  furniture: Sofa,
  equipment: Coffee,
  decoration: Flower,
  custom: Upload,
}

export function ObjectLibrary({ onObjectSelect }: ObjectLibraryProps) {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(true)
  const [isModelsExpanded, setIsModelsExpanded] = useState(true)
  const [selectedModelCategory, setSelectedModelCategory] = useState<ModelCategory>('furniture')
  const [draggingItem, setDraggingItem] = useState<LibraryItem | null>(null)
  const [draggingModelItem, setDraggingModelItem] = useState<ModelLibraryItem | null>(null)
  const addObject = useVoxelStore((state) => state.addObject)
  const layout = useVoxelStore((state) => state.layout)

  const handleDragStart = useCallback(
    (e: React.DragEvent, item: LibraryItem) => {
      setDraggingItem(item)
      e.dataTransfer.setData('application/json', JSON.stringify(item))
      e.dataTransfer.effectAllowed = 'copy'
    },
    []
  )

  const handleDragEnd = useCallback(() => {
    setDraggingItem(null)
  }, [])

  const handleClick = useCallback(
    (item: LibraryItem) => {
      if (!layout) return

      const worldDims = layout.dimensions ?? DEFAULT_WORLD_DIMENSIONS
      const suggested = suggestPosition(
        item.type,
        item.dimensions,
        layout.objects,
        worldDims,
      )

      const position = suggested ?? { x: 5, y: 0, z: 5 }

      const newObject: VoxelObject = {
        id: `${item.type}-${Date.now()}`,
        type: item.type,
        position,
        rotation: { y: 0 },
        metadata: {
          libraryItemId: item.id,
          dimensions: item.dimensions,
        },
      }

      // Add table-specific properties
      if (item.type === 'table') {
        const tableObject = newObject as VoxelTable
        tableObject.linkedTableId = ''
        tableObject.status = TableStatus.AVAILABLE
        tableObject.tableNumber = `T${layout.objects.filter((o) => o.type === 'table').length + 1}`
        tableObject.capacity = item.id === 'table-2' ? 2 : item.id === 'table-4' ? 4 : 6
      }

      addObject(newObject)
      onObjectSelect?.(item)
    },
    [layout, addObject, onObjectSelect]
  )

  const handleModelDragStart = useCallback(
    (e: React.DragEvent, item: ModelLibraryItem) => {
      setDraggingModelItem(item)
      e.dataTransfer.setData('application/json', JSON.stringify({ ...item, isModel: true }))
      e.dataTransfer.effectAllowed = 'copy'
    },
    []
  )

  const handleModelDragEnd = useCallback(() => {
    setDraggingModelItem(null)
  }, [])

  const handleModelClick = useCallback(
    (item: ModelLibraryItem) => {
      if (!layout) return

      const worldDims = layout.dimensions ?? DEFAULT_WORLD_DIMENSIONS
      const suggested = suggestPosition(
        'model',
        item.dimensions,
        layout.objects,
        worldDims,
      )

      const position = suggested ?? { x: 5, y: 0, z: 5 }

      const newObject: VoxelModelObject = {
        id: `model-${Date.now()}`,
        type: 'model',
        position,
        rotation: { y: 0 },
        modelConfig: {
          modelUrl: item.modelUrl,
          scale: item.defaultScale,
          animations: item.animations?.map((name) => ({
            name,
            autoPlay: true,
            loop: true,
            speed: 1,
          })),
        },
        metadata: {
          modelLibraryItemId: item.id,
          dimensions: item.dimensions,
        },
      }

      addObject(newObject)
    },
    [layout, addObject]
  )

  const filteredModels = getModelsByCategory(selectedModelCategory)

  return (
    <div className="rounded-lg bg-gray-800">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-white"
      >
        <span>{t('voxel.library.title')}</span>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </button>

      {/* Library items */}
      {isExpanded && (
        <div className="grid grid-cols-2 gap-1 p-2 pt-0">
          {FURNITURE_LIBRARY.map((item) => {
            const Icon = ICON_MAP[item.icon] || Square
            const isDragging = draggingItem?.id === item.id

            return (
              <button
                key={item.id}
                draggable
                onDragStart={(e) => handleDragStart(e, item)}
                onDragEnd={handleDragEnd}
                onClick={() => handleClick(item)}
                className={cn(
                  'flex flex-col items-center gap-1 rounded p-2 text-xs transition-colors',
                  isDragging
                    ? 'bg-primary/20 text-primary'
                    : 'text-gray-400 hover:bg-gray-700 hover:text-white'
                )}
                title={item.description}
              >
                <Icon className="h-5 w-5" />
                <span className="truncate text-center">{item.name}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* 3D Models Section */}
      <div className="mt-2 border-t border-gray-700 pt-2">
        <button
          onClick={() => setIsModelsExpanded(!isModelsExpanded)}
          className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-white"
        >
          <span className="flex items-center gap-2">
            <Box className="h-4 w-4" />
            {t('voxel.library.models', '3D Models')}
          </span>
          {isModelsExpanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>

        {isModelsExpanded && (
          <div className="px-2 pb-2">
            {/* Category tabs */}
            <div className="mb-2 flex gap-1">
              {MODEL_CATEGORIES.map((category) => {
                const CategoryIcon = CATEGORY_ICON_MAP[category.id]
                const isActive = selectedModelCategory === category.id

                return (
                  <button
                    key={category.id}
                    onClick={() => setSelectedModelCategory(category.id)}
                    className={cn(
                      'flex flex-1 items-center justify-center gap-1 rounded px-2 py-1 text-xs transition-colors',
                      isActive
                        ? 'bg-primary text-white'
                        : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-white'
                    )}
                    title={category.name}
                  >
                    <CategoryIcon className="h-3 w-3" />
                  </button>
                )
              })}
            </div>

            {/* Model items */}
            <div className="grid grid-cols-2 gap-1">
              {filteredModels.map((item) => {
                const isDragging = draggingModelItem?.id === item.id

                return (
                  <button
                    key={item.id}
                    draggable
                    onDragStart={(e) => handleModelDragStart(e, item)}
                    onDragEnd={handleModelDragEnd}
                    onClick={() => handleModelClick(item)}
                    className={cn(
                      'flex flex-col items-center gap-1 rounded p-2 text-xs transition-colors',
                      isDragging
                        ? 'bg-primary/20 text-primary'
                        : 'text-gray-400 hover:bg-gray-700 hover:text-white'
                    )}
                    title={item.description}
                  >
                    <Box className="h-5 w-5" />
                    <span className="truncate text-center text-[10px]">{item.name}</span>
                    {item.animations && item.animations.length > 0 && (
                      <span className="text-[8px] text-blue-400">animated</span>
                    )}
                  </button>
                )
              })}
              {filteredModels.length === 0 && (
                <div className="col-span-2 py-4 text-center text-xs text-gray-500">
                  {t('voxel.library.noModels', 'No models in this category')}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
