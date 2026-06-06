import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Users, Settings as SettingsIcon, LogOut, ChevronRight, PanelLeftClose, PanelLeftOpen, Search, Building2 } from 'lucide-react';
import { auth } from '../lib/firebase';
import type { Child } from '../data/mockData';

type SidebarProps = {
  childrenData: Child[];
  selectedChildId: string | null;
  isExpanded: boolean;
  onToggle: () => void;
  selectedOfficeId: string;
  offices: { id: string, name: string }[];
  onOfficeChange: (id: string) => void;
};

export const Sidebar: React.FC<SidebarProps> = ({ 
  childrenData, 
  selectedChildId, 
  isExpanded, 
  onToggle,
  selectedOfficeId,
  offices,
  onOfficeChange
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredChildren = childrenData.filter(child => 
    child.fullName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    child.nameKana?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <aside 
      style={{ touchAction: 'pan-y' }}
      onMouseEnter={() => !isExpanded && onToggle()} // ホバーで展開
      onMouseLeave={() => isExpanded && onToggle()} // 離れると格納
      className={`app-sidebar fixed left-0 top-0 bottom-0 ${isExpanded ? 'w-sidebar-expanded' : 'w-sidebar-collapsed'} hidden md:flex flex-col p-6 pr-0 border-r border-green-500/15 bg-white/85 backdrop-blur-2xl z-[100] transition-all duration-normal print:hidden`}
    >
      {/* ロゴ & トグル */}
      <div className="mb-6 px-2 pr-6 flex items-center justify-between">
        <h1 className={`text-xl text-primary font-bold flex items-center gap-2 tracking-tight overflow-hidden transition-all duration-300 ${isExpanded ? 'opacity-100 w-auto' : 'opacity-0 w-0'}`}>
          <div className="w-8 h-8 rounded-lg bg-primary text-white flex items-center justify-center flex-shrink-0">
            <Users size={18} />
          </div>
          <span className="sidebar-text text-xl">書類管理</span>
        </h1>
        <button 
          onClick={onToggle}
          className="p-1.5 hover:bg-black/5 rounded-lg text-slate-400 hover:text-primary transition-colors"
          title={isExpanded ? "メニューを閉じる" : "メニューを開く"}
        >
          {isExpanded ? <PanelLeftClose size={20} /> : <PanelLeftOpen size={20} />}
        </button>
      </div>

      {/* 事業所選択 */}
      {isExpanded ? (
        offices.length > 0 && (
          <div className="mb-6 px-2 pr-6">
            <div className="relative flex items-center bg-slate-100/60 border border-slate-200/50 rounded-xl px-3 py-2 text-slate-700 hover:border-primary/40 focus-within:border-primary/50 transition-all shadow-sm">
              <Building2 size={16} className="text-slate-400 mr-2 shrink-0" />
              <select
                value={selectedOfficeId}
                onChange={(e) => onOfficeChange(e.target.value)}
                className="w-full bg-transparent border-none text-xs font-semibold focus:outline-none cursor-pointer appearance-none pr-6"
              >
                {offices.map(office => (
                  <option key={office.id} value={office.id}>
                    {office.name}
                  </option>
                ))}
              </select>
              <div className="absolute right-3 pointer-events-none text-slate-400">
                <ChevronRight size={14} className="rotate-90" />
              </div>
            </div>
          </div>
        )
      ) : (
        <div className="mb-6 flex justify-center">
          <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500" title="事業所">
            <Building2 size={16} />
          </div>
        </div>
      )}

      <nav className="flex flex-col gap-2 flex-1 overflow-hidden pr-0">
        {/* 検索バー */}
        <div className={`mb-4 px-1 transition-all duration-300 ${isExpanded ? 'opacity-100' : 'opacity-0 h-0 overflow-hidden mb-0'}`}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
            <input
              type="text"
              placeholder="児童を検索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-100/50 border border-slate-200 rounded-lg py-2 pl-9 pr-3 text-xs outline-none focus:border-primary/50 focus:bg-white transition-all"
            />
          </div>
        </div>

        {/* 児童一覧ラベル */}
        {isExpanded && (
          <div className="sidebar-text text-[11px] font-bold text-slate-400 mb-2 pl-4 uppercase tracking-wider">
            児童一覧
          </div>
        )}

        {/* 児童リスト */}
        <div className="flex-1 flex flex-col gap-1.5 overflow-y-auto gpu-accelerated">
          {filteredChildren.map(child => {
            const isSelected = selectedChildId === child.id;
            return (
              <NavLink
                key={child.id}
                to={`/children/${child.id}`}
                onClick={() => isExpanded && onToggle()} // 選択時に自動で閉じる
                className={() =>
                  `flex items-center rounded-xl transition-all duration-150 w-full text-left cursor-pointer relative gpu-accelerated ${isExpanded ? 'gap-3 p-2.5' : 'justify-center p-2.5'} ${
                    isSelected
                      ? 'bg-primary text-white shadow-lg shadow-primary/20'
                      : 'text-slate-700 hover:bg-black/5'
                  }`
                }
              >
                {/* アバター */}
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold flex-shrink-0 ${isSelected ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-500'}`}>
                  {child.imageKey || (child.fullName ? child.fullName[0] : '?')}
                </div>
                {/* 名前 */}
                <span className={`sidebar-text flex-1 text-sm font-medium transition-all duration-300 ${isExpanded ? 'opacity-100 w-auto' : 'opacity-0 w-0 overflow-hidden'} ${isSelected ? 'text-white' : 'text-slate-700'}`}>
                  {child.fullName || '(名前なし)'}
                </span>

                {/* 通知アラート */}
                {child.needsMonitoring && (
                  <div className={`flex items-center justify-center ${isExpanded ? 'mr-1' : 'absolute top-1 right-1'}`} title="モニタリング更新期（5ヶ月経過）">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
                    </span>
                  </div>
                )}

                {/* 矢印 */}
                {isExpanded && !child.needsMonitoring && (
                  <div className="sidebar-text flex-shrink-0">
                    <ChevronRight size={16} className={isSelected ? 'text-white' : 'text-slate-300'} />
                  </div>
                )}
              </NavLink>
            );
          })}
        </div>

        {/* 下部共通メニュー */}
        <div className="mt-auto pt-6 border-t border-green-500/15">
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `flex items-center rounded-lg transition-all duration-150 w-full text-left cursor-pointer font-medium ${isExpanded ? 'gap-3 p-3' : 'justify-center p-3'} ${
                isActive ? 'bg-primary/10 text-primary shadow-sm' : 'text-slate-700 hover:bg-black/5'
              }`
            }
          >
            <div className="flex-shrink-0 flex items-center justify-center">
              <SettingsIcon size={20} />
            </div>
            <span className={`sidebar-text text-[15px] transition-all duration-300 ${isExpanded ? 'opacity-100 w-auto' : 'opacity-0 w-0 overflow-hidden'}`}>設定</span>
          </NavLink>

          <button
            onClick={() => auth.signOut()}
            className={`flex items-center rounded-lg transition-all duration-150 w-full text-left cursor-pointer text-red-500 hover:bg-red-50 font-medium mt-1 ${isExpanded ? 'gap-3 p-3' : 'justify-center p-3'}`}
          >
            <div className="flex-shrink-0 flex items-center justify-center">
              <LogOut size={20} />
            </div>
            <span className={`sidebar-text text-[15px] transition-all duration-300 ${isExpanded ? 'opacity-100 w-auto' : 'opacity-0 w-0 overflow-hidden'}`}>ログアウト</span>
          </button>
        </div>
      </nav>

      {/* スタッフ情報 */}
      <div className={`mt-auto pt-4 border-t border-green-500/15 flex items-center overflow-hidden ${isExpanded ? 'gap-3' : 'justify-center'}`}>
        <div className="w-9 h-9 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0">
          <span className="text-[12px] font-bold text-slate-600">ST</span>
        </div>
        <div className={`sidebar-text overflow-hidden transition-all duration-300 ${isExpanded ? 'opacity-100 w-auto' : 'opacity-0 w-0'}`}>
          <p className="m-0 text-sm font-semibold truncate text-slate-800">スタッフ 太郎</p>
          <p className="m-0 text-[11px] text-slate-500">管理者</p>
        </div>
      </div>
    </aside>
  );
};
