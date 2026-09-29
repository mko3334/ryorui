import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
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

async function inspect() {
  try {
    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);
    const auth = getAuth(app);

    // Authenticate
    const email = "temp_inspector@tree-kids.jp";
    const password = "inspector_secret_123";
    await signInWithEmailAndPassword(auth, email, password);

    const childId = "child_1778127760817_5459";
    console.log(`=== tree_communications subcollection for ${childId} ===`);
    const treeCommRef = collection(db, 'children', childId, 'app_categories', '書類管理', 'tree_communications');
    const snap = await getDocs(treeCommRef);
    snap.forEach(d => {
      console.log(`Doc ID: ${d.id}`, JSON.stringify(d.data()));
    });

    process.exit(0);
  } catch (error) {
    console.error("Inspect failed:", error);
    process.exit(1);
  }
}

inspect();
