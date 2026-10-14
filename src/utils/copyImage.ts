/** Copies an image (URL or object URL) to the clipboard as PNG. */

async function toPng(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable.");
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (png) =>
          png ? resolve(png) : reject(new Error("PNG encoding failed.")),
        "image/png",
      ),
    );
  } finally {
    bitmap.close();
  }
}

export async function copyImageToClipboard(src: string): Promise<void> {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const png = await toPng(await response.blob());
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}
