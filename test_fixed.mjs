function cleanGoalItemText(str) {
  if (!str) return '';
  return str
    .trim()
    .replace(/^([①-⑳]|\([0-9]+\)|[0-9]+[\.．、，\)]|[・\-\*\s\u30fb\u25b8\u25b6\u25b7、，,])+/g, '')
    .replace(/^[・\-\*\s\u30fb\u25b8\u25b6\u25b7、，,]+/g, '')
    .replace(/[①-⑳]/g, '')
    .trim();
}

function parseGoalsTextFixed(rawText) {
  const result = {
    longTerm: [],
    shortTerm: [],
    personal: [],
    family: [],
    transition: [],
    other: []
  };

  if (!rawText || !rawText.trim()) return result;
  const text = rawText.trim();

  const splitItems = (str) => {
    return str
      .split(/[\n\r]+/)
      .map(line => cleanGoalItemText(line))
      .filter(line => line.length > 0);
  };

  // セクションの検出
  const sectionKeywords = ['長期目標', '短期目標', '具体的到達目標', '具体的支援目標', '具体的目標', '本人支援', '家族支援', '移行支援'];
  const pattern = new RegExp(`(${sectionKeywords.join('|')})`, 'g');
  const sections = [];
  let match;

  while ((match = pattern.exec(text)) !== null) {
    sections.push({ key: match[1], index: match.index });
  }

  const sectionBlocks = {};
  if (sections.length > 0) {
    for (let i = 0; i < sections.length; i++) {
      const current = sections[i];
      const next = sections[i + 1];
      const start = current.index + current.key.length;
      const end = next ? next.index : text.length;
      // 先頭のコロン・スペース・改行を安全に除去
      const content = text.slice(start, end).replace(/^[:：\s\u3000\r\n]+/g, '').trim();
      sectionBlocks[current.key] = content;
    }
  }

  if (sectionBlocks['長期目標']) result.longTerm = splitItems(sectionBlocks['長期目標']);
  if (sectionBlocks['短期目標']) result.shortTerm = splitItems(sectionBlocks['短期目標']);
  if (sectionBlocks['本人支援']) result.personal = splitItems(sectionBlocks['本人支援']);
  if (sectionBlocks['家族支援']) result.family = splitItems(sectionBlocks['家族支援']);
  if (sectionBlocks['移行支援']) result.transition = splitItems(sectionBlocks['移行支援']);

  // 丸数字の解析対象テキスト
  // 具体的目標があればそこから、なければテキスト全体から
  const targetForNumbers = sectionBlocks['具体的目標'] || 
                           sectionBlocks['具体的到達目標'] || 
                           sectionBlocks['具体的支援目標'] || 
                           text;

  const circleRegex = /([①②③④⑤⑥⑦⑧⑨⑩]|\([1-9]|10\))/;
  if (circleRegex.test(targetForNumbers)) {
    const parts = targetForNumbers.split(/(?=[①②③④⑤⑥⑦⑧⑨⑩]|\((?:[1-9]|10)\))/);
    const circleMap = {
      '①': 1, '②': 2, '③': 3, '④': 4, '⑤': 5, '⑥': 6, '⑦': 7, '⑧': 8, '⑨': 9, '⑩': 10,
      '(1)': 1, '(2)': 2, '(3)': 3, '(4)': 4, '(5)': 5, '(6)': 6, '(7)': 7, '(8)': 8, '(9)': 9, '(10)': 10
    };

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();
      if (!part) continue;

      const m = part.match(/^([①②③④⑤⑥⑦⑧⑨⑩]|\((?:[1-9]|10)\))\s*(.*)/s);
      let num = 1;
      let body = part;

      if (m) {
        num = circleMap[m[1]] || (i + 1);
        body = m[2];
      } else if (i === 0 && /[①②③④⑤⑥⑦⑧⑨⑩]/.test(targetForNumbers)) {
        num = 1;
        body = part;
      } else {
        continue;
      }

      const content = cleanGoalItemText(body);
      if (content) {
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
    }
  }

  return result;
}

// テスト
const test = `長期目標：様々なプログラムに参加する
短期目標：人の話を聞く
具体的目標：①人の話を聞いて会話をする。②ルールに柔軟に対応する。③様々なプログラムを経験し興味をさらに広げる。④日々の様子を会話やLineを利用して共有する。⑤学校や家庭と連携を取り日々の学習状況を共有する。`;

console.log(JSON.stringify(parseGoalsTextFixed(test), null, 2));

const testWithColonSpace = `長期目標：様々なプログラム
短期目標：話を聞く
具体的目標： ①人の話を聞いて会話をする。②ルールに柔軟に対応する。`;

console.log(JSON.stringify(parseGoalsTextFixed(testWithColonSpace), null, 2));
