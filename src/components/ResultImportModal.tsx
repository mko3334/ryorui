import React, { useState, useEffect } from 'react';
import { X, Clipboard, Check, AlertTriangle, FileText, Sparkles } from 'lucide-react';
import type { DailyReport } from '../types/supportPlan';

interface ResultImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  monthStr: string; // "YYYY-MM"
  existingRows: DailyReport[]; // 既存の登録データ
  onImport: (results: Record<string, string>) => void;
}

interface ParsedResult {
  date: string;
  originalDate: string;
  resultText: string;
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

const parseImportedResults = (text: string): ParsedResult[] => {
  const list: ParsedResult[] = [];
  const lines = text.split('\n');
  let currentDate = '';
  let currentContent: string[] = [];

  for (let line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) continue;

    // 「■ 4月1日」や「【4月1日】」、「8/1」などの日付パターンにマッチするか確認
    const dateMatch = trimmed.match(/^(?:■|【)?\s*(\d+月\d+日|\d+[-/]\d+)\s*(?:】|:|：)?$/) 
      || trimmed.match(/^■\s*(\d+月\d+日|\d+[-/]\d+)/)
      || trimmed.match(/^【\s*(\d+月\d+日|\d+[-/]\d+)\s*】/);
      
    if (dateMatch) {
      if (currentDate && currentContent.length > 0) {
        list.push({
          date: normalizeDateStr(currentDate),
          originalDate: currentDate,
          resultText: currentContent.join('\n').trim()
        });
      }
      currentDate = dateMatch[1];
      currentContent = [];
    } else {
      if (currentDate) {
        currentContent.push(line);
      }
    }
  }

  if (currentDate && currentContent.length > 0) {
    list.push({
      date: normalizeDateStr(currentDate),
      originalDate: currentDate,
      resultText: currentContent.join('\n').trim()
    });
  }

  return list;
};

export const ResultImportModal: React.FC<ResultImportModalProps> = ({
  isOpen,
  onClose,
  monthStr,
  existingRows,
  onImport
}) => {
  const [inputText, setInputText] = useState('');
  const [parsedList, setParsedList] = useState<ParsedResult[]>([]);
  const [overwriteMap, setOverwriteMap] = useState<Record<string, boolean>>({});
  const [isCopied, setIsCopied] = useState(false);
  const [showInstruction, setShowInstruction] = useState(true);

  useEffect(() => {
    if (!isOpen) {
      setInputText('');
      setParsedList([]);
      setOverwriteMap({});
      setIsCopied(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (inputText.trim()) {
      const parsed = parseImportedResults(inputText);
      setParsedList(parsed);

      const map: Record<string, boolean> = {};
      parsed.forEach(item => {
        const exist = existingRows.find(r => r.date === item.date);
        const hasExistVal = exist?.content?.resultInfo?.trim();
        // 既存値がある場合はデフォルトで上書き無効(false)、なければ自動登録(true)
        map[item.date] = !hasExistVal;
      });
      setOverwriteMap(map);
    } else {
      setParsedList([]);
      setOverwriteMap({});
    }
  }, [inputText, existingRows]);

  if (!isOpen) return null;

  const [year, month] = monthStr.split('-');
  const formattedMonth = `${year}年${parseInt(month, 10)}月`;

  const customInstruction = `あなたは児童発達支援および放課後等デイサービスの療育職員です。
提供された対象児童のツリー通信（連絡帳や日誌の文章）をもとに、専門的支援実施計画における「療育を行った結果」の文章を作成してください。

以下の作成ルールおよび出力フォーマットを厳格に守ってください。

━━━━━━━━━━━━━━━━━━━━
【「療育を行った結果」の作成ルール】
━━━━━━━━━━━━━━━━━━━━

1. 【文量と文章構成（130〜140字にするための必須構成）】
文字数が短く終わらないよう、必ず以下の「3つの要素」をすべて含めて130〜140字程度に肉付けして記述してください。
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

■ 9月1日
上記の3要素を含めた130〜140字程度の文章。末尾の文字数カウント表記は不要

■ 9月5日
上記の3要素を含めた130〜140字程度の文章。末尾の文字数カウント表記は不要
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

  const handleExecuteImport = () => {
    if (parsedList.length === 0) return;
    const resultObj: Record<string, string> = {};
    parsedList.forEach(item => {
      // ユーザーが上書き許可（または新規）の項目のみ
      if (overwriteMap[item.date]) {
        resultObj[item.date] = item.resultText;
      }
    });
    onImport(resultObj);
  };

  const hasLengthError = parsedList.some(item => item.resultText.length > 140);
  const totalRecordCount = parsedList.length;
  // インポート実行対象の件数
  const importTargetCount = parsedList.filter(item => overwriteMap[item.date]).length;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 print:hidden animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 max-w-4xl w-full flex flex-col max-h-[90vh] overflow-hidden animate-scale-up">
        {/* ヘッダー */}
        <div className="bg-slate-50 border-b border-slate-200/60 px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-primary">
            <Sparkles size={20} className="text-primary" />
            <h3 className="font-black text-slate-800 text-lg">Gemini 療育結果の一括登録 ({formattedMonth}分)</h3>
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
                セキュリティおよびプライバシー保護のため、Geminiなどの外部AIツールに送信する文章や、AIから出力される文章には**児童の個人名を含めない**ようにしてください。
                本機能では児童名を使用せず、日付情報のみを用いて一括登録を実行します。
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
                1. Gemini用カスタム指示（プロンプト）のコピー
              </span>
              <span className="text-xs text-primary font-bold">{showInstruction ? '閉じる' : '展開する'}</span>
            </div>
            
            {showInstruction && (
              <div className="p-4 bg-slate-50/30 space-y-3">
                <p className="text-xs text-slate-500">
                  Geminiにツリー通信を貼り付ける前に、以下の指示文を設定または送信することで、本アプリにそのまま貼り付け可能なフォーマットで療育結果を生成させることができます。
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
                placeholder={`例：\n【対象月】${formattedMonth}\n\n■ 4月1日\n指先を器用に使って積み木を重ねることができました。\n\n■ 4月2日\nお友達におもちゃを「貸して」と言葉で伝えることができました。`}
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
                  解析数: {totalRecordCount}件 (内 {importTargetCount}件登録対象)
                </span>
              </div>

              {parsedList.some(item => {
                const exist = existingRows.find(r => r.date === item.date);
                return !!exist?.content?.resultInfo?.trim();
              }) && (
                <div className="flex items-center gap-2.5 text-xs bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-amber-900">
                  <span className="font-bold shrink-0">既存データ一括設定:</span>
                  <button
                    type="button"
                    onClick={() => {
                      const newMap = { ...overwriteMap };
                      parsedList.forEach(item => {
                        const exist = existingRows.find(r => r.date === item.date);
                        if (exist?.content?.resultInfo?.trim()) {
                          newMap[item.date] = true;
                        }
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
                      parsedList.forEach(item => {
                        const exist = existingRows.find(r => r.date === item.date);
                        if (exist?.content?.resultInfo?.trim()) {
                          newMap[item.date] = false;
                        }
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
                {parsedList.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-400 text-xs italic">
                    左側にテキストを貼り付けると、ここにプレビューが表示されます。
                  </div>
                ) : (
                  <div className="space-y-4">
                    {parsedList.map((item, idx) => {
                      const isOverLimit = item.resultText.length > 140;
                      const exist = existingRows.find(r => r.date === item.date);
                      const existVal = exist?.content?.resultInfo?.trim();
                      const hasExistVal = !!existVal;
                      const shouldOverwrite = overwriteMap[item.date] || false;

                      return (
                        <div 
                          key={idx} 
                          className={`bg-white border rounded-xl p-4 shadow-2xs space-y-2.5 transition-all ${
                            hasExistVal 
                              ? (shouldOverwrite ? 'border-amber-300 bg-amber-50/10' : 'border-slate-200 bg-slate-100/50 opacity-75') 
                              : 'border-slate-200'
                          }`}
                        >
                          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                            <span className="text-xs font-bold text-primary bg-primary/10 px-2.5 py-0.5 rounded-full">
                              {item.date}
                            </span>
                            <span className={`text-[10px] font-bold ${isOverLimit ? 'text-red-500 bg-red-50 px-2 py-0.5 rounded border border-red-100' : 'text-slate-400'}`}>
                              {item.resultText.length} / 140文字
                            </span>
                          </div>

                          {/* 既存の療育結果がある場合 */}
                          {hasExistVal && (
                            <div className="bg-amber-50/40 border border-amber-250 rounded-lg p-3 space-y-2 text-xs leading-relaxed">
                              <div className="flex items-center justify-between">
                                <span className="text-amber-800 font-extrabold flex items-center gap-1">
                                  <AlertTriangle size={12} className="shrink-0" />
                                  既存の療育結果あり
                                </span>
                                <label className="flex items-center gap-1.5 cursor-pointer font-bold text-amber-900 select-none">
                                  <input
                                    type="checkbox"
                                    checked={shouldOverwrite}
                                    onChange={e => setOverwriteMap(prev => ({ ...prev, [item.date]: e.target.checked }))}
                                    className="w-4 h-4 rounded border-amber-400 text-amber-600 focus:ring-amber-500 cursor-pointer"
                                  />
                                  上書きする
                                </label>
                              </div>
                              <div className="space-y-1">
                                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">現在登録されている内容：</p>
                                <p className="text-slate-500 italic whitespace-pre-wrap">{existVal}</p>
                              </div>
                              <div className="space-y-1 border-t border-amber-200/50 pt-2">
                                <p className="text-[10px] text-amber-700 font-bold uppercase tracking-wider">上書き後の内容：</p>
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
                              140文字を超えています。計画書の表示幅からはみ出す可能性があります。
                            </p>
                          )}
                        </div>
                      );
                    })}
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
            className="px-5 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-bold transition-all"
          >
            キャンセル
          </button>
          <button
            onClick={handleExecuteImport}
            disabled={importTargetCount === 0}
            className={`px-5 py-2.5 rounded-xl font-bold text-sm shadow-sm transition-all text-white ${
              importTargetCount === 0 
                ? 'bg-slate-300 cursor-not-allowed shadow-none' 
                : 'bg-primary hover:bg-primary-dark'
            }`}
          >
            {importTargetCount} 件を登録・上書きする
          </button>
        </div>
      </div>
    </div>
  );
};
