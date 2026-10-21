"use client";

import { useRouter } from "next/navigation";
import { LANG_COOKIE, type Lang } from "./lang";

const OPTIONS: readonly { value: Lang; label: string }[] = [
  { value: "id", label: "ID" },
  { value: "en", label: "EN" },
];

/**
 * Two buttons, not one that cycles: the visitor sees both languages and what is currently
 * on, and reaches either one in a single tap. A cycling button only ever shows one value,
 * so "which language am I in" and "what else is there" both cost an experiment.
 *
 * The cookie is the state. The button writes it and calls router.refresh(), which re-runs
 * the server components and re-renders with the other dictionary — no reload, no flash.
 * `<html lang>` comes from app/layout.tsx on the server, so this component no longer
 * touches it: one source of truth, and it is right before hydration too.
 *
 * `aria-pressed` carries the state for assistive tech; the filled accent background
 * carries it visually, so it does not rest on colour alone (the label text changes too:
 * ID vs EN, plus a weight/contrast change on the pressed button).
 */
export function LangToggle({ lang }: { lang: Lang }) {
  const router = useRouter();

  function pick(next: Lang) {
    if (next === lang) return;
    // path=/login, not /: only this route is localised. With path=/, a visitor who picked
    // EN here would carry `lang=en` into /register and /admin, whose content is Indonesian
    // only — app/layout.tsx would then declare <html lang="en"> on a page that is not
    // English, which is worse for a screen reader than no preference at all.
    document.cookie = `${LANG_COOKIE}=${next}; path=/login; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  return (
    <div className="lang" role="group" aria-label="Bahasa / Language">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className="lang__btn"
          aria-pressed={lang === option.value}
          onClick={() => pick(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
