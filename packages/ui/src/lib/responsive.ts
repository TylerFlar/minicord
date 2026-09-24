import { useRef, useState, useSyncExternalStore, type TouchEvent } from "react";

const PHONE = "(max-width: 720px)";

/** Phone-sized layout: bottom tabs and one screen at a time. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(
    (fn) => {
      const media = matchMedia(PHONE);
      media.addEventListener("change", fn);
      return () => media.removeEventListener("change", fn);
    },
    () => matchMedia(PHONE).matches,
  );
}

/** No hover on this device: hover-revealed UI needs a tap instead. */
export function isTouch(): boolean {
  return matchMedia("(hover: none)").matches;
}

/** Long-press on touch screens: the phone equivalent of right-click. */
export function useLongPress(onLongPress: (x: number, y: number) => void, ms = 420) {
  const latest = useRef(onLongPress);
  latest.current = onLongPress;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const cancel = () => {
    clearTimeout(timer.current);
    origin.current = null;
  };
  return {
    onTouchStart(e: TouchEvent) {
      const t = e.touches[0];
      if (!t || e.touches.length > 1) return;
      fired.current = false;
      origin.current = { x: t.clientX, y: t.clientY };
      timer.current = setTimeout(() => {
        fired.current = true;
        navigator.vibrate?.(8);
        latest.current(t.clientX, t.clientY);
      }, ms);
    },
    onTouchMove(e: TouchEvent) {
      const t = e.touches[0];
      if (origin.current && t && Math.hypot(t.clientX - origin.current.x, t.clientY - origin.current.y) > 10) cancel();
    },
    onTouchEnd(e: TouchEvent) {
      cancel();
      // Swallow the tap that ends a long press.
      if (fired.current) e.preventDefault();
    },
    onTouchCancel: cancel,
  };
}

/** A per-device UI preference (e.g. member list shown). Falls back to the default when storage is unavailable. */
export function useLocalFlag(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? initial : stored === "1";
    } catch {
      return initial;
    }
  });
  const set = (v: boolean) => {
    setValue(v);
    try {
      localStorage.setItem(key, v ? "1" : "0");
    } catch {
      // not persisted; fine
    }
  };
  return [value, set];
}
