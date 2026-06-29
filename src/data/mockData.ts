export interface Child {
  id?: string;
  fullName: string;
  nameKana: string;
  age: number;
  grade: string;
  schoolName: string;
  address: string;
  phoneNumberHome: string;
  phoneNumberEmergency: string;
  parentWorkplaceContact: string;
  familyStructure: string;
  features: string[];
  imageKey?: string;
  offices?: string[];
  needsMonitoring?: boolean;
  currentPlanEndMonth?: string;
}

export const mockChildrenData: Child[] = [
  {
    id: "child_001",
    fullName: "山田 太郎",
    nameKana: "ヤマダ タロウ",
    age: 9,
    grade: "小3",
    schoolName: "さくら小学校",
    address: "東京都渋谷区代々木1-2-3",
    phoneNumberHome: "03-1234-5678",
    phoneNumberEmergency: "090-9999-8888",
    parentWorkplaceContact: "株式会社マテリアルホールディングス: 03-3333-4444",
    familyStructure: "父：一郎（45歳）、母：花子（42歳）、姉：結衣（12歳）",
    features: ["ADHD", "集中力が高い"]
  },
  {
    id: "child_002",
    fullName: "佐藤 結衣",
    nameKana: "サトウ ユイ",
    age: 11,
    grade: "小5",
    schoolName: "みどり第四小学校",
    address: "東京都世田谷区北沢2-4-5",
    phoneNumberHome: "03-8888-7777",
    phoneNumberEmergency: "080-1111-2222",
    parentWorkplaceContact: "世田谷区役所（母）: 03-1111-1111",
    familyStructure: "母：由美子（38歳）、祖母：和子（65歳）",
    features: ["ASD", "語彙が豊富"]
  },
  {
    id: "child_003",
    fullName: "田中 健太",
    nameKana: "タナカ ケンタ",
    age: 6,
    grade: "未就学",
    schoolName: "ひまわり幼稚園",
    address: "神奈川県川崎市中原区1-1-1",
    phoneNumberHome: "044-123-4567",
    phoneNumberEmergency: "070-5555-6666",
    parentWorkplaceContact: "自営業（父）: 044-999-9999",
    familyStructure: "父：健二（35歳）、母：祥子（33歳）、弟：翼（2歳）",
    features: ["運動が得意", "少し恥ずかしがり屋"]
  },
  {
    id: "child_004",
    fullName: "渡辺 陽葵",
    nameKana: "ワタナベ ヒマリ",
    age: 10,
    grade: "小4",
    schoolName: "さくら小学校",
    address: "東京都渋谷区神南3-2-1",
    phoneNumberHome: "03-4444-5555",
    phoneNumberEmergency: "090-2222-3333",
    parentWorkplaceContact: "ITセンター（父）: 03-1212-3434",
    familyStructure: "父：隆（41歳）、母：香織（39歳）",
    features: ["絵を描くのが好き", "穏やか"]
  },
  {
    id: "child_005",
    fullName: "伊藤 海",
    nameKana: "イトウ カイ",
    age: 8,
    grade: "小2",
    schoolName: "あおぞら支援学校",
    address: "千葉県浦安市舞浜1-2-3",
    phoneNumberHome: "047-333-4444",
    phoneNumberEmergency: "080-9900-1122",
    parentWorkplaceContact: "病院事務（母）: 047-111-2222",
    familyStructure: "母：真弓（36歳）、兄：陸（10歳）",
    features: ["パズルが得意", "感覚過敏あり"]
  }
];
