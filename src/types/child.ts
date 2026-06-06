export interface ChildData {
  id?: string; // FirestoreのドキュメントID
  
  // 基本情報
  fullName: string;          // 氏名
  age: number | null;        // 年齢
  
  // 学校・学年
  schoolName: string;        // 学校名
  grade: string;             // 学年 (例: '小3', '中1' など)
  
  // 住所・連絡先
  address: string;                  // 住所
  phoneNumberHome: string;          // 自宅電話番号
  phoneNumberEmergency: string;     // 緊急連絡先（携帯 等）
  parentWorkplaceContact: string;   // 保護者の職場の連絡先
  
  // 家族構成
  familyStructure: string;   // 家族構成（テキストボックスでの自由記述）
  
  // システムメタデータ
  createdAt?: string | number | Date; // 作成日時 (Firestore Timestampに変換可能)
  updatedAt?: string | number | Date; // 更新日時
}
