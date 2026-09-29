import React, { useState, useRef } from 'react';
import { collection, getDocs, doc, writeBatch } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Download, Upload, FileJson, FileSpreadsheet, Loader2, Database } from 'lucide-react';
import * as XLSX from 'xlsx';

const flatten = (obj: any, prefix = ''): any => {
  return Object.keys(obj).reduce((acc: any, k: string) => {
    const pre = prefix.length ? prefix + '.' : '';
    if (typeof obj[k] === 'object' && obj[k] !== null && !Array.isArray(obj[k])) {
      Object.assign(acc, flatten(obj[k], pre + k));
    } else if (Array.isArray(obj[k])) {
      acc[pre + k] = JSON.stringify(obj[k]);
    } else {
      acc[pre + k] = obj[k];
    }
    return acc;
  }, {});
};

const unflatten = (obj: any): any => {
  const result: any = {};
  for (const key in obj) {
    const keys = key.split('.');
    let current = result;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) current[keys[i]] = {};
      current = current[keys[i]];
    }
    let val = obj[key];
    if (typeof val === 'string' && val.startsWith('[') && val.endsWith(']')) {
      try { val = JSON.parse(val); } catch(e) {}
    }
    current[keys[keys.length - 1]] = val;
  }
  return result;
};

type SanitizeOptions = {
  supportContent: boolean;
  resultInfo: boolean;
  futurePlan: boolean;
};

const sanitizeData = (data: any, options: SanitizeOptions) => {
  const clean = { ...data };
  delete clean.externalInfo;
  delete clean.tree_comm_text;
  if (clean.content) {
    clean.content = { ...clean.content };
    delete clean.content.externalInfo;
    
    if (!options.supportContent) {
      delete clean.content.supportContent;
    }
    if (!options.resultInfo) {
      delete clean.content.resultInfo;
    }
    if (!options.futurePlan) {
      delete clean.content.futurePlan;
    }
  }
  return clean;
};

export const BackupRestore: React.FC = () => {
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [log, setLog] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importFormat, setImportFormat] = useState<'json'|'csv'>('json');

  const [includeSupportContent, setIncludeSupportContent] = useState(true);
  const [includeResultInfo, setIncludeResultInfo] = useState(true);
  const [includeFuturePlan, setIncludeFuturePlan] = useState(true);

  const TARGET_COLLECTION = 'daily_reports';

  const getSanitizeOptions = (): SanitizeOptions => ({
    supportContent: includeSupportContent,
    resultInfo: includeResultInfo,
    futurePlan: includeFuturePlan
  });

  const handleExportJSON = async () => {
    setIsExporting(true);
    setLog(`エクスポート開始: 療育結果 (JSON)`);
    try {
      const snap = await getDocs(collection(db, TARGET_COLLECTION));
      const data = snap.docs.map(d => sanitizeData({ id: d.id, ...d.data() }, getSanitizeOptions()));
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `療育結果_backup_${new Date().getTime()}.json`;
      a.click();
      setLog(`エクスポート成功: ${data.length}件のデータを出力しました`);
    } catch (e: any) {
      setLog(`エラー: ${e.message}`);
    }
    setIsExporting(false);
  };

  const handleExportCSV = async () => {
    setIsExporting(true);
    setLog(`エクスポート開始: 療育結果 (CSV)`);
    try {
      const snap = await getDocs(collection(db, TARGET_COLLECTION));
      const data = snap.docs.map(d => flatten(sanitizeData({ id: d.id, ...d.data() }, getSanitizeOptions())));
      const worksheet = XLSX.utils.json_to_sheet(data);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Backup");
      XLSX.writeFile(workbook, `療育結果_backup_${new Date().getTime()}.csv`);
      setLog(`エクスポート成功: ${data.length}件のデータを出力しました`);
    } catch (e: any) {
      setLog(`エラー: ${e.message}`);
    }
    setIsExporting(false);
  };

  const handleImportClick = (format: 'json'|'csv') => {
    setImportFormat(format);
    if (fileInputRef.current) fileInputRef.current.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    setLog(`インポート開始: ${file.name} を読み込み中...`);

    try {
      let importedData: any[] = [];
      if (importFormat === 'json') {
        const text = await file.text();
        importedData = JSON.parse(text);
      } else {
        const arrayBuffer = await file.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const flatData = XLSX.utils.sheet_to_json(firstSheet);
        importedData = flatData.map(d => unflatten(d));
      }

      if (!Array.isArray(importedData)) {
        throw new Error("データが配列形式ではありません。");
      }

      let batch = writeBatch(db);
      let count = 0;
      let total = 0;
      for (const item of importedData) {
        if (!item.id) continue;
        const docId = item.id;
        const data = sanitizeData({ ...item }, { supportContent: true, resultInfo: true, futurePlan: true });
        delete data.id;

        batch.set(doc(collection(db, TARGET_COLLECTION), docId), data, { merge: true });
        count++;
        total++;

        if (count >= 500) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
          setLog(`... ${total}件処理完了`);
        }
      }
      if (count > 0) {
        await batch.commit();
      }

      setLog(`インポート成功: 合計 ${total} 件のデータを復元しました。`);
    } catch (err: any) {
      setLog(`エラー: ${err.message}`);
    }
    
    setIsImporting(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="p-6 bg-white/80 rounded-xl shadow-sm border border-slate-200">
      <h3 className="text-xl font-black text-slate-800 mb-2 flex items-center gap-2">
        <Database size={24} className="text-primary" />
        療育結果 (専門的支援実施計画) のバックアップ・インポート
      </h3>
      <p className="mt-2 text-sm text-slate-500 mb-6">
        日々の療育内容や結果のデータをJSONまたはCSV形式で保存し、あとから復元できます。
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="p-5 bg-slate-50 border border-slate-200 rounded-xl flex flex-col">
          <h4 className="font-bold text-slate-700 mb-2 flex items-center gap-2">
            <Download size={18} />
            エクスポート (バックアップ)
          </h4>
          
          <div className="mb-4 space-y-2 bg-white p-3 rounded-lg border border-slate-200 shadow-sm text-sm">
            <p className="font-semibold text-slate-600 mb-1 border-b border-slate-100 pb-1">バックアップに含める項目</p>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={includeSupportContent} onChange={e => setIncludeSupportContent(e.target.checked)} className="rounded text-primary focus:ring-primary/20" />
              <span>療育内容 (supportContent)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={includeResultInfo} onChange={e => setIncludeResultInfo(e.target.checked)} className="rounded text-primary focus:ring-primary/20" />
              <span>療育した結果 (resultInfo)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={includeFuturePlan} onChange={e => setIncludeFuturePlan(e.target.checked)} className="rounded text-primary focus:ring-primary/20" />
              <span>今後の予定 (futurePlan)</span>
            </label>
            <p className="text-xs text-rose-500 mt-1">※ツリー通信は必ず除外されます。</p>
          </div>

          <div className="flex gap-3 mt-auto">
            <button 
              onClick={handleExportJSON}
              disabled={isExporting || isImporting}
              className="flex-1 btn-secondary py-2 flex justify-center gap-2"
            >
              {isExporting ? <Loader2 size={18} className="animate-spin" /> : <FileJson size={18} />}
              JSON出力
            </button>
            <button 
              onClick={handleExportCSV}
              disabled={isExporting || isImporting}
              className="flex-1 btn-secondary py-2 flex justify-center gap-2"
            >
              {isExporting ? <Loader2 size={18} className="animate-spin" /> : <FileSpreadsheet size={18} />}
              CSV出力
            </button>
          </div>
        </div>

        <div className="p-5 bg-slate-50 border border-slate-200 rounded-xl">
          <h4 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
            <Upload size={18} />
            インポート (復元・上書き)
          </h4>
          <div className="flex gap-3">
            <button 
              onClick={() => handleImportClick('json')}
              disabled={isExporting || isImporting}
              className="flex-1 btn-primary py-2 flex justify-center gap-2 bg-indigo-600 hover:bg-indigo-700"
            >
              {isImporting ? <Loader2 size={18} className="animate-spin" /> : <FileJson size={18} />}
              JSON読込
            </button>
            <button 
              onClick={() => handleImportClick('csv')}
              disabled={isExporting || isImporting}
              className="flex-1 btn-primary py-2 flex justify-center gap-2 bg-emerald-600 hover:bg-emerald-700"
            >
              {isImporting ? <Loader2 size={18} className="animate-spin" /> : <FileSpreadsheet size={18} />}
              CSV読込
            </button>
          </div>
          <p className="mt-3 text-xs text-rose-500 font-semibold">
            ※ 同一IDのデータは上書きされます。インポート前に必ずバックアップを行ってください。
          </p>
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            accept={importFormat === 'json' ? '.json' : '.csv'} 
            onChange={handleFileChange} 
          />
        </div>
      </div>

      {log && (
        <div className="p-4 bg-slate-800 text-slate-200 rounded-lg text-sm font-mono whitespace-pre-wrap">
          {log}
        </div>
      )}
    </div>
  );
};