import { useEffect, useRef } from 'react';

/**
 * Shared hydrate guard for autosave settings pages.
 *
 * The pages on the admin settings surface all follow the same shape: local
 * form state, a react-query GET for the server snapshot, and an update
 * mutation that invalidates that GET on success. Hydrating local state
 * UNCONDITIONALLY from the query data reintroduces a lost-update bug:
 *
 *   toggle A → save fires → toggle B mid-flight → the refetch triggered by
 *   A's invalidate lands with A-only server state → B visually reverts →
 *   the pending debounce persists the reverted snapshot with a "saved" toast.
 *
 * This hook applies query data to local state ONLY while no local edit is
 * pending (`skipWhile` — typically `isDirty || status === 'saving'` from
 * useAutoSave, or a manual-save page's hasChanges flag). A refetch that lands
 * mid-edit is dropped; the save that settles those edits invalidates the GET
 * again, and THAT refetch (carrying the full server state) hydrates once the
 * form is clean. Deliberately, clearing `skipWhile` alone does NOT re-apply
 * the last skipped snapshot — it is stale relative to the save that just
 * settled and would clobber the fresh edits until the next refetch lands.
 */
export function useServerHydratedState<TData>(
  data: TData | null | undefined,
  hydrate: (data: TData) => void,
  options: { skipWhile?: boolean } = {}
): void {
  const { skipWhile = false } = options;

  // Live refs so the data-effect always sees the current render's hydrate
  // closure and skip flag without re-running on their identity changes.
  const hydrateRef = useRef(hydrate);
  const skipRef = useRef(skipWhile);
  hydrateRef.current = hydrate;
  skipRef.current = skipWhile;

  useEffect(() => {
    if (data === null || data === undefined) return;
    if (skipRef.current) return;
    hydrateRef.current(data);
  }, [data]);
}

export default useServerHydratedState;
