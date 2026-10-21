export function getInitialWindowBackgroundColor(shouldUseDarkColors: boolean): string {
  return shouldUseDarkColors ? "#0a0a0a" : "#ffffff";
}

// A window must be created transparent for vibrancy to render cleanly; making
// an opaque window transparent later leaves stale pixels wherever the page
// paints nothing. Windows listed here were created transparent, and their page
// paints its own opaque backdrop while translucency is off, so theme syncs keep
// the native background transparent.
const transparentWindows = new WeakSet<Electron.BrowserWindow>();

export const TRANSPARENT_WINDOW_BACKGROUND = "#00000000";

export function markTransparentWindow(window: Electron.BrowserWindow): void {
  transparentWindows.add(window);
}

export function setWindowVibrancy(window: Electron.BrowserWindow, enabled: boolean): void {
  if (window.isDestroyed() || !transparentWindows.has(window)) return;
  window.setVibrancy(enabled ? "under-window" : null);
}

export function windowBackgroundColor(
  window: Electron.BrowserWindow,
  opaqueBackgroundColor: string,
): string {
  return transparentWindows.has(window) ? TRANSPARENT_WINDOW_BACKGROUND : opaqueBackgroundColor;
}
