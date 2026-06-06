import React from 'react';
import { Bell, Search, Users } from 'lucide-react';

type HeaderProps = {
  title: string;
  onOpenDrawer: () => void;
};

export const Header: React.FC<HeaderProps> = ({ title, onOpenDrawer }) => {
  return (
    <header className="h-[70px] shrink-0 flex items-center justify-between px-6 md:px-8 border-b border-green-500/10 bg-white/70 backdrop-blur-xl z-30 print:hidden">
      <div className="flex items-center gap-4">
        <h2 className="text-lg md:text-xl font-black tracking-tight text-slate-800 truncate max-w-[200px] md:max-w-none">
          {title}
        </h2>
      </div>

      <div className="flex items-center gap-2 md:gap-4">
        <span className="text-[9px] md:text-[10px] text-slate-400 font-bold bg-slate-100 px-2 py-1 rounded border border-slate-200/60 select-none print:hidden">
          v2026/06/05 13:51
        </span>
        <div className="hidden md:flex relative items-center bg-slate-100/50 rounded-full px-4 py-2 border border-slate-200 focus-within:ring-2 focus-within:ring-primary/20 transition-all group w-64">
          <Search size={16} className="text-slate-400 mr-2 group-focus-within:text-primary transition-colors" />
          <input 
            type="text" 
            placeholder="こどもを検索..." 
            className="border-none bg-transparent outline-none w-full text-sm text-slate-700 placeholder-slate-400"
          />
        </div>

        <div className="flex items-center">
          <button className="relative w-10 h-10 flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 transition-all">
            <Bell size={20} />
            <span className="absolute top-2.5 right-2.5 w-2 h-2 bg-red-500 rounded-full border-2 border-white"></span>
          </button>
          
          <button 
            onClick={onOpenDrawer}
            className="w-10 h-10 flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 transition-all md:hidden"
          >
            <Users size={20} />
          </button>
        </div>
      </div>
    </header>
  );
};
