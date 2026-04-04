import React from 'react';
import { Bell, Search } from 'lucide-react';

type HeaderProps = {
  title: string;
};

export const Header: React.FC<HeaderProps> = ({ title }) => {
  return (
    <header className="h-[70px] shrink-0 flex items-center justify-between px-8 border-b border-green-500/15 bg-white/60 backdrop-blur-md z-10">
      <h2 className="text-xl font-bold tracking-tight text-slate-800">{title}</h2>

      <div className="flex items-center gap-4">
        <div className="relative flex items-center bg-white/80 rounded-full px-4 py-1.5 border border-green-500/15 focus-within:ring-2 focus-within:ring-primary/20 transition-all group">
          <Search size={16} className="text-slate-400 mr-2 group-focus-within:text-primary transition-colors" />
          <input 
            type="text" 
            placeholder="こどもを検索..." 
            className="border-none bg-transparent outline-none w-48 text-sm text-slate-700 placeholder-slate-400"
          />
        </div>

        <button className="relative w-10 h-10 flex items-center justify-center rounded-full text-slate-500 hover:bg-black/5 hover:text-slate-800 transition-all">
          <Bell size={20} />
          {/* 通知バッジ */}
          <span className="absolute top-2 right-2.5 w-2 h-2 bg-red-500 rounded-full border border-white"></span>
        </button>
      </div>
    </header>
  );
};
