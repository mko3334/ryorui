// テストケースの検証
const testCases = [
  "長期目標：あああ\n短期目標：いいい\n具体的目標：①ううう②えええ③おおお④かかか⑤ききき",
  "長期目標：あああ\n短期目標：いいい\n具体的目標:①ううう②えええ",
  "長期目標：あああ\n短期目標：いいい\n具体的目標： ①ううう",
  "長期目標：あああ\n短期目標：いいい\n具体的目標\n①ううう",
  "長期目標：あああ\n短期目標：いいい\n具体的支援目標：①ううう",
  "長期目標：あああ\n短期目標：いいい\n具体的目標：：①ううう",
  "長期目標：あああ\n短期目標：いいい\n①ううう②えええ",
  "具体的目標：①人の話を聞いて会話をする。②ルールに柔軟に対応する。",
  // もしエクセルから読み取った文字列に改行やスペースが混ざっていた場合
  "長期目標：あああ\r\n短期目標：いいい\r\n具体的目標：①ううう",
  "長期目標：あああ\n短期目標：いいい\n具体的目標 : ①ううう",
];

for (let idx = 0; idx < testCases.length; idx++) {
  const text = testCases[idx];
  
  // utils.ts のロジック
  const sectionRegex = /(長期目標|短期目標|具体的(?:到達)?目標|本人支援|家族支援|移行支援)[:：\s]/g;
  const sections = [];
  let match;

  while ((match = sectionRegex.exec(text)) !== null) {
    sections.push({ key: match[1], index: match.index });
  }

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

  const targetForNumbers = sectionBlocks['具体的目標'] || sectionBlocks['具体的到達目標'] || (!sections.length ? text : '');
  
  const circleRegex = /([①②③④⑤⑥⑦⑧⑨⑩]|\([1-9]|10\))/;
  let parsed1 = false;
  if (circleRegex.test(targetForNumbers)) {
    const parts = targetForNumbers.split(/(?=[①②③④⑤⑥⑦⑧⑨⑩]|\((?:[1-9]|10)\))/);
    for (const part of parts) {
      const m = part.match(/^([①②③④⑤⑥⑦⑧⑨⑩]|\((?:[1-9]|10)\))\s*(.*)/s);
      if (m && m[1] === '①') {
        parsed1 = true;
        break;
      }
    }
  }

  console.log(`Test ${idx}:`, parsed1 ? 'OK' : 'FAILED', JSON.stringify({
    text: text.slice(0, 30) + '...',
    targetForNumbers: targetForNumbers.slice(0, 30),
    sections: sections.map(s => s.key)
  }));
}
