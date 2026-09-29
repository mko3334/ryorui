const text = `長期目標：様々なプログラムに参加し...
短期目標：人の話を聞く...
具体的目標：①人の話を聞いて会話をする。②ルールに柔軟に対応する。③様々なプログラムを経験し興味をさらに広げる。④日々の様子を会話やLineを利用して共有する。⑤学校や家庭と連携を取り日々の学習状況を共有する。`;

// 現在の utils.ts の実装をテスト
const sectionRegex = /(長期目標|短期目標|具体的(?:到達)?目標|本人支援|家族支援|移行支援)[:：\s]/g;
const sections = [];
let match;

while ((match = sectionRegex.exec(text)) !== null) {
  sections.push({ key: match[1], index: match.index });
}

console.log('sections:', sections);

const sectionBlocks = {};
if (sections.length > 0) {
  for (let i = 0; i < sections.length; i++) {
    const current = sections[i];
    const next = sections[i + 1];
    const start = current.index + current.key.length + 1; // +1 for colon/space
    const end = next ? next.index : text.length;
    const content = text.slice(start, end).trim();
    sectionBlocks[current.key] = content;
  }
}

console.log('sectionBlocks:', sectionBlocks);

const targetForNumbers = sectionBlocks['具体的目標'] || sectionBlocks['具体的到達目標'] || (!sections.length ? text : '');
console.log('targetForNumbers:', targetForNumbers);

const circleRegex = /([①②③④⑤⑥⑦⑧⑨⑩]|\([1-9]|10\))/;
console.log('circleRegex.test:', circleRegex.test(targetForNumbers));

const parts = targetForNumbers.split(/(?=[①②③④⑤⑥⑦⑧⑨⑩]|\((?:[1-9]|10)\))/);
console.log('parts:', parts);

for (const part of parts) {
  const m = part.match(/^([①②③④⑤⑥⑦⑧⑨⑩]|\((?:[1-9]|10)\))\s*(.*)/s);
  console.log('part match:', part, '=>', m);
}
