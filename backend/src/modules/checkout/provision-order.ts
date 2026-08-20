/**
 * Order catalog lines for provisioning.
 *
 * KIND_RANK alone is not enough: `module` and `integration` share rank 1 and
 * Array.prototype.sort is STABLE, so the cart order can place a dependent
 * before its parent. purchase()'s dep check looks for an ACTIVE ownership row,
 * and at that moment the parent has not been written yet: the Serializable
 * transaction rolls back AFTER PayTR settled — money taken, nothing granted,
 * and there is no refund rail.
 *
 * Fix: a Kahn topological sort WITHIN a rank. Ranks keep their relative order
 * (licence always first, credits always last), and a cycle or a missing dep
 * leaves the input order untouched (fail-open: ordering makes no money
 * decision — the guard does).
 */

/** Catalog kind → provisioning rank. Lower goes first. */
export const KIND_RANK: Record<string, number> = {
  license: 0,
  module: 1,
  integration: 1,
  capacity: 2,
  service: 3,
  credit: 4,
};

/** Unknown kinds sort after everything we know about. */
const UNKNOWN_RANK = 9;

export function orderAddOnLinesForProvisioning<
  T extends { code: string; meta?: { kind?: string; deps?: string[] } },
>(lines: T[]): T[] {
  const rankOf = (l: T) => KIND_RANK[l.meta?.kind ?? ""] ?? UNKNOWN_RANK;

  // 1) Group by rank, preserving input order inside each group.
  const groups = new Map<number, T[]>();
  for (const l of lines) {
    const rank = rankOf(l);
    if (!groups.has(rank)) groups.set(rank, []);
    groups.get(rank)!.push(l);
  }

  const out: T[] = [];
  for (const rank of [...groups.keys()].sort((a, b) => a - b)) {
    out.push(...topoWithinGroup(groups.get(rank)!));
  }
  return out;
}

function topoWithinGroup<
  T extends { code: string; meta?: { kind?: string; deps?: string[] } },
>(group: T[]): T[] {
  if (group.length < 2) return group;

  const byCode = new Map<string, T>();
  for (const l of group) byCode.set(l.code, l);

  // 2) Edges only between lines that are BOTH in this group. A dep satisfied
  //    by an already-owned product is not a node here and must not block.
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const l of group) indegree.set(l.code, 0);
  for (const l of group) {
    for (const dep of l.meta?.deps ?? []) {
      if (!byCode.has(dep) || dep === l.code) continue;
      indegree.set(l.code, (indegree.get(l.code) ?? 0) + 1);
      if (!dependents.has(dep)) dependents.set(dep, []);
      dependents.get(dep)!.push(l.code);
    }
  }

  // 3) Kahn — the ready queue keeps INPUT order, so the result is
  //    deterministic for a cart whose lines are unrelated.
  const ordered: T[] = [];
  const emitted = new Set<string>();
  const queue = group.filter((l) => (indegree.get(l.code) ?? 0) === 0);
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (emitted.has(current.code)) continue;
    emitted.add(current.code);
    ordered.push(current);
    for (const dependent of dependents.get(current.code) ?? []) {
      const left = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, left);
      if (left === 0) queue.push(byCode.get(dependent)!);
    }
  }

  // 4) A cycle leaves nodes unemitted. Append them in input order rather than
  //    dropping a paid line.
  for (const l of group) if (!emitted.has(l.code)) ordered.push(l);
  return ordered;
}
