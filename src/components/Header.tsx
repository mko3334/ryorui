import React from 'react';
import { Bell, Search } from 'lucide-react';

type HeaderProps = {
  title: string;
};

export const Header: React.FC<HeaderProps> = ({ title }) => {
  return (
    <header className="app-header">
      <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>{title}</h2>

      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <div style={{ 
          position: 'relative', 
          display: 'flex', 
          alignItems: 'center',
          background: 'rgba(255,255,255,0.8)',
          borderRadius: 'var(--radius-full)',
          padding: '0.4rem 1rem',
          border: '1px solid var(--border-color)'
        }}>
          <Search size={16} className="text-muted" style={{ marginRight: '0.5rem' }} />
          <input 
            type="text" 
            placeholder="児童を検索..." 
            style={{ 
              border: 'none', 
              background: 'transparent', 
              outline: 'none', 
              width: '200px',
              fontSize: '0.875rem'
            }} 
          />
        </div>

        <button className="btn-icon">
          <Bell size={20} />
          {/* 通知バッジ */}
          <span style={{ 
            position: 'absolute', 
            top: 6, 
            right: 8, 
            width: 8, 
            height: 8, 
            backgroundColor: '#EF4444', 
            borderRadius: '50%' 
          }}></span>
        </button>
      </div>
    </header>
  );
};
