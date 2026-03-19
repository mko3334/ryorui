import React from 'react';
import { Users, FileText, Settings } from 'lucide-react';
// import './Sidebar.css' などが必要な場合は追加しますが、今回は index.css にグローバル定義します。

type SidebarProps = {
  currentPath: string;
  onNavigate: (path: string) => void;
};

export const Sidebar: React.FC<SidebarProps> = ({ currentPath, onNavigate }) => {
  const navItems = [
    { id: 'children', label: '顧客（児童）一覧', icon: <Users size={20} /> },
    { id: 'child-form', label: '顧客新規登録', icon: <FileText size={20} /> },
    { id: 'settings', label: '設定', icon: <Settings size={20} /> },
  ];

  return (
    <aside className="app-sidebar">
      <div className="sidebar-brand" style={{ marginBottom: '2rem', padding: '0 0.5rem' }}>
        <h1 style={{ fontSize: '1.25rem', color: 'var(--primary)', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.4rem', letterSpacing: '-0.5px' }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--primary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Users size={18} />
          </div>
          <span>Tree Ki<span style={{color: 'var(--secondary)'}}>d</span>s</span>
        </h1>
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1 }}>
        {navItems.map((item) => {
          const isActive = currentPath === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                color: isActive ? 'var(--primary)' : 'var(--text-muted)',
                backgroundColor: isActive ? 'rgba(79, 70, 229, 0.1)' : 'transparent',
                fontWeight: isActive ? 600 : 500,
                transition: 'all var(--transition-fast)',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.03)';
                  e.currentTarget.style.color = 'var(--text-main)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = 'var(--text-muted)';
                }
              }}
            >
              {item.icon}
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-user" style={{ marginTop: 'auto', paddingTop: '1rem', borderTop: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>ST</span>
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>スタッフ 太郎</p>
          <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>管理者</p>
        </div>
      </div>
    </aside>
  );
};
