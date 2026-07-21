/**
 * View-mode ⇄ URL mapping for the Tables page (`?view=plan|edit|list`).
 * Pure so the parse/serialize rules are unit-testable without the
 * Konva-heavy page: any unknown/absent value falls back to the default
 * 'plan', and the default serializes to `null` (param dropped) so the
 * canonical URL stays clean.
 */
export type TableViewMode = 'plan' | 'edit' | 'list';

export const TABLE_VIEW_MODES = ['plan', 'edit', 'list'] as const;

export const DEFAULT_TABLE_VIEW: TableViewMode = 'plan';

export function parseTableViewMode(raw: string | null | undefined): TableViewMode {
  return (TABLE_VIEW_MODES as readonly string[]).includes(raw ?? '')
    ? (raw as TableViewMode)
    : DEFAULT_TABLE_VIEW;
}

/** `null` ⇒ remove the `view` param from the URL. */
export function serializeTableViewMode(mode: TableViewMode): string | null {
  return mode === DEFAULT_TABLE_VIEW ? null : mode;
}
