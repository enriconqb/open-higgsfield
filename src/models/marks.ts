export const MODEL_MARKS = ["recommended", "high_quality", "standard", "cheap"] as const;

export type ModelMark = (typeof MODEL_MARKS)[number];

export const MODEL_MARK_LABELS: Record<ModelMark, string> = {
  recommended: "Recommended",
  high_quality: "High quality",
  standard: "Standard",
  cheap: "Cheap",
};

export function isModelMark(value: unknown): value is ModelMark {
  return typeof value === "string" && (MODEL_MARKS as readonly string[]).includes(value);
}

export function markRank(status: ModelMark | null | undefined): number {
  if (!status) return MODEL_MARKS.length;
  const index = MODEL_MARKS.indexOf(status);
  return index === -1 ? MODEL_MARKS.length : index;
}

/** Marked models lead within each surface. Unmarked models keep catalog order. */
export function sortModelsByMark<T extends { id: string; surface: string }>(
  models: readonly T[],
  marks: Partial<Record<string, ModelMark>>,
): T[] {
  const groups = new Map<string, { model: T; index: number }[]>();
  const order: string[] = [];
  models.forEach((model, index) => {
    if (!groups.has(model.surface)) {
      groups.set(model.surface, []);
      order.push(model.surface);
    }
    groups.get(model.surface)?.push({ model, index });
  });
  return order.flatMap((surface) =>
    (groups.get(surface) ?? [])
      .sort((a, b) => {
        const delta = markRank(marks[a.model.id]) - markRank(marks[b.model.id]);
        return delta !== 0 ? delta : a.index - b.index;
      })
      .map((item) => item.model),
  );
}
