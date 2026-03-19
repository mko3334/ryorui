import React, { useState } from 'react';
import { ArrowLeft, Save, User, MapPin, School, Users } from 'lucide-react';
import { ChildData } from '../types/child';

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      {/* 戻るボタンとヘッダー */}
      <div className="flex-between">
        <button 
          onClick={onBack}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontWeight: 500 }}
        >
          <ArrowLeft size={18} /> 一覧へ戻る
        </button>
        <button className="btn-primary" onClick={handleSave}>
          <Save size={18} /> {isEdit ? '更新する' : '登録する'}
        </button>
      </div>

      <div style={{ padding: '0 0.5rem' }}>
        <h2 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>{isEdit ? '顧客（児童）情報の編集' : '新規登録'}</h2>
        <p className="text-muted">Firestoreに保存される形式でデータを整形します。</p>
      </div>

      <form className="glass-panel" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '2rem' }} onSubmit={handleSave}>
        
        {/* 基本情報 セクション */}
        <section>
          <h3 style={{ fontSize: '1.125rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
            <User size={18} color="var(--primary)" /> 児童の基本情報
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>児童名（氏名） <span style={requiredStyle}>必須</span></label>
              <input 
                type="text" 
                placeholder="例: 山田 太郎" 
                style={inputStyle} 
                value={formData.fullName}
                onChange={e => handleChange('fullName', e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>年齢</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input 
                  type="number" 
                  placeholder="例: 9" 
                  style={inputStyle} 
                  value={formData.age === null ? '' : formData.age}
                  onChange={e => handleChange('age', e.target.value ? parseInt(e.target.value, 10) : null)}
                />
                <span className="text-muted">歳</span>
              </div>
            </div>
            <div>
              {/* 年齢の隣のスペース */}
            </div>
          </div>
        </section>

        {/* 学校情報 セクション */}
        <section>
          <h3 style={{ fontSize: '1.125rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
            <School size={18} color="var(--primary)" /> 所属学校・学年
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.5rem' }}>
            <div>
              <label style={labelStyle}>学校名</label>
              <input 
                type="text" 
                placeholder="例: 第一小学校、ふれあい支援学校 等" 
                style={inputStyle} 
                value={formData.schoolName}
                onChange={e => handleChange('schoolName', e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>学年</label>
              <select 
                style={inputStyle}
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
          <h3 style={{ fontSize: '1.125rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
            <MapPin size={18} color="var(--primary)" /> 住所・連絡先
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div>
              <label style={labelStyle}>住所 <span style={requiredStyle}>必須</span></label>
              <input 
                type="text" 
                placeholder="例: 東京都渋谷区○○ 1-2-3 ハイツXX 101" 
                style={inputStyle} 
                value={formData.address}
                onChange={e => handleChange('address', e.target.value)}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
              <div>
                <label style={labelStyle}>自宅 電話番号</label>
                <input 
                  type="tel" 
                  placeholder="例: 03-1234-5678" 
                  style={inputStyle} 
                  value={formData.phoneNumberHome}
                  onChange={e => handleChange('phoneNumberHome', e.target.value)}
                />
              </div>
              <div>
                <label style={labelStyle}>緊急連絡先（携帯 等） <span style={requiredStyle}>必須</span></label>
                <input 
                  type="tel" 
                  placeholder="例: 090-1234-5678" 
                  style={inputStyle} 
                  value={formData.phoneNumberEmergency}
                  onChange={e => handleChange('phoneNumberEmergency', e.target.value)}
                />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>保護者の職場の連絡先</label>
                <input 
                  type="text" 
                  placeholder="例: 株式会社〇〇（母）: 03-9876-5432" 
                  style={inputStyle} 
                  value={formData.parentWorkplaceContact}
                  onChange={e => handleChange('parentWorkplaceContact', e.target.value)}
                />
              </div>
            </div>
          </div>
        </section>

        {/* 家族構成 セクション */}
        <section>
          <h3 style={{ fontSize: '1.125rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
            <Users size={18} color="var(--primary)" /> ご家族の情報
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <label style={labelStyle}>家族構成（お名前、続柄、年齢など）</label>
            <textarea 
              rows={4} 
              style={{ ...inputStyle, resize: 'vertical' }}
              placeholder="例：&#13;&#10;・父：山田 一郎 (45歳)&#13;&#10;・母：山田 花子 (42歳)&#13;&#10;・兄：山田 次郎 (12歳・中学1年)"
              value={formData.familyStructure}
              onChange={e => handleChange('familyStructure', e.target.value)}
            ></textarea>
          </div>
        </section>

        {/* 保存ボタン */}
        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '2rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
          <button type="button" onClick={onBack} style={{ padding: '0.8rem 1.5rem', background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '8px', fontWeight: 500, color: 'var(--text-main)', cursor: 'pointer' }}>
            キャンセル
          </button>
          <button type="submit" className="btn-primary" style={{ padding: '0.8rem 2rem' }}>
            <Save size={18} /> {isEdit ? '更新を保存する' : '登録を完了する'}
          </button>
        </div>

      </form>
    </div>
  );
};

const labelStyle = {
  display: 'block', 
  fontSize: '0.875rem', 
  marginBottom: '0.5rem', 
  fontWeight: 600,
  color: 'var(--text-main)'
};

const requiredStyle = {
  backgroundColor: '#EF4444',
  color: 'white',
  fontSize: '0.65rem',
  padding: '0.1rem 0.4rem',
  borderRadius: '4px',
  marginLeft: '0.5rem',
  verticalAlign: 'middle'
};

const inputStyle = {
  width: '100%',
  padding: '0.75rem 1rem',
  borderRadius: '8px',
  border: '1px solid var(--border-color)',
  outline: 'none',
  fontFamily: 'inherit',
  fontSize: '0.95rem',
  background: 'rgba(255,255,255,0.7)',
  transition: 'border-color var(--transition-fast), box-shadow var(--transition-fast)',
};
