export function toggleSelection(selectedIds: string[], id: string): string[] {
  return selectedIds.includes(id)
    ? selectedIds.filter((selectedId) => selectedId !== id)
    : [...selectedIds, id];
}

export function setVisibleSelection(selectedIds: string[], visibleIds: string[], selected: boolean): string[] {
  const visible = new Set(visibleIds);
  const next = selectedIds.filter((id) => !visible.has(id));
  return selected ? [...next, ...visibleIds.filter((id) => !next.includes(id))] : next;
}
