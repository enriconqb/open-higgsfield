export const LIBRARY_PAGE = 18;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface LibraryGroup<T> {
  id: string;
  label: string;
  year: number;
  items: T[];
}

export interface LibraryYear<T> {
  year: number;
  groups: LibraryGroup<T>[];
}

export function groupLibrary<T extends { createdAt: number }>(items: T[], now = Date.now()): LibraryYear<T>[] {
  const today = startOfLocalDay(now);
  const rangeFormat = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
  const monthFormat = new Intl.DateTimeFormat(undefined, { month: "long" });
  const rangeLabel = (from: number, to: number) => `${rangeFormat.format(from)} – ${rangeFormat.format(to)}`;
  const sorted = [...items].sort((a, b) => b.createdAt - a.createdAt);
  const groups = new Map<string, LibraryGroup<T>>();

  for (const item of sorted) {
    const day = startOfLocalDay(item.createdAt);
    const age = Math.max(0, Math.round((today - day) / DAY_MS));
    const year = new Date(item.createdAt).getFullYear();
    let id: string;
    let label: string;
    if (age < 3) {
      id = `d3-${year}`;
      label = rangeLabel(today - 2 * DAY_MS, today);
    } else if (age < 24) {
      const week = Math.floor((age - 3) / 7);
      const newestAge = 3 + week * 7;
      const oldestAge = newestAge + 6;
      id = `w${week}-${year}`;
      label = rangeLabel(today - oldestAge * DAY_MS, today - newestAge * DAY_MS);
    } else {
      const date = new Date(item.createdAt);
      id = `m-${year}-${date.getMonth()}`;
      label = monthFormat.format(date);
    }
    const existing = groups.get(id);
    if (existing) existing.items.push(item);
    else groups.set(id, { id, label, year, items: [item] });
  }

  const years: LibraryYear<T>[] = [];
  for (const group of groups.values()) {
    const last = years[years.length - 1];
    if (!last || last.year !== group.year) years.push({ year: group.year, groups: [group] });
    else last.groups.push(group);
  }
  return years;
}

export function takeLibrary<T extends { createdAt: number }>(
  years: LibraryYear<T>[],
  limit: number,
): { years: LibraryYear<T>[]; more: boolean } {
  let left = limit;
  let more = false;
  const out: LibraryYear<T>[] = [];
  for (const year of years) {
    const groups: LibraryGroup<T>[] = [];
    for (const group of year.groups) {
      if (left <= 0) {
        more = true;
        break;
      }
      const slice = group.items.slice(0, left);
      left -= slice.length;
      if (slice.length < group.items.length) more = true;
      groups.push({ ...group, items: slice });
      if (more) break;
    }
    if (groups.length > 0) out.push({ year: year.year, groups });
    if (more) break;
  }
  return { years: out, more };
}

function startOfLocalDay(time: number): number {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}
