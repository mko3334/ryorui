import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { 
  FolderOpen, FileSpreadsheet, CheckCircle2, AlertCircle, 
  Loader2, Check, X, Layers
} from 'lucide-react';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Child } from '../data/mockData';
import type { DailyReport } from '../types/supportPlan';
import { cloneTemplateAndWriteExcelFile } from '../lib/excelExport';
import * as XLSX from 'xlsx';

interface BatchExcelExportProps {
  selectedMonth: string; // "YYYY-MM"
  childrenData: Child[];
}

interface ScannedExcelItem {
  fileHandle: any;
  fileName: string;
  matchedChild: Child | null;
  hasTemplateSheet: boolean;
  targetSheetName: string;
  existingSheetNames: string[];
  goals: string;
  dailyRows: DailyReport[];
  hasData: boolean;
  status: 'ready' | 'no-child' | 'no-data' | 'no-template' | 'success' | 'error';
  errorMessage?: string;
  selected: boolean;
}

export const BatchExcelExport: React.FC<BatchExcelExportProps> = ({
  selectedMonth: initialMonth,
  childrenData
}) => {
  const [targetMonth, setTargetMonth] = useState<string>(initialMonth || new Date().toISOString().slice(0, 7));
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanProgress, setScanProgress] = useState<{ current: number; total: number; fileName: string }>({
    current: 0,
    total: 0,
    fileName: ''
  });
  const [scannedItems, setScannedItems] = useState<ScannedExcelItem[]>([]);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [progress, setProgress] = useState<{ current: number; total: number; currentFileName: string }>({
    current: 0,
    total: 0,
    currentFileName: ''
  });
  const [logs, setLogs] = useState<string[]>([]);
  const [isFinished, setIsFinished] = useState<boolean>(false);
  const [monthSettings, setMonthSettings] = useState<{
    creator: string;
    createdDateText: string;
  }>({ creator: '', createdDateText: '' });

  // 月変更時の同期
  React.useEffect(() => {
    if (initialMonth) {
      setTargetMonth(initialMonth);
    }
  }, [initialMonth]);

  // 該当月のシステム設定（専門的支援実施計画の作成日・作成者）を取得
  React.useEffect(() => {
    const fetchMonthlySettings = async () => {
      try {
        const snap = await getDoc(doc(db, 'monthlySettings', targetMonth));
        if (snap.exists()) {
          const data = snap.data();
          const y = data.implementationYear;
          const m = data.implementationMonth;
          const d = data.implementationDay;
          const creator = data.implementationCreator || '';
          let dateText = '';
          if (y && m && d) {
            dateText = `令和${y}年${m}月${d}日作成`;
          } else if (y || m || d) {
            dateText = `令和${y || ''}年${m || ''}月${d || ''}日作成`;
          }
          setMonthSettings({ creator, createdDateText: dateText });
        } else {
          setMonthSettings({ creator: '', createdDateText: '' });
        }
      } catch (err) {
        console.error('Failed to fetch monthly settings:', err);
      }
    };
    fetchMonthlySettings();
  }, [targetMonth]);

  // 名前の正規化
  const normalize = (s?: string) => (s || '').replace(/[\s　\u200B-\u200D\uFEFF]/g, '').toLowerCase();

  // 児童の照合ロジック
  const matchChild = (rawName: string, fileName: string): Child | null => {
    const normRaw = normalize(rawName);
    const normFile = normalize(fileName);

    // 1. 検出された氏名で完全一致
    if (normRaw) {
      const c1 = childrenData.find(c => normalize(c.fullName) === normRaw);
      if (c1) return c1;
      const c2 = childrenData.find(c => normalize(c.nameKana) === normRaw);
      if (c2) return c2;
      const c3 = childrenData.find(c => {
        const full = normalize(c.fullName);
        return full.includes(normRaw) || normRaw.includes(full);
      });
      if (c3) return c3;
    }

    // 2. ファイル名から照合
    const cFile = childrenData.find(c => {
      const full = normalize(c.fullName);
      const kana = normalize(c.nameKana);
      return (full && normFile.includes(full)) || (kana && normFile.includes(kana));
    });
    if (cFile) return cFile;

    return null;
  };

  // フォルダ選択とスキャン処理
  const handleSelectFolder = async () => {
    if (!('showDirectoryPicker' in window)) {
      alert('お使いのブラウザはフォルダ選択機能（File System Access API）に対応していません。Google Chrome または Microsoft Edge でご利用ください。');
      return;
    }

    try {
      const dirHandle = await (window as any).showDirectoryPicker({
        mode: 'readwrite'
      });

      setIsScanning(true);
      setScannedItems([]);
      setScanProgress({ current: 0, total: 0, fileName: '' });
      setLogs([`フォルダ「${dirHandle.name}」内のエクセルファイルを検索中...`]);

      const excelFiles: any[] = [];
      for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file' && (entry.name.endsWith('.xlsx') || entry.name.endsWith('.xls')) && !entry.name.startsWith('~$')) {
          excelFiles.push(entry);
        }
      }

      if (excelFiles.length === 0) {
        alert('指定されたフォルダ内に有効なエクセルファイル (.xlsx) が見つかりませんでした。');
        setIsScanning(false);
        return;
      }

      setLogs(prev => [...prev, `${excelFiles.length}件のエクセルファイルを検出しました。児童照合とデータ取得を開始します...`]);

      const [yStr, mStr] = targetMonth.split('-');
      const baseSheetName = `${yStr}${(mStr || '01').padStart(2, '0')}`;

      // Firestore から今月分の supportPlans と daily_reports を一括取得（ネットワークを劇的に高速化）
      const goalsMap = new Map<string, string>();
      const dailyMap = new Map<string, DailyReport[]>();

      try {
        const [plansSnap, dailySnap] = await Promise.all([
          getDocs(query(collection(db, 'supportPlans'), where('month', '==', targetMonth))),
          getDocs(query(collection(db, 'daily_reports'), where('planMonth', '==', targetMonth)))
        ]);

        plansSnap.forEach(d => {
          const data = d.data();
          if (data.childId && data.goals) {
            goalsMap.set(data.childId, data.goals);
          }
        });

        dailySnap.forEach(d => {
          const dData = d.data();
          if (dData.childId) {
            if (!dailyMap.has(dData.childId)) {
              dailyMap.set(dData.childId, []);
            }
            dailyMap.get(dData.childId)!.push({
              id: d.id,
              ...dData,
              date: dData.date || '',
              content: dData.content || {}
            } as DailyReport);
          }
        });

        // 各児童の日報を日付順にソート
        dailyMap.forEach(list => {
          list.sort((a, b) => {
            const numA = parseInt((a.date.match(/(\d+)日/) || ['', '0'])[1], 10);
            const numB = parseInt((b.date.match(/(\d+)日/) || ['', '0'])[1], 10);
            return numA - numB;
          });
        });
      } catch (err) {
        console.warn('Batch fetch error for targetMonth:', err);
      }

      // 各ファイルを高速スキャン
      const items: ScannedExcelItem[] = [];

      for (let i = 0; i < excelFiles.length; i++) {
        const fileHandle = excelFiles[i];
        setScanProgress({ current: i + 1, total: excelFiles.length, fileName: fileHandle.name });

        try {
          const file = await fileHandle.getFile();
          const arrayBuffer = await file.arrayBuffer();
          const wb = XLSX.read(arrayBuffer, { type: 'array' });

          const sheetNames = wb.SheetNames;
          const hasTemplate = sheetNames.some(name => {
            const clean = name.replace(/[\s　]+/g, '');
            return clean === '原本' || clean.includes('原本');
          });

          // 児童名の検出
          let detectedName = '';
          const targetWsName = sheetNames.find(s => s.includes('原本')) || sheetNames[0];
          const ws = targetWsName ? wb.Sheets[targetWsName] : null;

          if (ws) {
            // I2 (cell r=1, c=8)
            if (ws['I2']?.v) {
              detectedName = String(ws['I2'].v).trim();
            }
            if (!detectedName) {
              const grid = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });
              for (let r = 0; r < Math.min(grid.length, 15); r++) {
                const row = grid[r] || [];
                for (let c = 0; c < row.length; c++) {
                  const val = String(row[c] || '').replace(/[\s　]+/g, '');
                  if (val === '名前' || val === '氏名' || val.includes('児童名')) {
                    for (let offset = 1; offset <= 5; offset++) {
                      const neighbor = String(row[c + offset] || '').trim();
                      if (neighbor && neighbor !== '名前' && neighbor !== '氏名') {
                        detectedName = neighbor;
                        break;
                      }
                    }
                  }
                  if (detectedName) break;
                }
                if (detectedName) break;
              }
            }
          }

          const matched = matchChild(detectedName, file.name);

          // 新規シート名の重複判定
          const cleanNames = new Set(sheetNames.map(s => s.trim()));
          let targetSheet = baseSheetName;
          if (cleanNames.has(targetSheet)) {
            const letters = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];
            for (const letter of letters) {
              const candidate = `${baseSheetName}（${letter}）`;
              if (!cleanNames.has(candidate)) {
                targetSheet = candidate;
                break;
              }
            }
          }

          // 目標と日報の割り当て
          let goals = '';
          let dailyRows: DailyReport[] = [];

          if (matched && matched.id) {
            goals = goalsMap.get(matched.id) || '';
            dailyRows = dailyMap.get(matched.id) || [];

            // マップになかった場合の個別フォールバック
            if (!goals) {
              try {
                const pDoc = await getDoc(doc(db, 'supportPlans', `${matched.id}_${targetMonth}`));
                if (pDoc.exists()) {
                  goals = pDoc.data().goals || '';
                }
              } catch (e) {}
            }
          }

          const hasData = !!(goals.trim() || dailyRows.length > 0);
          let status: ScannedExcelItem['status'] = 'ready';
          if (!matched) status = 'no-child';
          else if (!hasTemplate) status = 'no-template';
          else if (!hasData) status = 'no-data';

          items.push({
            fileHandle,
            fileName: file.name,
            matchedChild: matched,
            hasTemplateSheet: hasTemplate,
            targetSheetName: targetSheet,
            existingSheetNames: sheetNames,
            goals,
            dailyRows,
            hasData,
            status,
            selected: status === 'ready'
          });
        } catch (err: any) {
          console.warn(`File scan error for ${fileHandle.name}:`, err);
        }
      }

      setLogs(prev => [...prev, `✔ ${items.length}件のファイルを照合完了しました。事前プレビューを表示します。`]);
      setScannedItems(items);
      setIsScanning(false);
      setIsModalOpen(true);
      setIsFinished(false);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        alert(`フォルダ選択でエラーが発生しました: ${err.message || err}`);
      }
      setIsScanning(false);
    }
  };

  // 全選択・全解除
  const handleToggleSelectAll = (select: boolean) => {
    setScannedItems(prev => prev.map(item => {
      if (item.status === 'ready' || item.status === 'no-data') {
        return { ...item, selected: select };
      }
      return item;
    }));
  };

  // 個別チェック切り替え
  const handleToggleItem = (idx: number) => {
    setScannedItems(prev => prev.map((item, i) => i === idx ? { ...item, selected: !item.selected } : item));
  };

  // 一括上書きの実行
  const handleExecuteBatch = async () => {
    const targets = scannedItems.filter(item => item.selected && item.matchedChild);
    if (targets.length === 0) {
      alert('上書き対象として選択されたファイルがありません。');
      return;
    }

    setIsProcessing(true);
    setIsFinished(false);
    setLogs([`🚀 一括上書きを開始します（対象: ${targets.length} 件）...`]);

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < targets.length; i++) {
      const item = targets[i];
      setProgress({ current: i + 1, total: targets.length, currentFileName: item.fileName });

      try {
        setLogs(prev => [...prev, `▶ [${i + 1}/${targets.length}] 「${item.fileName}」(${item.matchedChild?.fullName}様) を処理中...`]);

        const result = await cloneTemplateAndWriteExcelFile(
          item.fileHandle,
          item.matchedChild?.fullName || '',
          targetMonth,
          item.goals,
          item.dailyRows,
          monthSettings.creator,
          monthSettings.createdDateText,
          (msg) => setLogs(prev => [...prev, `   ${msg}`])
        );

        setLogs(prev => [...prev, `✔ 「${item.fileName}」にシート「${result.sheetName}」を作成・上書き保存しました`]);
        successCount++;

        setScannedItems(prev => prev.map(si => si.fileName === item.fileName ? { ...si, status: 'success' } : si));
      } catch (err: any) {
        console.error(`Error writing ${item.fileName}:`, err);
        const errMsg = err.message || String(err);
        setLogs(prev => [...prev, `❌ 「${item.fileName}」の書き込みに失敗: ${errMsg}`]);
        errorCount++;
        setScannedItems(prev => prev.map(si => si.fileName === item.fileName ? { ...si, status: 'error', errorMessage: errMsg } : si));
      }
    }

    setIsProcessing(false);
    setIsFinished(true);
    setLogs(prev => [
      ...prev,
      `🎉 すべての処理が終了しました！（成功: ${successCount} 件 / エラー: ${errorCount} 件）`
    ]);
  };

  const readyCount = useMemo(() => scannedItems.filter(i => i.status === 'ready').length, [scannedItems]);
  const selectedCount = useMemo(() => scannedItems.filter(i => i.selected).length, [scannedItems]);

  return (
    <div className="p-8 flex flex-col gap-6">
      {/* 説明カード */}
      <div className="bg-gradient-to-br from-indigo-50/70 to-blue-50/40 rounded-2xl p-6 border border-indigo-100 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-indigo-200">
            <Layers size={24} />
          </div>
          <div className="flex-1 space-y-2">
            <h2 className="text-lg font-bold text-slate-800">
              月別エクセル一括上書き（原本シート複製 ➜ 新月シート自動作成）
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              エクセルが入ったフォルダを指定するだけで、フォルダ内の全児童のエクセルを自動照合します。
              各エクセルの<strong className="text-indigo-900 font-bold">「原本」シートを末尾に完全コピー</strong>し、
              指定した月（例: <span className="font-mono font-bold bg-indigo-100/70 text-indigo-900 px-1.5 py-0.5 rounded">{targetMonth.replace('-', '')}</span>）という名前の新しいシートを作成して、
              今月の目標・療育内容・結果・予定・作成者を綺麗に流し込みます。
            </p>
            <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-indigo-800 pt-1">
              <span>✔ 原本の罫線・スタイルを100%完全維持</span>
              <span>✔ 同名シートが存在する場合は （B） と自動付番</span>
              <span>✔ 過去月のシートは一切汚さず安全保持</span>
            </div>
          </div>
        </div>
      </div>

      {/* 条件指定とアクション */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-6">
        <div className="flex flex-wrap items-center gap-6 w-full sm:w-auto">
          {/* 月選択 */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-500 block">対象年月</label>
            <input
              type="month"
              value={targetMonth}
              onChange={(e) => setTargetMonth(e.target.value)}
              className="bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-base font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all cursor-pointer"
            />
          </div>

          {/* プレビュー表示用シート名目安 */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-500 block">作成されるシート名</label>
            <div className="px-4 py-2.5 rounded-xl bg-slate-100 border border-slate-200 text-sm font-mono font-bold text-slate-700">
              {targetMonth.replace('-', '')}
            </div>
          </div>

          {/* システム設定からの参照情報（作成日・作成者） */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-500 block">参照する作成日・作成者（システム設定）</label>
            <div className="px-4 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-medium text-slate-700 flex items-center gap-2">
              <span>作成日: <strong className="text-indigo-900">{monthSettings.createdDateText || '（未設定）'}</strong></span>
              <span className="text-slate-300">|</span>
              <span>作成者: <strong className="text-indigo-900">{monthSettings.creator || '（未設定）'}</strong></span>
            </div>
          </div>
        </div>

        {/* フォルダ選択ボタン */}
        <button
          type="button"
          onClick={handleSelectFolder}
          disabled={isScanning}
          className="w-full sm:w-auto flex items-center justify-center gap-2.5 px-6 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-lg shadow-indigo-600/20 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
        >
          {isScanning ? (
            <>
              <Loader2 size={20} className="animate-spin" />
              <span>フォルダを高速解析中... ({scanProgress.current}/{scanProgress.total})</span>
            </>
          ) : (
            <>
              <FolderOpen size={20} />
              <span>フォルダを選択して一括上書きを開始</span>
            </>
          )}
        </button>
      </div>

      {/* スキャン中のプログレスバー表示 */}
      {isScanning && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-5 space-y-2 animate-pulse">
          <div className="flex items-center justify-between text-xs font-bold text-indigo-900">
            <span className="flex items-center gap-2">
              <Loader2 size={16} className="animate-spin text-indigo-600" />
              エクセルファイルを高速照合中... ({scanProgress.current} / {scanProgress.total} ファイル)
            </span>
            <span>{Math.round((scanProgress.current / Math.max(1, scanProgress.total)) * 100)}%</span>
          </div>
          <div className="w-full bg-indigo-100 h-2.5 rounded-full overflow-hidden">
            <div 
              className="bg-indigo-600 h-full transition-all duration-200 rounded-full"
              style={{ width: `${(scanProgress.current / Math.max(1, scanProgress.total)) * 100}%` }}
            />
          </div>
          <p className="text-[11px] text-indigo-600 truncate font-mono">{scanProgress.fileName}</p>
        </div>
      )}

      {/* 照合ログ（モーダルが開く前） */}
      {logs.length > 0 && !isModalOpen && (
        <div className="bg-slate-900 text-slate-200 font-mono text-[11px] p-4 rounded-xl max-h-36 overflow-y-auto space-y-1 shadow-inner">
          {logs.map((log, i) => (
            <div key={i} className="leading-tight">{log}</div>
          ))}
        </div>
      )}

      {/* 注意事項 */}
      <div className="bg-amber-50 rounded-xl p-4 border border-amber-200 text-xs text-amber-900 flex items-start gap-3">
        <AlertCircle size={18} className="text-amber-600 shrink-0 mt-0.5" />
        <div className="space-y-1 leading-relaxed">
          <p className="font-bold text-amber-950">実行前のご注意：</p>
          <p>
            エクセルファイルをExcel等のソフトで開いている最中は、Windowsの仕様により上書き保存ができません。
            <strong>必ずエクセルソフトを終了（ファイルをすべて保存して閉じる）してから実行してください。</strong>
          </p>
          <p className="text-amber-800">
            ※念のため、初回実行前に対象フォルダを丸ごとコピーしてバックアップを取っておくことを推奨いたします。
          </p>
        </div>
      </div>

      {/* 照合確認モーダル（createPortal で document.body に直接マウントし、親コンテナの overflow-hidden によるボタン欠落を完全防止） */}
      {isModalOpen && createPortal(
        <div className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[88vh] flex flex-col overflow-hidden border border-slate-100">
            {/* モーダルヘッダー */}
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold shadow-xs">
                  <FileSpreadsheet size={22} />
                </div>
                <div>
                  <h3 className="font-black text-slate-800 text-base flex items-center gap-2">
                    月別エクセル一括上書きの事前照合プレビュー
                    <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 font-mono font-bold">
                      対象: {targetMonth}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500 font-medium">
                    検出: {scannedItems.length} 件 ｜ 照合成功: <strong className="text-emerald-600">{readyCount} 件</strong> ｜ 選択中: <strong className="text-indigo-600">{selectedCount} 件</strong>
                  </p>
                </div>
              </div>

              {/* ヘッダー右側のアクションボタン */}
              <div className="flex items-center gap-3">
                {!isProcessing && selectedCount > 0 && (
                  <button
                    type="button"
                    onClick={handleExecuteBatch}
                    className="hidden sm:flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs shadow-md shadow-emerald-600/20 active:scale-95 transition-all cursor-pointer"
                  >
                    <Check size={16} className="stroke-[3]" />
                    <span>一括書き込みを開始 ({selectedCount}件)</span>
                  </button>
                )}
                {!isProcessing && (
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="p-2 rounded-xl hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                    title="閉じる"
                  >
                    <X size={20} />
                  </button>
                )}
              </div>
            </div>

            {/* モーダルボディ（テーブル） */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {/* 操作ボタン */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleToggleSelectAll(true)}
                    disabled={isProcessing}
                    className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold transition-colors cursor-pointer"
                  >
                    すべて選択
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleSelectAll(false)}
                    disabled={isProcessing}
                    className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold transition-colors cursor-pointer"
                  >
                    すべて解除
                  </button>
                </div>
              </div>

              {/* 上書き仕様インフォバー */}
              <div className="bg-indigo-50/70 border border-indigo-100 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-indigo-900">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-bold text-indigo-950">📋 書き込み仕様:</span>
                  <span>✔ 日付は年なし（例: 8月12日）</span>
                  <span>✔ 支援目標は出力せず原本維持</span>
                  <span>✔ セルサイズ・罫線・A4印刷設定を完全維持</span>
                </div>
                <div className="flex items-center gap-2 text-[11px] bg-white/80 px-2.5 py-1 rounded-lg border border-indigo-100">
                  <span>作成日: <strong className="text-indigo-900">{monthSettings.createdDateText || '未設定'}</strong></span>
                  <span className="text-indigo-200">|</span>
                  <span>作成者: <strong className="text-indigo-900">{monthSettings.creator || '未設定'}</strong></span>
                </div>
              </div>

              {/* テーブル */}
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-100/80 text-slate-600 font-bold border-b border-slate-200 sticky top-0 z-10">
                    <tr>
                      <th className="p-3 w-12 text-center">選択</th>
                      <th className="p-3">ファイル名</th>
                      <th className="p-3 w-36">照合された児童</th>
                      <th className="p-3 w-32">新規作成シート名</th>
                      <th className="p-3 w-28">アプリ内データ</th>
                      <th className="p-3 w-36">状態</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {scannedItems.map((item, idx) => (
                      <tr 
                        key={idx} 
                        className={`hover:bg-slate-50 transition-colors ${
                          item.status === 'success' ? 'bg-emerald-50/40' : 
                          item.status === 'error' ? 'bg-red-50/40' :
                          !item.selected ? 'opacity-60 bg-slate-50/30' : ''
                        }`}
                      >
                        <td className="p-3 text-center">
                          <input
                            type="checkbox"
                            checked={item.selected}
                            disabled={isProcessing || item.status === 'no-child' || item.status === 'no-template'}
                            onChange={() => handleToggleItem(idx)}
                            className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                          />
                        </td>
                        <td className="p-3 font-medium text-slate-800 break-all">
                          {item.fileName}
                        </td>
                        <td className="p-3">
                          {item.matchedChild ? (
                            <span className="font-bold text-slate-800 flex items-center gap-1">
                              <span className="w-2 h-2 rounded-full bg-emerald-500" />
                              {item.matchedChild.fullName}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-red-600 font-semibold">
                              <X size={12} /> 未照合
                            </span>
                          )}
                        </td>
                        <td className="p-3 font-mono font-bold text-indigo-700">
                          {item.targetSheetName}
                        </td>
                        <td className="p-3">
                          <div className="space-y-0.5 text-[11px]">
                            <span className={item.goals ? 'text-emerald-700 font-semibold' : 'text-slate-400'}>
                              目標: {item.goals ? 'あり' : 'なし'}
                            </span>
                            <br />
                            <span className={item.dailyRows.length > 0 ? 'text-emerald-700 font-semibold' : 'text-slate-400'}>
                              日報: {item.dailyRows.length}件
                            </span>
                          </div>
                        </td>
                        <td className="p-3">
                          {item.status === 'success' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                              <CheckCircle2 size={12} /> 書き込み完了
                            </span>
                          ) : item.status === 'error' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-red-100 text-red-800 border border-red-300" title={item.errorMessage}>
                              <AlertCircle size={12} /> エラー
                            </span>
                          ) : item.status === 'ready' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                              準備完了
                            </span>
                          ) : item.status === 'no-data' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                              アプリ内データなし
                            </span>
                          ) : item.status === 'no-template' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-red-50 text-red-700 border border-red-200">
                              原本シートなし
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-500">
                              児童未特定
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 進行状況 & リアルタイムログ */}
              {(isProcessing || logs.length > 0) && (
                <div className="space-y-2 pt-2">
                  {isProcessing && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs font-bold text-slate-700">
                        <span>進捗: {progress.current} / {progress.total} ファイル</span>
                        <span>{Math.round((progress.current / (progress.total || 1)) * 100)}%</span>
                      </div>
                      <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                        <div 
                          className="bg-indigo-600 h-full transition-all duration-300 rounded-full"
                          style={{ width: `${(progress.current / (progress.total || 1)) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}

                  <div className="bg-slate-900 text-slate-200 font-mono text-[11px] p-4 rounded-xl max-h-36 overflow-y-auto space-y-1">
                    {logs.map((log, i) => (
                      <div key={i} className="leading-tight">{log}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* モーダルフッター（固定表示） */}
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between shrink-0 shadow-xs">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                disabled={isProcessing}
                className="px-5 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-bold text-xs hover:bg-white transition-colors disabled:opacity-50 cursor-pointer"
              >
                {isFinished ? '閉じる' : 'キャンセル'}
              </button>

              <button
                type="button"
                onClick={handleExecuteBatch}
                disabled={isProcessing || selectedCount === 0}
                className="flex items-center gap-2 px-8 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm shadow-lg shadow-emerald-600/25 active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
              >
                {isProcessing ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    <span>エクセル上書き処理中... ({progress.current}/{progress.total})</span>
                  </>
                ) : (
                  <>
                    <Check size={18} className="stroke-[3]" />
                    <span>選択した {selectedCount} 件のエクセルに一括書き込みを実行</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
