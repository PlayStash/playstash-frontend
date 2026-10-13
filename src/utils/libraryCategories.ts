export interface LibraryCategory {
  id: string;
  name: string;
  tags: string[];
  folder: string;
}
export function readLibraryCategories(key: string): LibraryCategory[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(data)
      ? data.filter(
          (item): item is LibraryCategory =>
            typeof item?.id === "string" &&
            typeof item?.name === "string" &&
            Array.isArray(item?.tags) &&
            item.tags.every((tag: unknown) => typeof tag === "string") &&
            typeof item?.folder === "string",
        )
      : [];
  } catch {
    return [];
  }
}
