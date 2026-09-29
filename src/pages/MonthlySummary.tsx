import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, Link } from 'react-router-dom';
import { 
  ChevronLeft, 
  ChevronRight, 
  Calendar, 
  Loader2, 
  ArrowLeft,
  AlertTriangle,
  Info,
  Settings as SettingsIcon,
  X,
  Check,
  Copy,
  Sparkles,
  HelpCircle,
  BookmarkCheck,
  RotateCcw,
  Wand2,
  Save,
  Crosshair,
  Users
} from 'lucide-react';

import { 
  collection, 
  query, 
  where, 
  getDocs, 
  documentId,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  writeBatch
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import type { Child } from '../data/mockData';
import { MonthlyResultImportModal } from '../components/MonthlyResultImportModal';
import { matchesOffice } from '../lib/officeUtils';

export interface StaffMember {
  id: string;
  name: string;
  officeId?: string;
  color: string;
}

export const STAFF_COLORS = [
  '#2563eb', // blue
  '#059669', // emerald
  '#d97706', // amber
  '#7c3aed', // purple
  '#db2777', // pink
  '#0891b2', // cyan
  '#ea580c', // orange
  '#0d9488', // teal
  '#4f46e5', // indigo
  '#65a30d', // lime
];

export interface AttendanceInfo {
  officeId: string;
  officeName: string;
  isAbsent: boolean;
  isWaitlist: boolean;
  transportTime?: string;
  endTime?: string;
  pickupLocation?: string;
  assignedStaff?: string;
}

type MonthlySummaryProps = {
  childrenData: Child[];
  selectedOfficeId: string;
  offices: { id: string; name: string }[];
};

export const MonthlySummary: React.FC<MonthlySummaryProps> = ({ 
  childrenData, 
  selectedOfficeId,
  offices 
}) => {
  const navigate = useNavigate();
  
  // 現在の事業所名
  const currentOffice = offices.find(o => o.id === selectedOfficeId);
  const officeName = currentOffice ? currentOffice.name : 'Search';

  // 対象月 (YYYY-MM)
  const [currentMonth, setCurrentMonth] = useState(() => {
    return new Date().toISOString().slice(0, 7);
  });

  const [isLoading, setIsLoading] = useState(true);

  // カレンダー設定 (休みの日・個別療育の日 - 曜日単位)
  const [summarySettings, setSummarySettings] = useState<{
    holidayDaysOfWeek: number[];
    individualDaysOfWeek: number[];
    holidayColor: string;
    individualColor: string;
  }>({
    holidayDaysOfWeek: [],
    individualDaysOfWeek: [],
    holidayColor: '#ffe4e6',
    individualColor: '#e0f2fe',
  });

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLegendOpen, setIsLegendOpen] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isResultImportOpen, setIsResultImportOpen] = useState(false);
  const [loginStaffName, setLoginStaffName] = useState("");

  const [tempSettings, setTempSettings] = useState({
    holidayDaysOfWeek: [] as number[],
    individualDaysOfWeek: [] as number[],
    holidayColor: '#ffe4e6',
    individualColor: '#e0f2fe',
  });

  // 採用日選択モード (true: マスを選択して正式採用/他をアーカイブするモード)
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  // 各児童の選択された日（day: 1〜31 の Set）
  const [selectedDaysMap, setSelectedDaysMap] = useState<Record<string, Set<number>>>({});
  const [isSavingAdoptions, setIsSavingAdoptions] = useState(false);

  // フォーカス（ホバーハイライト）機能のON/OFF切り替え
  const [isFocusHighlightEnabled, setIsFocusHighlightEnabled] = useState(true);

  // スタッフ一覧および担当スタッフ割り当て
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [assignedStaffMap, setAssignedStaffMap] = useState<Record<string, string>>({});
  const [isDistributeModalOpen, setIsDistributeModalOpen] = useState(false);
  const [selectedStaffForDist, setSelectedStaffForDist] = useState<Set<string>>(new Set());
  const [staffPopoverAnchor, setStaffPopoverAnchor] = useState<{
    childId: string;
    x: number;
    y: number;
  } | null>(null);
  const [isSavingStaffAssignments, setIsSavingStaffAssignments] = useState(false);
  const [groupAdjacentColumns, setGroupAdjacentColumns] = useState(true); // 表の並び順で近接児童をなるべくまとめるオプション

  // ホバー中の児童列IDおよび日付行
  const [hoveredColChildId, setHoveredColChildId] = useState<string | null>(null);
  const [hoveredRowDay, setHoveredRowDay] = useState<number | null>(null);

  // セルホバー時の専門的支援実施計画プレビュー
  const [hoveredCellPreview, setHoveredCellPreview] = useState<{
    childName: string;
    dateStr: string;
    dayOfWeekStr: string;
    supportContent: string[];
    resultInfo: string;
    futurePlan: string;
    staffName: string;
    reportStaffName?: string;
    assignedStaffName?: string;
    assignedStaffColor?: string;
    isAdopted: boolean;
    isReportArchived: boolean;
    isAttending: boolean;
    attInfoStr: string;
    x: number;
    y: number;
  } | null>(null);

  // モーダルが開かれたら設定状態を初期化
  useEffect(() => {
    if (isSettingsOpen) {
      setTempSettings({ ...summarySettings });
    }
  }, [isSettingsOpen, summarySettings]);
  
  // 取得したマージ済みデータ
  const [mergedData, setMergedData] = useState<{
    dailyReports: Record<string, Record<string, any>>;
    treeCommTexts: Record<string, Record<string, string>>;
    treeCommFutures: Record<string, Record<string, string>>;
    attendance: Record<string, Record<string, AttendanceInfo>>;
  }>({
    dailyReports: {},
    treeCommTexts: {},
    treeCommFutures: {},
    attendance: {}
  });

  // 対象年の月・日数・曜日の計算
  const { year, month, daysArray, monthNum } = useMemo(() => {
    const [yStr, mStr] = currentMonth.split('-');
    const y = parseInt(yStr, 10);
    const m = parseInt(mStr, 10);
    const daysInMonth = new Date(y, m, 0).getDate();
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    return { year: y, month: m, daysArray: days, monthNum: m };
  }, [currentMonth]);

  // ログインスタッフ情報のロード
  useEffect(() => {
    const loadStaff = async () => {
      if (auth.currentUser) {
        try {
          const staffSnap = await getDoc(doc(db, 'staff', auth.currentUser.uid));
          if (staffSnap.exists()) {
            const data = staffSnap.data();
            setLoginStaffName(data.name || data.fullName || "");
          }
        } catch (e) {
          console.error("Failed to load staff name:", e);
        }
      }
    };
    loadStaff();
  }, []);

  // 事業所に所属するスタッフ一覧の取得（Firestoreのstaffドキュメントに保存されているカラーを最優先）
  useEffect(() => {
    const fetchStaffList = async () => {
      try {
        const snap = await getDocs(collection(db, 'staff'));
        const list: StaffMember[] = [];
        let colorIdx = 0;

        const resolveStaffColor = (colorValue?: string, fallbackIndex: number = 0): string => {
          if (!colorValue || typeof colorValue !== 'string') {
            return STAFF_COLORS[fallbackIndex % STAFF_COLORS.length];
          }
          const trimmed = colorValue.trim();
          if (trimmed.startsWith('#') || trimmed.startsWith('rgb') || trimmed.startsWith('hsl')) {
            return trimmed;
          }
          const colorMap: Record<string, string> = {
            blue: '#2563eb',
            red: '#dc2626',
            green: '#16a34a',
            emerald: '#059669',
            amber: '#d97706',
            yellow: '#ca8a04',
            purple: '#7c3aed',
            pink: '#db2777',
            cyan: '#0891b2',
            orange: '#ea580c',
            teal: '#0d9488',
            indigo: '#4f46e5',
            lime: '#65a30d',
            rose: '#e11d48',
          };
          const lower = trimmed.toLowerCase();
          for (const [key, val] of Object.entries(colorMap)) {
            if (lower.includes(key)) return val;
          }
          return trimmed;
        };

        snap.forEach(d => {
          const data = d.data();
          // アーカイブ済み・退職・無効化スタッフを除外
          if (
            data.archived === true || 
            data.isArchived === true || 
            data.status === 'archived' || 
            data.isDeleted === true ||
            data.deleted === true ||
            data.active === false
          ) {
            return;
          }

          const sOfficeId = data.officeId || '';
          const sOfficeIds = Array.isArray(data.officeIds) ? data.officeIds : [];
          // 選択事業所に所属しているスタッフ（または共通スタッフ）
          if (!sOfficeId || sOfficeId === selectedOfficeId || sOfficeIds.includes(selectedOfficeId)) {
            const name = data.name || data.fullName || '(名前なし)';
            // Firestore staff ドキュメント内の設定カラーを優先取得
            const rawColor = data.color || data.staffColor || data.themeColor || data.userColor || data.iconColor || data.avatarColor;
            const staffColor = resolveStaffColor(rawColor, colorIdx);

            list.push({
              id: d.id,
              name,
              officeId: sOfficeId,
              color: staffColor
            });
            colorIdx++;
          }
        });
        setStaffList(list);
        // デフォルトで全員チェック
        setSelectedStaffForDist(new Set(list.map(s => s.id)));
      } catch (e) {
        console.error("Failed to fetch staff list:", e);
      }
    };
    fetchStaffList();
  }, [selectedOfficeId]);

  // 月ごとの児童担当スタッフ割り当てのロード
  useEffect(() => {
    const loadStaffAssignments = async () => {
      if (!selectedOfficeId || !currentMonth) return;
      try {
        const assignDocRef = doc(db, 'offices', selectedOfficeId, 'monthly_staff_assignments', currentMonth);
        const snap = await getDoc(assignDocRef);
        if (snap.exists()) {
          const data = snap.data();
          setAssignedStaffMap(data.assignments || {});
        } else {
          setAssignedStaffMap({});
        }
      } catch (e) {
        console.error("Failed to load staff assignments:", e);
      }
    };
    loadStaffAssignments();
  }, [selectedOfficeId, currentMonth]);

  // 担当スタッフの手動更新 & 保存
  const updateStaffAssignment = useCallback(async (childId: string, staffId: string | null) => {
    const newAssignments = { ...assignedStaffMap };
    if (staffId) {
      newAssignments[childId] = staffId;
    } else {
      delete newAssignments[childId];
    }
    setAssignedStaffMap(newAssignments);
    setStaffPopoverAnchor(null);

    try {
      const assignDocRef = doc(db, 'offices', selectedOfficeId, 'monthly_staff_assignments', currentMonth);
      await setDoc(assignDocRef, {
        assignments: newAssignments,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (e) {
      console.error("Failed to save staff assignments:", e);
    }
  }, [assignedStaffMap, selectedOfficeId, currentMonth]);

  // ---- 全児童のツリー通信を一括コピー（療育結果が未記入のもののみ） ----
  const handleCopyAllTreeCommunications = () => {
    let copyText = `【対象月】${currentMonth}\n\n`;
    let count = 0;
    let childCount = 0;

    childrenData.forEach((child) => {
      if (!child.id) return;
      
      const childTexts = mergedData.treeCommTexts[child.id] || {};
      const childReports = mergedData.dailyReports[child.id] || {};
      const childRowsText: string[] = [];

      daysArray.forEach(day => {
        const dateKey = `${monthNum}月${day}日`;
        const report = childReports[dateKey];
        const treeText = childTexts[dateKey] || "";
        
        const resultInfo = report?.content?.resultInfo || "";
        const externalInfo = report?.content?.externalInfo || treeText || "";
        
        const hasResult = resultInfo.trim() !== "";
        const hasTree = externalInfo.trim() !== "";

        // 療育結果が未記入のツリー通信のみコピー対象とする
        if (hasTree && !hasResult) {
          childRowsText.push(`- ${dateKey}: ${externalInfo.trim()}`);
        }
      });

      if (childRowsText.length > 0) {
        copyText += `■ 児童 (ID: ${child.id})\n${childRowsText.join('\n')}\n\n`;
        count += childRowsText.length;
        childCount++;
      }
    });

    if (count === 0) {
      alert('療育結果が未入力のツリー通信はありません。（すべての日の療育結果が入力済みです）');
      return;
    }

    navigator.clipboard.writeText(copyText.trim() + '\n')
      .then(() => {
        alert(`${childCount}名分、計 ${count}件の療育結果が未入力のツリー通信を日付別でコピーしました。(個人情報保護のため児童名は除外しています)`);
      })
      .catch(err => {
        console.error('Failed to copy: ', err);
        alert('コピーに失敗しました。');
      });
  };

  // ---- Geminiでの一括変換結果を全員分インポート ----
  const handleImportAllResults = async (importedData: Record<string, Record<string, string>>) => {
    setIsLoading(true);
    try {
      const batch = writeBatch(db);
      let count = 0;

      for (const childId of Object.keys(importedData)) {
        const childResults = importedData[childId];
        const child = childrenData.find(c => c.id === childId);
        if (!child) continue;

        const childReports = mergedData.dailyReports[childId] || {};
        const childTexts = mergedData.treeCommTexts[childId] || {};
        const childFutures = mergedData.treeCommFutures[childId] || {};

        for (const dateKey of Object.keys(childResults)) {
          const resultText = childResults[dateKey];
          const existingReport = childReports[dateKey];

          const mMatch = dateKey.match(/(\d+)月/);
          const dMatch = dateKey.match(/(\d+)日/);
          const mNum = mMatch ? parseInt(mMatch[1], 10) : 1;
          const dNum = dMatch ? parseInt(dMatch[1], 10) : 1;
          const pad = (n: number) => n.toString().padStart(2, '0');
          const formattedDate = `${year}-${pad(mNum)}-${pad(dNum)}`;

          const docId = existingReport?.id;
          const payload: any = {
            childId,
            planMonth: currentMonth,
            date: formattedDate,
            staffId: auth.currentUser?.uid || "",
            staffName: loginStaffName || "一括登録",
            type: 'tree_report',
            officeId: selectedOfficeId,
            updatedAt: serverTimestamp(),
          };

          if (docId) {
            const existingRef = doc(db, 'daily_reports', docId);
            payload.content = {
              ...existingReport.content,
              resultInfo: resultText,
              futurePlan: existingReport.content?.futurePlan?.trim()
                ? existingReport.content.futurePlan
                : (childFutures[dateKey] || ""),
              isVerified: false
            };
            payload.externalInfo = payload.content.externalInfo || "";
            batch.update(existingRef, payload);
          } else {
            const newRef = doc(collection(db, 'daily_reports'));
            payload.createdAt = serverTimestamp();
            
            const externalInfo = childTexts[dateKey] || "";
            const futurePlan = childFutures[dateKey] || "";
            
            payload.content = {
              externalInfo,
              supportContent: [],
              resultInfo: resultText,
              futurePlan,
              isVerified: false
            };
            payload.externalInfo = externalInfo;
            payload.archived = false;
            batch.set(newRef, payload);
          }

          const reportDoc = {
            results: {
              [childId]: {
                D: existingReport?.content?.externalInfo || childTexts[dateKey] || ""
              }
            },
            updatedAt: new Date().toISOString()
          };
          const reportRefNoPref = doc(db, 'reports', formattedDate);
          batch.set(reportRefNoPref, reportDoc, { merge: true });

          if (selectedOfficeId) {
            const reportRefPref = doc(db, 'reports', `${selectedOfficeId}_${formattedDate}`);
            batch.set(reportRefPref, reportDoc, { merge: true });
          }

          const childTreeDoc = {
            name: child.fullName || "",
            tree_comm_text: existingReport?.content?.externalInfo || childTexts[dateKey] || "",
            future_plan: existingReport?.content?.futurePlan || childFutures[dateKey] || "",
            pickupLocation: "",
            endTime: "",
            transportTime: "",
            notes: "",
            officeId: selectedOfficeId,
            office: selectedOfficeId === 'LNrWc8f6G703aUYRZ5e2' ? 'サーチ' : selectedOfficeId === 'nWioUcWXUskreYjmSL8p' ? 'ホーム' : '',
            updatedAt: new Date().toISOString()
          };
          const childTreeRefNoPref = doc(db, `children/${childId}/app_categories/書類管理/tree_communications`, formattedDate);
          batch.set(childTreeRefNoPref, childTreeDoc, { merge: true });

          const childTreeRefPref = doc(db, `children/${childId}/app_categories/書類管理/tree_communications`, `${selectedOfficeId}_${formattedDate}`);
          batch.set(childTreeRefPref, childTreeDoc, { merge: true });

          count++;
        }
      }

      await batch.commit();
      alert(`計 ${count}件の療育結果をFirestoreに一括保存しました。`);
      setIsResultImportOpen(false);
      
      await fetchData();
    } catch (err: any) {
      console.error(err);
      alert(`一括登録中にエラーが発生しました: ${err.message || String(err)}`);
    } finally {
      setIsLoading(false);
    }
  };

  // データ取得処理
  const fetchData = useCallback(async () => {
    if (childrenData.length === 0) return;
    setIsLoading(true);
    
    try {
      // 1. daily_reports の一括取得
      const dailyQuery = query(
        collection(db, 'daily_reports'),
        where('planMonth', '==', currentMonth),
        where('officeId', '==', selectedOfficeId)
      );
      const dailySnap = await getDocs(dailyQuery);
      
      const reportsGrouped: Record<string, Record<string, any>> = {};
      dailySnap.docs.forEach(docSnap => {
        const data = docSnap.data();
        const childId = data.childId;
        if (!childId) return;

        let dateStr = "";
        let dObj: Date | null = null;
        if (data.date && typeof data.date.toDate === 'function') {
          dObj = data.date.toDate();
        } else if (typeof data.date === 'string') {
          const parts = data.date.split('-');
          if (parts.length === 3) {
            dObj = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
          } else {
            const parsed = new Date(data.date);
            if (!isNaN(parsed.getTime())) dObj = parsed;
          }
        }

        if (dObj) {
          if (dObj.getFullYear() === year && (dObj.getMonth() + 1) === month) {
            dateStr = `${dObj.getMonth() + 1}月${dObj.getDate()}日`;
          }
        }

        if (dateStr) {
          if (!reportsGrouped[childId]) reportsGrouped[childId] = {};
          const existing = reportsGrouped[childId][dateStr];
          const isArchived = data.archived === true;
          // すでにアクティブ（非アーカイブ）な日報が存在する場合、アーカイブ日報で上書きしない
          if (existing && !existing.archived && isArchived) {
            return;
          }
          reportsGrouped[childId][dateStr] = {
            id: docSnap.id,
            ...data,
            archived: isArchived,
            content: {
              externalInfo: data.content?.externalInfo || data.externalInfo || "",
              supportContent: data.content?.supportContent || [],
              resultInfo: data.content?.resultInfo || "",
              futurePlan: data.content?.futurePlan || "",
              isVerified: data.content?.isVerified || false,
            }
          };
        }
      });

      // 2. reports (ツリー通信および選択中事業所の出席情報) の一括取得
      const startPath = `${currentMonth}-01`;
      const endPath = `${currentMonth}-31`;
      const startPathPrefixed = `${selectedOfficeId}_${currentMonth}-01`;
      const endPathPrefixed = `${selectedOfficeId}_${currentMonth}-31`;

      const [reportsSnap1, reportsSnap2] = await Promise.all([
        getDocs(query(
          collection(db, 'reports'),
          where(documentId(), '>=', startPath),
          where(documentId(), '<=', endPath)
        )),
        selectedOfficeId ? getDocs(query(
          collection(db, 'reports'),
          where(documentId(), '>=', startPathPrefixed),
          where(documentId(), '<=', endPathPrefixed)
        )) : Promise.resolve(null)
      ]);

      const treeCommTextMap: Record<string, Record<string, string>> = {};
      const treeCommFutureMap: Record<string, Record<string, string>> = {};
      const treeCommFutureUpdatedAtMap: Record<string, Record<string, string>> = {};
      const treeCommTextUpdatedAtMap: Record<string, Record<string, string>> = {};
      const attendanceDataMap: Record<string, Record<string, AttendanceInfo>> = {};
      
      const processReportSnap = (snap: any) => {
        if (!snap) return;
        snap.forEach((d: any) => {
          const data = d.data();
          const parts = d.id.split('_');
          let docOfficeId: string | null = null;
          let dateStr = d.id;
          if (parts.length === 2) {
            docOfficeId = parts[0];
            dateStr = parts[1];
          }

          // 選択中の事業所のみを対象とする（他の事業所データは除外）
          if (docOfficeId && !matchesOffice(selectedOfficeId, docOfficeId)) {
            return;
          }
          if (data.officeId && !matchesOffice(selectedOfficeId, data.officeId)) {
            return;
          }
          if (data.office && !matchesOffice(selectedOfficeId, data.office)) {
            return;
          }

          const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
          if (!match) return;

          const yNum = parseInt(match[1], 10);
          const mNum = parseInt(match[2], 10);
          const dNum = parseInt(match[3], 10);

          if (yNum !== year || mNum !== month) return;
          const dateKey = `${mNum}月${dNum}日`;
          const updatedAtStr = data.updatedAt || data.createdAt || "";

          // A. 選択中事業所の出席予定データ（children と dailyTable）のパース
          if (Array.isArray(data.children)) {
            data.children.forEach((childItem: any) => {
              if (!childItem || !childItem.id) return;
              const cId = childItem.id;
              const tableItem = (data.dailyTable && typeof data.dailyTable === 'object') ? data.dailyTable[cId] : null;

              const isAbsent = childItem.isAbsent === true;
              const isWaitlist = childItem.isWaitlist === true;

              if (!attendanceDataMap[cId]) {
                attendanceDataMap[cId] = {};
              }

              attendanceDataMap[cId][dateKey] = {
                officeId: selectedOfficeId,
                officeName,
                isAbsent,
                isWaitlist,
                transportTime: tableItem?.transportTime || '',
                endTime: tableItem?.endTime || '',
                pickupLocation: tableItem?.pickupLocation || '',
                assignedStaff: tableItem?.assignedStaff || ''
              };
            });
          }

          // B. ツリー通信・今後の予定（選択中事業所のもののみ）
          childrenData.forEach(child => {
            if (!child.id) return;
            const childResult = data.results?.[child.id];
            if (childResult) {
              // reportsに出席児童一覧がある場合、その児童が含まれているか確認
              if (Array.isArray(data.children) && data.children.length > 0) {
                const isChildInDailyAttendance = data.children.some((c: any) => c?.id === child.id);
                if (!isChildInDailyAttendance) {
                  return;
                }
              }

              const childOfficeTags = Array.isArray(child.offices)
                ? child.offices
                : typeof child.offices === 'string'
                  ? [child.offices]
                  : [];
              if (childOfficeTags.length > 1 && !docOfficeId && !data.officeId && !data.office) {
                return;
              }

              if (childResult.D) {
                const existingText = treeCommTextMap[child.id]?.[dateKey];
                const existingUpdate = treeCommTextUpdatedAtMap[child.id]?.[dateKey] || "";
                if (!existingText || !existingUpdate || updatedAtStr >= existingUpdate) {
                  if (!treeCommTextMap[child.id]) treeCommTextMap[child.id] = {};
                  treeCommTextMap[child.id][dateKey] = childResult.D;

                  if (!treeCommTextUpdatedAtMap[child.id]) treeCommTextUpdatedAtMap[child.id] = {};
                  treeCommTextUpdatedAtMap[child.id][dateKey] = updatedAtStr;
                }
              }

              // reports の results[child.id].futurePlan / future_plan
              const repFuture = childResult.futurePlan || childResult.future_plan;
              if (repFuture) {
                const existingPlan = treeCommFutureMap[child.id]?.[dateKey];
                const existingUpdate = treeCommFutureUpdatedAtMap[child.id]?.[dateKey] || "";
                if (!existingPlan || !existingUpdate || updatedAtStr >= existingUpdate) {
                  if (!treeCommFutureMap[child.id]) treeCommFutureMap[child.id] = {};
                  treeCommFutureMap[child.id][dateKey] = repFuture;

                  if (!treeCommFutureUpdatedAtMap[child.id]) treeCommFutureUpdatedAtMap[child.id] = {};
                  treeCommFutureUpdatedAtMap[child.id][dateKey] = updatedAtStr;
                }
              }
            }
          });
        });
      };

      processReportSnap(reportsSnap1);
      processReportSnap(reportsSnap2);

      // 3. 各児童の tree_communications サブコレクション取得
      await Promise.all(childrenData.map(async (child) => {
        if (!child.id) return;
        try {
          const treeCommRef = collection(db, 'children', child.id, 'app_categories', '書類管理', 'tree_communications');
          const snap = await getDocs(treeCommRef);
          snap.forEach(d => {
            const data = d.data();
            const parts = d.id.split('_');
            let docOfficeId: string | null = null;
            let dateStr = d.id;
            if (parts.length === 2) {
              docOfficeId = parts[0];
              dateStr = parts[1];
            }

            // 1. 異なる事業所のIDプレフィックスならスキップ
            if (docOfficeId && !matchesOffice(selectedOfficeId, docOfficeId)) {
              return;
            }
            // データ内のofficeId / officeフィールドでのフィルタ
            if (data.officeId && !matchesOffice(selectedOfficeId, data.officeId)) {
              return;
            }
            if (data.office && !matchesOffice(selectedOfficeId, data.office)) {
              return;
            }

            // 2. 複数所属の児童で、事業所情報が一切無いデータは混同回避のためスキップ
            const childOfficeTags = Array.isArray(child.offices)
              ? child.offices
              : typeof child.offices === 'string'
                ? [child.offices]
                : [];
            if (childOfficeTags.length > 1 && !docOfficeId && !data.officeId && !data.office) {
              return;
            }

            const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (match) {
              const yNum = parseInt(match[1], 10);
              const mNum = parseInt(match[2], 10);
              const dNum = parseInt(match[3], 10);
              
              if (yNum === year && mNum === month) {
                const dateKey = `${mNum}月${dNum}日`;
                const updatedAtStr = data.updatedAt || data.createdAt || "";

                const tcFuture = data.future_plan || data.futurePlan;
                if (tcFuture) {
                  const existingPlan = treeCommFutureMap[child.id!]?.[dateKey];
                  const existingUpdate = treeCommFutureUpdatedAtMap[child.id!]?.[dateKey] || "";
                  if (!existingPlan || !existingUpdate || updatedAtStr > existingUpdate) {
                    if (!treeCommFutureMap[child.id!]) treeCommFutureMap[child.id!] = {};
                    treeCommFutureMap[child.id!][dateKey] = tcFuture;
                    
                    if (!treeCommFutureUpdatedAtMap[child.id!]) treeCommFutureUpdatedAtMap[child.id!] = {};
                    treeCommFutureUpdatedAtMap[child.id!][dateKey] = updatedAtStr;
                  }
                }
                
                const tcText = data.tree_comm_text || (data.results?.[child.id!]?.D);
                if (tcText) {
                  const existingText = treeCommTextMap[child.id!]?.[dateKey];
                  const existingUpdate = treeCommTextUpdatedAtMap[child.id!]?.[dateKey] || "";
                  if (!existingText || !existingUpdate || updatedAtStr > existingUpdate) {
                    if (!treeCommTextMap[child.id!]) treeCommTextMap[child.id!] = {};
                    treeCommTextMap[child.id!][dateKey] = tcText;
                    
                    if (!treeCommTextUpdatedAtMap[child.id!]) treeCommTextUpdatedAtMap[child.id!] = {};
                    treeCommTextUpdatedAtMap[child.id!][dateKey] = updatedAtStr;
                  }
                }
              }
            }
          });
        } catch (err) {
          console.error(`Failed to fetch tree_communications for child ${child.id}:`, err);
        }
      }));

      setMergedData({
        dailyReports: reportsGrouped,
        treeCommTexts: treeCommTextMap,
        treeCommFutures: treeCommFutureMap,
        attendance: attendanceDataMap
      });

      // 既存の daily_reports から正式採用行 (archived !== true かつ 出席日) を初期選択状態にする
      const initialSelected: Record<string, Set<number>> = {};
      Object.entries(reportsGrouped).forEach(([cId, dateReports]) => {
        initialSelected[cId] = new Set<number>();
        Object.entries(dateReports).forEach(([dStr, rep]) => {
          if (rep.archived !== true) {
            const m = dStr.match(/(\d+)日/);
            if (m) {
              const dayNum = parseInt(m[1], 10);
              // 出席予定日（かつ欠席・キャンセル待ちでない日）のみを採用選択に含める
              const att = attendanceDataMap[cId]?.[dStr];
              const isAttending = !!(att && att.officeId === selectedOfficeId && !att.isAbsent && !att.isWaitlist);
              if (isAttending) {
                initialSelected[cId].add(dayNum);
              }
            }
          }
        });
      });
      setSelectedDaysMap(initialSelected);

      // 4. 事業所サマリー設定の取得
      try {
        const settingsSnap = await getDoc(doc(db, 'officeSummarySettings', selectedOfficeId));
        if (settingsSnap.exists()) {
          const data = settingsSnap.data();
          setSummarySettings({
            holidayDaysOfWeek: data.holidayDaysOfWeek || [],
            individualDaysOfWeek: data.individualDaysOfWeek || [],
            holidayColor: data.holidayColor || '#ffe4e6',
            individualColor: data.individualColor || '#e0f2fe',
          });
        } else {
          setSummarySettings({
            holidayDaysOfWeek: [],
            individualDaysOfWeek: [],
            holidayColor: '#ffe4e6',
            individualColor: '#e0f2fe',
          });
        }
      } catch (err) {
        console.error("Error fetching summary settings:", err);
      }
    } catch (error) {
      console.error("Error fetching monthly data:", error);
    } finally {
      setIsLoading(false);
    }
  }, [currentMonth, selectedOfficeId, childrenData, year, month]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 前月・次月移動
  const handlePrevMonth = () => {
    const d = new Date(year, month - 2, 1);
    setCurrentMonth(d.toISOString().slice(0, 7));
  };

  const handleNextMonth = () => {
    const d = new Date(year, month, 1);
    setCurrentMonth(d.toISOString().slice(0, 7));
  };

  // セルの判定ロジック（記号表示 + 出席予定日の太枠強調）
  const getCellDetails = (childId: string, day: number) => {
    const dateKey = `${monthNum}月${day}日`;
    
    // 出席情報（選択中事業所の出席予定）
    const att = mergedData.attendance[childId]?.[dateKey];
    const isAttending = !!(att && att.officeId === selectedOfficeId && !att.isAbsent && !att.isWaitlist);
    const isAbsent = !!(att && att.officeId === selectedOfficeId && att.isAbsent);
    const isWaitlist = !!(att && att.officeId === selectedOfficeId && att.isWaitlist);

    // 記録情報（該当事業所の出席日、または当事業所の日報がある日のみツリー通信をセルに反映）
    const report = mergedData.dailyReports[childId]?.[dateKey];
    const isReportSaved = !!report?.id;
    const isRelevantDay = isAttending || isReportSaved;

    const treeText = isRelevantDay ? (mergedData.treeCommTexts[childId]?.[dateKey] || "") : "";
    const treeFuture = isRelevantDay ? (mergedData.treeCommFutures[childId]?.[dateKey] || "") : "";

    const resultInfo = report?.content?.resultInfo || "";
    const futurePlan = report?.content?.futurePlan || treeFuture || "";
    const externalInfo = report?.content?.externalInfo || treeText || "";

    const hasResult = resultInfo.trim() !== "";
    const hasFuture = futurePlan.trim() !== "";
    const hasTree = externalInfo.trim() !== "" && isRelevantDay;

    // 正式採用・アーカイブの判定（出席していない日・欠席日は絶対に採用扱いにしない）
    const isReportArchived = report?.archived === true;
    const isAdopted = isAttending && (
      (childId && selectedDaysMap[childId]) 
        ? selectedDaysMap[childId].has(day)
        : (isReportSaved && !isReportArchived)
    );

    // 出席情報ツールチップ
    let attTooltip = "";
    if (isAttending) {
      const timeStr = (att.transportTime || att.endTime) 
        ? `${att.transportTime || '--:--'}〜${att.endTime || '--:--'}`
        : '';
      const parts = [
        `【${officeName} 出席予定】`,
        timeStr ? `時間: ${timeStr}` : null,
        att.pickupLocation ? `送迎: ${att.pickupLocation}` : null,
        att.assignedStaff ? `担当: ${att.assignedStaff}` : null
      ].filter(Boolean);
      attTooltip = parts.join(' / ') + '\n\n';
    } else if (isAbsent) {
      attTooltip = `【${officeName} 欠席】\n\n`;
    } else if (isWaitlist) {
      attTooltip = `【${officeName} キャンセル待ち】\n\n`;
    }

    // 正式採用ステータスツールチップ
    let adoptionTooltip = "";
    if (isAdopted) {
      adoptionTooltip = "【専門的支援: 正式採用】\n";
    } else if (isReportArchived) {
      adoptionTooltip = "【専門的支援: アーカイブ】\n";
    }

    // 出席予定日は太枠（ring-2 ring-inset ring-primary）で強調
    const borderClass = isAttending 
      ? "ring-2 ring-inset ring-primary font-bold z-[1]" 
      : "";

    // 記録進捗の記号とスタイリング
    let content: React.ReactNode = "";
    let baseClass = "hover:bg-slate-50";
    let recordTooltip = "支援記録なし";

    // 他アプリ等で欠席となった児童は「✕」を表示
    if (isAbsent) {
      content = "✕";
      baseClass = "text-rose-500 font-bold bg-rose-50/40 hover:bg-rose-100/60";
      recordTooltip = `【欠席】${hasResult ? `\n療育結果:\n${resultInfo}` : ''}${hasFuture ? `\n今後の予定:\n${futurePlan}` : ''}`;
    } else if (hasResult && hasFuture) {
      content = "◎";
      baseClass = "text-green-600 font-bold bg-green-50/30 hover:bg-green-100/50";
      recordTooltip = `療育結果:\n${resultInfo}\n\n今後の予定:\n${futurePlan}`;
    } else if (hasResult && !hasFuture) {
      content = "△";
      baseClass = "text-amber-500 font-bold bg-amber-50/30 hover:bg-amber-100/50";
      recordTooltip = `療育結果:\n${resultInfo}\n\n※今後の予定は未記入`;
    } else if (!hasResult && hasFuture) {
      content = "◯";
      baseClass = "text-blue-600 font-bold bg-blue-50/30 hover:bg-blue-100/50";
      recordTooltip = `今後の予定:\n${futurePlan}\n\n※療育結果は未記入`;
    } else if (!hasResult && !hasFuture && hasTree) {
      content = "✉️";
      baseClass = "bg-red-100 text-red-600 font-semibold hover:bg-red-200/80 transition-colors animate-pulse";
      recordTooltip = `ツリー通信のみあり（どちらも未記入）:\n${externalInfo}`;
    }

    // 出席予定があるが記録がまだ未記入の場合、薄いprimary背景で視認性を上げる
    if (isAttending && !content) {
      baseClass = "bg-primary/[0.04] hover:bg-primary/[0.08]";
    }

    return {
      content,
      className: `${baseClass} ${borderClass}`.trim(),
      tooltip: `${adoptionTooltip}${attTooltip}${recordTooltip}`.trim(),
      isAttending,
      isAdopted,
      isReportSaved,
      isReportArchived
    };
  };

  // 曜日の色分け用
  const getDayOfWeekDetails = (day: number) => {
    const dObj = new Date(year, month - 1, day);
    const dayIndex = dObj.getDay();
    const dayStr = ['日', '月', '火', '水', '木', '金', '土'][dayIndex];
    let className = "text-slate-600";
    if (dayIndex === 0) className = "text-red-500 font-semibold bg-red-50/20";
    if (dayIndex === 6) className = "text-blue-500 font-semibold bg-blue-50/20";
    return { dayStr, className };
  };

  // 児童の放課後デイサービス判定 (true: 放課後等デイサービス, false: 児童発達支援)
  const isChildHoukagoDay = useCallback((child: Child): boolean => {
    const c = child as any;
    if (typeof c.isHoukagoDay === 'boolean') {
      return c.isHoukagoDay;
    }
    if (c.serviceType) {
      if (String(c.serviceType).includes('放課後')) return true;
      if (String(c.serviceType).includes('児童発達支援') || String(c.serviceType).includes('児発')) return false;
    }
    if (c.serviceCategory) {
      if (String(c.serviceCategory).includes('放課後')) return true;
      if (String(c.serviceCategory).includes('児童発達支援') || String(c.serviceCategory).includes('児発')) return false;
    }
    // 学年からの推測
    if (child.grade) {
      const g = String(child.grade);
      if (g.includes('小') || g.includes('中') || g.includes('高')) return true;
      if (g.includes('幼') || g.includes('保') || g.includes('未就学')) return false;
    }
    // 年齢からの推測 (6歳以上なら放課後デイ)
    if (typeof child.age === 'number') {
      if (child.age >= 6) return true;
      if (child.age < 6) return false;
    }
    return true; // デフォルトは放課後デイ
  }, []);

  // 児童のその月の出席日数（総出席、個別療育出席、個別以外出席）の計算
  const getChildAttendanceDetails = useCallback((childId: string) => {
    let totalCount = 0;
    let individualCount = 0;

    daysArray.forEach(day => {
      const dateKey = `${monthNum}月${day}日`;
      const att = mergedData.attendance[childId]?.[dateKey];
      const isAttending = !!(att && att.officeId === selectedOfficeId && !att.isAbsent && !att.isWaitlist);
      const rep = mergedData.dailyReports[childId]?.[dateKey];
      const hasReport = !!(rep?.content?.resultInfo?.trim() && !rep?.archived);
      if (isAttending || hasReport) {
        totalCount++;
        const dObj = new Date(year, month - 1, day);
        const dayOfWeek = dObj.getDay();
        if (summarySettings.individualDaysOfWeek.includes(dayOfWeek)) {
          individualCount++;
        }
      }
    });

    const nonIndividualCount = Math.max(0, totalCount - individualCount);
    return { totalCount, individualCount, nonIndividualCount };
  }, [daysArray, monthNum, mergedData, selectedOfficeId, year, month, summarySettings.individualDaysOfWeek]);

  // 必要日数の計算
  // 出席数が1未満の時は必要数はその数字のまま（0）
  // 放デイ（小学生以上）：出席12日以上で6日分、出席6～12未満で4日分、出席6日未満で2日分（0日なら0）
  // 児発（幼児以下）：出席12日以上で6回、出席12日未満で4回（0日なら0）
  const getChildRequiredDays = useCallback((child: Child, attCount: number): number => {
    if (attCount < 1) return attCount;
    const isHoukago = isChildHoukagoDay(child);
    if (isHoukago) {
      if (attCount >= 12) return 6;
      if (attCount >= 6) return 4;
      return 2;
    } else {
      if (attCount >= 12) return 6;
      return 4;
    }
  }, [isChildHoukagoDay]);

  // 全児童の当月出席日数および必要日数の集計マップ
  const childAttendanceStats = useMemo(() => {
    const stats: Record<string, { 
      attendanceCount: number; 
      individualCount: number;
      nonIndividualCount: number;
      requiredDays: number; 
      baseRequiredDays: number;
      isHoukago: boolean 
    }> = {};

    childrenData.forEach(child => {
      if (!child.id) return;
      const { totalCount, individualCount } = getChildAttendanceDetails(child.id);
      const isHoukago = isChildHoukagoDay(child);
      const baseReqDays = getChildRequiredDays(child, totalCount);
      // 出席数が1未満の時は必要数はその数字のまま(0)
      const reqDays = totalCount < 1 ? totalCount : (individualCount > baseReqDays ? individualCount : baseReqDays);
      // 個別以外: 必要日数から個別の出席数を差し引いた数
      const nonIndividualCount = Math.max(0, reqDays - individualCount);
      stats[child.id] = { 
        attendanceCount: totalCount, 
        individualCount,
        nonIndividualCount,
        requiredDays: reqDays, 
        baseRequiredDays: baseReqDays,
        isHoukago 
      };
    });
    return stats;
  }, [childrenData, getChildAttendanceDetails, isChildHoukagoDay, getChildRequiredDays]);

  // 個別以外の日数の均等分配（児童単位の不可分ルールを厳守）
  const handleDistributeRequiredDays = useCallback(async () => {
    if (selectedStaffForDist.size === 0) {
      alert("分配対象のスタッフを少なくとも1名選択してください。");
      return;
    }

    const participatingStaffIds = Array.from(selectedStaffForDist);
    // 対象児童と「個別以外の日数」のリスト（個別以外の日数 > 0 の児童）
    // childrenData の並び順（表の列順）をそのまま保持
    const orderedChildItems: { id: string; name: string; nonIndDays: number }[] = [];
    childrenData.forEach(child => {
      if (!child.id) return;
      const stat = childAttendanceStats[child.id];
      const nonInd = stat?.nonIndividualCount ?? 0;
      if (nonInd > 0) {
        orderedChildItems.push({
          id: child.id,
          name: child.fullName || '(名前なし)',
          nonIndDays: nonInd
        });
      }
    });

    if (orderedChildItems.length === 0) {
      alert("分配対象となる「個別以外の日数」を持つ児童がいません。");
      return;
    }

    // 各スタッフの担当バケット
    const staffBuckets: Record<string, { childIds: string[]; totalDays: number }> = {};
    participatingStaffIds.forEach(id => {
      staffBuckets[id] = { childIds: [], totalDays: 0 };
    });

    if (groupAdjacentColumns) {
      // ---- オプション有効: 表の並び順（列）で近くの児童をなるべくまとめる ----
      const totalAllDays = orderedChildItems.reduce((acc, c) => acc + c.nonIndDays, 0);
      const targetDaysPerStaff = totalAllDays / participatingStaffIds.length;

      let currentStaffIdx = 0;
      orderedChildItems.forEach((child) => {
        const currentSid = participatingStaffIds[currentStaffIdx];
        const nextStaffIdx = currentStaffIdx + 1;
        const currentTotal = staffBuckets[currentSid].totalDays;

        // 次のスタッフが存在し、現在のスタッフが既に目標以上、あるいは次のスタッフに移った方が目標に近い場合
        if (nextStaffIdx < participatingStaffIds.length && currentTotal >= targetDaysPerStaff && staffBuckets[currentSid].childIds.length > 0) {
          currentStaffIdx = nextStaffIdx;
        }

        const sid = participatingStaffIds[currentStaffIdx];
        staffBuckets[sid].childIds.push(child.id);
        staffBuckets[sid].totalDays += child.nonIndDays;
      });

      // 隣接スタッフ間での境界調整（列のまとまりを維持したまま、差を最小化）
      let adjusted = true;
      let passes = 0;
      while (adjusted && passes < 30) {
        adjusted = false;
        passes++;
        for (let i = 0; i < participatingStaffIds.length - 1; i++) {
          const s1 = participatingStaffIds[i];
          const s2 = participatingStaffIds[i + 1];
          const b1 = staffBuckets[s1];
          const b2 = staffBuckets[s2];
          const diff = Math.abs(b1.totalDays - b2.totalDays);

          // s1の最後の児童をs2に移動して差が縮まるか
          if (b1.childIds.length > 1) {
            const lastChildId = b1.childIds[b1.childIds.length - 1];
            const childDays = orderedChildItems.find(c => c.id === lastChildId)!.nonIndDays;
            const newDiff = Math.abs((b1.totalDays - childDays) - (b2.totalDays + childDays));
            if (newDiff < diff) {
              b1.childIds.pop();
              b1.totalDays -= childDays;
              b2.childIds.unshift(lastChildId);
              b2.totalDays += childDays;
              adjusted = true;
              continue;
            }
          }

          // s2の最初の児童をs1に移動して差が縮まるか
          if (b2.childIds.length > 1) {
            const firstChildId = b2.childIds[0];
            const childDays = orderedChildItems.find(c => c.id === firstChildId)!.nonIndDays;
            const newDiff = Math.abs((b1.totalDays + childDays) - (b2.totalDays - childDays));
            if (newDiff < diff) {
              b2.childIds.shift();
              b2.totalDays -= childDays;
              b1.childIds.push(firstChildId);
              b1.totalDays += childDays;
              adjusted = true;
              continue;
            }
          }
        }
      }
    } else {
      // ---- オプション無効: 純粋な均等度最優先（LPT + 局所探索） ----
      const sortedItems = [...orderedChildItems].sort((a, b) => b.nonIndDays - a.nonIndDays);

      sortedItems.forEach(child => {
        let minStaffId = participatingStaffIds[0];
        let minDays = staffBuckets[minStaffId].totalDays;

        for (let i = 1; i < participatingStaffIds.length; i++) {
          const sid = participatingStaffIds[i];
          if (staffBuckets[sid].totalDays < minDays) {
            minDays = staffBuckets[sid].totalDays;
            minStaffId = sid;
          }
        }

        staffBuckets[minStaffId].childIds.push(child.id);
        staffBuckets[minStaffId].totalDays += child.nonIndDays;
      });

      let improved = true;
      let loopCount = 0;
      while (improved && loopCount < 100) {
        improved = false;
        loopCount++;

        let maxStaffId = participatingStaffIds[0];
        let minStaffId = participatingStaffIds[0];
        participatingStaffIds.forEach(sid => {
          if (staffBuckets[sid].totalDays > staffBuckets[maxStaffId].totalDays) maxStaffId = sid;
          if (staffBuckets[sid].totalDays < staffBuckets[minStaffId].totalDays) minStaffId = sid;
        });

        const currentDiff = staffBuckets[maxStaffId].totalDays - staffBuckets[minStaffId].totalDays;
        if (currentDiff <= 1) break;

        // 移動テスト
        for (const cId of staffBuckets[maxStaffId].childIds) {
          const days = orderedChildItems.find(c => c.id === cId)!.nonIndDays;
          const newDiff = Math.abs((staffBuckets[maxStaffId].totalDays - days) - (staffBuckets[minStaffId].totalDays + days));
          if (newDiff < currentDiff) {
            staffBuckets[maxStaffId].childIds = staffBuckets[maxStaffId].childIds.filter(id => id !== cId);
            staffBuckets[maxStaffId].totalDays -= days;
            staffBuckets[minStaffId].childIds.push(cId);
            staffBuckets[minStaffId].totalDays += days;
            improved = true;
            break;
          }
        }
        if (improved) continue;

        // 交換テスト
        for (const cIdMax of staffBuckets[maxStaffId].childIds) {
          const daysMax = orderedChildItems.find(c => c.id === cIdMax)!.nonIndDays;
          for (const cIdMin of staffBuckets[minStaffId].childIds) {
            const daysMin = orderedChildItems.find(c => c.id === cIdMin)!.nonIndDays;
            if (daysMax > daysMin) {
              const change = daysMax - daysMin;
              const newDiff = Math.abs((staffBuckets[maxStaffId].totalDays - change) - (staffBuckets[minStaffId].totalDays + change));
              if (newDiff < currentDiff) {
                staffBuckets[maxStaffId].childIds = staffBuckets[maxStaffId].childIds.filter(id => id !== cIdMax);
                staffBuckets[maxStaffId].childIds.push(cIdMin);
                staffBuckets[maxStaffId].totalDays -= change;

                staffBuckets[minStaffId].childIds = staffBuckets[minStaffId].childIds.filter(id => id !== cIdMin);
                staffBuckets[minStaffId].childIds.push(cIdMax);
                staffBuckets[minStaffId].totalDays += change;

                improved = true;
                break;
              }
            }
          }
          if (improved) break;
        }
      }
    }

    const newAssignments: Record<string, string> = { ...assignedStaffMap };
    participatingStaffIds.forEach(sid => {
      staffBuckets[sid].childIds.forEach(cid => {
        newAssignments[cid] = sid;
      });
    });

    setAssignedStaffMap(newAssignments);
    setIsDistributeModalOpen(false);

    try {
      setIsSavingStaffAssignments(true);
      const assignDocRef = doc(db, 'offices', selectedOfficeId, 'monthly_staff_assignments', currentMonth);
      await setDoc(assignDocRef, {
        assignments: newAssignments,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (e) {
      console.error("Failed to save distributed staff assignments:", e);
    } finally {
      setIsSavingStaffAssignments(false);
    }
  }, [selectedStaffForDist, childrenData, childAttendanceStats, groupAdjacentColumns, assignedStaffMap, selectedOfficeId, currentMonth]);

  // セルホバー時の専門的支援実施計画プレビュー表示ハンドラ
  const handleCellMouseEnter = useCallback((
    e: React.MouseEvent<HTMLElement>,
    child: Child,
    day: number
  ) => {
    if (!child.id) return;

    // ホバーされている児童列と日付行を常に追跡
    setHoveredColChildId(child.id);
    setHoveredRowDay(day);

    const rect = e.currentTarget.getBoundingClientRect();
    const dateKey = `${monthNum}月${day}日`;
    // 出席情報
    const att = mergedData.attendance[child.id]?.[dateKey];
    const isAttending = !!(att && att.officeId === selectedOfficeId && !att.isAbsent && !att.isWaitlist);

    // 出席していないマスはプレビューウィンドウを表示しない
    if (!isAttending) {
      setHoveredCellPreview(null);
      return;
    }

    const { dayStr } = getDayOfWeekDetails(day);

    const report = mergedData.dailyReports[child.id]?.[dateKey];
    const treeFuture = mergedData.treeCommFutures[child.id]?.[dateKey] || "";
    const supportContent: string[] = report?.content?.supportContent || [];
    const resultInfo: string = report?.content?.resultInfo || "";
    const futurePlan: string = report?.content?.futurePlan || treeFuture || "";
    const isReportArchived = report?.archived === true;
    
    // 日報の作成者（アーカイブされている場合は参照しない）
    const reportStaffName = (!isReportArchived && (report?.staffName || report?.staffId)) ? (report.staffName || report.staffId) : "";

    // 児童の担当スタッフ（表上部で割り当てられたスタッフ）
    const assignedStaffId = child.id ? assignedStaffMap[child.id] : null;
    const assignedStaffMember = assignedStaffId ? staffList.find(s => s.id === assignedStaffId) : null;
    const assignedStaffName = assignedStaffMember ? assignedStaffMember.name : "";
    const assignedStaffColor = assignedStaffMember ? assignedStaffMember.color : undefined;

    // 表示用スタッフ名
    const staffName = assignedStaffName || reportStaffName;

    const isAdopted = isAttending && (
      (child.id && selectedDaysMap[child.id])
        ? selectedDaysMap[child.id].has(day)
        : (!!report?.id && !isReportArchived)
    );

    let attInfoStr = "";
    if (isAttending) {
      const parts = [
        (att.transportTime || att.endTime) ? `${att.transportTime || '--:--'}〜${att.endTime || '--:--'}` : null,
        att.pickupLocation ? `送迎:${att.pickupLocation}` : null,
        att.assignedStaff ? `送迎等担当:${att.assignedStaff}` : null
      ].filter(Boolean);
      attInfoStr = parts.length > 0 ? parts.join(' | ') : "出席予定";
    }

    // ポップオーバーの配置座標（幅660px、高さ約220px想定）
    const cardWidth = 660;
    const cardHeight = 220;
    
    // 水平位置: 画面右にはみ出る場合は左側に表示
    let x = rect.right + 12;
    if (x + cardWidth > window.innerWidth - 16) {
      x = Math.max(16, rect.left - cardWidth - 12);
    }

    // 垂直位置:
    // 上部のマス（日数表ヘッダー付近）にいる場合は、マスの下に表示して日数表の裏潜りや被りを防ぐ
    let y = rect.top - 15;
    if (rect.top < 300) {
      y = rect.bottom + 8;
    } else if (y + cardHeight > window.innerHeight - 16) {
      y = Math.max(16, window.innerHeight - cardHeight - 16);
    }
    if (y < 16) y = 16;

    setHoveredCellPreview({
      childName: child.fullName,
      dateStr: dateKey,
      dayOfWeekStr: dayStr,
      supportContent,
      resultInfo,
      futurePlan,
      staffName,
      reportStaffName,
      assignedStaffName,
      assignedStaffColor,
      isAdopted,
      isReportArchived,
      isAttending,
      attInfoStr,
      x,
      y
    });
  }, [monthNum, mergedData, selectedOfficeId, selectedDaysMap, assignedStaffMap, staffList]);

  const handleCellMouseLeave = useCallback(() => {
    setHoveredCellPreview(null);
    setHoveredColChildId(null);
    setHoveredRowDay(null);
  }, []);

  // マスの選択/解除トグル
  const toggleDaySelection = useCallback((childId: string, day: number) => {
    setSelectedDaysMap(prev => {
      const childSet = new Set(prev[childId] || []);
      if (childSet.has(day)) {
        childSet.delete(day);
      } else {
        childSet.add(day);
      }
      return {
        ...prev,
        [childId]: childSet
      };
    });
  }, []);

  // 組み合わせ生成ヘルパー (n個からk個選ぶ)
  const getCombinations = useCallback(<T,>(array: T[], k: number): T[][] => {
    if (k === 0) return [[]];
    if (array.length < k) return [];
    if (array.length === k) return [array];
    
    const result: T[][] = [];
    const backtrack = (start: number, current: T[]) => {
      if (current.length === k) {
        result.push([...current]);
        return;
      }
      for (let i = start; i < array.length; i++) {
        current.push(array[i]);
        backtrack(i + 1, current);
        current.pop();
      }
    };
    backtrack(0, []);
    return result;
  }, []);

  // 必要日数分を自動選択（提案）
  // ルール:
  // 1. 個別療育の出席日はすべて必ず採用
  // 2. 採用は最大（マックス）で6日
  // 3. 採用数が上限に達した場合（または達する見込みの場合）、個別の日以外の採用を排除
  // 4. 可能な限り日数の間隔を均等に空けつつ（連日を極力避けて分散）、必要日数を選択
  const handleAutoSelect = useCallback((targetChildId?: string) => {
    const targets = targetChildId 
      ? childrenData.filter(c => c.id === targetChildId) 
      : childrenData;

    setSelectedDaysMap(prev => {
      const newSelected = { ...prev };

      targets.forEach(child => {
        if (!child.id) return;
        const cId = child.id;
        const stat = childAttendanceStats[cId];
        const reqDays = stat?.requiredDays ?? 0;
        if (reqDays === 0) {
          newSelected[cId] = new Set();
          return;
        }

        // 採用上限は最大6日
        const maxLimit = 6;
        const targetDaysCount = Math.min(maxLimit, reqDays);

        const individualDays: number[] = [];
        const nonIndividualCandidates: { day: number; score: number }[] = [];

        daysArray.forEach(day => {
          const dateKey = `${monthNum}月${day}日`;
          const att = mergedData.attendance[cId]?.[dateKey];
          const isAttending = !!(att && att.officeId === selectedOfficeId && !att.isAbsent && !att.isWaitlist);
          const report = mergedData.dailyReports[cId]?.[dateKey];
          const hasResult = !!(report?.content?.resultInfo?.trim());
          const hasFuture = !!(report?.content?.futurePlan?.trim() || mergedData.treeCommFutures[cId]?.[dateKey]?.trim());
          const hasTree = !!(report?.content?.externalInfo?.trim() || mergedData.treeCommTexts[cId]?.[dateKey]?.trim());

          const dObj = new Date(year, month - 1, day);
          const dayOfWeek = dObj.getDay();
          const isIndividual = summarySettings.individualDaysOfWeek.includes(dayOfWeek);

          // 出席予定、またはすでに何らかの記録・通信がある日を候補とする
          if (isAttending || hasResult || hasFuture || hasTree) {
            if (isIndividual) {
              // 個別療育の日
              individualDays.push(day);
            } else {
              // 個別以外の日（療育結果・予定・通信等の入力状況でスコアリング）
              let score = 0;
              if (hasResult) score += 100;
              if (hasFuture) score += 30;
              if (hasTree) score += 10;
              if (isAttending) score += 20;

              nonIndividualCandidates.push({ day, score });
            }
          }
        });

        // 1. 個別療育の日はすべて必ず採用（ただし最大上限6日）
        individualDays.sort((a, b) => a - b);
        const chosenIndividual = individualDays.slice(0, maxLimit);

        // 2. 残り採用可能枠を計算（上限 targetDaysCount から、採用した個別の分を差し引く）
        const remainingSlots = Math.max(0, targetDaysCount - chosenIndividual.length);

        // 3. 個別以外の候補から「可能な限り間を空けつつ」必要数（remainingSlots）を選択
        let chosenNonIndividual: number[] = [];

        if (remainingSlots > 0 && nonIndividualCandidates.length > 0) {
          if (nonIndividualCandidates.length <= remainingSlots) {
            // 候補数が枠数以下の場合はすべて採用
            chosenNonIndividual = nonIndividualCandidates.map(c => c.day);
          } else {
            // 候補日が多数ある場合、記入状況スコア上位16件に事前フィルタして組み合わせ爆発を防止
            const sortedByScore = [...nonIndividualCandidates].sort((a, b) => b.score - a.score);
            const searchPool = sortedByScore.length > 16
              ? sortedByScore.slice(0, 16).sort((a, b) => a.day - b.day)
              : [...nonIndividualCandidates].sort((a, b) => a.day - b.day);

            const candidateDayNumbers = searchPool.map(c => c.day);
            const combos = getCombinations(candidateDayNumbers, remainingSlots);

            let bestCombo: number[] = combos[0] || [];
            let bestScore = -Infinity;

            combos.forEach(combo => {
              // 個別療育の日と組み合わせた全選択日の間隔を評価
              const fullSelection = [...chosenIndividual, ...combo].sort((a, b) => a - b);

              let minGap = Infinity;
              let gapPenalty = 0;
              let logGapSum = 0;

              for (let i = 0; i < fullSelection.length - 1; i++) {
                const gap = fullSelection[i + 1] - fullSelection[i];
                if (gap < minGap) minGap = gap;

                if (gap === 1) {
                  gapPenalty += 30000; // 連日は超特大ペナルティ
                } else if (gap === 2) {
                  gapPenalty += 10000; // 中1日も特大ペナルティ
                } else if (gap === 3) {
                  gapPenalty += 3000;  // 中2日もペナルティ
                } else if (gap === 4) {
                  gapPenalty += 1000;
                }

                logGapSum += Math.log2(gap) * 150;
              }

              // 記録記入ボーナス（間隔が同程度に空いているなら、結果記入済みの日を優先）
              let recordScore = 0;
              combo.forEach(day => {
                const cand = nonIndividualCandidates.find(c => c.day === day);
                if (cand) recordScore += cand.score * 0.3;
              });

              // 総合評価:
              // - 最小間隔（minGap）が大きいこと（間が空いていること）を最優先（× 8000）
              // - 連日・近接ペナルティを減点
              // - 全体の間隔均等バランス加点
              // - 記録記入状況加点
              const score = (minGap * 8000) - gapPenalty + logGapSum + recordScore;

              if (score > bestScore) {
                bestScore = score;
                bestCombo = combo;
              }
            });

            chosenNonIndividual = bestCombo;
          }
        }

        // 4. 合計して Set に格納（個別療育日は必ず採用され、上限を超えた場合は個別以外が排除される）
        const finalChosen = [...chosenIndividual, ...chosenNonIndividual].sort((a, b) => a - b);
        newSelected[cId] = new Set(finalChosen);
      });

      return newSelected;
    });
  }, [childrenData, childAttendanceStats, daysArray, monthNum, mergedData, selectedOfficeId, year, month, summarySettings.individualDaysOfWeek, getCombinations]);

  // 選択内容を一括保存（選択マスを正式採用 archived: false、未選択の既存レポートを archived: true）
  const handleSaveAdoptions = async () => {
    setIsSavingAdoptions(true);
    try {
      let adoptedCount = 0;
      let archivedCount = 0;
      let createdCount = 0;

      // writeBatch は1バッチ最大500件までのため、400件単位で分割管理
      let currentBatch = writeBatch(db);
      let opCount = 0;
      const batches: ReturnType<typeof writeBatch>[] = [currentBatch];

      const addOperation = (fn: (b: ReturnType<typeof writeBatch>) => void) => {
        if (opCount >= 400) {
          currentBatch = writeBatch(db);
          batches.push(currentBatch);
          opCount = 0;
        }
        fn(currentBatch);
        opCount++;
      };

      const pad = (n: number) => n.toString().padStart(2, '0');

      for (const child of childrenData) {
        if (!child.id) continue;
        const cId = child.id;
        const selectedDays = selectedDaysMap[cId] || new Set();
        const childDailyReports = mergedData.dailyReports[cId] || {};

        for (const day of daysArray) {
          const dateKey = `${monthNum}月${day}日`;
          const isSelected = selectedDays.has(day);
          const existingReport = childDailyReports[dateKey];
          const formattedDate = `${year}-${pad(month)}-${pad(day)}`;

          if (isSelected) {
            // 正式採用対象
            if (existingReport && existingReport.id) {
              if (existingReport.archived === true) {
                const docRef = doc(db, 'daily_reports', existingReport.id);
                addOperation((b) => {
                  b.update(docRef, {
                    archived: false,
                    updatedAt: serverTimestamp()
                  });
                });
                adoptedCount++;
              }
            } else {
              // 既存ドキュメントがないが正式採用として選択された日 -> 新規作成
              const newDocRef = doc(collection(db, 'daily_reports'));
              const treeText = mergedData.treeCommTexts[cId]?.[dateKey] || "";
              const treeFuture = mergedData.treeCommFutures[cId]?.[dateKey] || "";

              const payload = {
                childId: cId,
                planMonth: currentMonth,
                date: formattedDate,
                officeId: selectedOfficeId,
                staffId: "",
                staffName: loginStaffName || "",
                type: 'tree_report',
                content: {
                  externalInfo: treeText,
                  supportContent: [],
                  resultInfo: "",
                  futurePlan: treeFuture,
                  isVerified: false,
                },
                externalInfo: treeText,
                archived: false,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              };

              addOperation((b) => {
                b.set(newDocRef, payload);
              });
              createdCount++;
            }
          } else {
            // 未選択（アーカイブ対象）
            if (existingReport && existingReport.id && existingReport.archived !== true) {
              const docRef = doc(db, 'daily_reports', existingReport.id);
              addOperation((b) => {
                b.update(docRef, {
                  archived: true,
                  updatedAt: serverTimestamp()
                });
              });
              archivedCount++;
            }
          }
        }
      }

      if (opCount > 0 || batches.length > 1) {
        for (const b of batches) {
          await b.commit();
        }
        alert(`専門的支援の採用設定を保存しました。\n・正式採用（新規作成・復帰含む）: ${adoptedCount + createdCount}件\n・アーカイブ（除外）: ${archivedCount}件`);
      } else {
        alert("変更はありませんでした。");
      }

      await fetchData();
    } catch (err: any) {
      console.error("Failed to save adoptions:", err);
      alert(`保存中にエラーが発生しました: ${err.message || String(err)}`);
    } finally {
      setIsSavingAdoptions(false);
    }
  };

  const handleSaveSettings = async () => {
    setIsSavingSettings(true);
    try {
      await setDoc(doc(db, 'officeSummarySettings', selectedOfficeId), {
        holidayDaysOfWeek: tempSettings.holidayDaysOfWeek,
        individualDaysOfWeek: tempSettings.individualDaysOfWeek,
        holidayColor: tempSettings.holidayColor,
        individualColor: tempSettings.individualColor,
        updatedAt: serverTimestamp()
      }, { merge: true });

      setSummarySettings({ ...tempSettings });
      setIsSettingsOpen(false);
    } catch (err) {
      console.error("Error saving summary settings:", err);
      alert("設定の保存に失敗しました。時間をおいて再度お試しください。");
    } finally {
      setIsSavingSettings(false);
    }
  };

  return (
    <div className="flex flex-col h-full gap-3">
      {/* 上部ヘッダー */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white px-5 py-3 rounded-2xl border border-slate-200/80 shadow-sm shrink-0">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => navigate('/')}
            className="p-2 hover:bg-slate-100 rounded-xl text-slate-500 transition-colors md:hidden"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <span className="px-2.5 py-0.5 bg-primary/10 text-primary text-xs font-semibold rounded-full tracking-wider">
              {officeName}
            </span>
            <h2 className="text-lg md:text-xl font-bold text-slate-800 mt-0.5 flex items-center gap-2">
              <Calendar size={20} className="text-primary" />
              月間支援実施状況一覧
            </h2>
          </div>
        </div>

        {/* 月切替コントロールとアクション */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={handleCopyAllTreeCommunications}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-250 rounded-xl text-slate-700 text-xs font-bold transition-all shadow-2xs"
            title="ツリー通信を全員分コピーします(児童名除外。未変換のみ/全コピーの選択可)"
          >
            <Copy size={14} className="text-slate-500" />
            <span>ツリー通信を一括コピー</span>
          </button>
          <button
            onClick={() => setIsResultImportOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-250 rounded-xl text-slate-700 text-xs font-bold transition-all shadow-2xs"
            title="Geminiで変換した全員分の結果を一括で登録します"
          >
            <Sparkles size={14} className="text-primary" />
            <span>結果を一括登録</span>
          </button>

          <button
            onClick={() => setIsSelectionMode(prev => !prev)}
            className={`flex items-center gap-1.5 px-3 py-2 border rounded-xl text-xs font-bold transition-all shadow-2xs ${
              isSelectionMode
                ? 'bg-amber-500 hover:bg-amber-600 text-white border-amber-600 shadow-amber-200 ring-2 ring-amber-300'
                : 'bg-white hover:bg-amber-50/60 border-slate-250 text-slate-700 hover:border-amber-300'
            }`}
            title="マスを選択して専門的支援の正式採用・アーカイブを設定するモードを切り替えます"
          >
            <BookmarkCheck size={14} className={isSelectionMode ? 'text-white' : 'text-amber-500'} />
            <span>{isSelectionMode ? '選択モード終了' : '採用日を選択'}</span>
          </button>

          {/* 必要日数を分配ボタン */}
          <button
            onClick={() => setIsDistributeModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs hover:shadow active:scale-95"
            title="必要日数をスタッフに均等に分配します（児童単位・不可分ルール）"
          >
            <Users size={14} />
            <span>必要日数を分配</span>
          </button>

          <div className="flex items-center gap-2 border-l border-slate-200 pl-2.5">
            <button
              onClick={handlePrevMonth}
              className="p-2 hover:bg-slate-100 border border-slate-200 rounded-xl text-slate-600 transition-all hover:border-slate-300"
              title="前月"
            >
              <ChevronLeft size={20} />
            </button>
            <div className="relative">
              <input
                type="month"
                value={currentMonth}
                onChange={(e) => setCurrentMonth(e.target.value)}
                className="px-3 py-1.5 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all cursor-pointer"
              />
            </div>
            <button
              onClick={handleNextMonth}
              className="p-2 hover:bg-slate-100 border border-slate-200 rounded-xl text-slate-600 transition-all hover:border-slate-300"
              title="次月"
            >
              <ChevronRight size={20} />
            </button>

            {/* フォーカスハイライトON/OFFトグル */}
            <button
              onClick={() => setIsFocusHighlightEnabled(prev => !prev)}
              className={`p-2 border rounded-xl transition-all flex items-center justify-center ${
                isFocusHighlightEnabled
                  ? 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100 shadow-2xs'
                  : 'bg-slate-50 text-slate-400 border-slate-200 hover:bg-slate-100'
              }`}
              title={isFocusHighlightEnabled ? "フォーカス表示: ON (クリックでOFF)" : "フォーカス表示: OFF (クリックでON)"}
            >
              <Crosshair size={18} />
            </button>

            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 hover:bg-slate-100 border border-slate-200 rounded-xl text-slate-600 transition-all hover:border-slate-300 flex items-center justify-center"
              title="カレンダー表示設定"
            >
              <SettingsIcon size={20} />
            </button>

            {/* 凡例「？」アイコンボタン & ポップオーバー */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsLegendOpen(prev => !prev)}
                className={`p-2 border rounded-xl transition-all flex items-center justify-center ${
                  isLegendOpen 
                    ? 'bg-primary text-white border-primary shadow-xs' 
                    : 'hover:bg-slate-100 border-slate-200 text-slate-600 hover:border-slate-300'
                }`}
                title="表の凡例・記号説明を表示"
              >
                <HelpCircle size={20} />
              </button>

              {isLegendOpen && (
                <>
                  <div 
                    className="fixed inset-0 z-40" 
                    onClick={() => setIsLegendOpen(false)} 
                  />
                  <div className="absolute right-0 top-full mt-2 z-50 bg-white/95 backdrop-blur-md p-4 rounded-2xl shadow-xl border border-slate-200 text-xs text-slate-700 w-80 space-y-3 animate-in fade-in zoom-in-95 duration-150">
                    <div className="font-bold text-slate-800 flex items-center justify-between border-b border-slate-100 pb-2">
                      <span className="flex items-center gap-1.5 text-sm">
                        <Info size={16} className="text-primary" /> 表の凡例・記号説明
                      </span>
                      <button 
                        onClick={() => setIsLegendOpen(false)}
                        className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
                      >
                        <X size={16} />
                      </button>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 flex items-center justify-center rounded bg-green-50 text-green-600 font-bold border border-green-200 shrink-0">◎</span>
                        <span>療育結果・今後の予定 ともに記入あり</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 flex items-center justify-center rounded bg-amber-50 text-amber-500 font-bold border border-amber-200 shrink-0">△</span>
                        <span>療育結果のみ記入あり（予定未記入）</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 flex items-center justify-center rounded bg-blue-50 text-blue-600 font-bold border border-blue-200 shrink-0">◯</span>
                        <span>今後の予定のみ記入あり（結果未記入）</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 flex items-center justify-center rounded bg-red-100 text-red-600 font-bold border border-red-200 shrink-0">✉️</span>
                        <span>ツリー通信のみあり（どちらも未記入）</span>
                      </div>
                      <div className="flex items-center gap-2 font-semibold text-primary pt-1.5 border-t border-slate-100">
                        <span className="w-6 h-6 flex items-center justify-center rounded-xs ring-2 ring-inset ring-primary bg-primary/10 text-primary text-xs font-bold shrink-0">
                          枠
                        </span>
                        <span>太枠: 出席予定（{officeName}）</span>
                      </div>
                      <div className="flex items-center gap-2 font-semibold text-emerald-700 pt-1.5 border-t border-slate-100">
                        <span className="w-6 h-6 flex items-center justify-center rounded-xs ring-2 ring-inset ring-emerald-600 bg-emerald-100 text-emerald-800 text-xs font-bold shrink-0">
                          ✓
                        </span>
                        <span>正式採用（緑枠・チェック付き）</span>
                      </div>
                      <div className="flex items-center gap-2 text-rose-600 font-bold">
                        <span className="w-6 h-6 flex items-center justify-center rounded bg-rose-50 text-rose-500 font-bold border border-rose-200 shrink-0">✕</span>
                        <span>欠席（他アプリ等で欠席登録された日）</span>
                      </div>
                      <div className="flex items-center gap-2 text-slate-400">
                        <span className="w-6 h-6 flex items-center justify-center rounded bg-slate-100 opacity-40 shrink-0 text-slate-500 font-bold">
                          ◎
                        </span>
                        <span>アーカイブ（薄色表示・除外）</span>
                      </div>
                      <div className="flex items-center gap-2 pt-1.5 border-t border-slate-100">
                        <span 
                          className="w-5 h-5 rounded border border-slate-300 shrink-0" 
                          style={{ backgroundColor: summarySettings.holidayColor }}
                        />
                        <span>休みの日 (非稼働日)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span 
                          className="w-5 h-5 rounded border border-slate-300 shrink-0" 
                          style={{ backgroundColor: summarySettings.individualColor }}
                        />
                        <span>個別療育の日</span>
                      </div>
                      <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-500 space-y-1">
                        <div className="font-bold text-slate-700">【必要日数の計算基準】</div>
                        <div>・放課後デイ: 出席12日以上で6日 / 6〜11日で4日 / 5日以下で2日</div>
                        <div>・児童発達支援: 出席12日以上で6回 / 12日未満で4回</div>
                        <div>・個別以外: 必要日数から個別療育の出席日数を差し引いた数</div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 採用日選択モード時の操作バー */}
      {isSelectionMode && (
        <div className="bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-emerald-500/10 border border-amber-300/80 px-5 py-3 rounded-2xl flex flex-wrap items-center justify-between gap-3 shadow-xs animate-in fade-in slide-in-from-top-2 duration-200 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center shadow-xs shrink-0">
              <BookmarkCheck size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-amber-950">採用日選択モード</span>
                <span className="px-2 py-0.5 bg-amber-200/80 text-amber-900 text-[10px] font-extrabold rounded-full">編集中</span>
              </div>
              <p className="text-xs text-amber-850 mt-0.5">
                マスをクリックして正式採用日を選択します。「自動選択」では個別療育の出席日をすべて最優先で採用（最大6日、上限超過時は個別以外を除外）します。
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => handleAutoSelect()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-amber-50 text-amber-900 border border-amber-300 rounded-xl text-xs font-bold shadow-2xs transition-all active:scale-95"
              title="個別療育日をすべて採用し、残りを必要日数（最大6日）まで自動選択します"
            >
              <Wand2 size={14} className="text-amber-600" />
              <span>必要日数で自動選択</span>
            </button>

            <button
              onClick={() => setSelectedDaysMap({})}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 rounded-xl text-xs font-bold shadow-2xs transition-all active:scale-95"
              title="すべての児童の選択をクリアします"
            >
              <RotateCcw size={13} />
              <span>全解除</span>
            </button>

            <button
              onClick={handleSaveAdoptions}
              disabled={isSavingAdoptions}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-sm transition-all hover:shadow active:scale-95 disabled:opacity-50"
            >
              {isSavingAdoptions ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Save size={14} />
              )}
              <span>選択内容を確定して保存</span>
            </button>

            <button
              onClick={() => setIsSelectionMode(false)}
              className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-amber-100/50 transition-colors ml-1"
              title="選択モードを終了"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      {/* メインの表テーブル（画面いっぱいに表示） */}
      <div className="flex-1 min-h-0 bg-white border border-slate-200/80 rounded-2xl shadow-sm overflow-hidden flex flex-col">
        {isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
            <p className="text-sm text-slate-400">データを読み込み中...</p>
          </div>
        ) : childrenData.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 p-8">
            <AlertTriangle className="w-8 h-8 text-amber-500" />
            <p className="text-sm font-semibold text-slate-600">表示対象の児童がいません</p>
            <p className="text-xs text-slate-400">事業所の所属児童、または検索条件をご確認ください。</p>
          </div>
        ) : (
          <div className="flex-1 overflow-auto bg-white">
            <table 
              className="w-full border-separate border-spacing-0 table-fixed min-w-[800px]"
              onMouseLeave={() => {
                setHoveredColChildId(null);
                setHoveredRowDay(null);
                setHoveredCellPreview(null);
              }}
            >
              <thead>
                {/* 1行目: 児童氏名 */}
                <tr>
                  <th 
                    className="w-20 px-2 py-2 text-center align-middle text-xs font-bold text-slate-600 tracking-wider border-r border-b border-slate-200 sticky top-0 left-0 z-30 shadow-[2px_0_4px_-1px_rgba(0,0,0,0.06)]"
                    style={{ height: '110px', backgroundColor: '#f1f5f9' }}
                  >
                    児童氏名
                  </th>
                  {childrenData.map(child => {
                    const isColHovered = isFocusHighlightEnabled && child.id === hoveredColChildId;
                    return (
                      <th 
                        key={child.id}
                        className={`px-2 py-2 border-r border-b border-slate-200 text-center align-middle sticky top-0 z-20 transition-colors duration-150 ${
                          isColHovered ? '!bg-blue-100/90 shadow-md ring-2 ring-inset ring-blue-400' : ''
                        }`}
                        style={{ height: '110px', backgroundColor: isColHovered ? '#dbeafe' : '#ffffff' }}
                        title={child.fullName}
                        onMouseEnter={() => isFocusHighlightEnabled && setHoveredColChildId(child.id || null)}
                        onMouseLeave={() => isFocusHighlightEnabled && setHoveredColChildId(null)}
                      >
                        <div 
                          className={`inline-block text-xs font-bold leading-none transition-colors duration-150 ${
                            isColHovered ? 'text-blue-950 font-black scale-105' : 'text-slate-700'
                          }`}
                          style={{ 
                            writingMode: 'vertical-rl', 
                            textOrientation: 'upright', 
                            whiteSpace: 'nowrap',
                            margin: '0 auto'
                          }}
                        >
                          {child.fullName}
                        </div>
                      </th>
                    );
                  })}
                </tr>

                {/* 2行目: 担当スタッフ（新設） */}
                <tr>
                  <th 
                    className="w-20 px-2 py-1 text-center align-middle text-[11px] font-bold text-indigo-900 tracking-wider border-r border-b border-slate-200 sticky top-[110px] left-0 z-30 shadow-[2px_0_4px_-1px_rgba(0,0,0,0.06)]"
                    style={{ height: '34px', backgroundColor: '#e0e7ff' }}
                  >
                    担当スタッフ
                  </th>
                  {childrenData.map(child => {
                    if (!child.id) return <th key={Math.random()} className="border-r border-b border-slate-200" />;
                    const staffId = assignedStaffMap[child.id];
                    const assignedStaff = staffList.find(s => s.id === staffId);
                    const isColHovered = isFocusHighlightEnabled && child.id === hoveredColChildId;
                    const isEditing = staffPopoverAnchor?.childId === child.id;

                    return (
                      <th 
                        key={`staff-${child.id}`}
                        className={`px-1 py-0.5 border-r border-b border-slate-200 text-center align-middle sticky top-[110px] z-20 text-xs font-bold select-none transition-colors duration-150 relative ${
                          isColHovered ? '!bg-indigo-50 text-indigo-900 border-x-blue-300' : 'text-slate-800'
                        }`}
                        style={{ height: '34px', backgroundColor: isColHovered ? '#e0e7ff' : '#f8fafc' }}
                        onMouseEnter={() => isFocusHighlightEnabled && setHoveredColChildId(child.id || null)}
                        onMouseLeave={() => isFocusHighlightEnabled && setHoveredColChildId(null)}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (staffPopoverAnchor?.childId === child.id) {
                              setStaffPopoverAnchor(null);
                            } else {
                              const rect = e.currentTarget.getBoundingClientRect();
                              setStaffPopoverAnchor({
                                childId: child.id!,
                                x: rect.left + rect.width / 2,
                                y: rect.bottom + 4,
                              });
                            }
                          }}
                          className={`w-full flex items-center justify-center gap-1 py-1 px-1 rounded-md transition-colors ${
                            isEditing ? 'bg-indigo-100 ring-2 ring-indigo-500' : 'hover:bg-slate-200/60'
                          }`}
                          title={assignedStaff ? `担当スタッフ: ${assignedStaff.name} (クリックして変更)` : '担当スタッフ未設定 (クリックして設定)'}
                        >
                          {assignedStaff ? (
                            <>
                              <span 
                                className="w-2.5 h-2.5 rounded-full inline-block shrink-0 shadow-2xs" 
                                style={{ backgroundColor: assignedStaff.color }}
                              />
                              <span className="truncate max-w-[48px] text-[10px] font-bold text-slate-800">
                                {assignedStaff.name.split(' ')[0]}
                              </span>
                            </>
                          ) : (
                            <span className="text-[10px] text-slate-400 font-normal hover:text-indigo-600 flex items-center gap-0.5">
                              <span className="text-slate-300">●</span>
                              <span>未設定</span>
                            </span>
                          )}
                        </button>
                      </th>
                    );
                  })}
                </tr>

                {/* 3行目: 出席日数 */}
                <tr>
                  <th 
                    className="w-20 px-2 py-1 text-center align-middle text-[11px] font-bold text-slate-700 tracking-wider border-r border-b border-slate-200 sticky top-[144px] left-0 z-30 shadow-[2px_0_4px_-1px_rgba(0,0,0,0.06)]"
                    style={{ height: '28px', backgroundColor: '#f1f5f9' }}
                  >
                    出席日数
                  </th>
                  {childrenData.map(child => {
                    const stat = child.id ? childAttendanceStats[child.id] : null;
                    const attCount = stat?.attendanceCount ?? 0;
                    const isColHovered = isFocusHighlightEnabled && child.id === hoveredColChildId;
                    return (
                      <th 
                        key={`att-${child.id}`}
                        className={`px-2 py-0.5 border-r border-b border-slate-200 text-center align-middle sticky top-[144px] z-20 text-xs font-bold select-none transition-colors duration-150 ${
                          isColHovered ? '!bg-blue-50 text-blue-900 border-x-blue-300' : 'text-slate-800'
                        }`}
                        style={{ height: '28px', backgroundColor: isColHovered ? '#eff6ff' : '#ffffff' }}
                        title={`${child.fullName} の${monthNum}月の出席日数: ${attCount}日`}
                        onMouseEnter={() => isFocusHighlightEnabled && setHoveredColChildId(child.id || null)}
                        onMouseLeave={() => isFocusHighlightEnabled && setHoveredColChildId(null)}
                      >
                        {attCount}
                      </th>
                    );
                  })}
                </tr>

                {/* 4行目: 必要日数 */}
                <tr>
                  <th 
                    className="w-20 px-2 py-1 text-center align-middle text-[11px] font-bold text-blue-900 tracking-wider border-r border-b border-slate-200 sticky top-[172px] left-0 z-30 shadow-[2px_0_4px_-1px_rgba(0,0,0,0.06)]"
                    style={{ height: '28px', backgroundColor: '#dbeafe' }}
                  >
                    必要日数
                  </th>
                  {childrenData.map(child => {
                    const stat = child.id ? childAttendanceStats[child.id] : null;
                    const reqDays = stat?.requiredDays ?? 0;
                    const isHoukago = stat?.isHoukago ?? true;
                    const attCount = stat?.attendanceCount ?? 0;
                    const isColHovered = isFocusHighlightEnabled && child.id === hoveredColChildId;
                    return (
                      <th 
                        key={`req-${child.id}`}
                        className={`px-2 py-0.5 border-r border-b border-slate-200 text-center align-middle sticky top-[172px] z-20 text-xs font-bold select-none transition-colors duration-150 ${
                          isColHovered ? '!bg-blue-200/80 text-blue-950 font-black' : 'text-blue-700'
                        }`}
                        style={{ height: '28px', backgroundColor: isColHovered ? '#bfdbfe' : '#eff6ff' }}
                        title={`${child.fullName} (${isHoukago ? '放課後等デイサービス' : '児童発達支援'} / 出席${attCount}日) の必要記録日数: ${reqDays}日分${stat && stat.individualCount > stat.baseRequiredDays ? ` (個別療育出席${stat.individualCount}日を優先)` : ''}`}
                        onMouseEnter={() => isFocusHighlightEnabled && setHoveredColChildId(child.id || null)}
                        onMouseLeave={() => isFocusHighlightEnabled && setHoveredColChildId(null)}
                      >
                        {reqDays}
                      </th>
                    );
                  })}
                </tr>

                {/* 5行目: 個別以外 */}
                <tr>
                  <th 
                    className="w-20 px-2 py-1 text-center align-middle text-[11px] font-bold text-emerald-900 tracking-wider border-r border-b border-slate-200 sticky top-[200px] left-0 z-30 shadow-[2px_0_4px_-1px_rgba(0,0,0,0.06)]"
                    style={{ height: '28px', backgroundColor: '#d1fae5' }}
                  >
                    個別以外
                  </th>
                  {childrenData.map(child => {
                    const stat = child.id ? childAttendanceStats[child.id] : null;
                    const nonIndCount = stat?.nonIndividualCount ?? 0;
                    const indCount = stat?.individualCount ?? 0;
                    const reqDays = stat?.requiredDays ?? 0;
                    const isColHovered = isFocusHighlightEnabled && child.id === hoveredColChildId;
                    return (
                      <th 
                        key={`non-ind-${child.id}`}
                        className={`px-2 py-0.5 border-r border-b border-slate-200 text-center align-middle sticky top-[200px] z-20 text-xs font-bold select-none transition-colors duration-150 ${
                          isColHovered ? '!bg-emerald-100/90 text-emerald-950 font-black' : 'text-emerald-800'
                        }`}
                        style={{ height: '28px', backgroundColor: isColHovered ? '#d1fae5' : '#ecfdf5' }}
                        title={`${child.fullName} の個別療育以外の必要日数: ${nonIndCount}日分 (必要日数: ${reqDays}日 − 個別出席: ${indCount}日)`}
                        onMouseEnter={() => isFocusHighlightEnabled && setHoveredColChildId(child.id || null)}
                        onMouseLeave={() => isFocusHighlightEnabled && setHoveredColChildId(null)}
                      >
                        {nonIndCount}
                      </th>
                    );
                  })}
                </tr>

                {/* 6行目: 採用選択 */}
                <tr>
                  <th 
                    className="w-20 px-2 py-1 text-center align-middle text-[11px] font-bold text-amber-900 tracking-wider border-r border-b border-slate-200 sticky top-[228px] left-0 z-30 shadow-[2px_2px_4px_-1px_rgba(0,0,0,0.06)]"
                    style={{ height: '30px', backgroundColor: '#fef3c7' }}
                  >
                    <div className="flex items-center justify-center gap-1">
                      <span>採用選択</span>
                    </div>
                  </th>
                  {childrenData.map(child => {
                    const stat = child.id ? childAttendanceStats[child.id] : null;
                    const targetCount = Math.min(6, stat?.requiredDays ?? 0);
                    const selectedCount = (child.id && selectedDaysMap[child.id]) 
                      ? Array.from(selectedDaysMap[child.id]).filter(day => {
                          const dateKey = `${monthNum}月${day}日`;
                          const att = mergedData.attendance[child.id!]?.[dateKey];
                          return !!(att && att.officeId === selectedOfficeId && !att.isAbsent && !att.isWaitlist);
                        }).length
                      : 0;
                    const isMatch = targetCount > 0 && selectedCount === targetCount;
                    const isOver = selectedCount > targetCount;
                    const isColHovered = isFocusHighlightEnabled && child.id === hoveredColChildId;

                    return (
                      <th 
                        key={`adp-count-${child.id}`}
                        className={`px-1 py-0.5 border-r border-b border-slate-200 text-center align-middle sticky top-[228px] z-20 text-xs font-bold select-none shadow-[0_2px_4px_-1px_rgba(0,0,0,0.06)] transition-colors duration-150 ${
                          isColHovered ? '!bg-amber-100/90 ring-1 ring-amber-300' : ''
                        }`}
                        style={{ height: '30px', backgroundColor: isColHovered ? '#fef3c7' : (isSelectionMode ? '#fffbeb' : '#ffffff') }}
                        title={`${child.fullName} の正式採用選択数: ${selectedCount}日 / 目標: ${targetCount}日 (最大6日)`}
                        onMouseEnter={() => isFocusHighlightEnabled && setHoveredColChildId(child.id || null)}
                        onMouseLeave={() => isFocusHighlightEnabled && setHoveredColChildId(null)}
                      >
                        <div className="flex items-center justify-center">
                          <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold transition-colors ${
                            isMatch 
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' 
                              : isOver 
                                ? 'bg-rose-100 text-rose-800 border border-rose-300'
                                : selectedCount > 0 
                                  ? 'bg-blue-100 text-blue-800 border border-blue-200'
                                  : 'text-slate-400 font-normal'
                          }`}>
                            {isMatch && '✓ '}
                            {selectedCount}/{targetCount}
                          </span>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {daysArray.map(day => {
                  const { dayStr, className: dayColorClass } = getDayOfWeekDetails(day);
                  const dObj = new Date(year, month - 1, day);
                  const dayOfWeek = dObj.getDay();
                  const isHoliday = summarySettings.holidayDaysOfWeek.includes(dayOfWeek);
                  const isIndividual = summarySettings.individualDaysOfWeek.includes(dayOfWeek);
                  const isRowHovered = isFocusHighlightEnabled && day === hoveredRowDay;

                  let cellStyle: React.CSSProperties | undefined = undefined;
                  if (isHoliday) {
                    cellStyle = { backgroundColor: summarySettings.holidayColor };
                  } else if (isIndividual) {
                    cellStyle = { backgroundColor: summarySettings.individualColor };
                  }

                  return (
                    <tr key={day} className="transition-colors">
                      {/* 左端の日付セル (横スクロール固定: z-10、ホバー時点灯) */}
                      <td 
                        className={`px-3 py-2 border-r border-b border-slate-200 font-semibold text-xs text-center sticky left-0 z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.06)] transition-all duration-150 ${dayColorClass} ${
                          isRowHovered 
                            ? '!bg-blue-100/95 text-blue-950 font-black shadow-[2px_0_8px_-1px_rgba(37,99,235,0.3)] ring-1 ring-inset ring-blue-300' 
                            : 'bg-white'
                        }`}
                        style={!isRowHovered && (isHoliday ? { backgroundColor: summarySettings.holidayColor } : isIndividual ? { backgroundColor: summarySettings.individualColor } : undefined) || undefined}
                        onMouseEnter={() => isFocusHighlightEnabled && setHoveredRowDay(day)}
                        onMouseLeave={() => isFocusHighlightEnabled && setHoveredRowDay(null)}
                      >
                        {day}日 ({dayStr})
                      </td>
                      
                      {/* 児童ごとのステータスセル */}
                      {childrenData.map(child => {
                        if (!child.id) return <td key={Math.random()} className="p-0 border-r border-b border-slate-200 text-center relative z-0" />;
                        const cellInfo = getCellDetails(child.id, day);
                        // 出席予定日のみ採用選択可能（非出席・欠席日に採用マークが出るのを完全に防止）
                        const isSelected = cellInfo.isAttending && (selectedDaysMap[child.id]?.has(day) ?? false);
                        const isColHovered = isFocusHighlightEnabled && child.id === hoveredColChildId;
                        const isCellHovered = isColHovered && isRowHovered;

                        return (
                          <td 
                            key={child.id}
                            className={`p-0 border-r border-b border-slate-200 text-center relative ${
                              isCellHovered ? 'z-20' : isColHovered ? 'z-10' : 'z-0'
                            } ${
                              isSelectionMode && cellInfo.isAttending ? 'cursor-pointer select-none' : ''
                            }`}
                            onClick={isSelectionMode && cellInfo.isAttending ? () => toggleDaySelection(child.id!, day) : undefined}
                            onMouseEnter={(e) => handleCellMouseEnter(e, child, day)}
                            onMouseLeave={handleCellMouseLeave}
                          >
                            {/* 列・行・セルのホバーハイライトオーバーレイ（フォーカスON時のみ表示） */}
                            {isFocusHighlightEnabled && isCellHovered ? (
                              <div className="absolute inset-0 pointer-events-none bg-blue-500/[0.14] ring-2 ring-inset ring-blue-500 shadow-xs z-20" />
                            ) : isFocusHighlightEnabled && isColHovered ? (
                              <div className="absolute inset-0 pointer-events-none bg-blue-500/[0.07] border-x border-blue-400/30 z-10" />
                            ) : isFocusHighlightEnabled && isRowHovered ? (
                              <div className="absolute inset-0 pointer-events-none bg-blue-500/[0.04] z-10" />
                            ) : null}

                            {isSelectionMode ? (
                              <div
                                className={`w-full h-10 flex items-center justify-center text-sm transition-all duration-150 relative ${cellInfo.className} ${
                                  isSelected 
                                    ? '!bg-emerald-100/90 ring-2 ring-inset ring-emerald-600 font-extrabold text-emerald-950 shadow-inner' 
                                    : cellInfo.isReportArchived 
                                      ? 'opacity-40 bg-slate-100 hover:opacity-75' 
                                      : 'hover:bg-slate-100/70'
                                }`}
                                style={!isSelected ? cellStyle : undefined}
                              >
                                {cellInfo.content}
                                {isSelected && (
                                  <span className="absolute top-0.5 right-0.5 w-3.5 h-3.5 bg-emerald-600 text-white rounded-full flex items-center justify-center text-[9px] font-bold shadow-xs">
                                    ✓
                                  </span>
                                )}
                              </div>
                            ) : cellInfo.isAttending ? (
                              <Link
                                to={`/children/${child.id}/support-plan/${currentMonth}`}
                                className={`w-full h-10 flex items-center justify-center text-sm transition-all duration-150 relative ${cellInfo.className} ${
                                  cellInfo.isAdopted
                                    ? 'ring-2 ring-inset ring-emerald-600 bg-emerald-50/40 text-emerald-950 font-bold'
                                    : cellInfo.isReportArchived 
                                      ? 'opacity-40 bg-slate-100' 
                                      : ''
                                }`}
                                style={!cellInfo.isAdopted ? cellStyle : undefined}
                              >
                                {cellInfo.content}
                                {cellInfo.isAdopted && (
                                  <span 
                                    className="absolute top-0.5 right-0.5 w-3 h-3 bg-emerald-600 text-white rounded-full flex items-center justify-center text-[8px] font-black shadow-2xs z-10" 
                                    title="専門的支援に正式採用済み"
                                  >
                                    ✓
                                  </span>
                                )}
                              </Link>
                            ) : (
                              <div
                                className={`w-full h-10 flex items-center justify-center text-sm cursor-default select-none relative ${cellInfo.className} ${
                                  cellInfo.isReportArchived 
                                    ? 'opacity-40 bg-slate-100' 
                                    : ''
                                }`}
                                style={cellStyle}
                              >
                                {cellInfo.content}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 担当スタッフ変更ポップオーバー（createPortalにより最前面 z-[9999] に表示） */}
      {staffPopoverAnchor && createPortal(
        <>
          {/* 背景クリックで閉じる透明オーバーレイ */}
          <div 
            className="fixed inset-0 z-[9998] cursor-default bg-black/5" 
            onClick={(e) => {
              e.stopPropagation();
              setStaffPopoverAnchor(null);
            }} 
          />
          <div 
            className="fixed z-[9999] bg-white rounded-xl shadow-2xl border border-slate-250 p-2.5 min-w-[170px] max-w-[240px] text-left animate-in fade-in zoom-in-95 duration-100 ring-1 ring-slate-900/10"
            style={{
              left: `${Math.min(window.innerWidth - 185, Math.max(12, staffPopoverAnchor.x - 85))}px`,
              top: `${Math.min(window.innerHeight - 280, staffPopoverAnchor.y)}px`,
            }}
          >
            <div className="text-[11px] font-bold text-slate-700 px-2 py-1 border-b border-slate-100 mb-1.5 flex items-center justify-between">
              <span>担当スタッフ変更</span>
              <button
                type="button"
                onClick={() => {
                  setStaffPopoverAnchor(null);
                }}
                className="text-slate-400 hover:text-slate-600 p-0.5 rounded hover:bg-slate-100"
              >
                <X size={13} />
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                updateStaffAssignment(staffPopoverAnchor.childId, null);
                setStaffPopoverAnchor(null);
              }}
              className="w-full text-left px-2 py-1.5 text-xs text-rose-600 hover:bg-rose-50 rounded-lg flex items-center gap-1.5 transition-colors mb-1 font-medium"
            >
              <span>✕</span>
              <span>未割当に戻す</span>
            </button>
            <div className="max-h-56 overflow-y-auto space-y-0.5 pr-0.5">
              {staffList.map(st => {
                const isSelected = assignedStaffMap[staffPopoverAnchor.childId] === st.id;
                return (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => {
                      updateStaffAssignment(staffPopoverAnchor.childId, st.id);
                      setStaffPopoverAnchor(null);
                    }}
                    className={`w-full text-left px-2 py-1.5 text-xs hover:bg-slate-100/80 rounded-lg flex items-center gap-2 transition-colors ${
                      isSelected ? 'bg-indigo-50 text-indigo-900 font-bold border border-indigo-200/60' : 'text-slate-700'
                    }`}
                  >
                    <span 
                      className="w-2.5 h-2.5 rounded-full shrink-0 shadow-2xs" 
                      style={{ backgroundColor: st.color }} 
                    />
                    <span className="truncate flex-1">{st.name}</span>
                    {isSelected && <span className="text-indigo-600 text-[11px] font-extrabold ml-1">✓</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </>,
        document.body
      )}

      {/* ホバー時の専門的支援実施計画プレビュー（日数表の手前に最前面表示・createPortal・z-[9999]） */}
      {hoveredCellPreview && createPortal(
        <div 
          className="fixed z-[9999] pointer-events-none transition-all duration-150 animate-in fade-in zoom-in-95 duration-100"
          style={{
            left: `${hoveredCellPreview.x}px`,
            top: `${hoveredCellPreview.y}px`,
            width: '660px',
            maxWidth: 'calc(100vw - 32px)',
          }}
        >
          <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl border border-slate-250 overflow-hidden text-xs text-slate-700 ring-1 ring-slate-900/10">
            {/* ヘッダー情報 */}
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200/80 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="font-bold text-sm text-slate-800 tracking-wide">
                  {hoveredCellPreview.childName}
                </span>
                <span className="px-2 py-0.5 rounded-full bg-slate-200/80 text-slate-700 text-[11px] font-bold">
                  {hoveredCellPreview.dateStr} ({hoveredCellPreview.dayOfWeekStr})
                </span>
                {hoveredCellPreview.assignedStaffName && (
                  <span className="px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-200/80 text-indigo-900 text-[10px] font-bold flex items-center gap-1">
                    {hoveredCellPreview.assignedStaffColor && (
                      <span 
                        className="w-2 h-2 rounded-full inline-block shrink-0 shadow-2xs" 
                        style={{ backgroundColor: hoveredCellPreview.assignedStaffColor }}
                      />
                    )}
                    <span>担当: {hoveredCellPreview.assignedStaffName}</span>
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {hoveredCellPreview.isAdopted ? (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 text-[10px] font-bold flex items-center gap-1 shadow-2xs">
                    ✓ 正式採用
                  </span>
                ) : hoveredCellPreview.isReportArchived ? (
                  <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-300 text-[10px] font-bold shadow-2xs">
                    アーカイブ
                  </span>
                ) : null}
                {hoveredCellPreview.isAttending && (
                  <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-semibold">
                    {hoveredCellPreview.attInfoStr}
                  </span>
                )}
              </div>
            </div>

            {/* 専門的支援計画の各項目（療育内容・結果・今後の予定 を3列横並び） */}
            <div className="grid grid-cols-12 divide-x divide-slate-200 items-stretch min-h-[130px]">
              {/* 1. 療育内容 (幅4/12) */}
              <div className="col-span-4 p-3 bg-slate-50/50 flex flex-col justify-between">
                <div>
                  <div className="text-[10px] font-extrabold text-slate-700 mb-1.5 flex items-center justify-between">
                    <span>療育内容</span>
                  </div>
                  {hoveredCellPreview.supportContent && hoveredCellPreview.supportContent.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {hoveredCellPreview.supportContent.map((item, idx) => (
                        <span 
                          key={idx}
                          className="px-2 py-0.5 bg-blue-50 text-blue-800 border border-blue-200/80 rounded text-[11px] font-medium shadow-2xs"
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-slate-400 italic text-[11px]">（未選択）</span>
                  )}
                </div>
                <div className="pt-2 border-t border-slate-200/60 mt-2 space-y-0.5">
                  {hoveredCellPreview.assignedStaffName ? (
                    <div className="text-[10px] text-slate-600 flex items-center gap-1">
                      <span className="text-slate-400">担当:</span>
                      {hoveredCellPreview.assignedStaffColor && (
                        <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ backgroundColor: hoveredCellPreview.assignedStaffColor }} />
                      )}
                      <span className="font-bold text-slate-800">{hoveredCellPreview.assignedStaffName}</span>
                    </div>
                  ) : hoveredCellPreview.staffName ? (
                    <div className="text-[10px] text-slate-500">
                      担当: <span className="font-semibold text-slate-700">{hoveredCellPreview.staffName}</span>
                    </div>
                  ) : null}
                  {hoveredCellPreview.reportStaffName && hoveredCellPreview.reportStaffName !== hoveredCellPreview.assignedStaffName && (
                    <div className="text-[9px] text-slate-400">
                      記録作成: {hoveredCellPreview.reportStaffName}
                    </div>
                  )}
                </div>
              </div>

              {/* 2. 療育を行った結果 (幅5/12) */}
              <div className="col-span-5 p-3 flex flex-col">
                <div className="text-[10px] font-extrabold text-emerald-800 mb-1.5 flex items-center gap-1">
                  <span>療育を行った結果</span>
                </div>
                {hoveredCellPreview.resultInfo?.trim() ? (
                  <div className="text-slate-800 text-[11px] leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto font-normal bg-emerald-50/20 p-2 rounded-lg border border-emerald-100/70">
                    {hoveredCellPreview.resultInfo}
                  </div>
                ) : (
                  <span className="text-slate-400 italic text-[11px]">（未記入）</span>
                )}
              </div>

              {/* 3. 今後の予定 (幅3/12) */}
              <div className="col-span-3 p-3 bg-slate-50/30 flex flex-col">
                <div className="text-[10px] font-extrabold text-cyan-800 mb-1.5 flex items-center gap-1">
                  <span>今後の予定</span>
                </div>
                {hoveredCellPreview.futurePlan?.trim() ? (
                  <div className="text-slate-800 text-[11px] leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto font-normal bg-cyan-50/20 p-2 rounded-lg border border-cyan-100/70">
                    {hoveredCellPreview.futurePlan}
                  </div>
                ) : (
                  <span className="text-slate-400 italic text-[11px]">（未記入）</span>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 必要日数均等分配モーダル */}
      {isDistributeModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
            {/* モーダルヘッダー */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-blue-50 to-indigo-50">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-xs">
                  <Users size={18} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-800">個別以外の日数の担当スタッフ分配</h3>
                  <p className="text-xs text-slate-500">児童単位の不可分ルールを厳守し、均等に分配します</p>
                </div>
              </div>
              <button 
                onClick={() => setIsDistributeModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/50"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto">
              {/* 不可分ルールの説明バナー */}
              <div className="p-3 bg-blue-50/70 border border-blue-200/80 rounded-xl text-xs text-blue-900 space-y-1">
                <div className="font-bold flex items-center gap-1.5 text-blue-950">
                  <Info size={14} className="text-blue-600 shrink-0" />
                  【分配ルール】児童単位の不可分（分割不可）
                </div>
                <p className="leading-relaxed text-[11px] text-blue-800">
                  各児童の「個別以外の日数」は1人の担当スタッフに丸ごと割り当てられます（1人の児童を複数スタッフで分割することはありません）。その上で、チェックされたスタッフ間で担当合計日数の差が最小になるよう均等分配します。
                </p>
              </div>

              {/* オプション: 表の並び順で近接児童をまとめる */}
              <div className="p-3 bg-indigo-50/50 border border-indigo-200/70 rounded-xl">
                <label className="flex items-start gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={groupAdjacentColumns}
                    onChange={(e) => setGroupAdjacentColumns(e.target.checked)}
                    className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer mt-0.5"
                  />
                  <div className="text-xs">
                    <span className="font-bold text-indigo-950">表の並び順（列）で近くの児童をなるべくまとめる（オプション）</span>
                    <p className="text-[11px] text-indigo-800/80 mt-0.5 leading-relaxed">
                      スタッフごとの担当児童が表上で飛び飛びの列にならず、近い児童同士が隣り合って固まるように分配します。
                    </p>
                  </div>
                </label>
              </div>

              {/* スタッフ選択セクション */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-700">
                    分配対象スタッフの選択 ({selectedStaffForDist.size}/{staffList.length}名)
                  </span>
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setSelectedStaffForDist(new Set(staffList.map(s => s.id)))}
                      className="text-primary hover:underline font-semibold"
                    >
                      全員選択
                    </button>
                    <span className="text-slate-300">|</span>
                    <button
                      type="button"
                      onClick={() => setSelectedStaffForDist(new Set())}
                      className="text-slate-500 hover:underline"
                    >
                      全解除
                    </button>
                  </div>
                </div>

                {staffList.length === 0 ? (
                  <p className="text-xs text-slate-400 p-4 text-center border border-dashed rounded-xl">
                    所属スタッフが見つかりません。
                  </p>
                ) : (
                  <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                    {staffList.map(st => {
                      const isChecked = selectedStaffForDist.has(st.id);
                      const assignedChildren = childrenData.filter(c => c.id && assignedStaffMap[c.id] === st.id);
                      const currentDays = assignedChildren.reduce((sum, c) => sum + (c.id ? (childAttendanceStats[c.id]?.nonIndividualCount ?? 0) : 0), 0);

                      return (
                        <label
                          key={st.id}
                          className={`flex items-center justify-between p-2.5 rounded-xl border transition-all cursor-pointer ${
                            isChecked 
                              ? 'bg-blue-50/40 border-blue-300 text-slate-800' 
                              : 'bg-slate-50/50 border-slate-200 text-slate-400 hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                const next = new Set(selectedStaffForDist);
                                if (e.target.checked) next.add(st.id);
                                else next.delete(st.id);
                                setSelectedStaffForDist(next);
                              }}
                              className="rounded text-primary focus:ring-primary w-4 h-4 cursor-pointer"
                            />
                            <span className="w-3 h-3 rounded-full shrink-0 shadow-2xs" style={{ backgroundColor: st.color }} />
                            <span className="text-xs font-bold text-slate-800">{st.name}</span>
                          </div>

                          <div className="text-[11px] text-slate-500">
                            現在: <span className="font-semibold text-slate-700">{assignedChildren.length}名</span> (個別以外: {currentDays}日分)
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 当月の必要日数サマリー */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-xs">
                <span className="text-slate-600">当月の個別以外の総必要日数（分配対象）</span>
                <span className="font-bold text-sm text-slate-800">
                  {childrenData.reduce((sum, c) => sum + (c.id ? (childAttendanceStats[c.id]?.nonIndividualCount ?? 0) : 0), 0)} 日分
                  <span className="text-[11px] font-normal text-slate-500 ml-1.5">
                    ({childrenData.filter(c => c.id && (childAttendanceStats[c.id]?.nonIndividualCount ?? 0) > 0).length}名)
                  </span>
                </span>
              </div>
            </div>

            {/* モーダルフッター */}
            <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setIsDistributeModalOpen(false)}
                className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 hover:bg-white transition-colors"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleDistributeRequiredDays}
                disabled={selectedStaffForDist.size === 0 || isSavingStaffAssignments}
                className="flex items-center gap-1.5 px-5 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all hover:shadow active:scale-95 disabled:opacity-50"
              >
                {isSavingStaffAssignments ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Users size={14} />
                )}
                <span>均等に分配を実行</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 設定モーダル */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* モーダルヘッダー */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <SettingsIcon size={20} className="text-primary" />
                カレンダー表示の共通設定
              </h3>
              <button 
                onClick={() => setIsSettingsOpen(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors p-1 hover:bg-slate-100 rounded-lg"
              >
                <X size={20} />
              </button>
            </div>

            {/* モーダルコンテンツ */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* 休みの日設定 */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-slate-700 text-sm flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span>
                    休みの日 (非稼働日)
                  </h4>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-500">表示色:</span>
                    <div className="flex items-center gap-1.5">
                      {[
                        { name: 'ローズ', value: '#ffe4e6', class: 'bg-rose-100 border-rose-300' },
                        { name: 'グレー', value: '#f1f5f9', class: 'bg-slate-100 border-slate-300' },
                        { name: 'オレンジ', value: '#ffedd5', class: 'bg-amber-100 border-amber-300' },
                        { name: '赤', value: '#fee2e2', class: 'bg-red-100 border-red-300' },
                      ].map(c => (
                        <button
                          key={c.value}
                          type="button"
                          onClick={() => setTempSettings(prev => ({ ...prev, holidayColor: c.value }))}
                          className={`w-6 h-6 rounded-full border-2 transition-all ${c.class} ${tempSettings.holidayColor === c.value ? 'ring-2 ring-primary ring-offset-1 scale-110' : 'hover:scale-105'}`}
                          title={c.name}
                        />
                      ))}
                      <input
                        type="color"
                        value={tempSettings.holidayColor}
                        onChange={(e) => setTempSettings(prev => ({ ...prev, holidayColor: e.target.value }))}
                        className="w-6 h-6 rounded-full border border-slate-300 cursor-pointer overflow-hidden p-0"
                        title="カスタムカラー"
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <div className="grid grid-cols-7 gap-2 text-center">
                    {['日', '月', '火', '水', '木', '金', '土'].map((d, index) => {
                      const isChecked = tempSettings.holidayDaysOfWeek.includes(index);
                      const isSun = index === 0;
                      const isSat = index === 6;
                      
                      return (
                        <button
                          key={`holiday-dow-${index}`}
                          type="button"
                          onClick={() => {
                            setTempSettings(prev => {
                              const holidayDaysOfWeek = prev.holidayDaysOfWeek.includes(index)
                                ? prev.holidayDaysOfWeek.filter(x => x !== index)
                                : [...prev.holidayDaysOfWeek, index].sort();
                              return { ...prev, holidayDaysOfWeek };
                            });
                          }}
                          className={`py-3 px-1 text-sm font-bold rounded-xl border transition-all flex flex-col items-center justify-center gap-1
                            ${isChecked 
                              ? 'bg-rose-500 text-white border-rose-500 shadow-sm scale-105' 
                              : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'}`}
                        >
                          <span className="text-base">{d}曜日</span>
                          <span className={`text-[10px] ${isChecked ? 'text-rose-100' : isSun ? 'text-red-500' : isSat ? 'text-blue-500' : 'text-slate-400'}`}>
                            毎週
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <hr className="border-slate-100" />

              {/* 個別療育の日設定 */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-slate-700 text-sm flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                    個別療育の日
                  </h4>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-500">表示色:</span>
                    <div className="flex items-center gap-1.5">
                      {[
                        { name: 'スカイブルー', value: '#e0f2fe', class: 'bg-sky-100 border-sky-300' },
                        { name: 'パープル', value: '#f3e8ff', class: 'bg-purple-100 border-purple-300' },
                        { name: 'グリーン', value: '#dcfce7', class: 'bg-green-100 border-green-300' },
                        { name: 'イエロー', value: '#fef9c3', class: 'bg-yellow-100 border-yellow-300' },
                      ].map(c => (
                        <button
                          key={c.value}
                          type="button"
                          onClick={() => setTempSettings(prev => ({ ...prev, individualColor: c.value }))}
                          className={`w-6 h-6 rounded-full border-2 transition-all ${c.class} ${tempSettings.individualColor === c.value ? 'ring-2 ring-primary ring-offset-1 scale-110' : 'hover:scale-105'}`}
                          title={c.name}
                        />
                      ))}
                      <input
                        type="color"
                        value={tempSettings.individualColor}
                        onChange={(e) => setTempSettings(prev => ({ ...prev, individualColor: e.target.value }))}
                        className="w-6 h-6 rounded-full border border-slate-300 cursor-pointer overflow-hidden p-0"
                        title="カスタムカラー"
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <div className="grid grid-cols-7 gap-2 text-center">
                    {['日', '月', '火', '水', '木', '金', '土'].map((d, index) => {
                      const isChecked = tempSettings.individualDaysOfWeek.includes(index);
                      const isSun = index === 0;
                      const isSat = index === 6;
                      
                      return (
                        <button
                          key={`individual-dow-${index}`}
                          type="button"
                          onClick={() => {
                            setTempSettings(prev => {
                              const individualDaysOfWeek = prev.individualDaysOfWeek.includes(index)
                                ? prev.individualDaysOfWeek.filter(x => x !== index)
                                : [...prev.individualDaysOfWeek, index].sort();
                              return { ...prev, individualDaysOfWeek };
                            });
                          }}
                          className={`py-3 px-1 text-sm font-bold rounded-xl border transition-all flex flex-col items-center justify-center gap-1
                            ${isChecked 
                              ? 'bg-blue-500 text-white border-blue-500 shadow-sm scale-105' 
                              : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'}`}
                        >
                          <span className="text-base">{d}曜日</span>
                          <span className={`text-[10px] ${isChecked ? 'text-blue-100' : isSun ? 'text-red-500' : isSat ? 'text-blue-500' : 'text-slate-400'}`}>
                            毎週
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* モーダルフッター */}
            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-3 bg-slate-50 shrink-0">
              <button
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                className="px-4 py-2 hover:bg-slate-200 text-slate-600 rounded-xl text-sm font-semibold transition-all"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleSaveSettings}
                disabled={isSavingSettings}
                className="px-5 py-2 bg-primary hover:bg-primary/90 text-white rounded-xl text-sm font-bold shadow-sm hover:shadow-md transition-all flex items-center gap-1.5 disabled:opacity-50"
              >
                {isSavingSettings ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    <span>保存中...</span>
                  </>
                ) : (
                  <>
                    <Check size={16} />
                    <span>設定を保存</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Gemini一括登録モーダル */}
      <MonthlyResultImportModal
        isOpen={isResultImportOpen}
        onClose={() => setIsResultImportOpen(false)}
        monthStr={currentMonth}
        childrenData={childrenData}
        existingReports={mergedData.dailyReports}
        onImport={handleImportAllResults}
      />
    </div>
  );
};
