import React, { useState, useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import { Search, Users, ChevronRight, X } from 'lucide-react';
import type { Child } from '../data/mockData';

type MobileNavigationProps = {
  childrenData: Child[];
  isSheetOpen: boolean;
  onOpenChange: (open: boolean) => void;
};

export const MobileNavigation: React.FC<MobileNavigationProps> = ({ 
  childrenData, 
  isSheetOpen,
  onOpenChange
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  // 背面のロックは Layout.tsx の isLocked で一元管理するため、ここでは行わない

  // ひらがなをカタカナに変換するユーティリティ
  const toKatakana = (str: string) => {
    return str.replace(/[\u3041-\u3096]/g, (match) => {
      return String.fromCharCode(match.charCodeAt(0) + 0x60);
    });
  };

  // 検索フィルタ
  const filteredChildren = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    const qKana = toKatakana(q);

    return childrenData.filter(c => 
      c.fullName.toLowerCase().includes(q) || 
      c.fullName.toLowerCase().includes(qKana) ||
      c.nameKana?.toLowerCase().includes(q) ||
      c.nameKana?.toLowerCase().includes(qKana) ||
      c.schoolName?.toLowerCase().includes(q)
    ).slice(0, 5); // 最大5件表示
  }, [searchQuery, childrenData]);

  return (
    <div className="md:hidden print:hidden">
      {/* 背景オーバーレイ（検索結果表示時のみ） */}
      {searchQuery.trim() !== '' && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[98] transition-opacity duration-300"
          onClick={() => setSearchQuery('')}
        />
      )}

      {/* クイック検索結果ポップアップ */}
      {searchQuery.trim() !== '' && (
        <div className="fixed left-4 right-4 bottom-20 z-[101] bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/20 overflow-hidden animate-fade-in">
          <div className="p-3 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">検索結果</span>
            <button onClick={() => setSearchQuery('')} className="p-1 text-slate-400"><X size={14} /></button>
          </div>
          <div className="max-h-[300px] overflow-y-auto">
            {filteredChildren.length > 0 ? (
              filteredChildren.map(child => (
                <NavLink
                  key={child.id}
                  to={`/children/${child.id}`}
                  onClick={() => setSearchQuery('')}
                  className="flex items-center gap-3 p-3 border-b border-slate-50 active:bg-slate-100 transition-colors gpu-accelerated"
                >
                  <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">
                    {child.imageKey || (child.fullName ? child.fullName[0] : '?')}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-slate-800">{child.fullName}</p>
                    <p className="text-[10px] text-slate-400">{child.schoolName}</p>
                  </div>
                  <ChevronRight size={14} className="text-slate-300" />
                </NavLink>
              ))
            ) : (
              <div className="p-8 text-center text-slate-400 text-sm">見つかりませんでした</div>
            )}
          </div>
        </div>
      )}

      {/* 常設ボトムバー: [検索バー] [一覧ボタン] */}
      <div className="fixed left-0 right-0 bottom-0 z-[100] h-18 bg-white/85 backdrop-blur-2xl border-t border-white/20 shadow-[0_-8px_30px_rgba(0,0,0,0.1)] px-4 flex items-center gap-3">
        {/* 検索入力バー */}
        <div className="flex-1 relative group">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors">
            <Search size={18} />
          </div>
          <input
            type="text"
            placeholder="こどもを検索..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-12 pl-10 pr-4 bg-slate-100/80 border-none rounded-2xl outline-none text-base text-slate-800 placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-primary/10 transition-all"
          />
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-300 hover:text-slate-500"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* 一覧ボタン: 左側のドロワーを開くように変更 */}
        <button
          onClick={() => onOpenChange(!isSheetOpen)}
          className={`shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-300 ${
            isSheetOpen ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'bg-slate-100 text-slate-500 active:scale-95'
          }`}
        >
          <Users size={24} />
        </button>
      </div>
    </div>
  );
};

