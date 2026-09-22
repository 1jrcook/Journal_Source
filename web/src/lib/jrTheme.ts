// JR Shell owns theme. Journal paints the same background, glass, and accent.

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
    if (/(?:^|; )jr_pane=1(?:;|$)/.test(document.cookie)) return true;
    if (/\bElectron\b/.test(navigator.userAgent)) return true;
    const w = window as unknown as { __jrApplyShellTheme?: unknown; __jrTheme?: unknown };
    if (w.__jrApplyShellTheme || w.__jrTheme) return true;
    if (window.parent !== window) return true;
  } catch {
    /* ignore */
  }
  return false;
}

export function markJrPane(): void {
  document.documentElement.dataset.jrPane = "1";
  try {
    document.cookie = "jr_pane=1; Path=/; Max-Age=31536000; SameSite=Lax";
  } catch {
    /* ignore */
  }
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
  if (/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,/i.test(photo) && photo.length < 500000) return photo;
  if (/^https:\/\/[^\s"]+$/.test(photo) && photo.length <= 500) return photo;
  return "";
}

function sceneVideo(photo: string): string {
  const m = photo.match(/^(https:\/\/[^"\s]+)\/backgrounds\/(sunset|brook|rain|fire)\.jpg$/);
  return m ? `${m[1]}/backgrounds/${m[2]}.mp4` : "";
}

function ensureVideo(src: string): void {
  const root = document.documentElement;
  let v = document.getElementById("jr-scene-vid") as HTMLVideoElement | null;
  if (!src) {
    root.removeAttribute("data-jr-video");
    if (v) v.remove();
    return;
  }
  if (!v) {
    v = document.createElement("video");
    v.id = "jr-scene-vid";
    v.autoplay = true;
    v.loop = true;
    v.muted = true;
    v.playsInline = true;
    v.setAttribute("playsinline", "");
    v.addEventListener("error", () => {
      root.removeAttribute("data-jr-video");
      v?.remove();
    });
    document.body.prepend(v);
  }
  root.dataset.jrVideo = "1";
  if (v.getAttribute("src") !== src) v.src = src;
  v.play().catch(() => {});
}

function paint(pack: JrPack) {
  const light = pack.theme === "light";
  const bg = hexOk(String(pack.bg || ""), light ? "#f4f1ea" : "#090909");
  const accent = hexOk(String(pack.accent || ""), "#c9a227");
  const glass = pack.glass === "off" || pack.glass === "light" || pack.glass === "heavy" ? pack.glass : "off";
  const photo = safePhoto(String(pack.photo || ""));
  const frosted = Boolean(photo) && glass !== "off";
  const text = light ? "#1a1814" : "#e2e2e2";
  const text2 = light ? "#5c574f" : "#888888";
  const text3 = light ? "#8a847c" : "#555555";
  const border = light ? "#e4ddd0" : "#2c2c2c";
  const surface = light ? "#ffffff" : "#111111";
  const hsl = hexHsl(accent);
  const blur = glass === "heavy" ? "22px" : glass === "light" ? "12px" : "0px";
  const pane = glass === "heavy" ? "58%" : glass === "light" ? "74%" : "92%";
  const rootEl = document.documentElement;
  rootEl.style.setProperty("--jr-bg", bg);
  rootEl.style.setProperty("--jr-surface", surface);
  rootEl.style.setProperty("--jr-photo", photo ? `url("${photo.replace(/"/g, "")}")` : "none");
  rootEl.style.setProperty("--jr-blur", frosted ? blur : "0px");
  rootEl.style.setProperty("--jr-pane", pane);
  rootEl.dataset.jrGlass = frosted ? "1" : "0";
  rootEl.style.colorScheme = light ? "light" : "dark";
  ensureVideo(frosted ? sceneVideo(photo) : "");
  const body = document.body;
  if (body) body.style.color = text;
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
    "--background-primary": surface,
    "--background-primary-alt": light ? "#f6f3ec" : "#1a1a1a",
    "--background-secondary": light ? "#f6f3ec" : "#1a1a1a",
    "--background-secondary-alt": surface,
    "--background-modifier-border": border,
    "--background-modifier-form-field": light ? "#ffffff" : surface,
    "--text-normal": text,
    "--text-muted": text2,
    "--text-faint": text3,
    "--bg-primary": surface,
    "--bg-secondary": light ? "#f6f3ec" : "#1a1a1a",
    "--bg-modifier-border": border,
    "--ribbon-bg": "transparent",
    "--header-bg": "transparent",
    "--tab-bg": "transparent",
    "--tab-active-bg": light ? "rgba(255,255,255,.45)" : "rgba(17,17,17,.45)",
    "--color-base-00": bg,
    "--color-base-100": text,
  };
  if (document.documentElement.dataset.jrPane === "1") {
    const face = "-apple-system, BlinkMacSystemFont, Inter, 'Segoe UI', sans-serif";
    vars["--font-default"] = face;
    vars["--font-ui"] = face;
    vars["--font-text"] = face;
    vars["--font-text-size"] = "15px";
    vars["--radius"] = "10px";
    vars["--radius-s"] = "6px";
    vars["--radius-m"] = "10px";
    vars["--radius-l"] = "12px";
  }
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

if (typeof window !== "undefined") {
  const w = window as unknown as {
    __jrApplyShellTheme?: (pack: JrPack) => void;
    __jrThemePack?: JrPack;
  };
  w.__jrApplyShellTheme = (pack: JrPack) => {
    markJrPane();
    applyJrPack(pack);
  };
  if (w.__jrThemePack) w.__jrApplyShellTheme(w.__jrThemePack);
}
