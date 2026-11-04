type Listener = () => void;

const listeners = new Map<number, Set<Listener>>();

/** Tells open studios in this team to reload the gallery once. */
export function notifyTeamGallery(teamId: number | null | undefined): void {
  if (!teamId) return;
  const group = listeners.get(teamId);
  if (!group) return;
  for (const listener of group) listener();
}

export function subscribeTeamGallery(teamId: number, listener: Listener): () => void {
  const group = listeners.get(teamId) ?? new Set<Listener>();
  group.add(listener);
  listeners.set(teamId, group);
  return () => {
    group.delete(listener);
    if (group.size === 0) listeners.delete(teamId);
  };
}
