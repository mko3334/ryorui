import React from 'react';
import { ArrowLeft } from 'lucide-react';

export const ChildList: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] animate-fade-in">
      <div className="glass-panel p-12 flex flex-col items-center gap-6 max-w-md text-center">
        <div className="w-20 h-20 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-2">
          <ArrowLeft size={40} className="animate-pulse-slow" />
        </div>
        <h2 className="text-2xl font-bold text-slate-800">児童を選択してください</h2>
        <p className="text-slate-500 leading-relaxed">
          左側のメニューから児童を選択して、<br />
          書類の作成や確認を始めてください。
        </p>
      </div>
    </div>
  );
};

