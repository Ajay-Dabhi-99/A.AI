import { create } from 'zustand';

export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'a-ai-theme';
const ORDER: ThemePreference[] = ['system', 'light', 'dark'];

function readStoredPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

/** "system" removes the attribute so the prefers-color-scheme tokens apply. */
function applyPreference(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === 'system') delete root.dataset.theme;
  else root.dataset.theme = preference;

  try {
    if (preference === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Storage blocked (private mode, site data disabled): the choice lasts for this page only.
  }
}

type ThemeState = {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  cyclePreference: () => void;
};

export const useThemeStore = create<ThemeState>()((set, get) => ({
  preference: readStoredPreference(),
  setPreference: (preference) => {
    applyPreference(preference);
    set({ preference });
  },
  cyclePreference: () => {
    const next = ORDER[(ORDER.indexOf(get().preference) + 1) % ORDER.length] ?? 'system';
    get().setPreference(next);
  },
}));
