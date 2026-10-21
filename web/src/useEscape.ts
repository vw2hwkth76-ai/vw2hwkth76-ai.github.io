import { useEffect } from "react";

/**
 * Escape schliesst das offene Inspektor-Panel, auch wenn der Fokus in der Tabelle steht. Eingabefelder, Listen und
 * Dialoge behalten ihr eigenes Escape.
 */
export function useEscape(active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) return;
    const handler = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], [role='dialog'], [role='listbox'], [role='combobox']")) return;
      onEscape();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [active, onEscape]);
}
