import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'org.Qortal.Qortal-Hub',
  appName: 'Qortal-Hub',
  webDir: 'dist',
  "plugins": {
    "LocalNotifications": {
      "smallIcon": "qort",
      "iconColor": "#09b6e8"
    }
  }
};

export default config;
