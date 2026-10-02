import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { openRecoraDatabase } from './src/data/database/openDatabase';

type BootState = 'loading' | 'ready' | 'error';

export default function App() {
  const [bootState, setBootState] = useState<BootState>('loading');

  useEffect(() => {
    let mounted = true;

    openRecoraDatabase()
      .then(() => {
        if (mounted) {
          setBootState('ready');
        }
      })
      .catch((error) => {
        console.error('Recora database initialization failed.', error);
        if (mounted) {
          setBootState('error');
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.content}>
        <Text style={styles.brand}>RECORA</Text>
        <Text style={styles.title}>Capture. Reconstruct. Validate. Track.</Text>
        <Text style={styles.subtitle}>
          Offline receipt reconstruction with transparent validation.
        </Text>

        <View style={styles.statusCard}>
          {bootState === 'loading' ? (
            <>
              <ActivityIndicator />
              <Text style={styles.statusTitle}>Preparing local storage</Text>
              <Text style={styles.statusText}>
                Recora is applying its private on-device database schema.
              </Text>
            </>
          ) : null}

          {bootState === 'ready' ? (
            <>
              <Text style={styles.statusMark}>✓</Text>
              <Text style={styles.statusTitle}>Local data layer ready</Text>
              <Text style={styles.statusText}>
                SQLite initialized successfully. Receipt capture is the next
                implementation phase.
              </Text>
            </>
          ) : null}

          {bootState === 'error' ? (
            <>
              <Text style={styles.errorMark}>!</Text>
              <Text style={styles.statusTitle}>Storage initialization failed</Text>
              <Text style={styles.statusText}>
                Recora stopped before creating purchase history. Restart the app
                and inspect the development logs.
              </Text>
            </>
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F7F6F2',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  brand: {
    color: '#2D5145',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 3,
    marginBottom: 18,
  },
  title: {
    color: '#1F2321',
    fontSize: 31,
    fontWeight: '800',
    lineHeight: 38,
    marginBottom: 12,
  },
  subtitle: {
    color: '#6F756F',
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 32,
  },
  statusCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E1DC',
    borderRadius: 20,
    borderWidth: 1,
    minHeight: 190,
    padding: 24,
    justifyContent: 'center',
  },
  statusMark: {
    color: '#3F6B5B',
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 12,
  },
  errorMark: {
    color: '#C94A4A',
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 12,
  },
  statusTitle: {
    color: '#1F2321',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 8,
  },
  statusText: {
    color: '#6F756F',
    fontSize: 14,
    lineHeight: 21,
  },
});
