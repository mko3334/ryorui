import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyDc1jISa-wDqV7Rg-84MRbbswHC-EkUuqI",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "test-octopus-5b254.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "test-octopus-5b254",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "test-octopus-5b254.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "433348736212",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:433348736212:web:4a25a3e54a070d0e2b7741"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
