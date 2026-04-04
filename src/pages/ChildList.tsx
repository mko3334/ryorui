import React, { useState } from 'react';
import { Search, Filter, Phone, MoreVertical } from 'lucide-react';
import { mockChildrenData } from '../data/mockData';

type ChildListProps = {
  onSelectChild: (id: string) => void;
  onNewChild: () => void;
};

export const ChildList: React.FC<ChildListProps> = ({ onSelectChild, onNewChild }) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredChildren = mockChildrenData.filter(child => 
    child.fullName.includes(searchTerm) || child.nameKana.includes(searchTerm)
  );

  return (
    <div className="flex flex-col gap-8">
      {/* ツールバー */}
      <div className="flex items-center justify-between gap-6">
        <div className="flex items-center gap-3 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 focus-within:text-primary transition-colors" />
            <input 
              type="text" 
              placeholder="名前で検索..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-2 bg-white border border-green-500/15 rounded-lg outline-none focus:ring-2 focus:ring-primary/20 transition-all w-full text-sm"
            />
          </div>
          <button className="w-10 h-10 flex items-center justify-center border border-green-500/15 bg-white rounded-lg text-slate-500 hover:bg-black/5 hover:text-slate-800 transition-all">
            <Filter size={18} />
          </button>
        </div>
        
        <button className="btn-primary" onClick={onNewChild}>
          新規登録
        </button>
      </div>

      {/* グリッドビュー */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {filteredChildren.map(child => (
          <div 
            key={child.id} 
            className="glass-panel p-6 cursor-pointer relative hover:shadow-lg transition-all group"
            onClick={() => onSelectChild(child.id)}
          >
            <button 
              className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-black/5 hover:text-slate-700 transition-all"
              onClick={(e) => { e.stopPropagation(); }}
            >
              <MoreVertical size={16} />
            </button>
            
            <div className="flex flex-col items-center mb-4">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary to-violet-500 text-white flex items-center justify-center text-xl font-bold mb-4 shadow-lg shadow-primary/30">
                {child.imageKey}
              </div>
              <h3 className="text-lg font-bold text-slate-800 mb-1">{child.fullName}</h3>
              <p className="text-sm text-slate-500">{child.grade} / {child.schoolName}</p>
            </div>

            <div className="flex gap-1.5 flex-wrap mt-4 justify-center">
              {child.features.map(f => (
                <span key={f} className="px-2 py-0.5 bg-black/5 text-slate-500 rounded text-[11px] font-medium leading-relaxed">
                  {f}
                </span>
              ))}
            </div>

            <div className="flex border-t border-green-500/15 mt-6 pt-4">
              <button 
                className="flex-1 flex items-center justify-center gap-2 text-slate-500 hover:text-slate-800 transition-colors py-2 text-sm"
                onClick={(e) => e.stopPropagation()}
              >
                <Phone size={14} /> 連絡
              </button>
              <div className="w-px bg-green-500/15"></div>
              <button 
                className="flex-1 flex items-center justify-center gap-2 text-primary hover:text-primary-hover font-semibold transition-colors py-2 text-sm"
                onClick={() => onSelectChild(child.id)}
              >
                編集・詳細
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
