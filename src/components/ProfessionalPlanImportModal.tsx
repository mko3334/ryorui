import React, { useState, useRef } from 'react';
import { X, FileSpreadsheet, AlertCircle, Check, Upload } from 'lucide-react';
import * as XLSX from 'xlsx';
import type { ProfessionalPlanDoc, SupportRow, ServiceHoursPlan, DaySchedule, SupportCategory } from '../types/professionalPlan';

type ProfessionalPlanImportModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onImport: (plans: ProfessionalPlanDoc[], hours: ServiceHoursPlan[]) => void;
  childId: string;
};

type ParsedPeriodData = {
  startMonth: string;
  draftPlan?: ProfessionalPlanDoc;
  finalPlan?: ProfessionalPlanDoc;
  serviceHours?: ServiceHoursPlan;
  rawPlanDate?: string;
  rawHoursDate?: string;
  skipImport?: boolean;
};

export const ProfessionalPlanImportModal: React.FC<ProfessionalPlanImportModalProps> = ({
  isOpen,
  onClose,
  onImport,
  childId
}) => {
  const [parsedPeriods, setParsedPeriods] = useState<Record<string, ParsedPeriodData>>({});
  const [expandedHours, setExpandedHours] = useState<Record<string, boolean>>({});
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<'upload' | 'preview'>('upload');
  const [fileName, setFileName] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const parseKanjiDate = (rawVal: string): { formattedDate: string, yearMonth: string } | null => {
    if (!rawVal) return null;
    const cleanVal = rawVal.trim().replace(/[\s　]+/g, '');

    // 1) 令和・R などの和暦 (例: 令和8年6月1日)
    const reiwaMatch = cleanVal.match(/(?:令和|R)\s*(\d+)\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/i);
    if (reiwaMatch) {
      const y = 2018 + parseInt(reiwaMatch[1], 10);
      const m = reiwaMatch[2].padStart(2, '0');
      const d = reiwaMatch[3].padStart(2, '0');
      return { formattedDate: `${y}-${m}-${d}`, yearMonth: `${y}-${m}` };
    }

    // 2) 平成・H などの和暦
    const heiseiMatch = cleanVal.match(/(?:平成|H)\s*(\d+)\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/i);
    if (heiseiMatch) {
      const y = 1988 + parseInt(heiseiMatch[1], 10);
      const m = heiseiMatch[2].padStart(2, '0');
      const d = heiseiMatch[3].padStart(2, '0');
      return { formattedDate: `${y}-${m}-${d}`, yearMonth: `${y}-${m}` };
    }

    // 3) 西暦 (例: 2026年6月1日)
    const seirekiMatch = cleanVal.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    if (seirekiMatch) {
      const y = seirekiMatch[1];
      const m = seirekiMatch[2].padStart(2, '0');
      const d = seirekiMatch[3].padStart(2, '0');
      return { formattedDate: `${y}-${m}-${d}`, yearMonth: `${y}-${m}` };
    }

    // 4) Dateオブジェクトでのパース
    const dObj = new Date(rawVal);
    if (!isNaN(dObj.getTime())) {
      const y = dObj.getFullYear();
      const m = String(dObj.getMonth() + 1).padStart(2, '0');
      const d = String(dObj.getDate()).padStart(2, '0');
      return { formattedDate: `${y}-${m}-${d}`, yearMonth: `${y}-${m}` };
    }

    // 5) YYYY-MM-DD や YYYY-MM
    const simpleMatch = cleanVal.match(/^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?/);
    if (simpleMatch) {
      const y = simpleMatch[1];
      const m = simpleMatch[2].padStart(2, '0');
      const d = (simpleMatch[3] || '01').padStart(2, '0');
      return { formattedDate: `${y}-${m}-${d}`, yearMonth: `${y}-${m}` };
    }

    return null;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processFile(file);
  };

  const parseMonthFromSheetName = (sheetName: string): string | null => {
    const cleanName = sheetName.replace(/[\s　]+/g, '');
    if (cleanName === '原本' || cleanName.includes('原本')) return null;

    // 1) "YYYY-MM" または "YYYYMM"
    const yyyymmMatch = cleanName.match(/^(\d{4})[-_/]?(\d{2})/);
    if (yyyymmMatch) {
      return `${yyyymmMatch[1]}-${yyyymmMatch[2].padStart(2, '0')}`;
    }

    // 2) "YYYY年MM月"
    const yyyymmKanjiMatch = cleanName.match(/^(\d{4})年(\d{1,2})月/);
    if (yyyymmKanjiMatch) {
      return `${yyyymmKanjiMatch[1]}-${yyyymmKanjiMatch[2].padStart(2, '0')}`;
    }

    // 3) "MM月案" または "MM月" や "MM" (西暦年なしの場合。現在の年をデフォルトとする)
    const mmMatch = cleanName.match(/^(\d{1,2})月?/);
    if (mmMatch) {
      const monthVal = mmMatch[1].padStart(2, '0');
      const currentYear = new Date().getFullYear();
      return `${currentYear}-${monthVal}`;
    }

    return null;
  };

  const findCellCoordinate = (grid: any[][], text: string): { r: number, c: number } | null => {
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r];
      if (!row) continue;
      for (let c = 0; c < row.length; c++) {
        const val = String(row[c] || '').trim().replace(/[\s　\n\r]+/g, '');
        const cleanText = text.replace(/[\s　\n\r]+/g, '');
        if (val.includes(cleanText)) {
          return { r, c };
        }
      }
    }
    return null;
  };

  const getMergedCellValue = (grid: any[][], r: number, c: number, scanRightMax = 4): string => {
    // 結合セルを考慮し、指定座標から右側をスキャンして非空文字列を取得
    for (let offset = 0; offset < scanRightMax; offset++) {
      const val = String(grid[r]?.[c + offset] || '').trim();
      if (val) return val;
    }
    return '';
  };

  const parseTimeRange = (text: string): { start: string, end: string, minutes: number } => {
    if (!text || text === '─' || text === '-' || (!text.includes('~') && !text.includes('～'))) {
      return { start: '', end: '', minutes: 0 };
    }
    
    const cleanText = text.replace(/[\s　]+/g, '').replace('～', '~');
    const parts = cleanText.split('~');
    
    if (parts.length === 2) {
      const normalizeToHHMM = (t: string): { hhmm: string; minutes: number } => {
        const cleanT = t.trim();
        
        // 1) Excelシリアル値（小数）の表記 (例: 0.6458333...)
        const serialMatch = cleanT.match(/^(0\.\d+)/);
        if (serialMatch) {
          const num = parseFloat(serialMatch[1]);
          const totalSeconds = Math.round(num * 86400);
          const h = Math.floor(totalSeconds / 3600);
          const m = Math.floor((totalSeconds % 3600) / 60);
          const hh = String(h).padStart(2, '0');
          const mm = String(m).padStart(2, '0');
          return {
            hhmm: `${hh}:${mm}`,
            minutes: h * 60 + m
          };
        }
        
        // 2) "15時30分" や "15時30" などの表記
        const kanjiMatch = cleanT.match(/(\d{1,2})\s*時\s*(?:(\d{1,2})\s*分?)?/);
        if (kanjiMatch) {
          const h = parseInt(kanjiMatch[1], 10);
          const m = parseInt(kanjiMatch[2] || '0', 10);
          const hh = String(h).padStart(2, '0');
          const mm = String(m).padStart(2, '0');
          return {
            hhmm: `${hh}:${mm}`,
            minutes: h * 60 + m
          };
        }
        
        // 2) "15:30" などの表記
        const colonMatch = cleanT.match(/(\d{1,2})\s*:\s*(\d{1,2})/);
        if (colonMatch) {
          const h = parseInt(colonMatch[1], 10);
          const m = parseInt(colonMatch[2], 10);
          const hh = String(h).padStart(2, '0');
          const mm = String(m).padStart(2, '0');
          return {
            hhmm: `${hh}:${mm}`,
            minutes: h * 60 + m
          };
        }

        return { hhmm: '', minutes: 0 };
      };

      const startParsed = normalizeToHHMM(parts[0]);
      const endParsed = normalizeToHHMM(parts[1]);
      
      const diff = endParsed.minutes - startParsed.minutes;
      
      return {
        start: startParsed.hhmm,
        end: endParsed.hhmm,
        minutes: diff > 0 ? diff : 0
      };
    }
    
    return { start: '', end: '', minutes: 0 };
  };

  const processFile = (file: File) => {
    setFileName(file.name);
    setError(null);
    
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        
        parseProfessionalWorkbook(wb);
      } catch (err: any) {
        console.error(err);
        setError('Excelファイルの解析に失敗しました。ファイルが破損しているか、非対応の形式です。');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const parseProfessionalWorkbook = (wb: XLSX.WorkBook) => {
    const logs: string[] = [];
    try {
      logs.push(`Excelの解析を開始しました。ファイル内シート数: ${wb.SheetNames.length}枚`);
      const periods: Record<string, ParsedPeriodData> = {};

      // 1. まず全計画書シート（案・本案）をスキャンして月をリストアップ
      const planSheets: { sheetName: string; month: string; status: 'draft' | 'final' }[] = [];
      wb.SheetNames.forEach(sheetName => {
        const isDraft = sheetName.includes('案') && !sheetName.includes('本案');
        const month = parseMonthFromSheetName(sheetName);
        if (month) {
          planSheets.push({
            sheetName,
            month,
            status: isDraft ? 'draft' : 'final'
          });
          logs.push(`計画書シート検出: 「${sheetName}」→ 対象期 ${month} (${isDraft ? '案' : '本案'})`);
        }
      });

      if (planSheets.length === 0) {
        logs.push(`エラー: 計画書シートが1枚も見つかりませんでした。`);
        throw new Error('有効な計画シート（例: 「202506案」「202506」など）が見つかりませんでした。');
      }

      // 2. 利用時間シートをマッピングするための情報収集
      // 各「利用時間」シートの直後にある計画シートの月をその利用時間シートの対象月とみなす
      const sheetNameMapToMonth: Record<string, string> = {};
      wb.SheetNames.forEach((sheetName, idx) => {
        const cleanName = sheetName.replace(/[\s　]+/g, '');
        if (cleanName.includes('利用時間')) {
          // 直後のシートから月を探す
          let matchedMonth = '';
          for (let i = idx + 1; i < wb.SheetNames.length; i++) {
            const nextMonth = parseMonthFromSheetName(wb.SheetNames[i]);
            if (nextMonth) {
              matchedMonth = nextMonth;
              break;
            }
          }
          // もし直後に見つからない場合は、直前を探す
          if (!matchedMonth) {
            for (let i = idx - 1; i >= 0; i--) {
              const prevMonth = parseMonthFromSheetName(wb.SheetNames[i]);
              if (prevMonth) {
                matchedMonth = prevMonth;
                break;
              }
            }
          }
          if (matchedMonth) {
            sheetNameMapToMonth[sheetName] = matchedMonth;
          }
        }
      });

      // 3. 各計画書シートのパース
      planSheets.forEach(({ sheetName, month, status }) => {
        const sheet = wb.Sheets[sheetName];
        if (!sheet) return;

        const grid = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, raw: false });
        const cleanGrid = grid.map(row => Array.isArray(row) ? Array.from(row) : []);

        // パース処理
        const createdDateCoord = findCellCoordinate(cleanGrid, '作成年月日');
        let createdAt = `${month}-01`;
        let rawPlanDate = '';
        if (createdDateCoord) {
          const selfVal = String(cleanGrid[createdDateCoord.r]?.[createdDateCoord.c] || '').trim();
          let rawVal = '';
          
          const cleanSelf = selfVal.replace(/作成年月日[：: \s　]*/g, '');
          if (cleanSelf && cleanSelf.length > 2) {
            rawVal = cleanSelf;
          } else {
            rawVal = getMergedCellValue(cleanGrid, createdDateCoord.r, createdDateCoord.c + 1);
          }

          if (rawVal) {
            rawPlanDate = rawVal;
            const dateObj = parseKanjiDate(rawVal);
            if (dateObj) {
              createdAt = dateObj.formattedDate;
            }
          }
        }

        const intentionCoord = findCellCoordinate(cleanGrid, '意向');
        const familyIntention = intentionCoord ? getMergedCellValue(cleanGrid, intentionCoord.r, intentionCoord.c + 1, 6) : '';

        const policyCoord = findCellCoordinate(cleanGrid, '総合的な支援の方針');
        const overallPolicy = policyCoord ? getMergedCellValue(cleanGrid, policyCoord.r, policyCoord.c + 1, 6) : '';

        const longTermCoord = findCellCoordinate(cleanGrid, '長期目標');
        const longTermGoal = longTermCoord ? getMergedCellValue(cleanGrid, longTermCoord.r, longTermCoord.c + 1, 6) : '';

        const shortTermCoord = findCellCoordinate(cleanGrid, '短期目標');
        const shortTermGoal = shortTermCoord ? getMergedCellValue(cleanGrid, shortTermCoord.r, shortTermCoord.c + 1, 6) : '';

        const hoursCoord = findCellCoordinate(cleanGrid, '支援の標準的な提供時間等');
        const serviceHours = hoursCoord ? getMergedCellValue(cleanGrid, hoursCoord.r + 1, hoursCoord.c, 4) : '';

        const confirmCoord = findCellCoordinate(cleanGrid, '確認事項');
        const confirmation = confirmCoord ? getMergedCellValue(cleanGrid, confirmCoord.r, confirmCoord.c + 1, 8) : '';

        const managerCoord = findCellCoordinate(cleanGrid, '児童発達支援管理責任者氏名');
        const managerName = managerCoord ? getMergedCellValue(cleanGrid, managerCoord.r, managerCoord.c + 1, 4) : '';

        const signDateCoord = findCellCoordinate(cleanGrid, '保護者署名');
        let signDate = createdAt;
        if (signDateCoord) {
          const rawVal = getMergedCellValue(cleanGrid, signDateCoord.r + 1, signDateCoord.c);
          if (rawVal && !rawVal.includes('年月日')) {
            const dateObj = parseKanjiDate(rawVal);
            if (dateObj) {
              signDate = dateObj.formattedDate;
            }
          }
        }

        // 支援目標テーブルのパース
        let tableHeaderRowIdx = -1;
        for (let r = 0; r < cleanGrid.length; r++) {
          const row = cleanGrid[r];
          if (!row) continue;
          const cleanCells = row.map(v => String(v || '').trim().replace(/[\s　\r\n]+/g, ''));
          const hasItem = cleanCells.some(v => v.includes('項目') || v === '項');
          const hasGoal = cleanCells.some(v => v.includes('支援目標'));
          if (hasItem && hasGoal) {
            tableHeaderRowIdx = r;
            break;
          }
        }

        const supportRows: SupportRow[] = [];
        if (tableHeaderRowIdx !== -1) {
          const row = cleanGrid[tableHeaderRowIdx];
          const cleanRow = row.map(v => String(v || '').trim().replace(/[\s　\r\n]+/g, ''));
          
          const categoryIdx = cleanRow.findIndex(v => v.includes('項目') || v === '項');
          const goalIdx = cleanRow.findIndex(v => v.includes('支援目標'));
          const contentIdx = cleanRow.findIndex(v => v.includes('支援内容'));
          const periodIdx = cleanRow.findIndex(v => v.includes('達成時期'));
          const providerIdx = cleanRow.findIndex(v => v.includes('担当者') || v.includes('提供機関'));
          const notesIdx = cleanRow.findIndex(v => v.includes('留意事項'));
          const priorityIdx = cleanRow.findIndex(v => v.includes('優先順位'));

          let currentCategory: SupportCategory = '本人支援';

          const FIVE_AREAS = ['健康・生活', '運動・感覚', '認知・行動', '言語・コミュニケーション', '人間関係・社会性'];

          for (let r = tableHeaderRowIdx + 1; r < cleanGrid.length; r++) {
            const rData = cleanGrid[r];
            if (!rData || rData.length === 0) continue;

            const categoryVal = String(rData[categoryIdx] || '').trim();
            if (categoryVal === '本人支援' || categoryVal === '家族支援' || categoryVal === '移行支援') {
              currentCategory = categoryVal;
            }

            const goalVal = String(rData[goalIdx] || '').trim();
            const contentVal = String(rData[contentIdx] || '').trim();
            const periodVal = String(rData[periodIdx] || '').trim();
            const providerVal = String(rData[providerIdx] || '').trim();
            const notesVal = String(rData[notesIdx] || '').trim();
            const priorityVal = String(rData[priorityIdx] || '').trim();

            // 終了判定（テーブル外の余分な行を巻き込まないようにする）
            const rowText = rData.map(v => String(v || '').trim()).join('');
            if (
              rowText.includes('領域の視点') || 
              rowText.includes('確認事項') || 
              rowText.includes('説明しました') || 
              rowText.includes('同意しました') ||
              rowText.includes('保護者署名') ||
              rowText.includes('児童発達支援管理責任者')
            ) {
              break;
            }

            if (goalVal.includes('確認事項') || contentVal.includes('説明しました')) {
              break;
            }

            if (goalVal || contentVal) {
              // 支援内容のすぐ右隣の列から5領域テキストを取得
              const fiveAreasText = contentIdx !== -1 ? String(rData[contentIdx + 1] || '').trim() : '';

              // 5領域の自動チェック（本人支援のみ）
              const detectedAreas = currentCategory === '本人支援'
                ? FIVE_AREAS.filter(area => {
                    const keywords = area.split('・');
                    return keywords.some(kw => 
                      fiveAreasText.includes(kw) || contentVal.includes(kw)
                    );
                  })
                : [];

              supportRows.push({
                id: crypto.randomUUID(),
                category: currentCategory,
                supportGoal: goalVal,
                supportContent: contentVal,
                fiveAreas: detectedAreas,
                achievementPeriod: periodVal || '6ヶ月',
                provider: providerVal || PROVIDER_DEFAULT_FALLBACK(currentCategory),
                notes: notesVal,
                priority: priorityVal || (supportRows.filter(sr => sr.category === currentCategory).length + 1).toString()
              });
            }
          }
        }

        const parsedPlan: ProfessionalPlanDoc = {
          childId,
          createdAt,
          startMonth: month,
          status,
          familyIntention,
          overallPolicy,
          longTermGoal,
          shortTermGoal,
          serviceHours,
          supportRows,
          confirmation,
          managerName,
          signDate,
          guardianName: ''
        };

        if (!periods[month]) {
          periods[month] = { startMonth: month };
        }
        if (rawPlanDate) {
          periods[month].rawPlanDate = rawPlanDate;
        }
        if (status === 'draft') {
          periods[month].draftPlan = parsedPlan;
        } else {
          periods[month].finalPlan = parsedPlan;
        }
      });

      // 4. 利用時間（別表）シートのパース
      logs.push("利用時間シートのスキャンを開始します...");
      wb.SheetNames.forEach(sheetName => {
        const cleanName = sheetName.replace(/[\s　]+/g, '');
        // 判定条件を大幅に緩和
        const isHoursSheet = cleanName.includes('利用時間') || 
                             cleanName.includes('別表') || 
                             cleanName.includes('提供時間') ||
                             cleanName.includes('時間') ||
                             cleanName.includes('スケジュール');

        if (isHoursSheet) {
          logs.push(`利用時間候補シート「${sheetName}」を検出しました。パースを開始します。`);
          const sheet = wb.Sheets[sheetName];
          if (!sheet) {
            logs.push(`警告: シート「${sheetName}」の取得に失敗しました。`);
            return;
          }

          const grid = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, raw: false });
          const cleanGrid = grid.map(row => Array.isArray(row) ? Array.from(row) : []);

          // 利用時間シートの「作成日」セルを探してパース（最優先）
          let month = '';
          let rawHoursDate = '';
          const createdDateCoord = findCellCoordinate(cleanGrid, '作成日');
          if (createdDateCoord) {
            const rawVal = getMergedCellValue(cleanGrid, createdDateCoord.r, createdDateCoord.c + 1);
            if (rawVal) {
              rawHoursDate = rawVal;
              const dateObj = parseKanjiDate(rawVal);
              if (dateObj) {
                month = dateObj.yearMonth;
                logs.push(`  → 「作成日」セル（${rawVal}）から対象期「${month}」を特定しました。`);
              }
            }
          }

          // 右上エリア（最初の6行、右側の列）から日付の推測スキャン（第二優先）
          if (!month) {
            for (let r = 0; r < Math.min(cleanGrid.length, 6); r++) {
              const row = cleanGrid[r];
              if (!row) continue;
              const startCol = Math.max(0, row.length - 8);
              for (let c = startCol; c < row.length; c++) {
                const val = String(row[c] || '').trim();
                if (val && (val.includes('年') || val.includes('月') || val.match(/\d{4}[-/]\d{1,2}/))) {
                  const dateObj = parseKanjiDate(val);
                  if (dateObj) {
                    rawHoursDate = val;
                    month = dateObj.yearMonth;
                    logs.push(`  → 右上エリア日付スキャン（${val}）から対象期「${month}」を特定しました。`);
                    break;
                  }
                }
              }
              if (month) break;
            }
          }

          // 見つからない場合は、位置関係からの推測フォールバック（第三優先）
          if (!month) {
            month = sheetNameMapToMonth[sheetName];
            if (month) {
              logs.push(`  → シートの並び位置関係から対象期「${month}」を推測しました。`);
            }
          }

          // それでも特定できない場合、最初の計画書シートの月をフォールバックとして採用（第四優先）
          if (!month && planSheets.length > 0) {
            month = planSheets[0].month;
            logs.push(`  → シート内で日付が特定できなかったため、計画書シートからフォールバック期「${month}」を適用しました。`);
          }

          if (!month) {
            logs.push(`  エラー: シート「${sheetName}」の対象期（月）を特定できませんでした。スキップします。`);
            return;
          }

          let weekHeaderRowIdx = -1;
          for (let r = 0; r < cleanGrid.length; r++) {
            const row = cleanGrid[r];
            if (!row) continue;
            const cleanCells = row.map(v => String(v || '').trim().replace(/[\s　]+/g, ''));
            const days = ['月', '火', '水', '木', '金'];
            
            // "月曜日" や "(月)" や "月" を含む部分一致に対応
            const count = days.filter(d => 
              cleanCells.some(cell => {
                const norm = cell.replace(/曜日/g, '');
                return norm === d || norm === `(${d})` || (cell.includes(d) && cell.length <= 4);
              })
            ).length;

            if (count >= 4) {
              weekHeaderRowIdx = r;
              break;
            }
          }

          if (weekHeaderRowIdx === -1) {
            logs.push(`  エラー: シート「${sheetName}」に「月〜金」の曜日ヘッダー行を検出できませんでした。スキップします。`);
            return;
          }

          logs.push(`  → 曜日ヘッダーを ${weekHeaderRowIdx + 1} 行目に検出しました。`);

          const dayColIndices: Record<string, number> = {};
          const daysOfWeek = ['月', '火', '水', '木', '金', '土', '日'];
          const weekHeaderRow = cleanGrid[weekHeaderRowIdx] || [];
          daysOfWeek.forEach(d => {
            dayColIndices[d] = weekHeaderRow.findIndex(v => {
              const norm = String(v || '').trim().replace(/[\s　]+/g, '').replace(/曜日/g, '');
              // "日" が "日・祝日" や "土" が "土曜" にマッチするように部分一致を使用
              return norm.includes(d);
            });
          });

          // 曜日インデックス検出結果をログ出力
          const indexLog = daysOfWeek.map(d => `${d}曜:${dayColIndices[d]}列`).join(', ');
          logs.push(`  → 曜日列検出: ${indexLog}`);

          let provideTimeRowIdx = -1;
          let beforeExtRowIdx = -1;
          let afterExtRowIdx = -1;
          for (let r = weekHeaderRowIdx + 1; r < cleanGrid.length; r++) {
            const row = cleanGrid[r];
            if (!row) continue;
            
            const cleanCells = row.map(v => String(v || '').trim().replace(/[\s　\n\r]+/g, ''));

            // 左端の結合セルの注釈文言による誤判定を避けるため、曜日セルのラベル存在を最優先で確認する
            const hasProvideLabel = cleanCells.some(cell => cell.includes('利用開始') || cell.includes('提供時間'));
            const hasBeforeLabel = cleanCells.some(cell => cell.includes('【支援前】') || cell.includes('支援前延長'));
            const hasAfterLabel = cleanCells.some(cell => cell.includes('【支援後】') || cell.includes('支援後延長'));

            if (hasProvideLabel && provideTimeRowIdx === -1) {
              provideTimeRowIdx = r;
            }
            if (hasBeforeLabel && beforeExtRowIdx === -1) {
              beforeExtRowIdx = r;
            }
            if (hasAfterLabel && afterExtRowIdx === -1) {
              afterExtRowIdx = r;
            }
          }

          logs.push(`  → 行検出: 提供時間見出し行=${provideTimeRowIdx !== -1 ? provideTimeRowIdx + 1 : '未検出'}, 支援前延長見出し行=${beforeExtRowIdx !== -1 ? beforeExtRowIdx + 1 : '未検出'}, 支援後延長見出し行=${afterExtRowIdx !== -1 ? afterExtRowIdx + 1 : '未検出'}`);

          const isTimeValue = (val: string): boolean => {
            if (!val) return false;
            const cleanVal = val.trim();
            // 数字が一切含まれない文字列は時間値ではない
            if (!/\d+/.test(cleanVal)) {
              return false;
            }
            // 時間帯を表す記号（~ または ～）が含まれていることを必須とする
            if (cleanVal.includes('~') || cleanVal.includes('～')) {
              return true;
            }
            return false;
          };

          const getRowDataValue = (baseRowIdx: number, colIdx: number, nextHeaderRowIdx: number = -1): string => {
            if (baseRowIdx === -1) return '';
            
            // 探索する行の最大インデックス（次の見出し行の手前、または最大3行）
            const maxRow = nextHeaderRowIdx !== -1 ? nextHeaderRowIdx : baseRowIdx + 3;
            
            for (let r = baseRowIdx; r < Math.min(cleanGrid.length, maxRow); r++) {
              // 曜日エリアの3列分の値を結合する
              const parts: string[] = [];
              for (let cOffset = 0; cOffset <= 2; cOffset++) {
                const c = colIdx + cOffset;
                const cellVal = String(cleanGrid[r]?.[c] || '').trim();
                if (cellVal) {
                  parts.push(cellVal);
                }
              }
              const combinedVal = parts.join(' ').trim();
              if (isTimeValue(combinedVal)) {
                return combinedVal;
              }
            }
            return '';
          };

          const weeklyHours: Record<string, DaySchedule> = {};
          daysOfWeek.forEach(day => {
            const col = dayColIndices[day];
            if (col === -1 || col === undefined) {
              weeklyHours[day] = defaultDaySchedule();
              return;
            }

            const rawProvide = getRowDataValue(provideTimeRowIdx, col, beforeExtRowIdx);
            const rawBefore = getRowDataValue(beforeExtRowIdx, col, afterExtRowIdx);
            const rawAfter = getRowDataValue(afterExtRowIdx, col, -1);

            const provideParsed = parseTimeRange(rawProvide);
            const beforeParsed = parseTimeRange(rawBefore);
            const afterParsed = parseTimeRange(rawAfter);

            if ((rawProvide && rawProvide !== '～' && rawProvide !== '─') || 
                (rawBefore && rawBefore !== '～' && rawBefore !== '─') || 
                (rawAfter && rawAfter !== '～' && rawAfter !== '─')) {
              logs.push(`    - ${day}曜: 提供原データ="${rawProvide}"→[${provideParsed.start}~${provideParsed.end}] (${provideParsed.minutes}分), 送迎前="${rawBefore}", 送迎後="${rawAfter}"`);
            }

            weeklyHours[day] = {
              startTime: provideParsed.start,
              endTime: provideParsed.end,
              totalMinutes: provideParsed.minutes,
              beforeExtStartTime: beforeParsed.start,
              beforeExtEndTime: beforeParsed.end,
              beforeExtMinutes: beforeParsed.minutes,
              afterExtStartTime: afterParsed.start,
              afterExtEndTime: afterParsed.end,
              afterExtMinutes: afterParsed.minutes
            };
          });

          const extReasonCoord = findCellCoordinate(cleanGrid, '延長を必要とする理由');
          const extReason = extReasonCoord ? getMergedCellValue(cleanGrid, extReasonCoord.r, extReasonCoord.c + 1, 8) : '';

          const notesCoord = findCellCoordinate(cleanGrid, '特記事項');
          const notes = notesCoord ? getMergedCellValue(cleanGrid, notesCoord.r, notesCoord.c + 1, 8) : '';

          let createdAt = `${month}-01`;
          if (createdDateCoord) {
            const rawVal = getMergedCellValue(cleanGrid, createdDateCoord.r, createdDateCoord.c + 1);
            if (rawVal) {
              const dateObj = parseKanjiDate(rawVal);
              if (dateObj) {
                createdAt = dateObj.formattedDate;
              }
            }
          }

          const parsedHours: ServiceHoursPlan = {
            childId,
            startMonth: month,
            createdAt,
            weeklyHours,
            extReason,
            notes
          };

          if (!periods[month]) {
            periods[month] = { startMonth: month };
          }
          if (rawHoursDate) {
            periods[month].rawHoursDate = rawHoursDate;
          }
          periods[month].serviceHours = parsedHours;
          logs.push(`  → シート「${sheetName}」の利用時間データの抽出に成功しました (対象月: ${month})。`);
        }
      });

      logs.push(`Excelのパース処理が成功しました。検出月数: ${Object.keys(periods).length}ヶ月`);
      setDebugLogs(logs);
      setParsedPeriods(periods);
      setError(null);
      setStep('preview');
    } catch (err: any) {
      console.error(err);
      logs.push(`致命的エラー: ${err.message || String(err)}`);
      setDebugLogs(logs);
      setError(err.message || '計画シートのパースに失敗しました。');
      setParsedPeriods({});
    }
  };

  const PROVIDER_DEFAULT_FALLBACK = (cat: SupportCategory) => {
    return cat === '移行支援' ? 'TreeKidsSchool' : 'TreeKidsSchool\nSearch';
  };

  const defaultDaySchedule = (): DaySchedule => ({
    startTime: '',
    endTime: '',
    totalMinutes: 0,
    beforeExtStartTime: '',
    beforeExtEndTime: '',
    beforeExtMinutes: 0,
    afterExtStartTime: '',
    afterExtEndTime: '',
    afterExtMinutes: 0
  });

  const handlePeriodMonthChange = (oldMonth: string, newMonth: string) => {
    if (!newMonth || !/^\d{4}-\d{2}$/.test(newMonth)) return;
    
    setParsedPeriods(prev => {
      const next = { ...prev };
      const target = next[oldMonth];
      if (!target) return prev;

      delete next[oldMonth];
      
      const updatedTarget = {
        ...target,
        startMonth: newMonth,
      };

      if (updatedTarget.draftPlan) {
        updatedTarget.draftPlan.startMonth = newMonth;
        const [,, d] = (updatedTarget.draftPlan.createdAt || '').split('-');
        updatedTarget.draftPlan.createdAt = `${newMonth}-${d || '01'}`;
      }
      if (updatedTarget.finalPlan) {
        updatedTarget.finalPlan.startMonth = newMonth;
        const [,, d] = (updatedTarget.finalPlan.createdAt || '').split('-');
        updatedTarget.finalPlan.createdAt = `${newMonth}-${d || '01'}`;
      }
      if (updatedTarget.serviceHours) {
        updatedTarget.serviceHours.startMonth = newMonth;
        const [,, d] = (updatedTarget.serviceHours.createdAt || '').split('-');
        updatedTarget.serviceHours.createdAt = `${newMonth}-${d || '01'}`;
      }

      next[newMonth] = updatedTarget;
      return next;
    });
  };

  const handleToggleSkipImport = (month: string) => {
    setParsedPeriods(prev => {
      const target = prev[month];
      if (!target) return prev;
      return {
        ...prev,
        [month]: {
          ...target,
          skipImport: !target.skipImport
        }
      };
    });
  };

  const toggleHoursDetail = (month: string) => {
    setExpandedHours(prev => ({
      ...prev,
      [month]: !prev[month]
    }));
  };

  const handleExecuteImport = () => {
    const plans: ProfessionalPlanDoc[] = [];
    const hours: ServiceHoursPlan[] = [];

    Object.values(parsedPeriods).forEach(p => {
      if (p.skipImport) return; // インポートしない場合はスキップ
      if (p.draftPlan) plans.push(p.draftPlan);
      if (p.finalPlan) plans.push(p.finalPlan);
      if (p.serviceHours) hours.push(p.serviceHours);
    });

    if (plans.length === 0 && hours.length === 0) {
      alert('インポート対象が選択されていません。');
      return;
    }

    onImport(plans, hours);
    resetState();
  };

  const resetState = () => {
    setParsedPeriods({});
    setExpandedHours({});
    setDebugLogs([]);
    setError(null);
    setFileName('');
    setStep('upload');
  };

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
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative bg-white w-full max-w-5xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in duration-200">
        
        {/* ヘッダー */}
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-50 text-green-600 flex items-center justify-center">
              <FileSpreadsheet size={22} />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-800 tracking-tight">専門的支援計画 / 利用時間 インポート</h2>
              <p className="text-[12px] text-slate-500 font-medium">Excel内の全更新月シート（計画案・本案・利用時間）を一括読み込みします</p>
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

              <div 
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-80 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 hover:border-green-500/40 hover:bg-slate-50/70 transition-all flex flex-col items-center justify-center p-6 cursor-pointer group"
              >
                <input 
                  type="file" 
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept=".xlsx, .xls"
                  className="hidden"
                />
                <div className="w-16 h-16 rounded-full bg-slate-100 group-hover:bg-green-50 text-slate-400 group-hover:text-green-600 transition-colors flex items-center justify-center mb-4">
                  <Upload size={28} />
                </div>
                <h3 className="text-lg font-black text-slate-800 tracking-tight mb-2">Excelファイルをここにドラッグ＆ドロップ</h3>
                <p className="text-sm text-slate-400 font-semibold mb-6">または、クリックしてファイルを選択</p>
                <div className="text-xs text-slate-400/80 leading-relaxed text-center font-medium max-w-lg">
                  個別支援計画書（Search）および別表（利用時間）のシートが含まれるExcelファイルを選択してください。<br />
                  原本を除く「利用時間」「202506案」「202506」などの全シートが一括パースされます。
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
                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">解析された更新月数</div>
                  <div className="text-sm font-bold text-green-600">{Object.keys(parsedPeriods).length} ヶ月分</div>
                </div>
              </div>

              {error && (
                <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm flex items-start gap-3 border border-red-100">
                  <AlertCircle size={18} className="flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {Object.keys(parsedPeriods).length > 0 && (
                <div className="space-y-6">
                  <h3 className="font-bold text-slate-700">検出された更新月・シートの一覧</h3>
                  
                  <div className="space-y-4">
                    {Object.entries(parsedPeriods)
                      .sort((a, b) => a[0].localeCompare(b[0]))
                      .map(([month, p]) => {
                        const isSkipped = p.skipImport === true;
                        const [yearVal, monthVal] = month.split('-');
                        
                        return (
                          <div 
                            key={month} 
                            className={`border border-slate-200 rounded-2xl p-5 bg-slate-50/30 flex flex-col gap-4 transition-all duration-200 ${
                              isSkipped ? 'opacity-50 bg-slate-100/50 border-slate-100' : ''
                            }`}
                          >
                            {/* 上部メインコンテンツ */}
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                              <div>
                                <div className="text-base font-black text-slate-800 flex flex-wrap items-center gap-3">
                                  <label className="flex items-center gap-2 cursor-pointer select-none">
                                    <input
                                      type="checkbox"
                                      checked={!isSkipped}
                                      onChange={() => handleToggleSkipImport(month)}
                                      className="w-4 h-4 text-green-600 border-slate-300 rounded focus:ring-green-500 accent-green-600 cursor-pointer"
                                    />
                                    <span className="text-xs font-bold text-slate-600">インポートする</span>
                                  </label>
                                  
                                  <div className="w-px h-4 bg-slate-200 mx-1 shrink-0" />
                                  
                                  <span className="shrink-0 text-sm">対象月:</span>
                                  
                                  <div className="flex items-center gap-1">
                                    {/* 年の選択セレクト */}
                                    <select
                                      value={yearVal}
                                      disabled={isSkipped}
                                      onChange={(e) => {
                                        const newYear = e.target.value;
                                        handlePeriodMonthChange(month, `${newYear}-${monthVal || '01'}`);
                                      }}
                                      className="bg-white disabled:bg-slate-50 border border-slate-200 rounded-xl px-2 py-1 text-sm font-bold text-slate-700 shadow-sm focus:outline-none focus:border-green-500 transition-all cursor-pointer"
                                    >
                                      {[2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030, 2031, 2032].map(y => (
                                        <option key={y} value={y}>{y}年</option>
                                      ))}
                                    </select>

                                    {/* 月の選択セレクト */}
                                    <select
                                      value={monthVal}
                                      disabled={isSkipped}
                                      onChange={(e) => {
                                        const newMonth = e.target.value;
                                        handlePeriodMonthChange(month, `${yearVal || '2026'}-${newMonth}`);
                                      }}
                                      className="bg-white disabled:bg-slate-50 border border-slate-200 rounded-xl px-2 py-1 text-sm font-bold text-slate-700 shadow-sm focus:outline-none focus:border-green-500 transition-all cursor-pointer"
                                    >
                                      {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map(m => (
                                        <option key={m} value={m}>{parseInt(m, 10)}月</option>
                                      ))}
                                    </select>
                                  </div>
                                  
                                  <span className="text-xs text-slate-400 font-semibold">(対象月を変更できます)</span>
                                  {p.rawHoursDate && (
                                    <span className="inline-flex items-center text-[11px] font-bold px-2.5 py-1 bg-blue-50 text-blue-700 rounded-lg border border-blue-100/50 shadow-sm">
                                      右上日付: {p.rawHoursDate}
                                    </span>
                                  )}
                                  {p.rawPlanDate && (
                                    <span className="inline-flex items-center text-[11px] font-bold px-2.5 py-1 bg-slate-100 text-slate-600 rounded-lg border border-slate-200 shadow-sm">
                                      計画書作成日: {p.rawPlanDate}
                                    </span>
                                  )}
                                </div>
                                
                                <div className="text-xs text-slate-500 font-medium mt-3 leading-relaxed">
                                  意向: {p.finalPlan?.familyIntention || p.draftPlan?.familyIntention || '未検出'} <br />
                                  方針: {p.finalPlan?.overallPolicy || p.draftPlan?.overallPolicy || '未検出'}
                                </div>
                              </div>

                              <div className="flex gap-2 flex-wrap items-center">
                                {p.serviceHours && (
                                  <button 
                                    onClick={() => toggleHoursDetail(month)}
                                    className="text-[11px] font-bold px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl border border-blue-100 flex items-center gap-1.5 transition-all shadow-sm"
                                  >
                                    <Check size={12} /> 利用時間 (別表)
                                    <span className="text-[10px] text-blue-500 underline ml-1 font-semibold">
                                      {expandedHours[month] ? '閉じる' : '詳細を確認'}
                                    </span>
                                  </button>
                                )}
                                {p.draftPlan && (
                                  <span className="text-[11px] font-bold px-3 py-1.5 bg-amber-50 text-amber-700 rounded-xl border border-amber-100 flex items-center gap-1">
                                    <Check size={12} /> 計画書 (案)
                                  </span>
                                )}
                                {p.finalPlan && (
                                  <span className="text-[11px] font-bold px-3 py-1.5 bg-green-50 text-green-700 rounded-xl border border-green-100 flex items-center gap-1">
                                    <Check size={12} /> 計画書 (本案)
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* 利用時間のパース詳細アコーディオン */}
                            {p.serviceHours && expandedHours[month] && (
                              <div className="p-4 bg-blue-50/20 border border-blue-100/50 rounded-xl space-y-3 text-xs animate-in slide-in-from-top-2 duration-200">
                                <h4 className="font-bold text-blue-800 flex items-center gap-1.5">
                                  <span>利用時間（別表）のパース詳細</span>
                                  <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-normal">
                                    {p.serviceHours.createdAt ? `作成日: ${p.serviceHours.createdAt}` : '作成日不明'}
                                  </span>
                                </h4>
                                
                                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
                                  {['月', '火', '水', '木', '金', '土', '日'].map(day => {
                                    const sched = p.serviceHours?.weeklyHours[day];
                                    const hasService = sched && (sched.startTime || sched.endTime);
                                    
                                    return (
                                      <div key={day} className={`p-2 rounded-lg border transition-all ${
                                        hasService ? 'bg-white border-blue-200 shadow-sm' : 'bg-slate-50 border-slate-100 text-slate-400'
                                      }`}>
                                        <div className="font-bold text-center border-b border-slate-100 pb-1 mb-1">{day}曜</div>
                                        {hasService ? (
                                          <div className="space-y-1 text-[11px]">
                                            <div className="font-semibold text-slate-700 text-center">{sched.startTime}~{sched.endTime}</div>
                                            {(sched.beforeExtMinutes > 0 || sched.afterExtMinutes > 0) && (
                                              <div className="text-[9px] text-amber-600 bg-amber-50 px-1 py-0.5 rounded text-center font-bold">
                                                {sched.beforeExtMinutes > 0 && `前:${sched.beforeExtMinutes}分 `}
                                                {sched.afterExtMinutes > 0 && `後:${sched.afterExtMinutes}分`}
                                              </div>
                                            )}
                                          </div>
                                        ) : (
                                          <div className="text-center py-2 text-[10px]">─</div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                                
                                {(p.serviceHours.extReason || p.serviceHours.notes) && (
                                  <div className="grid md:grid-cols-2 gap-3 pt-2 border-t border-blue-100 text-[11px]">
                                    {p.serviceHours.extReason && (
                                      <div>
                                        <span className="font-bold text-slate-500">延長を必要とする理由: </span>
                                        <span className="text-slate-700 bg-white px-2 py-0.5 rounded border border-blue-100/50 inline-block mt-0.5">{p.serviceHours.extReason}</span>
                                      </div>
                                    )}
                                    {p.serviceHours.notes && (
                                      <div>
                                        <span className="font-bold text-slate-500">特記事項: </span>
                                        <span className="text-slate-700 bg-white px-2 py-0.5 rounded border border-blue-100/50 inline-block mt-0.5">{p.serviceHours.notes}</span>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* 解析デバッグログ */}
              {debugLogs.length > 0 && (
                <div className="mt-6 border border-slate-200 rounded-2xl overflow-hidden bg-slate-50/50">
                  <div className="p-4 bg-slate-100/80 border-b border-slate-200 flex justify-between items-center">
                    <span className="text-xs font-black text-slate-700">Excel解析レポート (デバッグログ)</span>
                    <span className="text-[10px] text-slate-400 font-semibold">利用時間や計画書の読み込み履歴</span>
                  </div>
                  <div className="p-4 font-mono text-[11px] text-slate-600 space-y-1.5 max-h-60 overflow-y-auto leading-relaxed bg-white">
                    {debugLogs.map((log, idx) => (
                      <div key={idx} className={`pb-1 border-b border-slate-50 last:border-0 ${
                        log.includes('エラー') || log.includes('警告') ? 'text-rose-600 font-semibold' : 
                        log.includes('成功') || log.includes('特定しました') || log.includes('検出') ? 'text-green-600' : 'text-slate-600'
                      }`}>
                        {log}
                      </div>
                    ))}
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
                className="px-8 py-2.5 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 transition-all shadow-lg shadow-green-600/20 flex items-center gap-2 active:scale-95"
              >
                <Check size={18} />
                <span>一括登録を実行する</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
