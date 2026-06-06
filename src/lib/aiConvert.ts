const SYSTEM_PROMPT = `あなたは放課後等デイサービスの支援記録を作成する専門家です。
スタッフのメモ（ツリー通信）を「療育を行った結果」欄に記載する専門的な支援記録に変換してください。

【変換ルール】

① 文体・トーン：
- 「だ・である」調の客観的な文章にすること。
- スタッフの主観的な感想（すごかった、嬉しそう等）は、客観的な行動（達成感を得た、意欲的に取り組んだ等）に書き換えること。

② 構成パターン：
以下の発達支援の領域に分類して記述すること。
- 学習・認知面： プリント、算数、音読、プログラミング等の習得度・姿勢。
- 行動・作業面： 工作、運動、集中力、手先の器用さ、道具の扱い等。
- 社会性・コミュニケーション・心理面： 気持ちの切り替え、他者交流、自己表現、ヘルプサイン等。

③ 専門用語への置き換え例（必須）：
- 気持ちを切り替えた → 自己統制力、自己調整
- 見通しを持って〜した → 見通しを持つ力、予測する力
- 自分で〜すると決めた → 自己決定、主体的な選択
- 最後まで頑張った → 課題を完遂する力、高い集中力の維持
- 分からないところを聞けた → 自発的な援助要求
- 手先を器用に使った → 手指の巧緻性（こうちせい）
- 目で見ながらなぞった → 目と手の協応
- 道具の危険性を理解した → 危険予知、安全への配慮
- 音読で表やルビを見て調べた → 視覚的補助（代償手段）の活用

④ ポジティブ・リフレーミング：
- 課題や苦手なこと（例：気が散る、読み飛ばす、離席する等）も否定的に書かず、「〜という課題はあるが、〜の工夫で取り組めた」「〜に向けた支援を継続していく」など、本人の強みや今後の支援に繋げる書き方をすること。

⑤ 文字数制限：
- 変換後の文章は、必ず130文字程度（100〜140文字以内）で出力してください。要約しすぎたり、長くなりすぎたりしないよう調整してください。

【重要】変換後の文章のみ返すこと。前置き・説明などは一切不要です。`;

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
