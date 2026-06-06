import React, { useState, useEffect, useRef } from 'react';
import { Save, Calendar, User, FileText, CheckCircle2, Settings as SettingsIcon, UploadCloud, AlertCircle, Check, Loader2, X } from 'lucide-react';
import { doc, getDoc, setDoc, serverTimestamp, collection, writeBatch } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import type { Child } from '../data/mockData';
import type { DailyReport } from '../types/supportPlan';
import * as XLSX from 'xlsx';

const SETTINGS_COL = 'monthlySettings';

type MonthlySetting = {
  implementationCreator: string;
  implementationYear: string;
  implementationMonth: string;
  implementationDay: string;
  perspectiveCreator: string;
  perspectiveYear: string;
  perspectiveMonth: string;
  perspectiveDay: string;
};

type SettingsProps = {
  childrenData?: Child[];
};

type ImportItem = {
  file: File;
  fileName: string;
  detectedName: string;
  matchedChildId: string;
  planMonth: string;
  parsedRows: DailyReport[];
  status: 'pending' | 'success' | 'error' | 'warning';
  message: string;
};

export const Settings: React.FC<SettingsProps> = ({ childrenData = [] }) => {
  const [activeTab, setActiveTab] = useState<'implementation' | 'perspective' | 'bulk-import'>('implementation');
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [settings, setSettings] = useState<MonthlySetting>({
    implementationCreator: '',
    implementationYear: '',
    implementationMonth: '',
    implementationDay: '',
    perspectiveCreator: '',
    perspectiveYear: '',
    perspectiveMonth: '',
    perspectiveDay: '',
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');

  // 一括インポート関連のState
  const [importFiles, setImportFiles] = useState<ImportItem[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0, currentName: '' });

  const fileInputRef = useRef<HTMLInputElement>(null);

  // データ取得 (月次設定)
  useEffect(() => {
    const fetchSettings = async () => {
      setIsLoading(true);
      try {
        const snap = await getDoc(doc(db, SETTINGS_COL, selectedMonth));
        if (snap.exists()) {
          setSettings(snap.data() as MonthlySetting);
        } else {
          // デフォルト値: 月選択から月を抽出
          const m = parseInt(selectedMonth.split('-')[1], 10);
          setSettings({
            implementationCreator: '',
            implementationYear: '',
            implementationMonth: m.toString(),
            implementationDay: '',
            perspectiveCreator: '',
            perspectiveYear: '',
            perspectiveMonth: m.toString(),
            perspectiveDay: '',
          });
        }
      } catch (e) {
        console.error('fetchSettings error:', e);
      } finally {
        setIsLoading(false);
      }
    };
    fetchSettings();
  }, [selectedMonth]);

  // 設定の保存
  const handleSave = async () => {
    setIsSaving(true);
    setSaveStatus('idle');
    try {
      await setDoc(doc(db, SETTINGS_COL, selectedMonth), {
        ...settings,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (e) {
      console.error('Save error:', e);
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  };

  const updateSettings = (patch: Partial<MonthlySetting>) => {
    setSettings(prev => ({ ...prev, ...patch }));
  };

  // 名前の正規化 (スペース・敬称除去)
  const normalizeName = (name: string): string => {
    return name
      .replace(/[\s　]+/g, '')
      .replace(/[様くんちゃん殿君]+/g, '')
      .toLowerCase();
  };

  // 児童名寄せ処理
  const findMatchedChild = (detectedName: string): string => {
    if (!detectedName) return '';
    const normalizedDetected = normalizeName(detectedName);

    // 1) 完全一致 (スペース除去後)
    const match1 = childrenData.find(c => normalizeName(c.fullName || '') === normalizedDetected);
    if (match1) return match1.id || '';

    // 2) カナ完全一致
    if (normalizedDetected) {
      const match2 = childrenData.find(c => c.nameKana && normalizeName(c.nameKana) === normalizedDetected);
      if (match2) return match2.id || '';
    }

    // 3) 部分一致 (Excel名がシステム名に含まれる、またはその逆)
    const match3 = childrenData.find(c => {
      const normalizedSystem = normalizeName(c.fullName || '');
      return normalizedSystem.includes(normalizedDetected) || normalizedDetected.includes(normalizedSystem);
    });
    if (match3) return match3.id || '';

    return '';
  };

  // Excelシートから児童名を自動検出する
  const detectChildNameFromWorkbook = (wb: XLSX.WorkBook, filename: string): string => {
    // 全シートを走査し、左上エリアから「名前」「氏名」「利用児氏名」を探す
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      if (!sheet) continue;
      const grid = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });

      for (let r = 0; r < Math.min(grid.length, 15); r++) {
        const row = grid[r];
        if (!row || !Array.isArray(row)) continue;

        for (let c = 0; c < row.length; c++) {
          const val = String(row[c] || '').trim();
          if (val === '名前' || val === '氏名' || val === '利用児氏名' || val.includes('名前') || val.includes('氏名')) {
            // 右隣、あるいはその次のセルをチェック
            const nextVal1 = String(row[c + 1] || '').trim();
            const nextVal2 = String(row[c + 2] || '').trim();
            
            if (nextVal1 && nextVal1 !== '[' && nextVal1 !== ']' && nextVal1 !== '様') {
              return nextVal1.replace(/[\[\]様\s　]+/g, '');
            }
            if (nextVal2 && nextVal2 !== '[' && nextVal2 !== ']' && nextVal2 !== '様') {
              return nextVal2.replace(/[\[\]様\s　]+/g, '');
            }
          }
        }
      }
    }

    // 見つからない場合はファイル名から児童名抽出を試みる
    const nameMatch = filename.match(/計画_(.*?)_/);
    if (nameMatch && nameMatch[1]) {
      return nameMatch[1].trim();
    }
    const nameMatch2 = filename.match(/^([^_.]+)/);
    if (nameMatch2 && nameMatch2[1] && !nameMatch2[1].includes('専門的支援') && !nameMatch2[1].includes('実施計画')) {
      return nameMatch2[1].trim();
    }

    return '';
  };

  // シート名から対象月（"YYYY-MM"）を自動判定するヘルパー
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

  // 複数ファイルのパース (原本以外のすべての有効な月シートをループ処理)
  const processFiles = async (files: FileList) => {
    const newItems: ImportItem[] = [];
    const defaultYear = selectedMonth.split('-')[0] || new Date().getFullYear().toString();

    const promises = Array.from(files).map(file => {
      return new Promise<void>((resolve) => {
        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const data = new Uint8Array(event.target?.result as ArrayBuffer);
            const wb = XLSX.read(data, { type: 'array' });
            
            // 児童名・マッピング先児童の特定
            const detectedName = detectChildNameFromWorkbook(wb, file.name);
            const matchedChildId = findMatchedChild(detectedName);

            // "原本"以外の全シートをスキャン
            const validSheets = wb.SheetNames.filter(sheetName => {
              return parseMonthFromSheetName(sheetName, defaultYear) !== null;
            });

            if (validSheets.length === 0) {
              newItems.push({
                file,
                fileName: file.name,
                detectedName,
                matchedChildId,
                planMonth: selectedMonth,
                parsedRows: [],
                status: 'error',
                message: `「原本」以外に有効な月別シートが見つかりませんでした。`
              });
              resolve();
              return;
            }

            // 各シートをループしてパース
            validSheets.forEach(sheetName => {
              const targetMonth = parseMonthFromSheetName(sheetName, defaultYear) || selectedMonth;
              const sheet = wb.Sheets[sheetName];
              if (!sheet) return;

              // シートの2次元配列パース
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
                newItems.push({
                  file,
                  fileName: `${file.name} (${sheetName})`,
                  detectedName,
                  matchedChildId,
                  planMonth: targetMonth,
                  parsedRows: [],
                  status: 'error',
                  message: `シート「${sheetName}」に「日付」列が見つかりません。`
                });
                return;
              }

              // 結合セル対応ブロック単位パース
              const tempRows: DailyReport[] = [];
              const [, monthStr] = targetMonth.split('-');
              const monthNum = parseInt(monthStr, 10);
              const SUPPORT_CONTENT_OPTIONS = [
                '①認知・行動',
                '②運動・感覚',
                '③言語・コミュニケーション',
                '④健康・生活',
                '⑤人間関係・社会性'
              ];

              const futureKeywords = [
                'いく', 'ていく', 'にしていく', '促していく', '支援していく', '指導していく', 
                '見守っていく', '取り組んでいく', '予定', '今後も', '今後の', '支援する', 
                '促す', '見守る', 'アプローチ', '働きかけ'
              ];

              let currentReport: DailyReport | null = null;
              let resultLines: string[] = [];
              let futureLines: string[] = [];

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
                
                if (
                  firstColVal.includes('作成者') || 
                  firstColVal.includes('署名') || 
                  firstColVal.includes('令和')
                ) {
                  break; // フッター
                }

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

                if (isNewDate) {
                  if (currentReport) {
                    currentReport.content.resultInfo = resultLines.join('\n');
                    currentReport.content.futurePlan = futureLines.join('\n');
                    tempRows.push(currentReport);
                  }
                  resultLines = [];
                  futureLines = [];
                  currentReport = {
                    childId: matchedChildId,
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

                if (currentReport) {
                  // 療育内容の蓄積
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

              if (currentReport) {
                currentReport.content.resultInfo = resultLines.join('\n');
                currentReport.content.futurePlan = futureLines.join('\n');
                tempRows.push(currentReport);
              }

              const status = matchedChildId ? 'success' : 'warning';
              const message = matchedChildId 
                ? `${tempRows.length}日分の記録を検出` 
                : 'システム上の児童と紐付けできませんでした。';

              newItems.push({
                file,
                fileName: `${file.name} (${sheetName})`,
                detectedName,
                matchedChildId,
                planMonth: targetMonth,
                parsedRows: tempRows,
                status,
                message
              });
            });

          } catch (err: any) {
            newItems.push({
              file,
              fileName: file.name,
              detectedName: '',
              matchedChildId: '',
              planMonth: selectedMonth,
              parsedRows: [],
              status: 'error',
              message: `エラー: ${err.message || '読み込み失敗'}`
            });
          }
          resolve();
        };
        reader.readAsArrayBuffer(file);
      });
    });

    await Promise.all(promises);
    setImportFiles(newItems);
  };

  // ドラッグ＆ドロップ用ハンドラー
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
    }
  };

  // 手動で児童名割り当てを変更
  const handleMapChildChange = (index: number, childId: string) => {
    setImportFiles(prev => {
      return prev.map((item, i) => {
        if (i === index) {
          const updatedRows = item.parsedRows.map(row => ({ ...row, childId }));
          return {
            ...item,
            matchedChildId: childId,
            parsedRows: updatedRows,
            status: childId ? 'success' : 'warning',
            message: childId ? `${updatedRows.length}日分の記録を検出` : 'システム上の児童と紐付けできませんでした。'
          };
        }
        return item;
      });
    });
  };

  // Firestore一括保存
  const handleBulkImport = async () => {
    const readyItems = importFiles.filter(item => item.status === 'success' && item.matchedChildId);
    if (readyItems.length === 0) {
      alert('保存可能なデータがありません。児童の紐付けを確認してください。');
      return;
    }

    const confirmMsg = `紐付けされた ${readyItems.length} 件のデータを、Firestoreへ【すべて上書き保存】します。よろしいですか？\n(既存の同月データは上書きされ、直ちに反映されます)`;
    if (!window.confirm(confirmMsg)) return;

    setIsImporting(true);
    setImportProgress({ current: 0, total: readyItems.length, currentName: '' });

    try {
      let sName = "スタッフ 太郎";
      let officeId = "";
      if (auth.currentUser) {
        const staffSnap = await getDoc(doc(db, 'staff', auth.currentUser.uid));
        if (staffSnap.exists()) {
          const staffData = staffSnap.data();
          officeId = staffData.officeId || "";
          sName = staffData.name || staffData.fullName || "";
        }
      }

      for (let i = 0; i < readyItems.length; i++) {
        const item = readyItems[i];
        const childId = item.matchedChildId;
        const childObj = childrenData.find(c => c.id === childId);
        const childName = childObj?.fullName || '';

        setImportProgress({
          current: i + 1,
          total: readyItems.length,
          currentName: `${childName} (${item.planMonth})`
        });

        const batch = writeBatch(db);

        // A) supportPlans メタ
        const docId = `${childId}_${item.planMonth}`;
        const planMetaRef = doc(db, 'supportPlans', docId);
        const metaPayload = {
          childId,
          month: item.planMonth,
          goals: '',
          author: sName,
          createdAt: new Date().toISOString()
        };
        batch.set(planMetaRef, metaPayload, { merge: true });

        // B) 各日報データ
        for (const row of item.parsedRows) {
          const [yearStr] = item.planMonth.split('-');
          const mMatch = row.date.match(/(\d+)月/);
          const dMatch = row.date.match(/(\d+)日/);
          const monthNum = mMatch ? parseInt(mMatch[1]) : 1;
          const dayNum = dMatch ? parseInt(dMatch[1]) : 1;
          const pad = (n: number) => n.toString().padStart(2, '0');
          const formattedDate = `${yearStr}-${pad(monthNum)}-${pad(dayNum)}`;

          const payload = {
            childId,
            planMonth: item.planMonth,
            date: formattedDate,
            staffId: '',
            staffName: sName,
            type: 'tree_report',
            content: row.content,
            externalInfo: row.content.externalInfo || "",
            archived: false,
            updatedAt: serverTimestamp(),
            createdAt: serverTimestamp()
          };

          const newDocRef = doc(collection(db, 'daily_reports'));
          batch.set(newDocRef, payload);

          // C) reports 一括レポート
          const reportDoc = {
            results: {
              [childId]: {
                D: row.content.externalInfo || ""
              }
            },
            updatedAt: new Date().toISOString()
          };

          const reportRefNoPref = doc(db, 'reports', formattedDate);
          batch.set(reportRefNoPref, reportDoc, { merge: true });

          if (officeId) {
            const reportRefPref = doc(db, 'reports', `${officeId}_${formattedDate}`);
            batch.set(reportRefPref, reportDoc, { merge: true });
          }

          // D) tree_communications リアルタイム同期
          const childTreeRef = doc(db, `children/${childId}/app_categories/書類管理/tree_communications`, formattedDate);
          const childTreeDoc = {
            name: childName,
            tree_comm_text: row.content.externalInfo || "",
            pickupLocation: "",
            endTime: "",
            transportTime: "",
            notes: "",
            updatedAt: new Date().toISOString()
          };
          batch.set(childTreeRef, childTreeDoc, { merge: true });
        }

        await batch.commit();
      }

      alert('すべての一括インポートが正常に完了しました！');
      setImportFiles([]);
    } catch (err: any) {
      console.error(err);
      alert(`インポート中にエラーが発生しました: ${err.message || String(err)}`);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="max-w-[1400px] mx-auto flex flex-col gap-8 pb-20 animate-fade-in">
      {/* 保存/インポート中のオーバーレイ */}
      {isImporting && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl flex flex-col items-center text-center">
            <Loader2 className="animate-spin text-primary mb-6" size={48} />
            <h3 className="text-xl font-black text-slate-800 mb-2">一括インポート中</h3>
            <p className="text-sm text-slate-500 font-medium mb-6">
              児童の記録データをFirestoreへ保存しています…
            </p>
            <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden mb-2">
              <div 
                className="bg-primary h-full transition-all duration-300"
                style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
              />
            </div>
            <div className="flex justify-between w-full text-xs font-bold text-slate-400">
              <span>処理中: {importProgress.currentName}</span>
              <span>{importProgress.current} / {importProgress.total} 件</span>
            </div>
          </div>
        </div>
      )}

      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <SettingsIcon size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800 tracking-tight">システム設定</h1>
            <p className="text-sm text-slate-500">書類の基本パラメータの管理や、エクセルデータの一括インポートを行います</p>
          </div>
        </div>
        
        {activeTab !== 'bulk-import' && (
          <button
            onClick={handleSave}
            disabled={isSaving || isLoading}
            className={`btn-primary flex items-center gap-2 px-6 py-2.5 shadow-lg shadow-primary/20 transition-all active:scale-95 ${
              saveStatus === 'success' ? 'bg-emerald-500 hover:bg-emerald-600' : ''
            }`}
          >
            {isSaving ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : saveStatus === 'success' ? (
              <CheckCircle2 size={20} />
            ) : (
              <Save size={20} />
            )}
            <span>{isSaving ? '保存中...' : saveStatus === 'success' ? '保存完了' : '設定を保存'}</span>
          </button>
        )}
      </div>

      {/* メインレイアウト */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* 左サイド: 月選択 */}
        <div className="lg:col-span-1 flex flex-col gap-4">
          <div className="glass-panel p-6 bg-white/50 border-primary/10">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Calendar size={16} /> 対象月の選択
            </h3>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-lg font-bold text-slate-700 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
            />
            <p className="mt-3 text-xs text-slate-400 leading-relaxed text-center">
              設定の適用月、および一括インポートするエクセルデータの対象月を指定します。
            </p>
          </div>
        </div>

        {/* 右サイド: 各設定 / インポートフォーム */}
        <div className="lg:col-span-3 flex flex-col gap-6">
          <div className="glass-panel overflow-hidden border-primary/5 bg-white/80 shadow-xl shadow-slate-200/50 flex flex-col min-h-[600px]">
            {/* タブ */}
            <div className="flex border-b border-slate-100 bg-slate-50/50">
              <button
                onClick={() => setActiveTab('implementation')}
                className={`flex-1 flex items-center justify-center gap-2 py-4 text-sm font-bold transition-all ${
                  activeTab === 'implementation'
                    ? 'bg-white text-primary border-b-2 border-primary shadow-[0_2px_10px_-4px_rgba(0,0,0,0.1)]'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                <FileText size={18} /> 専門的支援実施計画
              </button>
              <button
                onClick={() => setActiveTab('perspective')}
                className={`flex-1 flex items-center justify-center gap-2 py-4 text-sm font-bold transition-all ${
                  activeTab === 'perspective'
                    ? 'bg-white text-primary border-b-2 border-primary shadow-[0_2px_10px_-4px_rgba(0,0,0,0.1)]'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                <FileText size={18} /> 専門的支援計画
              </button>
              <button
                onClick={() => setActiveTab('bulk-import')}
                className={`flex-1 flex items-center justify-center gap-2 py-4 text-sm font-bold transition-all ${
                  activeTab === 'bulk-import'
                    ? 'bg-white text-primary border-b-2 border-primary shadow-[0_2px_10px_-4px_rgba(0,0,0,0.1)]'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                <UploadCloud size={18} /> 複数ファイル一括インポート
              </button>
            </div>

            <div className="p-8 flex-1 flex flex-col">
              {activeTab === 'bulk-import' ? (
                // 一括インポート UI
                <div className="space-y-6 flex-1 flex flex-col">
                  <div className="bg-emerald-50/70 border border-emerald-100 rounded-2xl p-5 text-[13px] text-emerald-800 leading-relaxed font-medium">
                    <p className="flex items-center gap-2 mb-2 font-bold"><UploadCloud size={14} /> 複数ファイル一括インポートの使い方</p>
                    <ol className="list-decimal list-inside space-y-1 ml-1 opacity-90">
                      <li>上の左パネルで、インポートしたい<strong>対象月（例: 2026年5月）を選択</strong>します。</li>
                      <li>複数児童分の実施計画エクセルファイル（.xlsx / .xls）をまとめてドラッグ＆ドロップします（40人分等も一度に対応可能です）。</li>
                      <li>各ファイルから児童名を検出してシステム上の児童と自動で紐付けます。不一致や揺れがある箇所は手動で再割り当てができます。</li>
                      <li>内容と紐付けを確認し、「一括登録を実行」を押すと、全児童の実施計画にデータが一度に保存されます。</li>
                    </ol>
                  </div>

                  {/* ドロップエリア */}
                  <div 
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full h-48 bg-slate-50 hover:bg-slate-50/70 border-2 border-dashed border-slate-200 hover:border-primary/40 rounded-2xl transition-all flex flex-col items-center justify-center cursor-pointer p-6 group"
                  >
                    <input 
                      type="file" 
                      ref={fileInputRef}
                      onChange={handleFileChange}
                      accept=".xlsx, .xls"
                      multiple
                      className="hidden"
                    />
                    <div className="w-12 h-12 rounded-full bg-slate-100 group-hover:bg-primary/10 text-slate-400 group-hover:text-primary transition-colors flex items-center justify-center mb-3">
                      <UploadCloud size={24} />
                    </div>
                    <h4 className="text-base font-bold text-slate-800 mb-1">複数のエクセルファイルをドラッグ＆ドロップ</h4>
                    <p className="text-xs text-slate-400 font-semibold">またはクリックしてファイルを選択 (複数選択可能)</p>
                  </div>

                  {/* プレビューテーブル */}
                  {importFiles.length > 0 && (
                    <div className="space-y-4 flex-1 flex flex-col">
                      <div className="flex items-center justify-between">
                        <h3 className="font-bold text-slate-700 flex items-center gap-2">
                          読み込みファイル一覧 ({importFiles.length}件)
                        </h3>
                        <button 
                          onClick={() => setImportFiles([])}
                          className="text-xs text-red-500 font-bold hover:underline flex items-center gap-1"
                        >
                          <X size={14} /> リストをクリア
                        </button>
                      </div>

                      <div className="border border-slate-150 rounded-2xl overflow-hidden flex-1 overflow-y-auto max-h-[400px]">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 font-bold sticky top-0 z-10">
                              <th className="p-3 w-[250px]">ファイル名</th>
                              <th className="p-3 w-[120px]">エクセル内の氏名</th>
                              <th className="p-3 w-[220px]">システム上の紐付け先児童（変更可）</th>
                              <th className="p-3 w-[80px]">対象月</th>
                              <th className="p-3 w-[80px]">検出行数</th>
                              <th className="p-3">状態/メッセージ</th>
                            </tr>
                          </thead>
                          <tbody>
                            {importFiles.map((item, idx) => (
                              <tr key={idx} className="border-b border-slate-50 hover:bg-slate-50/50">
                                <td className="p-3 font-semibold text-slate-700 truncate max-w-[250px]" title={item.fileName}>
                                  {item.fileName}
                                </td>
                                <td className="p-3 font-bold text-slate-800">
                                  {item.detectedName || <span className="text-red-500 italic">検出不可</span>}
                                </td>
                                <td className="p-3">
                                  <select
                                    value={item.matchedChildId}
                                    onChange={(e) => handleMapChildChange(idx, e.target.value)}
                                    className={`w-full border rounded-lg px-2 py-1.5 font-bold outline-none text-xs transition-all ${
                                      item.matchedChildId 
                                        ? 'border-slate-200 text-slate-700 bg-white' 
                                        : 'border-amber-300 text-amber-800 bg-amber-50'
                                    }`}
                                  >
                                    <option value="">-- 児童を選択してください --</option>
                                    {childrenData.map(c => (
                                      <option key={c.id || ''} value={c.id || ''}>
                                        {c.fullName} ({c.grade})
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td className="p-3 font-bold text-slate-600">{item.planMonth}</td>
                                <td className="p-3 font-bold text-slate-800 text-center">
                                  {item.parsedRows.length > 0 ? (
                                    <span className="text-emerald-600">{item.parsedRows.length}日分</span>
                                  ) : (
                                    <span className="text-slate-400">0件</span>
                                  )}
                                </td>
                                <td className="p-3">
                                  <div className="flex items-center gap-2">
                                    {item.status === 'success' && (
                                      <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold border border-emerald-100">
                                        <Check size={10} /> 準備完了
                                      </span>
                                    )}
                                    {item.status === 'warning' && (
                                      <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-bold border border-amber-100">
                                        <AlertCircle size={10} /> 児童紐付け待ち
                                      </span>
                                    )}
                                    {item.status === 'error' && (
                                      <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-red-50 text-red-700 font-bold border border-red-100">
                                        <X size={10} /> 解析エラー
                                      </span>
                                    )}
                                    <span className="text-slate-500 font-medium truncate max-w-[200px]" title={item.message}>
                                      {item.message}
                                    </span>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* 実行ボタン */}
                      <div className="pt-4 border-t flex justify-end">
                        <button
                          onClick={handleBulkImport}
                          disabled={importFiles.filter(item => item.status === 'success' && item.matchedChildId).length === 0}
                          className="px-8 py-3 bg-primary hover:bg-primary-hover text-white font-bold rounded-xl shadow-lg shadow-primary/20 active:scale-95 disabled:opacity-50 disabled:active:scale-100 flex items-center gap-2"
                        >
                          <Check size={18} />
                          <span>紐付けされた {importFiles.filter(item => item.status === 'success' && item.matchedChildId).length} 件のデータを一括登録</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                // 既存の月次パラメータ設定 UI
                isLoading ? (
                  <div className="flex flex-col items-center justify-center py-20 gap-4 flex-1">
                    <div className="w-12 h-12 border-4 border-primary/10 border-t-primary rounded-full animate-spin" />
                    <p className="text-slate-400 font-medium">設定を読み込み中...</p>
                  </div>
                ) : (
                  <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2">
                    {/* 作成日設定 */}
                    <div className="space-y-4">
                      <label className="text-sm font-bold text-slate-700 flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                        デフォルト作成年月日
                      </label>
                      <div className="grid grid-cols-3 gap-4">
                        <div className="relative group">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 font-bold pointer-events-none group-focus-within:text-primary transition-colors">令和</span>
                          <input
                            type="number"
                            value={activeTab === 'implementation' ? settings.implementationYear : settings.perspectiveYear}
                            onChange={(e) => updateSettings({ 
                              [activeTab === 'implementation' ? 'implementationYear' : 'perspectiveYear']: e.target.value 
                            })}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl py-4 pl-10 pr-6 font-bold text-slate-700 outline-none focus:bg-white focus:ring-4 focus:ring-primary/5 focus:border-primary transition-all text-right"
                          />
                          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-medium pointer-events-none">年</span>
                        </div>
                        <div className="relative group">
                          <input
                            type="number"
                            value={activeTab === 'implementation' ? settings.implementationMonth : settings.perspectiveMonth}
                            onChange={(e) => updateSettings({ 
                              [activeTab === 'implementation' ? 'implementationMonth' : 'perspectiveMonth']: e.target.value 
                            })}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl py-4 px-4 font-bold text-slate-700 outline-none focus:bg-white focus:ring-4 focus:ring-primary/5 focus:border-primary transition-all text-right pr-6"
                          />
                          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-medium pointer-events-none">月</span>
                        </div>
                        <div className="relative group">
                          <input
                            type="number"
                            value={activeTab === 'implementation' ? settings.implementationDay : settings.perspectiveDay}
                            onChange={(e) => updateSettings({ 
                              [activeTab === 'implementation' ? 'implementationDay' : 'perspectiveDay']: e.target.value 
                            })}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl py-4 px-4 font-bold text-slate-700 outline-none focus:bg-white focus:ring-4 focus:ring-primary/5 focus:border-primary transition-all text-right pr-6"
                          />
                          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-medium pointer-events-none">日作成</span>
                        </div>
                      </div>
                    </div>

                    {/* 作成者設定 */}
                    <div className="space-y-4">
                      <label className="text-sm font-bold text-slate-700 flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                        作成者
                      </label>
                      <div className="relative group">
                        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors">
                          <User size={20} />
                        </div>
                        <input
                          type="text"
                          placeholder="作成者名を入力"
                          value={activeTab === 'implementation' ? settings.implementationCreator : settings.perspectiveCreator}
                          onChange={(e) => updateSettings({ 
                            [activeTab === 'implementation' ? 'implementationCreator' : 'perspectiveCreator']: e.target.value 
                          })}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl py-4 pl-12 pr-4 font-bold text-slate-700 outline-none focus:bg-white focus:ring-4 focus:ring-primary/5 focus:border-primary transition-all"
                        />
                      </div>
                    </div>

                    {/* プレビュー */}
                    <div className="mt-12 p-6 bg-slate-50 rounded-2xl border border-slate-200 border-dashed">
                      <div className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">表示プレビュー</div>
                      <div className="flex flex-col md:flex-row md:items-center gap-2 text-slate-600 font-medium">
                        <div className="flex items-center gap-1.5">
                          <span>令和</span>
                          <span className="text-primary font-bold text-lg">{activeTab === 'implementation' ? settings.implementationYear || '?' : settings.perspectiveYear || '?'}</span>
                          <span>年</span>
                          <span className="text-primary font-bold text-lg">{activeTab === 'implementation' ? settings.implementationMonth || '?' : settings.perspectiveMonth || '?'}</span>
                          <span>月</span>
                          <span className="text-primary font-bold text-lg">{activeTab === 'implementation' ? settings.implementationDay || '?' : settings.perspectiveDay || '?'}</span>
                          <span>日作成</span>
                        </div>
                        <span className="hidden md:inline mx-2 text-slate-300">|</span>
                        <div className="flex items-center gap-1.5">
                          <span>作成者：</span>
                          <span className="text-primary font-bold text-lg underline decoration-primary/20 decoration-2 underline-offset-4">
                            {activeTab === 'implementation' ? settings.implementationCreator || '未設定' : settings.perspectiveCreator || '未設定'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      </div>

      {/* フッターヒント */}
      <div className="flex items-center justify-center gap-6 py-8 border-t border-slate-100">
        <div className="flex items-center gap-2 text-slate-400 text-xs">
          <div className="w-2 h-2 rounded-full bg-emerald-500" />
          自動保存はされません（一括登録除く）
        </div>
        <div className="flex items-center gap-2 text-slate-400 text-xs">
          <div className="w-2 h-2 rounded-full bg-amber-500" />
          設定は全児童に反映されます
        </div>
      </div>
    </div>
  );
};
