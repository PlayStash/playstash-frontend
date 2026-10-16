import { serverMediaId } from "@/utils/serverMediaUrl";

/** A screenshot link that could not be downloaded and stored. */
export class ScreenshotStoreError extends Error {
  constructor(readonly url: string) {
    super(`Screenshot could not be stored: ${url}`);
  }
}

export interface StoreScreenshotsOptions {
  serverUrl: string;
  /** Uploads an image to the server and returns its media id. */
  upload: (file: File) => Promise<number>;
  fetchImage?: (url: string) => Promise<Response>;
}

/** Address of an uploaded image on the server. */
export function serverMediaAddress(serverUrl: string, id: number): string {
  return `${serverUrl.replace(/\/+$/, "")}/api/media/${id}`;
}

/**
 * Stores custom screenshots on the server: images already on it are kept,
 * links to other sites are downloaded and uploaded. A link that cannot be
 * stored throws {@link ScreenshotStoreError} instead of being kept.
 */
export async function storeScreenshots(
  urls: string[],
  {
    serverUrl,
    upload,
    fetchImage = (url) => fetch(url),
  }: StoreScreenshotsOptions,
): Promise<string[]> {
  const stored: string[] = [];
  for (const url of urls) {
    if (serverMediaId(url, serverUrl) != null) {
      stored.push(url);
      continue;
    }
    let file: File;
    try {
      const res = await fetchImage(url);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      if (!blob.type.startsWith("image/")) throw new Error(blob.type);
      file = new File(
        [blob],
        `screenshot.${blob.type.split("/")[1] || "png"}`,
        {
          type: blob.type,
        },
      );
    } catch {
      throw new ScreenshotStoreError(url);
    }
    stored.push(serverMediaAddress(serverUrl, await upload(file)));
  }
  return stored;
}
