export function cn(...inputs: any[]) {
  return inputs.filter(Boolean).join(' ');
}

export interface ParsedSupportGoals {
  longTerm: string[];
  shortTerm: string[];
  personal: string[];   // 本人支援 (①②③)
  family: string[];     // 家族支援 (⑤)
  transition: string[]; // 移行支援 (④)
  other: string[];
}

/**
 * 支援目標のテキストから ①、②、(1)、中黒、カンマなどの記号を除去して純粋な本文を取り出す
 */
export function cleanGoalItemText(text: string): string {
  if (!text) return '';
  let cleaned = text.trim();
  // 先頭の ① ② ③ ④ ⑤ ⑥ ⑦ ⑧ ⑨ ⑩ または (1) (2)... または 1. 2... を除去
  cleaned = cleaned.replace(/^([①②③④⑤⑥⑦⑧⑨⑩]|\((?:[1-9]|10)\)|[1-9]\.|[1-9]、|[1-9]\)|\u2460|\u2461|\u2462|\u2463|\u2464|\u2465|\u2466|\u2467|\u2468|\u2469|\u246A)\s*/g, '');
  // 先頭の「・」「-」「*」「▸」「▶」等の箇条書き記号を除去
  cleaned = cleaned.replace(/^([・\-\*•\u25B6\u25B8\u25CF\u30FB]|\s)+/, '');
  // 先頭の「本人支援：」「家族支援：」「移行支援：」などのラベルが付いていたらそれも除去する
  cleaned = cleaned.replace(/^(?:本人支援|家族支援|移行支援)[:：\s]*/g, '');
  return cleaned.trim();
}

/**
 * 支援目標のテキストを解析し、長期目標、短期目標、本人支援(①②③)、移行支援(④)、家族支援(⑤)に分類する。
 * ①、②などの記号文字自体は除去して本文のみを抽出する。
 */
export function parseGoalsText(rawText: string): ParsedSupportGoals {
  const result: ParsedSupportGoals = {
    longTerm: [],
    shortTerm: [],
    personal: [],
    family: [],
    transition: [],
    other: []
  };

  if (!rawText || !rawText.trim()) return result;

  const text = rawText.trim();

  // ヘルパー: テキストを行や箇条書きで分割してクリーンアップ（丸数字や中黒を除去）
  const splitItems = (str: string): string[] => {
    return str
      .split(/[\n\r]+/)
      .map(line => cleanGoalItemText(line))
      .filter(line => line.length > 0);
  };

  // 1. セクション分割を試行
  // 「長期目標」「短期目標」「具体的目標」「具体的到達目標」「具体的支援目標」「本人支援」「家族支援」「移行支援」
  // 行頭または改行直後の大見出しを検出（文中の「④家族支援」等と衝突しないように）
  const sectionRegex = /(?:^|[\r\n]+)\s*(長期目標|短期目標|具体的(?:到達|支援)?目標|本人支援|家族支援|移行支援)(?:[:：\s]|$)/gm;
  const sections: { key: string; index: number }[] = [];
  let match: RegExpExecArray | null;

  while ((match = sectionRegex.exec(text)) !== null) {
    const key = match[1];
    const keyIndex = match.index + match[0].indexOf(key);
    sections.push({ key, index: keyIndex });
  }

  const sectionBlocks: Record<string, string> = {};

  if (sections.length > 0) {
    for (let i = 0; i < sections.length; i++) {
      const current = sections[i];
      const next = sections[i + 1];
      // 見出し語の直後から次のセクション開始直前までをスライス
      const rawChunk = text.slice(current.index + current.key.length, next ? next.index : text.length);
      // 先頭にあるコロン、全角コロン、スペース、改行を安全に除去（①などの本文を絶対に削らない）
      const content = rawChunk.replace(/^[:：\s\u3000\r\n]+/g, '').trim();
      sectionBlocks[current.key] = content;
    }
  }

  // 長期目標
  if (sectionBlocks['長期目標']) {
    result.longTerm = splitItems(sectionBlocks['長期目標']);
  }
  // 短期目標
  if (sectionBlocks['短期目標']) {
    result.shortTerm = splitItems(sectionBlocks['短期目標']);
  }
  // 直接「本人支援」があれば
  if (sectionBlocks['本人支援']) {
    result.personal = splitItems(sectionBlocks['本人支援']);
  }
  // 直接「家族支援」があれば
  if (sectionBlocks['家族支援']) {
    result.family = splitItems(sectionBlocks['家族支援']);
  }
  // 直接「移行支援」があれば
  if (sectionBlocks['移行支援']) {
    result.transition = splitItems(sectionBlocks['移行支援']);
  }

  // 丸数字 ①〜⑤ の解析対象テキスト
  // 具体的目標があればそこから、なければ全体テキストから
  const targetForNumbers = sectionBlocks['具体的目標'] || 
                          sectionBlocks['具体的到達目標'] || 
                          sectionBlocks['具体的支援目標'] || 
                          (!sections.length ? text : '');

  if (targetForNumbers) {
    // 丸数字で分割
    // ①, ②, ③, ④, ⑤, ⑥, ⑦, ⑧, ⑨, ⑩
    const circleRegex = /([①②③④⑤⑥⑦⑧⑨⑩]|\([1-9]|10\))/;
    if (circleRegex.test(targetForNumbers)) {
      const parts = targetForNumbers.split(/(?=[①②③④⑤⑥⑦⑧⑨⑩]|\((?:[1-9]|10)\))/);
      const circleMap: Record<string, number> = {
        '①': 1, '②': 2, '③': 3, '④': 4, '⑤': 5, '⑥': 6, '⑦': 7, '⑧': 8, '⑨': 9, '⑩': 10,
        '(1)': 1, '(2)': 2, '(3)': 3, '(4)': 4, '(5)': 5, '(6)': 6, '(7)': 7, '(8)': 8, '(9)': 9, '(10)': 10
      };

      for (let idx = 0; idx < parts.length; idx++) {
        const part = parts[idx].trim();
        if (!part) continue;

        const m = part.match(/^([①②③④⑤⑥⑦⑧⑨⑩]|\((?:[1-9]|10)\))\s*(.*)/s);
        if (m) {
          const num = circleMap[m[1]] || 1;
          // ①や②などの記号、カンマ、中黒を除去して純粋な本文のみを抽出
          const content = cleanGoalItemText(m[2]);
          if (content) {
            // ユーザー指定ルール:
            // 本人支援は①②③
            // 家族支援は④
            // 移行支援は⑤
            if (num >= 1 && num <= 3) {
              if (!result.personal.includes(content)) result.personal.push(content);
            } else if (num === 4) {
              if (!result.family.includes(content)) result.family.push(content);
            } else if (num === 5) {
              if (!result.transition.includes(content)) result.transition.push(content);
            } else {
              if (!result.personal.includes(content)) result.personal.push(content);
            }
          }
        } else if (idx === 0) {
          // 万が一先頭に丸数字記号がない場合、先頭要素は①(本人支援)として救済
          const content = cleanGoalItemText(part);
          if (content && !result.personal.includes(content)) {
            result.personal.push(content);
          }
        }
      }
    } else {
      // 丸数字がない場合は行ごとに本人支援へ
      const items = splitItems(targetForNumbers);
      for (const item of items) {
        if (!result.personal.includes(item)) result.personal.push(item);
      }
    }
  }

  // もし何にも分類されなかった場合、全体をotherとして保持（各行から記号を除去）
  const totalParsed = result.longTerm.length + result.shortTerm.length + 
                      result.personal.length + result.family.length + result.transition.length;
  if (totalParsed === 0) {
    result.other = splitItems(text);
  }

  return result;
}

/**
 * 分類された目標オブジェクトを、①や②の記号を含まない綺麗なテキスト文字列として整形する
 */
export function formatStructuredGoals(parsed: ParsedSupportGoals): string {
  const parts: string[] = [];
  if (parsed.longTerm.length > 0) {
    parts.push(`長期目標：\n${parsed.longTerm.map(s => `・${s}`).join('\n')}`);
  }
  if (parsed.shortTerm.length > 0) {
    parts.push(`短期目標：\n${parsed.shortTerm.map(s => `・${s}`).join('\n')}`);
  }
  if (parsed.personal.length > 0) {
    parts.push(`本人支援：\n${parsed.personal.map(s => `・${s}`).join('\n')}`);
  }
  if (parsed.family.length > 0) {
    parts.push(`家族支援：\n${parsed.family.map(s => `・${s}`).join('\n')}`);
  }
  if (parsed.transition.length > 0) {
    parts.push(`移行支援：\n${parsed.transition.map(s => `・${s}`).join('\n')}`);
  }
  if (parsed.other.length > 0) {
    parts.push(parsed.other.map(s => `・${s}`).join('\n'));
  }
  return parts.join('\n\n');
}
