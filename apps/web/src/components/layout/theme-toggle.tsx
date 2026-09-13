import { Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useThemeStore, type ThemePreference } from '@/stores/theme-store';

const META: Record<ThemePreference, { icon: typeof Sun; label: string }> = {
  system: { icon: Monitor, label: 'Theme: system' },
  light: { icon: Sun, label: 'Theme: light' },
  dark: { icon: Moon, label: 'Theme: dark' },
};

export function ThemeToggle() {
  const preference = useThemeStore((state) => state.preference);
  const cyclePreference = useThemeStore((state) => state.cyclePreference);
  const { icon: Icon, label } = META[preference];

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={cyclePreference}
      aria-label={`${label}. Change theme`}
      title={label}
    >
      <Icon />
    </Button>
  );
}
