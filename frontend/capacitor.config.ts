import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.luastracker.app',
  appName: 'Luas Tracker',
  webDir: 'dist',
  server: {
    url: 'https://luas-tracker.fly.dev',
    cleartext: false
  }
};

export default config;
