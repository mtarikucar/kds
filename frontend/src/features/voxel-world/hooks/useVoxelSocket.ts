import { useEffect, useCallback, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { initializeSocket, getSocket } from '@/lib/socket'
import { useVoxelStore } from '../store/voxelStore'
import type { TableStatus } from '@/types'
import type { Socket } from 'socket.io-client'

interface TableStatusUpdate {
  tableId: string
  status: TableStatus
}

interface TablePositionUpdate {
  tableId: string
  position: {
    x: number
    y: number
    z: number
    rotation: number
  }
}

interface LayoutUpdate {
  tenantId: string
  worldData: Record<string, unknown>
}

export function useVoxelSocket(tenantId?: string) {
  const queryClient = useQueryClient()
  const socketRef = useRef<Socket | null>(null)
  const updateTableStatus = useVoxelStore((state) => state.updateTableStatus)
  const moveObject = useVoxelStore((state) => state.moveObject)

  const handleTableStatusUpdate = useCallback(
    (data: TableStatusUpdate) => {
      updateTableStatus(data.tableId, data.status)
      queryClient.invalidateQueries({ queryKey: ['tables'] })
    },
    [updateTableStatus, queryClient]
  )

  const handleTablePositionUpdate = useCallback(
    (data: TablePositionUpdate) => {
      const voxelTableId = `voxel-table-${data.tableId}`
      moveObject(voxelTableId, {
        x: data.position.x,
        y: data.position.y,
        z: data.position.z,
      })
    },
    [moveObject]
  )

  const handleLayoutUpdate = useCallback(
    () => {
      queryClient.invalidateQueries({ queryKey: ['layout'] })
    },
    [queryClient]
  )

  useEffect(() => {
    if (!tenantId) return

    const socket = getSocket() || initializeSocket()
    socketRef.current = socket

    const roomName = `voxel:${tenantId}`

    socket.emit('join-room', roomName)

    socket.on('table:status-updated', handleTableStatusUpdate)
    socket.on('table:position-updated', handleTablePositionUpdate)
    socket.on('layout:updated', handleLayoutUpdate)

    return () => {
      socket.emit('leave-room', roomName)
      socket.off('table:status-updated', handleTableStatusUpdate)
      socket.off('table:position-updated', handleTablePositionUpdate)
      socket.off('layout:updated', handleLayoutUpdate)
    }
  }, [
    tenantId,
    handleTableStatusUpdate,
    handleTablePositionUpdate,
    handleLayoutUpdate,
  ])

  const emitTablePositionUpdate = useCallback(
    (tableId: string, position: { x: number; y: number; z: number; rotation: number }) => {
      if (!tenantId || !socketRef.current) return
      socketRef.current.emit('table:position-update', {
        tenantId,
        tableId,
        position,
      })
    },
    [tenantId]
  )

  const emitLayoutUpdate = useCallback(
    (worldData: Record<string, unknown>) => {
      if (!tenantId || !socketRef.current) return
      socketRef.current.emit('layout:update', {
        tenantId,
        worldData,
      })
    },
    [tenantId]
  )

  return {
    emitTablePositionUpdate,
    emitLayoutUpdate,
  }
}
