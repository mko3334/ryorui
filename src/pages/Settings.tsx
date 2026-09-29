import React, { useState, useEffect } from 'react';
import { 
  Save, Calendar, User, FileText, CheckCircle2, Settings as SettingsIcon, 
  Loader2, Database, Trash2, Layers, ArrowDownToLine, Lock, ShieldAlert
} from 'lucide-react';
import { doc, getDoc, getDocs, setDoc, serverTimestamp, collection, writeBatch } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Child } from '../data/mockData';
import { BackupRestore } from '../components/BackupRestore';
import { BatchExcelExport } from '../components/BatchExcelExport';
import { BatchExcelImport } from '../components/BatchExcelImport';

const SETTINGS_COL = 'monthlySettings';
const DANGER_RESET_PASSWORD = 'ryorui2026'; // 本格稼働時にこのタブごと削除予定

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

export const Settings: React.FC<SettingsProps> = ({ childrenData = [] }) => {
  const [activeTab, setActiveTab] = useState<'implementation' | 'perspective' | 'bulk-import' | 'batch-excel-export' | 'backup-restore' | 'danger-reset'>('implementation');
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

  // 開発・テスト用データ全削除関連のState
  const [resetPassword, setResetPassword] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [resetLogs, setResetLogs] = useState<string[]>([]);
  const [resetSuccess, setResetSuccess] = useState(false);

  const handleDangerResetAll = async () => {
    if (resetPassword !== DANGER_RESET_PASSWORD) {
      alert('パスワードが正しくありません。');
      return;
    }

    const firstConfirm = window.confirm(
      '【⚠️ 超重要警告：全児童データリセット】\n\n' +
      'すべての児童の以下のデータを完全に削除します：\n' +
      '1. 専門的支援計画書（目標データ全件）\n' +
      '2. 専門的支援日報（療育内容・結果全件）\n' +
      '3. ツリー通信の「今後の予定」（全児童・全日付を空文字クリア）\n\n' +
      '※この操作は絶対に元に戻せません。\n' +
      '本当に実行しますか？'
    );
    if (!firstConfirm) return;

    const secondConfirm = window.confirm(
      '【最終確認】全児童の専門的支援データを本当に全消去します。\n' +
      'よろしいですか？'
    );
    if (!secondConfirm) return;

    setIsResetting(true);
    setResetLogs(['削除処理を開始します...']);
    setResetSuccess(false);

    try {
      // 1. supportPlans の全件削除
      setResetLogs(prev => [...prev, '▶ supportPlans（計画目標）の削除中...']);
      const plansSnap = await getDocs(collection(db, 'supportPlans'));
      const planChunks: any[][] = [];
      let tempChunk: any[] = [];
      plansSnap.docs.forEach(d => {
        tempChunk.push(d.ref);
        if (tempChunk.length >= 400) {
          planChunks.push(tempChunk);
          tempChunk = [];
        }
      });
      if (tempChunk.length > 0) planChunks.push(tempChunk);

      for (const chunk of planChunks) {
        const b = writeBatch(db);
        chunk.forEach(r => b.delete(r));
        await b.commit();
      }
      setResetLogs(prev => [...prev, `✔ supportPlans: ${plansSnap.size}件を削除完了`]);

      // 2. daily_reports の全件削除
      setResetLogs(prev => [...prev, '▶ daily_reports（日々の療育記録）の削除中...']);
      const dailySnap = await getDocs(collection(db, 'daily_reports'));
      const dailyChunks: any[][] = [];
      tempChunk = [];
      dailySnap.docs.forEach(d => {
        tempChunk.push(d.ref);
        if (tempChunk.length >= 400) {
          dailyChunks.push(tempChunk);
          tempChunk = [];
        }
      });
      if (tempChunk.length > 0) dailyChunks.push(tempChunk);

      for (const chunk of dailyChunks) {
        const b = writeBatch(db);
        chunk.forEach(r => b.delete(r));
        await b.commit();
      }
      setResetLogs(prev => [...prev, `✔ daily_reports: ${dailySnap.size}件を削除完了`]);

      // 3. tree_communications のデータ（ツリー通信本文・今後の予定）は他アプリ連携のため一切変更しない
      setResetLogs(prev => [...prev, '✔ ツリー通信・今後の予定は保護され保持されます']);

      setResetLogs(prev => [...prev, '🎉 全ての専門的支援データの初期化が正常に完了しました！']);
      setResetSuccess(true);
      setResetPassword('');
      alert('すべての児童の専門的支援データを完全に削除・初期化しました。');
    } catch (err: any) {
      console.error('Reset error:', err);
      setResetLogs(prev => [...prev, `❌ エラーが発生しました: ${err.message || String(err)}`]);
      alert(`削除処理中にエラーが発生しました: ${err.message || String(err)}`);
    } finally {
      setIsResetting(false);
    }
  };

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

  return (
    <div className="max-w-[1400px] mx-auto flex flex-col gap-8 pb-20 animate-fade-in">
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
        
        {activeTab !== 'bulk-import' && activeTab !== 'batch-excel-export' && activeTab !== 'backup-restore' && activeTab !== 'danger-reset' && (
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
                    ? 'bg-white text-emerald-600 border-b-2 border-emerald-600 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.1)]'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                <ArrowDownToLine size={18} /> 月別エクセル一括インポート
              </button>
              <button
                onClick={() => setActiveTab('batch-excel-export')}
                className={`flex-1 flex items-center justify-center gap-2 py-4 text-sm font-bold transition-all ${
                  activeTab === 'batch-excel-export'
                    ? 'bg-white text-indigo-600 border-b-2 border-indigo-600 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.1)]'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                <Layers size={18} /> 月別エクセル一括上書き
              </button>
              <button
                onClick={() => setActiveTab('backup-restore')}
                className={`flex-1 flex items-center justify-center gap-2 py-4 text-sm font-bold transition-all ${
                  activeTab === 'backup-restore'
                    ? 'bg-white text-primary border-b-2 border-primary shadow-[0_2px_10px_-4px_rgba(0,0,0,0.1)]'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                <Database size={18} /> バックアップ/復元
              </button>
              {/* 本格稼働前・テスト用データ全削除タブ（本格稼働時は削除予定） */}
              <button
                onClick={() => setActiveTab('danger-reset')}
                className={`flex-1 flex items-center justify-center gap-2 py-4 text-sm font-bold transition-all ${
                  activeTab === 'danger-reset'
                    ? 'bg-red-50 text-red-600 border-b-2 border-red-500 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.1)]'
                    : 'text-red-400 hover:text-red-600 hover:bg-red-50/50'
                }`}
                title="【テスト用】全児童の専門的支援データを初期化します"
              >
                <Trash2 size={18} /> データ一括削除 (開発用)
              </button>
            </div>

            <div className="p-8 flex-1 flex flex-col">
              {activeTab === 'danger-reset' ? (
                // 開発・テスト用データ一括削除 UI（本格稼働時に削除予定）
                <div className="space-y-6 flex-1 flex flex-col animate-fade-in">
                  <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-6 text-red-900">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="p-2 bg-red-100 rounded-xl text-red-600">
                        <ShieldAlert size={24} />
                      </div>
                      <div>
                        <h3 className="text-base font-black text-red-800">
                          【開発・テスト用】全児童の専門的支援データ完全リセット
                        </h3>
                        <p className="text-xs text-red-600 font-bold">
                          ※この機能は本格稼働前の検証・データ整理用です。本格稼働時にはシステムから削除されます。
                        </p>
                      </div>
                    </div>

                    <div className="bg-white/80 rounded-xl p-4 border border-red-200 text-xs text-red-800 space-y-2 leading-relaxed">
                      <p className="font-bold text-red-900">以下のデータが完全に消去・初期化されます：</p>
                      <ul className="list-disc list-inside space-y-1 ml-1">
                        <li><strong>全児童の専門的支援計画書（目標）</strong>（supportPlans コレクション）</li>
                        <li><strong>全児童の日々の専門的支援日報（療育内容・結果）</strong>（daily_reports コレクション）</li>
                      </ul>
                      <p className="text-slate-500 pt-1">
                        ※連絡帳（ツリー通信本文）や今後の予定、児童基本マスタ（氏名・所属等）は保護され削除されません。
                      </p>
                    </div>
                  </div>

                  <div className="bg-slate-50 rounded-2xl p-6 border border-slate-200 space-y-5">
                    <div className="flex items-center gap-2 text-slate-700 font-bold text-sm">
                      <Lock size={16} className="text-slate-500" />
                      <span>管理者パスワード認証</span>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-600">
                        削除を実行するには、確認用パスワード <code className="bg-slate-200 text-red-600 px-2 py-0.5 rounded font-mono font-bold">ryorui2026</code> を入力してください：
                      </label>
                      <input
                        type="password"
                        placeholder="ryorui2026"
                        value={resetPassword}
                        onChange={(e) => setResetPassword(e.target.value)}
                        disabled={isResetting}
                        className="w-full max-w-md bg-white border border-slate-300 rounded-xl px-4 py-3 font-mono font-bold text-slate-800 outline-none focus:ring-2 focus:ring-red-400 focus:border-red-400 transition-all"
                      />
                    </div>

                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={handleDangerResetAll}
                        disabled={resetPassword !== DANGER_RESET_PASSWORD || isResetting}
                        className={`flex items-center gap-2.5 px-6 py-3.5 rounded-xl font-bold text-sm transition-all shadow-md active:scale-95 ${
                          resetPassword === DANGER_RESET_PASSWORD && !isResetting
                            ? 'bg-red-600 hover:bg-red-700 text-white cursor-pointer shadow-red-200'
                            : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                        }`}
                      >
                        {isResetting ? (
                          <>
                            <Loader2 size={18} className="animate-spin text-white" />
                            <span>全児童データを削除中...</span>
                          </>
                        ) : (
                          <>
                            <Trash2 size={18} />
                            <span>全児童の専門的支援データを完全消去する</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {resetSuccess && (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-center gap-3 text-emerald-800 text-sm font-bold animate-fade-in">
                      <CheckCircle2 size={20} className="text-emerald-600 shrink-0" />
                      <span>すべての児童の専門的支援データが正常に完全削除・初期化されました。</span>
                    </div>
                  )}

                  {/* 実行ログ */}
                  {resetLogs.length > 0 && (
                    <div className="bg-slate-900 text-emerald-400 font-mono text-xs rounded-2xl p-5 space-y-1.5 max-h-60 overflow-y-auto shadow-inner">
                      <div className="text-slate-400 text-[10px] pb-1 border-b border-slate-800 font-sans font-bold">実行ログ</div>
                      {resetLogs.map((log, i) => (
                        <div key={i} className="leading-relaxed">{log}</div>
                      ))}
                    </div>
                  )}
                </div>
              ) : activeTab === 'backup-restore' ? (
                <BackupRestore />
              ) : activeTab === 'batch-excel-export' ? (
                <BatchExcelExport selectedMonth={selectedMonth} childrenData={childrenData} />
              ) : activeTab === 'bulk-import' ? (
                <BatchExcelImport selectedMonth={selectedMonth} childrenData={childrenData} />
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
