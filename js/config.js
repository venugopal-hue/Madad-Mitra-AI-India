import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-analytics.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-storage.js";

export const FIREBASE_CONFIG = {
    apiKey: "AIzaSyDw9dI2uHMhIacdUfQ_dtsmKH-HY5XGwG0",
    authDomain: "madad-mitra-ai-2026.firebaseapp.com",
    projectId: "madad-mitra-ai-2026",
    storageBucket: "madad-mitra-ai-2026.firebasestorage.app",
    messagingSenderId: "15879642619",
    appId: "1:15879642619:web:3b0f1e55fef01f87693f5e",
    measurementId: "G-HLKPZHZSC0"
};

const app = initializeApp(FIREBASE_CONFIG);
export const analytics = getAnalytics(app);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export const OPENAI_CONFIG = {
    // Never commit real keys. Set your key here locally before production use.
    apiKey: "YOUR_OPENAI_API_KEY",
    endpoint: "https://api.openai.com/v1/chat/completions"
};

// Application Constants
export const APP_CONFIG = {
    matchingRadius: 20, // km
    distanceWeight: 0.35,
    skillMatchWeight: 0.30,
    availabilityWeight: 0.15,
    reliabilityWeight: 0.10,
    responseSpeedWeight: 0.10
};
