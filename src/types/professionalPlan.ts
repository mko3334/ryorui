// ---- 専門的支援計画書（個別支援計画書）型定義 ----

export type SupportCategory = '本人支援' | '家族支援' | '移行支援';

export interface SupportRow {
  id: string;                // ローカルID（行管理用）
  category: SupportCategory; // 項目
  supportGoal: string;       // 支援目標（具体的な到達目標）
  supportContent: string;    // 支援内容（内容・支援の提供上のポイント・5領域との関連性等）
  fiveAreas: string[];       // 5領域の視点（チェックボックス形式）
  achievementPeriod: string; // 達成時期
  provider: string;          // 担当者・提供機関
  notes: string;             // 留意事項（本人の役割を含む）
  priority: string;          // 優先順位
}

export interface ProfessionalPlanDoc {
  id?: string;
  childId: string;
  createdAt: string;       // 作成年月日 "YYYY-MM-DD"
  startMonth?: string;     // 開始月 "YYYY-MM"
  status?: 'draft' | 'final'; // 'draft' (案) | 'final' (本案)
  familyIntention: string; // 利用児及び家族の生活に対する意向
  overallPolicy: string;   // 総合的な支援の方針
  longTermGoal: string;    // 長期目標（内容・期間等）
  shortTermGoal: string;   // 短期目標（内容・期間等）
  serviceHours: string;    // 支援の標準的な提供時間等（曜日・頻度・時間）
  supportRows: SupportRow[];
  confirmation: string;    // 確認事項
  managerName: string;     // 児童発達支援管理責任者氏名
  signDate: string;        // 印・年月日 "YYYY-MM-DD"
  guardianName: string;    // 保護者署名
  updatedAt?: any;
}

export interface DaySchedule {
  startTime: string;            // "14:00"
  endTime: string;              // "18:00"
  totalMinutes: number;         // 240
  beforeExtStartTime: string;   // 支援前延長開始
  beforeExtEndTime: string;     // 支援前延長終了
  beforeExtMinutes: number;     // 支援前延長合計
  afterExtStartTime: string;    // 支援後延長開始
  afterExtEndTime: string;      // 支援後延長終了
  afterExtMinutes: number;      // 支援後延長合計
}

export interface ServiceHoursPlan {
  id?: string;
  childId: string;
  startMonth: string;           // "YYYY-MM"
  createdAt: string;            // "YYYY-MM-DD"
  weeklyHours: {
    [day: string]: DaySchedule; // "月", "火", "水", "木", "金", "土", "日"
  };
  extReason: string;            // 延長を必要とする理由
  notes: string;                // 特記事項
  updatedAt?: any;
}

export const FIVE_AREAS = [
  '健康・生活',
  '運動・感覚',
  '認知・行動',
  '言語・コミュニケーション',
  '人間関係・社会性',
] as const;

export type FiveArea = typeof FIVE_AREAS[number];
