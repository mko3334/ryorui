import React from 'react';
import { useNavigate } from 'react-router-dom';
import { X, User, ChevronRight, Settings, LogOut, Building2 } from 'lucide-react';
import { auth } from '../lib/firebase';
import { motion, AnimatePresence } from 'framer-motion';
import type { Child } from '../data/mockData';

type ChildDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  childrenData: Child[];
  selectedChildId: string | null;
  selectedOfficeId: string;
  offices: { id: string, name: string }[];
  onOfficeChange: (id: string) => void;
};

export const ChildDrawer: React.FC<ChildDrawerProps> = ({
  isOpen,
  onClose,
  childrenData,
  selectedChildId,
  selectedOfficeId,
  offices,
  onOfficeChange,
}) => {
  const DRAWER_WIDTH = 320;
  const navigate = useNavigate();

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* オーバーレイ（モバイルのみ） */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[150] md:hidden"
          />

          {/* ドロワー本体（モバイルのみ） */}
          <motion.aside
            initial={{ x: -DRAWER_WIDTH }}
            animate={{ x: 0 }}
            exit={{ x: -DRAWER_WIDTH }}
            transition={{ type: "spring", damping: 25, stiffness: 220 }}
            className="fixed top-0 left-0 bottom-0 bg-white/95 backdrop-blur-2xl shadow-2xl z-[160] border-r border-slate-200 md:hidden flex flex-col"
            style={{ width: DRAWER_WIDTH }}
          >
            {/* ヘッダー */}
            <div className="p-6 border-b border-slate-100 flex items-center justify-between shrink-0">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <User size={20} className="text-primary" />
                児童を選択
              </h3>
              <button
                onClick={onClose}
                className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 transition-colors"
              >
                <X size={24} />
              </button>
            </div>

            {/* 事業所選択プルダウン（モバイル） */}
            {offices.length > 0 && (
              <div className="px-6 py-3 bg-slate-50 border-b border-slate-100 shrink-0">
                <div className="relative flex items-center bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-700 hover:border-primary/40 focus-within:border-primary/50 transition-all shadow-sm">
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
            )}

            {/* 検索・フィルター（オプション） */}
            <div className="p-4 bg-slate-50/50 shrink-0">
               <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest px-2">
                  登録児童 ({childrenData.length}名)
               </p>
            </div>

            {/* リスト */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2 no-scrollbar touch-pan-y pointer-events-auto">
              {childrenData.map((child) => {
                const isSelected = selectedChildId === child.id;
                return (
                  <button
                    key={child.id}
                    onClick={() => {
                      onClose();
                      navigate(`/children/${child.id}`);
                    }}
                    className={`w-full flex items-center gap-4 p-4 rounded-2xl transition-all duration-200 group text-left relative ${
                      isSelected
                        ? 'bg-primary text-white shadow-lg shadow-primary/20'
                        : 'bg-white hover:bg-slate-50 border border-slate-100 shadow-sm'
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 transition-transform group-hover:scale-110 ${
                      isSelected ? 'bg-white/20 text-white' : 'bg-primary/10 text-primary'
                    }`}>
                      {child.imageKey || (child.fullName ? child.fullName[0] : '?')}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={`text-sm font-bold truncate ${isSelected ? 'text-white' : 'text-slate-800'}`}>
                          {child.fullName}
                        </p>
                        {child.needsMonitoring && (
                          <span className="relative flex h-2 w-2 shrink-0" title="モニタリング更新期（5ヶ月経過）">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                          </span>
                        )}
                      </div>
                      <p className={`text-[11px] truncate ${isSelected ? 'text-white/70' : 'text-slate-400'}`}>
                        {child.schoolName} / {child.grade}
                      </p>
                    </div>
                    <ChevronRight size={16} className={isSelected ? 'text-white' : 'text-slate-300'} />
                  </button>
                );
              })}
            </div>

            {/* フッターメニュー */}
            <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex flex-col gap-2 shrink-0">
              <button
                onClick={() => {
                  onClose();
                  navigate('/settings');
                }}
                className={`flex items-center gap-3 p-3 rounded-xl font-bold text-sm shadow-sm transition-all text-left w-full ${
                  window.location.pathname === '/settings' ? 'bg-primary text-white' : 'bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                <Settings size={18} /> 
                <span>設定</span>
              </button>
              <button
                onClick={() => auth.signOut()}
                className="flex items-center gap-3 p-3 rounded-xl bg-red-50 text-red-500 hover:bg-red-100 font-bold text-sm shadow-sm transition-all"
              >
                <LogOut size={18} /> 
                <span>ログアウト</span>
              </button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
};
