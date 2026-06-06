import { Timestamp } from 'firebase/firestore';

// ---- 各日の支援記録（daily_reports コレクション） ----
export interface DailyReport {
  id?: string;           // Firestore document ID（ローカル管理用、ドキュメント本文には不要）
  childId: string;       // children コレクションのドキュメントID
  planMonth: string;     // 対象年月 "YYYY-MM"（グルーピング用）
  date: any;             // 記録日 (Firestore Timestamp型)
  staffId: string;       // 作成スタッフID
  type: 'tree_report';   // 書類種別
  content: {
    externalInfo: string;  // ツリー通信テキスト
    supportContent?: string[]; // 療育内容
    resultInfo: string;    // 療育を行った結果
    futurePlan: string;    // 今後の予定
    isVerified?: boolean;  // 確認済みフラグ
  };
  archived: boolean;       // アーカイブ状態
  createdAt: Timestamp | string;
  updatedAt: Timestamp | string;
}

// ---- 支援実施計画のメタ情報（supportPlans コレクション） ----
// ※ rows は daily_reports へ移行済み
export interface SupportPlanMeta {
  childId: string;
  month: string;         // 現在表示中の対象年月 "YYYY-MM"
  goals: string;         // 支援目標
  author: string;        // 作成者
  createdAt: string;
}
