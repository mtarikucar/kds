import { useEffect, useCallback, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { initializeSocket, getSocket } from '@/lib/socket'
import { useVoxelStore } from '../store/voxelStore'
import type { TableStatus } from '@/types'
import type { Socket } from 'socket.io-client'
import type { AnyCommand } from '../types/commandLog'

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

/**
 * Command event payload for multiplayer sync.
 * Commands include userId and operationId for conflict resolution.
 *
 * NOTE: The actual sync/application of remote commands is deferred.
 * When implementing multiplayer, consider OT (Operational Transform) or
 * CRDT strategies for concurrent command resolution:
 *
 * - OT: Transform incoming commands against local uncommitted commands.
 *   Simpler for sequential operations (cell height changes).
 * - CRDT: Last-writer-wins for edge overrides, max-height-wins for cells.
 *   Better for eventual consistency without a central server.
 *
 * Recommended approach: OT with server-side sequencing.
 * The server assigns monotonic sequence numbers to commands.
 * Clients rebase local commands on top of server-confirmed commands.
 */
interface CommandEvent {
  tenantId: string
  command: AnyCommand
  sequenceNumber?: number
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

  /**
   * Emit a command event for multiplayer sync.
   * This only emits; remote application is deferred to future implementation.
   */
  const emitCommand = useCallback(
    (command: AnyCommand) => {
      if (!tenantId || !socketRef.current) return
      const event: CommandEvent = {
        tenantId,
        command: {
          ...command,
          userId: command.userId ?? tenantId,
          operationId: command.operationId ?? command.id,
        },
      }
      socketRef.current.emit('voxel:command', event)
    },
    [tenantId]
  )

  return {
    emitTablePositionUpdate,
    emitLayoutUpdate,
    emitCommand,
  }
}
