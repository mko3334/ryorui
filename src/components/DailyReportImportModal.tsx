import React, { useState, useRef } from 'react';
import { X, FileSpreadsheet, AlertCircle, Check, Upload } from 'lucide-react';
import * as XLSX from 'xlsx';
import type { DailyReport } from '../types/supportPlan';

type DailyReportImportModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onImport: (rows: DailyReport[]) => void;
  currentMonth: string; // "YYYY-MM"
  childId: string;
};

export const DailyReportImportModal: React.FC<DailyReportImportModalProps> = ({
  isOpen,
  onClose,
  onImport,
  currentMonth,
  childId
}) => {
  const [parsedRows, setParsedRows] = useState<DailyReport[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<'upload' | 'preview'>('upload');
  
  // SheetJS関連
  const [parsedSheetsCount, setParsedSheetsCount] = useState(0);
  const [fileName, setFileName] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processFile(file);
  };

  const parseMonthFromSheetName = (sheetName: string, defaultYear: string): string | null => {
    const cleanName = sheetName.replace(/[\s　]+/g, '');
    if (cleanName === '原本' || cleanName.includes('原本')) return null;

    // 1) "YYYY-MM" または "YYYYMM"
    const yyyymmMatch = cleanName.match(/^(\d{4})[-_/]?(\d{2})$/);
    if (yyyymmMatch) {
      return `${yyyymmMatch[1]}-${yyyymmMatch[2].padStart(2, '0')}`;
    }

    // 2) "YYYY年MM月"
    const yyyymmKanjiMatch = cleanName.match(/^(\d{4})年(\d{1,2})月$/);
    if (yyyymmKanjiMatch) {
      return `${yyyymmKanjiMatch[1]}-${yyyymmKanjiMatch[2].padStart(2, '0')}`;
    }

    // 3) "MM月"
    const mmKanjiMatch = cleanName.match(/^(\d{1,2})月$/);
    if (mmKanjiMatch) {
      return `${defaultYear}-${mmKanjiMatch[1].padStart(2, '0')}`;
    }

    // 4) "MM" (単一の数値で、1〜12の範囲内)
    const num = parseInt(cleanName, 10);
    if (!isNaN(num) && num >= 1 && num <= 12) {
      return `${defaultYear}-${num.toString().padStart(2, '0')}`;
    }

    return null; // 月として解釈できないシートはスキップ
  };

  const processFile = (file: File) => {
    setFileName(file.name);
    setError(null);
    
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        
        parseAllSheets(wb);
      } catch (err: any) {
        console.error(err);
        setError('Excelファイルの解析に失敗しました。ファイルが破損しているか、非対応の形式です。');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const parseAllSheets = (wb: XLSX.WorkBook) => {
    try {
      const defaultYear = currentMonth.split('-')[0] || new Date().getFullYear().toString();
      const validSheets = wb.SheetNames.filter(name => parseMonthFromSheetName(name, defaultYear) !== null);

      if (validSheets.length === 0) {
        throw new Error('「原本」以外に有効な月別シートが見つかりませんでした。「2026-05」や「5月」などの正しいシート名であることを確認してください。');
      }

      setParsedSheetsCount(validSheets.length);
      const tempRows: DailyReport[] = [];

      const futureKeywords = [
        'いく', 'ていく', 'にしていく', '促していく', '支援していく', '指導していく', 
        '見守っていく', '取り組んでいく', '予定', '今後も', '今後の', '支援する', 
        '促す', '見守る', 'アプローチ', '働きかけ'
      ];

      validSheets.forEach(sheetName => {
        const targetMonth = parseMonthFromSheetName(sheetName, defaultYear) || currentMonth;
        const [, monthStr] = targetMonth.split('-');
        const monthNum = parseInt(monthStr, 10);

        const sheet = wb.Sheets[sheetName];
        if (!sheet) return;

        // シートを2次元のグリッド配列に変換
        const grid = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });
        
        let headerRowIdx = -1;
        let dateIdx = -1;
        let supportIdx = -1;
        let resultIdx = -1;
        let futureIdx = -1;

        // 表記揺れ・型揺れに強いヘッダー行の特定
        for (let r = 0; r < grid.length; r++) {
          const row = grid[r];
          if (!row || !Array.isArray(row)) continue;

          const cleanCells = Array.from(row).map(val => {
            if (val === null || val === undefined) return '';
            return String(val).replace(/[\s　\n\r]+/g, '');
          });

          const dIdx = cleanCells.findIndex(val => val === '日付');
          if (dIdx !== -1) {
            const hasSupport = cleanCells.some(val => val.includes('療育内容'));
            const hasResult = cleanCells.some(val => val.includes('結果') || val.includes('行った結果'));
            const hasFuture = cleanCells.some(val => val.includes('予定') || val.includes('今後の予定'));

            if ((hasSupport ? 1 : 0) + (hasResult ? 1 : 0) + (hasFuture ? 1 : 0) >= 2) {
              headerRowIdx = r;
              dateIdx = dIdx;
              supportIdx = cleanCells.findIndex(val => val.includes('療育内容'));
              resultIdx = cleanCells.findIndex(val => val.includes('結果') || val.includes('行った結果'));
              futureIdx = cleanCells.findIndex(val => val.includes('予定') || val.includes('今後の予定'));
              break;
            }
          }
        }

        if (headerRowIdx === -1 || dateIdx === -1) {
          console.warn(`シート「${sheetName}」に「日付」列が見つからなかったためスキップします。`);
          return;
        }

        const SUPPORT_CONTENT_OPTIONS = [
          '①認知・行動',
          '②運動・感覚',
          '③言語・コミュニケーション',
          '④健康・生活',
          '⑤人間関係・社会性'
        ];

        let currentReport: DailyReport | null = null;
        let resultLines: string[] = [];
        let futureLines: string[] = [];

        // ヘッダー行の次の行からデータをパース
        for (let r = headerRowIdx + 1; r < grid.length; r++) {
          const row = grid[r];
          if (!row) continue;

          const rawDateVal = row[dateIdx];
          let firstColVal = '';
          if (typeof rawDateVal === 'number') {
            // Excelシリアル値のデコード
            const dateObj = new Date(Math.round((rawDateVal - 25569) * 86400 * 1000));
            const m = dateObj.getMonth() + 1;
            const d = dateObj.getDate();
            firstColVal = `${m}月${d}日`;
          } else {
            firstColVal = String(rawDateVal || '').trim();
          }
          
          // 終了判定: 作成者、署名、令和などのキーワード
          if (
            firstColVal.includes('作成者') || 
            firstColVal.includes('署名') || 
            firstColVal.includes('令和')
          ) {
            break; // テーブルの末尾フッターに到達
          }

          // 日付の解析を試みる
          let isNewDate = false;
          let dateStr = '';
          if (firstColVal !== '') {
            const dateMatch = firstColVal.match(/(\d+)月(\d+)日/);
            const dayOnlyMatch = firstColVal.match(/^(\d+)(日)?$/);

            if (dateMatch) {
              dateStr = `${parseInt(dateMatch[1])}月${parseInt(dateMatch[2])}日`;
              isNewDate = true;
            } else if (dayOnlyMatch) {
              dateStr = `${monthNum}月${parseInt(dayOnlyMatch[1])}日`;
              isNewDate = true;
            }
          }

          // 新しい日付が見つかった場合、これまでの日報を保存し、新しく作成
          if (isNewDate) {
            if (currentReport) {
              currentReport.content.resultInfo = resultLines.join('\n');
              currentReport.content.futurePlan = futureLines.join('\n');
              tempRows.push(currentReport);
            }
            resultLines = [];
            futureLines = [];
            currentReport = {
              childId,
              planMonth: targetMonth,
              date: dateStr,
              staffId: '',
              type: 'tree_report',
              content: {
                externalInfo: '',
                supportContent: [],
                resultInfo: '',
                futurePlan: '',
                isVerified: false
              },
              archived: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            };
          }

          // 現在処理中の日報オブジェクトがある場合、この行のデータを追加・マージする
          if (currentReport) {
            // 療育内容の解析と蓄積
            const rawSupport = supportIdx !== -1 ? String(row[supportIdx] || '').trim() : '';
            if (rawSupport) {
              if (!currentReport.content.supportContent) {
                currentReport.content.supportContent = [];
              }
              SUPPORT_CONTENT_OPTIONS.forEach(opt => {
                const keyword = opt.replace(/^[①-⑤]/, '').split('・')[0];
                if (rawSupport.includes(keyword)) {
                  if (!currentReport!.content.supportContent!.includes(opt)) {
                    currentReport!.content.supportContent!.push(opt);
                  }
                }
              });
            }

            // 療育結果・予定のテキストを取得
            const valResult = resultIdx !== -1 ? String(row[resultIdx] || '').trim() : '';
            const valFuture = futureIdx !== -1 ? String(row[futureIdx] || '').trim() : '';

            // インテリジェント分離ロジック
            if (valResult) {
              const isFutureText = futureKeywords.some(kw => valResult.includes(kw));
              // すでに結果に値が入っており、予定が空である状態でテキストが登場した場合、または予定のキーワードを含む場合
              if (isFutureText || (resultLines.length > 0 && futureLines.length === 0)) {
                if (!futureLines.includes(valResult)) futureLines.push(valResult);
              } else {
                if (!resultLines.includes(valResult)) resultLines.push(valResult);
              }
            }

            if (valFuture) {
              if (!futureLines.includes(valFuture)) futureLines.push(valFuture);
            }
          }
        }

        // 最後の未保存データがあれば追加
        if (currentReport) {
          currentReport.content.resultInfo = resultLines.join('\n');
          currentReport.content.futurePlan = futureLines.join('\n');
          tempRows.push(currentReport);
        }
      });

      if (tempRows.length === 0) {
        throw new Error('シート内に取り込み可能な有効な日報データが見つかりませんでした。');
      }

      // 日付順にソート（複数月混在を考慮）
      tempRows.sort((a, b) => {
        if (a.planMonth !== b.planMonth) {
          return a.planMonth.localeCompare(b.planMonth);
        }
        const parseDate = (s: string) => {
          const m = s.match(/(\d+)月(\d+)日/);
          return m ? parseInt(m[1]) * 100 + parseInt(m[2]) : 0;
        };
        return parseDate(a.date) - parseDate(b.date);
      });

      setParsedRows(tempRows);
      setError(null);
      setStep('preview');
    } catch (err: any) {
      setError(err.message || 'シートデータのパースに失敗しました。');
      setParsedRows([]);
    }
  };

  const handleExecuteImport = () => {
    onImport(parsedRows);
    resetState();
  };

  const resetState = () => {
    setParsedRows([]);
    setError(null);
    setParsedSheetsCount(0);
    setFileName('');
    setStep('upload');
  };

  // ドラッグ＆ドロップ用ハンドラー
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
      if (!isExcel) {
        setError('Excelファイル (.xlsx, .xls) のみを選択してください。');
        return;
      }
      processFile(file);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* オーバーレイ */}
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      
      {/* モーダル本体 */}
      <div className="relative bg-white w-full max-w-5xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in duration-200">
        
        {/* ヘッダー */}
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <FileSpreadsheet size={22} />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-800 tracking-tight">Excelファイルからインポート</h2>
              <p className="text-[12px] text-slate-500 font-medium">1ヶ月1シートでまとめられたExcelファイルから取り込みます</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-black/5 rounded-full text-slate-400 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* コンテンツエリア */}
        <div className="flex-1 overflow-y-auto p-8">
          {step === 'upload' && (
            <div className="space-y-6">
              {error && (
                <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm flex items-start gap-3 border border-red-100 animate-shake">
                  <AlertCircle size={18} className="flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {/* ドラッグ＆ドロップエリア */}
              <div 
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-80 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 hover:border-primary/40 hover:bg-slate-50/70 transition-all flex flex-col items-center justify-center p-6 cursor-pointer group"
              >
                <input 
                  type="file" 
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept=".xlsx, .xls"
                  className="hidden"
                />
                <div className="w-16 h-16 rounded-full bg-slate-100 group-hover:bg-primary/10 text-slate-400 group-hover:text-primary transition-colors flex items-center justify-center mb-4">
                  <Upload size={28} />
                </div>
                <h3 className="text-lg font-black text-slate-800 tracking-tight mb-2">Excelファイルをここにドラッグ＆ドロップ</h3>
                <p className="text-sm text-slate-400 font-semibold mb-6">または、クリックしてファイルを選択</p>
                <div className="text-xs text-slate-400/80 leading-relaxed text-center font-medium max-w-md">
                  日付・療育内容・療育結果・今後の予定の表が含まれるExcelファイルを指定してください。
                  ファイル内の「原本」以外のすべての月別シートが一度に自動インポートされます。
                </div>
              </div>
            </div>
          )}

          {step === 'preview' && (
            <div className="space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-50 border border-slate-100 rounded-2xl p-5">
                <div className="space-y-1">
                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">読み込み中のファイル</div>
                  <div className="text-sm font-bold text-slate-700">{fileName}</div>
                </div>
                
                <div className="space-y-1 text-right">
                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">解析されたシート数（原本除く）</div>
                  <div className="text-sm font-bold text-emerald-600">{parsedSheetsCount} 個のシート</div>
                </div>
              </div>

              {error && (
                <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm flex items-start gap-3 border border-red-100">
                  <AlertCircle size={18} className="flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {parsedRows.length > 0 && (
                <div className="space-y-2">
                  <h3 className="font-bold text-slate-700 flex items-center gap-2">
                    プレビュー ({parsedRows.length}件のレコードを検出しました)
                  </h3>
                  
                  <div className="border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
                    <table className="w-full text-left text-sm border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 font-bold">
                          <th className="p-4 w-[110px]">対象月</th>
                          <th className="p-4 w-[100px]">日付</th>
                          <th className="p-4 w-[180px]">療育内容</th>
                          <th className="p-4">療育を行った結果</th>
                          <th className="p-4">今後の予定</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parsedRows.map((row, i) => (
                          <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/50">
                            <td className="p-4 font-bold text-slate-600 whitespace-nowrap">{row.planMonth}</td>
                            <td className="p-4 font-bold text-slate-800 whitespace-nowrap">{row.date}</td>
                            <td className="p-4">
                              <div className="flex gap-1 flex-wrap">
                                {row.content.supportContent && row.content.supportContent.length > 0 ? (
                                  row.content.supportContent.map(tag => (
                                    <span key={tag} className="text-[9px] font-bold px-2 py-0.5 bg-primary/10 text-primary rounded-full">
                                      {tag.replace(/^[①-⑤]/, '')}
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-[10px] text-slate-300 italic">自動検出なし</span>
                                )}
                              </div>
                            </td>
                            <td className="p-4 text-slate-600 line-clamp-3 overflow-hidden text-xs max-w-[300px]" title={row.content.resultInfo}>
                              {row.content.resultInfo}
                            </td>
                            <td className="p-4 text-slate-600 line-clamp-3 overflow-hidden text-xs max-w-[200px]" title={row.content.futurePlan}>
                              {row.content.futurePlan}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* フッターボタン */}
        <div className="p-6 bg-slate-50/50 border-t border-slate-100 flex justify-end gap-3">
          <button 
            onClick={() => {
              resetState();
              onClose();
            }} 
            className="px-6 py-2.5 text-slate-500 font-bold hover:text-slate-800 transition-colors"
          >
            キャンセル
          </button>
          
          {step === 'preview' && (
            <>
              <button 
                onClick={resetState}
                className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-bold transition-all active:scale-95"
              >
                ファイルを変更
              </button>
              <button 
                onClick={handleExecuteImport}
                disabled={parsedRows.length === 0}
                className="px-8 py-2.5 bg-primary text-white rounded-xl font-bold hover:bg-primary-hover transition-all shadow-lg shadow-primary/20 flex items-center gap-2 active:scale-95 disabled:opacity-50 disabled:active:scale-100"
              >
                <Check size={18} />
                <span>現在のデータと置き換える</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
