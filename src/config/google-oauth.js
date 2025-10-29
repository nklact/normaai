// Google OAuth Configuration
// Client IDs loaded from environment variables at build time

export const GOOGLE_OAUTH_CONFIG = {
  ios: {
    clientId: import.meta.env.VITE_GOOGLE_IOS_CLIENT_ID,
  },
  android: {
    clientId: import.meta.env.VITE_GOOGLE_ANDROID_CLIENT_ID,
  },
  desktop: {
    clientId: import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_ID,
    clientSecret: import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_SECRET,
  },
};
