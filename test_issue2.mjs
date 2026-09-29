function cleanGoalItemText(str) {
  if (!str) return '';
  return str
    .trim()
    .replace(/^([①-⑳]|\([0-9]+\)|[0-9]+[\.．、，\)]|[・\-\*\s\u30fb\u25b8\u25b6\u25b7、，,])+/g, '')
    .replace(/^[・\-\*\s\u30fb\u25b8\u25b6\u25b7、，,]+/g, '')
    .replace(/[①-⑳]/g, '')
    .trim();
}

// ケース1: 具体的目標の直後にコロンと①がある
// もし targetForNumbers の先頭にコロンが残った場合:
const t1 = "：①人の話を聞いて会話をする。②ルールに柔軟に対応する。";
const parts1 = t1.split(/(?=[①②③④⑤⑥⑦⑧⑨⑩]|\((?:[1-9]|10)\))/);
console.log('parts1:', parts1);
// parts1[0] is "：" !
// parts1[1] is "①人の話を聞いて会話をする。"

// ケース2: sectionBlocks の取り出し
const text2 = "長期目標：プログラム\n短期目標：人の話\n具体的目標：①人の話を聞く②ルール";
// sectionRegex
const sectionRegex = /(長期目標|短期目標|具体的(?:到達)?目標|本人支援|家族支援|移行支援)[:：\s]/g;
const sections = [];
let match;
while ((match = sectionRegex.exec(text2)) !== null) {
  sections.push({ key: match[1], index: match.index, fullMatch: match[0] });
}
console.log('sections:', sections);

for (let i = 0; i < sections.length; i++) {
  const current = sections[i];
  const next = sections[i + 1];
  const start = current.index + current.key.length + 1;
  const end = next ? next.index : text2.length;
  console.log(current.key, 'content:', JSON.stringify(text2.slice(start, end)));
}
