import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { colors } from '@/theme';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.brand },
          headerTintColor: '#ffffff',
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: colors.bg },
        }}>
        <Stack.Screen name="index" options={{ title: 'Cek Halal' }} />
        <Stack.Screen name="scan" options={{ title: 'Pindai Label' }} />
        <Stack.Screen name="result" options={{ title: 'Hasil Pindai' }} />
        <Stack.Screen name="search" options={{ title: 'Cari Bahan' }} />
        <Stack.Screen name="disclaimer" options={{ title: 'Disclaimer' }} />
        <Stack.Screen name="debug" options={{ title: 'Debug Scan' }} />
      </Stack>
    </>
  );
}
