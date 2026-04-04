import React from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import type { Child } from '../data/mockData';

type LayoutProps = {
  children: React.ReactNode;
  currentPath: string;
  onNavigate: (path: string) => void;
  viewMode: 'by-child' | 'by-document';
  onViewModeChange: (mode: 'by-child' | 'by-document') => void;
  childrenData: Child[];
  selectedChildId: string | null;
  onSelectChild: (id: string) => void;
};

export const Layout: React.FC<LayoutProps> = ({ 
  children, 
  currentPath, 
  onNavigate,
  viewMode,
  onViewModeChange,
  childrenData,
  selectedChildId,
  onSelectChild
}) => {
  const getTitle = () => {
    switch(currentPath) {
      case 'children': return 'プライベートシート';
      case 'support-plan': return '専門的支援計画';
      case 'support-implementation': return '専門的支援実施計画';
      case 'assessment': return 'アセスメントシート';
      case 'force-sheet': return '強行シート';
      case 'child-form': return '顧客登録';
      case 'settings': return '設定';
      default: return '顧客管理';
    }
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar 
        currentPath={currentPath} 
        onNavigate={onNavigate} 
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        childrenData={childrenData}
        selectedChildId={selectedChildId}
        onSelectChild={onSelectChild}
      />
      <main className="flex-1 flex flex-col overflow-hidden ml-sidebar-collapsed transition-[margin] duration-normal">
        <Header title={getTitle()} />
        <div className="flex-1 overflow-y-auto p-8 animate-fade-in">
          {children}
        </div>
      </main>
    </div>
  );
};
