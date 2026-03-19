import React, { useState } from 'react';
import { Search, Filter, Phone, MoreVertical } from 'lucide-react';

type ChildListProps = {
  onSelectChild: (id: string) => void;
  onNewChild: () => void;
};

export const ChildList: React.FC<ChildListProps> = ({ onSelectChild, onNewChild }) => {
  const [searchTerm, setSearchTerm] = useState('');

  // モックデータ
  const childrenData = [
    { id: '1', name: '山田 太郎', nameKana: 'ヤマダ タロウ', grade: '小学3年生', school: '第一小学校', features: ['ADHD', 'ASD'], imageKey: 'Y' },
    { id: '2', name: '鈴木 花子', nameKana: 'スズキ ハナコ', grade: '小学1年生', school: '第二小学校', features: ['学習障害'], imageKey: 'S' },
    { id: '3', name: '佐藤 健太', nameKana: 'サトウ ケンタ', grade: '小学5年生', school: '第一小学校', features: ['知的障害'], imageKey: 'S' },
    { id: '4', name: '高橋 涼子', nameKana: 'タカハシ リョウコ', grade: '中学1年生', school: '東中学校', features: ['ASD'], imageKey: 'T' },
    { id: '5', name: '伊藤 海', nameKana: 'イトウ カイ', grade: '小学2年生', school: '第三小学校', features: ['車椅子'], imageKey: 'I' },
    { id: '6', name: '渡辺 結衣', nameKana: 'ワタナベ ユイ', grade: '小学4年生', school: '第二小学校', features: ['ADHD'], imageKey: 'W' },
  ];

  const filteredChildren = childrenData.filter(child => 
    child.name.includes(searchTerm) || child.nameKana.includes(searchTerm)
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* ツールバー */}
      <div className="flex-between">
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <Search size={18} className="text-muted" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
            <input 
              type="text" 
              placeholder="名前で検索..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                padding: '0.6rem 1rem 0.6rem 2.5rem',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                outline: 'none',
                width: '300px',
                fontFamily: 'inherit'
              }}
            />
          </div>
          <button className="btn-icon" style={{ border: '1px solid var(--border-color)', background: 'white' }}>
            <Filter size={18} />
          </button>
        </div>
        
        <button className="btn-primary" onClick={onNewChild}>
          顧客（児童）の新規登録
        </button>
      </div>

      {/* グリッドビュー */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem' }}>
        {filteredChildren.map(child => (
          <div 
            key={child.id} 
            className="glass-panel" 
            style={{ padding: '1.5rem', cursor: 'pointer', position: 'relative' }}
            onClick={() => onSelectChild(child.id)}
          >
            <button 
              className="btn-icon" 
              style={{ position: 'absolute', top: '1rem', right: '1rem' }}
              onClick={(e) => { e.stopPropagation(); }}
            >
              <MoreVertical size={16} />
            </button>
            
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ 
                width: 72, height: 72, 
                borderRadius: '50%', 
                background: 'linear-gradient(135deg, var(--primary), #8B5CF6)', 
                color: 'white', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                fontSize: '1.5rem', 
                fontWeight: 'bold',
                marginBottom: '1rem',
                boxShadow: '0 4px 10px rgba(79, 70, 229, 0.3)'
              }}>
                {child.imageKey}
              </div>
              <h3 style={{ margin: '0 0 0.25rem 0', fontSize: '1.125rem' }}>{child.name}</h3>
              <p className="text-muted" style={{ margin: 0, fontSize: '0.875rem' }}>{child.grade} / {child.school}</p>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '1rem', justifyContent: 'center' }}>
              {child.features.map(f => (
                <span key={f} style={{ 
                  background: 'rgba(0,0,0,0.05)', 
                  padding: '0.2rem 0.5rem', 
                  borderRadius: '4px', 
                  fontSize: '0.75rem', 
                  color: 'var(--text-muted)' 
                }}>{f}</span>
              ))}
            </div>

            <div style={{ display: 'flex', borderTop: '1px solid var(--border-color)', marginTop: '1.5rem', paddingTop: '1rem' }}>
              <button 
                style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.875rem' }}
                onClick={(e) => e.stopPropagation()}
              >
                <Phone size={14} /> 連絡
              </button>
              <div style={{ width: '1px', background: 'var(--border-color)' }}></div>
              <button 
                style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', color: 'var(--primary)', fontWeight: 500, fontSize: '0.875rem' }}
                onClick={() => onSelectChild(child.id)}
              >
                編集・詳細
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
