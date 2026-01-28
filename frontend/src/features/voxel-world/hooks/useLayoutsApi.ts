import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import api from '@/lib/api'
import type { RestaurantLayout } from '../types/voxel'

interface LayoutResponse {
  id: string
  name: string
  width: number
  height: number
  depth: number
  worldData: {
    objects: unknown[]
    version: number
  }
  tenantId: string
  createdAt: string
  updatedAt: string
}

interface UpdateLayoutDto {
  name?: string
  width?: number
  height?: number
  depth?: number
  worldData?: Record<string, unknown>
}

interface TablePositionDto {
  x: number
  y: number
  z: number
  rotation: number
}

export function useLayout() {
  return useQuery<LayoutResponse>({
    queryKey: ['layout'],
    queryFn: async () => {
      const response = await api.get('/layouts')
      return response.data
    },
  })
}

export function useUpdateLayout() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: UpdateLayoutDto) => {
      const response = await api.patch('/layouts', data)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['layout'] })
      toast.success(t('voxel.layoutSaved'))
    },
    onError: () => {
      toast.error(t('voxel.layoutSaveError'))
    },
  })
}

export function useUpdateTablePosition() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      tableId,
      position,
    }: {
      tableId: string
      position: TablePositionDto
    }) => {
      const response = await api.patch(
        `/layouts/tables/${tableId}/position`,
        position
      )
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['layout'] })
      queryClient.invalidateQueries({ queryKey: ['tables'] })
    },
    onError: () => {
      toast.error(t('voxel.positionUpdateError'))
    },
  })
}

export function useTablesWithPositions() {
  return useQuery({
    queryKey: ['tables', 'positions'],
    queryFn: async () => {
      const response = await api.get('/layouts/tables/positions')
      return response.data
    },
  })
}
