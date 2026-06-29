import React from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { FileText, BrainCircuit, ShieldAlert, ArrowLeft, User, School, Star } from 'lucide-react';
import type { Child } from '../data/mockData';

type ChildDashboardProps = {
  childrenData: Child[];
};

type DocCard = {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  path: string;
  available: boolean;
  color: string;
  alertMessage?: string;
};

export const ChildDashboard: React.FC<ChildDashboardProps> = ({ childrenData }) => {
  const { childId } = useParams<{ childId: string }>();
  const navigate = useNavigate();

  const selectedChild = childrenData.find(c => c.id === childId) ?? null;

  if (!selectedChild) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 glass-panel">
        <p className="text-slate-500 font-medium italic">児童が見つかりません（ID: {childId}）</p>
        <button className="btn-primary" onClick={() => navigate('/')}>一覧へ戻る</button>
      </div>
    );
  }

  const currentMonth = new Date().toISOString().slice(0, 7);
  const isExpiring = selectedChild.currentPlanEndMonth === currentMonth;

  const docCards: DocCard[] = [
    {
      id: 'professional-perspective',
      title: '専門的支援計画書',
      description: '児童の発達段階や支援方針を専門的な視点から記録します。中長期の支援計画の基磤となる文書です。',
      icon: <BrainCircuit size={28} />,
      path: `/children/${childId}/professional-perspective`,
      available: true,
      color: 'from-violet-500 to-purple-600',
      alertMessage: isExpiring ? '更新期日が1か月を切りました' : undefined,
    },
    {
      id: 'support-plan',
      title: '専門的支援実施計画',
      description: '月次の支援目標・実施内容・結果・今後の計画を記録します。ツリー通信との連携機能あり。',
      icon: <FileText size={28} />,
      path: `/children/${childId}/support-plan/${currentMonth}`,
      available: true,
      color: 'from-emerald-500 to-teal-600',
      alertMessage: isExpiring ? '更新期日が1か月を切りました' : undefined,
    },
    {
      id: 'force-sheet',
      title: '強行シート',
      description: '特定の支援方钕や注意事項、緊急時対応など重点事項をまとめます。',
      icon: <ShieldAlert size={28} />,
      path: `/children/${childId}/force-sheet`,
      available: false,
      color: 'from-orange-500 to-red-500',
    },
  ];

  const initials = selectedChild.imageKey || (selectedChild.fullName ? selectedChild.fullName[0] : '?');

  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-10 animate-fade-in pb-20">
      {/* 戻るボタン */}
      <button
        onClick={() => navigate('/')}
        className="self-start flex items-center gap-2 text-slate-500 hover:text-slate-800 font-medium transition-colors"
      >
        <ArrowLeft size={18} /> 一覧へ戻る
      </button>

      {/* 児童プロフィールカード */}
      <div className="glass-panel p-8 flex items-center gap-8">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary to-teal-500 text-white flex items-center justify-center text-3xl font-bold shadow-lg shadow-primary/30 flex-shrink-0">
          {initials}
        </div>
        <div className="flex-1">
          <div className="flex items-baseline gap-3 mb-1">
            <h2 className="text-3xl font-black text-slate-800">{selectedChild.fullName}</h2>
            <span className="text-slate-400 text-base font-medium">{selectedChild.nameKana}</span>
          </div>
          <div className="flex items-center gap-6 text-slate-500 text-sm mt-2">
            <span className="flex items-center gap-1.5"><School size={14} className="text-primary" />{selectedChild.schoolName}</span>
            <span className="flex items-center gap-1.5"><User size={14} className="text-primary" />{selectedChild.grade}</span>
          </div>
          {(selectedChild.features ?? []).length > 0 && (
            <div className="flex gap-1.5 flex-wrap mt-4">
              {(selectedChild.features ?? []).map((f: string) => (
                <span key={f} className="flex items-center gap-1 px-2.5 py-1 bg-primary/10 text-primary rounded-full text-[12px] font-semibold">
                  <Star size={10} fill="currentColor" />{f}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 書類選択グリッド */}
      <div>
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-5 pl-1">
          書類を選択してください
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {docCards.map(card => (
            <DocCardItem key={card.id} card={card} />
          ))}
        </div>
      </div>
    </div>
  );
};

// ---- 書類カードコンポーネント ----
function DocCardItem({ card }: { card: DocCard }) {
  const content = (
    <div
      className={`relative group glass-panel p-7 flex flex-col gap-5 transition-all duration-300 ${
        card.available
          ? 'cursor-pointer hover:shadow-xl hover:-translate-y-1'
          : 'opacity-75 cursor-default'
      }`}
    >
      {/* 開発中バッジ */}
      {!card.available && (
        <span className="absolute top-4 right-4 px-2.5 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-bold rounded-full uppercase tracking-wider">
          開発中
        </span>
      )}
      
      {/* アラートバッジ */}
      {card.available && card.alertMessage && (
        <span className="absolute top-4 right-4 flex items-center gap-1 px-2.5 py-1 bg-red-100 text-red-600 text-[10px] font-bold rounded-full shadow-sm">
          <ShieldAlert size={12} /> {card.alertMessage}
        </span>
      )}

      {/* アイコン */}
      <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${card.color} text-white flex items-center justify-center shadow-lg transition-transform duration-300 group-hover:scale-110`}>
        {card.icon}
      </div>

      {/* テキスト */}
      <div className="flex flex-col gap-2">
        <h4 className="text-base font-bold text-slate-800 leading-snug">{card.title}</h4>
        <p className="text-sm text-slate-500 leading-relaxed">{card.description}</p>
      </div>

      {/* 矢印インジケーター */}
      {card.available && (
        <div className="mt-auto pt-2 flex items-center gap-1 text-primary text-sm font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
          開く →
        </div>
      )}
    </div>
  );

  if (!card.available) {
    return content;
  }

  return (
    <Link to={card.path} className="no-underline block">
      {content}
    </Link>
  );
}
