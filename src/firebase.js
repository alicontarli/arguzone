// Gerekli Firebase kütüphanelerini çağırıyoruz
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore"; // <-- BU EKLENDİ

// Senin Firebase Ayarların (Aynen korundu)
const firebaseConfig = {
  apiKey: import.meta.env.VITE_apiKey,
  authDomain: import.meta.env.VITE_authDomain,
  projectId: import.meta.env.VITE_projectId,
  storageBucket: import.meta.env.VITE_storageBucket,
  messagingSenderId: import.meta.env.VITE_messagingSenderId,
  appId: import.meta.env.VITE_appId,
  measurementId: import.meta.env.VITE_measurementId
};

// Firebase uygulamasını başlat
const app = initializeApp(firebaseConfig);

// Veritabanını başlat ve dışarı aktar (App.jsx bunu bekliyor!)
export const db = getFirestore(app);