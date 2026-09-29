import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Calendar,
  Save,
  Printer,
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Clock,
  CheckCircle2,
  MessageSquare,
  Sparkles,
  Zap,
  Loader2,
} from 'lucide-react';
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  collection,
  getDocs
} from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { convertToObservation } from '../lib/aiConvert';
import type { Child } from '../data/mockData';
import type { ForceSheetDoc, ForceSheetRow, ChatMessage, StaffMember } from '../types/forceSheet';

interface ForceSheetProps {
  childrenData: Child[];
  selectedOfficeId: string;
  offices: { id: string; name: string }[];
}

const DEFAULT_ROWS: () => ForceSheetRow[] = () =>
  Array.from({ length: 10 }, (_, i) => ({
    id: `row-${i + 1}`,
    time: '',
    activity: '',
    stepContent: '',
    observation: '',
  }));

export const ForceSheet: React.FC<ForceSheetProps> = ({
  childrenData,
  selectedOfficeId,
  offices,
}) => {
  const { childId } = useParams<{ childId: string }>();
  const navigate = useNavigate();

  // 今日の日付 (YYYY-MM-DD)
  const todayStr = useMemo(() => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }, []);

  // 状態管理
  const [serviceDate, setServiceDate] = useState<string>(todayStr);
  const [createdDate, setCreatedDate] = useState<string>(todayStr);
  const [officeName, setOfficeName] = useState<string>('');
  const [authorName, setAuthorName] = useState<string>('');
  const [serviceStaffName, setServiceStaffName] = useState<string>('');
  const [rows, setRows] = useState<ForceSheetRow[]>(DEFAULT_ROWS());
  const [notes, setNotes] = useState<string>('');

  // スタッフ一覧
  const [staffList, setStaffList] = useState<StaffMember[]>([]);

  // チャットメモ関連
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState<boolean>(false);
  const [usedMessageIds, setUsedMessageIds] = useState<Set<string>>(new Set());

  // 保存・通知ステータス
  const [saving, setSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);

  // AI変換ステータス
  const [isConvertingAll, setIsConvertingAll] = useState<boolean>(false);
  const [convertingRowId, setConvertingRowId] = useState<string | null>(null);
  const [convertingStatus, setConvertingStatus] = useState<string>('');

  // 対象児童情報
  const currentChild = useMemo(() => {
    return childrenData.find((c) => c.id === childId) || null;
  }, [childrenData, childId]);

  // 現在の事業所名設定
  useEffect(() => {
    const currentOffice = offices.find((o) => o.id === selectedOfficeId);
    if (currentOffice) {
      setOfficeName(currentOffice.name);
    }
  }, [selectedOfficeId, offices]);

  // 1. スタッフ一覧とログインスタッフのロード
  useEffect(() => {
    const fetchStaff = async () => {
      try {
        const staffSnap = await getDocs(collection(db, 'staff'));
        const list: StaffMember[] = [];
        let currentStaffName = '';

        staffSnap.forEach((docSnap) => {
          const data = docSnap.data();
          const name = data.name || data.fullName || '(名前なし)';
          list.push({ id: docSnap.id, name });

          if (auth.currentUser && docSnap.id === auth.currentUser.uid) {
            currentStaffName = name;
          }
        });

        // 50音順や名前順にソート
        list.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
        setStaffList(list);

        // 作成者・提供者が未設定ならログインスタッフをデフォルト設定
        if (currentStaffName) {
          setAuthorName((prev) => prev || currentStaffName);
          setServiceStaffName((prev) => prev || currentStaffName);
        }
      } catch (err) {
        console.error('Failed to load staff list:', err);
      }
    };

    fetchStaff();
  }, []);

  // 和暦フォーマットヘルパー (令和)
  const formatWareki = (dateStr: string) => {
    if (!dateStr) return { year: '', month: '', day: '' };
    const parts = dateStr.split('-');
    if (parts.length !== 3) return { year: '', month: '', day: '' };
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);
    const rYear = y - 2018;
    return {
      year: rYear > 0 ? String(rYear) : '',
      month: String(m),
      day: String(d),
    };
  };

  // 2. 強行シートデータのロード
  const loadForceSheet = useCallback(async () => {
    if (!childId || !serviceDate) return;
    try {
      const docKey = `${selectedOfficeId}_${childId}_${serviceDate}`;
      const docRef = doc(db, 'forceSheets', docKey);
      const snap = await getDoc(docRef);

      if (snap.exists()) {
        const data = snap.data() as ForceSheetDoc;
        setCreatedDate(data.createdDate || serviceDate);
        setOfficeName(data.officeName || '');
        if (data.authorName) setAuthorName(data.authorName);
        if (data.serviceStaffName) setServiceStaffName(data.serviceStaffName);
        setRows(
          data.rows && data.rows.length > 0
            ? data.rows.map((r) => ({
                id: r.id || `row-${Math.random()}`,
                time: r.time || '',
                activity: r.activity || '',
                stepContent: r.stepContent || '',
                observation: r.observation || '',
              }))
            : DEFAULT_ROWS()
        );
        setNotes(data.notes || '');
      } else {
        // 新規作成時はサービス提供日に作成日を合わせる
        setCreatedDate(serviceDate);
        setRows(DEFAULT_ROWS());
        setNotes('');
      }
    } catch (err) {
      console.error('Failed to load force sheet:', err);
    }
  }, [childId, selectedOfficeId, serviceDate]);

  // 3. チャットメモ (reports) のロード
  const loadChatMessages = useCallback(async () => {
    if (!childId || !serviceDate) return;
    setLoadingMessages(true);
    try {
      const msgs: ChatMessage[] = [];
      const checkedIds = new Set<string>();

      const docKeys = [
        `${selectedOfficeId}_${serviceDate}`,
        serviceDate,
      ];

      for (const key of docKeys) {
        try {
          const reportRef = doc(db, 'reports', key);
          const snap = await getDoc(reportRef);
          if (snap.exists()) {
            const data = snap.data();
            const childMsgs = data.messages?.[childId];
            if (Array.isArray(childMsgs)) {
              childMsgs.forEach((m: any) => {
                if (m && !checkedIds.has(m.id || m.timestamp)) {
                  const id = m.id || m.timestamp || Math.random().toString();
                  checkedIds.add(id);
                  msgs.push({
                    id,
                    text: m.text || '',
                    timestamp: m.timestamp || '',
                    staffName: m.staffName || '',
                    tag: m.tag || null,
                    included: m.included !== false,
                  });
                }
              });
            }
          }
        } catch (subErr) {
          console.warn('Could not fetch report for key:', key, subErr);
        }
      }

      msgs.sort((a, b) => {
        const timeA = new Date(a.timestamp).getTime() || 0;
        const timeB = new Date(b.timestamp).getTime() || 0;
        return timeA - timeB;
      });

      setChatMessages(msgs);
    } catch (err) {
      console.error('Failed to load chat messages:', err);
      setChatMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  }, [childId, selectedOfficeId, serviceDate]);

  useEffect(() => {
    loadForceSheet();
    loadChatMessages();
    setUsedMessageIds(new Set());
  }, [loadForceSheet, loadChatMessages]);

  // 時刻フォーマット (HH:mm)
  const formatMsgTime = (ts: string) => {
    if (!ts) return '';
    try {
      const date = new Date(ts);
      if (isNaN(date.getTime())) return '';
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    } catch {
      return '';
    }
  };

  // 通知トースト表示
  const showNotice = (msg: string) => {
    setFeedbackNotice(msg);
    setTimeout(() => {
      setFeedbackNotice(null);
    }, 2500);
  };

  // タグ名から【】などの括弧を除去するヘルパー
  const cleanTagName = (tag: string | null | undefined): string => {
    if (!tag) return '';
    return tag.replace(/[【】\[\]［］「」]/g, '').trim();
  };

  // 様子テキストから冒頭の【タグ名】を除去するヘルパー
  const cleanObservationText = (text: string): string => {
    if (!text) return '';
    return text.replace(/^【[^】]+】\s*/, '').trim();
  };

  // チャットメモを1件適用（時間・タグ・本文を反映。タグから【】は除去、様子欄にタグは含めない）
  const handleApplyChatMessage = (msg: ChatMessage) => {
    const msgTime = formatMsgTime(msg.timestamp);
    const msgTag = cleanTagName(msg.tag);
    const msgObservation = cleanObservationText(msg.text); // タグなし、純粋な本文のみ

    setRows((prevRows) => {
      // observation が空いている最初の行を探す
      const emptyIndex = prevRows.findIndex((r) => !r.observation.trim());

      let nextRows = [...prevRows];
      if (emptyIndex !== -1) {
        nextRows[emptyIndex] = {
          ...nextRows[emptyIndex],
          time: msgTime,
          activity: msgTag,
          observation: msgObservation,
        };
        showNotice(`${emptyIndex + 1}行目にチャットメモを反映しました`);
      } else {
        // すべて埋まっている場合は新規行を追加
        const newRow: ForceSheetRow = {
          id: `row-${Date.now()}`,
          time: msgTime,
          activity: msgTag,
          stepContent: '',
          observation: msgObservation,
        };
        nextRows.push(newRow);
        showNotice('新規行を追加してチャットメモを反映しました');
      }
      return nextRows;
    });

    setUsedMessageIds((prev) => {
      const next = new Set(prev);
      next.add(msg.id);
      return next;
    });
  };

  // チャットメモを時間順に全件一括反映
  const handleApplyAllMessages = () => {
    if (chatMessages.length === 0) return;

    setRows((prevRows) => {
      const nextRows = [...prevRows];
      let rowIndex = 0;

      chatMessages.forEach((msg) => {
        const msgTime = formatMsgTime(msg.timestamp);
        const msgTag = cleanTagName(msg.tag);
        const msgObservation = cleanObservationText(msg.text);

        // 空いている行を探す（rowIndex から開始）
        while (rowIndex < nextRows.length && nextRows[rowIndex].observation.trim()) {
          rowIndex++;
        }

        if (rowIndex < nextRows.length) {
          nextRows[rowIndex] = {
            ...nextRows[rowIndex],
            time: msgTime,
            activity: msgTag,
            observation: msgObservation,
          };
          rowIndex++;
        } else {
          // 行が足りなければ新規追加
          nextRows.push({
            id: `row-${Date.now()}-${Math.random()}`,
            time: msgTime,
            activity: msgTag,
            stepContent: '',
            observation: msgObservation,
          });
        }
      });

      return nextRows;
    });

    setUsedMessageIds(new Set(chatMessages.map((m) => m.id)));
    showNotice(`チャットメモ${chatMessages.length}件を一括反映しました`);
  };

  // 時間を5分刻み・15分刻みに丸める（四捨五入）ヘルパー
  // 例: 13分→15分、18分→20分、12分→10分、16分→15分
  const roundMinutes = (timeStr: string, interval: number = 5) => {
    if (!timeStr || !timeStr.includes(':')) return timeStr;
    const parts = timeStr.trim().split(':');
    if (parts.length < 2) return timeStr;
    let h = parseInt(parts[0], 10);
    let m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) return timeStr;

    let roundedM = Math.round(m / interval) * interval;
    if (roundedM >= 60) {
      h = (h + 1) % 24;
      roundedM = 0;
    }
    return `${String(h).padStart(2, '0')}:${String(roundedM).padStart(2, '0')}`;
  };

  // 全行の時間を一括で丸める（5分単位 / 15分単位）
  const handleAlignTimes = (interval: number) => {
    setRows((prev) =>
      prev.map((r) => {
        if (!r.time) return r;
        return {
          ...r,
          time: roundMinutes(r.time, interval),
        };
      })
    );
    showNotice(`時刻を${interval}分刻み（四捨五入）で揃えました`);
  };

  // Gemini APIキー取得ヘルパー
  const getApiKey = (): string | null => {
    let key =
      sessionStorage.getItem('GEMINI_API_KEY') ||
      localStorage.getItem('GEMINI_API_KEY') ||
      (import.meta as any).env?.VITE_GEMINI_API_KEY ||
      '';
    if (!key) {
      key =
        window.prompt(
          'Gemini APIキーを入力してください。\n(入力されたキーはブラウザセッション中一時的に保持されます)'
        ) || '';
      if (key) {
        sessionStorage.setItem('GEMINI_API_KEY', key.trim());
      }
    }
    return key ? key.trim() : null;
  };

  // 様子の一括AI変換（80文字程度）
  const handleConvertAllObservations = async () => {
    const targetRows = rows.filter((r) => r.observation && r.observation.trim());
    if (targetRows.length === 0) {
      alert('変換対象の「様子」が入力されていません。チャットメモを反映するか直接入力してください。');
      return;
    }

    const apiKey = getApiKey();
    if (!apiKey) return;

    setIsConvertingAll(true);
    let successCount = 0;

    try {
      for (let i = 0; i < targetRows.length; i++) {
        const row = targetRows[i];
        setConvertingStatus(`AI変換中 (${i + 1}/${targetRows.length})...`);
        try {
          const converted = await convertToObservation(
            row.observation,
            apiKey,
            row.activity,
            `${i + 1} / ${targetRows.length}`
          );
          setRows((prev) =>
            prev.map((r) => (r.id === row.id ? { ...r, observation: converted } : r))
          );
          successCount++;
        } catch (err: any) {
          console.error(`Error converting row ${row.id}:`, err);
        }
      }
      showNotice(`「様子」をAIで一括変換しました (${successCount}件)`);
    } catch (err: any) {
      console.error('Batch AI conversion error:', err);
      alert('AI変換中にエラーが発生しました');
    } finally {
      setIsConvertingAll(false);
      setConvertingStatus('');
    }
  };

  // 様子の個別行AI変換（80文字程度）
  const handleConvertSingleObservation = async (row: ForceSheetRow) => {
    if (!row.observation || !row.observation.trim()) {
      alert('変換対象の「様子」が入力されていません。');
      return;
    }

    const apiKey = getApiKey();
    if (!apiKey) return;

    setConvertingRowId(row.id);
    try {
      const converted = await convertToObservation(
        row.observation,
        apiKey,
        row.activity,
        '1 / 1'
      );
      setRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, observation: converted } : r))
      );
      showNotice('「様子」をAI変換しました (約80文字)');
    } catch (err: any) {
      console.error('Single AI conversion error:', err);
      alert(err.message || 'AI変換に失敗しました');
    } finally {
      setConvertingRowId(null);
    }
  };

  // 行の編集ハンドラ
  const handleRowChange = (id: string, field: keyof ForceSheetRow, value: any) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    );
  };

  // 行追加
  const handleAddRow = () => {
    const newRow: ForceSheetRow = {
      id: `row-${Date.now()}`,
      time: '',
      activity: '',
      stepContent: '',
      observation: '',
    };
    setRows((prev) => [...prev, newRow]);
  };

  // 行削除
  const handleDeleteRow = (id: string) => {
    if (rows.length <= 1) {
      alert('これ以上削除できません');
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  // 強行シートの保存
  const handleSave = async () => {
    if (!childId || !serviceDate) return;
    setSaving(true);
    try {
      const docKey = `${selectedOfficeId}_${childId}_${serviceDate}`;
      const payload: ForceSheetDoc = {
        childId,
        officeId: selectedOfficeId,
        officeName,
        createdDate,
        serviceDate,
        authorName,
        serviceStaffName,
        rows,
        notes,
        updatedAt: serverTimestamp(),
      };

      await setDoc(doc(db, 'forceSheets', docKey), payload, { merge: true });
      setSaveSuccess(true);
      showNotice('強行シートを保存しました');
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error('Save failed:', err);
      alert('保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  // 印刷
  const handlePrint = () => {
    document.body.classList.add('print-force');
    const handleAfterPrint = () => {
      document.body.classList.remove('print-force');
      window.removeEventListener('afterprint', handleAfterPrint);
    };
    window.addEventListener('afterprint', handleAfterPrint);
    window.print();
  };

  // 日付の前後移動
  const changeDateByOffset = (offset: number) => {
    const current = new Date(serviceDate);
    if (isNaN(current.getTime())) return;
    current.setDate(current.getDate() + offset);
    const y = current.getFullYear();
    const m = String(current.getMonth() + 1).padStart(2, '0');
    const d = String(current.getDate()).padStart(2, '0');
    const newDate = `${y}-${m}-${d}`;
    setServiceDate(newDate);
    setCreatedDate(newDate); // 基本チャットメモ（サービス提供日）に準ずる
  };

  // タグごとのバッジカラー
  const getTagBadgeClass = (tag: string | null | undefined) => {
    if (!tag) return 'bg-slate-100 text-slate-600 border-slate-200';
    if (tag.includes('宿題') || tag.includes('学習')) {
      return 'bg-blue-50 text-blue-700 border-blue-200';
    }
    if (tag.includes('自由') || tag.includes('遊び')) {
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    }
    if (tag.includes('おやつ') || tag.includes('食事')) {
      return 'bg-amber-50 text-amber-700 border-amber-200';
    }
    if (tag.includes('プログラム')) {
      return 'bg-purple-50 text-purple-700 border-purple-200';
    }
    return 'bg-rose-50 text-rose-700 border-rose-200';
  };

  const serviceWareki = formatWareki(serviceDate);
  const createdWareki = formatWareki(createdDate);

  return (
    <div className="min-h-screen bg-slate-50/50 pb-20 print:bg-white print:p-0 print:m-0">
      {/* 画面トップ アクションバー (印刷時は非表示) */}
      <div className="bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-30 px-6 py-4 print:hidden shadow-xs">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate(`/children/${childId}`)}
              className="p-2 hover:bg-slate-100 rounded-xl text-slate-600 transition-colors flex items-center gap-1.5 text-sm font-medium cursor-pointer"
            >
              <ArrowLeft size={18} />
              <span>児童詳細へ戻る</span>
            </button>
            <div className="h-5 w-px bg-slate-200" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-slate-800">強行シート (支援手順書 兼 記録用紙)</h1>
                <span className="px-2.5 py-0.5 bg-rose-50 text-rose-700 text-xs font-bold rounded-full border border-rose-200">
                  重点管理
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                対象児童: <span className="font-bold text-slate-700">{currentChild?.fullName || '読み込み中...'}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* サービス提供日（チャットメモ連動） */}
            <div className="flex items-center bg-slate-100 rounded-xl p-1 border border-slate-200">
              <button
                onClick={() => changeDateByOffset(-1)}
                className="p-1.5 hover:bg-white hover:text-slate-800 rounded-lg text-slate-500 transition-all cursor-pointer"
                title="前日"
              >
                <ChevronLeft size={18} />
              </button>
              <div className="flex items-center gap-1.5 px-3">
                <Calendar size={16} className="text-slate-500" />
                <input
                  type="date"
                  value={serviceDate}
                  onChange={(e) => {
                    setServiceDate(e.target.value);
                    setCreatedDate(e.target.value);
                  }}
                  className="bg-transparent text-sm font-bold text-slate-700 outline-none cursor-pointer"
                />
              </div>
              <button
                onClick={() => changeDateByOffset(1)}
                className="p-1.5 hover:bg-white hover:text-slate-800 rounded-lg text-slate-500 transition-all cursor-pointer"
                title="翌日"
              >
                <ChevronRight size={18} />
              </button>
            </div>

            <button
              onClick={() => {
                setServiceDate(todayStr);
                setCreatedDate(todayStr);
              }}
              className="px-3 py-2 text-xs font-semibold bg-white hover:bg-slate-100 text-slate-600 border border-slate-200 rounded-xl transition-colors shadow-2xs cursor-pointer"
            >
              今日
            </button>

            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm border border-slate-200 rounded-xl shadow-2xs transition-all active:scale-95 cursor-pointer"
            >
              <Printer size={16} className="text-slate-600" />
              <span>印刷 / PDF</span>
            </button>

            <button
              onClick={handleSave}
              disabled={saving}
              className={`flex items-center gap-1.5 px-5 py-2 rounded-xl font-bold text-sm shadow-md transition-all active:scale-95 cursor-pointer ${
                saveSuccess
                  ? 'bg-emerald-600 text-white shadow-emerald-200'
                  : 'bg-primary hover:bg-primary-hover text-white shadow-primary/25'
              }`}
            >
              {saveSuccess ? <CheckCircle2 size={16} /> : <Save size={16} />}
              <span>{saving ? '保存中...' : saveSuccess ? '保存完了' : '書類を保存'}</span>
            </button>
          </div>
        </div>
      </div>

      {feedbackNotice && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900/90 backdrop-blur-md text-white px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border border-white/10 animate-fade-in print:hidden">
          <Sparkles size={18} className="text-amber-300 flex-shrink-0 animate-spin" />
          <span className="text-sm font-medium">{feedbackNotice}</span>
        </div>
      )}

      {/* メインエリア：2カラム (印刷時は書類のみ) */}
      <div className="max-w-7xl mx-auto px-6 pt-6 print:p-0 print:max-w-none">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* 左側：書類プレビュー＆編集エリア (8カラム) */}
          <div
            id="force-sheet-print"
            className="lg:col-span-8 bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-200 p-8 print:p-0 print:border-none print:shadow-none print:rounded-none print:w-full"
          >
            {/* 書類タイトル */}
            <div className="text-center mb-4">
              <h2 className="text-lg md:text-xl font-black text-slate-900 tracking-wider">
                {officeName ? `※${officeName}` : '※事業所名'}　支援手順書　兼　記録用紙
              </h2>
            </div>

            {/* ヘッダー情報テーブル */}
            <table className="w-full border-collapse border-2 border-slate-800 text-sm mb-4">
              <tbody>
                <tr>
                  <th className="border border-slate-800 bg-slate-50 px-3 py-2 text-center font-bold text-slate-800 w-32">
                    利用者氏名
                  </th>
                  <td className="border border-slate-800 px-3 py-2 font-bold text-base text-slate-900">
                    {currentChild?.fullName || ''}
                  </td>
                  <th className="border border-slate-800 bg-slate-50 px-3 py-2 text-center font-bold text-slate-800 w-32">
                    作成日
                  </th>
                  <td className="border border-slate-800 px-3 py-2 w-52">
                    {/* カレンダーで選べる作成日 */}
                    <div className="relative flex items-center gap-1 font-medium group">
                      <span>R</span>
                      <span className="w-6 text-center font-bold">{createdWareki.year}</span>
                      <span>年</span>
                      <span className="w-6 text-center font-bold">{createdWareki.month}</span>
                      <span>月</span>
                      <span className="w-6 text-center font-bold">{createdWareki.day}</span>
                      <span>日</span>
                      <label className="ml-1 cursor-pointer p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-700 print:hidden" title="カレンダーから日付を選択">
                        <Calendar size={14} />
                        <input
                          type="date"
                          value={createdDate}
                          onChange={(e) => setCreatedDate(e.target.value)}
                          className="sr-only"
                        />
                      </label>
                    </div>
                  </td>
                </tr>
                <tr>
                  <th className="border border-slate-800 bg-slate-50 px-3 py-2 text-center font-bold text-slate-800">
                    作成者名
                  </th>
                  <td className="border border-slate-800 px-2 py-1">
                    {/* staff内から選択式（手動入力も可能） */}
                    <div className="flex items-center gap-1">
                      <select
                        value={staffList.some((s) => s.name === authorName) ? authorName : authorName ? '__custom__' : ''}
                        onChange={(e) => {
                          if (e.target.value !== '__custom__') {
                            setAuthorName(e.target.value);
                          }
                        }}
                        className="w-full px-2 py-1 bg-transparent outline-none font-medium text-slate-800 cursor-pointer print:hidden"
                      >
                        <option value="">-- スタッフを選択 --</option>
                        {staffList.map((s) => (
                          <option key={s.id} value={s.name}>
                            {s.name}
                          </option>
                        ))}
                        {authorName && !staffList.some((s) => s.name === authorName) && (
                          <option value="__custom__">{authorName} (手動入力)</option>
                        )}
                      </select>
                      {/* 印刷用 & 自由編集用テキスト表示 */}
                      <span className="hidden print:inline font-medium text-slate-800 px-2">
                        {authorName}
                      </span>
                    </div>
                  </td>
                  <th className="border border-slate-800 bg-slate-50 px-3 py-2 text-center font-bold text-slate-800">
                    サービス提供日
                  </th>
                  <td className="border border-slate-800 px-3 py-2">
                    {/* カレンダーで選べるサービス提供日 */}
                    <div className="relative flex items-center gap-1 font-medium group">
                      <span>R</span>
                      <span className="w-6 text-center font-bold">{serviceWareki.year}</span>
                      <span>年</span>
                      <span className="w-6 text-center font-bold">{serviceWareki.month}</span>
                      <span>月</span>
                      <span className="w-6 text-center font-bold">{serviceWareki.day}</span>
                      <span>日</span>
                      <label className="ml-1 cursor-pointer p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-700 print:hidden" title="カレンダーから日付を選択">
                        <Calendar size={14} />
                        <input
                          type="date"
                          value={serviceDate}
                          onChange={(e) => {
                            setServiceDate(e.target.value);
                            setCreatedDate(e.target.value);
                          }}
                          className="sr-only"
                        />
                      </label>
                    </div>
                  </td>
                </tr>
                <tr>
                  <th className="border border-slate-800 bg-slate-50 px-3 py-2 text-center font-bold text-slate-800">
                    サービス提供者名
                  </th>
                  <td colSpan={3} className="border border-slate-800 px-2 py-1">
                    {/* staff内から選択式 */}
                    <div className="flex items-center gap-1">
                      <select
                        value={staffList.some((s) => s.name === serviceStaffName) ? serviceStaffName : serviceStaffName ? '__custom__' : ''}
                        onChange={(e) => {
                          if (e.target.value !== '__custom__') {
                            setServiceStaffName(e.target.value);
                          }
                        }}
                        className="w-full px-2 py-1 bg-transparent outline-none font-medium text-slate-800 cursor-pointer print:hidden"
                      >
                        <option value="">-- スタッフを選択 --</option>
                        {staffList.map((s) => (
                          <option key={s.id} value={s.name}>
                            {s.name}
                          </option>
                        ))}
                        {serviceStaffName && !staffList.some((s) => s.name === serviceStaffName) && (
                          <option value="__custom__">{serviceStaffName} (手動入力)</option>
                        )}
                      </select>
                      {/* 印刷用テキスト表示 */}
                      <span className="hidden print:inline font-medium text-slate-800 px-2">
                        {serviceStaffName}
                      </span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>

            {/* テーブル上部ツールバー（時間丸め・AI変換・操作） */}
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3 print:hidden">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold text-slate-500 flex items-center gap-1">
                  <Clock size={13} /> 時間を整える:
                </span>
                <button
                  type="button"
                  onClick={() => handleAlignTimes(5)}
                  className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg text-xs font-bold transition-all active:scale-95 cursor-pointer shadow-2xs"
                  title="例: 13分→15分、18分→20分、12分→10分"
                >
                  5分刻みに揃える (四捨五入)
                </button>
                <button
                  type="button"
                  onClick={() => handleAlignTimes(15)}
                  className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-lg text-xs font-bold transition-all active:scale-95 cursor-pointer shadow-2xs"
                  title="15分刻みに揃える"
                >
                  15分刻み
                </button>

                <div className="h-4 w-px bg-slate-200 mx-1" />

                {/* AI一括変換ボタン */}
                <button
                  type="button"
                  onClick={handleConvertAllObservations}
                  disabled={isConvertingAll}
                  className="flex items-center gap-1.5 px-3 py-1 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-lg text-xs font-bold shadow-sm shadow-purple-200 transition-all active:scale-95 cursor-pointer disabled:opacity-50"
                  title="専門的支援実施計画の基準に準拠し、各行の様子を約80文字の専門的記述に一括変換します"
                >
                  {isConvertingAll ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Sparkles size={13} />
                  )}
                  <span>{isConvertingAll ? convertingStatus || 'AI変換中...' : '✨ 様子をAI一括変換 (80文字)'}</span>
                </button>
              </div>

              <div className="text-[11px] text-slate-400">
                ※時間や様子は直接手動編集も可能です
              </div>
            </div>

            {/* 明細テーブル */}
            <div className="overflow-x-auto">
              <table className="w-full border-collapse border-2 border-slate-800 text-xs md:text-sm">
                <thead>
                  <tr className="bg-slate-50 text-slate-800 font-bold border-b-2 border-slate-800">
                    <th className="border border-slate-800 px-2 py-2 w-20 text-center">時刻等</th>
                    <th className="border border-slate-800 px-2 py-2 w-40 text-center">予定・内容・活動</th>
                    <th className="border border-slate-800 px-2 py-2 w-64 text-center">
                      <div className="text-[11px] text-slate-500 font-normal">手順</div>
                      <div>行動・支援の内容、ポイント</div>
                    </th>
                    <th className="border border-slate-800 px-3 py-2 text-center">様子</th>
                    <th className="border border-slate-800 px-1 py-2 w-10 text-center print:hidden">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-800 hover:bg-slate-50/50 transition-colors">
                      {/* 時刻等（手動入力可） */}
                      <td className="border border-slate-800 p-1.5 align-middle text-center">
                        <input
                          type="text"
                          value={row.time}
                          onChange={(e) => handleRowChange(row.id, 'time', e.target.value)}
                          placeholder="14:30"
                          className="w-full text-center bg-transparent outline-none font-bold text-slate-800 text-sm"
                        />
                      </td>

                      {/* 予定・内容・活動（タグ名反映、手動編集可） */}
                      <td className="border border-slate-800 p-1.5 align-middle">
                        <textarea
                          rows={2}
                          value={row.activity}
                          onChange={(e) => handleRowChange(row.id, 'activity', e.target.value)}
                          placeholder="予定・活動内容"
                          className="w-full bg-transparent outline-none font-bold text-slate-800 text-xs md:text-sm resize-none"
                        />
                      </td>

                      {/* 手順: 行動・支援の内容、ポイント（区切りなし自由入力） */}
                      <td className="border border-slate-800 p-2 align-top">
                        <textarea
                          rows={3}
                          value={row.stepContent}
                          onChange={(e) => handleRowChange(row.id, 'stepContent', e.target.value)}
                          placeholder="行動・支援の内容、ポイント"
                          className="w-full bg-transparent outline-none text-xs text-slate-700 resize-none leading-relaxed"
                        />
                      </td>

                      {/* 様子（チャットメモ本文反映先・タグ不要・手動入力可・AI変換対応） */}
                      <td className="border border-slate-800 p-2 align-top bg-amber-50/10">
                        <textarea
                          rows={3}
                          value={row.observation}
                          onChange={(e) => handleRowChange(row.id, 'observation', e.target.value)}
                          placeholder="クリックで右のチャットメモが入ります（直接入力も可）"
                          className="w-full bg-transparent outline-none text-xs md:text-sm text-slate-800 leading-relaxed resize-y placeholder:text-slate-300 font-medium"
                        />
                        {/* 文字数 & 個別AI変換ボタン */}
                        <div className="flex items-center justify-between mt-1 pt-1 border-t border-slate-200/60 print:hidden text-[10px] text-slate-400">
                          <span>
                            {row.observation ? `${row.observation.length}文字` : ''}
                          </span>
                          {row.observation && (
                            <button
                              type="button"
                              onClick={() => handleConvertSingleObservation(row)}
                              disabled={convertingRowId === row.id || isConvertingAll}
                              className="flex items-center gap-1 text-purple-600 hover:text-purple-800 font-bold hover:bg-purple-50 px-1.5 py-0.5 rounded transition-colors cursor-pointer disabled:opacity-50"
                              title="この行の様子をAI変換 (80文字程度)"
                            >
                              {convertingRowId === row.id ? (
                                <Loader2 size={11} className="animate-spin" />
                              ) : (
                                <Sparkles size={11} />
                              )}
                              <span>AI変換</span>
                            </button>
                          )}
                        </div>
                      </td>

                      {/* 操作 (行削除) */}
                      <td className="border border-slate-800 p-1 text-center align-middle print:hidden">
                        <button
                          onClick={() => handleDeleteRow(row.id)}
                          className="p-1 text-slate-300 hover:text-red-500 rounded transition-colors cursor-pointer"
                          title="行を削除"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 行追加ボタン (印刷時非表示) */}
            <div className="mt-3 flex justify-start print:hidden">
              <button
                onClick={handleAddRow}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-bold transition-colors cursor-pointer"
              >
                <Plus size={14} />
                <span>行を追加</span>
              </button>
            </div>

            {/* 特記事項、その他 */}
            <div className="mt-4 border-2 border-slate-800 rounded-none p-3">
              <div className="text-xs font-bold text-slate-800 mb-1">＜特記事項、その他＞</div>
              <textarea
                rows={4}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="特記事項や緊急時対応、全体メモなどを自由に入力できます"
                className="w-full bg-transparent outline-none text-xs md:text-sm text-slate-800 leading-relaxed resize-none placeholder:text-slate-300 font-medium"
              />
            </div>
          </div>

          {/* 右側：チャットメモ一覧パネル (4カラム・印刷時は非表示) */}
          <div className="lg:col-span-4 bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-200 p-6 print:hidden sticky top-24">
            <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-rose-50 text-rose-600 rounded-xl">
                  <MessageSquare size={18} />
                </div>
                <div>
                  <h3 className="font-black text-slate-800 text-base">チャットメモ</h3>
                  <p className="text-xs text-slate-400">時間・タグ・本文を書類に反映</p>
                </div>
              </div>
              <span className="px-2.5 py-1 bg-slate-100 text-slate-600 text-xs font-bold rounded-full">
                {chatMessages.length}件
              </span>
            </div>

            {/* 一括反映ボタン */}
            {chatMessages.length > 0 && (
              <button
                onClick={handleApplyAllMessages}
                className="w-full mb-3 flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-rose-500 to-amber-500 hover:from-rose-600 hover:to-amber-600 text-white rounded-xl font-bold text-xs shadow-md shadow-rose-200 transition-all active:scale-98 cursor-pointer"
              >
                <Zap size={15} />
                <span>全チャットメモを時間順に一括当てはめ</span>
              </button>
            )}

            <div className="bg-amber-50/70 border border-amber-200/60 rounded-xl p-3 mb-4 text-xs text-amber-800 leading-relaxed flex items-start gap-2">
              <Sparkles size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <span>
                メモブロックを<strong>クリック</strong>すると、書類の空いている枠に「時間」「タグ」「本文（タグなし）」が上から順に自動で当てはまります！
              </span>
            </div>

            {loadingMessages ? (
              <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-400">
                <div className="w-8 h-8 border-3 border-rose-500/20 border-t-rose-500 rounded-full animate-spin" />
                <span className="text-xs font-medium">チャットメモを読み込み中...</span>
              </div>
            ) : chatMessages.length === 0 ? (
              <div className="py-12 px-4 text-center border-2 border-dashed border-slate-200 rounded-xl">
                <MessageSquare size={32} className="mx-auto text-slate-300 mb-2" />
                <p className="text-sm font-bold text-slate-600">メモがありません</p>
                <p className="text-xs text-slate-400 mt-1">
                  {serviceDate} に記録されたチャットメモは見つかりませんでした。
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3 max-h-[calc(100vh-360px)] overflow-y-auto pr-1">
                {chatMessages.map((msg) => {
                  const isUsed = usedMessageIds.has(msg.id);
                  const timeFormatted = formatMsgTime(msg.timestamp);

                  return (
                    <div
                      key={msg.id}
                      onClick={() => handleApplyChatMessage(msg)}
                      className={`group relative p-3.5 rounded-xl border transition-all cursor-pointer select-none text-left ${
                        isUsed
                          ? 'bg-slate-50/80 border-slate-200 opacity-70 hover:opacity-100 hover:border-slate-300'
                          : 'bg-white border-slate-200 hover:border-rose-400 hover:shadow-md hover:bg-rose-50/30 active:scale-98'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {msg.tag ? (
                            <span
                              className={`px-2 py-0.5 text-[11px] font-bold rounded-md border ${getTagBadgeClass(
                                msg.tag
                              )}`}
                            >
                              {cleanTagName(msg.tag)}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 text-[11px] font-bold rounded-md border bg-slate-100 text-slate-500 border-slate-200">
                              メモ
                            </span>
                          )}

                          {timeFormatted && (
                            <span className="flex items-center gap-1 text-[11px] text-slate-400 font-medium">
                              <Clock size={11} />
                              {timeFormatted}
                            </span>
                          )}
                        </div>

                        {isUsed && (
                          <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-md border border-emerald-200">
                            <CheckCircle2 size={10} />
                            反映済
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-slate-700 leading-relaxed font-medium line-clamp-3 group-hover:line-clamp-none whitespace-pre-wrap">
                        {msg.text}
                      </p>

                      <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
                        <span>{msg.staffName ? `記録: ${msg.staffName}` : ''}</span>
                        <span className="text-rose-500 font-bold opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                          <span>書類に反映</span>
                          <span>→</span>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
