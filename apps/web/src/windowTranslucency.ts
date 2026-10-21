import { isElectron } from "./env";
import { isMacPlatform } from "./lib/utils";

// Only the macOS desktop shell can paint the desktop behind the window; in a
// plain browser a transparent page would show an empty canvas instead.
export function isWindowTranslucencySupported(): boolean {
  return (
    isElectron &&
    isMacPlatform(navigator.platform) &&
    window.desktopBridge?.setWindowVibrancy !== undefined
  );
}

export function isWindowTranslucencyEnabled(
  sidebarTranslucency: number,
  mainTranslucency: number,
): boolean {
  return isWindowTranslucencySupported() && (sidebarTranslucency > 0 || mainTranslucency > 0);
}

export function applyWindowTranslucency(
  root: HTMLElement,
  sidebarTranslucency: number,
  mainTranslucency: number,
): void {
  if (!isWindowTranslucencyEnabled(sidebarTranslucency, mainTranslucency)) {
    delete root.dataset.windowTranslucency;
    root.style.removeProperty("--window-sidebar-opacity");
    root.style.removeProperty("--window-main-opacity");
    return;
  }
  root.dataset.windowTranslucency = "";
  root.style.setProperty("--window-sidebar-opacity", `${100 - sidebarTranslucency}%`);
  root.style.setProperty("--window-main-opacity", `${100 - mainTranslucency}%`);
}
