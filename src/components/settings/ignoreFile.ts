/** The server's default ignore list: a JSON string array, empties removed. */
export function parseIgnoreFile(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
