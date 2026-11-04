"use client";

import * as React from "react";
import { setAppearance } from "@/modules/identity/server/actions";
import { usePerformanceGuard } from "./performance-guard";
import {
  APPEARANCE_COOKIE_MAX_AGE,
  SIDEBAR_COOKIE,
  resolveScheme,
  type Ambient,
  type Motion,
  type SidebarState,
  type Theme,
} from "@/lib/theme";

type Appearance = { theme: Theme; ambient: Ambient; motion: Motion; sidebar: SidebarState };

type AppearanceContextValue = Appearance & {
  setTheme: (theme: Theme) => void;
  setAmbient: (ambient: Ambient) => void;
  setMotion: (motion: Motion) => void;
  setSidebar: (sidebar: SidebarState) => void;
};

const AppearanceContext = React.createContext<AppearanceContextValue | null>(null);

/**
 * The device's appearance choices. A change shows at once (attributes on <html>, read by the CSS),
 * and is kept in cookies for the next visits (the root layout applies them before the first paint).
 */
export function AppearanceProvider({ initial, children }: { initial: Appearance; children: React.ReactNode }) {
  const [state, setState] = React.useState(initial);
  const [, startTransition] = React.useTransition();
  usePerformanceGuard();

  const value = React.useMemo<AppearanceContextValue>(() => {
    const root = () => document.documentElement;
    return {
      ...state,
      setTheme(theme) {
        root().dataset.theme = theme;
        root().dataset.scheme = resolveScheme(theme, state.ambient, matchMedia("(prefers-color-scheme: light)").matches);
        setState((s) => ({ ...s, theme }));
        startTransition(() => setAppearance({ theme }));
      },
      setAmbient(ambient) {
        root().dataset.ambient = ambient;
        root().dataset.scheme = resolveScheme(state.theme, ambient, matchMedia("(prefers-color-scheme: light)").matches);
        setState((s) => ({ ...s, ambient }));
        startTransition(() => setAppearance({ ambient }));
      },
      setMotion(motion) {
        root().dataset.motion = motion;
        setState((s) => ({ ...s, motion }));
        startTransition(() => setAppearance({ motion }));
      },
      setSidebar(sidebar) {
        // A layout preference only: kept in a cookie without asking the server to redraw the page.
        root().dataset.sidebar = sidebar;
        document.cookie = `${SIDEBAR_COOKIE}=${sidebar}; path=/; max-age=${APPEARANCE_COOKIE_MAX_AGE}; samesite=lax`;
        setState((s) => ({ ...s, sidebar }));
      },
    };
  }, [state]);

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): AppearanceContextValue {
  const value = React.useContext(AppearanceContext);
  if (!value) throw new Error("useAppearance outside AppearanceProvider");
  return value;
}
