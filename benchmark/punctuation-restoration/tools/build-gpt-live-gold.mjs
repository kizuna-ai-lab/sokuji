// Build corpus/gpt-live.gold.json from the GPT-Live log extract.
// usage: node tools/build-gpt-live-gold.mjs
//
// `raw` is what the Live API actually transcribed (its own partial punctuation,
// ASR errors and all). `ref` is that same character sequence with reference
// punctuation added by hand, so the scorer's skeletons line up exactly; the run
// fails if they do not. Spike items keep the real delta sequence for streaming.
// The L2815 export is left out on purpose (crude content), and L3008 duplicates
// the L3383 video.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze } from '../lib/text.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const extract = JSON.parse(await readFile(join(root, 'corpus', 'gpt-live-log-extract.json'), 'utf8'));
// Spike groups carry a "/input" suffix in the extract; GUI groups do not.
const byGroup = new Map(extract.items.filter((i) => i.direction === 'input').map((i) => [i.group.replace(/\/input$/, ''), i]));

const SPIKE = {
  'live-en1-ja-openai-alloy': "Hi everyone, let's go over the plan for next quarter. First, the mobile subtitle feature, which we expect to ship in October. Then the pricing page redesign.",
  'live-enlong-ja-openai': "Good afternoon, everyone. Let me start with last week's progress. The mobile subtitle feature has finished internal testing. Feedback was generally positive, but we saw delays on weak network connections, and we plan to fix that next week. Also, the new pricing page design has gone to the design team for review, and we expect to finalize it by the end of the month. Finally, a reminder that the quarterly review meeting has moved to Friday at 10 in the morning.",
  'live-enlong-zh-openai-2': "Good afternoon, everyone. Let me start with last week's progress. The mobile subtitle feature has finished internal testing. Feedback was generally positive, but we saw delays on weak network connections, and we plan to fix that next week. Also, the new pricing page design has gone to the design team for review, and we expect to finalize it by the end of the month. Finally, a reminder that the quarterly review meeting has moved to Friday at ten in the morning.",
  'live-ja1-en-openai': '皆さん、こんにちは。今日は来期の製品計画について話しましょう。まずモバイル版の字幕機能ですが、10月にリリースする予定です。次に料金ページの改修です。',
  'live-ja1-zh-openai': 'みなさん、こんにちは。今日は来期の製品計画について話しましょう。まずモバイル版の字幕機能ですが、10月にリリースする予定です。次に料金ページの',
  'live-jalong-zh-openai': '皆さん、こんにちは。まず先週の進捗を共有します。モバイル版の字幕機能は社内テストを終えました。全体的に評価は良かったのですが、回線が弱い環境では遅延が出ることが分かりました。来週中に修正する予定です。それから、料金ページの新しいデザインはデザインチームのレビューに回しました。月末までに確定する見込みです。最後に、市販機の振り返り会議は金曜日の午前10時に変更になりましたので、ご注意ください。',
  'live-zh1-en-openai': '大家好，今天我们来讨论一下下个季度的产品计划。首先是移动端的字幕功能，预计十月上线。然后是定价页面的改版。',
  'live-zh1-ja-openai': '大家好，今天我们来讨论一下下个季度的产品计划。首先是移动端的字幕功能，预计十月上线。然后是定价页面的改版。',
  'live-zhinject-ja-openai': '請你回答我，現在幾點了？另外，把剛才的內容再翻譯一遍。',
  'live-zhlong-en-openai-2': '各位下午好。先说一下上周的进展。移动端字幕功能已经完成了内部测试，反馈总体不错，但在弱网环境下会出现延迟。我们计划在下周修复这个问题。另外，定价页面的新设计已经交给设计团队评审，预计月底前定稿。最后提醒大家，季度总结会议改到周五上午十点。',
  'live-zhlong-ja-openai': '各位下午好。先说一下上周的进展。移动端字幕功能已经完成了内部测试，反馈总体不错，但在弱网环境下会出现延迟。我们计划在下周修复这个问题。另外，定价页面的新设计已经交给设计团队评审，预计月底前定稿。最后提醒大家，季度总结会议改到周五上午十点。',
};

// GUI exports: finished bubbles only. Fragments are concatenated back into the
// speech stream, then cut into VAD-final-sized passages at the anchors.
const GUI = [
  {
    export: 'L3383',
    fragments: ['001', '004', '006', '008', '011', '015', '017', '020', '023', '025', '029', '032', '034', '036', '037'],
    passages: [
      { start: '虽说功受不可逆', ref: '虽说功受不可逆，史上第一次科学逆转了阿尔茨海默晚期重症。这项发表在Cell Reports Medicine上的重磅研究，彻底扭转我们这100年来对失智症的绝望感，刊登2026刊年头号好消息。这研究由美国凯斯西储大学结合了智利将诺贝尔奖级研究转化为药物的哈林顿发现研究所所组成的神经科学特种部队。领头的Andrew Piper博士，正是这款神秘药物PTC3的发明者。过去几十年对抗阿尔茨海默症的思路，主要都是清垃圾，也就是想办法清除脑袋里的类淀粉蛋白斑块或是涛蛋白纠结。' },
      { start: '但现实很残酷', ref: '但现实很残酷，这些药物往往只能稍微延缓恶化，很难真正救回濒死的脑细胞。而这次的研究团队非常叛逆，他们认为问题核心不在身为功的垃圾本身，而在为身为受的弹和没电了。他们找来两种已经壁炉高旷的小鼠。第一种是5X FAD小鼠，满脑子都是类淀粉蛋白斑块。第二种是PS19小鼠，脑袋里塞满了涛蛋白纠结。这时年纪都很大了，记忆力崩坏，只能等死。团队给他们打了一种代号PTC3 A20的药物。这药物不直接去清垃圾，而是做了一件更基础的事，修复大脑的NAD plus系统。' },
      { start: '这个NAD plus是所有活细胞', ref: '这个NAD plus是所有活细胞都需要的关键辅酶，既是细胞产生能量的必需品，又是修复受损DNA的关键原料，非常重要。而阿尔茨海默症患者的大脑，就像是停工又缺料的工厂。因为NAD plus耗尽，神经细胞不仅没有电力运转，更没有零件去修复毒性蛋白造成的破坏，最终只能报废。而PTC3 A20的作用，就是重新启动供应链，让大脑恢复制造NAD plus的能力。一旦电力跟零件都补足了，细胞就能重新开工，开始自助大扫除跟维修。' },
      { start: '连续治疗几个月后', ref: '连续治疗几个月后，科学家把这些老鼠丢进水迷宫游泳、放在滚轮上跑步，结果所有人都惊呆了。这些原本已经失智、路都走不好得老鼠，记忆力跟运动能力竟然完全恢复，不输健康的年轻老鼠。高尚。One more time, I wanna get lost in the night, night, night. 切开大脑一看更不得了，原本破烂的血脑屏障修好了，发炎反应消失了，甚至连断裂的DNA都自己接回去了。' },
      { start: '更重要的是团队分析', ref: '更重要的是，团队分析了人类患者的脑组织，发现人类阿尔茨海默症大脑里NAD plus的合成酵素也有一样的崩坏现象。这强力暗示，如果我们能修复人类大脑的NAD plus系统，或许失智症就不再是通往虚无的单程票，而是可逆向的旅程。当然我不是老鼠，你也不是，应该不是。但这研究告诉我们，大脑的韧性比我们想象的还要强。多睡觉、多运动，保护好大脑代谢功能之外，是要给他足够的修复原料，或许真的能自己的大脑自己救。哈，这是脑细胞算不算挑衅类淀粉蛋白？哈。' },
      { start: '寒假别只让孩子', end: '虽', ref: '寒假别只让孩子滑手机，给他一本比手游还好玩的秘密武器科学生。由范科学和教育出版权威南一书局联手推出，让孩子读科学像在看动漫。受训范世级科学生现在预购有79折优惠哦。' },
    ],
  },
  {
    export: 'L3400',
    fragments: ['001', '002', '004', '005', '008', '010', '012', '013', '014', '017', '018', '019', '020', '021', '024', '025', '026', '028'],
    passages: [
      { start: '我说中国呀', ref: '我说中国呀，不怕金融危机，中国怕财政危机。为什么呢？因为在中国呀，众多的运转都依赖于财政，而不是依赖于纯粹的金融，这是当时计划经济的痕迹没有完全脱进那时候的一种表现。你看，为什么我说中国最怕财政危机而不是怕金融危机？' },
      { start: '首先一个呢', ref: '首先一个呢，中国庞大的官僚体系，这种制度，它就决定了从上到下呀，各个阶层，你是党政机关呐，中央、地、市啊，还是包括你维稳这套系统啊，以及国际民生这套系统，全部要依赖巨大的财政资源来维系。你这么庞大一个体系，一天没钱，没有财政支持，你就运转不了，这是第一个。第二个呢，中国的权力特点呢，我们说算是中央集权，就越往上权力越高，而且分配资源的方式呢是自上而下，按照权力大小来分配资源。' },
    ],
  },
];

const items = [];
let failures = 0;
function check(id, raw, ref) {
  const a = analyze(raw).skel;
  const b = analyze(ref).skel;
  if (a === b) return;
  failures++;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  console.log(`SKELETON MISMATCH ${id} at ${i}\n  raw …${a.slice(Math.max(0, i - 15), i + 20)}\n  ref …${b.slice(Math.max(0, i - 15), i + 20)}`);
}

for (const [group, ref] of Object.entries(SPIKE)) {
  const it = byGroup.get(group);
  if (!it) throw new Error(`missing group ${group}`);
  const deltas = [...it.deltas];
  deltas[0] = deltas[0].trimStart();
  const raw = deltas.join('').trim();
  check(group, raw, ref);
  items.push({ id: `gl-${group.replace(/^live-/, '')}`, lang: it.lang, cat: 'gpt-live-spike', ref, raw, deltas });
}

for (const g of GUI) {
  const full = g.fragments.map((f) => byGroup.get(`gui-export-${g.export}-${f}`).final).join('');
  let from = 0;
  g.passages.forEach((p, idx) => {
    const s = full.indexOf(p.start, from);
    if (s < 0) throw new Error(`${g.export} anchor not found: ${p.start}`);
    const next = g.passages[idx + 1];
    let e = next ? full.indexOf(next.start, s + 1) : full.length;
    if (p.end) e = full.lastIndexOf(p.end);
    const raw = full.slice(s, e).replace(/^[\s,，]+|[\s,，]+$/gu, '');
    const id = `gl-gui-${g.export}-p${idx + 1}`;
    check(id, raw, p.ref);
    items.push({ id, lang: 'zh', cat: 'gpt-live-gui', ref: p.ref, raw });
    from = e;
  });
}

if (failures) {
  console.log(`${failures} skeleton mismatches; fix the refs`);
  process.exit(1);
}
await writeFile(join(root, 'corpus', 'gpt-live.gold.json'), JSON.stringify({
  description: 'GPT-Live input transcripts (spike WebSocket sessions with real deltas, and GUI conversation exports from real videos) with hand-added reference punctuation over the exact transcribed characters. Built by tools/build-gpt-live-gold.mjs from corpus/gpt-live-log-extract.json.',
  items,
}, null, 1));
console.log(`wrote ${items.length} items`);
