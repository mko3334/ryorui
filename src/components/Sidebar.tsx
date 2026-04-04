import React from 'react';
import { Users, FileText, Settings, ClipboardList, FileCheck, ChevronRight } from 'lucide-react';
import type { Child } from '../data/mockData';

type SidebarProps = {
  currentPath: string;
  onNavigate: (path: string) => void;
  viewMode: 'by-child' | 'by-document';
  onViewModeChange: (mode: 'by-child' | 'by-document') => void;
  childrenData: Child[];
  selectedChildId: string | null;
  onSelectChild: (id: string) => void;
};

export const Sidebar: React.FC<SidebarProps> = ({ 
  currentPath, 
  onNavigate, 
  viewMode, 
  onViewModeChange,
  childrenData,
  selectedChildId,
  onSelectChild
}) => {
  const byChildItems = [
    { id: 'child-form', label: '新規登録', icon: <FileText size={20} /> },
  ];

  const byDocumentItems = [
    { id: 'children', label: 'プライベートシート', icon: <Users size={20} /> },
    { id: 'support-plan', label: '専門制支援計画', icon: <ClipboardList size={20} /> },
    { id: 'support-implementation', label: '専門的支援実施計画', icon: <ClipboardList size={20} /> },
    { id: 'assessment', label: 'アセスメントシート', icon: <FileCheck size={20} /> },
    { id: 'force-sheet', label: '強行シート', icon: <ClipboardList size={20} /> },
  ];

  const navItems = viewMode === 'by-child' ? byChildItems : byDocumentItems;

  return (
    <aside className="app-sidebar fixed left-0 top-0 bottom-0 w-sidebar-collapsed hover:w-sidebar-expanded flex flex-col p-6 pr-3 border-r border-green-500/15 bg-white/85 backdrop-blur-2xl z-[100] transition-all duration-normal overflow-hidden hover:shadow-2xl hover:px-6">
      <div className="mb-6 px-2">
        <h1 className="text-xl text-primary font-bold flex items-center gap-2 tracking-tight">
          <div className="w-8 h-8 rounded-lg bg-primary text-white flex items-center justify-center flex-shrink-0">
            <Users size={18} />
          </div>
          <span className="sidebar-text">Tree Ki<span className="text-secondary">d</span>s</span>
        </h1>
      </div>

      {/* 視点切り替えトグル */}
      <div className="mb-6 p-1 bg-black/5 rounded-xl">
        <div className="flex gap-1">
          <button 
            className={`flex-1 py-2 text-[13px] font-semibold rounded-lg text-center transition-all duration-150 ${viewMode === 'by-child' ? 'bg-white text-primary shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
            onClick={() => onViewModeChange('by-child')}
          >
            <span className="sidebar-text">児童別</span>
          </button>
          <button 
            className={`flex-1 py-2 text-[13px] font-semibold rounded-lg text-center transition-all duration-150 ${viewMode === 'by-document' ? 'bg-white text-primary shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
            onClick={() => onViewModeChange('by-document')}
          >
            <span className="sidebar-text">書類別</span>
          </button>
        </div>
      </div>

      <nav className="flex flex-col gap-2 flex-1 overflow-y-auto pr-2">
        <div className="sidebar-text text-[11px] font-bold text-slate-400 mb-2 pl-4 uppercase tracking-wider">
          {viewMode === 'by-child' ? '児童から探す' : '書類から探す'}
        </div>
        
        {/* メインメニュー項目 */}
        {navItems.map((item) => {
          const isActive = currentPath === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`flex items-center gap-3 p-3 rounded-lg transition-all duration-150 w-full text-left cursor-pointer group-hover:justify-start justify-center ${isActive ? 'bg-primary/10 text-primary font-semibold' : 'text-slate-700 hover:bg-black/5 font-medium'}`}
            >
              <div className="flex-shrink-0 flex items-center justify-center">
                {item.icon}
              </div>
              <span className="sidebar-text text-[15px]">{item.label}</span>
            </button>
          );
        })}

        {/* 児童別モードの時の特定の児童リスト */}
        {viewMode === 'by-child' && (
          <div className="mt-4 flex flex-col gap-1">
            <div className="sidebar-text text-[11px] font-bold text-slate-400 mb-2 pl-4 uppercase tracking-wider">
              児童一覧
            </div>
            {childrenData.map(child => {
              const isSelected = selectedChildId === child.id;
              return (
                <button
                  key={child.id}
                  onClick={() => onSelectChild(child.id)}
                  className={`flex items-center gap-3 p-2 rounded-lg transition-all duration-150 w-full text-left cursor-pointer group-hover:justify-start justify-center ${isSelected ? 'bg-primary/10 text-primary font-semibold' : 'text-slate-700 hover:bg-black/5'}`}
                >
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${isSelected ? 'bg-primary text-white' : 'bg-slate-200 text-slate-500'}`}>
                    {child.imageKey}
                  </div>
                  <span className="sidebar-text flex-1 text-sm">{child.fullName}</span>
                  <div className="sidebar-text flex-shrink-0">
                    {isSelected && <ChevronRight size={14} />}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* 共通メニュー */}
        <div className="mt-auto pt-6 border-t border-green-500/15">
          <button
            onClick={() => onNavigate('settings')}
            className={`flex items-center gap-3 p-3 rounded-lg transition-all duration-150 w-full text-left cursor-pointer group-hover:justify-start justify-center ${currentPath === 'settings' ? 'bg-primary/10 text-primary font-semibold' : 'text-slate-700 hover:bg-black/5 font-medium'}`}
          >
            <div className="flex-shrink-0 flex items-center justify-center">
              <Settings size={20} />
            </div>
            <span className="sidebar-text text-[15px]">設定</span>
          </button>
        </div>
      </nav>

      <div className="mt-auto pt-4 border-t border-green-500/15 flex items-center gap-3 overflow-hidden">
        <div className="w-9 h-9 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0">
          <span className="text-[12px] font-bold text-slate-600">ST</span>
        </div>
        <div className="sidebar-text overflow-hidden">
          <p className="m-0 text-sm font-semibold truncate text-slate-800">スタッフ 太郎</p>
          <p className="m-0 text-[11px] text-slate-500">管理者</p>
        </div>
      </div>
    </aside>
  );
};
