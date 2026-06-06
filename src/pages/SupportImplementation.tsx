import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Plus, Archive, RefreshCw,
  Save, User as UserIcon, Target, Calendar, ChevronRight,
  Loader2, Printer, Download,
  ChevronLeft, Trash2, X, Check, UploadCloud, Copy, AlertTriangle
} from 'lucide-react';
import { SupportImplementationRow } from './SupportImplementationRow';
import { DailyReportImportModal } from '../components/DailyReportImportModal';
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
import { exportSupportImplementation } from '../lib/excelExport';
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
  const [isConverting, setIsConverting] = useState(false);
  // 日付編集中の行インデックス (null = 全行ロック)
  const [editingDateIdx, setEditingDateIdx] = useState<number | null>(null);
  const [isNewsletterCollapsed, setIsNewsletterCollapsed] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [monthlySettings, setMonthlySettings] = useState<any>(null);
  const [loginStaffName, setLoginStaffName] = useState<string>("");
  const [loginOfficeId, setLoginOfficeId] = useState<string>("");
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const isInitialLoad = React.useRef(true);
  const [isImportOpen, setIsImportOpen] = useState(false);


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
      const docId = `${childId}_${currentMonth}_${selectedOfficeId}`;
      
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

      const results = await Promise.all(queries);
      
      const metaSnap = results[0] as any;
      const profDocs = results[1] as any;
      const dailySnap = results[2] as any;
      const settingsSnap = results[3] as any;
      const reportSnap1 = results[4] as any;
      const reportSnap2 = officeId ? results[5] as any : null;

      // 計画メタ情報
      let meta: SupportPlanMeta;
      if (metaSnap.exists()) {
        meta = metaSnap.data() as SupportPlanMeta;
      } else {
        meta = { 
          childId, month: currentMonth, goals: "", 
          author: "スタッフ 太郎", createdAt: new Date().toISOString() 
        };
      }
      setPlanMeta(meta);

      // プロフェッショナルプランの最新版を取得
      let latestProf: ProfessionalPlanDoc | null = null;
      if (profDocs && !profDocs.empty) {
        const list = profDocs.docs.map((d: any) => d.data() as ProfessionalPlanDoc);
        list.sort((a: any, b: any) => {
          const aM = a.startMonth || "";
          const bM = b.startMonth || "";
          return aM.localeCompare(bM);
        });
        latestProf = list[list.length - 1];
      }
      setProfPlan(latestProf);

      // 月別設定
      if (settingsSnap.exists()) {
        setMonthlySettings(settingsSnap.data());
      } else {
        setMonthlySettings(null);
      }

      // ツリー通信 (reports) のパース
      const newsMap: Record<string, string> = {};
      const processReportSnap = (snap: any) => {
        if (!snap) return;
        snap.forEach((d: any) => {
          const data = d.data();
          if (data.results?.[childId]?.D) {
            const match = d.id.match(/(\d{4})-(\d{2})-(\d{2})$/);
            if (match) {
              const mNum = parseInt(match[2], 10);
              const dNum = parseInt(match[3], 10);
              newsMap[`${mNum}月${dNum}日`] = data.results[childId].D;
            }
          }
        });
      };
      processReportSnap(reportSnap1);
      processReportSnap(reportSnap2);
      setNewsletters(newsMap);

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
          const parsed = new Date(data.date);
          if (!isNaN(parsed.getTime())) {
            dObj = parsed;
            dateStr = `${dObj.getMonth() + 1}月${dObj.getDate()}日`;
          } else {
            dateStr = data.date;
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

      // 統合（ツリー通信の日付 or 保存済みの日付）
      const allDates = Array.from(new Set([...Object.keys(newsMap), ...Object.keys(savedRowsGrouped)]));
      const monthNum = parseInt(meta.month.split('-')[1] || '0', 10);

      const targetDates = allDates.filter(d => {
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
            const externalInfo = newsMap[date] || saved.content.externalInfo || "";
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
                futurePlan: saved.content.futurePlan || "",
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
              futurePlan: "",
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

  // ---- 保存 ----
  const handleSave = useCallback(async () => {
    if (!planMeta || !childId) return;
    setSaveStatus('saving');
    try {
      const docId = `${childId}_${currentMonth}_${selectedOfficeId}`;
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

        // C) children/{児童ID}/.../tree_communications/{日付} の保存
        const childTreeRef = doc(db, `children/${childId}/app_categories/書類管理/tree_communications`, formattedDate);
        const childTreeDoc = {
          name: selectedChild?.fullName || "",
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

  const handleImportComplete = async (importedRows: DailyReport[]) => {
    if (!planMeta || !childId) return;

    const confirmMsg = `解析された ${importedRows.length} 件のデータ（原本を除く全月シート分）を読み込みました。これらをFirestoreへ【すべて上書き保存】しますか？\n(既存の同日のデータは更新されます。保存後に画面は自動的にリロードされます)`;
    if (!window.confirm(confirmMsg)) return;

    setIsLoading(true);

    try {
      // 1. 重複を防ぐため、対象児童の既存の daily_reports ドキュメントをロード
      const targetMonths = Array.from(new Set(importedRows.map(r => r.planMonth)));
      const existingDocsMap: Record<string, string> = {}; // "YYYY-MM-DD" -> "documentId"

      for (const m of targetMonths) {
        const q = query(
          collection(db, DAILY_COL),
          where('childId', '==', childId),
          where('planMonth', '==', m),
          where('officeId', '==', selectedOfficeId)
        );
        const snap = await getDocs(q);
        snap.forEach(d => {
          const data = d.data();
          if (data.date) {
            existingDocsMap[data.date] = d.id;
          }
        });
      }

      // 2. バッチ書き込みの準備
      const batch = writeBatch(db);

      // 3. 各月のメタ情報（supportPlans）も一括で作成/更新
      for (const m of targetMonths) {
        const docId = `${childId}_${m}_${selectedOfficeId}`;
        const planMetaRef = doc(db, PLAN_COL, docId);
        const metaPayload = {
          childId,
          month: m,
          goals: planMeta.goals || '',
          author: loginStaffName || 'スタッフ 太郎',
          officeId: selectedOfficeId,
          createdAt: new Date().toISOString()
        };
        batch.set(planMetaRef, metaPayload, { merge: true });
      }

      // 4. 日報データの一括保存
      for (const row of importedRows) {
        const [yearStr] = row.planMonth.split('-');
        const mMatch = row.date.match(/(\d+)月/);
        const dMatch = row.date.match(/(\d+)日/);
        const monthNum = mMatch ? parseInt(mMatch[1]) : 1;
        const dayNum = dMatch ? parseInt(dMatch[1]) : 1;

        const pad = (n: number) => n.toString().padStart(2, '0');
        const formattedDate = `${yearStr}-${pad(monthNum)}-${pad(dayNum)}`;

        const payload: any = {
          childId: childId,
          planMonth: row.planMonth,
          date: formattedDate,
          staffId: row.staffId || '',
          staffName: loginStaffName || row.staffId || '',
          type: row.type,
          content: row.content,
          externalInfo: row.content.externalInfo || "",
          archived: row.archived || false,
          officeId: selectedOfficeId,
          updatedAt: serverTimestamp(),
        };

        const existingId = existingDocsMap[formattedDate];
        if (existingId) {
          // 既存ドキュメントの上書き更新
          const existingDocRef = doc(db, DAILY_COL, existingId);
          batch.update(existingDocRef, payload);
        } else {
          // 新規ドキュメントの作成
          const newDocRef = doc(collection(db, DAILY_COL));
          payload.createdAt = serverTimestamp();
          batch.set(newDocRef, payload);
        }

        // B) reports の保存
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

        // C) tree_communications の保存
        const childTreeRef = doc(db, `children/${childId}/app_categories/書類管理/tree_communications`, formattedDate);
        const childTreeDoc = {
          name: selectedChild?.fullName || "",
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

      alert('Excelファイルからのインポートが正常に完了しました！');
      setIsImportOpen(false);

      // 最新データを再ロードして画面を更新
      await fetchData();

    } catch (e: any) {
      console.error("Import save error:", e);
      alert(`インポートデータの保存中にエラーが発生しました: ${e.message || String(e)}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSyncFromNewsletter = (rowIdx: number, rowDate: string) => {
    if (!rowDate) {
      alert('日付を入力してください（例: 4月1日）');
      return;
    }
    const content = newsletters[rowDate];
    if (content) {
      updateRowContent(rowIdx, 'externalInfo', content);
    } else {
      alert(`「${rowDate}」のツリー通信が見つかりませんでした。`);
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

  const addRow = () => {
    if (!planMeta) return;
    const mNum = parseInt(planMeta.month.split('-')[1] || '1', 10);
    setRows(prev => [...prev, {
      childId: childId!,
      planMonth: planMeta.month,
      date: `${mNum}月1日`,
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
      return prev.map((r, i) => i === idx ? { ...r, date: newDate } : r);
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

  const handleExcelExport = () => {
    if (!selectedChild || !planMeta) return;

    // 支援目標のテキスト作成（profPlanがあればそれを使う）
    let targetGoals = planMeta.goals;
    if (profPlan) {
      targetGoals = `長期目標: ${profPlan.longTermGoal}\n短期目標: ${profPlan.shortTermGoal}`;
    }

    const fileName = `専門的支援実施計画_${selectedChild.fullName}_${planMeta.month}`;
    exportSupportImplementation(
      selectedChild.fullName,
      planMeta.month,
      targetGoals,
      rows,
      fileName
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

  const handleDeleteSelected = async () => {
    if (selectedRowIds.size === 0) return;
    if (!window.confirm(`${selectedRowIds.size}件の記録を削除しますか？（この操作は取り消せません）`)) return;

    try {
      const batch = writeBatch(db);
      selectedRowIds.forEach(id => {
        // id は childId_date になっているので、Firestoreのドキュメントを探す必要がある
        // rowsからIDを取得する
        const row = rows.find(r => `${childId}_${r.date}` === id);
        if (row?.id) {
          batch.delete(doc(db, DAILY_COL, row.id));
        }
      });
      await batch.commit();

      setRows(prev => prev.filter(r => !selectedRowIds.has(`${childId}_${r.date}`)));
      setSelectedRowIds(new Set());
      setIsSelectionMode(false);
      alert('削除しました');
    } catch (err) {
      console.error(err);
      alert('削除に失敗しました');
    }
  };



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
    { label: '行追加', icon: <Plus size={18} />, onClick: addRow },
    { label: 'Excelインポート', icon: <UploadCloud size={18} />, onClick: () => setIsImportOpen(true), colorClass: 'bg-emerald-600 text-white' },
    { label: 'Excel出力', icon: <Download size={18} />, onClick: handleExcelExport },
    { label: '印刷', icon: <Printer size={18} />, onClick: handlePrint },
  ];

  return (
    <div id="support-impl-print" className="max-w-[1400px] mx-auto flex flex-col gap-8 print:gap-4 pb-20 print:pb-0 animate-fade-in">
      {/* 自動保存ステータスインジケーター */}
      {saveStatus !== 'idle' && (
        <div className="fixed bottom-24 right-6 z-50 flex items-center gap-2 pointer-events-none">
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
        <div className="hidden md:flex gap-3">
          <button className="btn-secondary flex items-center gap-2" onClick={addRow}>
            <Plus size={16} /> 行追加
          </button>
          <button className="btn-secondary flex items-center gap-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200" onClick={() => setIsImportOpen(true)}>
            <UploadCloud size={16} /> Excelインポート
          </button>
          <button className="btn-secondary flex items-center gap-2" onClick={handleExcelExport}>
            <Download size={16} /> Excel出力
          </button>
          <button className="btn-secondary flex items-center gap-2" onClick={handlePrint}>
            <Printer size={16} /> 印刷
          </button>
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
        <div className="text-center mb-10 print:mb-4 border-b-2 border-slate-800 pb-6 print:pb-2 tracking-widest text-3xl print:text-xl font-black relative">
          専門的支援実施計画　<span className="font-normal text-base ml-2">({officeName})</span>
        </div>

        <div className="grid grid-cols-2 gap-8 print:gap-2 mb-8 print:mb-4">
          <div className="border-b border-slate-400 pb-2 flex items-end gap-3">
            <UserIcon size={20} className="text-primary mb-1" />
            <span className="text-2xl font-bold">{selectedChild.fullName} 様</span>
          </div>
          <div className="border-b border-slate-400 pb-2 flex items-end gap-3">
            <Calendar size={20} className="text-primary mb-1" />
            <input type="month" value={planMeta.month} style={{ touchAction: 'pan-y' }} onChange={handleMonthChange} className="text-xl font-bold outline-none bg-transparent" />
          </div>
        </div>

        {/* ===== 支援目標（専門的支援計画書から自動共有） ===== */}
        <div className="mb-10 print:mb-4 bg-slate-50 rounded-xl border overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b bg-white">
            <h3 className="text-sm font-bold flex items-center gap-2 uppercase">
              <Target size={16} className="text-primary" /> 支援目標
            </h3>
            {profPlan ? (
              <span className="text-[10px] text-primary font-semibold bg-primary/10 px-2 py-0.5 rounded-full">
                専門的支援計画書より参照
              </span>
            ) : (
              <span className="text-[10px] text-amber-600 font-semibold bg-amber-50 px-2 py-0.5 rounded-full">
                ※専門的支援計画書が未作成です
              </span>
            )}
          </div>
          {profPlan ? (
            <div className="p-5 print:p-3 flex flex-col gap-4 print:gap-2 text-sm print:text-xs">
              {/* 長期目標 */}
              <div className="flex gap-3">
                <span className="shrink-0 text-[11px] font-bold text-slate-500 bg-slate-200 px-2 py-0.5 rounded h-fit mt-0.5">長期目標</span>
                <p className="whitespace-pre-wrap text-slate-700 leading-relaxed">
                  {profPlan.longTermGoal || <span className="text-slate-300 italic">未入力</span>}
                </p>
              </div>
              {/* 短期目標 */}
              <div className="flex gap-3">
                <span className="shrink-0 text-[11px] font-bold text-slate-500 bg-slate-200 px-2 py-0.5 rounded h-fit mt-0.5">短期目標</span>
                <p className="whitespace-pre-wrap text-slate-700 leading-relaxed">
                  {profPlan.shortTermGoal || <span className="text-slate-300 italic">未入力</span>}
                </p>
              </div>
              {/* 具体的な到達目標（カテゴリ別） */}
              {(['本人支援', '家族支援', '移行支援'] as const).map((cat) => {
                const catRows = (profPlan.supportRows ?? []).filter(r => r.category === cat && r.supportGoal?.trim());
                if (catRows.length === 0) return null;
                return (
                  <div key={cat} className="flex gap-3">
                    <span className={`shrink-0 text-[11px] font-bold px-2 py-0.5 rounded h-fit mt-0.5 ${cat === '本人支援' ? 'text-violet-700 bg-violet-100' :
                        cat === '家族支援' ? 'text-emerald-700 bg-emerald-100' :
                          'text-orange-700 bg-orange-100'
                      }`}>{cat}</span>
                    <ul className="flex flex-col gap-1.5">
                      {catRows.map((r, i) => (
                        <li key={r.id ?? i} className="flex items-start gap-2 text-slate-700 leading-relaxed">
                          <span className="text-primary font-bold text-[11px] mt-0.5">▸</span>
                          <span className="whitespace-pre-wrap">{r.supportGoal}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-5">
              <textarea
                className="w-full h-20 bg-transparent outline-none resize-none text-sm"
                style={{ touchAction: 'pan-y' }}
                placeholder="支援目標を入力してください…"
                value={planMeta.goals}
                onChange={e => setPlanMeta({ ...planMeta, goals: e.target.value })}
              />
            </div>
          )}
        </div>

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
              <div className="bg-slate-800 text-white text-[10px] md:text-xs print:text-[10px] shadow-sm md:table-row print:table-row">
                {isSelectionMode && <div className="p-2 md:p-4 w-[50px] border-r border-slate-600 print:hidden md:table-cell font-bold text-center align-middle">選択</div>}
                <div className="p-2 md:p-4 print:p-1 w-[60px] md:w-[80px] print:w-[8%] border-r border-slate-600 md:table-cell print:table-cell font-bold text-center align-middle">
                  <div className="flex flex-col items-center gap-1">
                    <span>日付</span>
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
                <div className="p-2 md:p-4 print:p-1 border-r border-slate-600 w-[18%] print:w-[22%] min-w-[140px] md:min-w-[180px] print:min-w-0 md:table-cell print:table-cell font-bold text-center align-middle">療育内容</div>
                <div className="p-2 md:p-4 print:p-1 border-r border-slate-600 w-[25%] print:w-[40%] min-w-[200px] md:min-w-[280px] print:min-w-0 md:table-cell print:table-cell font-bold text-center align-middle">療育を行った結果</div>
                <div className="p-2 md:p-4 print:p-1 border-r border-slate-600 w-[18%] print:w-[30%] min-w-[140px] md:min-w-[200px] print:min-w-0 md:table-cell print:table-cell font-bold text-center align-middle">今後の予定</div>
                <div className="p-4 w-[60px] bg-slate-800 z-10 border-l border-slate-600 print:hidden md:table-cell font-bold text-center align-middle">
                  <div className="flex items-center justify-center">
                    <Archive size={16} />
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
                />
              ))}
            </div>
          </div>
        </div>

        {/* ===== 印刷専用フッター ===== */}
        <div className="hidden print:flex justify-between items-end mt-8 print:mt-4 pt-4 border-t border-slate-400 text-[11px]">
          <div>
            令和&ensp;
            <span className="inline-block w-8 border-b border-slate-600">
              {monthlySettings?.implementationYear || planMeta.month.split('-')[0]?.replace(/^\d{2}/, '') || ''}
            </span>
            年&ensp;
            <span className="inline-block w-6 border-b border-slate-600">
              {monthlySettings?.implementationMonth || parseInt(planMeta.month.split('-')[1] || '0', 10)}
            </span>
            月&ensp;
            <span className="inline-block w-6 border-b border-slate-600">
              {monthlySettings?.implementationDay || ''}
            </span>
            日作成&emsp;作成者：<span className="inline-block w-32 border-b border-slate-600">{monthlySettings?.implementationCreator || ''}</span>
          </div>
          <div>（保護者署名）<span className="inline-block w-40 border-b border-slate-600"></span></div>
        </div>
      </div>

      {/* Excelコピペインポートモーダル */}
      <DailyReportImportModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onImport={handleImportComplete}
        currentMonth={currentMonth}
        childId={childId!}
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
    </div>
  );
};

// ---- メモ化された行コンポーネント ----




