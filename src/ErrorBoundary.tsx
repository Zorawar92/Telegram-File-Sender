import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import colors from './colors';

type Props = { children: React.ReactNode };
type State = { error: Error | null };

/**
 * Rete di sicurezza: se qualcosa va storto durante il rendering, l'app mostra un
 * messaggio leggibile invece di chiudersi (in release non c'è il red screen).
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <View style={styles.root}>
        <Text style={styles.title}>Qualcosa è andato storto</Text>
        <Text style={styles.message}>{this.state.error.message}</Text>
        <Pressable style={styles.button} onPress={this.reset}>
          <Text style={styles.buttonText}>Riprova</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
    backgroundColor: colors.light.background,
  },
  title: { fontSize: 18, fontWeight: '700', color: colors.light.foreground },
  message: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    color: colors.light.mutedForeground,
  },
  button: {
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: colors.light.primary,
  },
  buttonText: { color: colors.light.primaryForeground, fontSize: 14, fontWeight: '700' },
});
