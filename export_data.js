import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";
import fs from "fs";
import path from "path";

// .envファイルを簡易パースする関数
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

async function exportData() {
  try {
    console.log("Firebaseを初期化中...");
    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);

    console.log("「children」コレクションからデータを取得中（認証なし試行）...");
    const querySnapshot = await getDocs(collection(db, "children"));
    const data = [];
    querySnapshot.forEach((doc) => {
      data.push({ id: doc.id, ...doc.data() });
    });

    console.log(`${data.length}件のデータを取得しました。`);

    const desktopPath = path.join("C:", "Users", "info", "OneDrive", "デスクトップ", "children_data_backup.json");
    
    console.log(`デスクトップに保存中: ${desktopPath}`);
    fs.writeFileSync(desktopPath, JSON.stringify(data, null, 2), "utf-8");

    console.log("エクスポートが完了しました。");
    process.exit(0);
  } catch (error) {
    console.error("エラーが発生しました:", error);
    process.exit(1);
  }
}

exportData();
