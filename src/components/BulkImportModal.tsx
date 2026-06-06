import React, { useState } from 'react';
import { X, FileSpreadsheet, Download, AlertCircle, CheckCircle2, Loader2, UploadCloud } from 'lucide-react';
import { collection, writeBatch, doc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Child } from '../data/mockData';

type BulkImportModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: () => void;
};

export const BulkImportModal: React.FC<BulkImportModalProps> = ({ isOpen, onClose, onImportComplete }) => {
  const [pastedData, setPastedData] = useState('');
  const [parsedData, setParsedData] = useState<Partial<Child>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [step, setStep] = useState<'paste' | 'preview' | 'success'>('paste');

  if (!isOpen) return null;

  // TSV解析ロジック
  const handleParse = () => {
    try {
      if (!pastedData.trim()) {
        setError('データを貼り付けてください。');
        return;
      }

      const rows = pastedData.trim().split('\n');
      const results: Partial<Child>[] = rows.map((row, index) => {
        const cols = row.split('\t');
        
        // 基本的なマッピング (氏名, フリガナ, 学年, 学校, 特徴, 住所)
        const fullName = cols[0]?.trim() || '';
        const nameKana = cols[1]?.trim() || '';
        const grade = cols[2]?.trim() || '';
        const schoolName = cols[3]?.trim() || '';
        const featuresRaw = cols[4]?.trim() || '';
        const address = cols[5]?.trim() || '';

        if (!fullName) {
          throw new Error(`${index + 1}行目に氏名がありません。`);
        }

        return {
          fullName,
          nameKana,
          grade,
          schoolName,
          features: featuresRaw ? featuresRaw.split(/[,、]/).map(f => f.trim()) : [],
          address,
          imageKey: fullName.charAt(0).toUpperCase(),
          age: 0, // 必要に応じて調整
          phoneNumberEmergency: '',
          phoneNumberHome: '',
          parentWorkplaceContact: '',
          familyStructure: ''
        };
      });

      setParsedData(results);
      setError(null);
      setStep('preview');
    } catch (err: any) {
      setError(err.message || '解析に失敗しました。形式を確認してください。');
    }
  };

  // Firestoreへの一括書き込み
  const handleImport = async () => {
    setIsProcessing(true);
    try {
      const batch = writeBatch(db);
      const childrenRef = collection(db, 'children');

      parsedData.forEach((child) => {
        const newDocRef = doc(childrenRef);
        batch.set(newDocRef, child);
      });

      await batch.commit();
      setStep('success');
      setTimeout(() => {
        onImportComplete();
        onClose();
        // リセット
        setPastedData('');
        setParsedData([]);
        setStep('paste');
      }, 2000);
    } catch (err) {
      console.error(err);
      setError('保存に失敗しました。');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* オーバーレイ */}
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      
      {/* モーダル本体 */}
      <div className="relative bg-white w-full max-w-4xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in duration-200">
        
        {/* ヘッダー */}
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <FileSpreadsheet size={22} />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-800 tracking-tight">児童一括インポート</h2>
              <p className="text-[12px] text-slate-500 font-medium">Excelからのコピペでまとめて登録</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-black/5 rounded-full text-slate-400 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* コンテンツエリア */}
        <div className="flex-1 overflow-y-auto p-8">
          {step === 'paste' && (
            <div className="space-y-6">
              <div className="bg-blue-50/50 border border-blue-100 rounded-2xl p-5 text-[13px] text-blue-700 leading-relaxed font-medium">
                <p className="flex items-center gap-2 mb-2 font-bold"><Download size={14} /> 貼り付け方法</p>
                <ol className="list-decimal list-inside space-y-1 ml-1 opacity-80">
                  <li>Excelまたはスプレッドシートで「氏名、フリガナ、学年、学校名、特徴、住所」の順に列を並べます。</li>
                  <li>データ範囲をコピーします。</li>
                  <li>下のテキストエリアに貼り付けてください。</li>
                </ol>
              </div>

              {error && (
                <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm flex items-start gap-3 border border-red-100 animate-shake">
                  <AlertCircle size={18} className="flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <textarea 
                className="w-full h-80 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 p-6 outline-none focus:border-primary/40 focus:ring-4 focus:ring-primary/5 transition-all text-sm font-mono placeholder:text-slate-300"
                placeholder="ここにExcelデータを貼り付けてください..."
                value={pastedData}
                onChange={(e) => setPastedData(e.target.value)}
              />
            </div>
          )}

          {step === 'preview' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-bold text-slate-700 flex items-center gap-2">
                  インポート内容の確認 ({parsedData.length}名)
                </h3>
                <button onClick={() => setStep('paste')} className="text-sm text-primary font-bold hover:underline">
                  貼り付け直す
                </button>
              </div>
              
              <div className="border border-slate-100 rounded-2xl overflow-hidden">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 font-bold">
                      <th className="p-4">氏名</th>
                      <th className="p-4">フリガナ</th>
                      <th className="p-4">学年 / 学校</th>
                      <th className="p-4">特徴</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedData.map((child, i) => (
                      <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/50">
                        <td className="p-4 font-bold text-slate-800">{child.fullName}</td>
                        <td className="p-4 text-slate-500">{child.nameKana}</td>
                        <td className="p-4 text-slate-600">
                          <span className="font-medium">{child.grade}</span>
                          <span className="text-slate-300 mx-2">|</span>
                          <span className="text-slate-400">{child.schoolName}</span>
                        </td>
                        <td className="p-4">
                          <div className="flex gap-1 flex-wrap">
                            {child.features?.map(f => (
                              <span key={f} className="text-[10px] px-2 py-0.5 bg-slate-100 text-slate-500 rounded">{f}</span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {step === 'success' && (
            <div className="h-full flex flex-col items-center justify-center py-20 animate-in zoom-in duration-300">
              <div className="w-20 h-20 rounded-full bg-green-100 text-green-500 flex items-center justify-center mb-6">
                <CheckCircle2 size={40} />
              </div>
              <h3 className="text-2xl font-black text-slate-800 mb-2">インポート成功</h3>
              <p className="text-slate-500 font-medium">児童データを一括登録しました。</p>
            </div>
          )}
        </div>

        {/* フッターボタン */}
        <div className="p-6 bg-slate-50/50 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-6 py-2.5 text-slate-500 font-bold hover:text-slate-800 transition-colors">
            キャンセル
          </button>
          
          {step === 'paste' && (
            <button 
              onClick={handleParse}
              className="px-8 py-2.5 bg-slate-800 text-white rounded-xl font-bold hover:bg-slate-900 transition-all shadow-lg shadow-slate-200 active:scale-95"
            >
              プレビューを確認
            </button>
          )}

          {step === 'preview' && (
            <button 
              onClick={handleImport}
              disabled={isProcessing}
              className="px-8 py-2.5 bg-primary text-white rounded-xl font-bold hover:bg-primary-hover transition-all shadow-lg shadow-primary/20 flex items-center gap-2 active:scale-95 disabled:opacity-70"
            >
              {isProcessing ? <Loader2 size={18} className="animate-spin" /> : <UploadCloud size={18} />}
              <span>{isProcessing ? '処理中...' : '一括登録を実行'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
