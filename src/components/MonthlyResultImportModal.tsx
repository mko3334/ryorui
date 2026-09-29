import React, { useState, useEffect } from 'react';
import { X, Clipboard, Check, AlertTriangle, FileText, Sparkles, User, Calendar } from 'lucide-react';
import type { Child } from '../data/mockData';

interface MonthlyResultImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  monthStr: string; // "YYYY-MM"
  childrenData: Child[];
  existingReports: Record<string, Record<string, any>>; // 既存データ: { childId: { date: report } }
  onImport: (results: Record<string, Record<string, string>>) => Promise<void>;
}

interface ParsedItem {
  childId: string;
  date: string;
  resultText: string;
}

interface PreviewItem {
  date: string;
  resultText: string;
  existingText?: string;
}

interface PreviewGroup {
  childId: string;
  childName: string;
  items: PreviewItem[];
}

const normalizeDateStr = (str: string): string => {
  const matchKanji = str.match(/(\d+)月\s*(\d+)日/);
  if (matchKanji) {
    return `${parseInt(matchKanji[1], 10)}月${parseInt(matchKanji[2], 10)}日`;
  }
  const matchSlash = str.match(/(\d+)\/(\d+)/);
  if (matchSlash) {
    return `${parseInt(matchSlash[1], 10)}月${parseInt(matchSlash[2], 10)}日`;
  }
  const matchHyphen = str.match(/(\d+)-(\d+)/);
  if (matchHyphen) {
    return `${parseInt(matchHyphen[1], 10)}月${parseInt(matchHyphen[2], 10)}日`;
  }
  return str;
};

const parseMonthlyImportedResults = (text: string): ParsedItem[] => {
  const list: ParsedItem[] = [];
  const lines = text.split('\n');
  let currentChildId = '';

  for (let line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('```')) continue;

    const childMatch = trimmed.match(/(?:■|#)?\s*(?:児童\d*|[^(\n]+)?\s*\(\s*ID:\s*([a-zA-Z0-9_-]+)\s*\)/i);
    if (childMatch) {
      currentChildId = childMatch[1];
      continue;
    }

    const dateLineMatch = trimmed.match(/^[-*•]?\s*(\d+月\d+日|\d+[-/]\d+)\s*(?::|：|-)?\s*(.*)$/);
    if (dateLineMatch && currentChildId) {
      const dateStr = normalizeDateStr(dateLineMatch[1]);
      const content = dateLineMatch[2].trim();
      if (content) {
        list.push({
          childId: currentChildId,
          date: dateStr,
          resultText: content
        });
      }
    }
  }

  return list;
};

export const MonthlyResultImportModal: React.FC<MonthlyResultImportModalProps> = ({
  isOpen,
  onClose,
  monthStr,
  childrenData,
  existingReports,
  onImport
}) => {
  const [inputText, setInputText] = useState('');
  const [previewGroups, setPreviewGroups] = useState<PreviewGroup[]>([]);
  const [overwriteMap, setOverwriteMap] = useState<Record<string, Record<string, boolean>>>({});
  const [isCopied, setIsCopied] = useState(false);
  const [showInstruction, setShowInstruction] = useState(true);
  const [isImporting, setIsImporting] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setInputText('');
      setPreviewGroups([]);
      setOverwriteMap({});
      setIsCopied(false);
      setIsImporting(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (inputText.trim()) {
      const parsedItems = parseMonthlyImportedResults(inputText);
      
      const groupsMap: Record<string, PreviewGroup> = {};
      const newOverwriteMap: Record<string, Record<string, boolean>> = {};

      parsedItems.forEach(item => {
        if (!groupsMap[item.childId]) {
          const childName = childrenData.find(c => c.id === item.childId)?.fullName || `不明な児童 (${item.childId})`;
          groupsMap[item.childId] = {
            childId: item.childId,
            childName,
            items: []
          };
        }

        if (!newOverwriteMap[item.childId]) {
          newOverwriteMap[item.childId] = {};
        }

        const isExistInPreview = groupsMap[item.childId].items.some(x => x.date === item.date);
        if (!isExistInPreview) {
          const existReport = existingReports[item.childId]?.[item.date];
          const existVal = existReport?.content?.resultInfo?.trim() || "";
          const hasExistVal = !!existVal;

          groupsMap[item.childId].items.push({
            date: item.date,
            resultText: item.resultText,
            existingText: existVal || undefined
          });

          // 既存値がある場合は上書き無効、なければ上書き有効
          newOverwriteMap[item.childId][item.date] = !hasExistVal;
        }
      });
      
      setPreviewGroups(Object.values(groupsMap));
      setOverwriteMap(newOverwriteMap);
    } else {
      setPreviewGroups([]);
      setOverwriteMap({});
    }
  }, [inputText, childrenData, existingReports]);

  if (!isOpen) return null;

  const [year, month] = monthStr.split('-');
  const formattedMonth = `${year}年${parseInt(month, 10)}月`;

  const customInstruction = `あなたは児童発達支援および放課後等デイサービスの療育職員です。
提供された複数児童それぞれのひと月分のツリー通信（日付・児童ID・連絡帳の文章）をもとに、専門的支援実施計画における「療育を行った結果」の文章を作成してください。

個人情報の観点から児童名は匿名化された一時ID（ID: xxx）で表記されています。このID情報は結果の紐付けに必要であるため、出力時にも絶対に変更せずそのまま残してください。

━━━━━━━━━━━━━━━━━━━━
【「療育を行った結果」の作成ルール】
━━━━━━━━━━━━━━━━━━━━

1. 【文量と文章構成（130〜140字にするための必須構成）】
文字数が短く終わらないよう、各児童・各日付について必ず以下の「3つの要素」をすべて含めて130〜140字程度に肉付けして記述してください。
①【導入】：どのような活動や課題に取り組んだか（場面）
②【展開】：本人の具体的な様子・手の動かし方・工夫・職員の促しに対する反応
③【結び】：どのような達成や前向きな姿・気持ちの切り替えが見られたか

2. 【文末表現とトーン】
- 客観的な書類文とし、文末は「〜した」「〜が見られた」で統一してください。
- 話し言葉・敬体は禁止: 「〜ました」「〜です」などの敬体や話し言葉は使わず、常体で統一してください。

3. 【呼称と個人情報のルール】
- 児童の個人名（苗字・名前）は一切出力に含めないでください。
- 主語は「児童」「職員」「他児」などの一般的な名詞を使用してください。
- 【重要】「スタッフ」という言葉は使わず、必ず「職員」に統一してください。（例: ×スタッフの声かけ ➜ ○職員の声かけ）

4. 【言語・表現のガイドライン（平易化ルールの徹底）】
「専門的＝難しい言葉」ではなく、「事実を正確かつ平易に書くこと」を定義とし、硬い言葉や専門用語の乱用を避けてください。

■ 専門用語・熟語の置換（広く一般的に使われる言葉を使用）:
  × 執行機能・身体操作能力を発揮 → ○ 体の使い方が上手、力加減の調整ができた
  × 正解を導出・解を導く → ○ 正解を出せた、正しい答えを選べた
  × 課題を完遂・完遂した → ○ 最後まで取り組んだ、やり遂げた
  × 〇〇を呈した・〇〇が見受取れた → ○ 〇〇する場面があった、〇〇が見られた
  × 巧緻性を要する → ○ 手先（足先）の細かな動きが必要な

■ 文章構成とトーン:
  - 一文を長くしすぎない。
  - 「〜であり、〜した」という重い接続を避け、「〜して、〜した」「〜した。また、〜だった」と区切って読みやすくする。
  - 漢字を多用しすぎず、適度にひらがなを混ぜて視覚的な圧迫感を減らす。

■ 「できたこと」へのフォーカス:
  - 「向上した」「改善した」といった主観的な評価よりも、「〜ができていた」「〜しようとする姿勢があった」という事実ベースの肯定的な記述を優先する。

5. 【禁止事項】
- 【重要】文章の末尾に「（135字）」「（126字）」のような文字数カウント表記は絶対に付けないこと。
- 余計な挨拶文、前置き、解説（「作成しました」等）は一切出力しないでください。

━━━━━━━━━━━━━━━━━━━━
【良い仕上がり例（約135文字の見本）】
━━━━━━━━━━━━━━━━━━━━
計算ドリルでは小数の筆算に取り組み、位のずれに自分で気づいて消しゴムで丁寧に直す姿が見られた。職員からの励ましに笑顔を見せ、最後まで集中して問題を解ききることができた。その後の夏祭りの振り返りでも、楽しかった場面の理由をハキハキと発表し、友だちの意見にも関心を示した。

━━━━━━━━━━━━━━━━━━━━
【ワンクリックコピー対応の出力形式】
━━━━━━━━━━━━━━━━━━━━
チャット画面で1クリックで全体をコピーできるよう、出力全体を必ず1つのコードブロック（\`\`\`）で囲んで出力してください。

【出力フォーマット】
\`\`\`
【対象月】${formattedMonth}

■ 児童 (ID: [児童ID1])
- 9月1日: 上記の3要素を含めた130〜140字程度の文章。末尾の文字数カウント表記は不要
- 9月5日: 上記の3要素を含めた130〜140字程度の文章。末尾の文字数カウント表記は不要

■ 児童 (ID: [児童ID2])
- 9月2日: 上記の3要素を含めた130〜140字程度の文章。末尾の文字数カウント表記は不要
\`\`\``;

  const handleCopyInstruction = () => {
    navigator.clipboard.writeText(customInstruction)
      .then(() => {
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
      })
      .catch(err => {
        console.error('Failed to copy text: ', err);
        alert('コピーに失敗しました。');
      });
  };

  const handleExecuteImport = async () => {
    if (previewGroups.length === 0) return;
    setIsImporting(true);
    try {
      const importData: Record<string, Record<string, string>> = {};
      
      previewGroups.forEach(group => {
        const childId = group.childId;
        group.items.forEach(item => {
          const date = item.date;
          const shouldOverwrite = overwriteMap[childId]?.[date];
          
          if (shouldOverwrite) {
            if (!importData[childId]) {
              importData[childId] = {};
            }
            importData[childId][date] = item.resultText;
          }
        });
      });
      
      await onImport(importData);
    } catch (err) {
      console.error(err);
      alert('一括登録に失敗しました。');
    } finally {
      setIsImporting(false);
    }
  };

  const totalRecordCount = previewGroups.reduce((acc, g) => acc + g.items.length, 0);
  
  // 登録対象数（新規または上書き許可された項目）
  const importTargetCount = previewGroups.reduce((acc, group) => {
    const childId = group.childId;
    const targets = group.items.filter(item => overwriteMap[childId]?.[item.date]);
    return acc + targets.length;
  }, 0);

  const hasLengthError = previewGroups.some(g => g.items.some(item => item.resultText.length > 140));

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 print:hidden animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 max-w-5xl w-full flex flex-col max-h-[90vh] overflow-hidden animate-scale-up">
        {/* ヘッダー */}
        <div className="bg-slate-50 border-b border-slate-200/60 px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-primary">
            <Sparkles size={20} className="text-primary" />
            <h3 className="font-black text-slate-800 text-lg">全児童の療育結果 一括登録 ({formattedMonth}分)</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1.5 rounded-full hover:bg-slate-100 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* コンテンツ */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* 個人情報非表示に関する注意 */}
          <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-4 flex gap-3 text-xs leading-relaxed">
            <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">⚠️ 個人情報の取り扱いについて</p>
              <p className="mt-1">
                本機能では児童の実名を使用せず、コピー時に自動割り当てされた匿名ID（ID: xxx）情報を用いて一括登録を実行します。
                AIが出力したID表記（`■ 児童 (ID: xxxxx)`）は変更せずにそのまま貼り付けてください。
              </p>
            </div>
          </div>

          {/* カスタム指示セクション */}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <div 
              onClick={() => setShowInstruction(!showInstruction)}
              className="bg-slate-50/50 px-4 py-3 flex items-center justify-between border-b border-slate-200/60 cursor-pointer hover:bg-slate-50"
            >
              <span className="text-sm font-bold text-slate-700 flex items-center gap-2">
                <FileText size={16} className="text-slate-500" />
                1. Gemini用カスタム指示（複数児童用プロンプト）のコピー
              </span>
              <span className="text-xs text-primary font-bold">{showInstruction ? '閉じる' : '展開する'}</span>
            </div>
            
            {showInstruction && (
              <div className="p-4 bg-slate-50/30 space-y-3">
                <p className="text-xs text-slate-500">
                  複数児童のツリー通信を一括コピーしたのち、Geminiに以下の指示プロンプトを設定することで、本アプリが解析可能なフォーマットで全員分の療育結果を生成させることができます。
                </p>
                <div className="relative">
                  <pre className="text-[11px] font-mono bg-slate-900 text-slate-200 p-4 rounded-lg overflow-x-auto max-h-[380px] overflow-y-auto whitespace-pre-wrap leading-relaxed">
                    {customInstruction}
                  </pre>
                  <button
                    onClick={handleCopyInstruction}
                    className={`absolute top-2 right-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm border ${
                      isCopied 
                        ? 'bg-emerald-600 border-emerald-600 text-white' 
                        : 'bg-white border-slate-300 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    {isCopied ? (
                      <>
                        <Check size={12} />
                        <span>コピー完了！</span>
                      </>
                    ) : (
                      <>
                        <Clipboard size={12} />
                        <span>指示をコピー</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 入力とプレビューの2列レイアウト */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-[300px]">
            {/* 入力エリア */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-bold text-slate-700">
                2. Geminiの出力結果を貼り付け
              </label>
              <textarea
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                placeholder={`例：\n【対象月】${formattedMonth}\n\n■ 児童 (ID: child_001)\n- 8月1日: 落ち着いて活動に取り組むことができました。\n- 8月3日: 他児と譲り合って遊具を使うことができました。\n\n■ 児童 (ID: child_002)\n- 8月2日: 職員の声かけに対して元気よく返事をすることができました。`}
                className="flex-1 w-full p-4 border border-slate-300 rounded-xl outline-none resize-none font-mono text-sm focus:border-primary focus:ring-1 focus:ring-primary min-h-[250px] lg:min-h-0"
              />
            </div>

            {/* プレビューエリア */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-bold text-slate-700">
                  解析プレビュー
                </label>
                <span className="text-xs bg-slate-100 text-slate-600 font-bold px-2 py-0.5 rounded-full">
                  児童数: {previewGroups.length}名 / 解析数: {totalRecordCount}件 ({importTargetCount}件登録対象)
                </span>
              </div>

              {previewGroups.some(group => group.items.some(item => !!item.existingText)) && (
                <div className="flex items-center gap-2.5 text-xs bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-amber-900 animate-fade-in">
                  <span className="font-bold shrink-0">既存データ一括設定:</span>
                  <button
                    type="button"
                    onClick={() => {
                      const newMap = { ...overwriteMap };
                      previewGroups.forEach(group => {
                        if (!newMap[group.childId]) {
                          newMap[group.childId] = {};
                        }
                        group.items.forEach(item => {
                          if (item.existingText) {
                            newMap[group.childId][item.date] = true;
                          }
                        });
                      });
                      setOverwriteMap(newMap);
                    }}
                    className="text-primary hover:underline font-extrabold cursor-pointer"
                  >
                    すべて上書きする
                  </button>
                  <span className="text-amber-300">|</span>
                  <button
                    type="button"
                    onClick={() => {
                      const newMap = { ...overwriteMap };
                      previewGroups.forEach(group => {
                        if (!newMap[group.childId]) {
                          newMap[group.childId] = {};
                        }
                        group.items.forEach(item => {
                          if (item.existingText) {
                            newMap[group.childId][item.date] = false;
                          }
                        });
                      });
                      setOverwriteMap(newMap);
                    }}
                    className="text-slate-600 hover:underline font-extrabold cursor-pointer"
                  >
                    上書きしない
                  </button>
                </div>
              )}

              <div className="flex-1 border border-slate-200 rounded-xl bg-slate-50/50 p-4 overflow-y-auto max-h-[350px] lg:max-h-none min-h-[250px] lg:min-h-0">
                {previewGroups.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-400 text-xs italic">
                    左側にテキストを貼り付けると、ここにプレビューが表示されます。
                  </div>
                ) : (
                  <div className="space-y-4 animate-fade-in">
                    {previewGroups.map((group, groupIdx) => (
                      <div key={groupIdx} className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs space-y-2">
                        <div className="flex items-center gap-2 text-slate-800 font-extrabold border-b border-slate-100 pb-2">
                          <User size={16} className="text-primary" />
                          <span className="text-sm">{group.childName}</span>
                          <span className="text-[10px] font-mono text-slate-400 ml-auto">ID: {group.childId}</span>
                        </div>
                        <div className="space-y-3">
                          {group.items.map((item, itemIdx) => {
                            const isOverLimit = item.resultText.length > 140;
                            const hasExistVal = !!item.existingText;
                            const shouldOverwrite = overwriteMap[group.childId]?.[item.date] || false;

                            return (
                              <div 
                                key={itemIdx} 
                                className={`rounded-lg p-3 border transition-all ${
                                  hasExistVal
                                    ? (shouldOverwrite ? 'bg-amber-50/10 border-amber-300' : 'bg-slate-100/55 border-slate-200 opacity-75')
                                    : 'bg-slate-50/50 border-slate-100'
                                }`}
                              >
                                <div className="flex items-center justify-between border-b border-slate-100 pb-1.5 mb-2">
                                  <span className="text-[11px] font-bold text-slate-500 bg-slate-200/60 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                                    <Calendar size={11} /> {item.date}
                                  </span>
                                  <span className={`text-[10px] font-bold ${isOverLimit ? 'text-red-500 bg-red-50 px-2 py-0.5 rounded border border-red-100' : 'text-slate-400'}`}>
                                    {item.resultText.length} / 140文字
                                  </span>
                                </div>

                                {/* 既存の療育結果がある場合 */}
                                {hasExistVal && (
                                  <div className="bg-amber-50/40 border border-amber-200/80 rounded-lg p-2.5 space-y-2 text-[11px] leading-relaxed">
                                    <div className="flex items-center justify-between">
                                      <span className="text-amber-800 font-extrabold flex items-center gap-1">
                                        <AlertTriangle size={11} className="shrink-0" />
                                        既存データあり
                                      </span>
                                      <label className="flex items-center gap-1.5 cursor-pointer font-bold text-amber-900 select-none">
                                        <input
                                          type="checkbox"
                                          checked={shouldOverwrite}
                                          onChange={e => {
                                            const val = e.target.checked;
                                            setOverwriteMap(prev => ({
                                              ...prev,
                                              [group.childId]: {
                                                ...(prev[group.childId] || {}),
                                                [item.date]: val
                                              }
                                            }));
                                          }}
                                          className="w-3.5 h-3.5 rounded border-amber-400 text-amber-600 focus:ring-amber-500 cursor-pointer"
                                        />
                                        上書き
                                      </label>
                                    </div>
                                    <div className="space-y-0.5">
                                      <p className="text-[9px] text-slate-400 font-bold tracking-wider">現在：</p>
                                      <p className="text-slate-500 italic whitespace-pre-wrap">{item.existingText}</p>
                                    </div>
                                    <div className="space-y-0.5 border-t border-amber-200/40 pt-1.5">
                                      <p className="text-[9px] text-amber-700 font-bold tracking-wider">上書き後：</p>
                                      <p className={shouldOverwrite ? 'text-slate-800 font-medium' : 'text-slate-400 line-through'}>
                                        {item.resultText}
                                      </p>
                                    </div>
                                  </div>
                                )}

                                {/* 既存の療育結果がない場合 */}
                                {!hasExistVal && (
                                  <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">
                                    {item.resultText}
                                  </p>
                                )}

                                {isOverLimit && (
                                  <p className="text-[10px] text-red-500 font-semibold flex items-center gap-1 mt-1">
                                    <AlertTriangle size={10} />
                                    140文字を超えています。
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* フッター */}
        <div className="bg-slate-50 border-t border-slate-200 px-6 py-4 flex gap-3 justify-end shrink-0">
          {hasLengthError && (
            <div className="flex items-center gap-1.5 text-xs font-bold text-amber-600 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-xl mr-auto">
              <AlertTriangle size={14} />
              <span>140文字を超えている項目があります。</span>
            </div>
          )}
          <button
            onClick={onClose}
            disabled={isImporting}
            className="px-5 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-bold transition-all disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            onClick={handleExecuteImport}
            disabled={importTargetCount === 0 || isImporting}
            className={`px-5 py-2.5 rounded-xl font-bold text-sm shadow-sm transition-all text-white flex items-center gap-1.5 ${
              importTargetCount === 0 || isImporting
                ? 'bg-slate-300 cursor-not-allowed shadow-none' 
                : 'bg-primary hover:bg-primary-dark'
            }`}
          >
            {isImporting ? (
              <>
                <X className="animate-spin" size={16} />
                <span>登録中...</span>
              </>
            ) : (
              <>
                <Sparkles size={16} />
                <span>{importTargetCount} 件を登録・上書きする</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
