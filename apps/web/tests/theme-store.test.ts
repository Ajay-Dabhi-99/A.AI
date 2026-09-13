import { describe, expect, it } from 'vitest';
import { useThemeStore } from '../src/stores/theme-store';

describe('theme store', () => {
  it('cycles system -> light -> dark -> system and mirrors it on <html>', () => {
    const store = useThemeStore.getState();
    store.setPreference('system');
    expect(document.documentElement.dataset.theme).toBeUndefined();

    useThemeStore.getState().cyclePreference();
    expect(useThemeStore.getState().preference).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('a-ai-theme')).toBe('light');

    useThemeStore.getState().cyclePreference();
    expect(document.documentElement.dataset.theme).toBe('dark');

    useThemeStore.getState().cyclePreference();
    expect(useThemeStore.getState().preference).toBe('system');
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem('a-ai-theme')).toBeNull();
  });
});
