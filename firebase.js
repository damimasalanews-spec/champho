// Firebase configuration placeholder for CHAMP WORD V40.1
// Replace these values with your Firebase Web App configuration.
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
window.CHAMP_WORD_FIREBASE_CONFIG = firebaseConfig;

// The dashboard shell imports this module as `./firebase.js`.
export { firebaseConfig };
