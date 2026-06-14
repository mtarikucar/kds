// Pure array-reorder helper extracted from MenuManagementPage so the
// drag-and-drop math can be unit-tested in isolation. Moves the item at
// `startIndex` to `endIndex`, returning a new array (does not mutate input).
export const reorder = <T,>(list: T[], startIndex: number, endIndex: number): T[] => {
  const result = Array.from(list);
  const [removed] = result.splice(startIndex, 1);
  result.splice(endIndex, 0, removed);
  return result;
};
