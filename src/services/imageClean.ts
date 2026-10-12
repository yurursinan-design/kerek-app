/**
 * Photos are redrawn before upload. This drops hidden metadata (EXIF: GPS position, camera,
 * owner name) that would otherwise reveal the customer's exact address to every provider, and
 * shrinks very large photos. Outside a browser, or if anything fails, the original is kept.
 */
const MAX_SIDE = 2560;

export async function cleanImageForUpload(blob: Blob): Promise<Blob> {
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') return blob;
  if (!/^image\/(jpeg|png|webp)$/.test(blob.type)) return blob;
  try {
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return blob;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const type = blob.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.86));
    return out && out.size > 0 ? out : blob;
  } catch {
    return blob;
  }
}
