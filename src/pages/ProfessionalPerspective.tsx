import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, Plus, Trash2, Save, Printer, Download, CheckCircle2, UploadCloud, Archive } from 'lucide-react';
import {
  doc, getDoc, setDoc, updateDoc, serverTimestamp, collection, query, where, getDocs, writeBatch
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Child } from '../data/mockData';
import type { ProfessionalPlanDoc, SupportRow, SupportCategory, ServiceHoursPlan, DaySchedule } from '../types/professionalPlan';
import { FIVE_AREAS } from '../types/professionalPlan';
import { exportProfessionalPlan } from '../lib/excelExport';
import { FloatingActionMenu, type Action } from '../components/FloatingActionMenu';
import { ProfessionalPlanImportModal } from '../components/ProfessionalPlanImportModal';
import { ProfessionalPlanPrintAll } from '../components/ProfessionalPlanPrintAll';

const PLAN_COL = 'professionalPlans';
const HOURS_PLAN_COL = 'serviceHoursPlans';

const PROVIDER_DEFAULT = 'TreeKidsSchool\nSearch';

const defaultRows = (): SupportRow[] => [
  {
    id: crypto.randomUUID(),
    category: '本人支援',
    supportGoal: '',
    supportContent: '',
    fiveAreas: ['認知・行動', '言語・コミュニケーション', '人間関係・社会性'],
    achievementPeriod: '6ヶ月',
    provider: PROVIDER_DEFAULT,
    notes: '',
    priority: '1',
  },
  {
    id: crypto.randomUUID(),
    category: '本人支援',
    supportGoal: '',
    supportContent: '',
    fiveAreas: ['人間関係・社会性'],
    achievementPeriod: '6ヶ月',
    provider: PROVIDER_DEFAULT,
    notes: '',
    priority: '2',
  },
  {
    id: crypto.randomUUID(),
    category: '本人支援',
    supportGoal: '',
    supportContent: '',
    fiveAreas: ['機能・運動', '認知・行動', '健康・生活'],
    achievementPeriod: '6ヶ月',
    provider: PROVIDER_DEFAULT,
    notes: '',
    priority: '3',
  },
  {
    id: crypto.randomUUID(),
    category: '家族支援',
    supportGoal: '',
    supportContent: '',
    fiveAreas: [],
    achievementPeriod: '随時',
    provider: PROVIDER_DEFAULT,
    notes: '',
    priority: '随時',
  },
  {
    id: crypto.randomUUID(),
    category: '移行支援',
    supportGoal: '',
    supportContent: '',
    fiveAreas: [],
    achievementPeriod: '随時',
    provider: 'TreeKidsSchool',
    notes: '',
    priority: '随時',
  },
];

const defaultPlan = (childId: string): ProfessionalPlanDoc => ({
  childId,
  createdAt: new Date().toISOString().slice(0, 10),
  familyIntention: '',
  overallPolicy: '',
  longTermGoal: '',
  shortTermGoal: '',
  serviceHours: '',
  supportRows: defaultRows(),
  confirmation:
    '・支援する上で必要な情報を関係機関（学校、相談支援員、行政機関、他の事業所等）と共有する事もある。また、家庭支援加算を算定させていただきます。',
  managerName: '',
  signDate: new Date().toISOString().slice(0, 10),
  guardianName: '',
});

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

const defaultWeeklyHours = () => {
  const hours: Record<string, DaySchedule> = {};
  ['月', '火', '水', '木', '金', '土', '日'].forEach(d => {
    hours[d] = defaultDaySchedule();
  });
  return hours;
};

const defaultHoursPlan = (childId: string, startMonth: string): ServiceHoursPlan => ({
  childId,
  startMonth,
  createdAt: new Date().toISOString().slice(0, 10),
  weeklyHours: defaultWeeklyHours(),
  extReason: '',
  notes: ''
});

type Props = { 
  childrenData: Child[];
  selectedOfficeId: string;
  offices: { id: string; name: string }[];
  onReload?: () => void;
};

// ---- 5領域チェックボックス ----
const FiveAreaCheckboxes: React.FC<{
  selected: string[];
  onChange: (areas: string[]) => void;
  readOnly?: boolean;
}> = ({ selected, onChange, readOnly }) => (
  <div className="flex flex-col gap-0.5 text-[10px]">
    {FIVE_AREAS.map((area) => (
      <label key={area} className="flex items-center gap-1 cursor-pointer">
        <input
          type="checkbox"
          className="w-3 h-3 accent-green-600"
          checked={selected.includes(area)}
          disabled={readOnly}
          onChange={(e) => {
            if (e.target.checked) onChange([...selected, area]);
            else onChange(selected.filter((a) => a !== area));
          }}
        />
        <span className="leading-tight">{area}</span>
      </label>
    ))}
  </div>
);

// ---- 編集可能セル ----
const EditCell: React.FC<{
  value: string;
  onChange: (v: string) => void;
  className?: string;
  rows?: number;
}> = ({ value, onChange, className = '', rows = 3 }) => {
  const handleWheel = (e: React.WheelEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight <= el.clientHeight) {
      const container = el.closest('.overflow-y-auto');
      if (container) {
        container.scrollTop += e.deltaY;
      }
    }
  };

  return (
    <textarea
      rows={rows}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full resize-none outline-none bg-transparent text-[12px] leading-relaxed ${className}`}
      style={{ touchAction: 'pan-y' }}
      onWheel={handleWheel}
    />
  );
};

// ---- 主コンポーネント ----
export const ProfessionalPerspective: React.FC<Props> = ({ childrenData, selectedOfficeId, offices, onReload }) => {
  const currentOffice = offices.find(o => o.id === selectedOfficeId);
  const officeName = currentOffice ? currentOffice.name : 'Search';
  const { childId } = useParams<{ childId: string }>();
  const navigate = useNavigate();

  // textareaの上でスクロール（ホイール）したときに、親のメインコンテナをスクロールさせるヘルパー
  const handleWheel = (e: React.WheelEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight <= el.clientHeight) {
      const container = el.closest('.overflow-y-auto');
      if (container) {
        container.scrollTop += e.deltaY;
      }
    }
  };

  const [currentMonth, setCurrentMonth] = useState(new Date().toISOString().slice(0, 7));
  const [activeTab, setActiveTab] = useState<'final' | 'draft' | 'hours'>('final');
  const [plan, setPlan] = useState<ProfessionalPlanDoc | null>(null);
  const [hoursPlan, setHoursPlan] = useState<ServiceHoursPlan | null>(null);
  const [printAllData, setPrintAllData] = useState<{
    draftPlan: ProfessionalPlanDoc;
    finalPlan: ProfessionalPlanDoc;
    hoursPlan: ServiceHoursPlan;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [monthlySettings, setMonthlySettings] = useState<any>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);

  // 6ヶ月更新・年単位切り替え用の状態
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [showArchived, setShowArchived] = useState<boolean>(false);
  const [periodArchiveMap, setPeriodArchiveMap] = useState<Record<string, boolean>>({});

  const selectedChild = childId ? childrenData.find((c) => c.id === childId) : null;

  // ---- 存在する更新期の月リストを取得 ----
  const fetchAvailableMonths = useCallback(async () => {
    if (!childId) return;
    try {
      const monthsSet = new Set<string>();
      const archiveMap: Record<string, boolean> = {};

      // 計画書から取得
      const qPlan = query(
        collection(db, PLAN_COL), 
        where('childId', '==', childId),
        where('officeId', '==', selectedOfficeId)
      );
      const snapPlan = await getDocs(qPlan);
      snapPlan.forEach(d => {
        const data = d.data() as ProfessionalPlanDoc & { archived?: boolean };
        const month = data.startMonth || data.createdAt?.slice(0, 7);
        if (month && /^\d{4}-\d{2}$/.test(month)) {
          monthsSet.add(month);
          if (data.archived === true) {
            archiveMap[month] = true;
          }
        }
      });

      // 利用時間から取得
      const qHours = query(
        collection(db, HOURS_PLAN_COL), 
        where('childId', '==', childId),
        where('officeId', '==', selectedOfficeId)
      );
      const snapHours = await getDocs(qHours);
      snapHours.forEach(d => {
        const data = d.data() as ServiceHoursPlan & { archived?: boolean };
        const month = data.startMonth;
        if (month && /^\d{4}-\d{2}$/.test(month)) {
          monthsSet.add(month);
          if (data.archived === true) {
            archiveMap[month] = true;
          }
        }
      });

      const sorted = Array.from(monthsSet).sort();
      setAvailableMonths(sorted);
      setPeriodArchiveMap(archiveMap);

      if (sorted.length > 0) {
        // アーカイブされていない月を優先して初期値とする
        const unarchived = sorted.filter(m => !archiveMap[m]);
        const targetList = unarchived.length > 0 ? unarchived : sorted;
        
        const current = new Date().toISOString().slice(0, 7);
        const best = targetList.filter(m => m <= current).pop() || targetList[0];
        setCurrentMonth(best);
        setSelectedYear(parseInt(best.slice(0, 4), 10));
      } else {
        const fallback = new Date().toISOString().slice(0, 7);
        setCurrentMonth(fallback);
        setSelectedYear(parseInt(fallback.slice(0, 4), 10));
      }
    } catch (e) {
      console.error('fetchAvailableMonths error:', e);
    }
  }, [childId, selectedOfficeId]);

  // ---- データ取得 ----
  const fetchData = useCallback(async () => {
    if (!childId || !currentMonth) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      if (activeTab === 'hours') {
        const q = query(
          collection(db, HOURS_PLAN_COL), 
          where('childId', '==', childId),
          where('officeId', '==', selectedOfficeId)
        );
        const snap = await getDocs(q);
        
        let matchedDoc: ServiceHoursPlan | null = null;
        snap.forEach(d => {
          const data = d.data() as ServiceHoursPlan;
          if (data.startMonth === currentMonth) {
            matchedDoc = { ...data, id: d.id };
          }
        });

        if (matchedDoc) {
          setHoursPlan(matchedDoc);
        } else {
          setHoursPlan(defaultHoursPlan(childId, currentMonth));
        }
        setPlan(null);
      } else {
        const q = query(
          collection(db, PLAN_COL), 
          where('childId', '==', childId),
          where('status', '==', activeTab),
          where('officeId', '==', selectedOfficeId)
        );
        const snap = await getDocs(q);
        
        let matchedDoc: ProfessionalPlanDoc | null = null;
        snap.forEach(d => {
          const data = d.data() as ProfessionalPlanDoc;
          const startMonth = data.startMonth || data.createdAt?.slice(0, 7);
          if (startMonth === currentMonth) {
            matchedDoc = { ...data, id: d.id };
          }
        });

        if (matchedDoc) {
          setPlan(matchedDoc);
        } else {
          const dp = defaultPlan(childId);
          dp.status = activeTab;
          dp.startMonth = currentMonth;
          setPlan(dp);
        }
        setHoursPlan(null);
      }
    } catch (e) {
      console.error('fetchData error:', e);
    } finally {
      setIsLoading(false);
    }
  }, [childId, currentMonth, activeTab, selectedOfficeId]);

  const fetchMonthlySettings = useCallback(async (dateStr: string) => {
    try {
      const month = dateStr.slice(0, 7); // YYYY-MM
      const snap = await getDoc(doc(db, 'monthlySettings', month));
      if (snap.exists()) {
        setMonthlySettings(snap.data());
      } else {
        setMonthlySettings(null);
      }
    } catch (e) {
      console.error('fetchMonthlySettings error:', e);
    }
  }, []);

  // 初回ロード時に availableMonths を取得
  useEffect(() => {
    fetchAvailableMonths();
  }, [fetchAvailableMonths]);

  useEffect(() => { 
    fetchData(); 
    fetchMonthlySettings(currentMonth);
  }, [fetchData, fetchMonthlySettings, currentMonth]);

  // showArchived の変更、または availableMonths の取得後に currentMonth を適切に切り替える
  useEffect(() => {
    if (availableMonths.length === 0) {
      const current = new Date().toISOString().slice(0, 7);
      setCurrentMonth(current);
      setSelectedYear(parseInt(current.slice(0, 4), 10));
      return;
    }

    // 現在の表示モード（アーカイブ閲覧中か否か）に一致する月だけを抽出
    const validMonths = availableMonths.filter(m => {
      const isArchived = periodArchiveMap[m] === true;
      return isArchived === showArchived;
    });

    // もし現在の currentMonth がそのリストに含まれていなければ、切り替えを行う
    if (!validMonths.includes(currentMonth)) {
      if (validMonths.length > 0) {
        // 今月以前で最新のものを優先
        const current = new Date().toISOString().slice(0, 7);
        const best = validMonths.filter(m => m <= current).pop() || validMonths[0];
        setCurrentMonth(best);
        setSelectedYear(parseInt(best.slice(0, 4), 10));
      } else {
        const fallback = new Date().toISOString().slice(0, 7);
        setCurrentMonth(fallback);
        setSelectedYear(parseInt(fallback.slice(0, 4), 10));
      }
    }
  }, [showArchived, availableMonths, periodArchiveMap]);

  // ---- アーカイブ切り替え ----
  const isCurrentPeriodArchived = periodArchiveMap[currentMonth] === true;
  const handleToggleArchive = async () => {
    if (!childId || !currentMonth) return;
    const targetStatus = !isCurrentPeriodArchived;
    const confirmMsg = targetStatus 
      ? `${currentMonth}期をアーカイブしますか？\n(通常の一覧には表示されなくなります)`
      : `${currentMonth}期のアーカイブを解除しますか？`;
    if (!window.confirm(confirmMsg)) return;

    setIsLoading(true);
    try {
      const batch = writeBatch(db);
      
      // 1. 計画書 (本案) のドキュメントID
      const finalDocId = `${childId}_${currentMonth}_final_${selectedOfficeId}`;
      batch.set(doc(db, PLAN_COL, finalDocId), {
        childId,
        startMonth: currentMonth,
        status: 'final',
        officeId: selectedOfficeId,
        archived: targetStatus,
        updatedAt: serverTimestamp()
      }, { merge: true });

      // 2. 計画書 (案) のドキュメントID
      const draftDocId = `${childId}_${currentMonth}_draft_${selectedOfficeId}`;
      batch.set(doc(db, PLAN_COL, draftDocId), {
        childId,
        startMonth: currentMonth,
        status: 'draft',
        officeId: selectedOfficeId,
        archived: targetStatus,
        updatedAt: serverTimestamp()
      }, { merge: true });

      // 3. 利用時間 のドキュメントID
      const hoursDocId = `${childId}_${currentMonth}_${selectedOfficeId}`;
      batch.set(doc(db, HOURS_PLAN_COL, hoursDocId), {
        childId,
        startMonth: currentMonth,
        officeId: selectedOfficeId,
        archived: targetStatus,
        updatedAt: serverTimestamp()
      }, { merge: true });

      await batch.commit();
      alert(targetStatus ? 'アーカイブしました。' : 'アーカイブを解除しました。');
      await fetchAvailableMonths();
      await fetchData();
      onReload?.();
    } catch (e) {
      console.error(e);
      alert('処理に失敗しました。');
    } finally {
      setIsLoading(false);
    }
  };

  // ---- 保存 ----
  const handleSave = async () => {
    if (!childId || !currentMonth) return;
    setIsSaving(true);
    try {
      if (activeTab === 'hours') {
        if (!hoursPlan) return;
        const startMonth = hoursPlan.startMonth || currentMonth;
        const docId = `${childId}_${startMonth}_${selectedOfficeId}`;
        await setDoc(doc(db, HOURS_PLAN_COL, docId), {
          ...hoursPlan,
          officeId: selectedOfficeId,
          updatedAt: serverTimestamp(),
        }, { merge: true });
      } else {
        if (!plan) return;
        const startMonth = plan.startMonth || currentMonth;
        const status = plan.status || activeTab;
        const docId = `${childId}_${startMonth}_${status}_${selectedOfficeId}`;
        await setDoc(doc(db, PLAN_COL, docId), {
          ...plan,
          officeId: selectedOfficeId,
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }
      alert('保存しました。');
      await fetchAvailableMonths();
      await fetchData();
      onReload?.();
    } catch (e) {
      alert('保存に失敗しました。');
    } finally {
      setIsSaving(false);
    }
  };

  // ---- 専門的支援実施計画へ反映 ----
  const handleReflectToImplementation = async () => {
    if (!childId || !currentMonth || !plan || activeTab !== 'final') return;
    
    // 開始年月日（createdAt）が必須
    if (!plan.createdAt) {
      alert('開始年月日を入力してください。');
      return;
    }
    
    setIsSaving(true);
    try {
      const startMonth = plan.createdAt.slice(0, 7); // YYYY-MM
      
      // 5ヶ月後を終了月とする（計6ヶ月間）
      const date = new Date(`${startMonth}-01T00:00:00`);
      date.setMonth(date.getMonth() + 5);
      const endMonth = date.toISOString().slice(0, 7);
      
      const updatedPlan: ProfessionalPlanDoc = {
        ...plan,
        isReflected: true,
        reflectedStartMonth: startMonth,
        reflectedEndMonth: endMonth,
      };
      
      // プランドキュメントを更新
      const docId = `${childId}_${plan.startMonth || currentMonth}_final_${selectedOfficeId}`;
      await setDoc(doc(db, PLAN_COL, docId), {
        ...updatedPlan,
        officeId: selectedOfficeId,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      
      // 児童のドキュメントに更新期限を記録
      const childrenRef = collection(db, 'children');
      await updateDoc(doc(childrenRef, childId), {
        currentPlanEndMonth: endMonth,
      });
      
      setPlan(updatedPlan);
      alert(`${startMonth} ～ ${endMonth} の期間で専門的支援実施計画に反映しました。`);
    } catch (e) {
      console.error(e);
      alert('反映に失敗しました。');
    } finally {
      setIsSaving(false);
    }
  };

  // 【テスト用】この児童のすべての支援計画（本案・案）・利用時間データを削除する
  const handleTestDeleteAllPlans = async () => {
    if (!childId) return;
    const confirm1 = window.confirm("【テスト用警告】\nこの児童のすべての専門的支援計画書（本案・案）および利用時間データを完全に削除しますか？\n※他事業所分のデータも含め、この児童に紐づくすべての計画書・利用時間が削除されます。");
    if (!confirm1) return;
    const confirm2 = window.confirm("本当に実行しますか？\n登録されているすべての期のデータが完全に失われ、復元できません。");
    if (!confirm2) return;

    setIsLoading(true);
    try {
      const batch = writeBatch(db);
      
      // 1. 計画書
      const qPlan = query(collection(db, PLAN_COL), where('childId', '==', childId));
      const snapPlan = await getDocs(qPlan);
      snapPlan.forEach(d => {
        batch.delete(d.ref);
      });

      // 2. 利用時間
      const qHours = query(collection(db, HOURS_PLAN_COL), where('childId', '==', childId));
      const snapHours = await getDocs(qHours);
      snapHours.forEach(d => {
        batch.delete(d.ref);
      });

      await batch.commit();
      alert("すべての計画・利用時間データを削除しました。");
      
      if (onReload) onReload();
      await fetchAvailableMonths();
      await fetchData();
    } catch (e) {
      console.error(e);
      alert("削除に失敗しました。");
    } finally {
      setIsLoading(false);
    }
  };

  // 一括インポート処理
  const handleImportComplete = async (importedPlans: ProfessionalPlanDoc[], importedHours: ServiceHoursPlan[]) => {
    if (!childId) return;

    const confirmMsg = `パースされた計画書 ${importedPlans.length} 件、利用時間 ${importedHours.length} 件を一括保存しますか？\n(既存の同期間・状態のデータは上書き更新されます)`;
    if (!window.confirm(confirmMsg)) return;

    setIsLoading(true);
    try {
      const batch = writeBatch(db);

      importedPlans.forEach(planDoc => {
        const startMonth = planDoc.startMonth || planDoc.createdAt.slice(0, 7) || currentMonth;
        const status = planDoc.status || 'final';
        const docId = `${childId}_${startMonth}_${status}_${selectedOfficeId}`;
        
        batch.set(doc(db, PLAN_COL, docId), {
          ...planDoc,
          childId,
          officeId: selectedOfficeId,
          updatedAt: serverTimestamp()
        }, { merge: true });
      });

      importedHours.forEach(hoursDoc => {
        const startMonth = hoursDoc.startMonth || currentMonth;
        const docId = `${childId}_${startMonth}_${selectedOfficeId}`;
        
        batch.set(doc(db, HOURS_PLAN_COL, docId), {
          ...hoursDoc,
          childId,
          officeId: selectedOfficeId,
          updatedAt: serverTimestamp()
        }, { merge: true });
      });

      await batch.commit();
      alert('一括インポートが正常に完了しました！');
      setIsImportOpen(false);
      
      await fetchAvailableMonths();
      await fetchData();
      onReload?.();
    } catch (e: any) {
      console.error(e);
      alert(`インポートデータの保存中にエラーが発生しました: ${e.message || String(e)}`);
    } finally {
      setIsLoading(false);
    }
  };

  // ---- plan更新ヘルパー ----
  const update = <K extends keyof ProfessionalPlanDoc>(key: K, value: ProfessionalPlanDoc[K]) =>
    setPlan((prev) => prev ? { ...prev, [key]: value } : prev);

  const updateRow = (rowId: string, patch: Partial<SupportRow>) =>
    setPlan((prev) =>
      prev
          ? { ...prev, supportRows: prev.supportRows.map((r) => r.id === rowId ? { ...r, ...patch } : r) }
          : prev
    );

  const addRow = (category: SupportCategory) =>
    setPlan((prev) =>
      prev
        ? {
            ...prev,
            supportRows: [
              ...prev.supportRows,
              {
                id: crypto.randomUUID(),
                category,
                supportGoal: '',
                supportContent: '',
                fiveAreas: [],
                achievementPeriod: '',
                provider: PROVIDER_DEFAULT,
                notes: '',
                priority: '',
              },
            ],
          }
        : prev
    );

  const removeRow = (rowId: string) =>
    setPlan((prev) =>
      prev ? { ...prev, supportRows: prev.supportRows.filter((r) => r.id !== rowId) } : prev
    );

  // ---- 利用時間更新ヘルパー ----
  const updateDaySchedule = (day: string, patch: Partial<DaySchedule>) => {
    setHoursPlan(prev => {
      if (!prev) return prev;
      const current = prev.weeklyHours[day] || defaultDaySchedule();
      const updatedDay = { ...current, ...patch };

      const parseMin = (t: string) => {
        if (!t) return 0;
        const [h, m] = t.split(':').map(Number);
        return (h || 0) * 60 + (m || 0);
      };

      if (patch.startTime !== undefined || patch.endTime !== undefined) {
        const diff = parseMin(updatedDay.endTime) - parseMin(updatedDay.startTime);
        updatedDay.totalMinutes = diff > 0 ? diff : 0;
      }
      if (patch.beforeExtStartTime !== undefined || patch.beforeExtEndTime !== undefined) {
        const diff = parseMin(updatedDay.beforeExtEndTime) - parseMin(updatedDay.beforeExtStartTime);
        updatedDay.beforeExtMinutes = diff > 0 ? diff : 0;
      }
      if (patch.afterExtStartTime !== undefined || patch.afterExtEndTime !== undefined) {
        const diff = parseMin(updatedDay.afterExtEndTime) - parseMin(updatedDay.afterExtStartTime);
        updatedDay.afterExtMinutes = diff > 0 ? diff : 0;
      }

      return {
        ...prev,
        weeklyHours: {
          ...prev.weeklyHours,
          [day]: updatedDay
        }
      };
    });
  };

  const updateHoursPlanField = (field: 'extReason' | 'notes', val: string) => {
    setHoursPlan(prev => prev ? { ...prev, [field]: val } : prev);
  };

  const formatMinutes = (mins: number) => {
    if (!mins) return '0時間00分';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}時間${m.toString().padStart(2, '0')}分`;
  };

  // ---- 印刷 ----
  const handlePrint = () => {
    document.body.classList.add('print-prof');
    window.print();
    window.addEventListener('afterprint', () => {
      document.body.classList.remove('print-prof');
    }, { once: true });
  };

  // ---- まとめて印刷（一括印刷） ----
  const handlePrintAll = async () => {
    if (!childId || !selectedChild) return;
    setIsSaving(true);
    try {
      let dPlan: ProfessionalPlanDoc | null = null;
      let fPlan: ProfessionalPlanDoc | null = null;
      let hPlan: ServiceHoursPlan | null = null;

      // 現在表示されているタブのデータを割り当て
      if (activeTab === 'final') {
        fPlan = plan;
      } else if (activeTab === 'draft') {
        dPlan = plan;
      } else if (activeTab === 'hours') {
        hPlan = hoursPlan;
      }

      // 案の取得
      if (!dPlan) {
        const q = query(
          collection(db, PLAN_COL),
          where('childId', '==', childId),
          where('status', '==', 'draft'),
          where('officeId', '==', selectedOfficeId)
        );
        const snap = await getDocs(q);
        snap.forEach(d => {
          const data = d.data() as ProfessionalPlanDoc;
          const startMonth = data.startMonth || data.createdAt?.slice(0, 7);
          if (startMonth === currentMonth) {
            dPlan = { ...data, id: d.id };
          }
        });
        if (!dPlan) {
          dPlan = defaultPlan(childId);
          dPlan.status = 'draft';
          dPlan.startMonth = currentMonth;
        }
      }

      // 本案の取得
      if (!fPlan) {
        const q = query(
          collection(db, PLAN_COL),
          where('childId', '==', childId),
          where('status', '==', 'final'),
          where('officeId', '==', selectedOfficeId)
        );
        const snap = await getDocs(q);
        snap.forEach(d => {
          const data = d.data() as ProfessionalPlanDoc;
          const startMonth = data.startMonth || data.createdAt?.slice(0, 7);
          if (startMonth === currentMonth) {
            fPlan = { ...data, id: d.id };
          }
        });
        if (!fPlan) {
          fPlan = defaultPlan(childId);
          fPlan.status = 'final';
          fPlan.startMonth = currentMonth;
        }
      }

      // 利用時間の取得
      if (!hPlan) {
        const q = query(
          collection(db, HOURS_PLAN_COL),
          where('childId', '==', childId),
          where('officeId', '==', selectedOfficeId)
        );
        const snap = await getDocs(q);
        snap.forEach(d => {
          const data = d.data() as ServiceHoursPlan;
          if (data.startMonth === currentMonth) {
            hPlan = { ...data, id: d.id };
          }
        });
        if (!hPlan) {
          hPlan = defaultHoursPlan(childId, currentMonth);
        }
      }

      setPrintAllData({
        draftPlan: dPlan,
        finalPlan: fPlan,
        hoursPlan: hPlan
      });

      setTimeout(() => {
        document.body.classList.add('print-prof-all');
        window.print();
        const afterPrintHandler = () => {
          document.body.classList.remove('print-prof-all');
          setPrintAllData(null);
          window.removeEventListener('afterprint', afterPrintHandler);
        };
        window.addEventListener('afterprint', afterPrintHandler);
      }, 300);

    } catch (e) {
      console.error('一括印刷エラー:', e);
      alert('一括印刷に必要なデータの取得に失敗しました。');
    } finally {
      setIsSaving(false);
    }
  };

  const handleExcelExport = () => {
    if (!selectedChild || !plan) return;
    const fileName = `専門的支援計画_${selectedChild.fullName}_${plan.createdAt}`;
    exportProfessionalPlan(selectedChild.fullName, plan, fileName);
  };

  const isCurrentMonthArchived = periodArchiveMap[currentMonth] === true;
  const isPeriodStatusMatch = isCurrentMonthArchived === showArchived;

  // ---- ローディング ----
  if (isLoading || childrenData.length === 0) {
    return <div className="p-20 text-center text-slate-400">読み込み中...</div>;
  }
  if (!selectedChild) {
    return <div className="p-20 text-center text-slate-400">児童データが見つかりません</div>;
  }
  if (isPeriodStatusMatch && ((activeTab === 'hours' && !hoursPlan) || (activeTab !== 'hours' && !plan))) {
    return <div className="p-20 text-center text-slate-400">データが見つかりません</div>;
  }

  // 作成年月日のパース
  const dateStr = activeTab === 'hours' ? (hoursPlan?.createdAt || '') : (plan?.createdAt || '');
  const [cy, cm, cd] = dateStr ? dateStr.split('-') : ['', '', ''];

  const signDateStr = plan?.signDate || '';
  const [sy, sm, sd] = signDateStr ? signDateStr.split('-') : ['', '', ''];

  const mobileActions: Action[] = [
    { label: '保存する', icon: <Save size={16} />, onClick: handleSave, disabled: isSaving, colorClass: 'bg-primary text-white' },
    ...(activeTab !== 'hours' ? [{ label: 'Excel出力', icon: <Download size={16} />, onClick: handleExcelExport }] : []),
    { label: 'まとめて印刷', icon: <Printer size={16} />, onClick: handlePrintAll, colorClass: 'bg-emerald-600 text-white' },
    { label: '印刷', icon: <Printer size={16} />, onClick: handlePrint },
    { label: 'Excelインポート', icon: <UploadCloud size={16} />, onClick: () => setIsImportOpen(true) },
    { 
      label: isCurrentPeriodArchived ? 'アーカイブ解除' : '月をアーカイブ', 
      icon: <Archive size={16} />, 
      onClick: handleToggleArchive,
      colorClass: isCurrentPeriodArchived ? 'bg-amber-600 text-white' : 'bg-slate-600 text-white'
    },
    { 
      label: showArchived ? 'アーカイブ表示中' : 'アーカイブを見る', 
      icon: <Archive size={16} />, 
      onClick: () => setShowArchived(prev => !prev),
      colorClass: showArchived ? 'bg-amber-600 text-white' : ''
    },
    { 
      label: '【テスト用】全データ削除', 
      icon: <Trash2 size={16} />, 
      onClick: handleTestDeleteAllPlans,
      colorClass: 'text-red-600'
    },
    ...(activeTab !== 'hours' ? [
      { 
        label: '設定から反映', 
        icon: <CheckCircle2 size={16} />, 
        onClick: () => {
          if (!monthlySettings) {
            alert('該当月の設定が見つかりません。設定画面で登録してください。');
            return;
          }
          // 令和年を西暦に簡易変換 (R6 -> 2024)
          const reiwaOffset = 2018;
          const year = parseInt(monthlySettings.perspectiveYear || '0', 10) + reiwaOffset;
          const month = (monthlySettings.perspectiveMonth || '1').padStart(2, '0');
          const day = (monthlySettings.perspectiveDay || '01').padStart(2, '0');
          const newDate = `${year}-${month}-${day}`;
          
          setPlan(prev => prev ? {
            ...prev,
            createdAt: newDate,
            managerName: monthlySettings.perspectiveCreator || prev.managerName
          } : prev);
        },
        colorClass: 'bg-emerald-600 text-white'
      }
    ] : []),
  ];

  // 任意の月（年月）を追加するハンドラー
  const handleAddPeriod = () => {
    const input = window.prompt("追加する月を年月（例：2026-02）で入力してください。", `${selectedYear}-06`);
    if (!input) return;
    if (!/^\d{4}-\d{2}$/.test(input)) {
      alert("入力形式が正しくありません。YYYY-MM形式で入力してください。");
      return;
    }
    
    // availableMonths に追加
    if (!availableMonths.includes(input)) {
      setAvailableMonths(prev => [...prev, input].sort());
    }
    
    // 選択中にする
    setCurrentMonth(input);
    
    // 年も切り替える
    const yearVal = parseInt(input.split('-')[0], 10);
    if (!isNaN(yearVal)) {
      setSelectedYear(yearVal);
    }
  };

  const getCycleOptionsForYear = () => {
    const yearPrefix = `${selectedYear}-`;
    // その年で、かつ showArchived トグルの状態に一致する startMonth を availableMonths から取得
    const actualMonthsForYear = availableMonths.filter(m => {
      const isArchived = periodArchiveMap[m] === true;
      return m.startsWith(yearPrefix) && (isArchived === showArchived);
    });

    // デフォルトサイクル月は自動生成しない（ユーザー指示による廃止）
    const allUniqueMonths = Array.from(new Set(actualMonthsForYear)).sort();

    return allUniqueMonths.map(mVal => {
      const mNum = parseInt(mVal.split('-')[1], 10);
      return {
        value: mVal,
        label: `${mNum}月 (${mVal})`,
        hasData: availableMonths.includes(mVal)
      };
    });
  };

  const cycleOptions = getCycleOptionsForYear();

  return (
    <div id="prof-plan-print" className="max-w-6xl mx-auto flex flex-col gap-6 pb-24 animate-fade-in">
      {/* パンくず & アクションボタン */}
      <div className="flex items-center justify-between print:hidden">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(`/children/${childId}`)}
            className="flex items-center gap-2 text-slate-500 hover:text-slate-800 font-medium transition-colors"
          >
            <ArrowLeft size={18} />
            <span className="text-slate-400">書類一覧</span>
          </button>
          <ChevronRight size={14} className="text-slate-300" />
          <span className="text-sm font-bold text-slate-700">{selectedChild.fullName} 様</span>
          <ChevronRight size={14} className="text-slate-300" />
          <span className="text-sm font-semibold text-primary">専門的支援計画書</span>
        </div>
        {/* PC表示用：アクションバー（モバイルでは非表示） */}
        <div className="hidden md:flex gap-3">
          {activeTab === 'final' && plan?.isReflected && (
            <div className="flex items-center text-xs font-bold text-emerald-600 bg-emerald-50 px-3 rounded-lg border border-emerald-200 h-9">
              反映済み ({plan.reflectedStartMonth} 〜 {plan.reflectedEndMonth})
            </div>
          )}
          {activeTab === 'final' && (
            <button
              className="btn-secondary flex items-center gap-2 border-emerald-500 text-emerald-700 hover:bg-emerald-50"
              onClick={handleReflectToImplementation}
              disabled={isSaving}
            >
              <CheckCircle2 size={16} /> 実施計画に反映
            </button>
          )}
          <button
            className="btn-primary flex items-center gap-2"
            onClick={handleSave}
            disabled={isSaving}
          >
            <Save size={16} /> {isSaving ? '保存中...' : '保存する'}
          </button>
        </div>
      </div>

      <FloatingActionMenu actions={mobileActions} />

      {/* コントロールパネル（印刷時は非表示） */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50 border border-slate-200/80 rounded-2xl p-4 print:hidden">
        <div className="flex items-center gap-4 flex-wrap">
          {/* 年選択（左右切り替え） */}
          <div className="flex items-center gap-2 border-r border-slate-200 pr-4">
            <button
              onClick={() => setSelectedYear(y => y - 1)}
              className="p-1.5 hover:bg-slate-200 rounded-lg text-slate-600 transition-colors"
              title="前年"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="font-black text-slate-800 text-sm tracking-tight">{selectedYear} 年</span>
            <button
              onClick={() => setSelectedYear(y => y + 1)}
              className="p-1.5 hover:bg-slate-200 rounded-lg text-slate-600 transition-colors"
              title="翌年"
            >
              <ChevronRight size={16} />
            </button>
          </div>


          {/* 6ヶ月更新のサイクル月ボタン */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-1">更新月選択:</span>
            <div className="flex gap-2 items-center flex-wrap">
              {cycleOptions.map(opt => {
                const isSelected = currentMonth === opt.value;
                const hasData = opt.hasData;
                return (
                  <button
                    key={opt.value}
                    onClick={() => setCurrentMonth(opt.value)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all relative ${
                      isSelected
                        ? 'bg-primary text-white shadow-sm'
                        : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <span>{opt.label}</span>
                    {hasData && !isSelected && (
                      <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-green-500 rounded-full border border-white" title="データあり" />
                    )}
                  </button>
                );
              })}
              
              {/* 月を追加ボタン */}
              {!showArchived && (
                <button
                  onClick={handleAddPeriod}
                  className="px-2 py-1.5 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 border border-slate-200 border-dashed text-slate-500 hover:text-slate-700 transition-all flex items-center gap-1"
                  title="新しい月を追加"
                >
                  <Plus size={13} />
                  <span>月を追加</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* タブ切り替え */}
        <div className="flex bg-slate-200/60 p-1 rounded-xl">
          <button
            onClick={() => setActiveTab('final')}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition-all whitespace-nowrap ${
              activeTab === 'final'
                ? 'bg-white text-slate-800 shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            専門的支援計画 (本案)
          </button>
          <button
            onClick={() => setActiveTab('draft')}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition-all whitespace-nowrap ${
              activeTab === 'draft'
                ? 'bg-white text-slate-800 shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            専門的支援計画 (案)
          </button>
          <button
            onClick={() => setActiveTab('hours')}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition-all whitespace-nowrap ${
              activeTab === 'hours'
                ? 'bg-white text-slate-800 shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            個別支援計画別表 (利用時間)
          </button>
        </div>
      </div>

      {/* ======== 書類本体：専門的支援計画（本案 / 案） ======== */}
      {activeTab !== 'hours' && plan && isPeriodStatusMatch && (
        <div className="bg-white border border-slate-300 shadow-sm p-6 print:shadow-none print:border-0 print:p-0" style={{ fontFamily: "'Noto Sans JP', sans-serif" }}>

          {/* ===== ヘッダー ===== */}
          <div className="flex items-start justify-between mb-2">
            {/* 左：利用児氏名 */}
            <div className="flex items-baseline gap-1 text-sm">
              <span className="whitespace-nowrap">利用児氏名：</span>
              <div className="border-b border-slate-400 min-w-[160px] px-1">
                <input
                  className="outline-none bg-transparent w-full text-base font-bold"
                  value={selectedChild.fullName}
                  readOnly
                />
              </div>
              <span className="ml-1">様</span>
            </div>
            {/* 中央：タイトル */}
            <div className="text-center flex-1">
              <h1 className="text-xl font-black tracking-wide">
                個別支援計画書　<span className="font-normal text-base">({officeName})</span>
                <span className="text-sm font-bold text-slate-500 ml-2">
                  {plan.status === 'draft' ? '【案】' : '【本案】'}
                </span>
              </h1>
            </div>
            {/* 右：作成年月日 */}
            <div className="text-sm flex items-baseline gap-1 whitespace-nowrap">
              <span>{activeTab === 'final' ? '開始年月日：' : '作成年月日：'}</span>
              <input
                type="number"
                className="outline-none bg-transparent w-12 border-b border-slate-400 text-center"
                style={{ touchAction: 'pan-y' }}
                value={cy || ''}
                onChange={(e) => update('createdAt', `${e.target.value}-${cm || ''}-${cd || ''}`)}
                placeholder="年"
              />
              <span>年</span>
              <input
                type="number"
                className="outline-none bg-transparent w-8 border-b border-slate-400 text-center"
                style={{ touchAction: 'pan-y' }}
                value={cm || ''}
                onChange={(e) => update('createdAt', `${cy || ''}-${e.target.value}-${cd || ''}`)}
                placeholder="月"
              />
              <span>月</span>
              <input
                type="number"
                className="outline-none bg-transparent w-8 border-b border-slate-400 text-center"
                style={{ touchAction: 'pan-y' }}
                value={cd || ''}
                onChange={(e) => update('createdAt', `${cy || ''}-${cm || ''}-${e.target.value}`)}
                placeholder="日"
              />
              <span>日</span>
            </div>
          </div>

          {/* ===== 枠線テーブル全体 ===== */}
          <table className="w-full border-collapse text-sm" style={{ borderLeft: '1.5px solid #374151', borderTop: '1.5px solid #374151' }}>
            <tbody>
              {/* ----- 利用児及び家族の生活に対する意向 ----- */}
              <tr>
                <td
                  className="bg-slate-100 text-center align-middle font-medium text-[13px] p-2 leading-tight"
                  style={{ border: '1.5px solid #374151', width: '16%' }}
                  rowSpan={1}
                >
                  利用児及び家族の<br />生活に対する意向
                </td>
                <td style={{ border: '1.5px solid #374151' }} colSpan={3} className="p-1">
                  <textarea
                    rows={3}
                    className="w-full resize-none outline-none bg-transparent text-sm leading-relaxed p-1"
                    style={{ touchAction: 'pan-y' }}
                    onWheel={handleWheel}
                    value={plan.familyIntention}
                    onChange={(e) => update('familyIntention', e.target.value)}
                  />
                </td>
              </tr>

              {/* 空白区切り行 */}
              <tr><td colSpan={4} style={{ height: '6px', border: 'none' }} /></tr>

              {/* ----- 総合的な支援の方針 ----- */}
              <tr>
                <td
                  className="bg-slate-100 text-center align-middle font-medium text-[13px] p-2"
                  style={{ border: '1.5px solid #374151' }}
                >
                  総合的な支援の方針
                </td>
                <td style={{ border: '1.5px solid #374151' }} colSpan={3} className="p-1">
                  <textarea
                    rows={3}
                    className="w-full resize-none outline-none bg-transparent text-sm leading-relaxed p-1"
                    style={{ touchAction: 'pan-y' }}
                    onWheel={handleWheel}
                    value={plan.overallPolicy}
                    onChange={(e) => update('overallPolicy', e.target.value)}
                  />
                </td>
              </tr>

              {/* 空白区切り行 */}
              <tr><td colSpan={4} style={{ height: '6px', border: 'none' }} /></tr>

              {/* ----- 長期目標・短期目標 + 支援時間 ----- */}
              <tr>
                <td
                  className="bg-slate-100 text-center align-middle font-medium text-[13px] p-2 leading-tight"
                  style={{ border: '1.5px solid #374151' }}
                >
                  長期目標<br /><span className="text-[11px]">（内容・期間等）</span>
                </td>
                <td style={{ border: '1.5px solid #374151', width: '54%' }} className="p-1">
                  <textarea
                    rows={2}
                    className="w-full resize-none outline-none bg-transparent text-sm leading-relaxed p-1"
                    style={{ touchAction: 'pan-y' }}
                    onWheel={handleWheel}
                    value={plan.longTermGoal}
                    onChange={(e) => update('longTermGoal', e.target.value)}
                  />
                </td>
                <td
                  className="bg-slate-100 text-center align-middle font-medium text-[12px] p-2 leading-tight"
                  style={{ border: '1.5px solid #374151', width: '16%' }}
                  rowSpan={2}
                >
                  支援の標準的な提供時間等<br /><span className="text-[10px]">（曜日・頻度・時間）</span>
                </td>
                <td style={{ border: '1.5px solid #374151', width: '14%' }} rowSpan={2} className="p-1">
                  <textarea
                    rows={4}
                    className="w-full h-full resize-none outline-none bg-transparent text-sm leading-relaxed p-1"
                    style={{ touchAction: 'pan-y' }}
                    onWheel={handleWheel}
                    value={plan.serviceHours}
                    onChange={(e) => update('serviceHours', e.target.value)}
                  />
                </td>
              </tr>
              <tr>
                <td
                  className="bg-slate-100 text-center align-middle font-medium text-[13px] p-2 leading-tight"
                  style={{ border: '1.5px solid #374151' }}
                >
                  短期目標<br /><span className="text-[11px]">（内容・期間等）</span>
                </td>
                <td style={{ border: '1.5px solid #374151' }} className="p-1">
                  <textarea
                    rows={2}
                    className="w-full resize-none outline-none bg-transparent text-sm leading-relaxed p-1"
                    style={{ touchAction: 'pan-y' }}
                    onWheel={handleWheel}
                    value={plan.shortTermGoal}
                    onChange={(e) => update('shortTermGoal', e.target.value)}
                  />
                </td>
              </tr>
            </tbody>
          </table>

          {/* ===== ○支援目標及び具体的な支援内容等 ===== */}
          <div className="mt-3 mb-1 text-[13px] font-medium">○支援目標及び具体的な支援内容等</div>

          <div className="overflow-x-auto print:overflow-visible" style={{ touchAction: 'pan-y' }}>
            <table className="w-full border-collapse text-[12px]" style={{ borderLeft: '1.5px solid #374151', borderTop: '1.5px solid #374151' }}>
              <thead>
                <tr className="bg-slate-100 text-center text-[12px]">
                  <th style={{ border: '1.5px solid #374151', width: '7%' }} className="p-2 align-middle">項　目</th>
                  <th style={{ border: '1.5px solid #374151', width: '15%' }} className="p-2 align-middle leading-tight">
                    支援目標<br />
                    <span className="text-[10px] font-normal">（具体的な到達目標）</span>
                  </th>
                  <th style={{ border: '1.5px solid #374151' }} className="p-2 align-middle leading-tight">
                    支援内容<br />
                    <span className="text-[10px] font-normal">（内容・支援の提供上のポイント・5領域（※）との関連性等）</span>
                  </th>
                  <th style={{ border: '1.5px solid #374151', width: '7%' }} className="p-2 align-middle leading-tight">
                    達成<br />時期
                  </th>
                  <th style={{ border: '1.5px solid #374151', width: '11%' }} className="p-2 align-middle leading-tight">
                    担当者<br />提供機関
                  </th>
                  <th style={{ border: '1.5px solid #374151', width: '17%' }} className="p-2 align-middle leading-tight">
                    留意事項<br />
                    <span className="text-[10px] font-normal">（本人の役割を含む）</span>
                  </th>
                  <th style={{ border: '1.5px solid #374151', width: '5%' }} className="p-2 align-middle leading-tight">
                    優先<br />順位
                  </th>
                </tr>
              </thead>
              <tbody>
                {plan.supportRows.map((row, idx) => {
                  const isFirstInCategory = idx === 0 || plan.supportRows[idx - 1].category !== row.category;
                  const categoryCount = plan.supportRows.filter((r) => r.category === row.category).length;

                  return (
                    <tr key={row.id} className="align-top">
                      {isFirstInCategory && (
                        <td
                          className="text-center font-medium align-middle bg-slate-50 text-[12px]"
                          style={{ border: '1.5px solid #374151' }}
                          rowSpan={categoryCount}
                        >
                          {row.category}
                        </td>
                      )}

                      {/* 支援目標 */}
                      <td style={{ border: '1.5px solid #374151' }} className="p-1">
                        <EditCell
                          value={row.supportGoal}
                          onChange={(v) => updateRow(row.id, { supportGoal: v })}
                        />
                      </td>

                      {/* 支援内容 */}
                      <td style={{ border: '1.5px solid #374151' }} className="p-1">
                        <div className="flex gap-2">
                          <EditCell
                            value={row.supportContent}
                            onChange={(v) => updateRow(row.id, { supportContent: v })}
                            className="flex-1"
                          />
                          {row.category === '本人支援' && (
                            <div className="border-l border-slate-200 pl-2 flex-shrink-0">
                              <FiveAreaCheckboxes
                                selected={row.fiveAreas}
                                onChange={(areas) => updateRow(row.id, { fiveAreas: areas })}
                              />
                            </div>
                          )}
                        </div>
                      </td>

                      {/* 達成時期 */}
                      <td style={{ border: '1.5px solid #374151' }} className="p-1 text-center align-middle">
                        <input
                          className="outline-none bg-transparent text-center w-full text-[12px]"
                          style={{ touchAction: 'pan-y' }}
                          value={row.achievementPeriod}
                          onChange={(e) => updateRow(row.id, { achievementPeriod: e.target.value })}
                        />
                      </td>

                      {/* 担当者・提供機関 */}
                      <td style={{ border: '1.5px solid #374151' }} className="p-1 text-center align-middle">
                        <textarea
                          rows={2}
                          className="w-full resize-none outline-none bg-transparent text-[12px] text-center"
                          style={{ touchAction: 'pan-y' }}
                          onWheel={handleWheel}
                          value={row.provider}
                          onChange={(e) => updateRow(row.id, { provider: e.target.value })}
                        />
                      </td>

                      {/* 留意事項 */}
                      <td style={{ border: '1.5px solid #374151' }} className="p-1">
                        <EditCell
                          value={row.notes}
                          onChange={(v) => updateRow(row.id, { notes: v })}
                        />
                      </td>

                      {/* 優先順位 */}
                      <td style={{ border: '1.5px solid #374151' }} className="p-1 text-center align-middle">
                        <div className="flex flex-col items-center gap-1">
                          <input
                            className="outline-none bg-transparent text-center w-full text-[12px] font-bold"
                            style={{ touchAction: 'pan-y' }}
                            value={row.priority}
                            onChange={(e) => updateRow(row.id, { priority: e.target.value })}
                          />
                          <button
                            className="text-slate-300 hover:text-red-400 transition-colors print:hidden"
                            title="行を削除"
                            onClick={() => removeRow(row.id)}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 行追加ボタン */}
          <div className="flex gap-2 mt-2 print:hidden">
            {(['本人支援', '家族支援', '移行支援'] as SupportCategory[]).map((cat) => (
              <button
                key={cat}
                onClick={() => addRow(cat)}
                className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-primary border border-dashed border-slate-300 hover:border-primary rounded px-2 py-1 transition-colors"
              >
                <Plus size={11} /> {cat}を追加
              </button>
            ))}
          </div>

          {/* 注釈 */}
          <div className="mt-2 text-right text-[10px] text-slate-500">
            ※ 5領域の視点「健康・生活」、「運動・感覚」、「認知・行動」、「言語・コミュニケーション」、「人間関係・社会性」
          </div>

          {/* ===== 確認事項 ===== */}
          <table className="w-full border-collapse mt-2 text-[12px]" style={{ borderLeft: '1.5px solid #374151', borderTop: '1.5px solid #374151' }}>
            <tbody>
              <tr>
                <td
                  className="bg-slate-50 font-medium text-center align-middle p-2 whitespace-nowrap"
                  style={{ border: '1.5px solid #374151', width: '60px' }}
                >
                  確認事項
                </td>
                <td style={{ border: '1.5px solid #374151' }} className="p-1">
                  <textarea
                    rows={2}
                    className="w-full resize-none outline-none bg-transparent text-[12px] leading-relaxed p-1"
                    style={{ touchAction: 'pan-y' }}
                    onWheel={handleWheel}
                    value={plan.confirmation}
                    onChange={(e) => update('confirmation', e.target.value)}
                  />
                </td>
              </tr>
            </tbody>
          </table>

          {/* ===== 説明文 ===== */}
          <div className="flex justify-between mt-3 mb-1 text-[12px]">
            <span>提供する支援内容について、本計画書に基づき説明しました。</span>
            <span>本計画書に基づき支援の説明を受け、内容に同意しました。</span>
          </div>

          {/* ===== 署名欄 ===== */}
          <div className="flex items-end justify-between gap-4 mt-2">
            <div className="flex-1">
              <div className="text-[12px] mb-1">児童発達支援管理責任者氏名：</div>
              <div className="flex items-end gap-2">
                <input
                  className="border-b border-slate-400 outline-none bg-transparent text-sm flex-1 pb-0.5"
                  style={{ touchAction: 'pan-y' }}
                  value={plan.managerName}
                  onChange={(e) => update('managerName', e.target.value)}
                  placeholder="氏名を入力"
                />
                <span className="text-sm ml-2">印</span>
                {activeTab !== 'draft' && (
                  <div className="flex items-baseline gap-1 text-[12px] ml-4">
                    <input
                      type="number"
                      className="outline-none bg-transparent w-12 border-b border-slate-400 text-center"
                      style={{ touchAction: 'pan-y' }}
                      value={sy || ''}
                      onChange={(e) => update('signDate', `${e.target.value}-${sm || ''}-${sd || ''}`)}
                      placeholder="年"
                    />
                    <span>年</span>
                    <input
                      type="number"
                      className="outline-none bg-transparent w-8 border-b border-slate-400 text-center"
                      style={{ touchAction: 'pan-y' }}
                      value={sm || ''}
                      onChange={(e) => update('signDate', `${sy || ''}-${e.target.value}-${sd || ''}`)}
                      placeholder="月"
                    />
                    <span>月</span>
                    <input
                      type="number"
                      className="outline-none bg-transparent w-8 border-b border-slate-400 text-center"
                      style={{ touchAction: 'pan-y' }}
                      value={sd || ''}
                      onChange={(e) => update('signDate', `${sy || ''}-${sm || ''}-${e.target.value}`)}
                      placeholder="日"
                    />
                    <span>日</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex-1">
              <div className="text-[12px] mb-1 text-right">（保護者署名）</div>
              <input
                className="border-b border-slate-400 outline-none bg-transparent text-sm w-full text-right pb-0.5"
                style={{ touchAction: 'pan-y' }}
                value={plan.guardianName}
                onChange={(e) => update('guardianName', e.target.value)}
                placeholder=""
              />
            </div>
          </div>
        </div>
      )}

      {/* ======== 書類本体：個別支援計画別表（利用時間） ======== */}
      {activeTab === 'hours' && hoursPlan && isPeriodStatusMatch && (
        <div className="bg-white border border-slate-300 shadow-sm p-6 print:shadow-none print:border-0 print:p-0" style={{ fontFamily: "'Noto Sans JP', sans-serif" }}>
          {/* ===== ヘッダー ===== */}
          <div className="flex items-start justify-between mb-4">
            <div className="text-left">
              <h1 className="text-xl font-black tracking-wide">個別支援計画別表</h1>
            </div>
            <div className="flex items-baseline gap-1 text-sm">
              <span className="whitespace-nowrap">利用児氏名：</span>
              <div className="border-b border-slate-400 min-w-[160px] px-1 text-center font-bold">
                {selectedChild.fullName}
              </div>
              <span className="ml-1">様</span>
            </div>
            <div className="text-sm flex items-baseline gap-1 whitespace-nowrap">
              <span>作成日：</span>
              <input
                type="number"
                className="outline-none bg-transparent w-12 border-b border-slate-400 text-center"
                value={cy || ''}
                onChange={(e) => setHoursPlan(prev => prev ? { ...prev, createdAt: `${e.target.value}-${cm || ''}-${cd || ''}` } : prev)}
                placeholder="年"
              />
              <span>年</span>
              <input
                type="number"
                className="outline-none bg-transparent w-8 border-b border-slate-400 text-center"
                value={cm || ''}
                onChange={(e) => setHoursPlan(prev => prev ? { ...prev, createdAt: `${cy || ''}-${e.target.value}-${cd || ''}` } : prev)}
                placeholder="月"
              />
              <span>月</span>
              <input
                type="number"
                className="outline-none bg-transparent w-8 border-b border-slate-400 text-center"
                value={cd || ''}
                onChange={(e) => setHoursPlan(prev => prev ? { ...prev, createdAt: `${cy || ''}-${cm || ''}-${e.target.value}` } : prev)}
                placeholder="日"
              />
              <span>日</span>
            </div>
          </div>

          {/* ===== 曜日スケジュールテーブル ===== */}
          <div className="overflow-x-auto print:overflow-visible">
            <table className="w-full border-collapse text-xs table-fixed" style={{ borderLeft: '1.5px solid #374151', borderTop: '1.5px solid #374151' }}>
              <thead>
                <tr className="bg-slate-100 text-center">
                  <th style={{ border: '1.5px solid #374151', width: '120px' }} className="p-2 font-bold">区分</th>
                  <th style={{ border: '1.5px solid #374151', width: '120px' }} className="p-2 font-bold">時間帯 / 合計</th>
                  {['月', '火', '水', '木', '金', '土', '日'].map(day => (
                    <th key={day} style={{ border: '1.5px solid #374151' }} className="p-2 font-bold">{day}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* --- 提供時間 --- */}
                <tr>
                  <td style={{ border: '1.5px solid #374151' }} className="bg-slate-50 font-bold p-2 text-center align-middle" rowSpan={2}>
                    提供時間
                  </td>
                  <td style={{ border: '1.5px solid #374151' }} className="bg-slate-50 p-2 text-center font-semibold">
                    利用開始・終了時間
                  </td>
                  {['月', '火', '水', '木', '金', '土', '日'].map(day => {
                    const sched = hoursPlan.weeklyHours[day] || defaultDaySchedule();
                    return (
                      <td key={day} style={{ border: '1.5px solid #374151' }} className="p-1 text-center">
                        <div className="flex items-center justify-center gap-0.5">
                          <input
                            type="text"
                            placeholder="14:00"
                            className="w-12 text-center border-b border-slate-200 outline-none focus:border-primary text-xs"
                            value={sched.startTime || ''}
                            onChange={(e) => updateDaySchedule(day, { startTime: e.target.value })}
                          />
                          <span className="text-slate-400">~</span>
                          <input
                            type="text"
                            placeholder="18:00"
                            className="w-12 text-center border-b border-slate-200 outline-none focus:border-primary text-xs"
                            value={sched.endTime || ''}
                            onChange={(e) => updateDaySchedule(day, { endTime: e.target.value })}
                          />
                        </div>
                      </td>
                    );
                  })}
                </tr>
                <tr>
                  <td style={{ border: '1.5px solid #374151' }} className="bg-slate-50 p-2 text-center font-semibold">
                    合計時間
                  </td>
                  {['月', '火', '水', '木', '金', '土', '日'].map(day => {
                    const sched = hoursPlan.weeklyHours[day] || defaultDaySchedule();
                    return (
                      <td key={day} style={{ border: '1.5px solid #374151' }} className="p-2 text-center font-bold text-slate-700 bg-slate-50/30">
                        {formatMinutes(sched.totalMinutes)}
                      </td>
                    );
                  })}
                </tr>

                {/* --- 延長支援時間 --- */}
                <tr>
                  <td style={{ border: '1.5px solid #374151' }} className="bg-slate-50 font-bold p-2 text-center align-middle leading-tight" rowSpan={3}>
                    延長支援時間<br />
                    <span className="text-[9px] font-normal text-slate-500">※延長支援時間は、支援前・支援後それぞれ1時間以上から</span>
                  </td>
                  <td style={{ border: '1.5px solid #374151' }} className="bg-slate-50 p-2 text-center font-semibold">
                    【支援前】延長支援時間
                  </td>
                  {['月', '火', '水', '木', '金', '土', '日'].map(day => {
                    const sched = hoursPlan.weeklyHours[day] || defaultDaySchedule();
                    return (
                      <td key={day} style={{ border: '1.5px solid #374151' }} className="p-1 text-center">
                        <div className="flex items-center justify-center gap-0.5">
                          <input
                            type="text"
                            placeholder="13:00"
                            className="w-12 text-center border-b border-slate-200 outline-none focus:border-primary text-xs"
                            value={sched.beforeExtStartTime || ''}
                            onChange={(e) => updateDaySchedule(day, { beforeExtStartTime: e.target.value })}
                          />
                          <span className="text-slate-400">~</span>
                          <input
                            type="text"
                            placeholder="14:00"
                            className="w-12 text-center border-b border-slate-200 outline-none focus:border-primary text-xs"
                            value={sched.beforeExtEndTime || ''}
                            onChange={(e) => updateDaySchedule(day, { beforeExtEndTime: e.target.value })}
                          />
                        </div>
                      </td>
                    );
                  })}
                </tr>
                <tr>
                  <td style={{ border: '1.5px solid #374151' }} className="bg-slate-50 p-2 text-center font-semibold">
                    【支援後】延長支援時間
                  </td>
                  {['月', '火', '水', '木', '金', '土', '日'].map(day => {
                    const sched = hoursPlan.weeklyHours[day] || defaultDaySchedule();
                    return (
                      <td key={day} style={{ border: '1.5px solid #374151' }} className="p-1 text-center">
                        <div className="flex items-center justify-center gap-0.5">
                          <input
                            type="text"
                            placeholder="18:00"
                            className="w-12 text-center border-b border-slate-200 outline-none focus:border-primary text-xs"
                            value={sched.afterExtStartTime || ''}
                            onChange={(e) => updateDaySchedule(day, { afterExtStartTime: e.target.value })}
                          />
                          <span className="text-slate-400">~</span>
                          <input
                            type="text"
                            placeholder="19:00"
                            className="w-12 text-center border-b border-slate-200 outline-none focus:border-primary text-xs"
                            value={sched.afterExtEndTime || ''}
                            onChange={(e) => updateDaySchedule(day, { afterExtEndTime: e.target.value })}
                          />
                        </div>
                      </td>
                    );
                  })}
                </tr>
                <tr>
                  <td style={{ border: '1.5px solid #374151' }} className="bg-slate-50 p-2 text-center font-semibold">
                    延長時間合計
                  </td>
                  {['月', '火', '水', '木', '金', '土', '日'].map(day => {
                    const sched = hoursPlan.weeklyHours[day] || defaultDaySchedule();
                    const totalExt = sched.beforeExtMinutes + sched.afterExtMinutes;
                    return (
                      <td key={day} style={{ border: '1.5px solid #374151' }} className="p-2 text-center font-bold text-slate-700 bg-slate-50/30">
                        {formatMinutes(totalExt)}
                      </td>
                    );
                  })}
                </tr>

                {/* --- 延長を必要とする理由 --- */}
                <tr>
                  <td style={{ border: '1.5px solid #374151' }} className="bg-slate-50 font-bold p-2 text-center align-middle">
                    延長を必要とする理由
                  </td>
                  <td style={{ border: '1.5px solid #374151' }} className="p-2" colSpan={8}>
                    <textarea
                      rows={3}
                      className="w-full resize-none outline-none bg-transparent text-xs leading-relaxed p-1"
                      style={{ touchAction: 'pan-y' }}
                      onWheel={handleWheel}
                      value={hoursPlan.extReason || ''}
                      onChange={(e) => updateHoursPlanField('extReason', e.target.value)}
                      placeholder="延長支援を必要とする理由を入力してください"
                    />
                  </td>
                </tr>

                {/* --- 特記事項 --- */}
                <tr>
                  <td style={{ border: '1.5px solid #374151' }} className="bg-slate-50 font-bold p-2 text-center align-middle">
                    特記事項
                  </td>
                  <td style={{ border: '1.5px solid #374151' }} className="p-2" colSpan={8}>
                    <textarea
                      rows={3}
                      className="w-full resize-none outline-none bg-transparent text-xs leading-relaxed p-1"
                      style={{ touchAction: 'pan-y' }}
                      onWheel={handleWheel}
                      value={hoursPlan.notes || ''}
                      onChange={(e) => updateHoursPlanField('notes', e.target.value)}
                      placeholder="特記事項があれば入力してください"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* データがステータス不一致または存在しない場合のプレースホルダー */}
      {!isPeriodStatusMatch && (
        <div className="bg-white border border-slate-200 rounded-3xl p-20 text-center text-slate-400">
          {showArchived 
            ? 'アーカイブされた書類はありません。' 
            : 'この月はアーカイブされています。「アーカイブを見る」をONにしてご覧ください。'}
        </div>
      )}

      {/* インポートモーダル */}
      <ProfessionalPlanImportModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onImport={handleImportComplete}
        childId={childId || ''}
      />

      {/* 一括印刷コンテナ */}
      {printAllData && (
        <ProfessionalPlanPrintAll
          draftPlan={printAllData.draftPlan}
          finalPlan={printAllData.finalPlan}
          hoursPlan={printAllData.hoursPlan}
          selectedChild={selectedChild}
          officeName={officeName}
        />
      )}
    </div>
  );
};
