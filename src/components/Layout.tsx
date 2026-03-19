import React from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';

type LayoutProps = {
  children: React.ReactNode;
  currentPath: string;
  onNavigate: (path: string) => void;
};

export const Layout: React.FC<LayoutProps> = ({ children, currentPath, onNavigate }) => {
  const getTitle = () => {
    switch(currentPath) {
      case 'children': return '顧客一覧';
      case 'child-form': return '顧客登録';
      case 'settings': return '設定';
      default: return '顧客管理';
    }
  };

  return (
    <div className="app-container">
      <Sidebar currentPath={currentPath} onNavigate={onNavigate} />
      <main className="app-main">
        <Header title={getTitle()} />
        <div className="app-content animate-fade-in">
          {children}
        </div>
      </main>
    </div>
  );
};
