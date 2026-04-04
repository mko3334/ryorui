import React, { useState } from 'react';
import { ArrowLeft, Save, User, MapPin, School, Users } from 'lucide-react';
import type { ChildData } from '../types/child';

type ChildFormProps = {
  childId?: string | null;
  onBack: () => void;
};

// Firestore保存に適した初期状態
const initialFormData: ChildData = {
  fullName: '',
  age: null,
  schoolName: '',
  grade: '',
  address: '',
  phoneNumberHome: '',
  phoneNumberEmergency: '',
  parentWorkplaceContact: '',
  familyStructure: '',
};

export const ChildForm: React.FC<ChildFormProps> = ({ childId, onBack }) => {
  const isEdit = !!childId;
  const [formData, setFormData] = useState<ChildData>(initialFormData);

  // Firestoreへの保存をシミュレート
  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    
    // 必須項目の簡易バリデーション
    if (!formData.fullName || !formData.address || !formData.phoneNumberEmergency) {
      alert('必須項目（氏名、住所、緊急連絡先）を入力してください。');
      return;
    }

    const payloadToSave: ChildData = {
      ...formData,
      updatedAt: new Date().toISOString(),
      ...(isEdit ? {} : { createdAt: new Date().toISOString() })
    };

    console.log('=== 以下のデータ形式でFirestoreの「children」コレクション等に保存されます ===');
    console.log(payloadToSave);
    console.log('================================================================');

    alert('コンソールにFirestore保存用のデータペイロードを出力しました。');
    
    // モックなので一覧へ戻る
    onBack();
  };

  const handleChange = (field: keyof ChildData, value: string | number | null) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-8 pb-12">
      {/* 戻るボタンとヘッダー */}
      <div className="flex items-center justify-between">
        <button 
          onClick={onBack}
          className="flex items-center gap-2 text-slate-500 hover:text-slate-800 font-medium transition-colors"
        >
          <ArrowLeft size={18} /> 一覧へ戻る
        </button>
        <button className="btn-primary" onClick={handleSave}>
          <Save size={18} /> {isEdit ? '更新する' : '登録する'}
        </button>
      </div>

      <div className="px-1">
        <h2 className="text-2xl font-bold text-slate-800 mb-1">{isEdit ? '児童情報の編集' : '新規登録'}</h2>
        <p className="text-sm text-slate-500">Firestoreに保存される形式でデータを整形します。</p>
      </div>

      <form className="glass-panel p-8 flex flex-col gap-10" onSubmit={handleSave}>
        
        {/* 基本情報 セクション */}
        <section>
          <h3 className="text-lg font-bold flex items-center gap-2 border-b border-green-500/15 pb-2 mb-6 text-slate-800">
            <User size={18} className="text-primary" /> 児童の基本情報
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="md:col-span-2">
              <label className="block text-sm font-semibold mb-2 text-slate-700">
                児童名（氏名） <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded ml-2 align-middle">必須</span>
              </label>
              <input 
                type="text" 
                placeholder="例: 山田 太郎" 
                className="w-full px-4 py-2.5 rounded-lg border border-green-500/15 outline-none bg-white/70 focus:ring-2 focus:ring-primary/20 transition-all text-sm"
                value={formData.fullName}
                onChange={e => handleChange('fullName', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-2 text-slate-700">年齢</label>
              <div className="flex items-center gap-2">
                <input 
                  type="number" 
                  placeholder="例: 9" 
                  className="w-full px-4 py-2.5 rounded-lg border border-green-500/15 outline-none bg-white/70 focus:ring-2 focus:ring-primary/20 transition-all text-sm"
                  value={formData.age === null ? '' : formData.age}
                  onChange={e => handleChange('age', e.target.value ? parseInt(e.target.value, 10) : null)}
                />
                <span className="text-sm text-slate-500">歳</span>
              </div>
            </div>
          </div>
        </section>

        {/* 学校情報 セクション */}
        <section>
          <h3 className="text-lg font-bold flex items-center gap-2 border-b border-green-500/15 pb-2 mb-6 text-slate-800">
            <School size={18} className="text-primary" /> 所属学校・学年
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2">
              <label className="block text-sm font-semibold mb-2 text-slate-700">学校名</label>
              <input 
                type="text" 
                placeholder="例: 第一小学校、ふれあい支援学校 等" 
                className="w-full px-4 py-2.5 rounded-lg border border-green-500/15 outline-none bg-white/70 focus:ring-2 focus:ring-primary/20 transition-all text-sm"
                value={formData.schoolName}
                onChange={e => handleChange('schoolName', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-2 text-slate-700">学年</label>
              <select 
                className="w-full px-4 py-2.5 rounded-lg border border-green-500/15 outline-none bg-white/70 focus:ring-2 focus:ring-primary/20 transition-all text-sm appearance-none cursor-pointer"
                value={formData.grade}
                onChange={e => handleChange('grade', e.target.value)}
              >
                <option value="">選択してください</option>
                <option value="未就学">未就学</option>
                <option value="小1">小学1年生</option>
                <option value="小2">小学2年生</option>
                <option value="小3">小学3年生</option>
                <option value="小4">小学4年生</option>
                <option value="小5">小学5年生</option>
                <option value="小6">小学6年生</option>
                <option value="中1">中学1年生</option>
                <option value="中2">中学2年生</option>
                <option value="中3">中学3年生</option>
                <option value="高校">高校生以上</option>
              </select>
            </div>
          </div>
        </section>

        {/* 連絡先・住所 セクション */}
        <section>
          <h3 className="text-lg font-bold flex items-center gap-2 border-b border-green-500/15 pb-2 mb-6 text-slate-800">
            <MapPin size={18} className="text-primary" /> 住所・連絡先
          </h3>
          <div className="flex flex-col gap-6">
            <div>
              <label className="block text-sm font-semibold mb-2 text-slate-700">
                住所 <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded ml-2 align-middle">必須</span>
              </label>
              <input 
                type="text" 
                placeholder="例: 東京都渋谷区○○ 1-2-3 ハイツXX 101" 
                className="w-full px-4 py-2.5 rounded-lg border border-green-500/15 outline-none bg-white/70 focus:ring-2 focus:ring-primary/20 transition-all text-sm"
                value={formData.address}
                onChange={e => handleChange('address', e.target.value)}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-semibold mb-2 text-slate-700">自宅 電話番号</label>
                <input 
                  type="tel" 
                  placeholder="例: 03-1234-5678" 
                  className="w-full px-4 py-2.5 rounded-lg border border-green-500/15 outline-none bg-white/70 focus:ring-2 focus:ring-primary/20 transition-all text-sm"
                  value={formData.phoneNumberHome}
                  onChange={e => handleChange('phoneNumberHome', e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2 text-slate-700">
                  緊急連絡先（携帯 等） <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded ml-2 align-middle">必須</span>
                </label>
                <input 
                  type="tel" 
                  placeholder="例: 090-1234-5678" 
                  className="w-full px-4 py-2.5 rounded-lg border border-green-500/15 outline-none bg-white/70 focus:ring-2 focus:ring-primary/20 transition-all text-sm"
                  value={formData.phoneNumberEmergency}
                  onChange={e => handleChange('phoneNumberEmergency', e.target.value)}
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-semibold mb-2 text-slate-700">保護者の職場の連絡先</label>
                <input 
                  type="text" 
                  placeholder="例: 株式会社〇〇（母）: 03-9876-5432" 
                  className="w-full px-4 py-2.5 rounded-lg border border-green-500/15 outline-none bg-white/70 focus:ring-2 focus:ring-primary/20 transition-all text-sm"
                  value={formData.parentWorkplaceContact}
                  onChange={e => handleChange('parentWorkplaceContact', e.target.value)}
                />
              </div>
            </div>
          </div>
        </section>

        {/* 家族構成 セクション */}
        <section>
          <h3 className="text-lg font-bold flex items-center gap-2 border-b border-green-500/15 pb-2 mb-6 text-slate-800">
            <Users size={18} className="text-primary" /> ご家族の情報
          </h3>
          <div className="flex flex-col gap-2">
            <label className="block text-sm font-semibold mb-2 text-slate-700">家族構成（お名前、続柄、年齢など）</label>
            <textarea 
              rows={4} 
              className="w-full px-4 py-2.5 rounded-lg border border-green-500/15 outline-none bg-white/70 focus:ring-2 focus:ring-primary/20 transition-all text-sm resize-y"
              placeholder="例：&#13;&#10;・父：山田 一郎 (45歳)&#13;&#10;・母：山田 花子 (42歳)&#13;&#10;・兄：山田 次郎 (12歳・中学1年)"
              value={formData.familyStructure}
              onChange={e => handleChange('familyStructure', e.target.value)}
            ></textarea>
          </div>
        </section>

        {/* 保存ボタン */}
        <div className="border-t border-green-500/15 pt-8 flex justify-end gap-3">
          <button type="button" onClick={onBack} className="px-6 py-2.5 border border-green-500/15 rounded-lg hover:bg-black/5 font-medium transition-all text-slate-600">
            キャンセル
          </button>
          <button type="submit" className="btn-primary px-8 py-2.5">
            <Save size={18} /> {isEdit ? '更新を保存する' : '登録を完了する'}
          </button>
        </div>

      </form>
    </div>
  );
};
