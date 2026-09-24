import type { Platform } from "@minicord/core";

export type Theme = "system" | "light" | "dark";

const KEY = "mc:theme";

/** The saved choice (per device), or "system". */
export function savedTheme(): Theme {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

/** Colors come from styles.css: data-theme on <html> overrides the system's light/dark. */
export function applyTheme(theme: Theme, platform?: Platform): void {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  platform?.shell.setTheme?.(theme);
}

export function setTheme(theme: Theme, platform: Platform): void {
  try {
    if (theme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // private mode or storage blocked: the choice lasts for this session
  }
  applyTheme(theme, platform);
}
