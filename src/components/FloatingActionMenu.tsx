import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Menu, X } from 'lucide-react';

export type Action = {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  colorClass?: string;
  disabled?: boolean;
};

type FloatingActionMenuProps = {
  actions: Action[];
};

export const FloatingActionMenu: React.FC<FloatingActionMenuProps> = ({ actions }) => {
  const [isOpen, setIsOpen] = useState(false);

  const menu = (
    <div className="fixed bottom-24 md:bottom-8 right-6 flex flex-col items-end gap-4 z-[9999] print:hidden pointer-events-none">
      {/* メニューアイテム */}
      <div 
        className={`flex flex-col items-end gap-3 transition-all duration-300 ease-out transform pointer-events-none ${
          isOpen ? 'translate-y-0 opacity-100 scale-100' : 'translate-y-10 opacity-0 scale-90'
        }`}
      >
        {actions.map((action, i) => (
          <button
            key={i}
            onClick={() => {
              if (!action.disabled) {
                action.onClick();
                setIsOpen(false);
              }
            }}
            disabled={action.disabled}
            className={`flex items-center gap-3 px-5 py-3 rounded-2xl shadow-xl transition-all active:scale-95 border border-white/20 backdrop-blur-md pointer-events-auto ${
              action.disabled ? 'opacity-50 cursor-not-allowed' : ''
            } ${
              action.colorClass || 'bg-white/95 text-slate-700 hover:bg-slate-50'
            }`}
            style={{ transitionDelay: `${i * 40}ms` }}
          >
            <span className="text-[15px] font-bold tracking-tight">{action.label}</span>
            <div className="w-5 h-5 flex items-center justify-center">
              {action.icon}
            </div>
          </button>
        ))}
      </div>

      {/* メインのFABボタン */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-16 h-16 rounded-full flex items-center justify-center text-white shadow-2xl transition-all duration-300 active:scale-90 pointer-events-auto ${
          isOpen 
            ? 'bg-slate-800 rotate-45 shadow-slate-400/40' 
            : 'bg-primary shadow-primary/30'
        }`}
      >
        {isOpen ? (
          <X size={28} />
        ) : (
          <Menu size={28} />
        )}
      </button>

      {/* オーバーレイ（メニューが開いている時だけ） */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/5 -z-10 pointer-events-auto" 
          onClick={() => setIsOpen(false)}
        />
      )}
    </div>
  );

  return createPortal(menu, document.body);
};
