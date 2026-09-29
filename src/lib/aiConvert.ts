const SYSTEM_PROMPT = `あなたは放課後等デイサービスの支援記録を作成する専門員です。
職員のメモ（ツリー通信）を「療育を行った結果」欄に記載する客観的かつ平易な支援記録に変換してください。

━━━━━━━━━━━━━━━━━━━━
【「療育を行った結果」の作成ルール】
━━━━━━━━━━━━━━━━━━━━

1. 【基本フォーマットと文章構成（130〜140字程度）】
- 文字数: 130〜140字程度。短く終わらないよう「場面」「本人の様子・工夫」「職員の関わり・結果」を具体的に肉付けして記述してください。
- 文末表現: 客観的な書類文とし、文末は「〜した」「〜が見られた」で統一してください。
- 話し言葉・敬体は禁止: 「〜ました」「〜です」などの敬体や話し言葉は使わず、常体で統一してください。

2. 【呼称と個人情報のルール】
- 児童の個人名（苗字・名前）は一切出力に含めないでください。
- 主語は「児童」「職員」「他児」などの一般的な名詞を使用してください。
- 【重要】「スタッフ」という言葉は使わず、必ず「職員」に統一してください。（例: ×スタッフの声かけ ➜ ○職員の声かけ）

3. 【言語・表現のガイドライン（平易化ルールの徹底）】
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

4. 【禁止事項】
- 前置き・挨拶・解説・引用符（「」や\`\`\`）などは一切不要です。
- 文章の末尾に「（135字）」のような文字数カウント表記は絶対に付けないでください。
変換した文章のプレーンテキストのみを直接出力してください。`;

export interface GeminiApiDebugInfo {
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
}

export class GeminiApiError extends Error {
  debugInfo: GeminiApiDebugInfo;
  constructor(message: string, debugInfo: GeminiApiDebugInfo) {
    super(message);
    this.name = 'GeminiApiError';
    this.debugInfo = debugInfo;
  }
}

export async function convertToResult(
  externalInfo: string,
  apiKey: string,
  _preSelectedModel?: string,
  requestIndex?: string,
  signal?: AbortSignal
): Promise<string> {
  if (!apiKey) {
    throw new Error('APIキーが指定されていません。');
  }

  // 1. 使用モデルを gemini-1.5-flash に強制固定する (CORSエラーやキャッシュによる暴走防止)
  const selectedModel = 'models/gemini-1.5-flash';
  const availableModels: string[] = ['models/gemini-1.5-flash'];
  const listModelsError: string | undefined = undefined;

  const url = `https://generativelanguage.googleapis.com/v1beta/${selectedModel}:generateContent?key=${apiKey}`;

  // リクエスト用JSON（ペイロード）を構築
  const payload = {
    systemInstruction: {
      parts: [{ text: SYSTEM_PROMPT }]
    },
    contents: [{
      parts: [{
        text: `以下のツリー通信を「療育を行った結果」に変換してください。\n\n【ツリー通信】\n${externalInfo}`
      }]
    }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 1000
    }
  };

  const debugData: GeminiApiDebugInfo = {
    url,
    model: selectedModel,
    payload,
    availableModels,
    listModelsError,
    requestCount: requestIndex || "1 / 1"
  };

  // ユーザーへのデバッグ情報提供のため、コンソールへ明示的に出力
  console.log("【実際に送信しているURL】:", url);
  console.log("【実際に送信しているモデル名】:", selectedModel);
  console.log("【現在何回目の送信か】:", requestIndex || "1 / 1");
  console.log("【ブラウザコンソールに出力されるリクエスト内容】:", JSON.stringify(payload, null, 2));

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify(payload)
    });
  } catch (e: any) {
    if (e.name === 'AbortError') throw e;
    throw new GeminiApiError(`送信エラー: ${e.message || String(e)}`, debugData);
  }

  // Retry-After ヘッダーの取得
  const retryAfter = response.headers.get('Retry-After');
  if (retryAfter) {
    debugData.retryAfter = retryAfter;
    console.log(`【Gemini API】Retry-Afterヘッダーを検出しました: ${retryAfter}秒`);
  }

  if (!response.ok) {
    const err = await response.text().catch(() => '');
    debugData.httpStatus = response.status;
    debugData.httpResponse = err;

    // エラー詳細JSONのパース試行
    try {
      const errJson = JSON.parse(err);
      if (errJson.error) {
        debugData.errorDetails = errJson.error;
      }
    } catch (_) {}

    throw new GeminiApiError(`Gemini API エラー (${response.status}): ${err || response.statusText}`, debugData);
  }

  let data: any;
  try {
    data = await response.json();
  } catch (e: any) {
    debugData.httpStatus = response.status;
    debugData.httpResponse = 'JSONパースエラー';
    throw new GeminiApiError(`レスポンスのパースに失敗しました: ${e.message || String(e)}`, debugData);
  }
  
  if (!data.candidates || data.candidates.length === 0) {
    debugData.httpResponse = JSON.stringify(data);
    throw new GeminiApiError('AIからの応答が空でした（安全フィルターの影響の可能性があります）', debugData);
  }

  const text = data.candidates[0].content?.parts?.[0]?.text;
  
  if (!text) {
    debugData.httpResponse = JSON.stringify(data);
    throw new GeminiApiError('AIからの応答にテキストが含まれていませんでした', debugData);
  }

  return text.trim();
}

const OBSERVATION_SYSTEM_PROMPT = `あなたは放課後等デイサービスの支援記録・行動観察シートを作成する専門家です。
職員のチャットメモや記録を、支援手順書 兼 記録用紙（強行シート）の「様子」欄に記載する専門的な支援記録に変換してください。

【変換ルール】
① 文体・トーン：
- 「だ・である」調、「〜だった」などの客観的な常体文にすること（です・ます調は禁止）。
- 職員の主観的な感想（すごかった、嬉しそう等）は、客観的な行動（達成感を得た、意欲的に取り組んだ等）に書き換えること。

② 専門用語への置き換え例（必須）：
- 気持ちを切り替えた → 自己統制力、自己調整
- 見通しを持って〜した → 見通しを持つ力、予測する力
- 自分で〜すると決めた → 自己決定、主体的な選択
- 最後まで頑張った → 課題を完遂する力、高い集中力の維持
- 分からないところを聞けた → 自発的な援助要求
- 手先を器用に使った → 手指の巧緻性（こうちせい）
- 目で見ながらなぞった → 目と手の協応
- 道具の危険性を理解した → 危険予知、安全への配慮
- 音読で表やルビを見て調べた → 視覚的補助（代償手段）の活用

③ ポジティブ・リフレーミング：
- 課題や苦手なこと（例：気が散る、離席する、こだわり等）も否定的に書かず、「〜という課題はあるが、〜の工夫で取り組めた」「〜に向けた支援を継続していく」など、本人の強みや今後の支援に繋げる書き方をすること。

④ 文字数制限（極めて重要）：
- 出力は必ず【80文字程度（75文字以上85文字以下）】にしてください。長すぎず短すぎず、80文字前後にきっちり収めてください。

【重要】変換後の文章のみ返すこと。前置きや解説、「80文字:」などのラベル、タグ表記【】などは一切不要です。`;

export async function convertToObservation(
  rawMemo: string,
  apiKey: string,
  activityTag?: string,
  requestIndex?: string,
  signal?: AbortSignal
): Promise<string> {
  if (!apiKey) {
    throw new Error('APIキーが指定されていません。');
  }

  const selectedModel = 'models/gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/${selectedModel}:generateContent?key=${apiKey}`;

  const promptText = activityTag
    ? `以下の活動内容およびチャットメモを、記録用紙の「様子」欄にふさわしい専門的な支援記録（80文字程度）に変換してください。\n\n【予定・活動】\n${activityTag}\n\n【メモ】\n${rawMemo}`
    : `以下のチャットメモを、記録用紙の「様子」欄にふさわしい専門的な支援記録（80文字程度）に変換してください。\n\n【メモ】\n${rawMemo}`;

  const payload = {
    systemInstruction: {
      parts: [{ text: OBSERVATION_SYSTEM_PROMPT }]
    },
    contents: [{
      parts: [{ text: promptText }]
    }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 500
    }
  };

  const debugData: GeminiApiDebugInfo = {
    url,
    model: selectedModel,
    payload,
    availableModels: [selectedModel],
    requestCount: requestIndex || "1 / 1"
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify(payload)
    });
  } catch (e: any) {
    if (e.name === 'AbortError') throw e;
    throw new GeminiApiError(`送信エラー: ${e.message || String(e)}`, debugData);
  }

  if (!response.ok) {
    const err = await response.text().catch(() => '');
    debugData.httpStatus = response.status;
    debugData.httpResponse = err;
    throw new GeminiApiError(`Gemini API エラー (${response.status}): ${err || response.statusText}`, debugData);
  }

  let data: any;
  try {
    data = await response.json();
  } catch (e: any) {
    debugData.httpStatus = response.status;
    debugData.httpResponse = 'JSONパースエラー';
    throw new GeminiApiError(`レスポンスのパースに失敗しました: ${e.message || String(e)}`, debugData);
  }

  if (!data.candidates || data.candidates.length === 0) {
    debugData.httpResponse = JSON.stringify(data);
    throw new GeminiApiError('AIからの応答が空でした', debugData);
  }

  const text = data.candidates[0].content?.parts?.[0]?.text;
  if (!text) {
    debugData.httpResponse = JSON.stringify(data);
    throw new GeminiApiError('AIからの応答にテキストが含まれていませんでした', debugData);
  }

  return text.trim();
}

