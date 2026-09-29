import React, { useState, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { 
  FolderOpen, FileSpreadsheet, CheckCircle2, AlertCircle, 
  Loader2, Check, X, ArrowDownToLine, Calendar, Info
} from 'lucide-react';
import { collection, query, where, getDocs, doc, getDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import type { Child } from '../data/mockData';
import * as XLSX from 'xlsx';

interface BatchExcelImportProps {
  selectedMonth: string; // "YYYY-MM"
  childrenData: Child[];
}

interface ParsedRecord {
  date: string;            // "8月12日"
  formattedDate: string;   // "2026-08-12"
  supportContent: string[];
  resultInfo: string;
  futurePlan: string;
}

interface ScannedImportItem {
  fileName: string;
  detectedName: string;
  matchedChildId: string;
  matchedChildName: string;
  targetSheetName: string;
  excelGoals: string;
  records: ParsedRecord[];
  status: 'ready' | 'no-child' | 'no-sheet' | 'no-records' | 'success' | 'error';
  errorMessage?: string;
  selected: boolean;
}

export const BatchExcelImport: React.FC<BatchExcelImportProps> = ({
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
  const [scannedItems, setScannedItems] = useState<ScannedImportItem[]>([]);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [progress, setProgress] = useState<{ current: number; total: number; currentItemName: string }>({
    current: 0,
    total: 0,
    currentItemName: ''
  });
  const [logs, setLogs] = useState<string[]>([]);
  const [isFinished, setIsFinished] = useState<boolean>(false);

  // オプション設定
  const [importGoals, setImportGoals] = useState<boolean>(false); // 支援目標もインポートするか
  const [isOverwrite, setIsOverwrite] = useState<boolean>(true);  // 既存日報を上書きするか

  const fallbackFolderInputRef = useRef<HTMLInputElement>(null);

  // 月変更時の同期
  React.useEffect(() => {
    if (initialMonth) {
      setTargetMonth(initialMonth);
    }
  }, [initialMonth]);

  // 名前の正規化
  const normalize = (s?: string) => (s || '').replace(/[\s　\u200B-\u200D\uFEFF]/g, '').toLowerCase();

  // 児童照合ロジック
  const matchChild = (rawName: string, fileName: string): Child | null => {
    const normRaw = normalize(rawName);
    const normFile = normalize(fileName);

    // 1. 検出された氏名で完全一致
    if (normRaw) {
      const c1 = childrenData.find(c => normalize(c.fullName) === normRaw);
      if (c1) return c1;
      const c2 = childrenData.find(c => normalize(c.nameKana) === normRaw);
      if (c2) return c2;
    }

    // 2. 部分一致（検出氏名とシステム氏名）
    if (normRaw && normRaw.length >= 2) {
      const c3 = childrenData.find(c => {
        const full = normalize(c.fullName);
        const kana = normalize(c.nameKana);
        return (full && (full.includes(normRaw) || normRaw.includes(full))) ||
               (kana && (kana.includes(normRaw) || normRaw.includes(kana)));
      });
      if (c3) return c3;
    }

    // 3. ファイル名から推測
    const cFile = childrenData.find(c => {
      const full = normalize(c.fullName);
      const kana = normalize(c.nameKana);
      return (full && normFile.includes(full)) || (kana && normFile.includes(kana));
    });
    if (cFile) return cFile;

    return null;
  };

  // シート名またはグリッドから対象月に合致するシートを判定する
  const isSheetMatchingTargetMonth = (sheetName: string, targetYearMonth: string, grid: any[][]): boolean => {
    const cleanName = sheetName.replace(/[\s　]+/g, '');
    if (cleanName === '原本' || cleanName.includes('原本')) return false;

    const [targetY, targetM] = targetYearMonth.split('-');
    const mNum = parseInt(targetM, 10);
    const targetYmCompact = `${targetY}${targetM.padStart(2, '0')}`; // "202608"

    // 1) "202608" または "2026-08" または "2026_08"
    if (cleanName === targetYmCompact || cleanName === `${targetY}-${targetM}` || cleanName.startsWith(targetYmCompact)) {
      return true;
    }

    // 2) "2026年8月" または "2026年08月"
    if (cleanName === `${targetY}年${mNum}月` || cleanName === `${targetY}年${targetM}月`) {
      return true;
    }

    // 3) "8月" または "08月" または "8" (年表記なしの場合、シート内テキストで年を検証)
    if (cleanName === `${mNum}月` || cleanName === `${targetM}月` || cleanName === String(mNum)) {
      // グリッド先頭15行を走査して年を特定
      for (let r = 0; r < Math.min(grid.length, 15); r++) {
        const row = grid[r] || [];
        for (let c = 0; c < row.length; c++) {
          const val = String(row[c] || '').trim();
          if (val.includes(targetY)) return true;
          // 令和年判定: 2026年 -> 令和8年
          const rYear = parseInt(targetY, 10) - 2018;
          if (val.includes(`令和${rYear}`) || val.includes(`令和${rYear === 1 ? '元' : rYear}年`)) {
            return true;
          }
        }
      }
      // 特に他の年が見つからなければ、このシートを該当月とみなす
      return true;
    }

    // 4) シート名に含まれる場合
    if (cleanName.includes(targetYmCompact) || cleanName.includes(`${targetY}年${mNum}月`)) {
      return true;
    }

    // 5) シート名が年なしでも、グリッド内に「令和○年 ○月」や「YYYY年 MM月」と明記されている場合
    for (let r = 0; r < Math.min(grid.length, 15); r++) {
      const row = grid[r] || [];
      for (let c = 0; c < row.length; c++) {
        const val = String(row[c] || '').trim();
        const rYear = parseInt(targetY, 10) - 2018;
        if (
          (val.includes(`令和${rYear}年`) || val.includes(`令和 ${rYear} 年`) || val.includes(`${targetY}年`)) &&
          (val.includes(`${mNum}月`) || val.includes(`${targetM}月`))
        ) {
          return true;
        }
      }
    }

    return false;
  };

  // 単一シートから日報レコードをパース
  const parseSheetRecords = (grid: any[][], targetYearMonth: string): { records: ParsedRecord[]; goals: string } => {
    const [targetY, targetM] = targetYearMonth.split('-');
    const defaultMonthNum = parseInt(targetM, 10);

    // 1. 支援目標の検出
    let excelGoals = '';
    const goalLines: string[] = [];
    for (let r = 0; r < Math.min(grid.length, 15); r++) {
      const row = grid[r] || [];
      for (let c = 0; c < row.length; c++) {
        const val = String(row[c] || '').replace(/[\s　]+/g, '');
        if (val === '支援目標' || (val.includes('支援目標') && !val.includes('具体的支援目標'))) {
          // 右隣のセルまたは下行
          for (let ro = 0; ro <= 5; ro++) {
            const tr = grid[r + ro];
            if (!tr) continue;
            const gVal = String(tr[c] || tr[0] || '').trim();
            if (gVal && !gVal.includes('日付') && !gVal.includes('令和') && !gVal.includes('療育内容')) {
              if (!goalLines.includes(gVal)) goalLines.push(gVal);
            }
          }
          break;
        }
      }
      if (goalLines.length > 0) break;
    }
    excelGoals = goalLines.join('\n').trim();

    // 2. テーブルヘッダーとレコードの検出
    let headerRowIdx = -1;
    let dateIdx = -1;
    let supportIdx = -1;
    let resultIdx = -1;
    let futureIdx = -1;

    for (let r = 0; r < grid.length; r++) {
      const row = grid[r];
      if (!row || !Array.isArray(row)) continue;

      const cleanCells = Array.from(row).map(val => String(val || '').replace(/[\s　\n\r]+/g, ''));
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
      return { records: [], goals: excelGoals };
    }

    const SUPPORT_CONTENT_OPTIONS = [
      '①認知・行動',
      '②運動・感覚',
      '③言語・コミュニケーション',
      '④健康・生活',
      '⑤人間関係・社会性'
    ];

    const records: ParsedRecord[] = [];
    let currentDateStr = '';
    let currentFormattedDate = '';
    let currentSupport: string[] = [];
    let resultLines: string[] = [];
    let futureLines: string[] = [];

    const commitCurrent = () => {
      if (currentFormattedDate && (currentSupport.length > 0 || resultLines.length > 0 || futureLines.length > 0)) {
        records.push({
          date: currentDateStr,
          formattedDate: currentFormattedDate,
          supportContent: [...currentSupport],
          resultInfo: resultLines.join('\n').trim(),
          futurePlan: futureLines.join('\n').trim()
        });
      }
    };

    for (let r = headerRowIdx + 1; r < grid.length; r++) {
      const row = grid[r];
      if (!row) continue;

      const rawDateVal = row[dateIdx];
      let firstColVal = '';
      if (typeof rawDateVal === 'number') {
        // Excelシリアル値 (1900年基準)
        const dateObj = new Date(Math.round((rawDateVal - 25569) * 86400 * 1000));
        const m = dateObj.getMonth() + 1;
        const d = dateObj.getDate();
        firstColVal = `${m}月${d}日`;
      } else {
        firstColVal = String(rawDateVal || '').trim();
      }

      // フッター判定
      if (firstColVal.includes('作成者') || firstColVal.includes('署名') || firstColVal.includes('令和')) {
        break;
      }

      // 日付判定
      let isNewDate = false;
      let parsedDateText = '';
      let formattedYmd = '';

      if (firstColVal !== '') {
        // "8月12日" or "2026-08-12"
        const ymdMatch = firstColVal.match(/(?:\d{4}|\d{2})[年/\-.]\s*(\d{1,2})[月/\-.]\s*(\d{1,2})日?/);
        const mdMatch = firstColVal.match(/(\d{1,2})[月/\-.]\s*(\d{1,2})日?/);
        const dayOnlyMatch = firstColVal.match(/^(\d{1,2})日?$/);

        if (ymdMatch) {
          const m = parseInt(ymdMatch[1], 10);
          const d = parseInt(ymdMatch[2], 10);
          parsedDateText = `${m}月${d}日`;
          formattedYmd = `${targetY}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          isNewDate = true;
        } else if (mdMatch) {
          const m = parseInt(mdMatch[1], 10);
          const d = parseInt(mdMatch[2], 10);
          parsedDateText = `${m}月${d}日`;
          formattedYmd = `${targetY}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          isNewDate = true;
        } else if (dayOnlyMatch) {
          const d = parseInt(dayOnlyMatch[1], 10);
          parsedDateText = `${defaultMonthNum}月${d}日`;
          formattedYmd = `${targetY}-${targetM.padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          isNewDate = true;
        }
      }

      if (isNewDate) {
        commitCurrent();
        currentDateStr = parsedDateText;
        currentFormattedDate = formattedYmd;
        currentSupport = [];
        resultLines = [];
        futureLines = [];
      }

      if (currentFormattedDate) {
        // 療育内容
        if (supportIdx !== -1 && row[supportIdx]) {
          const rawSup = String(row[supportIdx]).trim();
          SUPPORT_CONTENT_OPTIONS.forEach(opt => {
            const kw = opt.replace(/^[①-⑤]/, '').split('・')[0];
            if (rawSup.includes(kw) && !currentSupport.includes(opt)) {
              currentSupport.push(opt);
            }
          });
        }

        // 療育結果・今後の予定
        if (resultIdx !== -1 && row[resultIdx]) {
          const rText = String(row[resultIdx]).trim();
          if (rText && !resultLines.includes(rText)) {
            resultLines.push(rText);
          }
        }
        if (futureIdx !== -1 && row[futureIdx]) {
          const fText = String(row[futureIdx]).trim();
          if (fText && !futureLines.includes(fText)) {
            futureLines.push(fText);
          }
        }
      }
    }
    commitCurrent();

    return { records, goals: excelGoals };
  };

  // ファイル群のスキャン実行処理
  const executeScanFiles = async (fileEntries: { name: string; getFile: () => Promise<File> }[]) => {
    setIsScanning(true);
    setScannedItems([]);
    setScanProgress({ current: 0, total: fileEntries.length, fileName: '' });
    setLogs([`📁 フォルダ内のエクセルファイル（${fileEntries.length}件）のスキャンを開始します...`]);

    const items: ScannedImportItem[] = [];

    for (let i = 0; i < fileEntries.length; i++) {
      const entry = fileEntries[i];
      setScanProgress({ current: i + 1, total: fileEntries.length, fileName: entry.name });

      try {
        const file = await entry.getFile();
        const arrayBuffer = await file.arrayBuffer();
        const wb = XLSX.read(arrayBuffer, { type: 'array' });

        // 児童名検出
        let detectedName = '';
        for (const sName of wb.SheetNames) {
          const ws = wb.Sheets[sName];
          if (!ws) continue;
          if (ws['I2']?.v) {
            detectedName = String(ws['I2'].v).trim();
            break;
          }
          const grid = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });
          for (let r = 0; r < Math.min(grid.length, 12); r++) {
            const row = grid[r] || [];
            for (let c = 0; c < row.length; c++) {
              const val = String(row[c] || '').replace(/[\s　]+/g, '');
              if (val === '名前' || val === '氏名' || val.includes('利用児氏名')) {
                const neighbor = String(row[c + 1] || row[c + 2] || '').trim();
                if (neighbor && neighbor !== '様' && neighbor !== '[') {
                  detectedName = neighbor.replace(/[様\[\]\s　]+/g, '');
                  break;
                }
              }
            }
            if (detectedName) break;
          }
          if (detectedName) break;
        }

        const matched = matchChild(detectedName, entry.name);

        // 対象月に合致するシートを探索
        let matchedSheetName = '';
        let matchedGrid: any[][] = [];

        for (const sheetName of wb.SheetNames) {
          const ws = wb.Sheets[sheetName];
          if (!ws) continue;
          const grid = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });
          if (isSheetMatchingTargetMonth(sheetName, targetMonth, grid)) {
            matchedSheetName = sheetName;
            matchedGrid = grid;
            break;
          }
        }

        if (!matchedSheetName) {
          items.push({
            fileName: entry.name,
            detectedName: detectedName || '未検出',
            matchedChildId: matched?.id || '',
            matchedChildName: matched?.fullName || '未照合',
            targetSheetName: '該当月シートなし',
            excelGoals: '',
            records: [],
            status: 'no-sheet',
            errorMessage: `対象月（${targetMonth}）のシートが見つかりませんでした`,
            selected: false
          });
          continue;
        }

        // レコードパース
        const { records, goals } = parseSheetRecords(matchedGrid, targetMonth);

        let status: ScannedImportItem['status'] = 'ready';
        let errorMessage: string | undefined;

        if (!matched) {
          status = 'no-child';
          errorMessage = '児童マスタと照合できませんでした（手動選択してください）';
        } else if (records.length === 0) {
          status = 'no-records';
          errorMessage = '日報レコード（日付・療育内容等）が見つかりませんでした';
        }

        items.push({
          fileName: entry.name,
          detectedName: detectedName || '未検出',
          matchedChildId: matched?.id || '',
          matchedChildName: matched?.fullName || '未照合',
          targetSheetName: matchedSheetName,
          excelGoals: goals,
          records,
          status,
          errorMessage,
          selected: status === 'ready'
        });

      } catch (err: any) {
        console.error(`Error scanning ${entry.name}:`, err);
        items.push({
          fileName: entry.name,
          detectedName: '',
          matchedChildId: '',
          matchedChildName: '',
          targetSheetName: '',
          excelGoals: '',
          records: [],
          status: 'error',
          errorMessage: err.message || 'ファイル解析エラー',
          selected: false
        });
      }
    }

    setScannedItems(items);
    setIsScanning(false);
    setIsModalOpen(true);
    setLogs(prev => [
      ...prev,
      `✔ 解析完了: 計 ${items.length} 件（対象月データ検出: ${items.filter(i => i.records.length > 0).length} 件）`
    ]);
  };

  // フォルダ選択ハンドラー (showDirectoryPicker)
  const handleSelectFolder = async () => {
    if ('showDirectoryPicker' in window) {
      try {
        const dirHandle = await (window as any).showDirectoryPicker({ mode: 'read' });
        const excelFiles: any[] = [];
        for await (const entry of dirHandle.values()) {
          if (entry.kind === 'file' && (entry.name.endsWith('.xlsx') || entry.name.endsWith('.xls')) && !entry.name.startsWith('~$')) {
            excelFiles.push(entry);
          }
        }
        if (excelFiles.length === 0) {
          alert('指定されたフォルダ内に有効なExcelファイル (.xlsx) が見つかりませんでした。');
          return;
        }
        await executeScanFiles(excelFiles);
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.error('Directory picker error:', err);
          fallbackFolderInputRef.current?.click();
        }
      }
    } else {
      fallbackFolderInputRef.current?.click();
    }
  };

  // フォールバック用 input folder
  const handleFallbackFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const entries = Array.from(files)
      .filter(f => (f.name.endsWith('.xlsx') || f.name.endsWith('.xls')) && !f.name.startsWith('~$'))
      .map(f => ({ name: f.name, getFile: async () => f }));

    if (entries.length === 0) {
      alert('有効なExcelファイルが見つかりませんでした。');
      return;
    }
    executeScanFiles(entries);
    e.target.value = '';
  };

  // 児童選択変更
  const handleMapChildChange = (index: number, newChildId: string) => {
    setScannedItems(prev => prev.map((item, i) => {
      if (i !== index) return item;
      const child = childrenData.find(c => c.id === newChildId);
      const isOk = !!child && item.records.length > 0;
      return {
        ...item,
        matchedChildId: newChildId,
        matchedChildName: child?.fullName || '未照合',
        status: isOk ? 'ready' : (child ? 'no-records' : 'no-child'),
        errorMessage: isOk ? undefined : item.errorMessage,
        selected: isOk
      };
    }));
  };

  // 全選択 / 解除
  const handleToggleSelectAll = (select: boolean) => {
    setScannedItems(prev => prev.map(item => {
      if (select && (!item.matchedChildId || item.records.length === 0)) {
        return item; // 照合されていない、またはレコードがないものは選択しない
      }
      return { ...item, selected: select };
    }));
  };

  // 一括インポート（Firestoreへ保存）
  const handleExecuteBatchImport = async () => {
    const targets = scannedItems.filter(item => item.selected && item.matchedChildId && item.records.length > 0);
    if (targets.length === 0) {
      alert('インポート対象として選択されたファイルがありません。');
      return;
    }

    const totalRecords = targets.reduce((sum, item) => sum + item.records.length, 0);
    const confirmMsg = `選択された ${targets.length} 人（計 ${totalRecords} 件の日報データ）を、システム（${targetMonth}分）へ一括インポートします。\nよろしいですか？`;
    if (!window.confirm(confirmMsg)) return;

    setIsProcessing(true);
    setIsFinished(false);
    setLogs([`🚀 一括インポートを開始します（児童数: ${targets.length}人 / 総レコード数: ${totalRecords}件）...`]);

    try {
      let staffName = 'スタッフ';
      let staffOfficeId = '';
      if (auth.currentUser) {
        try {
          const staffSnap = await getDoc(doc(db, 'staff', auth.currentUser.uid));
          if (staffSnap.exists()) {
            const sd = staffSnap.data();
            staffName = sd.fullName || sd.name || 'スタッフ';
            staffOfficeId = sd.officeId || '';
          }
        } catch (e) {
          console.warn('Staff fetch error:', e);
        }
      }

      let currentBatch = writeBatch(db);
      let batchOpCount = 0;
      const MAX_BATCH_OPS = 250;

      const commitBatchIfNeeded = async (force: boolean = false) => {
        if (batchOpCount > 0 && (force || batchOpCount >= MAX_BATCH_OPS)) {
          await currentBatch.commit();
          currentBatch = writeBatch(db);
          batchOpCount = 0;
        }
      };

      let processedRecords = 0;

      for (let i = 0; i < targets.length; i++) {
        const item = targets[i];
        setProgress({ current: i + 1, total: targets.length, currentItemName: item.matchedChildName });
        setLogs(prev => [...prev, `▶ [${i + 1}/${targets.length}] 「${item.matchedChildName}」様（${item.records.length}件）を登録中...`]);

        const childId = item.matchedChildId;

        // 1. supportPlans（計画目標）の更新（オプションで目標インポートがON、かつ目標がある場合）
        if (importGoals && item.excelGoals) {
          const planDocId = staffOfficeId ? `${staffOfficeId}_${childId}_${targetMonth}` : `${childId}_${targetMonth}`;
          const planRef = doc(db, 'supportPlans', planDocId);
          currentBatch.set(planRef, {
            childId,
            month: targetMonth,
            goals: item.excelGoals,
            author: staffName,
            officeId: staffOfficeId || '',
            updatedAt: serverTimestamp()
          }, { merge: true });
          batchOpCount++;
          await commitBatchIfNeeded();
        }

        // 2. 既存の日報データを取得（既存のツリー通信テキストやIDをマージするため）
        const existingMap = new Map<string, { id: string; externalInfo: string; futurePlan: string }>();
        try {
          const q = query(
            collection(db, 'daily_reports'),
            where('childId', '==', childId),
            where('planMonth', '==', targetMonth)
          );
          const snap = await getDocs(q);
          snap.forEach(d => {
            const data = d.data();
            if (data.date) {
              existingMap.set(data.date, {
                id: d.id,
                externalInfo: data.content?.externalInfo || data.externalInfo || '',
                futurePlan: data.content?.futurePlan || ''
              });
            }
          });
        } catch (e) {
          console.warn(`Failed to fetch existing reports for ${childId}:`, e);
        }

        // 3. 各日報レコードの登録
        for (const rec of item.records) {
          const existing = existingMap.get(rec.formattedDate);
          const finalExternalInfo = existing?.externalInfo || '';
          
          let finalFuture = rec.futurePlan;
          if (existing?.futurePlan && !isOverwrite) {
            finalFuture = existing.futurePlan;
          }

          const dailyPayload: any = {
            childId,
            planMonth: targetMonth,
            date: rec.formattedDate,
            staffId: auth.currentUser?.uid || '',
            staffName,
            type: 'tree_report',
            content: {
              externalInfo: finalExternalInfo,
              supportContent: rec.supportContent,
              resultInfo: rec.resultInfo,
              futurePlan: finalFuture,
              isVerified: false
            },
            externalInfo: finalExternalInfo,
            archived: false,
            officeId: staffOfficeId,
            updatedAt: serverTimestamp()
          };

          if (existing) {
            const reportRef = doc(db, 'daily_reports', existing.id);
            currentBatch.update(reportRef, dailyPayload);
          } else {
            const newRef = doc(collection(db, 'daily_reports'));
            dailyPayload.createdAt = serverTimestamp();
            currentBatch.set(newRef, dailyPayload);
          }
          batchOpCount++;
          await commitBatchIfNeeded();

          // tree_communications への反映（今後の予定を反映、ツリー通信本文は消去せず保護）
          if (finalFuture || finalExternalInfo) {
            const childTreeDoc: any = {
              name: item.matchedChildName,
              future_plan: finalFuture,
              pickupLocation: '',
              endTime: '',
              transportTime: '',
              notes: '',
              officeId: staffOfficeId,
              updatedAt: new Date().toISOString()
            };
            if (finalExternalInfo) {
              childTreeDoc.tree_comm_text = finalExternalInfo;
            }

            const treeRefNoPref = doc(db, `children/${childId}/app_categories/書類管理/tree_communications`, rec.formattedDate);
            currentBatch.set(treeRefNoPref, childTreeDoc, { merge: true });
            batchOpCount++;
            await commitBatchIfNeeded();

            if (staffOfficeId) {
              const treeRefPref = doc(db, `children/${childId}/app_categories/書類管理/tree_communications`, `${staffOfficeId}_${rec.formattedDate}`);
              currentBatch.set(treeRefPref, childTreeDoc, { merge: true });
              batchOpCount++;
              await commitBatchIfNeeded();
            }
          }

          processedRecords++;
        }

        setScannedItems(prev => prev.map(si => si.fileName === item.fileName ? { ...si, status: 'success' } : si));
        setLogs(prev => [...prev, `✔ 「${item.matchedChildName}」様のインポートが完了しました`]);
      }

      await commitBatchIfNeeded(true);

      setIsProcessing(false);
      setIsFinished(true);
      setLogs(prev => [
        ...prev,
        `🎉 すべてのインポートが完了しました！（児童数: ${targets.length} 人 / 登録件数: ${processedRecords} 件）`
      ]);

    } catch (err: any) {
      console.error('Batch import error:', err);
      setIsProcessing(false);
      const msg = err.message || String(err);
      setLogs(prev => [...prev, `❌ インポートエラー: ${msg}`]);
      alert(`インポート中にエラーが発生しました: ${msg}`);
    }
  };

  const readyCount = useMemo(() => scannedItems.filter(i => i.status === 'ready').length, [scannedItems]);
  const selectedCount = useMemo(() => scannedItems.filter(i => i.selected).length, [scannedItems]);
  const selectedRecordsCount = useMemo(() => 
    scannedItems.filter(i => i.selected).reduce((sum, i) => sum + i.records.length, 0)
  , [scannedItems]);

  return (
    <div className="p-8 flex flex-col gap-6">
      {/* 隠し input (フォルダ選択フォールバック用) */}
      <input
        type="file"
        ref={fallbackFolderInputRef}
        onChange={handleFallbackFolderChange}
        // @ts-ignore
        webkitdirectory=""
        directory=""
        multiple
        className="hidden"
      />

      {/* 説明カード */}
      <div className="bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-transparent border border-emerald-200/80 rounded-3xl p-6 shadow-xs">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-emerald-600/20">
            <ArrowDownToLine size={24} />
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-black text-slate-800 tracking-tight">
                月別エクセル一括インポート（フォルダ指定）
              </h2>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold">
                Excel ➜ アプリ一括登録
              </span>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">
              児童のエクセルが入ったフォルダを1回指定するだけで、フォルダ内の全児童のエクセルを自動照合し、
              指定した月（例: <span className="font-mono font-bold bg-emerald-100/70 text-emerald-900 px-1.5 py-0.5 rounded">{targetMonth}</span>）のシートのみを一括抽出してアプリ（Firestore）へ高速インポートします。
            </p>
            <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-emerald-800 pt-1">
              <span>✔ 指定月のシート（例: {targetMonth.replace('-', '')} や {parseInt(targetMonth.split('-')[1] || '1', 10)}月）のみを高速自動抽出</span>
              <span>✔ 児童名・ふりがなを自動照合（表記揺れ対応）</span>
              <span>✔ 大容量データも250件ずつの安全分割コミット（上限エラー完全防止）</span>
            </div>
          </div>
        </div>
      </div>

      {/* 条件指定とアクション */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-6">
        <div className="flex flex-wrap items-center gap-6 w-full sm:w-auto">
          {/* 月選択 */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-500 block flex items-center gap-1.5">
              <Calendar size={14} className="text-emerald-600" />
              取り込み対象年月
            </label>
            <input
              type="month"
              value={targetMonth}
              onChange={(e) => setTargetMonth(e.target.value)}
              className="bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-base font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-none transition-all cursor-pointer"
            />
          </div>

          {/* 抽出対象シート名目安 */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-500 block">抽出するシート名の目安</label>
            <div className="px-4 py-2.5 rounded-xl bg-slate-100 border border-slate-200 text-sm font-mono font-bold text-slate-700">
              {targetMonth.replace('-', '')} / {parseInt(targetMonth.split('-')[1] || '1', 10)}月
            </div>
          </div>
        </div>

        {/* フォルダ選択ボタン */}
        <button
          type="button"
          onClick={handleSelectFolder}
          disabled={isScanning}
          className="w-full sm:w-auto flex items-center justify-center gap-2.5 px-7 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm rounded-xl shadow-lg shadow-emerald-600/25 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
        >
          {isScanning ? (
            <>
              <Loader2 size={20} className="animate-spin" />
              <span>フォルダを高速解析中... ({scanProgress.current}/{scanProgress.total})</span>
            </>
          ) : (
            <>
              <FolderOpen size={20} />
              <span>📁 フォルダを選択してその月だけ一括インポート</span>
            </>
          )}
        </button>
      </div>

      {/* スキャン中のプログレスバー表示 */}
      {isScanning && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 space-y-2 animate-pulse">
          <div className="flex items-center justify-between text-xs font-bold text-emerald-900">
            <span className="flex items-center gap-2">
              <Loader2 size={16} className="animate-spin text-emerald-600" />
              エクセルファイルを高速解析中... ({scanProgress.current} / {scanProgress.total} ファイル)
            </span>
            <span>{Math.round((scanProgress.current / Math.max(1, scanProgress.total)) * 100)}%</span>
          </div>
          <div className="w-full bg-emerald-100 h-2.5 rounded-full overflow-hidden">
            <div 
              className="bg-emerald-600 h-full transition-all duration-200 rounded-full"
              style={{ width: `${(scanProgress.current / Math.max(1, scanProgress.total)) * 100}%` }}
            />
          </div>
          <p className="text-[11px] text-emerald-700 truncate font-mono">{scanProgress.fileName}</p>
        </div>
      )}

      {/* 照合確認モーダル（createPortal で最前面マウント） */}
      {isModalOpen && createPortal(
        <div className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[88vh] flex flex-col overflow-hidden border border-slate-100">
            
            {/* モーダルヘッダー */}
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold shadow-xs">
                  <FileSpreadsheet size={22} />
                </div>
                <div>
                  <h3 className="font-black text-slate-800 text-base flex items-center gap-2">
                    月別エクセル一括インポートの事前照合プレビュー
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-mono font-bold">
                      対象: {targetMonth}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500 font-medium">
                    検出: {scannedItems.length} 件 ｜ データあり: <strong className="text-emerald-600">{readyCount} 件</strong> ｜ 選択中: <strong className="text-emerald-700">{selectedCount} 件（計 {selectedRecordsCount} レコード）</strong>
                  </p>
                </div>
              </div>

              {/* ヘッダー右側のアクションボタン */}
              <div className="flex items-center gap-3">
                {!isProcessing && selectedCount > 0 && (
                  <button
                    type="button"
                    onClick={handleExecuteBatchImport}
                    className="hidden sm:flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs shadow-md shadow-emerald-600/20 active:scale-95 transition-all cursor-pointer"
                  >
                    <Check size={16} className="stroke-[3]" />
                    <span>一括インポートを実行 ({selectedCount}件 / {selectedRecordsCount}行)</span>
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

            {/* モーダルボディ */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {/* 操作バー */}
              <div className="flex flex-wrap items-center justify-between gap-3">
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

                <div className="flex flex-wrap items-center gap-4 text-xs">
                  <label className="flex items-center gap-2 cursor-pointer font-bold text-slate-700 select-none">
                    <input
                      type="checkbox"
                      checked={isOverwrite}
                      onChange={(e) => setIsOverwrite(e.target.checked)}
                      className="rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                    />
                    <span>既存日報データを上書き更新する</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer font-bold text-slate-700 select-none">
                    <input
                      type="checkbox"
                      checked={importGoals}
                      onChange={(e) => setImportGoals(e.target.checked)}
                      className="rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                    />
                    <span>エクセル内の支援目標もインポートする</span>
                  </label>
                </div>
              </div>

              {/* 上書き仕様インフォバー */}
              <div className="bg-emerald-50/70 border border-emerald-100 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-emerald-900">
                <div className="flex items-center gap-2">
                  <Info size={14} className="text-emerald-600 shrink-0" />
                  <span>
                    フォルダ内の各エクセルから指定月（<strong>{targetMonth}</strong>）のシートを検出し、日々の療育記録（日付・療育内容・結果・今後の予定）をFirestoreへ保存します。
                  </span>
                </div>
              </div>

              {/* テーブル一覧 */}
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                      <th className="p-3 w-10 text-center">選択</th>
                      <th className="p-3">エクセルファイル名</th>
                      <th className="p-3 w-28">検出氏名</th>
                      <th className="p-3 w-44">紐付け児童（変更可）</th>
                      <th className="p-3 w-28 text-center">検出シート</th>
                      <th className="p-3 w-20 text-center">データ件数</th>
                      <th className="p-3 w-28 text-center">支援目標</th>
                      <th className="p-3 w-36">状態</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {scannedItems.map((item, idx) => (
                      <tr 
                        key={idx} 
                        className={`hover:bg-slate-50/80 transition-colors ${
                          !item.matchedChildId || item.records.length === 0 ? 'bg-slate-50/40 opacity-75' : ''
                        }`}
                      >
                        <td className="p-3 text-center">
                          <input
                            type="checkbox"
                            checked={item.selected}
                            disabled={isProcessing || !item.matchedChildId || item.records.length === 0}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setScannedItems(prev => prev.map((si, i) => i === idx ? { ...si, selected: checked } : si));
                            }}
                            className="rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer disabled:opacity-30"
                          />
                        </td>
                        <td className="p-3 font-semibold text-slate-700 truncate max-w-[200px]" title={item.fileName}>
                          {item.fileName}
                        </td>
                        <td className="p-3 font-bold text-slate-800">
                          {item.detectedName || <span className="text-slate-400 italic">未検出</span>}
                        </td>
                        <td className="p-3">
                          <select
                            value={item.matchedChildId}
                            onChange={(e) => handleMapChildChange(idx, e.target.value)}
                            disabled={isProcessing}
                            className={`w-full border rounded-lg px-2 py-1 font-bold outline-none text-xs ${
                              item.matchedChildId
                                ? 'border-slate-200 text-slate-800 bg-white'
                                : 'border-red-300 text-red-600 bg-red-50'
                            }`}
                          >
                            <option value="">-- 児童を選択 --</option>
                            {childrenData.map(c => (
                              <option key={c.id} value={c.id}>{c.fullName}</option>
                            ))}
                          </select>
                        </td>
                        <td className="p-3 text-center font-mono font-bold text-slate-700">
                          {item.targetSheetName || '-'}
                        </td>
                        <td className="p-3 text-center font-bold">
                          {item.records.length > 0 ? (
                            <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                              {item.records.length} 件
                            </span>
                          ) : (
                            <span className="text-slate-400">0 件</span>
                          )}
                        </td>
                        <td className="p-3 text-center">
                          {item.excelGoals ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100" title={item.excelGoals}>
                              あり
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-400">なし</span>
                          )}
                        </td>
                        <td className="p-3">
                          {item.status === 'ready' && (
                            <span className="inline-flex items-center gap-1 font-bold text-emerald-700">
                              <CheckCircle2 size={14} /> 準備完了
                            </span>
                          )}
                          {item.status === 'no-child' && (
                            <span className="inline-flex items-center gap-1 font-bold text-amber-600" title={item.errorMessage}>
                              <AlertCircle size={14} /> 児童未照合
                            </span>
                          )}
                          {item.status === 'no-sheet' && (
                            <span className="inline-flex items-center gap-1 font-bold text-slate-400" title={item.errorMessage}>
                              <AlertCircle size={14} /> 該当シートなし
                            </span>
                          )}
                          {item.status === 'no-records' && (
                            <span className="inline-flex items-center gap-1 font-bold text-amber-500" title={item.errorMessage}>
                              <AlertCircle size={14} /> データなし
                            </span>
                          )}
                          {item.status === 'success' && (
                            <span className="inline-flex items-center gap-1 font-bold text-emerald-600">
                              <CheckCircle2 size={14} /> インポート完了
                            </span>
                          )}
                          {item.status === 'error' && (
                            <span className="inline-flex items-center gap-1 font-bold text-red-600" title={item.errorMessage}>
                              <AlertCircle size={14} /> エラー
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 進行状況 & ログ */}
              {(isProcessing || logs.length > 0) && (
                <div className="space-y-2 pt-2">
                  {isProcessing && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs font-bold text-slate-700">
                        <span>進捗: {progress.current} / {progress.total} 人 ({progress.currentItemName})</span>
                        <span>{Math.round((progress.current / (progress.total || 1)) * 100)}%</span>
                      </div>
                      <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                        <div 
                          className="bg-emerald-600 h-full transition-all duration-300 rounded-full"
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

            {/* モーダルフッター */}
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
                onClick={handleExecuteBatchImport}
                disabled={isProcessing || selectedCount === 0}
                className="flex items-center gap-2 px-8 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm shadow-lg shadow-emerald-600/25 active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
              >
                {isProcessing ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    <span>Firestoreへ保存中... ({progress.current}/{progress.total})</span>
                  </>
                ) : (
                  <>
                    <Check size={18} className="stroke-[3]" />
                    <span>選択した {selectedCount} 件（計 {selectedRecordsCount} レコード）を一括インポート</span>
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
