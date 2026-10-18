/**
 * Shrink a photo in the browser before it is uploaded, so a 5 MB phone
 * picture becomes a few dozen KB:
 *
 *   "square"   centre-cropped square (dentist thumbnails, lists)
 *   "portrait" the whole picture, fitted inside a box (profile page)
 */
export async function resizeImage(
  file: File,
  mode: "square" | "portrait",
): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("not an image"));
      el.src = url;
    });
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx || !w || !h) throw new Error("not an image");

    if (mode === "square") {
      const side = Math.min(w, h);
      const out = Math.min(400, side);
      canvas.width = out;
      canvas.height = out;
      ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, out, out);
    } else {
      const scale = Math.min(1, 900 / w, 1200 / h);
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    }
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}
