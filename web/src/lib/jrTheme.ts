// JR Shell is the theme. Journal reads theme.json and paints the same tokens.

export type JrPack = {
  theme?: string;
  accent?: string;
  bg?: string;
  glass?: string;
  photo?: string;
  journalFont?: string;
};

let lastPack: JrPack | null = null;

export function inJrPane(): boolean {
  try {
    if (document.documentElement.dataset.jrPane === "1") return true;
    if (new URLSearchParams(location.search).get("jr") === "1") return true;
    const w = window as unknown as { __jrApplyShellTheme?: unknown; __jrTheme?: unknown };
    if (w.__jrApplyShellTheme || w.__jrTheme) return true;
    if (window.parent !== window) return true;
  } catch {
    /* ignore */
  }
  return false;
}

function hexOk(v: string, fallback: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;
}

function hexHsl(hex: string): [number, string, string] {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let hh = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) hh = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) hh = (b - r) / d + 2;
    else hh = (r - g) / d + 4;
    hh *= 60;
  }
  return [Math.round(hh), `${Math.round(s * 100)}%`, `${Math.round(l * 100)}%`];
}

function safePhoto(photo: string): string {
  if (!/^https:\/\/[^\s"]+$/.test(photo) || photo.length > 500) return "";
  return photo;
}

function paint(pack: JrPack) {
  const light = pack.theme === "light";
  const bg = hexOk(String(pack.bg || ""), light ? "#f4f1ea" : "#090909");
  const accent = hexOk(String(pack.accent || ""), "#c9a227");
  const glass = pack.glass === "off" || pack.glass === "light" || pack.glass === "heavy" ? pack.glass : "off";
  const photo = safePhoto(String(pack.photo || ""));
  const frosted = Boolean(photo) && glass !== "off";
  const veil = glass === "heavy" ? 72 : glass === "light" ? 86 : 100;
  const text = light ? "#1a1814" : "#e2e2e2";
  const text2 = light ? "#5c574f" : "#888888";
  const text3 = light ? "#8a847c" : "#555555";
  const border = light ? "#e4ddd0" : "#2c2c2c";
  const surface = light ? "#ffffff" : "#111111";
  const primary = frosted ? `color-mix(in srgb, ${bg} ${veil}%, transparent)` : bg;
  const side = frosted ? `color-mix(in srgb, ${surface} ${Math.min(veil + 10, 94)}%, transparent)` : surface;
  const hsl = hexHsl(accent);
  const body = document.body;
  if (body) {
    body.style.backgroundColor = bg;
    body.style.backgroundImage = frosted ? `url("${photo}")` : "none";
    body.style.backgroundSize = "cover";
    body.style.backgroundPosition = "center";
    body.style.backgroundAttachment = "fixed";
    body.style.color = text;
  }
  document.documentElement.style.colorScheme = light ? "light" : "dark";
  const root = document.querySelector(".theme-light, .theme-dark") as HTMLElement | null;
  if (!root) return;
  root.classList.toggle("theme-light", light);
  root.classList.toggle("theme-dark", !light);
  const vars: Record<string, string> = {
    "--accent-h": String(hsl[0]),
    "--accent-s": hsl[1],
    "--accent-l": hsl[2],
    "--color-accent": accent,
    "--interactive-accent": accent,
    "--interactive-accent-hover": accent,
    "--text-accent": accent,
    "--text-accent-hover": accent,
    "--background-primary": primary,
    "--background-primary-alt": side,
    "--background-secondary": side,
    "--background-secondary-alt": side,
    "--background-modifier-border": border,
    "--background-modifier-form-field": light ? "#ffffff" : surface,
    "--text-normal": text,
    "--text-muted": text2,
    "--text-faint": text3,
    "--bg-primary": primary,
    "--bg-secondary": side,
    "--bg-modifier-border": border,
    "--ribbon-bg": side,
    "--header-bg": side,
    "--tab-bg": side,
    "--tab-active-bg": primary,
    "--color-base-00": bg,
    "--color-base-100": text,
  };
  if (pack.journalFont && /^\d{2}$/.test(String(pack.journalFont))) {
    vars["--font-text-size"] = `${pack.journalFont}px`;
  }
  Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
}

export function applyJrPack(pack: JrPack): "theme-light" | "theme-dark" {
  lastPack = pack;
  paint(pack);
  try {
    localStorage.setItem("jr-shell-theme", pack.theme === "light" ? "light" : "dark");
  } catch {
    /* ignore */
  }
  return pack.theme === "light" ? "theme-light" : "theme-dark";
}

export function repaintJr(): "theme-light" | "theme-dark" | null {
  if (!lastPack) return null;
  return applyJrPack(lastPack);
}
