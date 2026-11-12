import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { themeRevealPaths, type ThemeRevealShape } from "@/lib/theme-transition";

export type TransitionVariant = ThemeRevealShape;

interface AnimatedThemeTogglerProps extends React.ComponentPropsWithoutRef<"button"> {
  duration?: number;
  variant?: TransitionVariant;
  fromCenter?: boolean;
  theme?: "light" | "dark";
  targetTheme?: "light" | "dark";
  onThemeChange?: (theme: "light" | "dark") => void;
}

export function AnimatedThemeToggler({
  children,
  className,
  duration = 420,
  variant = "circle",
  fromCenter = false,
  theme,
  targetTheme,
  onThemeChange,
  ...props
}: AnimatedThemeTogglerProps) {
  const { t } = useTranslation();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const themeRef = useRef(theme === "dark");
  const transitionRevision = useRef(0);
  const [isDark, setIsDark] = useState(themeRef.current);

  useEffect(() => {
    if (theme !== undefined) {
      themeRef.current = theme === "dark";
      setIsDark(themeRef.current);
      return;
    }

    const sync = () => {
      themeRef.current = document.documentElement.classList.contains("dark");
      setIsDark(themeRef.current);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, [theme]);

  const toggle = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;

    const nextTheme = targetTheme ?? (themeRef.current ? "light" : "dark");
    if (nextTheme === (themeRef.current ? "dark" : "light")) return;

    const apply = () => {
      const dark = nextTheme === "dark";
      themeRef.current = dark;
      setIsDark(dark);
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.style.colorScheme = nextTheme;
      onThemeChange?.(nextTheme);
    };

    const revision = ++transitionRevision.current;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion || typeof document.startViewTransition !== "function") {
      apply();
      return;
    }

    const viewport = window.visualViewport;
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    const rect = button.getBoundingClientRect();
    const origin = fromCenter
      ? { x: width / 2, y: height / 2 }
      : { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const paths = themeRevealPaths(variant, origin.x, origin.y, width, height);
    const root = document.documentElement;
    const safeDuration = Math.max(0, Math.min(1600, duration));
    root.dataset.themeReveal = "active";
    root.style.setProperty("--theme-reveal-duration", `${safeDuration}ms`);
    root.style.setProperty("--theme-reveal-start", paths[0]);

    const clear = () => {
      if (revision !== transitionRevision.current) return;
      delete root.dataset.themeReveal;
      root.style.removeProperty("--theme-reveal-duration");
      root.style.removeProperty("--theme-reveal-start");
    };

    let transition: ViewTransition;
    try {
      transition = document.startViewTransition(() => flushSync(apply));
    } catch {
      clear();
      apply();
      return;
    }
    void transition.finished.then(clear, clear);
    void transition.ready
      .then(() => {
        if (revision !== transitionRevision.current) return;
        document.documentElement.animate(
          { clipPath: paths },
          {
            duration: safeDuration,
            easing: "cubic-bezier(.2,.75,.25,1)",
            fill: "forwards",
            pseudoElement: "::view-transition-new(root)",
          },
        );
      })
      .catch(clear);
  }, [duration, fromCenter, onThemeChange, targetTheme, variant]);

  return (
    <button type="button" ref={buttonRef} onClick={toggle} className={cn(className)} {...props}>
      {children ?? (isDark ? <Sun /> : <Moon />)}
      <span className="sr-only">{props["aria-label"] || t("theme.toggle")}</span>
    </button>
  );
}
