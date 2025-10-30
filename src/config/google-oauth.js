// Google OAuth Configuration
// Client IDs loaded from environment variables at build time

export const GOOGLE_OAUTH_CONFIG = {
  ios: {
    clientId: import.meta.env.VITE_GOOGLE_IOS_CLIENT_ID,
  },
  android: {
    // Android Credential Manager API requires Web Client ID + Secret for token exchange
    // NOT the Android Client ID! (The Android Client ID is only for legacy GoogleSignIn SDK)
    clientId: import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_ID,
    clientSecret: import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_SECRET,
  },
  desktop: {
    clientId: import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_ID,
    clientSecret: import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_SECRET,
  },
};
