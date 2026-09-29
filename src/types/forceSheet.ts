export interface ForceSheetRow {
  id: string;
  time: string;          // 時刻等 (例: "14:30")
  activity: string;      // 予定・内容・活動 (タグ名称、手入力可)
  stepContent: string;   // 手順 行動・支援の内容、ポイント (区切りなし)
  observation: string;   // 様子 (チャットメモ本文のみ)
  stepStart?: string;    // 後方互換用
  stepEnd?: string;      // 後方互換用
  checked?: boolean;     // 後方互換用
}

export interface ForceSheetDoc {
  id?: string;
  childId: string;
  officeId: string;
  officeName: string;
  createdDate: string;       // 作成日 (YYYY-MM-DD)
  serviceDate: string;       // サービス提供日 (YYYY-MM-DD)
  authorName: string;        // 作成者名 (staffから選択)
  serviceStaffName: string;  // サービス提供者名 (staffから選択)
  rows: ForceSheetRow[];
  notes: string;             // 特記事項、その他
  createdAt?: any;
  updatedAt?: any;
}

export interface ChatMessage {
  id: string;
  text: string;
  timestamp: string;
  staffName?: string;
  tag?: string | null;
  included?: boolean;
}

export interface StaffMember {
  id: string;
  name: string;
}
