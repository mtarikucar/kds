import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { initializeSocket, disconnectSocket } from "../../lib/socket";

export const usePersonnelSocket = () => {
  const queryClient = useQueryClient();

  useEffect(() => {
    // Take a refcount on the shared staff socket (symmetric with
    // usePosSocket/useKitchenSocket). Using getSocket()||initializeSocket()
    // here while never calling disconnectSocket() in cleanup leaked the
    // refcount whenever personnel was the FIRST consumer to mount, pinning the
    // /kds socket open for the rest of the session (and past logout).
    const socket = initializeSocket();
    if (!socket) return;

    const handleAttendanceUpdate = () => {
      queryClient.invalidateQueries({ queryKey: ["personnel", "attendance"] });
    };

    const handleSwapRequestUpdate = () => {
      queryClient.invalidateQueries({
        queryKey: ["personnel", "swap-requests"],
      });
      queryClient.invalidateQueries({ queryKey: ["personnel", "schedule"] });
    };

    socket.on("personnel:attendance-update", handleAttendanceUpdate);
    socket.on("personnel:swap-request-update", handleSwapRequestUpdate);

    return () => {
      socket.off("personnel:attendance-update", handleAttendanceUpdate);
      socket.off("personnel:swap-request-update", handleSwapRequestUpdate);
      // Release our refcount. disconnectSocket only actually closes the shared
      // socket when the LAST consumer unmounts (refcount → 0), so other
      // features that still hold it are unaffected.
      disconnectSocket();
    };
  }, [queryClient]);
};
