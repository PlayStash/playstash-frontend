export function GameWebsites({ urls }: { urls?: unknown }) {
  const websites = Array.isArray(urls)
    ? [
        ...new Set(
          urls.filter((value): value is string => {
            if (typeof value !== "string") return false;
            try {
              return ["http:", "https:"].includes(new URL(value).protocol);
            } catch {
              return false;
            }
          }),
        ),
      ]
    : [];
  if (!websites.length) return <span className="game-metadata-empty">—</span>;
  return (
    <ul className="space-y-1 font-medium">
      {websites.map((url) => (
        <li key={url}>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all underline hover:text-ps-accent-cool"
          >
            {url.replace(/^https?:\/\//, "")}
          </a>
        </li>
      ))}
    </ul>
  );
}
