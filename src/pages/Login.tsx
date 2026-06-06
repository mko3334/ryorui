import React, { useState, useEffect } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { LogIn, Lock, AlertCircle, Users } from 'lucide-react';

export const Login: React.FC = () => {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // 認証ブリッジ: ポータルからの自動ログインメッセージを待ち受ける
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      const msg = event.data;
      if (msg && msg.type === 'PORTAL_AUTH_DATA') {
        const { employeeEmail, employeePassword } = msg.payload;
        if (employeeEmail && employeePassword) {
          console.log('[AuthBridge] Received credentials from portal, attempting auto-login...');
          setLoading(true);
          try {
            await signInWithEmailAndPassword(auth, employeeEmail, employeePassword);
            console.log('[AuthBridge] Auto-login successful');
          } catch (err: any) {
            console.error('[AuthBridge] Auto-login failed:', err);
            setError('ポータルからの自動ログインに失敗しました。');
          } finally {
            setLoading(false);
          }
        }
      }
    };

    window.addEventListener('message', handleMessage);
    // 親ウィンドウへ準備完了を通知（ポータル側がメッセージを送るきっかけになる場合がある）
    window.parent.postMessage({ type: 'APP_READY' }, '*');

    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    // 指示書に基づき @tree-kids.jp を補完する
    const loginEmail = loginId.includes('@') ? loginId : `${loginId}@tree-kids.jp`;

    try {
      await signInWithEmailAndPassword(auth, loginEmail, password);
    } catch (err: any) {
      console.error(err);
      setError('ログインに失敗しました。IDとパスワードを確認してください。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-green-50/50 p-6">
      <div className="w-full max-w-md animate-fade-in">
        {/* ロゴ部分 */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-primary text-white shadow-2xl shadow-primary/30 mb-6">
            <Users size={40} />
          </div>
          <h1 className="text-3xl font-black text-slate-800 tracking-tight">
            Tree Ki<span className="text-primary text-secondary">d</span>s
          </h1>
          <p className="text-slate-500 mt-2 font-medium">書類管理システム ログイン</p>
        </div>

        {/* ログインフォーム */}
        <div className="glass-panel p-10 bg-white/80 backdrop-blur-xl border border-white/40 shadow-2xl">
          <form onSubmit={handleLogin} className="flex flex-col gap-6">
            {error && (
              <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm flex items-start gap-3 border border-red-100 animate-shake">
                <AlertCircle size={18} className="flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700 ml-1">ユーザーID (カタカナ可)</label>
              <div className="relative">
                <Users size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input 
                  type="text" 
                  autoComplete="username"
                  placeholder="例: ブラック, staff-01"
                  className="w-full pl-12 pr-4 py-3.5 bg-slate-50 rounded-xl border border-slate-200 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-all text-sm font-medium"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700 ml-1">パスワード</label>
              <div className="relative">
                <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input 
                  type="password" 
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="w-full pl-12 pr-4 py-3.5 bg-slate-50 rounded-xl border border-slate-200 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-all text-sm font-medium"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </div>

            <button 
              type="submit" 
              disabled={loading}
              className="mt-2 w-full bg-primary hover:bg-primary-hover text-white py-4 rounded-xl font-bold text-lg shadow-xl shadow-primary/20 transition-all flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-70 disabled:active:scale-100"
            >
              {loading ? (
                <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              ) : (
                <>
                  <LogIn size={20} />
                  <span>ログインする</span>
                </>
              )}
            </button>
          </form>

          <div className="mt-8 text-center pt-8 border-t border-slate-100 text-[13px] text-slate-400 font-medium">
            <p>© 2024 Tree Kids Management System</p>
          </div>
        </div>

        {/* フッターヒント（開発・デモ用） */}
        <div className="mt-8 bg-blue-50/50 border border-blue-100/50 rounded-2xl p-4 text-center">
          <p className="text-[12px] text-blue-600 font-semibold leading-relaxed">
            ※ ポータルから開いた場合は自動的にログインされます。
          </p>
        </div>
      </div>
    </div>
  );
};
