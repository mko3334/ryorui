import React, { useState, useRef, useMemo, useEffect } from 'react';
import { 
  X, FileSpreadsheet, AlertCircle, Check, Upload, 
  UserCheck, AlertTriangle, Calendar, RefreshCw, Loader2, Info, Target,
  FolderOpen, Users, Layers, CheckSquare, Square, FileUp, Building2, Plus
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { 
  collection, query, where, getDocs, getDoc, doc, writeBatch, serverTimestamp 
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Child } from '../data/mockData';
import { parseGoalsText, formatStructuredGoals } from '../lib/utils';
import type { ImportHistoryAction } from '../lib/importHistory';

// ---- 型定義 ----

export interface ParsedDailyRecord {
  tempId: string;
  date: string; // 例: "5月1日"
  formattedDate: string; // 例: "2024-05-01"
  supportContent: string[];
  resultInfo: string;
  futurePlan: string;
  
  // 既存データ（存在する場合）
  existingReportId?: string;
  existingSupportContent?: string[];
  existingResultInfo?: string;
  existingFuturePlan?: string;
  existingExternalInfo?: string;
  existingRawData?: any;

  // ユーザー設定
  selected: boolean;
  isOverwrite: boolean; // false = 追加（デフォルト）, true = 上書き
}

export interface ParsedChildMonthGroup {
  groupId: string;
  childId: string;
  childName: string;
  rawExcelChildName: string;
  isMatched: boolean;
  
  planMonth: string; // "YYYY-MM"
  rawExcelMonthStr?: string;
  
  excelGoals?: string;
  existingGoals?: string;
  importGoals: boolean; // 支援目標を反映するか

  records: ParsedDailyRecord[];
  allOverwrite: boolean;
  allSelected: boolean;
  sourceFileName?: string;
  officeId?: string; // グループごとの事業所指定
}

type DailyReportImportModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess?: (historyAction?: ImportHistoryAction) => void;
  currentMonth: string; // "YYYY-MM"
  childId?: string;
  childrenData: Child[];
  selectedOfficeId?: string;
  offices?: { id: string; name: string }[];
  loginStaffName?: string;
};

// ユーティリティ: 事業所IDから表示用タグ（サーチ、ホーム等）を取得
const getOfficeTag = (officeId?: string, officesList?: { id: string; name: string }[]): string => {
  if (!officeId) return 'サーチ';
  if (officeId === 'LNrWc8f6G703aUYRZ5e2') return 'サーチ';
  if (officeId === 'nWioUcWXUskreYjmSL8p') return 'ホーム';
  const found = officesList?.find(o => o.id === officeId);
  return found ? found.name : 'サーチ';
};

// ユーティリティ: 名前の正規化
const normalizeName = (name: string): string => {
  return (name || '')
    .replace(/[\s　]+/g, '')
    .replace(/[・\-\*]/g, '')
    .toLowerCase();
};

// ユーティリティ: 和暦・西暦から西暦年月（YYYY-MM）を解析
const parseReiwaToYearMonth = (text: string): string | null => {
  if (!text) return null;
  const clean = text.replace(/[\s　]+/g, '');

  // 1. 西暦6桁数字: 202609, 202509 など
  const yyyymmMatch = clean.match(/(?:^|[^\d])(20\d{2})(0[1-9]|1[0-2])(?:[^\d]|$)/);
  if (yyyymmMatch) {
    return `${yyyymmMatch[1]}-${yyyymmMatch[2]}`;
  }

  // 2. 令和 / R（例: 令和6年9月, 令和06年9月, R6年9月, R6.9, R06.09, R6-9, 令6年9月, R0609, R609）
  const reiwaMatch = clean.match(/(?:令和|R|令)\s*(\d+|元)\s*(?:年|\.|\/|-)?\s*(\d{1,2})\s*(?:月)?/i);
  if (reiwaMatch) {
    const rYear = reiwaMatch[1] === '元' ? 1 : parseInt(reiwaMatch[1], 10);
    const y = 2018 + rYear;
    const m = reiwaMatch[2].padStart(2, '0');
    return `${y}-${m}`;
  }

  // 3. 平成 / H
  const heiseiMatch = clean.match(/(?:平成|H)\s*(\d+|元)\s*(?:年|\.|\/|-)?\s*(\d{1,2})\s*(?:月)?/i);
  if (heiseiMatch) {
    const hYear = heiseiMatch[1] === '元' ? 1 : parseInt(heiseiMatch[1], 10);
    const y = 1988 + hYear;
    const m = heiseiMatch[2].padStart(2, '0');
    return `${y}-${m}`;
  }

  // 4. 西暦: 2026年9月, 2025年09月
  const seirekiMatch = clean.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
  if (seirekiMatch) {
    return `${seirekiMatch[1]}-${seirekiMatch[2].padStart(2, '0')}`;
  }

  // 5. YYYY-MM, YYYY/MM, YYYY.MM
  const hyphenMatch = clean.match(/(\d{4})[-/\.](\d{1,2})/);
  if (hyphenMatch) {
    return `${hyphenMatch[1]}-${hyphenMatch[2].padStart(2, '0')}`;
  }

  return null;
};

// ユーティリティ: シート名から年月を抽出（西暦・和暦の年情報を含むかどうかも判定）
export interface SheetMonthParseResult {
  yearMonth: string;
  hasExplicitYear: boolean;
}

const parseMonthFromSheetName = (sheetName: string, defaultYear: string): SheetMonthParseResult | null => {
  const clean = sheetName.replace(/[\s　]+/g, '');
  if (clean === '原本' || clean.includes('原本')) return null;

  // 1. 西暦6桁数字: 202609 (2026年9月), 202509 (2025年9月)
  const yyyymm = clean.match(/(?:^|[^\d])(20\d{2})(0[1-9]|1[0-2])(?:[^\d]|$)/);
  if (yyyymm) {
    return { yearMonth: `${yyyymm[1]}-${yyyymm[2]}`, hasExplicitYear: true };
  }

  // 2. 和暦・西暦の解析（令和6年9月, 2026年9月, 2026-09 など）
  const ym = parseReiwaToYearMonth(clean);
  if (ym) {
    return { yearMonth: ym, hasExplicitYear: true };
  }

  // 3. "MM月" (例: 9月, 09月) -> 年指定なし
  const mmKanji = clean.match(/^(\d{1,2})月$/);
  if (mmKanji) {
    return { yearMonth: `${defaultYear}-${mmKanji[1].padStart(2, '0')}`, hasExplicitYear: false };
  }

  // 4. "MM" (1〜12) -> 年指定なし
  const num = parseInt(clean, 10);
  if (!isNaN(num) && num >= 1 && num <= 12) {
    return { yearMonth: `${defaultYear}-${num.toString().padStart(2, '0')}`, hasExplicitYear: false };
  }

  return null;
};

// ユーティリティ: 日付セル値から M月D日 文字列を取得
const parseDateCell = (rawVal: any, targetMonth: string): string => {
  if (rawVal === null || rawVal === undefined) return '';

  // 数値（Excelシリアル値）
  if (typeof rawVal === 'number') {
    const dObj = new Date(Math.round((rawVal - 25569) * 86400 * 1000));
    if (!isNaN(dObj.getTime())) {
      return `${dObj.getMonth() + 1}月${dObj.getDate()}日`;
    }
  }

  const s = String(rawVal).trim().replace(/[\s　]+/g, '');
  if (!s) return '';

  // "M月D日"
  const mMatch = s.match(/(\d{1,2})月(\d{1,2})日/);
  if (mMatch) {
    return `${parseInt(mMatch[1], 10)}月${parseInt(mMatch[2], 10)}日`;
  }

  // "M/D" または "M-D"
  const slashMatch = s.match(/(\d{1,2})[-/](\d{1,2})/);
  if (slashMatch) {
    return `${parseInt(slashMatch[1], 10)}月${parseInt(slashMatch[2], 10)}日`;
  }

  // "D日" または "D" のみ
  const dayOnlyMatch = s.match(/^(\d{1,2})(?:日)?$/);
  if (dayOnlyMatch) {
    const monthNum = parseInt(targetMonth.split('-')[1] || '1', 10);
    return `${monthNum}月${parseInt(dayOnlyMatch[1], 10)}日`;
  }

  return '';
};

export const DailyReportImportModal: React.FC<DailyReportImportModalProps> = ({
  isOpen,
  onClose,
  onImportSuccess,
  currentMonth,
  childId: initialChildId,
  childrenData,
  selectedOfficeId = 'LNrWc8f6G703aUYRZ5e2',
  offices = [
    { id: 'LNrWc8f6G703aUYRZ5e2', name: 'サーチ' },
    { id: 'nWioUcWXUskreYjmSL8p', name: 'ホーム' }
  ],
  loginStaffName = ''
}) => {
  const [step, setStep] = useState<'upload' | 'preview'>('upload');
  const [groups, setGroups] = useState<ParsedChildMonthGroup[]>([]);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoadingExisting, setIsLoadingExisting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [saveProgress, setSaveProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });

  // 選択された事業所ID（初期値は親からのselectedOfficeIdまたはサーチ）
  const [selectedOfficeIdState, setSelectedOfficeIdState] = useState<string>(selectedOfficeId || 'LNrWc8f6G703aUYRZ5e2');

  // 取り込み対象月の選択モード（'specific' = 指定した月のみ, 'all' = 全月のデータ）
  const [importMonthMode, setImportMonthMode] = useState<'specific' | 'all'>('specific');
  // 指定した月（初期値は currentMonth または本日の年月）
  const [targetImportMonth, setTargetImportMonth] = useState<string>(currentMonth || new Date().toISOString().slice(0, 7));

  // プレビュー画面での月絞り込みフィルター（'all' または '2026-09' など）
  const [activeMonthFilter, setActiveMonthFilter] = useState<string>('all');

  // 親からselectedOfficeIdが渡された際に同期
  useEffect(() => {
    if (selectedOfficeId) {
      setSelectedOfficeIdState(selectedOfficeId);
    }
  }, [selectedOfficeId]);

  // 親からcurrentMonthが渡された際に同期
  useEffect(() => {
    if (currentMonth) {
      setTargetImportMonth(currentMonth);
    }
  }, [currentMonth]);

  // 児童別タブ用ステート（'all' または児童ID/名前）
  const [activeChildTabId, setActiveChildTabId] = useState<string>('all');

  // 複数ファイル・フォルダ読み込みプログレス
  const [isProcessingFiles, setIsProcessingFiles] = useState(false);
  const [processingProgress, setProcessingProgress] = useState<{ current: number; total: number; fileName: string }>({
    current: 0,
    total: 0,
    fileName: ''
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // 読み込まれたグループに含まれる月のリスト
  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    groups.forEach(g => {
      if (g.planMonth) set.add(g.planMonth);
    });
    return Array.from(set).sort();
  }, [groups]);

  // 児童別タブの集計 (Rules of Hooks: すべてのHookを条件分岐より前に呼び出す)
  const childTabs = useMemo(() => {
    const map = new Map<string, {
      id: string;
      name: string;
      rawExcelName: string;
      isMatched: boolean;
      groupCount: number;
      totalRecords: number;
      selectedRecords: number;
      hasImportGoals: boolean;
    }>();

    groups.forEach(g => {
      const key = g.childId || g.rawExcelChildName || 'unknown';
      if (!map.has(key)) {
        map.set(key, {
          id: key,
          name: g.childName || g.rawExcelChildName || '未照合の児童',
          rawExcelName: g.rawExcelChildName,
          isMatched: g.isMatched,
          groupCount: 0,
          totalRecords: 0,
          selectedRecords: 0,
          hasImportGoals: false,
        });
      }
      const item = map.get(key)!;
      item.groupCount += 1;
      item.totalRecords += g.records.length;
      item.selectedRecords += g.records.filter(r => r.selected).length;
      if (g.importGoals) item.hasImportGoals = true;
    });

    return Array.from(map.values());
  }, [groups]);

  // 現在の児童タブおよび月フィルターで表示するグループ
  const visibleGroups = useMemo(() => {
    let list = groups;
    if (activeChildTabId !== 'all') {
      list = list.filter(g => (g.childId || g.rawExcelChildName || 'unknown') === activeChildTabId);
    }
    if (activeMonthFilter !== 'all') {
      list = list.filter(g => g.planMonth === activeMonthFilter);
    }
    return list;
  }, [groups, activeChildTabId, activeMonthFilter]);

  if (!isOpen) return null;

  const resetState = () => {
    setStep('upload');
    setGroups([]);
    setFileName('');
    setError(null);
    setIsLoadingExisting(false);
    setIsSaving(false);
    setSuccessMessage(null);
    setSaveProgress({ current: 0, total: 0 });
    setActiveChildTabId('all');
    setActiveMonthFilter('all');
    setIsProcessingFiles(false);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  // ファイル選択ハンドラ（単一／複数）
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    processFiles(Array.from(files));
    e.target.value = ''; // リセット
  };

  // フォルダ選択ハンドラ (フォールバック用)
  const handleFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    processFiles(Array.from(files));
    e.target.value = ''; // リセット
  };

  // ネイティブフォルダピッカー (File System Access API & フォールバック)
  const handlePickFolder = async () => {
    if ('showDirectoryPicker' in window) {
      try {
        const dirHandle = await (window as any).showDirectoryPicker({ mode: 'read' });
        const excelFiles: File[] = [];
        for await (const entry of dirHandle.values()) {
          if (entry.kind === 'file' && (entry.name.endsWith('.xlsx') || entry.name.endsWith('.xls')) && !entry.name.startsWith('~$')) {
            const f = await entry.getFile();
            excelFiles.push(f);
          }
        }
        if (excelFiles.length === 0) {
          setError('指定されたフォルダ内に有効なExcelファイル (.xlsx) が見つかりませんでした。');
          return;
        }
        processFiles(excelFiles);
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.error('Directory picker error:', err);
          folderInputRef.current?.click();
        }
      }
    } else {
      folderInputRef.current?.click();
    }
  };

  // ドラッグ＆ドロップハンドラ
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length > 0) {
      processFiles(files);
    }
  };

  // 複数ファイル（またはフォルダ内ファイル）の一括解析処理
  const processFiles = async (files: File[]) => {
    // .xlsx, .xls のみを対象、一時ファイル ~$ は除外
    const validFiles = files.filter(f => {
      const name = f.name.toLowerCase();
      return (name.endsWith('.xlsx') || name.endsWith('.xls')) && !f.name.startsWith('~$');
    });

    if (validFiles.length === 0) {
      setError('有効なExcelファイル (.xlsx / .xls) が見つかりませんでした。');
      return;
    }

    setIsProcessingFiles(true);
    setError(null);
    setSuccessMessage(null);

    const isSingle = validFiles.length === 1;
    setFileName(isSingle ? validFiles[0].name : `${validFiles.length} 個のExcelファイル (${validFiles[0].name} 他)`);

    const allGroups: ParsedChildMonthGroup[] = [];

    try {
      for (let i = 0; i < validFiles.length; i++) {
        const file = validFiles[i];
        setProcessingProgress({ current: i + 1, total: validFiles.length, fileName: file.name });
        
        const arrayBuffer = await file.arrayBuffer();
        const wb = XLSX.read(arrayBuffer, { type: 'array' });
        const fileGroups = parseWorkbook(wb, file.name, importMonthMode, targetImportMonth);
        allGroups.push(...fileGroups);
      }

      if (allGroups.length === 0) {
        if (importMonthMode === 'specific') {
          const [y, m] = (targetImportMonth || '').split('-');
          throw new Error(`指定された月（${y ? `${y}年` : ''}${m ? `${parseInt(m, 10)}月` : ''}）に合致するシートが見つかりませんでした。エクセルのシート名（例: 202609, 9月 など）をご確認いただくか、「すべての月のデータを取り込む」をお試しください。`);
        } else {
          throw new Error('取り込み可能なデータが見つかりませんでした。シート構成をご確認ください。');
        }
      }

      setGroups(allGroups);
      setActiveChildTabId('all');
      setActiveMonthFilter('all');
      setStep('preview');

      // 既存データの読み込み突合
      await loadExistingData(allGroups);
    } catch (err: any) {
      console.error('File parsing error:', err);
      setError(err.message || 'Excelファイルの解析に失敗しました。');
    } finally {
      setIsProcessingFiles(false);
    }
  };

  // 単一ワークブックの解析関数
  const parseWorkbook = (
    wb: XLSX.WorkBook, 
    sourceFileName?: string,
    filterMode: 'specific' | 'all' = importMonthMode,
    specifiedMonth: string = targetImportMonth
  ): ParsedChildMonthGroup[] => {
    const defaultYear = (filterMode === 'specific' && specifiedMonth ? specifiedMonth.split('-')[0] : '') || currentMonth.split('-')[0] || String(new Date().getFullYear());
    const sheetNames = wb.SheetNames;

    // 「原本」シートは他のシートがある場合はスキップ
    const validSheetNames = sheetNames.filter(name => {
      const clean = name.replace(/[\s　]+/g, '');
      if (clean === '原本' && sheetNames.length > 1) return false;
      return true;
    });

    if (validSheetNames.length === 0) {
      throw new Error('取り込み可能なシートが見つかりませんでした。');
    }

    const parsedGroups: ParsedChildMonthGroup[] = [];
    let groupIndex = 0;

    for (const sheetName of validSheetNames) {
      const sheet = wb.Sheets[sheetName];
      if (!sheet) continue;

      const grid = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });
      if (!grid || grid.length === 0) continue;

      // 1. 児童名の検出
      let rawChildName = '';
      // グリッド内から「名前」または「氏名」セルを探す
      for (let r = 0; r < Math.min(grid.length, 10); r++) {
        const row = grid[r] || [];
        for (let c = 0; c < row.length; c++) {
          const val = String(row[c] || '').replace(/[\s　]+/g, '');
          if (val === '名前' || val === '氏名' || val.includes('児童名')) {
            // 右側の非空セルを探す
            for (let offset = 1; offset <= 5; offset++) {
              const neighbor = String(row[c + offset] || '').trim();
              if (neighbor && neighbor !== '名前' && neighbor !== '氏名') {
                rawChildName = neighbor;
                break;
              }
            }
          }
          if (rawChildName) break;
        }
        if (rawChildName) break;
      }

      // 固定セル I2 (r=1, c=8) も確認
      if (!rawChildName && grid[1] && grid[1][8]) {
        rawChildName = String(grid[1][8]).trim();
      }

      // シート名からも候補を探す
      if (!rawChildName) {
        const matchingChild = childrenData.find(c => {
          const cName = normalizeName(c.fullName);
          const sName = normalizeName(sheetName);
          return cName && sName && (cName === sName || sName.includes(cName) || cName.includes(sName));
        });
        if (matchingChild) {
          rawChildName = matchingChild.fullName;
        }
      }

      // 児童の照合
      let matchedChildId = '';
      let matchedChildName = '';
      let isMatched = false;

      if (rawChildName) {
        const normRaw = normalizeName(rawChildName);
        // 完全一致
        const exact = childrenData.find(c => normalizeName(c.fullName) === normRaw);
        if (exact) {
          matchedChildId = exact.id || '';
          matchedChildName = exact.fullName;
          isMatched = true;
        } else {
          // ふりがな一致
          const kanaMatch = childrenData.find(c => (c as any).fullNameKana && normalizeName((c as any).fullNameKana) === normRaw);
          if (kanaMatch) {
            matchedChildId = kanaMatch.id || '';
            matchedChildName = kanaMatch.fullName;
            isMatched = true;
          } else {
            // 部分一致
            const partial = childrenData.find(c => {
              const cn = normalizeName(c.fullName);
              return cn && normRaw && (cn.includes(normRaw) || normRaw.includes(cn));
            });
            if (partial) {
              matchedChildId = partial.id || '';
              matchedChildName = partial.fullName;
              isMatched = true;
            }
          }
        }
      }

      // 照合できなかった場合、初期選択児童を使用
      if (!isMatched) {
        const fallbackChild = childrenData.find(c => c.id === initialChildId) || childrenData[0];
        if (fallbackChild) {
          matchedChildId = fallbackChild.id || '';
          matchedChildName = fallbackChild.fullName;
        }
      }

      // 2. 対象年月の検出
      let detectedYearMonth: string | null = null;
      let rawMonthStr = '';

      // A. シート名から年月を解析（202609, 202509 など西暦年が明記されているか判定）
      const sheetParsed = parseMonthFromSheetName(sheetName, defaultYear);
      if (sheetParsed && sheetParsed.hasExplicitYear) {
        // シート名に西暦年（202609など）が明記されている場合は最優先！
        detectedYearMonth = sheetParsed.yearMonth;
        rawMonthStr = sheetName;
      }

      // B. シート名に西暦年がない場合、またはシート名から検出できなかった場合、グリッド内を走査
      if (!detectedYearMonth) {
        for (let r = 0; r < Math.min(grid.length, 15); r++) {
          const row = grid[r] || [];
          for (let c = 0; c < row.length; c++) {
            const val = String(row[c] || '').trim();
            if (val && (val.includes('令和') || val.includes('年') || val.includes('月') || /(?:^|[^\d])20\d{4}(?:[^\d]|$)/.test(val))) {
              const ym = parseReiwaToYearMonth(val);
              if (ym) {
                detectedYearMonth = ym;
                rawMonthStr = val;
                break;
              }
            }
          }
          if (detectedYearMonth) break;
        }
      }

      // C. グリッド内でも年が見つからなかった場合、シート名の月（年なし）を使用
      if (!detectedYearMonth && sheetParsed) {
        detectedYearMonth = sheetParsed.yearMonth;
        rawMonthStr = sheetName;
      }

      const finalPlanMonth = detectedYearMonth || currentMonth;

      // 「指定した月のみ」モードの場合、指定月と一致しないシートはスキップ
      if (filterMode === 'specific' && specifiedMonth && finalPlanMonth !== specifiedMonth) {
        continue;
      }

      // 3. 支援目標の検出
      let excelGoals = '';
      const goalLines: string[] = [];

      for (let r = 0; r < Math.min(grid.length, 15); r++) {
        const row = grid[r] || [];
        for (let c = 0; c < row.length; c++) {
          const rawVal = String(row[c] || '');
          const val = rawVal.replace(/[\s　]+/g, '');
          
          if (val === '支援目標' || (val.includes('支援目標') && !val.includes('具体的支援目標'))) {
            // 「支援目標」セルの右側のセルにもテキストがあるか確認
            const rightVal = String(row[c + 1] || '').trim();
            if (rightVal && !rightVal.includes('令和') && !rightVal.includes('日付')) {
              goalLines.push(rightVal);
            }

            // その下の複数行を走査して収集（テーブルヘッダーや令和行に達するまで）
            for (let ro = 1; ro <= 8; ro++) {
              const targetRow = grid[r + ro];
              if (!targetRow) break;
              
              // 列c、または列0のセルの内容を確認
              const gVal = String(targetRow[c] || targetRow[0] || '').trim();
              if (!gVal) continue;
              
              // 終了条件: 日付ヘッダー、令和行、テーブルの開始
              if (gVal.includes('日付') || gVal.includes('令和') || gVal.includes('療育内容') || gVal.includes('提供時間')) {
                break;
              }
              if (!goalLines.includes(gVal)) {
                goalLines.push(gVal);
              }
            }
          }
        }
        if (goalLines.length > 0) break;
      }

      // 見出し「支援目標」が見つからなかった、または取得できなかった場合、行4〜8の固定位置も確認
      if (goalLines.length === 0) {
        for (let r = 3; r <= 8; r++) {
          const rowVal = String(grid[r]?.[0] || '').trim();
          if (rowVal && 
              (rowVal.includes('長期目標') || rowVal.includes('短期目標') || rowVal.includes('具体的') || rowVal.includes('本人支援')) &&
              !rowVal.includes('令和') && !rowVal.includes('日付')) {
            if (!goalLines.includes(rowVal)) goalLines.push(rowVal);
          }
        }
      }

      excelGoals = goalLines.join('\n').trim();

      // 4. テーブルヘッダーとレコードの検出
      const records: ParsedDailyRecord[] = [];
      let headerRowIdx = -1;
      let dateColIdx = -1;
      let supportColIdx = -1;
      let resultColIdx = -1;
      let futureColIdx = -1;

      // ヘッダー行の走査
      for (let r = 0; r < grid.length; r++) {
        const row = grid[r];
        if (!row || !Array.isArray(row)) continue;

        const cleanCells = Array.from(row).map(val => 
          String(val || '').replace(/[\s　\n\r]+/g, '')
        );

        const dIdx = cleanCells.findIndex(val => val === '日付');
        if (dIdx !== -1) {
          const hasSupport = cleanCells.some(val => val.includes('療育内容'));
          const hasResult = cleanCells.some(val => val.includes('結果') || val.includes('行った結果'));
          const hasFuture = cleanCells.some(val => val.includes('予定') || val.includes('今後の予定'));

          if ((hasSupport ? 1 : 0) + (hasResult ? 1 : 0) + (hasFuture ? 1 : 0) >= 1) {
            headerRowIdx = r;
            dateColIdx = dIdx;
            supportColIdx = cleanCells.findIndex(val => val.includes('療育内容'));
            resultColIdx = cleanCells.findIndex(val => val.includes('結果') || val.includes('行った結果'));
            futureColIdx = cleanCells.findIndex(val => val.includes('予定') || val.includes('今後の予定'));
            break;
          }
        }
      }

      if (headerRowIdx !== -1 && dateColIdx !== -1) {
        // レコードの走査
        // テンプレートでは1ブロックあたり5行結合になっている
        let r = headerRowIdx + 1;
        while (r < grid.length) {
          const row = grid[r];
          if (!row) {
            r++;
            continue;
          }

          // 新たなヘッダー行が登場した場合（2ページ目など）
          const firstCellClean = String(row[dateColIdx] || '').replace(/[\s　]+/g, '');
          if (firstCellClean === '日付' || firstCellClean.includes('専門的支援実施計画')) {
            // 列の再調整
            const cleanCells = Array.from(row).map(v => String(v || '').replace(/[\s　\n\r]+/g, ''));
            const dIdx = cleanCells.findIndex(val => val === '日付');
            if (dIdx !== -1) {
              dateColIdx = dIdx;
              if (cleanCells.findIndex(val => val.includes('療育内容')) !== -1) {
                supportColIdx = cleanCells.findIndex(val => val.includes('療育内容'));
              }
              if (cleanCells.findIndex(val => val.includes('結果')) !== -1) {
                resultColIdx = cleanCells.findIndex(val => val.includes('結果'));
              }
              if (cleanCells.findIndex(val => val.includes('予定')) !== -1) {
                futureColIdx = cleanCells.findIndex(val => val.includes('予定'));
              }
            }
            r++;
            continue;
          }

          // フッター判定（作成者・署名など）
          if (
            firstCellClean.includes('作成者') || 
            firstCellClean.includes('保護者署名') ||
            firstCellClean.includes('作成')
          ) {
            r++;
            continue;
          }

          const rawDateVal = row[dateColIdx];
          const dateStr = parseDateCell(rawDateVal, finalPlanMonth);

          if (dateStr) {
            // 日付が見つかった！この行からブロック（最大5行分）をスキャン
            const supportList: string[] = [];
            let resultText = '';
            let futureText = '';

            // ブロック内の行（1〜5行）を走査
            for (let offset = 0; offset < 5; offset++) {
              const curRow = grid[r + offset];
              if (!curRow) break;

              // 日付列が別の新しい日付になっている場合は次のブロック
              if (offset > 0) {
                const nextDateRaw = curRow[dateColIdx];
                const nextDateStr = parseDateCell(nextDateRaw, finalPlanMonth);
                if (nextDateStr && nextDateStr !== dateStr) {
                  break;
                }
              }

              // 療育内容
              if (supportColIdx !== -1 && curRow[supportColIdx] !== undefined && curRow[supportColIdx] !== null) {
                const valSupport = String(curRow[supportColIdx]).trim();
                if (valSupport && !supportList.includes(valSupport)) {
                  valSupport.split('\n').forEach(line => {
                    const t = line.trim();
                    if (t && !supportList.includes(t)) {
                      supportList.push(t);
                    }
                  });
                }
              }

              // 療育結果（先頭または最初に見つかった非空テキスト）
              if (resultColIdx !== -1 && !resultText && curRow[resultColIdx]) {
                resultText = String(curRow[resultColIdx]).trim();
              }

              // 今後の予定
              if (futureColIdx !== -1 && !futureText && curRow[futureColIdx]) {
                futureText = String(curRow[futureColIdx]).trim();
              }
            }

            // 日付から YYYY-MM-DD を生成
            const [yStr] = finalPlanMonth.split('-');
            const mMatch = dateStr.match(/(\d+)月/);
            const dMatch = dateStr.match(/(\d+)日/);
            const mNum = mMatch ? parseInt(mMatch[1], 10) : parseInt(finalPlanMonth.split('-')[1], 10);
            const dNum = dMatch ? parseInt(dMatch[1], 10) : 1;
            const formattedDate = `${yStr}-${String(mNum).padStart(2, '0')}-${String(dNum).padStart(2, '0')}`;

            // 有効なデータであればレコードに追加
            if (supportList.length > 0 || resultText || futureText) {
              records.push({
                tempId: `${finalPlanMonth}_${dateStr}_${records.length}`,
                date: dateStr,
                formattedDate,
                supportContent: supportList,
                resultInfo: resultText,
                futurePlan: futureText,
                selected: true,
                isOverwrite: true // デフォルトは「上書き」！
              });
            }

            // 5行分進める
            r += 5;
            continue;
          }

          r++;
        }
      }

      if (records.length > 0 || excelGoals) {
        const safeFilePrefix = sourceFileName ? sourceFileName.replace(/[^a-zA-Z0-9_\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff-]/g, '_') + '_' : '';
        parsedGroups.push({
          groupId: `group_${safeFilePrefix}${sheetName}_${groupIndex++}`,
          childId: matchedChildId,
          childName: matchedChildName,
          rawExcelChildName: rawChildName || '未検出',
          isMatched,
          planMonth: finalPlanMonth,
          rawExcelMonthStr: rawMonthStr || finalPlanMonth,
          excelGoals: excelGoals || '',
          importGoals: false, // 支援目標はユーザーが明示的にチェックで有効化
          records,
          allOverwrite: true, // デフォルトは「上書き」！
          allSelected: true,
          sourceFileName
        });
      }
    }

    return parsedGroups;
  };

  // 一括上書きトグル（全児童・全レコード）
  const handleBulkOverwrite = (overwrite: boolean) => {
    setGroups(prev => prev.map(g => ({
      ...g,
      allOverwrite: overwrite,
      records: g.records.map(r => ({ ...r, isOverwrite: overwrite }))
    })));
  };

  // 一括支援目標反映（全児童）
  const handleBulkGoals = (importGoals: boolean) => {
    setGroups(prev => prev.map(g => ({
      ...g,
      importGoals: importGoals
    })));
  };

  // 一括全選択 / 全解除（全月・全児童）
  const handleBulkSelect = (select: boolean) => {
    setGroups(prev => prev.map(g => ({
      ...g,
      allSelected: select,
      records: g.records.map(r => ({ ...r, selected: select }))
    })));
  };

  // 表示中（絞り込み中）のグループのみ一括選択 / 全解除
  const handleVisibleSelect = (select: boolean) => {
    const visibleGroupIds = new Set(visibleGroups.map(g => g.groupId));
    setGroups(prev => prev.map(g => {
      if (visibleGroupIds.has(g.groupId)) {
        return {
          ...g,
          allSelected: select,
          records: g.records.map(r => ({ ...r, selected: select }))
        };
      }
      return g;
    }));
  };

  // Firestoreから既存データを取得してグループにマージ（事業所IDを考慮）
  const loadExistingData = async (currentGroups: ParsedChildMonthGroup[], overrideOfficeId?: string) => {
    setIsLoadingExisting(true);
    const officeToUse = overrideOfficeId || selectedOfficeIdState || selectedOfficeId;

    try {
      const updatedGroups = [...currentGroups];

      for (const group of updatedGroups) {
        if (!group.childId) continue;
        const targetOffice = group.officeId || officeToUse;

        // 1. 既存の支援目標 (supportPlans)
        try {
          let loadedGoals = '';
          if (targetOffice) {
            const planPrefDoc = await getDoc(doc(db, 'supportPlans', `${targetOffice}_${group.childId}_${group.planMonth}`));
            if (planPrefDoc.exists()) {
              loadedGoals = planPrefDoc.data().goals || '';
            }
          }
          if (!loadedGoals) {
            const planSnap = await getDocs(
              query(collection(db, 'supportPlans'), where('childId', '==', group.childId), where('month', '==', group.planMonth))
            );
            if (!planSnap.empty) {
              loadedGoals = planSnap.docs[0].data().goals || '';
            }
          }
          group.existingGoals = loadedGoals;
        } catch (e) {
          console.warn('supportPlans fetch error:', e);
        }

        // 2. 既存の日報 (daily_reports)
        try {
          const constraints: any[] = [
            where('childId', '==', group.childId),
            where('planMonth', '==', group.planMonth)
          ];
          if (targetOffice) {
            constraints.push(where('officeId', '==', targetOffice));
          }
          const q = query(collection(db, 'daily_reports'), ...constraints);
          const dailySnap = await getDocs(q);
          const existingDateMap: Record<string, { id: string; content: any; rawData: any }> = {};

          dailySnap.forEach(d => {
            const data = d.data();
            const dStr = data.date;
            if (dStr) {
              existingDateMap[dStr] = { id: d.id, content: data.content || {}, rawData: data };
            }
          });

          // 3. 既存のツリー通信 (tree_communications) も取得して連絡帳本文および今後の予定を保持
          let treeCommMap: Record<string, string> = {};
          let treeFutureMap: Record<string, string> = {};
          try {
            const treeCommRef = collection(db, 'children', group.childId, 'app_categories', '書類管理', 'tree_communications');
            const treeSnap = await getDocs(treeCommRef);
            treeSnap.forEach(td => {
              const tData = td.data();
              const parts = td.id.split('_');
              const dKey = parts.length === 2 ? parts[1] : td.id;
              if (tData.tree_comm_text) {
                treeCommMap[dKey] = tData.tree_comm_text;
              }
              const plan = tData.future_plan || tData.futurePlan;
              if (plan) {
                treeFutureMap[dKey] = plan;
              }
            });
          } catch (e) {
            console.warn('tree_communications fetch in loadExistingData error:', e);
          }

          // 各レコードと紐付け
          group.records.forEach(rec => {
            const exist = existingDateMap[rec.formattedDate];
            const treeText = treeCommMap[rec.formattedDate] || '';
            const treeFuture = treeFutureMap[rec.formattedDate] || '';

            if (exist) {
              rec.existingReportId = exist.id;
              rec.existingSupportContent = exist.content.supportContent || [];
              rec.existingResultInfo = exist.content.resultInfo || '';
              rec.existingFuturePlan = exist.content.futurePlan || treeFuture;
              rec.existingExternalInfo = exist.content.externalInfo || exist.rawData.externalInfo || treeText;
              rec.existingRawData = exist.rawData;
            } else {
              rec.existingReportId = undefined;
              rec.existingSupportContent = undefined;
              rec.existingResultInfo = undefined;
              rec.existingFuturePlan = treeFuture || undefined;
              rec.existingExternalInfo = treeText || undefined;
              rec.existingRawData = undefined;
            }
          });
        } catch (e) {
          console.warn('daily_reports fetch error:', e);
        }
      }

      setGroups(updatedGroups);
    } catch (e) {
      console.error('loadExistingData error:', e);
    } finally {
      setIsLoadingExisting(false);
    }
  };

  // 児童選択変更
  const handleChildChange = (groupIndex: number, newChildId: string) => {
    const child = childrenData.find(c => c.id === newChildId);
    if (!child) return;

    let updatedList: ParsedChildMonthGroup[] = [];
    setGroups(prev => {
      const copy = [...prev];
      copy[groupIndex] = {
        ...copy[groupIndex],
        childId: child.id || '',
        childName: child.fullName,
        isMatched: true
      };
      updatedList = copy;
      return copy;
    });

    setTimeout(() => {
      if (updatedList.length > 0) {
        loadExistingData(updatedList);
      }
    }, 50);
  };

  // 対象年月変更
  const handleMonthChange = (groupIndex: number, newMonth: string) => {
    let updatedList: ParsedChildMonthGroup[] = [];
    setGroups(prev => {
      const copy = [...prev];
      copy[groupIndex] = {
        ...copy[groupIndex],
        planMonth: newMonth
      };
      // レコードの formattedDate も更新
      const [yStr] = newMonth.split('-');
      copy[groupIndex].records = copy[groupIndex].records.map(r => {
        const mMatch = r.date.match(/(\d+)月/);
        const dMatch = r.date.match(/(\d+)日/);
        const mNum = mMatch ? parseInt(mMatch[1], 10) : parseInt(newMonth.split('-')[1], 10);
        const dNum = dMatch ? parseInt(dMatch[1], 10) : 1;
        return {
          ...r,
          formattedDate: `${yStr}-${String(mNum).padStart(2, '0')}-${String(dNum).padStart(2, '0')}`
        };
      });
      updatedList = copy;
      return copy;
    });

    setTimeout(() => {
      if (updatedList.length > 0) {
        loadExistingData(updatedList);
      }
    }, 50);
  };

  // 支援目標反映チェックボックス変更
  const handleToggleGoals = (groupIndex: number) => {
    setGroups(prev => {
      const copy = [...prev];
      copy[groupIndex] = {
        ...copy[groupIndex],
        importGoals: !copy[groupIndex].importGoals
      };
      return copy;
    });
  };

  // 一括上書きチェックボックス変更
  const handleToggleAllOverwrite = (groupIndex: number) => {
    setGroups(prev => {
      const copy = [...prev];
      const newAllOverwrite = !copy[groupIndex].allOverwrite;
      copy[groupIndex].allOverwrite = newAllOverwrite;
      copy[groupIndex].records = copy[groupIndex].records.map(r => ({
        ...r,
        isOverwrite: newAllOverwrite
      }));
      return copy;
    });
  };

  // 一括選択チェックボックス変更
  const handleToggleAllSelected = (groupIndex: number) => {
    setGroups(prev => {
      const copy = [...prev];
      const newAllSelected = !copy[groupIndex].allSelected;
      copy[groupIndex].allSelected = newAllSelected;
      copy[groupIndex].records = copy[groupIndex].records.map(r => ({
        ...r,
        selected: newAllSelected
      }));
      return copy;
    });
  };

  // 個別レコードの上書きフラグ変更
  const handleToggleRecordOverwrite = (groupIndex: number, recordIndex: number) => {
    setGroups(prev => {
      const copy = [...prev];
      const rec = copy[groupIndex].records[recordIndex];
      rec.isOverwrite = !rec.isOverwrite;
      copy[groupIndex].allOverwrite = copy[groupIndex].records.every(r => r.isOverwrite);
      return copy;
    });
  };

  // 個別レコードの選択フラグ変更
  const handleToggleRecordSelected = (groupIndex: number, recordIndex: number) => {
    setGroups(prev => {
      const copy = [...prev];
      const rec = copy[groupIndex].records[recordIndex];
      rec.selected = !rec.selected;
      copy[groupIndex].allSelected = copy[groupIndex].records.every(r => r.selected);
      return copy;
    });
  };

  // インポート実行
  const handleExecuteImport = async () => {
    const totalSelected = groups.reduce(
      (acc, g) => acc + g.records.filter(r => r.selected).length, 
      0
    );

    if (totalSelected === 0 && !groups.some(g => g.importGoals && g.excelGoals)) {
      alert('インポート対象が選択されていません。');
      return;
    }

    setIsSaving(true);
    setError(null);
    setSaveProgress({ current: 0, total: totalSelected });

    try {
      let currentBatch = writeBatch(db);
      let opCount = 0;
      const MAX_BATCH_OPS = 250; // Firestoreの上限は500件。余裕を持って250件ごとに分割コミット

      const addBatchOp = async (fn: (b: any) => void) => {
        fn(currentBatch);
        opCount++;
        if (opCount >= MAX_BATCH_OPS) {
          await currentBatch.commit();
          currentBatch = writeBatch(db);
          opCount = 0;
        }
      };

      const historyAction: ImportHistoryAction = {
        id: `import_${Date.now()}`,
        timestamp: new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
        summary: `${totalSelected}件の記録・支援目標のインポート`,
        officeId: selectedOfficeIdState || selectedOfficeId || '',
        officeName: getOfficeTag(selectedOfficeIdState || selectedOfficeId, offices),
        before: {
          supportPlans: [],
          dailyReports: [],
          createdDailyReportIds: [],
          treeComms: []
        },
        after: {
          supportPlans: [],
          dailyReports: [],
          treeComms: []
        }
      };

      let processedCount = 0;

      for (const group of groups) {
        if (!group.childId) continue;

        const effectiveOfficeId = group.officeId || selectedOfficeIdState || selectedOfficeId || '';
        const effectiveOfficeName = getOfficeTag(effectiveOfficeId, offices);

        // 1. supportPlans メタデータの作成・更新
        const docId = effectiveOfficeId ? `${effectiveOfficeId}_${group.childId}_${group.planMonth}` : `${group.childId}_${group.planMonth}`;
        const planMetaRef = doc(db, 'supportPlans', docId);

        const metaUpdate: any = {
          childId: group.childId,
          month: group.planMonth,
          officeId: effectiveOfficeId,
          office: effectiveOfficeName,
          status: 'active',
          updatedAt: serverTimestamp()
        };

        if (group.importGoals && group.excelGoals) {
          const parsed = parseGoalsText(group.excelGoals);
          const cleanGoalsText = formatStructuredGoals(parsed);
          metaUpdate.goals = cleanGoalsText || group.excelGoals;

          historyAction.before.supportPlans.push({
            docId,
            hadExistingGoals: !!group.existingGoals,
            goals: group.existingGoals || ''
          });
          historyAction.after.supportPlans.push({
            docId,
            payload: metaUpdate
          });
        }

        await addBatchOp((b) => b.set(planMetaRef, metaUpdate, { merge: true }));

        // 2. daily_reports の保存
        const selectedRecs = group.records.filter(r => r.selected);

        for (const rec of selectedRecs) {
          let finalResult = rec.resultInfo;
          let finalFuture = rec.futurePlan;
          let finalSupport = [...rec.supportContent];

          // 追加モード（上書きOFF）の場合、既存データとマージ
          if (!rec.isOverwrite) {
            // 療育結果の追加
            if (rec.existingResultInfo) {
              if (rec.resultInfo && !rec.existingResultInfo.includes(rec.resultInfo)) {
                finalResult = `${rec.existingResultInfo}\n${rec.resultInfo}`.trim();
              } else {
                finalResult = rec.existingResultInfo;
              }
            }

            // 今後の予定の追加
            if (rec.existingFuturePlan) {
              if (rec.futurePlan && !rec.existingFuturePlan.includes(rec.futurePlan)) {
                finalFuture = `${rec.existingFuturePlan}\n${rec.futurePlan}`.trim();
              } else {
                finalFuture = rec.existingFuturePlan;
              }
            }

            // 療育内容のマージ
            if (rec.existingSupportContent && rec.existingSupportContent.length > 0) {
              const combined = [...rec.existingSupportContent];
              for (const s of rec.supportContent) {
                if (!combined.includes(s)) {
                  combined.push(s);
                }
              }
              finalSupport = combined;
            }
          }

          // 既存のツリー通信（連絡帳本文）を保持（上書き・消去しない）
          const finalExternalInfo = rec.existingExternalInfo || rec.existingRawData?.content?.externalInfo || rec.existingRawData?.externalInfo || '';

          const dailyPayload: any = {
            childId: group.childId,
            planMonth: group.planMonth,
            date: rec.formattedDate,
            staffId: '',
            staffName: loginStaffName,
            type: 'tree_report',
            content: {
              externalInfo: finalExternalInfo, // 既存のツリー通信テキストを維持してくっつける
              supportContent: finalSupport,
              resultInfo: finalResult,
              futurePlan: finalFuture,
              isVerified: false
            },
            externalInfo: finalExternalInfo,
            archived: false,
            officeId: effectiveOfficeId,
            office: effectiveOfficeName,
            updatedAt: serverTimestamp()
          };

          if (rec.existingReportId) {
            const existingRef = doc(db, 'daily_reports', rec.existingReportId);
            await addBatchOp((b) => b.update(existingRef, dailyPayload));

            historyAction.before.dailyReports.push({
              id: rec.existingReportId,
              isNew: false,
              data: rec.existingRawData || {
                childId: group.childId,
                planMonth: group.planMonth,
                date: rec.formattedDate,
                content: {
                  externalInfo: finalExternalInfo,
                  supportContent: rec.existingSupportContent || [],
                  resultInfo: rec.existingResultInfo || '',
                  futurePlan: rec.existingFuturePlan || '',
                  isVerified: false
                }
              }
            });
            historyAction.after.dailyReports.push({
              id: rec.existingReportId,
              isNew: false,
              payload: dailyPayload
            });
          } else {
            const newRef = doc(collection(db, 'daily_reports'));
            dailyPayload.createdAt = serverTimestamp();
            await addBatchOp((b) => b.set(newRef, dailyPayload));

            historyAction.before.createdDailyReportIds.push(newRef.id);
            historyAction.after.dailyReports.push({
              id: newRef.id,
              isNew: true,
              payload: dailyPayload
            });
          }

          // tree_communications への反映（ツリー通信本文は消去せず、今後の予定をくっつける）
          const childTreeDoc: any = {
            name: group.childName,
            future_plan: finalFuture,
            pickupLocation: '',
            endTime: '',
            transportTime: '',
            notes: '',
            officeId: effectiveOfficeId,
            office: effectiveOfficeName,
            updatedAt: new Date().toISOString()
          };
          // 既存のツリー通信テキストがある場合のみ反映。空文字で上書きは絶対にしない！
          if (finalExternalInfo) {
            childTreeDoc.tree_comm_text = finalExternalInfo;
          }

          const childTreeRefNoPref = doc(db, `children/${group.childId}/app_categories/書類管理/tree_communications`, rec.formattedDate);
          await addBatchOp((b) => b.set(childTreeRefNoPref, childTreeDoc, { merge: true }));
          if (effectiveOfficeId) {
            const childTreeRefPref = doc(db, `children/${group.childId}/app_categories/書類管理/tree_communications`, `${effectiveOfficeId}_${rec.formattedDate}`);
            await addBatchOp((b) => b.set(childTreeRefPref, childTreeDoc, { merge: true }));
          }

          historyAction.before.treeComms.push({
            childId: group.childId,
            dateKey: rec.formattedDate,
            prefDocId: effectiveOfficeId ? `${effectiveOfficeId}_${rec.formattedDate}` : rec.formattedDate,
            hadExisting: !!(rec.existingFuturePlan && rec.existingFuturePlan.trim()),
            futurePlan: rec.existingFuturePlan || ''
          });
          historyAction.after.treeComms.push({
            childId: group.childId,
            dateKey: rec.formattedDate,
            prefDocId: effectiveOfficeId ? `${effectiveOfficeId}_${rec.formattedDate}` : rec.formattedDate,
            payload: childTreeDoc
          });

          processedCount++;
          setSaveProgress({ current: processedCount, total: totalSelected });
        }
      }

      // 残りのバッチ操作をコミット
      if (opCount > 0) {
        await currentBatch.commit();
      }
      setSuccessMessage(`${totalSelected}件のレコードを正常にインポートしました！`);

      setTimeout(() => {
        if (onImportSuccess) {
          onImportSuccess(historyAction);
        }
        handleClose();
      }, 1200);

    } catch (e: any) {
      console.error('Import execute error:', e);
      setError(`保存中にエラーが発生しました: ${e.message || String(e)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const totalRecordsCount = groups.reduce((acc, g) => acc + g.records.length, 0);
  const totalSelectedCount = groups.reduce((acc, g) => acc + g.records.filter(r => r.selected).length, 0);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* オーバーレイ */}
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={handleClose} />

      {/* モーダル本体 */}
      <div className="relative bg-white w-full max-w-6xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in zoom-in duration-200">
        
        {/* ヘッダー */}
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-600/10 text-emerald-600 flex items-center justify-center shadow-xs">
              <FileSpreadsheet size={22} />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-800 tracking-tight flex items-center gap-2">
                専門的支援実施計画のExcelインポート
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">自動照合・確認機能付</span>
              </h2>
              <p className="text-[12px] text-slate-500 font-medium">
                名前・対象年月を自動照合し、「療育内容」「療育結果」「今後の予定」を取り込みます
              </p>
            </div>
          </div>
          <button onClick={handleClose} className="p-2 hover:bg-black/5 rounded-full text-slate-400 hover:text-slate-600 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* コンテンツエリア */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6">
          
          {error && (
            <div className="bg-red-50 text-red-700 p-4 rounded-2xl text-sm flex items-start gap-3 border border-red-200 shadow-xs animate-shake">
              <AlertCircle size={20} className="flex-shrink-0 mt-0.5 text-red-500" />
              <div className="space-y-1">
                <p className="font-bold">エラーが発生しました</p>
                <p className="text-xs text-red-600 leading-relaxed">{error}</p>
              </div>
            </div>
          )}

          {successMessage && (
            <div className="bg-emerald-50 text-emerald-800 p-4 rounded-2xl text-sm flex items-center gap-3 border border-emerald-200 shadow-xs animate-fade-in">
              <div className="w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0">
                <Check size={18} className="stroke-[3]" />
              </div>
              <p className="font-bold">{successMessage}</p>
            </div>
          )}

          {/* ステップ1: ファイル・フォルダアップロード */}
          {step === 'upload' && (
            <div className="space-y-6">
              {/* 取り込み対象月の選択カード */}
              <div className="bg-gradient-to-r from-emerald-50/70 to-teal-50/70 border border-emerald-200/80 rounded-2xl p-5 shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-emerald-200/60 pb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-bold shadow-xs">
                      <Calendar size={18} />
                    </div>
                    <div>
                      <h3 className="text-sm font-black text-slate-800">取り込み対象月の選択</h3>
                      <p className="text-[11px] text-slate-500 font-medium">フォルダ内のExcelからどの月を取り込むかを指定できます</p>
                    </div>
                  </div>
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-white border border-emerald-200 text-emerald-800 self-start sm:self-auto">
                    {importMonthMode === 'specific' ? `📅 指定月: ${targetImportMonth}` : '📚 全月のデータ'}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* オプション1: 指定した月のみ取り込む */}
                  <div
                    onClick={() => setImportMonthMode('specific')}
                    className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                      importMonthMode === 'specific'
                        ? 'border-emerald-600 bg-white shadow-sm ring-2 ring-emerald-500/20'
                        : 'border-slate-200/80 bg-white/70 hover:bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 mb-1.5">
                      <input
                        type="radio"
                        id="mode-specific"
                        name="importMonthMode"
                        checked={importMonthMode === 'specific'}
                        onChange={() => setImportMonthMode('specific')}
                        className="w-4 h-4 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                      />
                      <label htmlFor="mode-specific" className="font-black text-slate-800 text-sm cursor-pointer">
                        指定した月のみ取り込む
                      </label>
                      <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
                        推奨
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mb-3 pl-6.5 leading-relaxed">
                      指定した月のシート（例: <span className="font-semibold text-slate-700">202609、9月</span> など）のみを自動照合して取り込みます。
                    </p>
                    <div className="pl-6.5 flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="month"
                        value={targetImportMonth}
                        onChange={(e) => {
                          setTargetImportMonth(e.target.value);
                          setImportMonthMode('specific');
                        }}
                        className="px-3 py-1.5 bg-slate-50 hover:bg-white focus:bg-white border border-slate-300 rounded-lg text-sm font-black text-slate-800 focus:ring-2 focus:ring-emerald-500 transition-all cursor-pointer shadow-2xs"
                      />
                      {targetImportMonth && (
                        <span className="text-xs font-bold text-emerald-700 bg-emerald-100/80 px-2.5 py-1 rounded-md">
                          {(() => {
                            const [y, m] = targetImportMonth.split('-');
                            return y && m ? `${y}年 ${parseInt(m, 10)}月分` : '';
                          })()}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* オプション2: すべての月を取り込む */}
                  <div
                    onClick={() => setImportMonthMode('all')}
                    className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex flex-col justify-between ${
                      importMonthMode === 'all'
                        ? 'border-emerald-600 bg-white shadow-sm ring-2 ring-emerald-500/20'
                        : 'border-slate-200/80 bg-white/70 hover:bg-white hover:border-slate-300'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2.5 mb-1.5">
                        <input
                          type="radio"
                          id="mode-all"
                          name="importMonthMode"
                          checked={importMonthMode === 'all'}
                          onChange={() => setImportMonthMode('all')}
                          className="w-4 h-4 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                        />
                        <label htmlFor="mode-all" className="font-black text-slate-800 text-sm cursor-pointer">
                          すべての月のデータを取り込む（全月）
                        </label>
                      </div>
                      <p className="text-xs text-slate-500 mb-3 pl-6.5 leading-relaxed">
                        Excelファイル内にある<span className="font-semibold text-slate-700">過去〜未来のすべての月のシート</span>を一括で読み込んで取り込みます。
                      </p>
                    </div>
                    <div className="pl-6.5">
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-md border border-slate-200">
                        📁 複数月のシートをまとめて取り込み
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <input 
                type="file" 
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".xlsx, .xls"
                multiple
                className="hidden"
              />
              <input 
                type="file" 
                ref={folderInputRef}
                onChange={handleFolderChange}
                // @ts-ignore
                webkitdirectory=""
                directory=""
                multiple
                className="hidden"
              />

              {/* 読み込み進捗中の表示 */}
              {isProcessingFiles ? (
                <div className="w-full h-80 bg-slate-50 rounded-3xl border-2 border-slate-200 flex flex-col items-center justify-center p-8 shadow-xs">
                  <div className="w-16 h-16 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center mb-4 animate-pulse">
                    <Loader2 size={32} className="animate-spin" />
                  </div>
                  <h3 className="text-lg font-black text-slate-800 tracking-tight mb-1">
                    Excelファイルを解析中...
                  </h3>
                  <p className="text-sm font-bold text-emerald-600 mb-4">
                    {processingProgress.current} / {processingProgress.total} ファイル完了
                  </p>
                  <p className="text-xs text-slate-400 font-medium truncate max-w-md">
                    {processingProgress.fileName}
                  </p>
                  <div className="w-64 h-2 bg-slate-200 rounded-full mt-4 overflow-hidden">
                    <div 
                      className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                      style={{ width: `${(processingProgress.current / Math.max(1, processingProgress.total)) * 100}%` }}
                    />
                  </div>
                </div>
              ) : (
                <div 
                  onDragOver={e => e.preventDefault()}
                  onDrop={handleDrop}
                  className="w-full bg-slate-50 rounded-3xl border-2 border-dashed border-slate-200 hover:border-emerald-500/50 hover:bg-emerald-50/20 transition-all flex flex-col items-center justify-center p-8 shadow-xs"
                >
                  <div className="w-20 h-20 rounded-3xl bg-white text-emerald-600 shadow-md flex items-center justify-center mb-5">
                    <Upload size={32} />
                  </div>
                  <h3 className="text-lg font-black text-slate-800 tracking-tight mb-2">
                    専門的支援実施計画のエクセルファイルをここにドロップ
                  </h3>
                  <p className="text-sm text-slate-400 font-semibold mb-6">
                    複数ファイル、またはフォルダごとの一括読み込みに対応しています
                  </p>

                  {/* アクションボタン群 */}
                  <div className="flex flex-wrap items-center justify-center gap-3 mb-6">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl font-bold text-sm shadow-md hover:shadow-lg transition-all"
                    >
                      <FileUp size={18} />
                      <span>ファイルを選択 (.xlsx / .xls)</span>
                    </button>
                    <button
                      type="button"
                      onClick={handlePickFolder}
                      className="flex items-center gap-2 bg-white hover:bg-slate-100 text-slate-800 border-2 border-emerald-600/30 hover:border-emerald-600 px-5 py-2.5 rounded-xl font-bold text-sm shadow-xs hover:shadow-md transition-all"
                    >
                      <FolderOpen size={18} className="text-emerald-600" />
                      <span>
                        {importMonthMode === 'specific'
                          ? `📁 フォルダを選択して ${targetImportMonth} 分のみ一括読み込み`
                          : '📁 フォルダを選択して一括読み込み'}
                      </span>
                    </button>
                  </div>

                  <div className="bg-white/80 border border-slate-200/80 rounded-2xl p-4 text-xs text-slate-600 leading-relaxed text-center font-medium max-w-lg space-y-1 shadow-xs">
                    <p className="font-bold text-slate-700">💡 自動で読み取られる項目</p>
                    <p>・シート名「202609」「202509」等や「令和 年 月」から年と月を自動判定</p>
                    <p>・右上「名前」欄から児童を自動照合（児童ごとのタブで確認可能）</p>
                    <p>・「日付」「療育内容」「療育を行った結果」「今後の予定」を自動抽出</p>
                    <p>・「情報すべて上書き」「すべての支援目標を上書き」で一括設定可能</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ステップ2: プレビュー＆確認画面 */}
          {step === 'preview' && (
            <div className="space-y-6">
              
              {/* ファイル概要バー */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-50 border border-slate-200/70 rounded-2xl p-4 md:p-5 shadow-xs">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-emerald-600 font-bold shadow-xs">
                    <FileSpreadsheet size={20} />
                  </div>
                  <div>
                    <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">読み込み対象</div>
                    <div className="text-sm font-black text-slate-800">{fileName}</div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <div>
                    <span className="text-xs text-slate-400 font-bold mr-1">取り込み対象:</span>
                    <span className="font-black text-slate-800 bg-white px-2.5 py-1 rounded-lg border border-slate-200 shadow-2xs">
                      {importMonthMode === 'specific' ? `📅 ${targetImportMonth} のみ` : `📚 全月 (${availableMonths.length} ヶ月分)`}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-slate-400 font-bold mr-1">対象児童:</span>
                    <span className="font-black text-slate-800">{childTabs.length} 名 ({groups.length} シート)</span>
                  </div>
                  <div>
                    <span className="text-xs text-slate-400 font-bold mr-1">検出レコード:</span>
                    <span className="font-black text-emerald-600">{totalSelectedCount} / {totalRecordsCount} 件 選択中</span>
                  </div>
                  {isLoadingExisting && (
                    <div className="flex items-center gap-1.5 text-xs text-primary font-bold animate-pulse">
                      <RefreshCw size={14} className="animate-spin" />
                      <span>既存データ確認中...</span>
                    </div>
                  )}
                </div>
              </div>

              {/* 登録先事業所（Office）の選択バー */}
              <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold shrink-0 shadow-2xs">
                    <Building2 size={20} />
                  </div>
                  <div>
                    <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">登録先事業所ステータス</div>
                    <div className="text-sm font-bold text-slate-800">
                      すべての書類に <span className="font-black text-primary underline decoration-2 decoration-primary/40 underline-offset-2">【{getOfficeTag(selectedOfficeIdState, offices)}】</span> のステータスを付けて登録します
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 bg-slate-200/70 p-1 rounded-xl shrink-0">
                  <span className="text-xs font-bold text-slate-600 ml-2 mr-1 hidden sm:inline">事業所切替:</span>
                  {offices.map(office => {
                    const isActive = selectedOfficeIdState === office.id;
                    const displayName = getOfficeTag(office.id, offices);
                    return (
                      <button
                        key={office.id}
                        type="button"
                        onClick={() => {
                          setSelectedOfficeIdState(office.id);
                          loadExistingData(groups, office.id);
                        }}
                        className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${
                          isActive
                            ? 'bg-white text-slate-800 shadow-sm'
                            : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        {displayName}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 月別絞り込みフィルター（複数月が存在する場合に表示） */}
              {availableMonths.length > 1 && (
                <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-black text-slate-600 flex items-center gap-1.5 shrink-0 mr-1">
                      <Calendar size={15} className="text-emerald-600" />
                      月で絞り込み表示:
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveMonthFilter('all')}
                      className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                        activeMonthFilter === 'all'
                          ? 'bg-slate-800 text-white shadow-xs'
                          : 'bg-white hover:bg-slate-200/70 text-slate-700 border border-slate-200'
                      }`}
                    >
                      すべて表示 (全月)
                      <span className={`ml-1.5 px-1.5 py-0.2 rounded-full text-[10px] ${
                        activeMonthFilter === 'all' ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {groups.length}
                      </span>
                    </button>
                    {availableMonths.map(m => {
                      const [y, mon] = m.split('-');
                      const label = `${y}年${parseInt(mon, 10)}月`;
                      const count = groups.filter(g => g.planMonth === m).length;
                      const isActive = activeMonthFilter === m;
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setActiveMonthFilter(m)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border ${
                            isActive
                              ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs ring-2 ring-emerald-200'
                              : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                          }`}
                        >
                          <span>{label}</span>
                          <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                            isActive ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-600'
                          }`}>
                            {count}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {activeMonthFilter !== 'all' && (
                    <button
                      type="button"
                      onClick={() => setActiveMonthFilter('all')}
                      className="text-xs text-slate-500 hover:text-slate-800 font-bold underline decoration-slate-300 underline-offset-2"
                    >
                      絞り込みを解除
                    </button>
                  )}
                </div>
              )}

              {/* クイック一括操作バー */}
              <div className="bg-white border border-slate-200 rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-3 shadow-xs">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-xs font-bold text-slate-500 flex items-center gap-1">
                    <Layers size={14} className="text-slate-400" />
                    一括モード設定:
                  </span>

                  {/* 上書き / 追加の明示的ボタングループ */}
                  <div className="inline-flex bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                    <button
                      type="button"
                      onClick={() => handleBulkOverwrite(true)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all cursor-pointer ${
                        groups.every(g => g.allOverwrite)
                          ? 'bg-amber-500 text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                      }`}
                      title="既存の文章をExcelの内容で完全に置き換えます"
                    >
                      <RefreshCw size={13} className={groups.every(g => g.allOverwrite) ? 'text-white' : 'text-amber-600'} />
                      <span>✏️ すべて上書き</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleBulkOverwrite(false)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all cursor-pointer ${
                        groups.every(g => !g.allOverwrite && g.records.every(r => !r.isOverwrite))
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                      }`}
                      title="既存の文章の後ろに改行して足します"
                    >
                      <Plus size={13} className={groups.every(g => !g.allOverwrite && g.records.every(r => !r.isOverwrite)) ? 'text-white' : 'text-blue-600'} />
                      <span>➕ すべて追加</span>
                    </button>
                  </div>

                  {/* すべての支援目標を上書きボタン */}
                  <button
                    type="button"
                    onClick={() => {
                      const allCurrentlyGoals = groups.every(g => g.importGoals);
                      handleBulkGoals(!allCurrentlyGoals);
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      groups.every(g => g.importGoals)
                        ? 'bg-violet-600 text-white shadow-xs ring-2 ring-violet-200'
                        : 'bg-violet-50 hover:bg-violet-100 text-violet-800 border border-violet-200 shadow-2xs'
                    }`}
                    title="すべての児童の支援目標反映を一括で切り替えます"
                  >
                    <Target size={13} className={groups.every(g => g.importGoals) ? 'text-white' : 'text-violet-600'} />
                    <span>{groups.every(g => g.importGoals) ? '✔ 支援目標をすべて反映中' : 'すべての支援目標を反映'}</span>
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {(activeChildTabId !== 'all' || activeMonthFilter !== 'all') && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleVisibleSelect(true)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 transition-colors cursor-pointer"
                        title="現在表示されている児童・月のみ選択します"
                      >
                        <CheckSquare size={13} className="text-emerald-600" />
                        <span>表示中のみ選択</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleVisibleSelect(false)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 transition-colors cursor-pointer"
                        title="現在表示されている児童・月のみ選択解除します"
                      >
                        <Square size={13} className="text-slate-400" />
                        <span>表示中のみ解除</span>
                      </button>
                    </>
                  )}
                  {/* 全選択 */}
                  <button
                    type="button"
                    onClick={() => handleBulkSelect(true)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
                  >
                    <CheckSquare size={13} className="text-emerald-600" />
                    <span>すべて全選択</span>
                  </button>
                  {/* 全解除 */}
                  <button
                    type="button"
                    onClick={() => handleBulkSelect(false)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
                  >
                    <Square size={13} className="text-slate-400" />
                    <span>すべて解除</span>
                  </button>
                </div>
              </div>

              {/* 注意・説明ガイド */}
              <div className="bg-blue-50/80 border border-blue-200/80 rounded-2xl p-4 text-xs text-blue-900 flex items-start gap-3 shadow-xs">
                <Info size={18} className="text-blue-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold">インポート方式の確認ガイド</p>
                  <p className="text-blue-700 leading-relaxed">
                    ・<span className="font-bold text-amber-900">「上書き」モード（標準）</span>: 既存のデータをExcelの内容で完全に置き換えます（既存の文章に足されることはありません）。<br />
                    ・<span className="font-bold text-blue-900">「追加」モード</span>: すでにデータがある日付は、既存の文章の後ろに改行して追記されます。<br />
                    ・<span className="font-bold text-violet-900">「支援目標を反映」</span>: 有効にすると、Excel内の支援目標をその月の目標として上書き保存します。
                  </p>
                </div>
              </div>

              {/* 児童別タブナビゲーション */}
              <div className="border-b border-slate-200">
                <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin">
                  {/* すべて表示タブ */}
                  <button
                    type="button"
                    onClick={() => setActiveChildTabId('all')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black transition-all whitespace-nowrap ${
                      activeChildTabId === 'all'
                        ? 'bg-slate-800 text-white shadow-xs'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                    }`}
                  >
                    <Users size={14} />
                    <span>すべて表示</span>
                    <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                      activeChildTabId === 'all' ? 'bg-slate-700 text-white' : 'bg-slate-200 text-slate-700'
                    }`}>
                      {groups.length}
                    </span>
                  </button>

                  {/* 各児童タブ */}
                  {childTabs.map(tab => {
                    const isActive = activeChildTabId === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveChildTabId(tab.id)}
                        className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap border ${
                          isActive
                            ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                            : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
                        }`}
                      >
                        {!tab.isMatched ? (
                          <AlertTriangle size={13} className={isActive ? 'text-amber-200' : 'text-amber-500'} />
                        ) : (
                          <UserCheck size={13} className={isActive ? 'text-emerald-200' : 'text-emerald-600'} />
                        )}
                        <span>{tab.name}</span>
                        <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                          isActive ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-600'
                        }`}>
                          {tab.groupCount}ヶ月 / {tab.selectedRecords}件
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 児童・月ごとのグループリスト */}
              {/* 児童・月ごとのグループリスト */}
              <div className="space-y-8">
                {visibleGroups.map((group) => {
                  const gIdx = groups.findIndex(g => g.groupId === group.groupId);
                  return (
                    <div key={group.groupId} className="border border-slate-200 rounded-3xl overflow-hidden shadow-sm bg-white">
                      
                      {/* グループヘッダー (児童情報 & 月設定) */}
                      <div className="bg-slate-50/90 border-b border-slate-200 p-5 md:p-6 space-y-4">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                          
                          {/* 児童情報 & 照合 */}
                          <div className="flex items-center gap-3">
                            <div className={`w-11 h-11 rounded-2xl flex items-center justify-center font-black text-white shadow-xs ${group.isMatched ? 'bg-emerald-600' : 'bg-amber-500'}`}>
                              {group.isMatched ? <UserCheck size={22} /> : <AlertTriangle size={22} />}
                            </div>
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-xs font-bold text-slate-400">Excel内の表記:</span>
                                <span className="text-xs font-bold bg-slate-200/80 text-slate-700 px-2 py-0.5 rounded-md">
                                  {group.rawExcelChildName}
                                </span>
                                {group.sourceFileName && (
                                  <span className="text-[10px] font-semibold text-slate-500 bg-white border border-slate-200 px-2 py-0.5 rounded-md">
                                    📄 {group.sourceFileName}
                                  </span>
                                )}
                                {group.isMatched ? (
                                  <span className="text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                                    照合成功
                                  </span>
                                ) : (
                                <span className="text-[11px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                                  児童を選択してください
                                </span>
                              )}
                            </div>
                            
                            {/* 児童選択ドロップダウン */}
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-sm font-black text-slate-800">インポート先児童:</span>
                              <select
                                value={group.childId}
                                onChange={e => handleChildChange(gIdx, e.target.value)}
                                className="font-bold text-sm bg-white border border-slate-300 rounded-xl px-3 py-1 text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 shadow-xs"
                              >
                                {childrenData.map(c => (
                                  <option key={c.id} value={c.id}>
                                    {c.fullName} ({c.id})
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                          {/* 事業所セレクター */}
                          <div className="flex items-center gap-2.5 bg-white border border-slate-200 rounded-2xl px-3.5 py-2 shadow-xs">
                            <Building2 size={16} className="text-primary" />
                            <div>
                              <div className="text-[10px] font-bold text-slate-400 uppercase">登録先事業所</div>
                              <select
                                value={group.officeId || selectedOfficeIdState}
                                onChange={e => {
                                  const newOfficeId = e.target.value;
                                  setGroups(prev => {
                                    const copy = [...prev];
                                    copy[gIdx] = { ...copy[gIdx], officeId: newOfficeId };
                                    return copy;
                                  });
                                  loadExistingData([groups[gIdx]], newOfficeId);
                                }}
                                className="font-black text-xs text-slate-800 bg-transparent focus:outline-hidden cursor-pointer"
                              >
                                {offices.map(o => (
                                  <option key={o.id} value={o.id}>{getOfficeTag(o.id, offices)}</option>
                                ))}
                              </select>
                            </div>
                          </div>

                          {/* 対象年月セレクター */}
                          <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-2xl px-4 py-2 shadow-xs">
                            <Calendar size={18} className="text-slate-400" />
                            <div>
                              <div className="text-[10px] font-bold text-slate-400 uppercase">対象年月</div>
                              <input
                                type="month"
                                value={group.planMonth}
                                onChange={e => handleMonthChange(gIdx, e.target.value)}
                                className="font-black text-sm text-slate-800 bg-transparent focus:outline-hidden cursor-pointer"
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 支援目標セクション */}
                      {group.excelGoals && (
                        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 space-y-2 shadow-2xs">
                          <div className="flex items-center justify-between">
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={group.importGoals}
                                onChange={() => handleToggleGoals(gIdx)}
                                className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                              />
                              <span className="font-black text-xs text-slate-800 flex items-center gap-1.5">
                                <Target size={15} className="text-emerald-600" />
                                この月の支援目標も反映する（チェックで有効）
                              </span>
                            </label>
                            {group.existingGoals && (
                              <span className="text-[11px] font-semibold text-slate-400">
                                既存の目標が登録されています
                              </span>
                            )}
                          </div>
                          
                          {(() => {
                            const parsedExcel = parseGoalsText(group.excelGoals);
                            const parsedExisting = group.existingGoals ? parseGoalsText(group.existingGoals) : null;

                            return (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs pt-1">
                                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/80 space-y-2">
                                  <span className="font-bold text-[10px] text-slate-500 block uppercase tracking-wider">
                                    Excelの支援目標（解析結果プレビュー）
                                  </span>
                                  <div className="space-y-2 text-[11px]">
                                    {parsedExcel.longTerm.length > 0 && (
                                      <div className="flex gap-2 items-start">
                                        <span className="shrink-0 text-[10px] font-bold text-slate-500 bg-slate-200 px-1.5 py-0.5 rounded">長期目標</span>
                                        <div className="space-y-0.5">
                                          {parsedExcel.longTerm.map((t, idx) => (
                                            <p key={idx} className="text-slate-700 flex items-start gap-1">
                                              <span className="text-emerald-500 font-bold">▸</span>
                                              <span>{t}</span>
                                            </p>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {parsedExcel.shortTerm.length > 0 && (
                                      <div className="flex gap-2 items-start">
                                        <span className="shrink-0 text-[10px] font-bold text-slate-500 bg-slate-200 px-1.5 py-0.5 rounded">短期目標</span>
                                        <div className="space-y-0.5">
                                          {parsedExcel.shortTerm.map((t, idx) => (
                                            <p key={idx} className="text-slate-700 flex items-start gap-1">
                                              <span className="text-emerald-500 font-bold">▸</span>
                                              <span>{t}</span>
                                            </p>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {parsedExcel.personal.length > 0 && (
                                      <div className="flex gap-2 items-start">
                                        <span className="shrink-0 text-[10px] font-bold text-violet-700 bg-violet-100 px-1.5 py-0.5 rounded">本人支援</span>
                                        <div className="space-y-0.5">
                                          {parsedExcel.personal.map((t, idx) => (
                                            <p key={idx} className="text-slate-700 flex items-start gap-1">
                                              <span className="text-emerald-500 font-bold">▸</span>
                                              <span>{t}</span>
                                            </p>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {parsedExcel.family.length > 0 && (
                                      <div className="flex gap-2 items-start">
                                        <span className="shrink-0 text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">家族支援</span>
                                        <div className="space-y-0.5">
                                          {parsedExcel.family.map((t, idx) => (
                                            <p key={idx} className="text-slate-700 flex items-start gap-1">
                                              <span className="text-emerald-500 font-bold">▸</span>
                                              <span>{t}</span>
                                            </p>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {parsedExcel.transition.length > 0 && (
                                      <div className="flex gap-2 items-start">
                                        <span className="shrink-0 text-[10px] font-bold text-orange-700 bg-orange-100 px-1.5 py-0.5 rounded">移行支援</span>
                                        <div className="space-y-0.5">
                                          {parsedExcel.transition.map((t, idx) => (
                                            <p key={idx} className="text-slate-700 flex items-start gap-1">
                                              <span className="text-emerald-500 font-bold">▸</span>
                                              <span>{t}</span>
                                            </p>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {parsedExcel.other.length > 0 && (
                                      <div className="flex gap-2 items-start">
                                        <span className="shrink-0 text-[10px] font-bold text-slate-600 bg-slate-200 px-1.5 py-0.5 rounded">目標</span>
                                        <div className="space-y-0.5">
                                          {parsedExcel.other.map((t, idx) => (
                                            <p key={idx} className="text-slate-700 flex items-start gap-1">
                                              <span className="text-emerald-500 font-bold">▸</span>
                                              <span>{t}</span>
                                            </p>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {group.existingGoals && parsedExisting ? (
                                  <div className="bg-amber-50/50 p-3 rounded-xl border border-amber-200/60 space-y-2">
                                    <span className="font-bold text-[10px] text-amber-700 block uppercase tracking-wider">
                                      現在の登録内容（上書き前）
                                    </span>
                                    <div className="space-y-1.5 text-[11px]">
                                      {parsedExisting.longTerm.length > 0 && (
                                        <p className="text-slate-700"><span className="font-bold text-slate-500 mr-1">[長期]</span>{parsedExisting.longTerm.join(' / ')}</p>
                                      )}
                                      {parsedExisting.shortTerm.length > 0 && (
                                        <p className="text-slate-700"><span className="font-bold text-slate-500 mr-1">[短期]</span>{parsedExisting.shortTerm.join(' / ')}</p>
                                      )}
                                      {parsedExisting.personal.length > 0 && (
                                        <p className="text-violet-800"><span className="font-bold mr-1">[本人]</span>{parsedExisting.personal.join(' / ')}</p>
                                      )}
                                      {parsedExisting.family.length > 0 && (
                                        <p className="text-emerald-800"><span className="font-bold mr-1">[家族]</span>{parsedExisting.family.join(' / ')}</p>
                                      )}
                                      {parsedExisting.transition.length > 0 && (
                                        <p className="text-orange-800"><span className="font-bold mr-1">[移行]</span>{parsedExisting.transition.join(' / ')}</p>
                                      )}
                                    </div>
                                  </div>
                                ) : (
                                  <div className="bg-slate-50/50 p-3 rounded-xl border border-slate-100 flex items-center justify-center text-slate-400 italic text-[11px]">
                                    現在の支援目標は未登録です
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      )}

                      {/* 一括操作バー */}
                      <div className="flex items-center justify-between pt-1 border-t border-slate-200/60 text-xs font-bold text-slate-600">
                        <div className="flex items-center gap-4">
                          <label className="flex items-center gap-1.5 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={group.allSelected}
                              onChange={() => handleToggleAllSelected(gIdx)}
                              className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                            />
                            <span>すべて選択</span>
                          </label>

                          <span className="text-slate-300">|</span>

                          <label className="flex items-center gap-1.5 cursor-pointer select-none text-amber-700">
                            <input
                              type="checkbox"
                              checked={group.allOverwrite}
                              onChange={() => handleToggleAllOverwrite(gIdx)}
                              className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500 cursor-pointer"
                            />
                            <span>この児童の全レコードを一括上書きにする</span>
                          </label>
                        </div>

                        <div className="text-slate-500">
                          {group.records.filter(r => r.selected).length} / {group.records.length} 件 選択中
                        </div>
                      </div>
                    </div>

                    {/* レコード一覧テーブル */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-500 font-bold">
                            <th className="p-3 w-12 text-center">選択</th>
                            <th className="p-3 w-24">日付</th>
                            <th className="p-3 w-28">状態</th>
                            <th className="p-3 w-28 text-center">上書き設定</th>
                            <th className="p-3 w-48">療育内容</th>
                            <th className="p-3 min-w-[220px]">療育を行った結果</th>
                            <th className="p-3 min-w-[200px]">今後の予定</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {group.records.map((rec, rIdx) => {
                            const hasExisting = !!(rec.existingResultInfo || rec.existingFuturePlan || (rec.existingSupportContent && rec.existingSupportContent.length > 0));

                            return (
                              <tr 
                                key={rec.tempId} 
                                className={`hover:bg-slate-50/90 transition-colors ${
                                  !rec.selected 
                                    ? 'opacity-40 bg-slate-50/40' 
                                    : !hasExisting
                                      ? 'bg-emerald-50/35 border-l-4 border-l-emerald-500' 
                                      : rec.isOverwrite
                                        ? 'bg-amber-50/20'
                                        : 'bg-blue-50/30 border-l-4 border-l-blue-500'
                                }`}
                              >
                                {/* 選択チェック */}
                                <td className="p-3 text-center">
                                  <input
                                    type="checkbox"
                                    checked={rec.selected}
                                    onChange={() => handleToggleRecordSelected(gIdx, rIdx)}
                                    className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                                  />
                                </td>

                                {/* 日付 */}
                                <td className="p-3 font-black text-slate-800 whitespace-nowrap">
                                  {rec.date}
                                </td>

                                {/* 状態バッジ */}
                                <td className="p-3 whitespace-nowrap">
                                  <div className="flex flex-col gap-1 items-start">
                                    {hasExisting ? (
                                      rec.isOverwrite ? (
                                        <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                                          既存あり・上書き
                                        </span>
                                      ) : (
                                        <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-900 border border-blue-300">
                                          既存あり・追加合体
                                        </span>
                                      )
                                    ) : (
                                      <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-900 border border-emerald-300">
                                        ✨ 新規登録
                                      </span>
                                    )}
                                    {rec.existingExternalInfo && (
                                      <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200" title="既存のツリー通信（連絡帳本文）は保持され、療育結果・予定と結合されます">
                                        💬 ツリー通信保持
                                      </span>
                                    )}
                                  </div>
                                </td>

                                {/* 上書きチェック */}
                                <td className="p-3 text-center">
                                  {hasExisting ? (
                                    <button
                                      type="button"
                                      onClick={() => handleToggleRecordOverwrite(gIdx, rIdx)}
                                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold transition-all cursor-pointer shadow-2xs ${
                                        rec.isOverwrite
                                          ? 'bg-amber-500 hover:bg-amber-600 text-white ring-2 ring-amber-200'
                                          : 'bg-blue-600 hover:bg-blue-700 text-white ring-2 ring-blue-200'
                                      }`}
                                      title="クリックして上書き／追加を切り替え"
                                    >
                                      {rec.isOverwrite ? '✏️ 上書き' : '➕ 追加'}
                                    </button>
                                  ) : (
                                    <span className="text-[11px] text-slate-300 font-medium">-</span>
                                  )}
                                </td>

                                {/* 療育内容 */}
                                <td className="p-3">
                                  <div className="flex flex-wrap gap-1">
                                    {rec.supportContent.length > 0 ? (
                                      rec.supportContent.map((s, idx) => (
                                        <span key={idx} className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-[10px] font-semibold">
                                          {s}
                                        </span>
                                      ))
                                    ) : (
                                      <span className="text-slate-300 italic text-[10px]">未入力</span>
                                    )}
                                  </div>
                                </td>

                                {/* 療育を行った結果 */}
                                <td className="p-3">
                                  <div className="space-y-1.5">
                                    {!hasExisting ? (
                                      // 新規登録の場合（エメラルドで強調）
                                      <div className="bg-emerald-50 text-emerald-950 p-2 rounded-lg border border-emerald-300 shadow-2xs">
                                        <span className="text-[10px] font-bold text-emerald-700 block mb-0.5">📥 新規インポート内容:</span>
                                        <p className="line-clamp-3 leading-relaxed font-medium">{rec.resultInfo || <span className="text-slate-300 italic">空欄</span>}</p>
                                      </div>
                                    ) : rec.isOverwrite ? (
                                      // 上書きの場合（オレンジ枠）
                                      <div className="space-y-1">
                                        <div className="bg-amber-50 text-amber-950 p-2 rounded-lg border border-amber-300 shadow-2xs">
                                          <span className="text-[10px] font-bold text-amber-800 block mb-0.5">✏️ 上書き後の内容 (Excel):</span>
                                          <p className="line-clamp-3 leading-relaxed font-medium">{rec.resultInfo || <span className="text-slate-300 italic">空欄</span>}</p>
                                        </div>
                                        {rec.existingResultInfo && (
                                          <p className="text-[10px] text-slate-400 pl-1 line-through truncate" title={rec.existingResultInfo}>
                                            元: {rec.existingResultInfo}
                                          </p>
                                        )}
                                      </div>
                                    ) : (
                                      // 追加モードの場合（既存はグレー、追加分は鮮やかなブルー枠で明確にハイライト！）
                                      <div className="space-y-1.5">
                                        {rec.existingResultInfo && (
                                          <div className="bg-slate-100 p-1.5 rounded text-slate-600 text-[10px] border border-slate-200">
                                            <span className="font-bold text-slate-500 block mb-0.5">📄 既存の文章:</span>
                                            <p className="line-clamp-2">{rec.existingResultInfo}</p>
                                          </div>
                                        )}
                                        <div className="bg-blue-50 text-blue-950 p-2 rounded-lg border-2 border-blue-400 shadow-xs">
                                          <span className="text-[10px] font-bold text-blue-700 flex items-center gap-1 mb-0.5">
                                            <span className="inline-block w-2 h-2 rounded-full bg-blue-500"></span>
                                            ✨ 今回追加される文章（足される分）:
                                          </span>
                                          <p className="line-clamp-3 leading-relaxed font-bold text-blue-900 bg-blue-100/70 p-1 rounded">
                                            {rec.resultInfo || <span className="text-slate-300 italic">空欄</span>}
                                          </p>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </td>

                                {/* 今後の予定 */}
                                <td className="p-3">
                                  <div className="space-y-1.5">
                                    {!hasExisting ? (
                                      // 新規登録の場合（エメラルドで強調）
                                      <div className="bg-emerald-50 text-emerald-950 p-2 rounded-lg border border-emerald-300 shadow-2xs">
                                        <span className="text-[10px] font-bold text-emerald-700 block mb-0.5">📥 新規インポート予定:</span>
                                        <p className="line-clamp-3 leading-relaxed font-medium">{rec.futurePlan || <span className="text-slate-300 italic">空欄</span>}</p>
                                      </div>
                                    ) : rec.isOverwrite ? (
                                      // 上書きの場合（オレンジ枠）
                                      <div className="space-y-1">
                                        <div className="bg-amber-50 text-amber-950 p-2 rounded-lg border border-amber-300 shadow-2xs">
                                          <span className="text-[10px] font-bold text-amber-800 block mb-0.5">✏️ 上書き後の予定 (Excel):</span>
                                          <p className="line-clamp-3 leading-relaxed font-medium">{rec.futurePlan || <span className="text-slate-300 italic">空欄</span>}</p>
                                        </div>
                                        {rec.existingFuturePlan && (
                                          <p className="text-[10px] text-slate-400 pl-1 line-through truncate" title={rec.existingFuturePlan}>
                                            元: {rec.existingFuturePlan}
                                          </p>
                                        )}
                                      </div>
                                    ) : (
                                      // 追加モードの場合（既存はグレー、追加分は鮮やかなブルー枠で明確にハイライト！）
                                      <div className="space-y-1.5">
                                        {rec.existingFuturePlan && (
                                          <div className="bg-slate-100 p-1.5 rounded text-slate-600 text-[10px] border border-slate-200">
                                            <span className="font-bold text-slate-500 block mb-0.5">📄 既存の予定:</span>
                                            <p className="line-clamp-2">{rec.existingFuturePlan}</p>
                                          </div>
                                        )}
                                        <div className="bg-blue-50 text-blue-950 p-2 rounded-lg border-2 border-blue-400 shadow-xs">
                                          <span className="text-[10px] font-bold text-blue-700 flex items-center gap-1 mb-0.5">
                                            <span className="inline-block w-2 h-2 rounded-full bg-blue-500"></span>
                                            ✨ 今回追加される予定（足される分）:
                                          </span>
                                          <p className="line-clamp-3 leading-relaxed font-bold text-blue-900 bg-blue-100/70 p-1 rounded">
                                            {rec.futurePlan || <span className="text-slate-300 italic">空欄</span>}
                                          </p>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    </div>
                  );
                })}
              </div>

            </div>
          )}

        </div>

        {/* フッター */}
        <div className="p-6 bg-slate-50/80 border-t border-slate-100 flex items-center justify-between">
          <button 
            onClick={handleClose}
            disabled={isSaving}
            className="px-6 py-2.5 text-slate-500 font-bold hover:text-slate-800 transition-colors disabled:opacity-50"
          >
            キャンセル
          </button>
          
          {step === 'preview' && (
            <div className="flex items-center gap-3">
              <button 
                onClick={resetState}
                disabled={isSaving}
                className="px-5 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl font-bold transition-all shadow-xs disabled:opacity-50"
              >
                ファイルを再選択
              </button>
              
              <button 
                onClick={handleExecuteImport}
                disabled={isSaving || totalSelectedCount === 0}
                className="px-8 py-2.5 bg-emerald-600 text-white rounded-xl font-black hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-600/20 flex items-center gap-2 active:scale-95 disabled:opacity-50 disabled:active:scale-100"
              >
                {isSaving ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    <span>Firestoreへ保存中... {saveProgress.total > 0 ? `(${saveProgress.current} / ${saveProgress.total}件)` : ''}</span>
                  </>
                ) : (
                  <>
                    <Check size={18} className="stroke-[3]" />
                    <span>{totalSelectedCount}件のデータをインポート実行</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
