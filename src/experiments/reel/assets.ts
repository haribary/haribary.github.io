/**
 * Reel serves resized copies of the shared images from public/lab/reel/ (the
 * originals in public/files/ are up to 3.5k px, too heavy for textures).
 * Same pictures, same names, re-encoded as JPEG at most 1280 px on the long side.
 */
export function photoSrc(src: string) {
  const name = src.split("/").pop()!.replace(/\.[a-z]+$/i, "")
  return `/lab/reel/${name}.jpg`
}
