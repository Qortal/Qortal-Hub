import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.example.app',
  appName: 'Qortal ',
  webDir: 'dist',
  "plugins": {
    "LocalNotifications": {
      "smallIcon": "qort",
      "iconColor": "#09b6e8"
    }
  }
};

export default config;
