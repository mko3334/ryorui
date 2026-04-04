import type { ChildData } from '../types/child';

export interface Child extends ChildData {
  id: string;
  nameKana: string;
  features: string[];
  imageKey: string;
}

export const mockChildrenData: Child[] = [
  { id: '1', fullName: '山田 太郎', nameKana: 'ヤマダ タロウ', age: 9, grade: '小学3年生', schoolName: '第一小学校', features: ['ADHD', 'ASD'], imageKey: 'Y', address: '', phoneNumberEmergency: '', phoneNumberHome: '', parentWorkplaceContact: '', familyStructure: '' },
  { id: '2', fullName: '鈴木 花子', nameKana: 'スズキ ハナコ', age: 7, grade: '小学1年生', schoolName: '第二小学校', features: ['学習障害'], imageKey: 'S', address: '', phoneNumberEmergency: '', phoneNumberHome: '', parentWorkplaceContact: '', familyStructure: '' },
  { id: '3', fullName: '佐藤 健太', nameKana: 'スズキ ケンタ', age: 11, grade: '小学5年生', schoolName: '第一小学校', features: ['知的障害'], imageKey: 'S', address: '', phoneNumberEmergency: '', phoneNumberHome: '', parentWorkplaceContact: '', familyStructure: '' },
  { id: '4', fullName: '高橋 涼子', nameKana: 'タカハシ リョウコ', age: 13, grade: '中学1年生', schoolName: '東中学校', features: ['ASD'], imageKey: 'T', address: '', phoneNumberEmergency: '', phoneNumberHome: '', parentWorkplaceContact: '', familyStructure: '' },
  { id: '5', fullName: '伊藤 海', nameKana: 'イトウ カイ', age: 8, grade: '小学2年生', schoolName: '第三小学校', features: ['車椅子'], imageKey: 'I', address: '', phoneNumberEmergency: '', phoneNumberHome: '', parentWorkplaceContact: '', familyStructure: '' },
  { id: '6', fullName: '渡辺 結衣', nameKana: 'ワタナベ ユイ', age: 10, grade: '小学4年生', schoolName: '第二小学校', features: ['ADHD'], imageKey: 'W', address: '', phoneNumberEmergency: '', phoneNumberHome: '', parentWorkplaceContact: '', familyStructure: '' },
];
