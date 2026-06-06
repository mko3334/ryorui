import React, { useRef, useEffect } from 'react';
import { 
  Archive, 
  ArchiveRestore, 
  RefreshCw, 
  Check, 
  Pencil,
  Sparkles
} from 'lucide-react';
import type { DailyReport } from '../types/supportPlan';

const SUPPORT_CONTENT_OPTIONS = [
  '①認知・行動',
  '②運動・感覚',
  '③言語・コミュニケーション',
  '④健康・生活',
  '⑤人間関係・社会性'
];

export const SupportImplementationRow = React.memo(({ 
  row, idx, isNewsletterCollapsed, isEditingDate, onEditDate, onFinishEditDate,
  updateRowDate, toggleSupportContent, updateRowContent, handleSyncFromNewsletter, archiveRow, newsletters,
  isSelectionMode, isSelected, onToggleSelect, onSingleAiConvert
}: {
  row: DailyReport;
  idx: number;
  isNewsletterCollapsed: boolean;
  isEditingDate: boolean;
  onEditDate: () => void;
  onFinishEditDate: () => void;
  updateRowDate: (idx: number, field: 'month' | 'day', val: string) => void;
  toggleSupportContent: (idx: number, content: string) => void;
  updateRowContent: (idx: number, field: keyof DailyReport['content'], val: any) => void;
  handleSyncFromNewsletter: (idx: number, dateStr: string) => void;
  archiveRow: (idx: number) => void;
  newsletters: Record<string, string>;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  onSingleAiConvert: (idx: number) => void;
}) => {
  const resultRef = useRef<HTMLTextAreaElement>(null);
  const futureRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (resultRef.current) {
      resultRef.current.style.height = 'auto';
      resultRef.current.style.height = `${resultRef.current.scrollHeight}px`;
    }
  }, [row.content.resultInfo]);

  useEffect(() => {
    if (futureRef.current) {
      futureRef.current.style.height = 'auto';
      futureRef.current.style.height = `${futureRef.current.scrollHeight}px`;
    }
  }, [row.content.futurePlan]);

  // textareaの上でスクロール（ホイール）したときに、親のメインコンテナをスクロールさせるヘルパー
  const handleTextAreaWheel = (e: React.WheelEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    // 内部スクロールが不要な場合（自動リサイズされているため常に不要）
    if (el.scrollHeight <= el.clientHeight) {
      const container = el.closest('.overflow-y-auto');
      if (container) {
        container.scrollTop += e.deltaY;
      }
    }
  };

  return (
    <div
      className={`border-b border-slate-300 ${row.archived ? 'opacity-40 bg-slate-100 print:hidden' : 'print:table-row'}
      flex flex-col gap-4 p-4 md:table-row md:p-0 print:p-0 relative ${isSelected ? 'bg-primary/5 border-l-4 border-l-primary' : ''}`}
      style={{ touchAction: 'pan-y' }}
    >
      
      {/* 選択チェックボックス */}
      {isSelectionMode && (
        <div className="p-0 md:p-4 border-r border-slate-300 w-full md:w-[50px] flex items-center justify-center md:table-cell print:hidden bg-primary/5">
          <input 
            type="checkbox" 
            checked={isSelected} 
            onChange={onToggleSelect}
            className="w-6 h-6 md:w-5 md:h-5 rounded-lg border-2 border-primary text-primary focus:ring-primary transition-all cursor-pointer"
          />
        </div>
      )}

      {/* モバイル用アーカイブボタン */}
      <div className="absolute top-4 right-4 md:hidden print:hidden z-10">
        <button onClick={() => archiveRow(idx)} className="text-slate-400 p-2 bg-white rounded-full shadow-sm border border-slate-100">
          {row.archived ? <ArchiveRestore size={18} /> : <Archive size={18} />}
        </button>
      </div>

      {/* 日付 */}
      <div
        className="p-0 md:p-2 border-r border-slate-300 w-full md:w-[70px] bg-slate-50/50 md:bg-transparent rounded-xl md:rounded-none print:rounded-none flex flex-col md:table-cell print:table-cell"
        style={{ touchAction: 'pan-y' }}
      >
        <div className="md:hidden print:hidden text-[11px] font-bold text-slate-500 bg-slate-200/50 px-3 py-1.5 border-b border-slate-200">日付</div>
        <div className="p-3 md:p-0">
          {isEditingDate ? (
            <div className="flex flex-col items-center gap-2">
              <div className="flex items-center gap-1 justify-center">
                <input
                  type="number"
                  className="w-12 h-10 text-center font-bold outline-none bg-white border border-slate-300 rounded-lg text-lg"
                  style={{ touchAction: 'pan-y' }}
                  value={row.date.match(/(\d+)月/)?.[1] || ''}
                  onChange={e => updateRowDate(idx, 'month', e.target.value)}
                />
                <span className="text-slate-400 font-bold">/</span>
                <input
                  type="number"
                  className="w-12 h-10 text-center font-bold outline-none bg-white border border-slate-300 rounded-lg text-lg"
                  style={{ touchAction: 'pan-y' }}
                  value={row.date.match(/(\d+)日/)?.[1] || ''}
                  onChange={e => updateRowDate(idx, 'day', e.target.value)}
                />
              </div>
              <button
                onClick={onFinishEditDate}
                className="flex items-center gap-2 text-xs text-primary font-bold bg-primary/10 hover:bg-primary/20 rounded-full px-4 py-1.5"
              >
                <Check size={14} /> 完了
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center md:items-start gap-2 group">
              <span className="font-bold text-lg md:text-sm print:text-[10px] text-slate-800">
                {row.date || '─'}
              </span>
              {!row.archived && (
                <button
                  onClick={onEditDate}
                  className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-primary md:opacity-0 md:group-hover:opacity-100 transition-opacity bg-white px-3 py-1 rounded-full border border-slate-100 shadow-sm md:shadow-none md:border-0 md:bg-transparent print:hidden"
                >
                  <Pencil size={12} /> 編集
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ツリー通信 */}
      <div
        className={`p-0 md:p-3 border-r border-slate-300 align-top relative group w-full transition-all duration-300
          ${isNewsletterCollapsed ? 'md:w-[50px] md:min-w-[50px]' : ''}
          bg-white border-2 border-primary/20 shadow-md md:border-0 md:bg-primary/5 md:shadow-none rounded-xl md:rounded-none flex flex-col md:table-cell print:hidden`}
        style={{ touchAction: 'pan-y' }}
      >
        
        <div className="md:hidden print:hidden text-[11px] font-bold text-primary bg-primary/5 px-3 py-1.5 border-b border-primary/10">ツリー通信</div>
        
        <div className="p-4 md:p-0">
          {!isNewsletterCollapsed ? (
            <>
              <div className="text-sm md:text-[12px] whitespace-pre-wrap overflow-visible pr-1 text-slate-700 leading-relaxed">
                {(newsletters[row.date] || row.content.externalInfo || '---').trim()}
              </div>
              {!row.archived && (
                <button onClick={() => handleSyncFromNewsletter(idx, row.date)} className="absolute right-2 top-14 md:top-1 p-2 rounded-full bg-primary text-white shadow-lg md:shadow-none md:bg-primary/10 md:text-primary md:opacity-0 md:group-hover:opacity-100 transition-all">
                  <RefreshCw size={14} />
                </button>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center gap-2 py-4 md:py-0">
              <div className="w-full h-1.5 md:w-1 md:h-12 bg-primary/20 rounded-full" />
            </div>
          )}
        </div>
      </div>

      {/* 療育内容 */}
      <div
        className="p-0 md:p-1 border-r border-slate-300 align-top w-full md:w-[170px] bg-slate-50/50 md:bg-transparent rounded-xl md:rounded-none print:rounded-none flex flex-col md:table-cell print:table-cell"
        style={{ touchAction: 'pan-y' }}
      >
        <div className="md:hidden print:hidden text-[11px] font-bold text-slate-500 bg-slate-200/50 px-3 py-1.5 border-b border-slate-200">療育内容</div>
        <div className="p-3 md:p-1 flex flex-col gap-2 print:hidden">
          <div className="flex flex-wrap md:flex-col gap-1.5">
            {SUPPORT_CONTENT_OPTIONS.map((opt: string) => {
              const sel = row.content.supportContent?.includes(opt);
              return (
                <button
                  key={opt}
                  onClick={() => toggleSupportContent(idx, opt)}
                  className={`text-[10px] text-left px-3 py-2 md:py-1 rounded-lg transition-colors flex-1 md:flex-none whitespace-nowrap md:whitespace-normal border ${
                    sel
                      ? 'bg-primary text-white font-bold border-primary shadow-sm'
                      : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50 md:bg-slate-100 md:border-0'
                  }`}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </div>
        <div className="hidden print:flex flex-col gap-0.5 p-1">
          {(row.content.supportContent || []).map((opt: string) => (
            <div key={opt} className="text-[8pt] leading-tight font-medium border-l-2 border-primary pl-1">
              {opt}
            </div>
          ))}
        </div>
      </div>

      {/* 療育を行った結果 */}
      <div
        className={`p-0 md:p-3 border-r border-slate-300 relative group/result w-full transition-colors duration-300 rounded-xl md:rounded-none print:rounded-none flex flex-col md:table-cell print:table-cell
          ${row.content.isVerified ? 'bg-emerald-50/50' : 'bg-slate-50/30 md:bg-transparent border border-slate-200 md:border-0 shadow-sm md:shadow-none'}`}
        style={{ touchAction: 'pan-y' }}
      >
        
        <div className="md:hidden print:hidden text-[11px] font-bold text-slate-500 bg-slate-200/50 px-3 py-1.5 border-b border-slate-200">療育を行った結果</div>
        
        <div className="p-4 md:p-1">
          <textarea
            ref={resultRef}
            className="w-full text-sm md:text-sm min-h-[80px] md:min-h-[100px] outline-none bg-transparent resize-none print:hidden pb-10 overflow-y-hidden leading-relaxed"
            style={{ touchAction: 'pan-y' }}
            value={row.content.resultInfo}
            placeholder="結果を入力してください..."
            onWheel={handleTextAreaWheel}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${el.scrollHeight}px`;
            }}
            onChange={e => {
              updateRowContent(idx, 'resultInfo', e.target.value);
              if (row.content.isVerified) updateRowContent(idx, 'isVerified', false);
            }}
          />
          <div className="absolute bottom-3 left-4 md:bottom-1 md:left-2 flex items-center gap-2 print:hidden">
            <button
              onClick={() => updateRowContent(idx, 'isVerified', !row.content.isVerified)}
              className={`flex items-center gap-1.5 px-4 py-1.5 md:px-2 md:py-0.5 rounded-full text-xs md:text-[10px] font-bold transition-all duration-200 shadow-md md:shadow-sm ${
                row.content.isVerified
                  ? 'bg-emerald-500 text-white'
                  : 'bg-white text-slate-400 hover:bg-slate-200 border border-slate-200 md:border-0'
              }`}
            >
              {row.content.isVerified ? <Check size={14} /> : null}
              {row.content.isVerified ? '済み' : '確認'}
            </button>
            {row.content.externalInfo?.trim() && (
              <button
                onClick={() => onSingleAiConvert(idx)}
                className="flex items-center gap-1 px-4 py-1.5 md:px-2 md:py-0.5 rounded-full text-xs md:text-[10px] font-bold bg-violet-50 hover:bg-violet-100 text-violet-700 border border-violet-200 transition-all shadow-md md:shadow-sm"
                title="この行のツリー通信をAIで変換"
              >
                <Sparkles size={12} className="text-violet-600 animate-pulse" />
                <span>AI変換</span>
              </button>
            )}
          </div>
          <div className={`absolute bottom-3 right-4 md:bottom-1 md:right-2 text-[10px] md:text-[8px] font-bold transition-all duration-200 print:hidden pointer-events-none
            ${(row.content.resultInfo?.length || 0) > 130
              ? 'text-red-500 opacity-100'
              : 'text-slate-400 opacity-0 group-focus-within/result:opacity-100'}`}>
            {(row.content.resultInfo?.length || 0)}/130
          </div>
          <div className="hidden print:block print:text-[9pt] print:leading-snug whitespace-pre-wrap break-words">{row.content.resultInfo}</div>
        </div>
      </div>

      {/* 今後の予定 */}
      <div
        className="p-0 md:p-3 border-r border-slate-300 relative group/plan w-full rounded-xl md:rounded-none print:rounded-none bg-slate-50/30 md:bg-transparent border border-slate-200 md:border-0 shadow-sm md:shadow-none flex flex-col md:table-cell print:table-cell"
        style={{ touchAction: 'pan-y' }}
      >
        <div className="md:hidden print:hidden text-[11px] font-bold text-slate-500 bg-slate-200/50 px-3 py-1.5 border-b border-slate-200">今後の予定</div>
        <div className="p-4 md:p-1">
          <textarea
            ref={futureRef}
            className="w-full text-sm md:text-sm min-h-[60px] md:min-h-[80px] outline-none bg-transparent resize-none print:hidden pb-10 overflow-y-hidden leading-relaxed"
            style={{ touchAction: 'pan-y' }}
            value={row.content.futurePlan}
            placeholder="今後の予定を入力してください..."
            onWheel={handleTextAreaWheel}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${el.scrollHeight}px`;
            }}
            onChange={e => updateRowContent(idx, 'futurePlan', e.target.value)}
          />
          <div className={`absolute bottom-3 right-4 md:bottom-1 md:right-2 text-[10px] md:text-[8px] font-bold transition-all duration-200 print:hidden pointer-events-none
            ${(row.content.futurePlan?.length || 0) > 80
              ? 'text-red-500 opacity-100'
              : 'text-slate-400 opacity-0 group-focus-within/plan:opacity-100'}`}>
            {(row.content.futurePlan?.length || 0)}/80
          </div>
          <div className="hidden print:block print:text-[9pt] print:leading-snug whitespace-pre-wrap break-words">{row.content.futurePlan}</div>
        </div>
      </div>

      {/* PC用アーカイブ列（モバイル・印刷時は非表示） */}
      <div className={`hidden md:table-cell p-1 md:p-2 text-center z-10 border-l border-slate-300 print:hidden ${row.archived ? 'bg-slate-50' : 'bg-white'} w-[50px] md:w-[60px]`}>
        <button onClick={() => archiveRow(idx)} className="text-slate-400 hover:text-primary transition-colors active:scale-90" title={row.archived ? '元に戻す' : 'アーカイブ'}>
          {row.archived ? <ArchiveRestore size={18} /> : <Archive size={18} />}
        </button>
      </div>
    </div>
  );
});
