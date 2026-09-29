import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Plus, Archive, RefreshCw,
  Save, User as UserIcon, Target, Calendar, ChevronRight,
  Loader2, Printer, Download,
  ChevronLeft, Trash2, X, Check, UploadCloud, Copy, AlertTriangle, Sparkles, Eye, EyeOff, FileSpreadsheet, Edit3,
  Undo2, Redo2
} from 'lucide-react';
import { SupportImplementationRow } from './SupportImplementationRow';
import { DailyReportImportModal } from '../components/DailyReportImportModal';
import { ResultImportModal } from '../components/ResultImportModal';
import { parseGoalsText } from '../lib/utils';
import { performUndo, performRedo, type ImportHistoryAction } from '../lib/importHistory';
import {
  doc, getDoc, getDocs, setDoc, writeBatch,
  collection, query, where, documentId,
  serverTimestamp
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { convertToResult, GeminiApiError } from '../lib/aiConvert';
import type { Child } from '../data/mockData';
import type { DailyReport, SupportPlanMeta } from '../types/supportPlan';
import type { ProfessionalPlanDoc } from '../types/professionalPlan';
import { exportSupportImplementation, exportToExistingExcel, overwriteExistingExcelFile } from '../lib/excelExport';
import { FloatingActionMenu, type Action } from '../components/FloatingActionMenu';

const PLAN_COL = 'supportPlans';
const PROF_PLAN_COL = 'professionalPlans';
const DAILY_COL = 'daily_reports';




type SupportImplementationProps = {
  childrenData: Child[];
  selectedOfficeId: string;
  offices: { id: string; name: string }[];
};

export const SupportImplementation: React.FC<SupportImplementationProps> = ({ childrenData, selectedOfficeId, offices }) => {
  const currentOffice = offices.find(o => o.id === selectedOfficeId);
  const officeName = currentOffice ? currentOffice.name : 'Search';
  const { childId, month: urlMonth } = useParams<{ childId: string; month?: string }>();
  const navigate = useNavigate();

  // 1) 月がURLにない場合はリダイレクト
  useEffect(() => {
    if (childId && !urlMonth) {
      const m = new Date().toISOString().slice(0, 7);
      navigate(`/children/${childId}/support-plan/${m}`, { replace: true });
    }
  }, [childId, urlMonth, navigate]);

  const currentMonth = urlMonth || new Date().toISOString().slice(0, 7);

  const [planMeta, setPlanMeta] = useState<SupportPlanMeta | null>(null);
  const [profPlan, setProfPlan] = useState<ProfessionalPlanDoc | null>(null);
  const [rows, setRows] = useState<DailyReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newsletters, setNewsletters] = useState<Record<string, string>>({});
  const [futurePlans, setFuturePlans] = useState<Record<string, string>>({});
  const [isConverting, setIsConverting] = useState(false);
  // 日付編集中の行インデックス (null = 全行ロック)
  const [editingDateIdx, setEditingDateIdx] = useState<number | null>(null);
  const [isNewsletterCollapsed, setIsNewsletterCollapsed] = useState(true);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [monthlySettings, setMonthlySettings] = useState<any>(null);
  const [availableProfPlans, setAvailableProfPlans] = useState<ProfessionalPlanDoc[]>([]);
  const [loginStaffName, setLoginStaffName] = useState<string>("");
  const [loginOfficeId, setLoginOfficeId] = useState<string>("");
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const isInitialLoad = React.useRef(true);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isResultImportOpen, setIsResultImportOpen] = useState(false);
  const [exportLogs, setExportLogs] = useState<string[]>([]);
  const [isExportLogOpen, setIsExportLogOpen] = useState(false);
  const [isExportSuccessOpen, setIsExportSuccessOpen] = useState(false);
  const [exportSuccessType, setExportSuccessType] = useState<'direct' | 'download'>('direct');
  const [targetFileName, setTargetFileName] = useState('');
  const [isEditingGoals, setIsEditingGoals] = useState(false);
  const [isDeleteMenuOpen, setIsDeleteMenuOpen] = useState(false);

  // アンドゥ・リドゥ（Undo / Redo）履歴管理
  const [undoStack, setUndoStack] = useState<ImportHistoryAction[]>([]);
  const [redoStack, setRedoStack] = useState<ImportHistoryAction[]>([]);
  const [isUndoRedoing, setIsUndoRedoing] = useState(false);
  const [recentlyImportedDates, setRecentlyImportedDates] = useState<Set<string>>(new Set());
  const [historyToast, setHistoryToast] = useState<{
    message: string;
    actionId?: string;
    type: 'success' | 'undo' | 'redo';
    canUndo?: boolean;
    canRedo?: boolean;
  } | null>(null);

  const selectedChild = childId ? childrenData.find(c => c.id === childId) : null;

  const [rawError, setRawError] = useState<string | null>(null);
  const [debugError, setDebugError] = useState<{
    message: string;
    url: string;
    model: string;
    payload: any;
    availableModels: string[];
    listModelsError?: string;
    httpStatus?: number;
    httpResponse?: string;
    retryAfter?: string;
    requestCount?: string;
    errorDetails?: any;
  } | null>(null);
  const [isCopied, setIsCopied] = useState(false);

  const handleCopyDebugInfo = () => {
    if (!debugError) return;
    const text = `【Gemini API 変換エラー詳細】
エラー内容: ${debugError.message}
HTTPステータス: ${debugError.httpStatus ?? 'N/A'}
Retry-After (推奨待機秒数): ${debugError.retryAfter ?? '検出なし'}
送信回数: ${debugError.requestCount ?? 'N/A'}
送信URL: ${debugError.url}
送信モデル: ${debugError.model}
利用可能モデル一覧 (ListModels結果):
${JSON.stringify(debugError.availableModels, null, 2)}
ListModels実行時エラー: ${debugError.listModelsError ?? 'なし'}
リクエスト内容 (JSON):
${debugError.payload ? JSON.stringify(debugError.payload, null, 2) : 'N/A'}
レスポンス内容 (HTTP Response):
${debugError.httpResponse ?? 'N/A'}
APIエラー詳細 (JSON):
${debugError.errorDetails ? JSON.stringify(debugError.errorDetails, null, 2) : 'なし'}`;

    navigator.clipboard.writeText(text);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  // ---- データ取得 ----
  const fetchData = useCallback(async () => {
    if (!childId || childrenData.length === 0) return;
    console.time(`fetchData-${childId}`);
    setIsLoading(true);
    setRawError(null);

    try {
      const docId = selectedOfficeId ? `${selectedOfficeId}_${childId}_${currentMonth}` : `${childId}_${currentMonth}`;
      
      // 1) ログインスタッフ情報と事業所IDの取得
      let officeId = selectedOfficeId;
      let sName = "";
      if (auth.currentUser) {
        const staffSnap = await getDoc(doc(db, 'staff', auth.currentUser.uid));
        if (staffSnap.exists()) {
          const staffData = staffSnap.data();
          sName = staffData.name || staffData.fullName || "";
        }
      }
      setLoginOfficeId(officeId);
      setLoginStaffName(sName);

      // 2) 各種データを並列取得
      const startPath = `${currentMonth}-01`;
      const endPath = `${currentMonth}-31`;
      
      const queries = [
        getDoc(doc(db, PLAN_COL, docId)),
        getDocs(query(
          collection(db, PROF_PLAN_COL),
          where('childId', '==', childId),
          where('officeId', '==', selectedOfficeId),
          where('status', '==', 'final')
        )),
        getDocs(query(
          collection(db, DAILY_COL), 
          where('childId', '==', childId), 
          where('planMonth', '==', currentMonth),
          where('officeId', '==', selectedOfficeId)
        )),
        getDoc(doc(db, 'monthlySettings', currentMonth)),
        // reports (プレフィックスなし)
        getDocs(query(
          collection(db, 'reports'), 
          where(documentId(), '>=', startPath), 
          where(documentId(), '<=', endPath)
        ))
      ];

      // reports (プレフィックスあり)
      if (officeId) {
        const startPathPrefixed = `${officeId}_${currentMonth}-01`;
        const endPathPrefixed = `${officeId}_${currentMonth}-31`;
        queries.push(
          getDocs(query(
            collection(db, 'reports'), 
            where(documentId(), '>=', startPathPrefixed), 
            where(documentId(), '<=', endPathPrefixed)
          ))
        );
      }

      // children/{childId}/app_categories/書類管理/tree_communications の取得
      const treeCommRef = collection(db, 'children', childId, 'app_categories', '書類管理', 'tree_communications');
      queries.push(
        getDocs(treeCommRef) // 全件ロードに変更（サブコレクションのdocumentId比較エラーを回避）
      );

      const results = await Promise.all(queries);
      
      const metaSnap = results[0] as any;
      const profDocs = results[1] as any;
      const dailySnap = results[2] as any;
      const settingsSnap = results[3] as any;
      const reportSnap1 = results[4] as any;
      const reportSnap2 = officeId ? results[5] as any : null;
      const treeCommSnap = results[results.length - 1] as any;

      // 計画メタ情報
      let meta: SupportPlanMeta;
      if (metaSnap.exists()) {
        meta = metaSnap.data() as SupportPlanMeta;
      } else {
        // フォールバック: プレフィックスなしドキュメントの取得を試行
        const fallbackDocId = `${childId}_${currentMonth}`;
        const fallbackSnap = await getDoc(doc(db, PLAN_COL, fallbackDocId));
        if (fallbackSnap.exists()) {
          meta = fallbackSnap.data() as SupportPlanMeta;
        } else {
          meta = { 
            childId, month: currentMonth, goals: "", 
            author: "スタッフ 太郎", createdAt: new Date().toISOString() 
          };
        }
      }
      setPlanMeta(meta);

      // プロフェッショナルプラン一覧を保存
      let list: ProfessionalPlanDoc[] = [];
      if (profDocs && !profDocs.empty) {
        list = profDocs.docs.map((d: any) => ({ ...d.data(), id: d.id } as ProfessionalPlanDoc));
      }
      setAvailableProfPlans(list);

      // 月別設定
      if (settingsSnap.exists()) {
        setMonthlySettings(settingsSnap.data());
      } else {
        setMonthlySettings(null);
      }

      // ツリー通信 (reports) と 今後の予定 のパース
      const newsMap: Record<string, string> = {};
      const futurePlanMap: Record<string, string> = {};
      const futurePlanUpdatedAtMap: Record<string, string> = {};
      const newsUpdatedAtMap: Record<string, string> = {};
      const [yearStr, monthStr] = meta.month.split('-');
      const currentMonthInt = parseInt(monthStr, 10);
      const currentYearInt = parseInt(yearStr, 10);
      const currentOfficeTag = selectedOfficeId === 'LNrWc8f6G703aUYRZ5e2' ? 'サーチ' : selectedOfficeId === 'nWioUcWXUskreYjmSL8p' ? 'ホーム' : '';

      const processReportSnap = (snap: any) => {
        if (!snap) return;
        snap.forEach((d: any) => {
          const data = d.data();
          const childResult = data.results?.[childId];
          if (childResult) {
            const parts = d.id.split('_');
            let docOfficeId: string | null = null;
            let dateStr = d.id;
            if (parts.length === 2) {
              docOfficeId = parts[0];
              dateStr = parts[1];
            }

            // 1. 異なる事業所のレポートデータはスキップ
            if (docOfficeId && docOfficeId !== selectedOfficeId) {
              return;
            }

            // 2. 複数事業所に所属する場合、事業所プレフィックスがないドキュメントは混同回避のためスキップ
            const childOfficeTags = selectedChild && Array.isArray(selectedChild.offices)
              ? selectedChild.offices
              : selectedChild && typeof selectedChild.offices === 'string'
                ? [selectedChild.offices]
                : [];
            if (childOfficeTags.length > 1 && !docOfficeId) {
              return;
            }

            const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (match) {
              const yNum = parseInt(match[1], 10);
              const mNum = parseInt(match[2], 10);
              const dNum = parseInt(match[3], 10);

              if (yNum === currentYearInt && mNum === currentMonthInt) {
                const dateKey = `${mNum}月${dNum}日`;
                const updatedAtStr = data.updatedAt || data.createdAt || "";

                if (childResult.D) {
                  const existingText = newsMap[dateKey];
                  const existingUpdate = newsUpdatedAtMap[dateKey] || "";
                  if (!existingText || !existingUpdate || updatedAtStr >= existingUpdate) {
                    newsMap[dateKey] = childResult.D;
                    newsUpdatedAtMap[dateKey] = updatedAtStr;
                  }
                }

                // reports の results[childId].futurePlan / future_plan
                const repFuture = childResult.futurePlan || childResult.future_plan;
                if (repFuture) {
                  const existingPlan = futurePlanMap[dateKey];
                  const existingUpdate = futurePlanUpdatedAtMap[dateKey] || "";
                  if (!existingPlan || !existingUpdate || updatedAtStr >= existingUpdate) {
                    futurePlanMap[dateKey] = repFuture;
                    futurePlanUpdatedAtMap[dateKey] = updatedAtStr;
                  }
                }
              }
            }
          }
        });
      };
      processReportSnap(reportSnap1);
      processReportSnap(reportSnap2);

      if (treeCommSnap && !treeCommSnap.empty) {
        treeCommSnap.forEach((d: any) => {
          const data = d.data();
          
          const parts = d.id.split('_');
          let docOfficeId: string | null = null;
          let dateStr = d.id;
          if (parts.length === 2) {
            docOfficeId = parts[0];
            dateStr = parts[1];
          }

          // 1. 他の事業所のIDプレフィックスならスキップ
          if (docOfficeId && docOfficeId !== selectedOfficeId) {
            return;
          }
          // データ内のofficeId / officeフィールドでのフィルタ
          if (data.officeId && data.officeId !== selectedOfficeId) {
            return;
          }
          if (data.office && data.office !== currentOfficeTag) {
            return;
          }

          // 2. 複数所属の児童で、事業所情報が一切無いデータは混同回避のためスキップ
          const childOfficeTags = selectedChild && Array.isArray(selectedChild.offices)
            ? selectedChild.offices
            : selectedChild && typeof selectedChild.offices === 'string'
              ? [selectedChild.offices]
              : [];
          if (childOfficeTags.length > 1 && !docOfficeId && !data.officeId && !data.office) {
            return;
          }

          const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
          if (match) {
            const yearNum = parseInt(match[1], 10);
            const mNum = parseInt(match[2], 10);
            const dNum = parseInt(match[3], 10);
            
            // クエリが全件取得になったため、JS側で対象年月の日報のみフィルタリング
            if (yearNum === currentYearInt && mNum === currentMonthInt) {
              const key = `${mNum}月${dNum}日`;
              const updatedAtStr = data.updatedAt || data.createdAt || "";

              const tcFuture = data.future_plan || data.futurePlan;
              if (tcFuture) {
                const existingPlan = futurePlanMap[key];
                const existingUpdate = futurePlanUpdatedAtMap[key] || "";
                if (!existingPlan || !existingUpdate || updatedAtStr > existingUpdate) {
                  futurePlanMap[key] = tcFuture;
                  futurePlanUpdatedAtMap[key] = updatedAtStr;
                }
              }
              const tcText = data.tree_comm_text || (data.results?.[childId]?.D);
              if (tcText) {
                const existingText = newsMap[key];
                const existingUpdate = newsUpdatedAtMap[key] || "";
                if (!existingText || !existingUpdate || updatedAtStr > existingUpdate) {
                  newsMap[key] = tcText;
                  newsUpdatedAtMap[key] = updatedAtStr;
                }
              }
            }
          }
        });
      }
      setNewsletters(newsMap);
      setFuturePlans(futurePlanMap);

      // daily_reports の処理
      const savedRowsGrouped: Record<string, any[]> = {};
      dailySnap.docs.forEach((d: any) => {
        const data = d.data();
        let dateStr = "";
        let dObj: Date | null = null;

        // 日付の解析 (Timestamp または 文字列)
        if (data.date && typeof data.date.toDate === 'function') {
          const dateObj = data.date.toDate();
          dObj = dateObj;
          dateStr = `${dateObj.getMonth() + 1}月${dateObj.getDate()}日`;
        } else if (typeof data.date === 'string') {
          const parts = data.date.split('-');
          if (parts.length === 3) {
            const mNum = parseInt(parts[1], 10);
            const dNum = parseInt(parts[2], 10);
            dateStr = `${mNum}月${dNum}日`;
            dObj = new Date(parseInt(parts[0], 10), mNum - 1, dNum);
          } else {
            const parsed = new Date(data.date);
            if (!isNaN(parsed.getTime())) {
              dObj = parsed;
              dateStr = `${dObj.getMonth() + 1}月${dObj.getDate()}日`;
            } else {
              dateStr = data.date;
            }
          }
        }

        if (dateStr) {
          const [targetYear, targetMonth] = meta.month.split('-');
          if (dObj) {
            if (dObj.getFullYear() !== parseInt(targetYear, 10) || (dObj.getMonth() + 1) !== parseInt(targetMonth, 10)) {
              return; // 対象月以外はスキップ
            }
          }

          const externalInfo = data.content?.externalInfo || data.externalInfo || "";
          const supportContent = data.content?.supportContent || [];
          const resultInfo = data.content?.resultInfo || "";
          const futurePlan = data.content?.futurePlan || "";
          const isVerified = data.content?.isVerified || false;
          const staffId = data.staffId || data.staffName || "";

          if (!savedRowsGrouped[dateStr]) savedRowsGrouped[dateStr] = [];
          savedRowsGrouped[dateStr].push({
            id: d.id,
            ...data,
            date: dateStr,
            staffId,
            content: { externalInfo, supportContent, resultInfo, futurePlan, isVerified }
          });
        }
      });

      // 統合（ツリー通信の日付 or 今後の予定の日付 or 保存済みの日付）
      const allDates = Array.from(new Set([
        ...Object.keys(newsMap), 
        ...Object.keys(futurePlanMap), 
        ...Object.keys(savedRowsGrouped)
      ]));
      const monthNum = parseInt(meta.month.split('-')[1] || '0', 10);
      const excludedDatesSet = new Set(meta.excludedDates || []);

      const targetDates = allDates.filter(d => {
        if (excludedDatesSet.has(d)) return false;
        const m = d.match(/^(\d+)月/);
        return m && (monthNum === 0 || parseInt(m[1]) === monthNum);
      }).sort((a, b) => {
        const parse = (s: string) => {
          const m = s.match(/(\d+)月(\d+)日/);
          return m ? parseInt(m[1]) * 100 + parseInt(m[2]) : 0;
        };
        return parse(a) - parse(b);
      });

      const finalRows: DailyReport[] = [];
      targetDates.forEach(date => {
        const savedList = savedRowsGrouped[date] || [];
        
        if (savedList.length > 0) {
          savedList.forEach(saved => {
            const externalInfo = saved.content.externalInfo?.trim() 
              ? saved.content.externalInfo 
              : (newsMap[date] || "");
            const futurePlan = saved.content.futurePlan?.trim() 
              ? saved.content.futurePlan 
              : (futurePlanMap[date] || "");
            finalRows.push({
              id: saved.id,
              childId,
              planMonth: meta.month,
              date: date,
              staffId: saved.staffId || "",
              type: 'tree_report',
              content: {
                externalInfo,
                supportContent: saved.content.supportContent || [],
                resultInfo: saved.content.resultInfo || "",
                futurePlan,
                isVerified: saved.content.isVerified || false,
              },
              archived: saved.archived || false,
              createdAt: saved.createdAt || new Date().toISOString(),
              updatedAt: saved.updatedAt || new Date().toISOString(),
            });
          });
        } else {
          // 保存データはないがツリー通信がある場合（バーチャル行）
          finalRows.push({
            childId,
            planMonth: meta.month,
            date: date,
            staffId: "",
            type: 'tree_report',
            content: {
              externalInfo: newsMap[date] || "",
              supportContent: [],
              resultInfo: "",
              futurePlan: futurePlanMap[date] || "",
              isVerified: false,
            },
            archived: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
      });

      // 1行もなければ空行追加
      if (finalRows.length === 0) {
        finalRows.push({
          childId, planMonth: meta.month, date: `${monthNum}月1日`,
          staffId: "", type: 'tree_report',
          content: { externalInfo: "", supportContent: [], resultInfo: "", futurePlan: "" },
          archived: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        });
      }

      const active = finalRows.filter(r => !r.archived);
      const archived = finalRows.filter(r => r.archived);
      setRows([...active, ...archived]);

      // ボタンでの個別同期用に newsletters state に登録
      setNewsletters(newsMap);
      setFuturePlans(futurePlanMap);

    } catch (e: any) {
      console.error('fetchData error:', e);
      setRawError(e.message || String(e));
    } finally {
      setIsLoading(false);
      isInitialLoad.current = true; // 初回無視フラグ
      console.timeEnd(`fetchData-${childId}`);
    }
  }, [childId, currentMonth, childrenData.length, selectedOfficeId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // 選択された反映元の専門的支援計画書を動的に決定
  useEffect(() => {
    if (!planMeta) return;
    let latestProf: ProfessionalPlanDoc | null = null;
    
    if (availableProfPlans.length > 0) {
      if (planMeta.selectedProfPlanId && planMeta.selectedProfPlanId !== 'auto') {
        latestProf = availableProfPlans.find(p => p.id === planMeta.selectedProfPlanId) || null;
      }
      
      if (!latestProf) {
        // フォールバック（自動選択）
        const matched = availableProfPlans.find((p: any) => 
          p.isReflected && 
          p.reflectedStartMonth && 
          p.reflectedEndMonth && 
          currentMonth >= p.reflectedStartMonth && 
          currentMonth <= p.reflectedEndMonth
        );

        if (matched) {
          latestProf = matched;
        } else {
          const pastPlans = availableProfPlans.filter((p: any) => {
            const m = p.startMonth || (p.createdAt ? p.createdAt.slice(0, 7) : "");
            return m && m <= currentMonth;
          });

          if (pastPlans.length > 0) {
            pastPlans.sort((a: any, b: any) => {
              const aM = a.startMonth || (a.createdAt ? a.createdAt.slice(0, 7) : "");
              const bM = b.startMonth || (b.createdAt ? b.createdAt.slice(0, 7) : "");
              return aM.localeCompare(bM);
            });
            latestProf = pastPlans[pastPlans.length - 1];
          }
        }
      }
    }
    setProfPlan(latestProf);
  }, [planMeta?.selectedProfPlanId, availableProfPlans, currentMonth]);

  // ---- 保存 ----
  const handleSave = useCallback(async () => {
    if (!planMeta || !childId) return;
    setSaveStatus('saving');
    try {
      const docId = selectedOfficeId ? `${selectedOfficeId}_${childId}_${currentMonth}` : `${childId}_${currentMonth}`;
      await setDoc(doc(db, PLAN_COL, docId), {
        ...planMeta,
        officeId: selectedOfficeId,
      }, { merge: true });

      const batch = writeBatch(db);
      const updatedRows = [...rows];

      for (let i = 0; i < updatedRows.length; i++) {
        const row = updatedRows[i];
        const [yearStr] = planMeta.month.split('-');
        const mMatch = row.date.match(/(\d+)月/);
        const dMatch = row.date.match(/(\d+)日/);
        const monthNum = mMatch ? parseInt(mMatch[1]) : 1;
        const dayNum = dMatch ? parseInt(dMatch[1]) : 1;

        const pad = (n: number) => n.toString().padStart(2, '0');
        const formattedDate = `${yearStr}-${pad(monthNum)}-${pad(dayNum)}`;

        // A) daily_reports (個別報告書) の保存
        const payload: any = {
          childId: row.childId,
          planMonth: row.planMonth,
          date: formattedDate, // 文字列形式で保存してパースエラー解消
          staffId: row.staffId,
          staffName: loginStaffName || row.staffId || "", // 直下に staffName も保存
          type: row.type,
          content: row.content,
          externalInfo: row.content.externalInfo || "", // 直下に externalInfo も保存
          archived: row.archived,
          officeId: selectedOfficeId,
          updatedAt: serverTimestamp(),
        };

        if (!row.id) {
          const newDocRef = doc(collection(db, DAILY_COL));
          payload.createdAt = serverTimestamp();
          batch.set(newDocRef, payload);
          updatedRows[i] = { ...row, id: newDocRef.id };
        } else {
          const existingDocRef = doc(db, DAILY_COL, row.id);
          batch.update(existingDocRef, payload);
        }

        // B) reports (日次一括レポート) の保存 (プレフィックスなし / あり両方に書き込み)
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

        if (loginOfficeId) {
          const reportRefPref = doc(db, 'reports', `${loginOfficeId}_${formattedDate}`);
          batch.set(reportRefPref, reportDoc, { merge: true });
        }

        // C) children/{児童ID}/.../tree_communications/ の保存（プレフィックスあり・なし両方に書き込み / フィールド追加）
        const childTreeDoc = {
          name: selectedChild?.fullName || "",
          tree_comm_text: row.content.externalInfo || "",
          future_plan: row.content.futurePlan || "",
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
      }

      await batch.commit();

      // 新規割り当てIDをステートに反映させつつ、その直後の自動保存 useEffect 呼び出しを抑止する
      isInitialLoad.current = true;
      setRows(updatedRows);

      setSaveStatus('saved');
      setTimeout(() => {
        setSaveStatus(prev => prev === 'saved' ? 'idle' : prev);
      }, 2000);
    } catch (e) {
      console.error("Save error:", e);
      setSaveStatus('error');
      setTimeout(() => {
        setSaveStatus(prev => prev === 'error' ? 'idle' : prev);
      }, 3000);
    }
  }, [childId, currentMonth, planMeta, rows, loginStaffName, loginOfficeId, selectedChild, selectedOfficeId]);

  // ---- 自動保存デバウンス監視 ----
  useEffect(() => {
    if (isLoading || isConverting) return; // AI変換中は自動保存をトリガーしない

    if (isInitialLoad.current) {
      isInitialLoad.current = false;
      return;
    }

    const timer = setTimeout(() => {
      handleSave();
    }, 2000); // 2秒デバウンス

    return () => clearTimeout(timer);
  }, [rows, planMeta, isLoading, isConverting, handleSave]);



  const handleSyncFromNewsletter = (rowIdx: number, rowDate: string) => {
    if (!rowDate) {
      alert('日付を入力してください（例: 4月1日）');
      return;
    }
    const content = newsletters[rowDate];
    const plan = futurePlans[rowDate];
    if (content || plan) {
      if (content) {
        updateRowContent(rowIdx, 'externalInfo', content);
      }
      if (plan) {
        updateRowContent(rowIdx, 'futurePlan', plan);
      }
    } else {
      alert(`「${rowDate}」のツリー通信および今後の予定が見つかりませんでした。`);
    }
  };

  // ---- 全行の日付をツリー通信のキー（日付文字列）で同期 ----
  const syncAllDates = () => {
    const newsletterDates = Object.keys(newsletters).sort((a, b) => {
      const parse = (s: string) => {
        const m = s.match(/(\d+)月(\d+)日/);
        return m ? parseInt(m[1]) * 100 + parseInt(m[2]) : 0;
      };
      return parse(a) - parse(b);
    });
    if (newsletterDates.length === 0) {
      alert('ツリー通信のデータが見つかりません。先にデータを取得してください。');
      return;
    }
    setRows(prev =>
      prev.map((row, i) => ({
        ...row,
        date: newsletterDates[i] ?? row.date,
      }))
    );
    setEditingDateIdx(null);
  };

  // ---- 選択した（または全ての）ツリー通信を日付別でコピー ----
  const handleCopyTreeCommunications = () => {
    let targetRows = rows;
    
    if (isSelectionMode && selectedRowIds.size > 0) {
      targetRows = rows.filter(r => selectedRowIds.has(`${childId}_${r.date}`));
    }

    if (targetRows.length === 0) {
      alert('コピー対象の行が見つかりません。');
      return;
    }

    const [year, month] = currentMonth.split('-');
    const formattedMonth = `${year}年${parseInt(month, 10)}月`;
    
    const parseDateKey = (s: string) => {
      const m = s.match(/(\d+)月(\d+)日/);
      return m ? parseInt(m[1]) * 100 + parseInt(m[2]) : 0;
    };

    const sortedRows = [...targetRows].sort((a, b) => parseDateKey(a.date) - parseDateKey(b.date));
    
    let copyText = `【対象月】${formattedMonth}\n\n`;
    let count = 0;

    sortedRows.forEach(row => {
      // 療育を行った結果が既に入力されている行はコピー対象外とする
      const hasResult = !!(row.content?.resultInfo && row.content.resultInfo.trim());
      if (hasResult) return;

      const content = (row.content?.externalInfo || newsletters[row.date] || '').trim();
      if (content) {
        copyText += `■ ${row.date}\n${content}\n\n`;
        count++;
      }
    });

    if (count === 0) {
      alert('療育結果が未入力のツリー通信がありません。（すべての日の療育結果が入力済みです）');
      return;
    }

    navigator.clipboard.writeText(copyText.trim() + '\n')
      .then(() => {
        alert(`療育結果が未入力の ${count}件 のツリー通信をコピーしました。(児童名は個人情報保護のため除外しています)`);
      })
      .catch(err => {
        console.error('Failed to copy: ', err);
        alert('コピーに失敗しました。お使いのブラウザの設定をご確認ください。');
      });
  };

  // ---- Geminiでの変換結果を一括登録 ----
  const handleImportResults = (importedResults: Record<string, string>) => {
    let count = 0;
    const updatedRows = rows.map(row => {
      const resultText = importedResults[row.date];
      if (resultText !== undefined) {
        count++;
        return {
          ...row,
          content: {
            ...row.content,
            resultInfo: resultText,
            futurePlan: row.content.futurePlan?.trim() 
              ? row.content.futurePlan 
              : (futurePlans[row.date] || ""),
            isVerified: false
          }
        };
      }
      return row;
    });

    setRows(updatedRows);
    alert(`${count}件の日付について療育結果を登録しました。\n(自動保存または「保存する」ボタンで保存されます)`);
    setIsResultImportOpen(false);
  };

  const addRow = () => {
    if (!planMeta) return;
    const mNum = parseInt(planMeta.month.split('-')[1] || '1', 10);
    const newDate = `${mNum}月1日`;
    if (planMeta.excludedDates?.includes(newDate)) {
      setPlanMeta(prev => prev ? {
        ...prev,
        excludedDates: prev.excludedDates?.filter(d => d !== newDate)
      } : prev);
    }
    setRows(prev => [...prev, {
      childId: childId!,
      planMonth: planMeta.month,
      date: newDate,
      staffId: '',
      type: 'tree_report',
      content: { externalInfo: '', supportContent: [], resultInfo: '', futurePlan: '' },
      archived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }]);
  };

  const archiveRow = (idx: number) => {
    setRows(prev => {
      const toggled = prev[idx].archived;
      const updated = prev.map((r, i) => i === idx ? { ...r, archived: !toggled } : r);
      const active = updated.filter(r => !r.archived);
      const archived = updated.filter(r => r.archived);
      return [...active, ...archived];
    });
  };

  const updateRowDate = (idx: number, part: 'month' | 'day', val: string) => {
    setRows(prev => {
      const row = prev[idx];
      const currentMonth = row.date.match(/(\d+)月/)?.[1] ?? '';
      const currentDay = row.date.match(/(\d+)日/)?.[1] ?? '';
      const newDate = part === 'month'
        ? `${val}月${currentDay ? currentDay + '日' : ''}`
        : `${currentMonth ? currentMonth + '月' : ''}${val}日`;
        
      if (planMeta?.excludedDates?.includes(newDate)) {
        setPlanMeta(prev => prev ? {
          ...prev,
          excludedDates: prev.excludedDates?.filter(d => d !== newDate)
        } : prev);
      }
        
      const content = newsletters[newDate] || '';
      const plan = futurePlans[newDate] || '';

      return prev.map((r, i) => i === idx ? { 
        ...r, 
        date: newDate,
        content: {
          ...r.content,
          externalInfo: content || r.content.externalInfo,
          futurePlan: plan || r.content.futurePlan
        }
      } : r);
    });
  };

  const updateRowContent = (idx: number, field: keyof DailyReport['content'], value: any) => {
    setRows(prev => prev.map((r, i) =>
      i === idx ? { ...r, content: { ...r.content, [field]: value } } : r
    ));
  };

  const toggleSupportContent = (rowIdx: number, option: string) => {
    const currentRow = rows[rowIdx];
    const currentSelected = currentRow.content.supportContent || [];
    let nextSelected: string[];

    if (currentSelected.includes(option)) {
      nextSelected = currentSelected.filter(o => o !== option);
    } else {
      if (currentSelected.length >= 5) {
        alert('療育内容は5項目まで選択可能です。');
        return;
      }
      nextSelected = [...currentSelected, option];
    }
    updateRowContent(rowIdx, 'supportContent', nextSelected);
  };

  const handleMonthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newMonth = e.target.value;
    if (newMonth) {
      navigate(`/children/${childId}/support-plan/${newMonth}`);
    }
  };

  useEffect(() => { if (planMeta?.month) fetchData(); }, [planMeta?.month]);

  const abortControllerRef = React.useRef<AbortController | null>(null);

  // コンポーネント離脱時にキャンセル & セキュリティのためキーをクリア
  useEffect(() => {
    sessionStorage.removeItem('GEMINI_API_KEY'); // 既存のキーがあれば削除
    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
      sessionStorage.removeItem('GEMINI_API_KEY'); // 離脱時にも念のため
    };
  }, []);



  // AI単一処理
  const handleSingleAiConvert = async (idx: number) => {
    if (isConverting) return;
    const row = rows[idx];
    if (!row.content.externalInfo?.trim()) {
      alert('変換対象のツリー通信がありません。');
      return;
    }

    let apiKey = sessionStorage.getItem('GEMINI_API_KEY') || '';
    if (!apiKey) {
      apiKey = window.prompt('Gemini APIキーを入力してください。\n(入力されたキーはセッション中のみ一時的に保持されます)') || '';
      if (apiKey) {
        sessionStorage.setItem('GEMINI_API_KEY', apiKey);
      }
    }
    if (!apiKey) return;

    setIsConverting(true);
    try {
      // モデルは aiConvert.ts 内で gemini-1.5-flash に完全固定済み。動的選択は行わない。
      const res = await convertToResult(row.content.externalInfo, apiKey, undefined, "1 / 1 (個別変換)");
      updateRowContent(idx, 'resultInfo', res);
      alert('変換が完了しました。');
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        if (e instanceof GeminiApiError) {
          setDebugError({
            message: e.message,
            ...e.debugInfo
          });
        } else if (e.debugInfo) {
          setDebugError({
            message: e.message,
            ...e.debugInfo
          });
        } else {
          setDebugError({
            message: e.message || String(e),
            url: 'N/A',
            model: 'N/A',
            payload: null,
            availableModels: []
          });
        }
      }
    } finally {
      setIsConverting(false);
    }
  };

  // ---- 印刷 ----
  const handlePrint = () => {
    // アーカイブされていない行で、確認済みでない行があるかチェック
    const unverifiedRows = rows.filter(r => !r.archived && !r.content.isVerified);
    
    if (unverifiedRows.length > 0) {
      const confirmPrint = window.confirm(
        `確認が完了していない項目が ${unverifiedRows.length} 件あります。\nそのまま印刷しますか？`
      );
      if (!confirmPrint) return;
    }

    document.body.classList.add('print-impl');
    window.print();
    window.removeEventListener('afterprint', () => {}); // Cleanup just in case
    window.addEventListener('afterprint', () => {
      document.body.classList.remove('print-impl');
    }, { once: true });
  };

  const getTargetGoalsText = (): string => {
    let targetGoals = planMeta?.goals || '';
    if (profPlan) {
      const parts = [];
      
      // 長期目標・短期目標の複数項目フォーマット用のヘルパー
      const formatGoalText = (labelText: string, rawText: string | undefined): string | null => {
        if (!rawText || !rawText.trim()) return null;
        
        const items = rawText
          .split('\n')
          .map(line => line.trim().replace(/^[・\-\*\s\u30fb]+/g, ''))
          .filter(line => line.length > 0);
          
        if (items.length === 0) return null;
        
        let content = '';
        if (items.length === 1) {
          content = items[0];
        } else {
          const circleNumbers = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
          content = items.map((item, idx) => {
            const numPrefix = circleNumbers[idx] || `(${idx + 1})`;
            return `${numPrefix}${item}`;
          }).join('');
        }
        return `${labelText}：${content}`;
      };

      const longTerm = formatGoalText('長期目標', profPlan.longTermGoal);
      if (longTerm) parts.push(longTerm);
      
      const shortTerm = formatGoalText('短期目標', profPlan.shortTermGoal);
      if (shortTerm) parts.push(shortTerm);
      
      const rawGoals = (profPlan.supportRows || [])
        .filter((r: any) => r.supportGoal && r.supportGoal.trim() !== '')
        .map((r: any) => r.supportGoal.trim().replace(/^[・\-\*\s\u30fb]+/g, ''));
      
      if (rawGoals.length > 0) {
        const circleNumbers = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
        const formattedList = rawGoals.map((goal: string, idx: number) => {
          const numPrefix = circleNumbers[idx] || `(${idx + 1})`;
          return `${numPrefix}${goal}`;
        }).join('');
        
        parts.push(`具体的目標：${formattedList}`);
      }
      targetGoals = parts.join('\n');
    }
    return targetGoals;
  };

  const getExportMeta = () => {
    let dateStr = new Date().toISOString();
    if (monthlySettings?.implementationYear && monthlySettings?.implementationMonth && monthlySettings?.implementationDay) {
      const year = 2018 + parseInt(monthlySettings.implementationYear, 10);
      const month = parseInt(monthlySettings.implementationMonth, 10);
      const day = parseInt(monthlySettings.implementationDay, 10);
      if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
        dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00Z`;
      }
    } else {
      dateStr = planMeta?.createdAt 
        ? (typeof planMeta.createdAt === 'string' 
            ? planMeta.createdAt 
            : (planMeta.createdAt as any).toDate?.()?.toISOString() || new Date().toISOString()) 
        : new Date().toISOString();
    }
    const creator = monthlySettings?.implementationCreator || loginStaffName;
    return { exportDate: dateStr, exportCreator: creator };
  };

  const handleDirectOverwriteExcel = async () => {
    if (!selectedChild || !planMeta) return;

    const targetGoals = getTargetGoalsText();

    const { exportDate: formattedCreatedAt, exportCreator } = getExportMeta();

    if ('showOpenFilePicker' in window) {
      try {
        const [handle] = await (window as any).showOpenFilePicker({
          types: [{
            description: 'Excel Files',
            accept: {
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx']
            }
          }]
        });
        
        if (handle) {
          setSaveStatus('saving');
          setExportLogs([]);
          setTargetFileName(handle.name);
          await overwriteExistingExcelFile(
            handle,
            selectedChild.fullName,
            planMeta.month,
            targetGoals,
            rows,
            exportCreator,
            formattedCreatedAt,
            (msg) => setExportLogs(prev => [...prev, msg])
          );
          setSaveStatus('saved');
          setExportSuccessType('direct');
          setIsExportSuccessOpen(true);
          setTimeout(() => setSaveStatus('idle'), 2000);
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          console.log('ユーザーがキャンセルしました。');
          return;
        }
        setExportLogs(prev => [...prev, `エラーが発生しました: ${err.message || err}`]);
        console.error(err);
        alert(`既存エクセルへの上書きに失敗しました: ${err.message || err}`);
        setSaveStatus('error');
        setTimeout(() => setSaveStatus('idle'), 3000);
      }
    } else {
      const input = document.getElementById('excel-file-direct-fallback') as HTMLInputElement;
      if (input) {
        input.click();
      }
    }
  };

  const handleFallbackFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!selectedChild || !planMeta) return;
    const targetGoals = getTargetGoalsText();

    const fileName = `専門的支援実施計画_${selectedChild.fullName}_${planMeta.month}`;
    const { exportDate: formattedCreatedAt, exportCreator } = getExportMeta();

    try {
      setSaveStatus('saving');
      setExportLogs([]);
      setTargetFileName(file.name);
      await exportToExistingExcel(
        file,
        selectedChild.fullName,
        planMeta.month,
        targetGoals,
        rows,
        fileName,
        exportCreator,
        formattedCreatedAt,
        (msg) => setExportLogs(prev => [...prev, msg])
      );
      setSaveStatus('saved');
      setExportSuccessType('download');
      setIsExportSuccessOpen(true);
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (err: any) {
      setExportLogs(prev => [...prev, `エラーが発生しました: ${err.message || err}`]);
      console.error(err);
      alert(`既存エクセルへの上書きに失敗しました: ${err.message || err}`);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
    e.target.value = '';
  };

  const handleDownloadFallbackFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!selectedChild || !planMeta) return;
    const targetGoals = getTargetGoalsText();

    const fileName = `専門的支援実施計画_${selectedChild.fullName}_${planMeta.month}_上書き版`;
    const { exportDate: formattedCreatedAt, exportCreator } = getExportMeta();

    try {
      setSaveStatus('saving');
      setExportLogs([]);
      setTargetFileName(file.name);
      await exportToExistingExcel(
        file,
        selectedChild.fullName,
        planMeta.month,
        targetGoals,
        rows,
        fileName,
        exportCreator,
        formattedCreatedAt,
        (msg) => setExportLogs(prev => [...prev, msg])
      );
      setSaveStatus('saved');
      setExportSuccessType('download');
      setIsExportSuccessOpen(true);
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (err: any) {
      setExportLogs(prev => [...prev, `エラーが発生しました: ${err.message || err}`]);
      console.error(err);
      alert(`既存エクセルへの上書きダウンロードに失敗しました: ${err.message || err}`);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
    e.target.value = '';
  };

  const handleExcelExport = () => {
    if (!selectedChild || !planMeta) return;

    // 支援目標のテキスト作成（長期・短期・個別目標を統合）
    const targetGoals = getTargetGoalsText();

    const fileName = `専門的支援実施計画_${selectedChild.fullName}_${planMeta.month}`;
    const { exportDate: formattedCreatedAt, exportCreator } = getExportMeta();

    exportSupportImplementation(
      selectedChild.fullName,
      planMeta.month,
      targetGoals,
      rows,
      fileName,
      exportCreator,
      formattedCreatedAt
    );
  };


  // ---- 選択モード関連 ----
  const toggleSelection = (rowId: string) => {
    setSelectedRowIds(prev => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };

  // 日付の正規化ヘルパー (例: "4月1日" -> "2026-04-01")
  const formatDateToIso = (dateStr: string, planMonthStr?: string) => {
    const match = dateStr.match(/(\d+)月(\d+)日/);
    if (!match) return null;
    const targetMonth = planMonthStr || planMeta?.month || currentMonth;
    const [yearStr] = targetMonth.split('-');
    const mStr = match[1].padStart(2, '0');
    const dStr = match[2].padStart(2, '0');
    return `${yearStr}-${mStr}-${dStr}`;
  };

  // ---- 1行（その日）の専門的支援記録を完全削除 ----
  const handleDeleteRow = async (idx: number) => {
    const targetRow = rows[idx];
    if (!targetRow || !childId) return;

    if (!window.confirm(`「${targetRow.date}」の専門的支援記録を削除しますか？\n\n・入力済みの療育内容\n・療育を行った結果\n・今後の予定\n\n※この操作は上部の「元に戻す（Ctrl+Z）」で復元可能です。`)) {
      return;
    }

    try {
      setSaveStatus('saving');
      const formattedDate = formatDateToIso(targetRow.date);
      const dateKey = formattedDate || "";
      const prefDocId = selectedOfficeId ? `${selectedOfficeId}_${formattedDate}` : dateKey;

      // IDがない場合は新規生成してスナップショットを確実に紐付け
      const effectiveId = targetRow.id || doc(collection(db, DAILY_COL)).id;
      const effectiveRow: DailyReport = {
        ...targetRow,
        id: effectiveId,
        childId: targetRow.childId || childId,
        planMonth: targetRow.planMonth || planMeta?.month || currentMonth
      };

      // 削除前のスナップショットを作成（アンドゥ用）
      const deleteAction: ImportHistoryAction = {
        id: `delete-row-${Date.now()}`,
        timestamp: new Date().toISOString(),
        summary: `${targetRow.date}の支援記録削除`,
        officeId: selectedOfficeId || '',
        officeName: officeName || '',
        actionType: 'delete',
        deletedRows: [effectiveRow],
        deletedPlanMeta: planMeta ? { ...planMeta } : undefined,
        before: {
          supportPlans: planMeta ? [{
            docId: selectedOfficeId ? `${selectedOfficeId}_${childId}_${planMeta.month}` : `${childId}_${planMeta.month}`,
            hadExistingGoals: !!(planMeta.goals && planMeta.goals.trim()),
            goals: planMeta.goals || ""
          }] : [],
          dailyReports: [{
            id: effectiveId,
            isNew: false,
            data: effectiveRow
          }],
          createdDailyReportIds: [],
          treeComms: dateKey ? [{
            childId,
            dateKey,
            prefDocId,
            hadExisting: true,
            futurePlan: targetRow.content.futurePlan || futurePlans[targetRow.date] || ""
          }] : []
        },
        after: {
          supportPlans: [],
          dailyReports: [],
          treeComms: []
        }
      };

      const batch = writeBatch(db);

      // 1. daily_reports のドキュメント削除
      if (targetRow.id) {
        batch.delete(doc(db, DAILY_COL, targetRow.id));
      }

      // 2. tree_communications の future_plan も空文字にして更新
      if (formattedDate) {
        const prefRef = doc(db, `children/${childId}/app_categories/書類管理/tree_communications`, prefDocId);
        const noPrefRef = doc(db, `children/${childId}/app_categories/書類管理/tree_communications`, formattedDate);
        batch.set(prefRef, { future_plan: "", updatedAt: new Date().toISOString() }, { merge: true });
        batch.set(noPrefRef, { future_plan: "", updatedAt: new Date().toISOString() }, { merge: true });
      }

      // 3. supportPlans の excludedDates に targetRow.date を追加して保存
      const currentExcluded = new Set(planMeta?.excludedDates || []);
      currentExcluded.add(targetRow.date);
      const updatedExcludedDates = Array.from(currentExcluded);

      const targetMonth = planMeta?.month || currentMonth;
      const newPlanMeta: SupportPlanMeta = {
        ...(planMeta || {
          childId: childId,
          month: targetMonth,
          goals: "",
          author: loginStaffName || "スタッフ",
          createdAt: new Date().toISOString()
        }),
        excludedDates: updatedExcludedDates
      };

      const planDocPref = doc(db, PLAN_COL, `${selectedOfficeId}_${childId}_${targetMonth}`);
      const planDocNoPref = doc(db, PLAN_COL, `${childId}_${targetMonth}`);
      batch.set(planDocPref, { ...newPlanMeta, officeId: selectedOfficeId }, { merge: true });
      batch.set(planDocNoPref, { ...newPlanMeta, officeId: selectedOfficeId }, { merge: true });

      await batch.commit();

      setRecentlyImportedDates(prev => {
        const next = new Set(prev);
        next.delete(targetRow.date);
        return next;
      });

      // futurePlans state からも該当日の予定を削除
      setFuturePlans(prev => {
        const next = { ...prev };
        delete next[targetRow.date];
        return next;
      });

      // 自動保存の誤作動防止フラグを立ててから行をテーブルから完全削除
      isInitialLoad.current = true;
      setRows(prev => prev.filter((_, i) => i !== idx));
      setPlanMeta(newPlanMeta);

      // アンドゥスタックに追加 & トースト通知
      setUndoStack(prev => [...prev, deleteAction]);
      setRedoStack([]);
      setHistoryToast({
        message: `「${targetRow.date}」の専門的支援記録を削除しました`,
        type: 'undo',
        canUndo: true
      });

      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 1500);
    } catch (err: any) {
      console.error("Delete row error:", err);
      alert(`削除に失敗しました: ${err.message || String(err)}`);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  // ---- 選択した行の一括削除 ----
  const handleDeleteSelected = async () => {
    if (selectedRowIds.size === 0 || !childId) return;
    if (!window.confirm(`選択された${selectedRowIds.size}件の記録を削除しますか？\n（療育内容・結果・今後の予定が削除されます）\n\n※この操作は上部の「元に戻す（Ctrl+Z）」で復元可能です。`)) return;

    try {
      setSaveStatus('saving');

      // 削除対象行のスナップショット作成（アンドゥ用）
      const targetRows = rows.filter(r => selectedRowIds.has(`${childId}_${r.date}`));
      const effectiveDeletedRows = targetRows.map(r => ({
        ...r,
        id: r.id || doc(collection(db, DAILY_COL)).id,
        childId: r.childId || childId,
        planMonth: r.planMonth || planMeta?.month || currentMonth
      }));

      const dailySnapshots = effectiveDeletedRows.map(r => ({
        id: r.id!,
        isNew: false,
        data: r
      }));

      const treeSnapshots = effectiveDeletedRows.map(r => {
        const formattedDate = formatDateToIso(r.date) || "";
        return {
          childId,
          dateKey: formattedDate,
          prefDocId: selectedOfficeId ? `${selectedOfficeId}_${formattedDate}` : formattedDate,
          hadExisting: true,
          futurePlan: r.content.futurePlan || futurePlans[r.date] || ""
        };
      }).filter(t => !!t.dateKey);

      const deleteAction: ImportHistoryAction = {
        id: `delete-selected-${Date.now()}`,
        timestamp: new Date().toISOString(),
        summary: `${selectedRowIds.size}件の記録削除`,
        officeId: selectedOfficeId || '',
        officeName: officeName || '',
        actionType: 'delete',
        deletedPlanMeta: planMeta ? { ...planMeta } : undefined,
        before: {
          supportPlans: planMeta ? [{
            docId: selectedOfficeId ? `${selectedOfficeId}_${childId}_${planMeta.month}` : `${childId}_${planMeta.month}`,
            hadExistingGoals: !!(planMeta.goals && planMeta.goals.trim()),
            goals: planMeta.goals || ""
          }] : [],
          dailyReports: dailySnapshots,
          createdDailyReportIds: [],
          treeComms: treeSnapshots
        },
        after: {
          supportPlans: [],
          dailyReports: [],
          treeComms: []
        }
      };

      const batch = writeBatch(db);

      // 1. daily_reports のドキュメント削除 & tree_communications の future_plan クリア
      targetRows.forEach(row => {
        if (row.id) {
          batch.delete(doc(db, DAILY_COL, row.id));
        }
        const formattedDate = formatDateToIso(row.date);
        if (formattedDate) {
          const prefDocId = selectedOfficeId ? `${selectedOfficeId}_${formattedDate}` : formattedDate;
          const prefRef = doc(db, `children/${childId}/app_categories/書類管理/tree_communications`, prefDocId);
          const noPrefRef = doc(db, `children/${childId}/app_categories/書類管理/tree_communications`, formattedDate);
          batch.set(prefRef, { future_plan: "", updatedAt: new Date().toISOString() }, { merge: true });
          batch.set(noPrefRef, { future_plan: "", updatedAt: new Date().toISOString() }, { merge: true });
        }
      });

      // 2. excludedDates に削除対象の日付をすべて追加
      const currentExcluded = new Set(planMeta?.excludedDates || []);
      targetRows.forEach(r => currentExcluded.add(r.date));
      const updatedExcludedDates = Array.from(currentExcluded);

      const targetMonth = planMeta?.month || currentMonth;
      const newPlanMeta: SupportPlanMeta = {
        ...(planMeta || {
          childId: childId,
          month: targetMonth,
          goals: "",
          author: loginStaffName || "スタッフ",
          createdAt: new Date().toISOString()
        }),
        excludedDates: updatedExcludedDates
      };

      const planDocPref = doc(db, PLAN_COL, `${selectedOfficeId}_${childId}_${targetMonth}`);
      const planDocNoPref = doc(db, PLAN_COL, `${childId}_${targetMonth}`);
      batch.set(planDocPref, { ...newPlanMeta, officeId: selectedOfficeId }, { merge: true });
      batch.set(planDocNoPref, { ...newPlanMeta, officeId: selectedOfficeId }, { merge: true });

      await batch.commit();

      // futurePlans state からも削除
      setFuturePlans(prev => {
        const next = { ...prev };
        targetRows.forEach(r => delete next[r.date]);
        return next;
      });

      isInitialLoad.current = true;
      setRows(prev => prev.filter(r => !selectedRowIds.has(`${childId}_${r.date}`)));
      setPlanMeta(newPlanMeta);
      setSelectedRowIds(new Set());
      setIsSelectionMode(false);

      // アンドゥスタックに追加 & トースト通知
      setUndoStack(prev => [...prev, deleteAction]);
      setRedoStack([]);
      setHistoryToast({
        message: `${targetRows.length}件の専門的支援記録を削除しました`,
        type: 'undo',
        canUndo: true
      });

      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 1500);
    } catch (err: any) {
      console.error(err);
      alert(`削除に失敗しました: ${err.message || String(err)}`);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  // ---- その児童のその月を全削除 ----
  const handleDeleteCurrentMonthAll = async () => {
    if (!childId || !planMeta) return;
    const childName = selectedChild?.fullName || "この児童";
    const targetMonth = planMeta.month || currentMonth;

    const confirmed = window.confirm(
      `【当月の専門的支援実施計画を全削除】\n\n${childName}様の当月（${targetMonth}）の専門的支援実施計画をすべて削除しますか？\n\n・支援目標（計画メタ情報）\n・当月すべての日の療育記録（内容・結果）\n・当月すべての日の今後の予定\n\n※この操作は上部の「元に戻す（Ctrl+Z）」で復元可能です。`
    );
    if (!confirmed) return;

    try {
      setSaveStatus('saving');

      // 削除前のスナップショットを作成（アンドゥ用）
      const planDocIdPref = `${selectedOfficeId}_${childId}_${targetMonth}`;
      const planDocIdNoPref = `${childId}_${targetMonth}`;

      const effectiveDeletedRows = rows.map(r => ({
        ...r,
        id: r.id || doc(collection(db, DAILY_COL)).id,
        childId: r.childId || childId,
        planMonth: r.planMonth || targetMonth
      }));

      const dailySnapshots = effectiveDeletedRows.map(r => ({
        id: r.id!,
        isNew: false,
        data: r
      }));

      const [yearStr, monthStr] = targetMonth.split('-');
      const daysInMonth = new Date(parseInt(yearStr, 10), parseInt(monthStr, 10), 0).getDate();
      const treeSnapshots = [];
      for (let d = 1; d <= daysInMonth; d++) {
        const dStr = String(d).padStart(2, '0');
        const formattedDate = `${yearStr}-${monthStr}-${dStr}`;
        const dateDisplay = `${parseInt(monthStr, 10)}月${d}日`;
        const existingPlan = futurePlans[dateDisplay] || "";
        if (existingPlan) {
          treeSnapshots.push({
            childId,
            dateKey: formattedDate,
            prefDocId: selectedOfficeId ? `${selectedOfficeId}_${formattedDate}` : formattedDate,
            hadExisting: true,
            futurePlan: existingPlan
          });
        }
      }

      const deleteAction: ImportHistoryAction = {
        id: `delete-month-${Date.now()}`,
        timestamp: new Date().toISOString(),
        summary: `${targetMonth}の計画全削除`,
        officeId: selectedOfficeId || '',
        officeName: officeName || '',
        actionType: 'delete',
        deletedRows: effectiveDeletedRows,
        deletedPlanMeta: { ...planMeta },
        before: {
          supportPlans: [{
            docId: selectedOfficeId ? planDocIdPref : planDocIdNoPref,
            hadExistingGoals: !!(planMeta.goals && planMeta.goals.trim()),
            goals: planMeta.goals || ""
          }],
          dailyReports: dailySnapshots,
          createdDailyReportIds: [],
          treeComms: treeSnapshots
        },
        after: {
          supportPlans: [],
          dailyReports: [],
          treeComms: []
        }
      };

      const batch = writeBatch(db);

      // 1. daily_reports の削除 & tree_communications の future_plan クリア
      rows.forEach(r => {
        if (r.id) {
          batch.delete(doc(db, DAILY_COL, r.id));
        }
        const formattedDate = formatDateToIso(r.date);
        if (formattedDate) {
          const prefDocId = selectedOfficeId ? `${selectedOfficeId}_${formattedDate}` : formattedDate;
          const prefRef = doc(db, `children/${childId}/app_categories/書類管理/tree_communications`, prefDocId);
          const noPrefRef = doc(db, `children/${childId}/app_categories/書類管理/tree_communications`, formattedDate);
          batch.set(prefRef, { future_plan: "", updatedAt: new Date().toISOString() }, { merge: true });
          batch.set(noPrefRef, { future_plan: "", updatedAt: new Date().toISOString() }, { merge: true });
        }
      });

      // 2. 当月の全行の日付を excludedDates に登録して supportPlans を更新
      const allRowDates = Array.from(new Set([...(planMeta?.excludedDates || []), ...rows.map(r => r.date)]));
      const newPlanMeta: SupportPlanMeta = {
        childId,
        month: targetMonth,
        goals: "",
        author: loginStaffName || "スタッフ",
        createdAt: new Date().toISOString(),
        excludedDates: allRowDates
      };

      batch.set(doc(db, PLAN_COL, planDocIdPref), { ...newPlanMeta, officeId: selectedOfficeId });
      batch.set(doc(db, PLAN_COL, planDocIdNoPref), { ...newPlanMeta, officeId: selectedOfficeId });

      await batch.commit();

      isInitialLoad.current = true;
      setRows([]);
      setFuturePlans({});
      setPlanMeta(newPlanMeta);
      setRecentlyImportedDates(new Set());

      // アンドゥスタックに追加 & トースト通知
      setUndoStack(prev => [...prev, deleteAction]);
      setRedoStack([]);
      setHistoryToast({
        message: `「${targetMonth}」の専門的支援計画を全削除しました`,
        type: 'undo',
        canUndo: true
      });

      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 1500);
    } catch (err: any) {
      console.error("Delete current month error:", err);
      alert(`削除に失敗しました: ${err.message || String(err)}`);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  // ---- その児童のすべての専門的支援実施計画を全削除 ----
  const handleDeleteChildAllPlans = async () => {
    if (!childId) return;
    const childName = selectedChild?.fullName || "この児童";

    const firstConfirm = window.confirm(
      `【⚠️ 警告：全期間データ削除】\n\n${childName}様の【すべての月】の専門的支援実施計画をすべて完全に削除しますか？\n\n・全期間の支援目標\n・全期間の日々の療育記録（内容・結果）\n・全期間の今後の予定\n\n※この操作は取り消せません。`
    );
    if (!firstConfirm) return;

    const secondConfirm = window.confirm(
      `本当に${childName}様の全期間のデータをすべて削除してよろしいですか？\n元に戻すことはできません。`
    );
    if (!secondConfirm) return;

    try {
      setSaveStatus('saving');

      // 1. supportPlans コレクションからこの児童の全ドキュメントを削除
      const plansQuery = query(collection(db, PLAN_COL), where('childId', '==', childId));
      const plansSnap = await getDocs(plansQuery);
      const batch1 = writeBatch(db);
      plansSnap.docs.forEach(d => batch1.delete(d.ref));
      if (planMeta?.month) {
        batch1.delete(doc(db, PLAN_COL, `${selectedOfficeId}_${childId}_${planMeta.month}`));
        batch1.delete(doc(db, PLAN_COL, `${childId}_${planMeta.month}`));
      }
      await batch1.commit();

      // 2. daily_reports コレクションからこの児童の全ドキュメントを削除
      const dailyQuery = query(collection(db, DAILY_COL), where('childId', '==', childId));
      const dailySnap = await getDocs(dailyQuery);
      const chunks: any[][] = [];
      let currentChunk: any[] = [];
      dailySnap.docs.forEach(d => {
        currentChunk.push(d.ref);
        if (currentChunk.length >= 400) {
          chunks.push(currentChunk);
          currentChunk = [];
        }
      });
      if (currentChunk.length > 0) chunks.push(currentChunk);

      for (const chunk of chunks) {
        const b = writeBatch(db);
        chunk.forEach(ref => b.delete(ref));
        await b.commit();
      }

      // 3. tree_communications のデータは他アプリ連携のため一切変更しない

      isInitialLoad.current = true;
      // ツリー通信または今後の予定がある行は、療育内容・結果のみをクリアしてバーチャル行として残す
      const remainingRows: DailyReport[] = [];
      rows.forEach(r => {
        const hasTreeComm = !!(r.content?.externalInfo?.trim() || newsletters[r.date]?.trim());
        const hasFuture = !!(futurePlans[r.date]?.trim() || r.content?.futurePlan?.trim());
        if (hasTreeComm || hasFuture) {
          remainingRows.push({
            childId,
            planMonth: currentMonth,
            date: r.date,
            staffId: "",
            type: 'tree_report',
            content: {
              externalInfo: r.content.externalInfo || newsletters[r.date] || "",
              supportContent: [],
              resultInfo: "",
              futurePlan: futurePlans[r.date] || r.content.futurePlan || "",
              isVerified: false
            },
            archived: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
        }
      });
      setRows(remainingRows);
      setPlanMeta({
        childId,
        month: currentMonth,
        goals: "",
        author: loginStaffName || "スタッフ",
        createdAt: new Date().toISOString()
      });
      setRecentlyImportedDates(new Set());

      setSaveStatus('saved');
      alert(`「${childName}様」のすべての専門的支援実施計画を削除しました。`);
      setTimeout(() => setSaveStatus('idle'), 1500);
    } catch (err: any) {
      console.error("Delete all child plans error:", err);
      alert(`削除に失敗しました: ${err.message || String(err)}`);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  // アンドゥ（元に戻す）ハンドラ
  const handleUndo = useCallback(async () => {
    if (undoStack.length === 0 || isUndoRedoing) return;
    const actionToUndo = undoStack[undoStack.length - 1];
    setIsUndoRedoing(true);

    try {
      // 削除操作のアンドゥの場合：画面ステートをスナップショットから即座に復元
      if (actionToUndo.actionType === 'delete') {
        isInitialLoad.current = true;
        if (actionToUndo.deletedRows && actionToUndo.deletedRows.length > 0) {
          setRows(prev => {
            const combined = [...prev, ...actionToUndo.deletedRows!];
            const dateMap = new Map<string, DailyReport>();
            combined.forEach(r => dateMap.set(r.date, r));
            return Array.from(dateMap.values()).sort((a, b) => {
              const parse = (s: string) => {
                const m = s.match(/(\d+)月(\d+)日/);
                return m ? parseInt(m[1]) * 100 + parseInt(m[2]) : 0;
              };
              return parse(a.date) - parse(b.date);
            });
          });

          setFuturePlans(prev => {
            const next = { ...prev };
            actionToUndo.deletedRows!.forEach(r => {
              if (r.content?.futurePlan) {
                next[r.date] = r.content.futurePlan;
              }
            });
            return next;
          });
        }

        if (actionToUndo.deletedPlanMeta) {
          setPlanMeta(actionToUndo.deletedPlanMeta);
        }
      }

      await performUndo(actionToUndo);
      setUndoStack(prev => prev.slice(0, -1));
      setRedoStack(prev => [...prev, actionToUndo]);
      setRecentlyImportedDates(new Set()); // アンドゥ時はハイライトをクリア
      setHistoryToast({
        message: `「${actionToUndo.summary}」を元に戻しました`,
        type: 'undo',
        canRedo: true
      });
      await fetchData();
    } catch (err: any) {
      console.error('Undo error:', err);
      alert(`元に戻す処理に失敗しました: ${err.message || String(err)}`);
    } finally {
      setIsUndoRedoing(false);
    }
  }, [undoStack, isUndoRedoing, fetchData]);

  // リドゥ（やり直す）ハンドラ
  const handleRedo = useCallback(async () => {
    if (redoStack.length === 0 || isUndoRedoing) return;
    const actionToRedo = redoStack[redoStack.length - 1];
    setIsUndoRedoing(true);

    try {
      // 削除操作のリドゥの場合：画面から即座に対象行を除去
      if (actionToRedo.actionType === 'delete') {
        isInitialLoad.current = true;
        if (actionToRedo.deletedRows && actionToRedo.deletedRows.length > 0) {
          const datesToDelete = new Set(actionToRedo.deletedRows.map(r => r.date));
          setRows(prev => prev.filter(r => !datesToDelete.has(r.date)));
          setFuturePlans(prev => {
            const next = { ...prev };
            datesToDelete.forEach(d => delete next[d]);
            return next;
          });
          setPlanMeta(prev => {
            if (!prev) return prev;
            const updated = Array.from(new Set([...(prev.excludedDates || []), ...Array.from(datesToDelete)]));
            return { ...prev, excludedDates: updated };
          });
        }
        if (actionToRedo.summary.includes('計画全削除')) {
          setPlanMeta(prev => prev ? { ...prev, goals: "" } : prev);
          setRows([]);
        }
      }

      await performRedo(actionToRedo);
      setRedoStack(prev => prev.slice(0, -1));
      setUndoStack(prev => [...prev, actionToRedo]);

      // リドゥ時は再度ハイライト
      const dateSet = new Set<string>();
      actionToRedo.after.dailyReports.forEach(r => {
        if (r.payload?.date) {
          const parts = r.payload.date.split('-');
          if (parts.length === 3) {
            dateSet.add(`${parseInt(parts[1], 10)}月${parseInt(parts[2], 10)}日`);
          } else {
            dateSet.add(r.payload.date);
          }
        }
      });
      setRecentlyImportedDates(dateSet);

      setHistoryToast({
        message: `「${actionToRedo.summary}」を再適用しました`,
        type: 'redo',
        canUndo: true
      });
      await fetchData();
    } catch (err: any) {
      console.error('Redo error:', err);
      alert(`やり直す処理に失敗しました: ${err.message || String(err)}`);
    } finally {
      setIsUndoRedoing(false);
    }
  }, [redoStack, isUndoRedoing, fetchData]);

  // Ctrl+Z / Ctrl+Y (Cmd+Z / Cmd+Y / Ctrl+Shift+Z) のショートカットキー対応
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        handleUndo();
      } else if (
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')
      ) {
        e.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo]);

  // トースト自動消滅タイマー
  useEffect(() => {
    if (!historyToast) return;
    const timer = setTimeout(() => {
      setHistoryToast(null);
    }, 8000);
    return () => clearTimeout(timer);
  }, [historyToast]);



  if (isLoading || (childrenData.length === 0 && !selectedChild)) {
    return (
      <div className="p-4 md:p-8 animate-pulse">
        <div className="h-8 w-64 bg-slate-200 rounded mb-8" />
        <div className="glass-panel overflow-hidden min-h-0">
          <div className="h-16 bg-slate-800" />
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-24 border-b border-slate-100 flex gap-4 p-4">
              <div className="w-16 bg-slate-100 rounded" />
              <div className="flex-1 bg-slate-50 rounded" />
              <div className="w-1/4 bg-slate-50 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!selectedChild) return (
    <div className="p-20 text-center flex flex-col items-center gap-4 glass-panel max-w-md mx-auto mt-20">
      <div className="bg-red-50 p-4 rounded-lg border border-red-200 w-full text-left">
        <p className="text-red-700 font-bold mb-2">児童が見つかりません</p>
        <div className="text-[10px] text-slate-500 space-y-1">
          <p>対象ID: <span className="font-mono">{childId}</span></p>
          <p>読込済数: {childrenData.length}名</p>
          <p>ログイン: {auth.currentUser ? `OK (${auth.currentUser.email})` : '未ログイン'}</p>
        </div>
      </div>
      <button className="btn-primary w-full" onClick={() => navigate('/')}>一覧へ戻る</button>
    </div>
  );

  if (!planMeta) return (
    <div className="p-20 text-center flex flex-col items-center gap-4 glass-panel max-w-md mx-auto mt-20">
      <div className="bg-amber-50 p-4 rounded-lg border border-amber-200 w-full text-left">
        <p className="text-amber-700 font-bold mb-2">書類データへのアクセスが拒否されました</p>
        <div className="text-[10px] text-slate-500 space-y-1">
          <p>ログイン: <span className="font-mono text-amber-800">{auth.currentUser?.email || '未ログイン'}</span></p>
          <p>対象児童ID: <span className="font-mono">{childId}</span></p>
          {rawError && (
            <div className="mt-2 p-2 bg-red-100/50 rounded border border-red-200 text-[9px] font-mono break-all text-red-900">
              Error: {rawError}
            </div>
          )}
          <p className="mt-2 text-amber-600">※セキュリティルールとログイン状態の不一致が起きています。</p>
        </div>
      </div>
      <button className="btn-primary w-full" onClick={() => fetchData()}>再試行</button>
    </div>
  );

  const menuActions: Action[] = [
    ...(undoStack.length > 0 ? [{
      label: `元に戻す (${undoStack.length})`,
      icon: <Undo2 size={18} />,
      onClick: handleUndo,
      colorClass: 'bg-amber-600 text-white'
    }] : []),
    ...(redoStack.length > 0 ? [{
      label: `やり直す (${redoStack.length})`,
      icon: <Redo2 size={18} />,
      onClick: handleRedo,
      colorClass: 'bg-blue-600 text-white'
    }] : []),
    { label: '保存する', icon: <Save size={18} />, onClick: handleSave, colorClass: 'bg-primary text-white' },
    { 
      label: isSelectionMode ? (selectedRowIds.size > 0 ? `${selectedRowIds.size}件削除` : '選択解除') : '一括削除モード', 
      icon: isSelectionMode ? <X size={18} /> : <Trash2 size={18} />, 
      onClick: isSelectionMode && selectedRowIds.size > 0 ? handleDeleteSelected : () => {
        setIsSelectionMode(!isSelectionMode);
        setSelectedRowIds(new Set());
      },
      colorClass: isSelectionMode ? 'bg-red-500 text-white' : 'bg-slate-700 text-white'
    },
    { label: '当月の計画を全削除', icon: <Trash2 size={18} />, onClick: handleDeleteCurrentMonthAll, colorClass: 'bg-red-600 text-white' },
    { label: 'この児童の全計画を削除', icon: <AlertTriangle size={18} />, onClick: handleDeleteChildAllPlans, colorClass: 'bg-red-800 text-white' },
    { 
      label: isNewsletterCollapsed ? 'ツリー通信を展開' : 'ツリー通信を格納', 
      icon: isNewsletterCollapsed ? <Eye size={18} /> : <EyeOff size={18} />, 
      onClick: () => setIsNewsletterCollapsed(!isNewsletterCollapsed), 
      colorClass: 'bg-orange-500 text-white' 
    },
    { label: 'ツリー通信をコピー', icon: <Copy size={18} />, onClick: handleCopyTreeCommunications, colorClass: 'bg-blue-600 text-white' },
    { label: '結果を一括登録', icon: <Sparkles size={18} />, onClick: () => setIsResultImportOpen(true), colorClass: 'bg-indigo-600 text-white' },
    { label: '行追加', icon: <Plus size={18} />, onClick: addRow },
    { label: 'Excelインポート', icon: <UploadCloud size={18} />, onClick: () => setIsImportOpen(true), colorClass: 'bg-emerald-600 text-white' },
    { label: '既存Excelに直接上書き', icon: <UploadCloud size={18} />, onClick: handleDirectOverwriteExcel, colorClass: 'bg-indigo-600 text-white' },
    { 
      label: '既存Excelに上書きしてダウンロード', 
      icon: <Download size={18} />, 
      onClick: () => {
        const input = document.getElementById('excel-file-download-fallback') as HTMLInputElement;
        if (input) input.click();
      }, 
      colorClass: 'bg-slate-700 text-white' 
    },
    { label: 'Excel新規出力', icon: <Download size={18} />, onClick: handleExcelExport },
    { label: '印刷', icon: <Printer size={18} />, onClick: handlePrint },
  ];

  return (
    <div id="support-impl-print" className="max-w-[1400px] mx-auto flex flex-col gap-8 print:gap-4 pb-20 print:pb-0 animate-fade-in">
      {/* 自動保存ステータスインジケーター */}
      {saveStatus !== 'idle' && (
        <div className="fixed bottom-24 right-6 z-50 flex items-center gap-2 pointer-events-none print:hidden">
          {saveStatus === 'saving' && (
            <div className="bg-slate-800/90 text-white text-xs font-bold px-4 py-2.5 rounded-full shadow-lg flex items-center gap-2 backdrop-blur-sm animate-fade-in border border-white/10">
              <Loader2 size={14} className="animate-spin text-primary" />
              <span>自動保存中...</span>
            </div>
          )}
          {saveStatus === 'saved' && (
            <div className="bg-emerald-600/90 text-white text-xs font-bold px-4 py-2.5 rounded-full shadow-lg flex items-center gap-2 backdrop-blur-sm animate-fade-in border border-white/10">
              <Check size={14} />
              <span>変更を保存しました</span>
            </div>
          )}
          {saveStatus === 'error' && (
            <div className="bg-red-600/90 text-white text-xs font-bold px-4 py-2.5 rounded-full shadow-lg flex items-center gap-2 backdrop-blur-sm animate-fade-in border border-white/10">
              <span>保存に失敗しました</span>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between print:hidden">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate(`/children/${childId}`)} className="flex items-center gap-2 text-slate-500 font-medium">
            <ArrowLeft size={18} /> <span className="text-slate-400">書類一覧</span>
          </button>
          <ChevronRight size={14} className="text-slate-300" />
          <span className="text-sm font-bold text-slate-700">{selectedChild.fullName} 様</span>
          <ChevronRight size={14} className="text-slate-300" />
          <span className="text-sm font-semibold text-primary">専門的支援実施計画</span>
        </div>

        {/* PC表示用：アクションバー（モバイルでは非表示） */}
        <div className="hidden md:flex gap-2.5 items-center">
          <input
            id="excel-file-direct-fallback"
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={handleFallbackFileChange}
          />
          <input
            id="excel-file-download-fallback"
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={handleDownloadFallbackFileChange}
          />

          {/* アンドゥ・リドゥ ボタン */}
          <div className="flex items-center bg-slate-100 rounded-lg p-0.5 border border-slate-300 shadow-sm mr-1">
            <button
              onClick={handleUndo}
              disabled={undoStack.length === 0 || isUndoRedoing}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                undoStack.length > 0 && !isUndoRedoing
                  ? 'bg-white text-slate-700 shadow-xs hover:bg-amber-50 hover:text-amber-800 hover:border-amber-200 cursor-pointer active:scale-95'
                  : 'text-slate-400 opacity-50 cursor-not-allowed'
              }`}
              title="元に戻す (Ctrl+Z)"
            >
              <Undo2 size={14} className={undoStack.length > 0 ? 'text-amber-600' : ''} />
              <span>元に戻す</span>
              {undoStack.length > 0 && (
                <span className="ml-0.5 px-1.5 py-0.5 bg-amber-100 text-amber-800 text-[10px] rounded-full font-bold">
                  {undoStack.length}
                </span>
              )}
            </button>
            <button
              onClick={handleRedo}
              disabled={redoStack.length === 0 || isUndoRedoing}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                redoStack.length > 0 && !isUndoRedoing
                  ? 'bg-white text-slate-700 shadow-xs hover:bg-blue-50 hover:text-blue-800 hover:border-blue-200 cursor-pointer active:scale-95'
                  : 'text-slate-400 opacity-50 cursor-not-allowed'
              }`}
              title="やり直す (Ctrl+Y)"
            >
              <Redo2 size={14} className={redoStack.length > 0 ? 'text-blue-600' : ''} />
              <span>やり直す</span>
              {redoStack.length > 0 && (
                <span className="ml-0.5 px-1.5 py-0.5 bg-blue-100 text-blue-800 text-[10px] rounded-full font-bold">
                  {redoStack.length}
                </span>
              )}
            </button>
          </div>

          <button
            onClick={handleCopyTreeCommunications}
            className="flex items-center gap-2 cursor-pointer bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 rounded-lg px-4 py-2 text-sm font-semibold transition-colors shadow-sm"
            title="選択された（未選択時はすべての）ツリー通信を日付別でコピーします(個人情報保護のため児童名は除外)"
          >
            <Copy size={16} className="text-slate-500" />
            <span>ツリー通信をコピー</span>
          </button>
          
          <button
            onClick={() => setIsImportOpen(true)}
            className="flex items-center gap-2 cursor-pointer bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-800 rounded-lg px-4 py-2 text-sm font-semibold transition-colors shadow-sm"
            title="専門的支援実施計画のExcelファイルから児童・月・療育内容・結果・予定を取り込みます"
          >
            <FileSpreadsheet size={16} className="text-emerald-600" />
            <span>Excelからインポート</span>
          </button>

          <button
            onClick={() => setIsResultImportOpen(true)}
            className="flex items-center gap-2 cursor-pointer bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 rounded-lg px-4 py-2 text-sm font-semibold transition-colors shadow-sm"
            title="Geminiで変換した療育結果を一括で登録します"
          >
            <Sparkles size={16} className="text-primary" />
            <span>結果を一括登録</span>
          </button>

          <button
            onClick={handleDirectOverwriteExcel}
            className="flex items-center gap-2 cursor-pointer bg-slate-800 hover:bg-slate-700 text-white rounded-lg px-4 py-2 text-sm font-semibold transition-colors shadow-sm"
            title="選択したファイル自体を直接上書き保存します（ファイルを閉じて実行してください）"
          >
            <UploadCloud size={16} />
            <span>既存Excelに直接上書き</span>
          </button>
          
          <button
            onClick={() => {
              const input = document.getElementById('excel-file-download-fallback') as HTMLInputElement;
              if (input) input.click();
            }}
            className="flex items-center gap-2 cursor-pointer bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 rounded-lg px-4 py-2 text-sm font-semibold transition-colors shadow-sm"
            title="選択したファイルを元に、上書きされた新しいファイルをダウンロードします（ファイルを開いたままでも実行可能）"
          >
            <Download size={16} className="text-slate-500" />
            <span>既存Excelに上書きしてダウンロード</span>
          </button>
          
          {exportLogs.length > 0 && (
            <button
              onClick={() => setIsExportLogOpen(true)}
              className="text-xs text-primary hover:text-primary-dark font-bold bg-primary/10 hover:bg-primary/20 rounded-lg px-3 py-2 transition-colors flex items-center gap-1"
              title="書き込みログを確認"
            >
              ログを確認
            </button>
          )}
          {/* データ削除メニュードロップダウン */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsDeleteMenuOpen(!isDeleteMenuOpen)}
              className="flex items-center gap-1.5 bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-xs font-bold transition-colors shadow-sm"
              title="この児童の支援計画データを削除"
            >
              <Trash2 size={15} />
              <span>計画データ削除</span>
              <span className="text-[10px]">▼</span>
            </button>
            {isDeleteMenuOpen && (
              <>
                <div 
                  className="fixed inset-0 z-40" 
                  onClick={() => setIsDeleteMenuOpen(false)} 
                />
                <div className="absolute right-0 mt-1.5 w-64 bg-white rounded-xl shadow-xl border border-red-100 py-1.5 z-50 animate-fade-in text-left">
                  <div className="px-3 py-1.5 text-[11px] font-bold text-slate-400 border-b border-slate-100">
                    専門的支援計画のデータ削除
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsDeleteMenuOpen(false);
                      setIsSelectionMode(!isSelectionMode);
                      setSelectedRowIds(new Set());
                    }}
                    className="w-full text-left px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
                  >
                    <Check size={14} className="text-slate-400" />
                    <span>{isSelectionMode ? '一括選択モードを終了' : '行を選択して一括削除'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsDeleteMenuOpen(false);
                      handleDeleteCurrentMonthAll();
                    }}
                    className="w-full text-left px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-50 flex items-center gap-2 cursor-pointer"
                  >
                    <Trash2 size={14} className="text-red-500" />
                    <span>当月（{planMeta?.month || currentMonth}）の計画を全削除</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsDeleteMenuOpen(false);
                      handleDeleteChildAllPlans();
                    }}
                    className="w-full text-left px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100/70 flex items-center gap-2 border-t border-slate-100 cursor-pointer"
                  >
                    <AlertTriangle size={14} className="text-red-600" />
                    <span>この児童の【全期間】の計画を削除</span>
                  </button>
                </div>
              </>
            )}
          </div>

          {isSelectionMode && (
            <button
              onClick={selectedRowIds.size > 0 ? handleDeleteSelected : () => setIsSelectionMode(false)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-all shadow-sm ${
                selectedRowIds.size > 0
                  ? 'bg-red-600 text-white hover:bg-red-700 animate-pulse'
                  : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
              }`}
            >
              {selectedRowIds.size > 0 ? (
                <>
                  <Trash2 size={14} />
                  <span>選択した{selectedRowIds.size}件を削除</span>
                </>
              ) : (
                <>
                  <X size={14} />
                  <span>選択解除</span>
                </>
              )}
            </button>
          )}

          <button 
            className="btn-primary flex items-center gap-2" 
            onClick={handleSave}
            disabled={saveStatus === 'saving'}
          >
            {saveStatus === 'saving' ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>保存中...</span>
              </>
            ) : (
              <>
                <Save size={16} />
                <span>保存する</span>
              </>
            )}
          </button>
        </div>
      </div>

      <FloatingActionMenu actions={menuActions} />


      <div className="glass-panel p-10 print:p-4 bg-white/95">
        <div className="flex items-baseline justify-center mb-10 print:mb-4 border-b-2 border-slate-800 pb-6 print:pb-2 print:text-black">
          <div className="flex-1 hidden md:block print:block"></div>
          <div className="tracking-widest text-3xl print:text-4xl font-black text-center shrink-0">
            専門的支援実施計画
          </div>
          <div className="flex-1 text-left pl-4 font-normal text-base print:text-lg">
            ({officeName})
          </div>
        </div>

        <div className="grid grid-cols-2 gap-8 print:gap-4 mb-8 print:mb-4">
          <div className="border-b border-slate-400 pb-2 flex items-end gap-3 print:pl-16">
            <UserIcon size={20} className="text-primary mb-1 print:hidden" />
            <span className="text-2xl font-bold print:text-3xl print:text-black">{selectedChild.fullName} 様</span>
          </div>
          <div className="border-b border-slate-400 pb-2 flex items-end gap-3">
            <Calendar size={20} className="text-primary mb-1 print:hidden" />
            <input type="month" value={planMeta.month} style={{ touchAction: 'pan-y' }} onChange={handleMonthChange} className="text-xl font-bold outline-none bg-transparent print:hidden" />
            <span className="hidden print:inline-block font-bold print:text-3xl print:text-black">
              {planMeta.month.replace('-', '年')}月
            </span>
          </div>
        </div>

        {/* ===== 支援目標（専門的支援計画書またはExcelインポートから共有） ===== */}
        {(() => {
          const hasImportedGoals = !!(planMeta.goals && planMeta.goals.trim());
          const isViewingImported = planMeta.selectedProfPlanId === 'imported' || (!profPlan && hasImportedGoals);
          const parsedGoals = hasImportedGoals ? parseGoalsText(planMeta.goals) : null;

          return (
            <div className="mb-10 print:mb-4 bg-slate-50 rounded-xl border overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b bg-white">
                <div className="flex items-center gap-4">
                  <h3 className="text-sm font-bold flex items-center gap-2 uppercase">
                    <Target size={16} className="text-primary" /> 支援目標
                  </h3>
                  <div className="flex items-center gap-2 print:hidden">
                    <span className="text-[10px] font-bold text-slate-500">反映元:</span>
                    <select
                      className="text-[11px] bg-slate-50 border border-slate-200 rounded px-2 py-1 outline-none text-slate-700 font-semibold"
                      value={planMeta.selectedProfPlanId || (isViewingImported ? 'imported' : 'auto')}
                      onChange={(e) => {
                        const val = e.target.value;
                        setPlanMeta(prev => prev ? { ...prev, selectedProfPlanId: val } : null);
                      }}
                    >
                      {hasImportedGoals && (
                        <option value="imported">Excelインポート / 登録済みの目標</option>
                      )}
                      <option value="auto">専門的支援計画書 (自動判定)</option>
                      {[...availableProfPlans]
                        .sort((a, b) => {
                           const aM = a.startMonth || (a.createdAt ? a.createdAt.slice(0, 7) : "");
                           const bM = b.startMonth || (b.createdAt ? b.createdAt.slice(0, 7) : "");
                           return bM.localeCompare(aM);
                        })
                        .map(p => (
                        <option key={p.id} value={p.id}>
                          計画書: {p.startMonth ? `${p.startMonth.replace('-', '年')}月開始分` : `${p.createdAt ? p.createdAt.replace(/-/g, '/').slice(0, 10) : '日付不明'}作成`}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex items-center gap-3 print:hidden">
                  {/* 編集モード切り替えボタン */}
                  <button
                    onClick={() => setIsEditingGoals(!isEditingGoals)}
                    className="flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded-lg transition-colors"
                    title={isEditingGoals ? "プレビュー表示に戻す" : "目標テキストを直接編集する"}
                  >
                    {isEditingGoals ? (
                      <>
                        <Check size={14} className="text-emerald-600" />
                        <span>プレビュー表示</span>
                      </>
                    ) : (
                      <>
                        <Edit3 size={14} className="text-slate-500" />
                        <span>テキスト編集</span>
                      </>
                    )}
                  </button>

                  {isViewingImported ? (
                    <span className="text-[10px] text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                      Excelインポート / 登録テキストより反映中
                    </span>
                  ) : profPlan ? (
                    <span className="text-[10px] text-primary font-semibold bg-primary/10 px-2 py-0.5 rounded-full">
                      {planMeta.selectedProfPlanId && planMeta.selectedProfPlanId !== 'auto'
                        ? '手動選択した計画書より参照中'
                        : (profPlan.isReflected && profPlan.reflectedStartMonth 
                          ? `${profPlan.reflectedStartMonth.replace('-', '年')}月開始分の個別支援計画書（本案）から反映中`
                          : '専門的支援計画書より自動参照中')}
                    </span>
                  ) : (
                    <span className="text-[10px] text-amber-600 font-semibold bg-amber-50 px-2 py-0.5 rounded-full">
                      ※専門的支援計画書が未作成です
                    </span>
                  )}
                </div>
              </div>

              {/* 編集モード時 */}
              {isEditingGoals ? (
                <div className="p-5 space-y-2">
                  <textarea
                    className="w-full h-28 p-3 bg-white border border-slate-300 rounded-xl outline-none text-sm leading-relaxed focus:ring-2 focus:ring-primary shadow-xs"
                    style={{ touchAction: 'pan-y' }}
                    placeholder="支援目標を入力してください…（例: 長期目標：... 短期目標：... 具体的目標：①... ②... ③... ④... ⑤...）"
                    value={planMeta.goals}
                    onChange={e => setPlanMeta({ ...planMeta, goals: e.target.value })}
                  />
                  <p className="text-[11px] text-slate-400 font-medium">
                    💡 「①②③」は本人支援、「④」は家族支援、「⑤」は移行支援として自動色分けされます。
                  </p>
                </div>
              ) : isViewingImported && parsedGoals ? (
                /* Excelインポート / 登録テキストの色分け表示 */
                <div className="p-5 print:p-3 flex flex-col gap-4 print:gap-2 text-sm print:text-xs print-tight-layout">
                  {/* 長期目標 */}
                  {parsedGoals.longTerm.length > 0 && (
                    <div className="flex gap-3">
                      <span className="shrink-0 text-[11px] font-bold text-slate-500 bg-slate-200 print:bg-white print:text-black print:text-[18px] print:border print:border-black px-2 py-0.5 rounded h-fit mt-0.5">長期目標</span>
                      <ul className="flex flex-col gap-1.5">
                        {parsedGoals.longTerm.map((item, i) => (
                          <li key={i} className="flex items-start gap-2 text-slate-700 leading-relaxed">
                            <span className="text-emerald-500 font-bold text-[11px] print:text-black print:text-[18px] mt-0.5">▸</span>
                            <span className="whitespace-pre-wrap print:text-black print:text-[18px] print:leading-tight">{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* 短期目標 */}
                  {parsedGoals.shortTerm.length > 0 && (
                    <div className="flex gap-3">
                      <span className="shrink-0 text-[11px] font-bold text-slate-500 bg-slate-200 print:bg-white print:text-black print:text-[18px] print:border print:border-black px-2 py-0.5 rounded h-fit mt-0.5">短期目標</span>
                      <ul className="flex flex-col gap-1.5">
                        {parsedGoals.shortTerm.map((item, i) => (
                          <li key={i} className="flex items-start gap-2 text-slate-700 leading-relaxed">
                            <span className="text-emerald-500 font-bold text-[11px] print:text-black print:text-[18px] mt-0.5">▸</span>
                            <span className="whitespace-pre-wrap print:text-black print:text-[18px] print:leading-tight">{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* 本人支援 (①②③) */}
                  {parsedGoals.personal.length > 0 && (
                    <div className="flex gap-3">
                      <span className="shrink-0 text-[11px] font-bold px-2 py-0.5 rounded h-fit mt-0.5 text-violet-700 bg-violet-100 print:bg-white print:text-black print:text-[18px] print:border print:border-black">
                        本人支援
                      </span>
                      <ul className="flex flex-col gap-1.5">
                        {parsedGoals.personal.map((item, i) => (
                          <li key={i} className="flex items-start gap-2 text-slate-700 leading-relaxed">
                            <span className="text-emerald-500 font-bold text-[11px] print:text-black print:text-[18px] mt-0.5">▸</span>
                            <span className="whitespace-pre-wrap print:text-black print:text-[18px] print:leading-tight">{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* 家族支援 (⑤) */}
                  {parsedGoals.family.length > 0 && (
                    <div className="flex gap-3">
                      <span className="shrink-0 text-[11px] font-bold px-2 py-0.5 rounded h-fit mt-0.5 text-emerald-700 bg-emerald-100 print:bg-white print:text-black print:text-[18px] print:border print:border-black">
                        家族支援
                      </span>
                      <ul className="flex flex-col gap-1.5">
                        {parsedGoals.family.map((item, i) => (
                          <li key={i} className="flex items-start gap-2 text-slate-700 leading-relaxed">
                            <span className="text-emerald-500 font-bold text-[11px] print:text-black print:text-[18px] mt-0.5">▸</span>
                            <span className="whitespace-pre-wrap print:text-black print:text-[18px] print:leading-tight">{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* 移行支援 (④) */}
                  {parsedGoals.transition.length > 0 && (
                    <div className="flex gap-3">
                      <span className="shrink-0 text-[11px] font-bold px-2 py-0.5 rounded h-fit mt-0.5 text-orange-700 bg-orange-100 print:bg-white print:text-black print:text-[18px] print:border print:border-black">
                        移行支援
                      </span>
                      <ul className="flex flex-col gap-1.5">
                        {parsedGoals.transition.map((item, i) => (
                          <li key={i} className="flex items-start gap-2 text-slate-700 leading-relaxed">
                            <span className="text-emerald-500 font-bold text-[11px] print:text-black print:text-[18px] mt-0.5">▸</span>
                            <span className="whitespace-pre-wrap print:text-black print:text-[18px] print:leading-tight">{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* その他 */}
                  {parsedGoals.other.length > 0 && (
                    <div className="flex gap-3">
                      <span className="shrink-0 text-[11px] font-bold px-2 py-0.5 rounded h-fit mt-0.5 text-slate-600 bg-slate-200">
                        目標
                      </span>
                      <ul className="flex flex-col gap-1.5">
                        {parsedGoals.other.map((item, i) => (
                          <li key={i} className="flex items-start gap-2 text-slate-700 leading-relaxed">
                            <span className="text-emerald-500 font-bold text-[11px] mt-0.5">▸</span>
                            <span className="whitespace-pre-wrap">{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : profPlan ? (
                /* 計画書からの色分け表示 */
                <div className="p-5 print:p-3 flex flex-col gap-4 print:gap-2 text-sm print:text-xs print-tight-layout">
                  {/* 長期目標 */}
                  <div className="flex gap-3">
                    <span className="shrink-0 text-[11px] font-bold text-slate-500 bg-slate-200 print:bg-white print:text-black print:text-[18px] print:border print:border-black px-2 py-0.5 rounded h-fit mt-0.5">長期目標</span>
                    <p className="whitespace-pre-wrap text-slate-700 print:text-black print:text-[18px] leading-relaxed print:leading-tight">
                      {profPlan.longTermGoal || <span className="text-slate-300 italic">未入力</span>}
                    </p>
                  </div>
                  {/* 短期目標 */}
                  <div className="flex gap-3">
                    <span className="shrink-0 text-[11px] font-bold text-slate-500 bg-slate-200 print:bg-white print:text-black print:text-[18px] print:border print:border-black px-2 py-0.5 rounded h-fit mt-0.5">短期目標</span>
                    <p className="whitespace-pre-wrap text-slate-700 print:text-black print:text-[18px] leading-relaxed print:leading-tight">
                      {profPlan.shortTermGoal || <span className="text-slate-300 italic">未入力</span>}
                    </p>
                  </div>
                  {/* 具体的な到達目標（カテゴリ別） */}
                  {(['本人支援', '家族支援', '移行支援'] as const).map((cat) => {
                    const catRows = (profPlan.supportRows ?? []).filter(r => r.category === cat && r.supportGoal?.trim());
                    if (catRows.length === 0) return null;
                    return (
                      <div key={cat} className="flex gap-3">
                        <span className={`shrink-0 text-[11px] font-bold px-2 py-0.5 rounded h-fit mt-0.5 print:bg-white print:text-black print:text-[18px] print:border print:border-black ${cat === '本人支援' ? 'text-violet-700 bg-violet-100' :
                            cat === '家族支援' ? 'text-emerald-700 bg-emerald-100' :
                              'text-orange-700 bg-orange-100'
                          }`}>{cat}</span>
                        <ul className="flex flex-col gap-1.5">
                          {catRows.map((r, i) => (
                            <li key={r.id ?? i} className="flex items-start gap-2 text-slate-700 leading-relaxed">
                              <span className="text-emerald-500 font-bold text-[11px] print:text-black print:text-[18px] mt-0.5">▸</span>
                              <span className="whitespace-pre-wrap print:text-black print:text-[18px] print:leading-tight">{r.supportGoal}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* 目標が何もない初期状態 */
                <div className="p-8 text-center text-slate-400 text-sm space-y-2">
                  <p className="font-semibold">支援目標が登録されていません</p>
                  <p className="text-xs text-slate-400">
                    「Excelからインポート」を行うか、「テキスト編集」ボタンから入力してください。
                  </p>
                </div>
              )}
            </div>
          );
        })()}

        {/* モバイルは overflow 系を一切持たない素の div にする。
            overflow-x-hidden でもブラウザが「潜在的なスクロールコンテナ」と判断し
            縦スワイプを横スクロールとして吸収してしまうため。
            touch-action: pan-y をコンテナ自体に付与することで、
            子要素への個別指定不要で縦スクロールを最優先に伝播させる。
            PCは実際に横幅が必要なため md: 以降で overflow-x-auto を付与する。 */}
        <div
          className="md:overflow-x-auto rounded-xl border-2 border-slate-800 shadow-xl bg-white"
          style={{
            touchAction: 'pan-y',
            overscrollBehaviorX: 'contain',
            WebkitOverflowScrolling: 'touch' as any,
          }}
        >
          <div
            className={`w-full block md:table print:table print:table-fixed border-collapse ${isNewsletterCollapsed ? 'md:min-w-[850px] lg:min-w-[900px]' : 'md:min-w-[1000px] lg:min-w-[1100px]'} print:min-w-0 print:w-full`}
            style={{ touchAction: 'pan-y' }}
          >
            <div className="hidden md:table-header-group print:table-header-group sticky top-0 z-20">
              <div className="bg-slate-800 text-white text-[10px] md:text-xs print:bg-white print:text-black print:text-[20px] print:border-b-2 print:border-black shadow-sm md:table-row print:table-row">
                {isSelectionMode && <div className="p-2 md:p-4 w-[50px] border-r border-slate-600 print:hidden md:table-cell font-bold text-center align-middle">選択</div>}
                <div className="p-2 md:p-4 print:p-1 w-[60px] md:w-[80px] print:w-[8%] border-r border-slate-600 md:table-cell print:table-cell font-bold text-center align-middle">
                  <div className="flex flex-col items-center gap-1">
                    <span className="print:text-black print:text-[18px]">日付</span>
                    {Object.keys(newsletters).length > 0 && (
                      <button
                        onClick={syncAllDates}
                        title="日付をツリー通信と同期"
                        className="flex items-center gap-1 text-[10px] text-primary/80 bg-primary/10 hover:bg-primary/20 rounded px-1.5 py-0.5 transition-colors print:hidden"
                      >
                        <RefreshCw size={9} /> 日付同期
                      </button>
                    )}
                  </div>
                </div>
                <div className={`p-2 md:p-4 bg-primary border-r border-slate-600 print:hidden transition-all duration-300 relative group md:table-cell font-bold text-center align-middle ${isNewsletterCollapsed ? 'w-[50px] min-w-[50px]' : 'w-[25%] min-w-[180px] md:min-w-[240px]'}`}>
                  <div className="flex items-center justify-center gap-2">
                    {!isNewsletterCollapsed && <span>ツリー通信</span>}
                    <button
                      onClick={() => setIsNewsletterCollapsed(!isNewsletterCollapsed)}
                      className="p-1 hover:bg-white/20 rounded transition-colors"
                      title={isNewsletterCollapsed ? "展開する" : "格納する"}
                    >
                      {isNewsletterCollapsed ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
                    </button>
                  </div>
                </div>
                <div className="p-2 md:p-4 print:p-1 border-r border-slate-600 w-[18%] print:w-[22%] min-w-[140px] md:min-w-[180px] print:min-w-0 md:table-cell print:table-cell font-bold text-center align-middle"><span className="print:text-black print:text-[18px]">療育内容</span></div>
                <div className="p-2 md:p-4 print:p-1 border-r border-slate-600 w-[25%] print:w-[40%] min-w-[200px] md:min-w-[280px] print:min-w-0 md:table-cell print:table-cell font-bold text-center align-middle"><span className="print:text-black print:text-[18px]">療育を行った結果</span></div>
                <div className="p-2 md:p-4 print:p-1 border-r border-slate-600 w-[18%] print:w-[30%] min-w-[140px] md:min-w-[200px] print:min-w-0 md:table-cell print:table-cell font-bold text-center align-middle"><span className="print:text-black print:text-[18px]">今後の予定</span></div>
                <div className="p-2 md:p-4 w-[70px] md:w-[80px] bg-slate-800 z-10 border-l border-slate-600 print:hidden md:table-cell font-bold text-center align-middle">
                  <div className="flex items-center justify-center gap-1.5 text-slate-400" title="操作（削除 / アーカイブ）">
                    <Trash2 size={13} />
                    <Archive size={13} />
                  </div>
                </div>
              </div>
            </div>
            <div className="block md:table-row-group print:table-row-group">
              {rows.map((row, idx) => (
                <SupportImplementationRow
                  key={`${row.date}-${idx}-${row.childId}`}
                  row={row}
                  idx={idx}
                  isNewsletterCollapsed={isNewsletterCollapsed}
                  isEditingDate={editingDateIdx === idx}
                  onEditDate={() => setEditingDateIdx(idx)}
                  onFinishEditDate={() => setEditingDateIdx(null)}
                  updateRowDate={updateRowDate}
                  toggleSupportContent={toggleSupportContent}
                  updateRowContent={updateRowContent}
                  handleSyncFromNewsletter={handleSyncFromNewsletter}
                  archiveRow={archiveRow}
                  newsletters={newsletters}
                  isSelectionMode={isSelectionMode}
                  isSelected={selectedRowIds.has(`${childId}_${row.date}`)}
                  onToggleSelect={() => toggleSelection(`${childId}_${row.date}`)}
                  onSingleAiConvert={handleSingleAiConvert}
                  isRecentlyImported={recentlyImportedDates.has(row.date)}
                  onDeleteRow={handleDeleteRow}
                />
              ))}
            </div>
          </div>
        </div>

        {/* ===== 印刷専用フッター ===== */}
        <div className="hidden print:flex justify-between items-end mt-12 print:mt-8 pt-6 border-t-2 border-slate-800 text-[11px] print:text-xl print:text-black print:font-bold page-break-inside-avoid">
          <div>
            令和&ensp;
            <span className="inline-block w-12 border-b-2 border-slate-800 text-center">
              {monthlySettings?.implementationYear || planMeta.month.split('-')[0]?.replace(/^\d{2}/, '') || ''}
            </span>
            年&ensp;
            <span className="inline-block w-10 border-b-2 border-slate-800 text-center">
              {monthlySettings?.implementationMonth || parseInt(planMeta.month.split('-')[1] || '0', 10)}
            </span>
            月&ensp;
            <span className="inline-block w-10 border-b-2 border-slate-800 text-center">
              {monthlySettings?.implementationDay || ''}
            </span>
            日作成&emsp;作成者：<span className="inline-block w-48 border-b-2 border-slate-800">{monthlySettings?.implementationCreator || ''}</span>
          </div>
          <div>（保護者署名）<span className="inline-block w-64 border-b-2 border-slate-800"></span></div>
        </div>
      </div>

      {/* 専門的支援実施計画 Excelインポートモーダル */}
      <DailyReportImportModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onImportSuccess={(historyAction) => {
          if (historyAction) {
            setUndoStack(prev => [...prev, historyAction]);
            setRedoStack([]); // 新規インポート時はリドゥスタックをクリア

            // インポートされた日付を抽出してハイライト色付け
            const dateSet = new Set<string>();
            historyAction.after.dailyReports.forEach(r => {
              if (r.payload?.date) {
                const parts = r.payload.date.split('-');
                if (parts.length === 3) {
                  dateSet.add(`${parseInt(parts[1], 10)}月${parseInt(parts[2], 10)}日`);
                } else {
                  dateSet.add(r.payload.date);
                }
              }
            });
            if (dateSet.size > 0 && planMeta?.excludedDates && planMeta.excludedDates.length > 0) {
              const updatedExcluded = planMeta.excludedDates.filter(d => !dateSet.has(d));
              if (updatedExcluded.length !== planMeta.excludedDates.length) {
                const targetMonth = planMeta.month || currentMonth;
                const newMeta = { ...planMeta, excludedDates: updatedExcluded };
                setPlanMeta(newMeta);
                const planDocPref = doc(db, PLAN_COL, `${selectedOfficeId}_${childId}_${targetMonth}`);
                const planDocNoPref = doc(db, PLAN_COL, `${childId}_${targetMonth}`);
                setDoc(planDocPref, { excludedDates: updatedExcluded }, { merge: true });
                setDoc(planDocNoPref, { excludedDates: updatedExcluded }, { merge: true });
              }
            }

            setHistoryToast({
              message: `${historyAction.summary} を実行しました（反映行を緑色でハイライト中）`,
              actionId: historyAction.id,
              type: 'success',
              canUndo: true
            });
          }
          fetchData();
        }}
        currentMonth={currentMonth}
        childId={childId}
        childrenData={childrenData}
        selectedOfficeId={selectedOfficeId}
        offices={offices}
        loginStaffName={loginStaffName}
      />

      {/* Gemini療育結果一括登録モーダル */}
      <ResultImportModal
        isOpen={isResultImportOpen}
        onClose={() => setIsResultImportOpen(false)}
        monthStr={currentMonth}
        existingRows={rows}
        onImport={handleImportResults}
      />

      {/* AIデバッグエラーモーダル */}
      {debugError && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[999] flex items-center justify-center p-4 overflow-y-auto animate-fade-in print:hidden">
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col my-8 max-h-[85vh] animate-scale-up">
            {/* ヘッダー */}
            <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="bg-red-500/20 text-red-400 p-2 rounded-lg">
                  <AlertTriangle size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-lg">AI変換エラー詳細（デバッグ情報）</h3>
                  <p className="text-slate-400 text-xs mt-0.5">Gemini APIとの通信時にエラーが発生しました</p>
                </div>
              </div>
              <button 
                onClick={() => setDebugError(null)}
                className="text-slate-400 hover:text-white hover:bg-slate-800 p-2 rounded-lg transition-all"
              >
                <X size={20} />
              </button>
            </div>

            {/* コンテンツ */}
            <div className="p-6 overflow-y-auto flex-1 space-y-5 text-slate-700">
              {/* レート制限のアラート (Retry-After) */}
              {debugError.retryAfter && (
                <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex gap-3 text-amber-900 animate-pulse">
                  <AlertTriangle size={20} className="text-amber-600 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-amber-800 uppercase tracking-wider">Retry-After (APIレート制限)</p>
                    <p className="text-sm font-semibold">
                      Gemini APIからレート制限（429）が課されました。推奨される待機秒数: <span className="text-red-600 font-extrabold text-base px-1">{debugError.retryAfter}</span> 秒。
                      この時間が経過してから再試行してください。
                    </p>
                  </div>
                </div>
              )}

              {/* エラー内容 */}
              <div className="bg-red-50 border border-red-200/80 rounded-xl p-4 flex gap-3">
                <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-xs font-bold text-red-800 uppercase tracking-wider">エラー内容</p>
                  <p className="text-sm font-semibold text-red-950 break-all leading-relaxed">{debugError.message}</p>
                </div>
              </div>

              {/* 基本情報グリッド */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">実際に送信しているモデル名</p>
                  <code className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded border border-indigo-100/50 break-all">{debugError.model}</code>
                </div>
                <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">HTTPレスポンスステータス</p>
                  <span className={`text-xs font-black px-2 py-1 rounded border inline-block ${
                    debugError.httpStatus 
                      ? (debugError.httpStatus === 429 ? 'bg-red-50 text-red-700 border-red-200/50' : 'bg-amber-50 text-amber-700 border-amber-200/50')
                      : 'bg-slate-100 text-slate-600 border-slate-200/50'
                  }`}>
                    {debugError.httpStatus ? `HTTP ${debugError.httpStatus}` : 'N/A (送信前または接続エラー)'}
                  </span>
                </div>
                <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">送信リクエスト進捗 (回数)</p>
                  <span className="text-xs font-bold text-slate-700 bg-slate-100 px-2 py-1 rounded border border-slate-200/50 inline-block">
                    {debugError.requestCount || '1 / 1'}
                  </span>
                </div>
              </div>

              {/* 送信URL */}
              <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 space-y-1">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">実際に送信しているURL</p>
                <div className="font-mono text-xs text-slate-600 break-all bg-white p-2 rounded border border-slate-200/50">
                  {debugError.url}
                </div>
              </div>

              {/* APIエラー詳細 JSON */}
              {debugError.errorDetails && (
                <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 space-y-1">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Gemini APIエラー詳細 (error JSON)</p>
                  <pre className="font-mono text-xs text-red-600 bg-red-50/20 p-3 rounded border border-red-100/50 overflow-x-auto max-h-40 overflow-y-auto break-all whitespace-pre-wrap">
                    {JSON.stringify(debugError.errorDetails, null, 2)}
                  </pre>
                </div>
              )}

              {/* 利用可能モデル一覧 */}
              <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">利用可能なモデル一覧 (ListModels結果)</p>
                  {debugError.listModelsError && (
                    <span className="text-[10px] text-red-600 font-semibold bg-red-50 border border-red-100 px-2 py-0.5 rounded">ListModels取得エラー</span>
                  )}
                </div>
                <div className="font-mono text-xs text-slate-600 bg-white p-3 rounded border border-slate-200/50 max-h-40 overflow-y-auto space-y-1">
                  {debugError.availableModels.length > 0 ? (
                    debugError.availableModels.map((m, idx) => (
                      <div key={idx} className="flex items-center gap-2 py-0.5 border-b border-slate-100 last:border-0">
                        <span className="text-slate-400 select-none text-[9px] w-4">{idx + 1}.</span>
                        <span className={m === debugError.model ? 'text-indigo-600 font-bold bg-indigo-50/50 px-1.5 rounded' : ''}>{m}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-slate-400 italic">キャッシュデータ適用中 (または取得前にエラーが発生しました)</div>
                  )}
                  {debugError.listModelsError && (
                    <div className="mt-2 text-red-600 text-[10px] bg-red-50/30 p-2 rounded border border-red-100/50 break-all whitespace-pre-wrap">
                      【エラー詳細】: {debugError.listModelsError}
                    </div>
                  )}
                </div>
              </div>

              {/* リクエスト内容 (JSON) */}
              <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 space-y-1">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">送信リクエストボディ (JSON)</p>
                <pre className="font-mono text-xs text-slate-600 bg-white p-3 rounded border border-slate-200/50 overflow-x-auto max-h-40 overflow-y-auto">
                  {debugError.payload ? JSON.stringify(debugError.payload, null, 2) : 'N/A'}
                </pre>
              </div>

              {/* HTTPレスポンス詳細 */}
              {debugError.httpResponse && (
                <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 space-y-1">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">APIからの応答レスポンス (Raw)</p>
                  <pre className="font-mono text-xs text-slate-600 bg-white p-3 rounded border border-slate-200/50 overflow-x-auto max-h-40 overflow-y-auto break-all whitespace-pre-wrap">
                    {debugError.httpResponse}
                  </pre>
                </div>
              )}
            </div>

            {/* フッター */}
            <div className="bg-slate-50 border-t border-slate-100 px-6 py-4 flex gap-3 justify-end">
              <button
                onClick={handleCopyDebugInfo}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold shadow-sm border transition-all ${
                  isCopied 
                    ? 'bg-emerald-600 border-emerald-600 text-white' 
                    : 'bg-slate-800 border-slate-800 hover:bg-slate-700 text-white'
                }`}
              >
                {isCopied ? (
                  <>
                    <Check size={16} />
                    <span>コピー完了しました！</span>
                  </>
                ) : (
                  <>
                    <Copy size={16} />
                    <span>デバッグ情報をコピー</span>
                  </>
                )}
              </button>
              <button
                onClick={() => setDebugError(null)}
                className="px-5 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-bold transition-all"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* エクスポート完了モーダル */}
      {isExportSuccessOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 print:hidden animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 max-w-md w-full flex flex-col p-6 text-center space-y-4">
            <div className="mx-auto w-12 h-12 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center">
              <Check size={24} className="stroke-[3]" />
            </div>
            
            <div className="space-y-2">
              <h3 className="font-black text-slate-800 text-lg">Excel上書き保存が完了しました！</h3>
              <div className="text-slate-500 text-sm leading-relaxed space-y-2 text-left">
                {exportSuccessType === 'direct' ? (
                  <p>
                    選択されたファイル <span className="font-bold text-slate-700">「{targetFileName}」</span> 自体へ、データを直接上書き保存しました。<br />
                    エクセルファイルを開き、データが更新されていることをご確認ください。
                  </p>
                ) : (
                  <p>
                    上書きされたExcelファイル <span className="font-bold text-slate-700">「{targetFileName.replace(/\.xlsx$/, '')}_上書き版.xlsx」</span> のダウンロードが開始されました。<br />
                    ダウンロードされたファイルを開いてデータをご確認ください。
                  </p>
                )}
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-900 text-xs">
                  <p className="font-bold">💡 Webブラウザの制限に関する注意</p>
                  <p className="mt-1">
                    セキュリティ上の理由から、ブラウザから自動的にExcelアプリを直接起動して開くことはできません。<br />
                    ダウンロード完了後にブラウザのダウンロード履歴、または保存先のフォルダからファイルを開いてご確認ください。
                  </p>
                </div>
              </div>
            </div>
            
            <div className="pt-2 flex gap-3">
              <button
                onClick={() => setIsExportSuccessOpen(false)}
                className="flex-1 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm shadow-sm transition-all"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* エクスポート進捗ログモーダル */}
      {isExportLogOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 print:hidden animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 max-w-2xl w-full flex flex-col max-h-[85vh] overflow-hidden">
            {/* ヘッダー */}
            <div className="bg-slate-50 border-b border-slate-100 px-6 py-4 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 text-primary">
                <UploadCloud size={20} />
                <h3 className="font-black text-slate-800 text-lg">Excel上書きエクスポートの進捗ログ</h3>
              </div>
              <button onClick={() => setIsExportLogOpen(false)} className="text-slate-400 hover:text-slate-600 p-1.5 rounded-full hover:bg-slate-100 transition-colors">
                <X size={20} />
              </button>
            </div>
            {/* ログ一覧 */}
            <div className="p-6 overflow-y-auto flex-1 font-mono text-xs bg-slate-900 text-slate-200 space-y-1">
              {exportLogs.length === 0 ? (
                <div className="text-slate-500 italic py-4">ログがありません。エクスポートを実行してください。</div>
              ) : (
                exportLogs.map((log, index) => (
                  <div key={index} className="py-0.5 border-b border-slate-800/50 last:border-0 leading-relaxed font-semibold">
                    <span className="text-slate-500 select-none mr-2">[{index + 1}]</span>
                    <span className={log.includes('➜') ? 'text-emerald-400' : (log.includes('エラー') ? 'text-red-400' : 'text-slate-300')}>{log}</span>
                  </div>
                ))
              )}
            </div>
            {/* フッター */}
            <div className="bg-slate-50 border-t border-slate-100 px-6 py-4 flex justify-end shrink-0">
              <button
                onClick={() => setIsExportLogOpen(false)}
                className="px-5 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-white text-sm font-bold transition-all"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* アンドゥ・リドゥ操作トースト */}
      {historyToast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 bg-slate-900/95 text-white px-5 py-3.5 rounded-xl shadow-2xl border border-slate-700 backdrop-blur-md animate-in fade-in slide-in-from-bottom-5 duration-200">
          <div className="flex items-center gap-2 text-sm font-medium">
            {historyToast.type === 'undo' ? (
              <Undo2 size={18} className="text-amber-400" />
            ) : historyToast.type === 'redo' ? (
              <Redo2 size={18} className="text-blue-400" />
            ) : (
              <Check size={18} className="text-emerald-400" />
            )}
            <span>{historyToast.message}</span>
          </div>

          <div className="flex items-center gap-2 ml-3 pl-3 border-l border-slate-700">
            {undoStack.length > 0 && (
              <button
                onClick={handleUndo}
                disabled={isUndoRedoing}
                className="px-2.5 py-1 text-xs font-bold bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-md transition-colors flex items-center gap-1 disabled:opacity-50 cursor-pointer"
              >
                <Undo2 size={13} />
                <span>元に戻す</span>
              </button>
            )}
            {redoStack.length > 0 && (
              <button
                onClick={handleRedo}
                disabled={isUndoRedoing}
                className="px-2.5 py-1 text-xs font-bold bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/40 rounded-md transition-colors flex items-center gap-1 disabled:opacity-50 cursor-pointer"
              >
                <Redo2 size={13} />
                <span>やり直す</span>
              </button>
            )}
            <button
              onClick={() => setHistoryToast(null)}
              className="text-slate-400 hover:text-white p-1 rounded transition-colors ml-1 cursor-pointer"
              title="閉じる"
            >
              <X size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ---- メモ化された行コンポーネント ----




