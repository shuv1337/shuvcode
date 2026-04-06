import { useColorScheme } from 'react-native';
import { useMemo } from 'react';
import { createTheme, colors, Colors } from '../theme';

export function useTheme() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const theme = useMemo(() => createTheme(isDark), [isDark]);
  const c: Colors = isDark ? colors.dark : colors.light;

  return useMemo(() => ({ theme, colors: c, isDark }), [theme, c, isDark]);
}
