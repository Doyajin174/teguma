/**
 * Browser-editor interaction math. It has no DOM dependency so pointer
 * interactions can be tested with the engine schema in Node.
 *
 * @typedef {{ x: number, y: number, width: number, height: number }} Frame
 * @typedef {{ id: string, frame: Frame }} Layer
 * @typedef {{ id: string, layers: Layer[] }} Page
 * @typedef {{ pages: Page[] }} Document
 * @typedef {"nw" | "ne" | "sw" | "se"} ResizeHandle
 */

/** @param {Frame} frame @param {number} x @param {number} y */
export function pointInFrame(frame, x, y) {
  return x >= frame.x
    && x <= frame.x + frame.width
    && y >= frame.y
    && y <= frame.y + frame.height;
}

/** Return the visually uppermost matching layer (later layers draw on top). */
export function hitTest(page, x, y) {
  for (let index = page.layers.length - 1; index >= 0; index -= 1) {
    const layer = page.layers[index];
    if (pointInFrame(layer.frame, x, y)) return layer;
  }
  return undefined;
}

/**
 * Copy one layer mutation into a document and run the caller's schema
 * normalizer. `validate` is normally `parseDesignDocument` on the local
 * server, making invalid client geometry impossible to commit.
 */
export function mutateLayer(document, pageId, layerId, mutate, validate) {
  const candidate = {
    ...document,
    pages: document.pages.map((page) => page.id !== pageId ? page : {
      ...page,
      layers: page.layers.map((layer) => layer.id !== layerId ? layer : mutate(layer)),
    }),
  };
  return validate(candidate);
}

/** @param {Document} document @param {string} pageId @param {string} layerId @param {number} dx @param {number} dy @param {(value: unknown) => Document} validate */
export function moveLayer(document, pageId, layerId, dx, dy, validate) {
  return mutateLayer(document, pageId, layerId, (layer) => ({
    ...layer,
    frame: { ...layer.frame, x: layer.frame.x + dx, y: layer.frame.y + dy },
  }), validate);
}

/** Resize a frame from one corner while always retaining positive geometry. */
export function resizeFrame(frame, handle, dx, dy, minimum = 1) {
  const right = frame.x + frame.width;
  const bottom = frame.y + frame.height;
  let left = frame.x;
  let top = frame.y;
  let nextRight = right;
  let nextBottom = bottom;

  if (handle.includes("w")) left = Math.min(right - minimum, frame.x + dx);
  if (handle.includes("e")) nextRight = Math.max(left + minimum, right + dx);
  if (handle.includes("n")) top = Math.min(bottom - minimum, frame.y + dy);
  if (handle.includes("s")) nextBottom = Math.max(top + minimum, bottom + dy);

  return { x: left, y: top, width: nextRight - left, height: nextBottom - top };
}

/** @param {Document} document @param {string} pageId @param {string} layerId @param {ResizeHandle} handle @param {number} dx @param {number} dy @param {(value: unknown) => Document} validate */
export function resizeLayer(document, pageId, layerId, handle, dx, dy, validate) {
  return mutateLayer(document, pageId, layerId, (layer) => ({
    ...layer,
    frame: resizeFrame(layer.frame, handle, dx, dy),
  }), validate);
}

/** @param {Document} document @param {string} pageId @param {string} layerId @param {string} text @param {(value: unknown) => Document} validate */
export function changeText(document, pageId, layerId, text, validate) {
  return mutateLayer(document, pageId, layerId, (layer) => ({ ...layer, text }), validate);
}
