import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";
import fs from "fs";

function loadEnv(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const env = {};
  content.split("\n").forEach(line => {
    const [key, ...valueParts] = line.trim().split("=");
    if (key && valueParts.length > 0) {
      env[key] = valueParts.join("=");
    }
  });
  return env;
}

const env = loadEnv(".env");

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID
};

async function inspectDb() {
  try {
    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);

    console.log("--- staff コレクション (最初の3件) ---");
    const staffSnap = await getDocs(collection(db, "staff"));
    let count = 0;
    staffSnap.forEach(d => {
      if (count < 3) {
        console.log(`ID: ${d.id}`, JSON.stringify(d.data()));
        count++;
      }
    });

    process.exit(0);
  } catch (error) {
    console.error("エラー:", error);
    process.exit(1);
  }
}

inspectDb();
