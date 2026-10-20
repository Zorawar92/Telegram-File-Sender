import { useColorScheme } from 'react-native';
import colors from './colors';

/**
 * Token della palette attiva (chiara o scura) in base all'impostazione del telefono,
 * più i valori indipendenti dal tema come `radius`.
 */
export function useColors() {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? colors.dark : colors.light;
  return { ...palette, radius: colors.radius };
}
