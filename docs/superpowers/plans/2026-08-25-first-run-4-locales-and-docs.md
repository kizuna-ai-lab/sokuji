# First-Run Setup — Plan 4: Locales, docs, and the rendering pass

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the work: bring all 30 locale catalogues back into lockstep (new `setup.*` / `tour.*` keys in, dead `userTypeSelection.*` / `onboarding.*` keys out), author `zh_CN` and `ja`, rewrite the onboarding guide and the analytics event doc, and settle the wording and layout by rendering both surfaces on both platforms.

**Architecture:** One idempotent Node script performs the sweep (add-with-English-placeholder, delete-stale) against every `src/locales/*/translation.json` so the 29 files change mechanically and identically; `zh_CN` and `ja` are then hand-edited. Docs are rewritten from the spec. The rendering pass follows the house rule in the `sokuji-ui-decisions-by-rendering` memory: look, then fix, then re-look.

**Tech Stack:** Node 22 (script), JSON, Markdown, headless Chromium (chrome-devtools MCP / Playwright).

**Spec:** `docs/superpowers/specs/2026-08-25-first-run-setup-and-tour-design.md` §4.1, §4.3, §3.2 (locale deletions), §1.9/§2.3 (analytics doc).

**Depends on:** Plans 1–3 complete on this branch. `src/locales/locales.consistency.test.ts` is red on 29 catalogues at the start of this plan; it is green at the end.

## Global Constraints

- **Working directory**: `/home/jiangzhuo/Desktop/kizunaai/sokuji/.claude/worktrees/first-run-setup-and-tour`. Never `cd` elsewhere.
- **Test command**: `npx vitest run -c vitest.worktree.config.ts <paths>`. Never commit the override config.
- **Never `git stash`. Do not `git push`. Do not open a PR.**
- **Language**: English code/comments/commits. Chinese and Japanese only inside the `zh_CN` and `ja` catalogues.
- **The consistency test is the oracle.** `locales.consistency.test.ts:50-59` asserts every non-`en` catalogue has exactly `en`'s flattened key set and preserves every `{{x}}` placeholder verbatim. Green means the sweep is complete; nothing else certifies it.
- **Placeholder policy** (spec §4.1): `en`, `zh_CN`, `ja` authored; the other 27 receive the English text verbatim. The report lists every placeholder key so a translation pass has a worklist.
- **Type-check A/B**: this plan touches no `.ts`/`.tsx` unless the rendering pass finds a defect; if it does, the touched file's error count must not grow.

---

### Task 1: The sweep script

**Files:**
- Create: `scripts/sync-locale-keys.mjs`
- Modify: all 29 `src/locales/<lang>/translation.json` (mechanically) and `src/locales/en/translation.json` (deletions only)

**Interfaces:**
- Produces: `node scripts/sync-locale-keys.mjs --delete userTypeSelection --delete onboarding` — for every non-`en` catalogue: deletes the named top-level keys (the script never edits `en` — its hand formatting must survive, so `en`'s own copies are removed by a targeted edit first, and the script warns if they are still there); adds any key present in `en` but missing there, with `en`'s value; removes any key absent from `en`; preserves the existing key order of the target file and appends new top-level objects in `en`'s position. Prints a per-file summary and a final list of keys that were filled with English.

- [ ] **Step 1: Prove the sweep is needed (the red state)**

Run: `npx vitest run -c vitest.worktree.config.ts src/locales 2>&1 | grep -E "Tests  |✗|×" | head -5`
Expected: `29 failed`.

- [ ] **Step 2: Write the script**

`scripts/sync-locale-keys.mjs`:

```js
#!/usr/bin/env node
// Bring every src/locales/<lang>/translation.json into lockstep with en:
//   - delete the top-level keys named with --delete (from en too)
//   - add keys en has and the catalogue lacks, with en's value (placeholder)
//   - drop keys the catalogue has and en lacks
// Nested objects are merged key by key; the target's existing order is kept and
// new keys are appended where en places them. Idempotent: a second run is a no-op.
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'src', 'locales');
const args = process.argv.slice(2);
const deletions = [];
for (let i = 0; i < args.length; i++) if (args[i] === '--delete') deletions.push(args[++i]);

const read = (lang) => JSON.parse(readFileSync(join(ROOT, lang, 'translation.json'), 'utf8'));
const write = (lang, obj) => writeFileSync(join(ROOT, lang, 'translation.json'), JSON.stringify(obj, null, 2) + '\n');

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Returns [merged, filledKeyPaths]. */
function sync(en, target, prefix = '') {
  const out = {};
  const filled = [];
  // Keep target's order for keys en also has; drop keys en lacks.
  for (const k of Object.keys(target)) {
    if (!(k in en)) continue;
    if (isObj(en[k]) && isObj(target[k])) {
      const [m, f] = sync(en[k], target[k], `${prefix}${k}.`);
      out[k] = m; filled.push(...f);
    } else if (isObj(en[k]) !== isObj(target[k])) {
      out[k] = en[k]; filled.push(...leafPaths(en[k], `${prefix}${k}.`));
    } else {
      out[k] = target[k];
    }
  }
  // Append keys en has and target lacks, in en's order.
  for (const k of Object.keys(en)) {
    if (k in out) continue;
    out[k] = en[k];
    filled.push(...(isObj(en[k]) ? leafPaths(en[k], `${prefix}${k}.`) : [`${prefix}${k}`]));
  }
  return [out, filled];
}

function leafPaths(obj, prefix) {
  return Object.entries(obj).flatMap(([k, v]) => (isObj(v) ? leafPaths(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
}

const en = read('en');
for (const d of deletions) delete en[d];
write('en', en);

const langs = readdirSync(ROOT).filter((d) => statSync(join(ROOT, d)).isDirectory() && d !== 'en');
const allFilled = {};
for (const lang of langs) {
  const target = read(lang);
  for (const d of deletions) delete target[d];
  const [merged, filled] = sync(en, target);
  write(lang, merged);
  allFilled[lang] = filled;
  console.log(`${lang}: +${filled.length} filled from en`);
}
const union = new Set(Object.values(allFilled).flat());
console.log(`\nKeys filled with English in at least one catalogue (${union.size}):`);
for (const k of [...union].sort()) console.log(`  ${k}`);
```

- [ ] **Step 3: Run it**

```bash
node scripts/sync-locale-keys.mjs --delete userTypeSelection --delete onboarding
git diff --stat src/locales | tail -3     # 30 files changed
```
Expected output: every language line reports the same `+N filled` (N = number of leaves under `setup` + `tour` in `en`), and the final list is exactly the `setup.*` and `tour.*` leaves.

- [ ] **Step 4: The oracle**

Run: `npx vitest run -c vitest.worktree.config.ts src/locales`
Expected: **all pass** (29 catalogues in lockstep, placeholders preserved).

Run again: `node scripts/sync-locale-keys.mjs && git status --short src/locales` — Expected: no further changes (idempotent).

- [ ] **Step 5: Confirm nothing reads the deleted namespaces**

```bash
grep -rn "userTypeSelection\.\|'onboarding\.\|\"onboarding\." src --include='*.ts' --include='*.tsx'
```
Expected: nothing. (If `mainPanel.subtitleTakeover` or another key happens to contain the substring, it is a different namespace — read the match.)

- [ ] **Step 6: Commit**

```bash
git add scripts/sync-locale-keys.mjs src/locales
git commit -m "i18n: sync all 30 catalogues — add setup/tour keys, drop the old onboarding namespaces"
```

---

### Task 2: Author `zh_CN` and `ja`

**Files:**
- Modify: `src/locales/zh_CN/translation.json`, `src/locales/ja/translation.json` — the `setup` and `tour` objects only

- [ ] **Step 1: Replace the English placeholders**

The values below are the authored translations. Replace the corresponding leaves in each file (structure is identical to `en`; only values change; keep every `{{placeholder}}`).

`zh_CN` — `setup`:

```json
  "setup": {
    "title": "设置 Sokuji",
    "stepOf": "第 {{current}} 步，共 {{total}} 步",
    "back": "上一步",
    "next": "下一步",
    "finish": "完成",
    "close": "关闭",
    "skipForNow": "先跳过，稍后设置",
    "rerun": "重新运行设置向导",
    "steps": {
      "language": { "title": "Sokuji 用什么语言和你交流？", "desc": "这是菜单和按钮的语言。翻译用的语言稍后再选。", "label": "界面语言" },
      "scenario": { "title": "你想用 Sokuji 做什么？", "desc": "选最接近的一个，之后都可以改。" },
      "path": { "title": "你有什么？" },
      "credentials": { "offlineTitle": "无需填写", "managedTitle": "你的 Kizuna AI 账号", "ownKeyTitle": "你的 API 密钥" },
      "languagePair": { "title": "翻译哪两种语言？", "desc": "你（或对方）说的语言，以及要翻译成的语言。" },
      "finish": { "title": "准备就绪" }
    },
    "scenarios": {
      "sets": "将设置：模式 {{mode}} · {{output}}",
      "understand-others": { "title": "听懂对方", "desc": "在线会议、网课、讲座、视频、直播——实时阅读你听到内容的翻译。" },
      "be-heard": { "title": "让对方在会议里听懂我", "desc": "对方通过虚拟麦克风听到你翻译后的语音。" },
      "subtitle-myself": { "title": "给我的发言配字幕", "desc": "演讲、直播、演示——观众阅读翻译字幕，不生成语音。" },
      "two-way-voice": { "title": "在线双向对话", "desc": "对方听到你的翻译语音，你阅读对方的字幕。" },
      "two-way-text": { "title": "在线双向对话，只要字幕", "desc": "双语字幕、会议记录——双方都以文字呈现，不使用合成语音。" }
    },
    "modes": { "speaker": "我", "participant": "对方", "both": "双向" },
    "output": { "voice": "出声", "subtitles": "字幕" },
    "paths": {
      "recommended": "推荐",
      "pickProvider": "选择哪家服务？",
      "offlineFlavor": "选择哪个引擎？",
      "managed": { "title": "直接开始", "desc": "由 Sokuji 为你运行翻译。", "cost": "需要注册 Kizuna AI 账号（邮箱）并充值；新账号有试用额度。" },
      "own-key": { "title": "我有自己的 API 密钥", "desc": "直接使用 OpenAI、Gemini、Soniox 等服务。", "cost": "按用量向服务商付费。" },
      "offline": {
        "title": "免费离线",
        "desc": "在你自己的电脑上运行，数据不外传。",
        "cost": "需要下载模型到硬盘（数 GB）。有 GPU 和足够显存时运行流畅；仅用 CPU 会明显变慢。",
        "native": "原生引擎——更快，可利用 GPU。",
        "wasm": "内置引擎——到处能用，速度较慢。"
      }
    },
    "fit": { "cannotSpeak": "该服务不能生成语音翻译。", "cannotBeTextOnly": "该服务始终出声，不支持仅字幕。" },
    "credentials": {
      "apiKey": "API 密钥", "endpoint": "接口地址", "endpointPlaceholder": "https://api.example.com/v1",
      "accessKeyId": "Access Key ID", "secretAccessKey": "Secret Access Key", "appId": "App ID", "accessToken": "Access Token", "apiSecret": "API Secret",
      "validate": "校验", "valid": "密钥可用。", "invalid": "密钥被拒绝。",
      "signIn": "登录", "createAccount": "注册账号", "signedIn": "已登录，可以继续。",
      "managedDesc": "登录或注册账号。翻译费用从余额扣除；新账号有试用额度。",
      "offlineNotice": "模型在设置完成后从「设置」里下载，会占用数 GB 硬盘。有 GPU 和足够显存时运行流畅；仅用 CPU 会明显变慢。",
      "pendingKey": "可以稍后在「设置 → Provider」里添加密钥。密钥校验通过前无法开始。",
      "pendingSignIn": "可以稍后从账户按钮登录。登录前无法开始。"
    },
    "languagePair": { "source": "从", "target": "到" },
    "summary": {
      "scenario": "场景", "mode": "模式", "provider": "服务", "languages": "语言",
      "pendingKey": "尚未设置 API 密钥——开始前请在「设置 → Provider」里添加。",
      "pendingSignIn": "尚未登录——开始前请从账户按钮登录。"
    }
  }
```

`zh_CN` — `tour`:

```json
  "tour": {
    "back": "上一步", "next": "下一步", "skip": "跳过", "finish": "完成", "restart": "重新开始引导",
    "steps": {
      "welcome": { "title": "设置完成", "content": "Sokuji 已按你的场景配置好。下面用不到一分钟认一下界面。" },
      "mode-picker": { "title": "翻译模式", "content": "已经为你设好。随时可以切换；切换也会改变翻译是出声还是显示为字幕。" },
      "microphone": { "title": "你的麦克风", "content": "你的声音从这里进来，已选好系统默认设备。不要选 Sokuji 虚拟麦克风——那个是给会议软件用的。" },
      "monitor": { "title": "听一听翻译后的自己", "content": "把翻译语音播放到你自己的耳机，检查效果。不需要可以关掉。" },
      "output-routing": {
        "title": "对方怎么听到你",
        "content": "你的翻译语音会送到一个虚拟麦克风；在会议软件里把它选为麦克风。",
        "content_extension": "在 Google Meet、Zoom 或 Teams 里，把麦克风选为「Sokuji Virtual Microphone」。Sokuji 会自动把它加到支持的会议网站。",
        "content_electronLinux": "Sokuji 已在本机创建了虚拟麦克风。在会议软件里把它选为麦克风。",
        "content_electronOther": "需要一个虚拟声卡（例如 VB-Cable）。把 Sokuji 的输出接到它，再在会议软件里把它选为麦克风。"
      },
      "participant-source": {
        "title": "对方的声音",
        "content": "Sokuji 在这里听对方说话。",
        "content_electron": "选择要翻译的应用，或整个系统音频。对方的原声照常播放。",
        "content_extension": "Sokuji 翻译当前标签页的声音。对方的原声照常播放。"
      },
      "subtitle": { "title": "字幕模式", "content": "打开悬浮字幕——桌面端是一个窗口，扩展里是页面上的覆盖层。OBS 和屏幕共享都能捕获它。" },
      "account": { "title": "你的账户", "content": "余额和充值在这里。", "content_signedOut": "在这里登录。登录后才能开始。" },
      "provider-settings": { "title": "服务设置", "content": "在这里换密钥或换服务。", "content_pending": "把 API 密钥粘贴在这里。校验通过后才能开始。" },
      "models": { "title": "模型", "content": "模型在这里下载，每个阶段一个。多试几个——第一个选择未必最合适。" },
      "start": {
        "title": "开始", "content": "按这里开始翻译。",
        "content_offline": "模型就绪后这里会亮起。",
        "content_signedOut": "登录后这里会亮起。",
        "content_pendingKey": "API 密钥校验通过后这里会亮起。"
      },
      "done": { "title": "就这些", "content": "高级设置——说话检测、提示词、音色、日志——在「设置」顶部的高级模式开关后面。随时可以在「帮助」里重看本引导。" }
    }
  }
```

`ja` — `setup`:

```json
  "setup": {
    "title": "Sokuji のセットアップ",
    "stepOf": "ステップ {{current}} / {{total}}",
    "back": "戻る", "next": "次へ", "finish": "完了", "close": "閉じる",
    "skipForNow": "今はスキップ", "rerun": "セットアップをやり直す",
    "steps": {
      "language": { "title": "Sokuji の表示言語は？", "desc": "メニューやボタンの言語です。翻訳する言語は後で選びます。", "label": "表示言語" },
      "scenario": { "title": "何をしたいですか？", "desc": "いちばん近いものを選んでください。あとから変更できます。" },
      "path": { "title": "お持ちのものは？" },
      "credentials": { "offlineTitle": "入力は不要です", "managedTitle": "Kizuna AI アカウント", "ownKeyTitle": "API キー" },
      "languagePair": { "title": "どの言語を？", "desc": "あなた（または相手）が話す言語と、翻訳先の言語です。" },
      "finish": { "title": "準備完了" }
    },
    "scenarios": {
      "sets": "設定内容：モード {{mode}} · {{output}}",
      "understand-others": { "title": "相手の話を理解する", "desc": "オンライン会議・授業・講演・動画・配信——聞こえる内容の翻訳をリアルタイムで読みます。" },
      "be-heard": { "title": "会議で自分の話を伝える", "desc": "相手には仮想マイク経由で翻訳音声が届きます。" },
      "subtitle-myself": { "title": "自分の話に字幕を付ける", "desc": "講演・配信・プレゼン——視聴者は翻訳字幕を読みます。音声は生成しません。" },
      "two-way-voice": { "title": "オンラインで双方向に会話", "desc": "相手はあなたの翻訳音声を聞き、あなたは相手の字幕を読みます。" },
      "two-way-text": { "title": "オンラインで双方向に会話（字幕のみ）", "desc": "二か国語字幕や議事録——双方ともテキストで、合成音声は使いません。" }
    },
    "modes": { "speaker": "自分", "participant": "相手", "both": "双方向" },
    "output": { "voice": "音声あり", "subtitles": "字幕のみ" },
    "paths": {
      "recommended": "おすすめ",
      "pickProvider": "どのプロバイダーを使いますか？",
      "offlineFlavor": "どのエンジンを使いますか？",
      "managed": { "title": "すぐに始める", "desc": "翻訳は Sokuji 側で実行します。", "cost": "Kizuna AI アカウント（メールアドレス）と残高が必要です。新規アカウントにはお試しクレジットがあります。" },
      "own-key": { "title": "自分の API キーがある", "desc": "OpenAI、Gemini、Soniox などを直接利用します。", "cost": "利用量に応じて各プロバイダーに支払います。" },
      "offline": {
        "title": "無料・オフライン",
        "desc": "お使いのパソコン上で動作し、データは外に出ません。",
        "cost": "モデルをディスクにダウンロードします（数 GB）。GPU と十分な VRAM があれば快適ですが、CPU のみでは明らかに遅くなります。",
        "native": "ネイティブエンジン——高速で、GPU があれば活用します。",
        "wasm": "内蔵エンジン——どこでも動きますが、遅めです。"
      }
    },
    "fit": { "cannotSpeak": "このプロバイダーは音声翻訳を生成できません。", "cannotBeTextOnly": "このプロバイダーは常に音声を出すため、字幕のみでは使えません。" },
    "credentials": {
      "apiKey": "API キー", "endpoint": "エンドポイント URL", "endpointPlaceholder": "https://api.example.com/v1",
      "accessKeyId": "Access Key ID", "secretAccessKey": "Secret Access Key", "appId": "App ID", "accessToken": "Access Token", "apiSecret": "API Secret",
      "validate": "検証", "valid": "キーが受け付けられました。", "invalid": "キーが拒否されました。",
      "signIn": "サインイン", "createAccount": "アカウント作成", "signedIn": "サインイン済みです。続行できます。",
      "managedDesc": "サインインするかアカウントを作成してください。翻訳の費用は残高から引かれます。新規アカウントにはお試しクレジットがあります。",
      "offlineNotice": "モデルはセットアップ後に「設定」からダウンロードします。数 GB のディスク容量が必要です。GPU と十分な VRAM があれば快適ですが、CPU のみでは明らかに遅くなります。",
      "pendingKey": "キーは後で「設定 → プロバイダー」から追加できます。検証が通るまで開始できません。",
      "pendingSignIn": "後でアカウントボタンからサインインできます。それまで開始できません。"
    },
    "languagePair": { "source": "翻訳元", "target": "翻訳先" },
    "summary": {
      "scenario": "シナリオ", "mode": "モード", "provider": "プロバイダー", "languages": "言語",
      "pendingKey": "API キー未設定——開始前に「設定 → プロバイダー」で追加してください。",
      "pendingSignIn": "未サインイン——開始前にアカウントボタンからサインインしてください。"
    }
  }
```

`ja` — `tour`:

```json
  "tour": {
    "back": "戻る", "next": "次へ", "skip": "スキップ", "finish": "完了", "restart": "ガイドをもう一度見る",
    "steps": {
      "welcome": { "title": "セットアップ完了", "content": "Sokuji はあなたのシナリオに合わせて設定されました。1 分足らずで画面を案内します。" },
      "mode-picker": { "title": "翻訳モード", "content": "すでに設定済みです。いつでも切り替えられます。切り替えると、翻訳を音声で出すか字幕で出すかも変わります。" },
      "microphone": { "title": "あなたのマイク", "content": "あなたの声はここから入ります。システム既定のデバイスが選ばれています。Sokuji 仮想マイクは選ばないでください——それは会議アプリ用です。" },
      "monitor": { "title": "翻訳された自分の声を聞く", "content": "翻訳音声を自分のヘッドホンに流して確認できます。不要ならオフにしてください。" },
      "output-routing": {
        "title": "相手にはどう聞こえるか",
        "content": "翻訳音声は仮想マイクに送られます。会議アプリでそれをマイクとして選んでください。",
        "content_extension": "Google Meet、Zoom、Teams で「Sokuji Virtual Microphone」をマイクに選んでください。対応する会議サイトには Sokuji が自動で追加します。",
        "content_electronLinux": "Sokuji がこのシステムに仮想マイクを作成しました。会議アプリでそれをマイクに選んでください。",
        "content_electronOther": "仮想オーディオケーブル（例：VB-Cable）が必要です。Sokuji の出力をそこへ送り、会議アプリでそれをマイクに選んでください。"
      },
      "participant-source": {
        "title": "相手の声",
        "content": "Sokuji はここで相手の声を聞きます。",
        "content_electron": "翻訳するアプリ、またはシステム音声全体を選びます。相手の元の声はそのまま流れます。",
        "content_extension": "現在のタブの音声を翻訳します。相手の元の声はそのまま流れます。"
      },
      "subtitle": { "title": "字幕モード", "content": "フローティング字幕を開きます——デスクトップでは別ウィンドウ、拡張機能ではページ上のオーバーレイです。OBS や画面共有でキャプチャできます。" },
      "account": { "title": "アカウント", "content": "残高とチャージはここです。", "content_signedOut": "ここからサインインします。サインインすると開始できます。" },
      "provider-settings": { "title": "プロバイダー設定", "content": "キーの変更やプロバイダーの切り替えはここです。", "content_pending": "ここに API キーを貼り付けてください。検証が通ると開始できます。" },
      "models": { "title": "モデル", "content": "モデルはここでダウンロードします——段階ごとに 1 つ。いくつか試してみてください。最初の選択が最適とは限りません。" },
      "start": {
        "title": "開始", "content": "ここを押して翻訳を始めます。",
        "content_offline": "モデルの準備ができると点灯します。",
        "content_signedOut": "サインインすると点灯します。",
        "content_pendingKey": "API キーの検証が通ると点灯します。"
      },
      "done": { "title": "以上です", "content": "高度な設定——発話検出、プロンプト、声、ログ——は「設定」上部の詳細モード切り替えの先にあります。このガイドは「ヘルプ」からいつでも見直せます。" }
    }
  }
```

- [ ] **Step 2: Verify** — `npx vitest run -c vitest.worktree.config.ts src/locales` → all pass (placeholders preserved: `{{current}}`, `{{total}}`, `{{mode}}`, `{{output}}`).

- [ ] **Step 3: Commit**

```bash
git add src/locales/zh_CN/translation.json src/locales/ja/translation.json
git commit -m "i18n(zh_CN, ja): translate the setup wizard and tour"
```

---

### Task 3: Docs

**Files:**
- Rewrite: `docs/guides/onboarding-guide.md`
- Modify: `docs/app/app-analytics-events.md` (the "🎯 Onboarding Events" section, lines ~93-156)

- [ ] **Step 1: Rewrite the guide**

Replace `docs/guides/onboarding-guide.md` in full with:

```markdown
# Sokuji First-Run Guide: Setup Wizard and Tour

Design: `docs/superpowers/specs/2026-08-25-first-run-setup-and-tour-design.md`.

## Two surfaces

| Surface | When | What it does | Writes settings? |
|---|---|---|---|
| **Setup wizard** (`src/components/SetupWizard/`) | Once, on a fresh install; again from Help → "Run setup again" | Asks what the user wants to do (five scenarios), what they have (managed account / own API key / free offline), collects credentials or lets the user skip them, picks a language pair, and applies everything on **Finish**. | Yes — once, on Finish (`applySetup.ts`, in the order the spec fixes). |
| **Tour** (`src/components/Tour/`) | Right after the wizard finishes; again from Help → "Restart Setup Guide" | A spotlight walk over the real interface: mode picker, the devices the scenario uses, subtitle mode, the account / provider / models entry for the chosen path, and Start. 5–9 steps. | Never. |

Everyone starts in Basic mode; Advanced stays a setting behind the toggle at the top of Settings. There is no first-launch "Regular / Experienced" choice any more.

## Persistence

- `settings.setup` — `{ version, scenario, providerPath, provider, completedAt, migratedFrom? }` via `SettingsService` (roams with `chrome.storage.sync` in the extension). Its presence is the only thing that decides "the wizard has been done".
- `settings.tour` — `{ version, completedChapters, completedAt, method }`. A `TOUR_VERSION` bump never restarts the tour by itself.
- Users of the pre-wizard app are migrated on first hydration (`src/lib/setup/setupMigration.ts`): a persisted `uiMode` or the old `sokuji_user_type` localStorage key marks them as set up (`migratedFrom: 'legacy'`, `scenario: null`); a completed legacy tour becomes a completed `basics` chapter; the old localStorage keys are removed. They never see the wizard.

## Scenarios (`src/lib/setup/scenarios.ts`)

| Id | Mode | Text-only | Display modes |
|---|---|---|---|
| `understand-others` | Others | forced | participant: translation |
| `be-heard` | Me | off | speaker: both |
| `subtitle-myself` | Me | on | speaker: translation |
| `two-way-voice` | Both | off | both: both |
| `two-way-text` | Both | on | both: both |

A provider is greyed out (with the reason) when its `textOnlyCapability` cannot serve the scenario: `'always'` providers cannot speak (#2, #4); `'never'` providers cannot run subtitles-only (#3, #5).

## Tour catalogue (`src/components/Tour/steps.ts`)

One catalogue; each step carries a `when` predicate over `TourCtx` (mode, textOnly, providerPath, platform, os, sign-in and key state) and optional `copyVariant` for platform- or readiness-specific text. Steps target elements by `data-tour="<anchor>"`; `anchors.test.ts` fails if a catalogue anchor has no element. A step whose anchor does not appear within 1.5 s is skipped (never wedges) and reported as `onboarding_step_skipped`.

To add a step: add the entry to `BASICS_STEPS`, put `data-tour` on the element, add `tour.steps.<id>.{title,content}` to **all 30** catalogues (`node scripts/sync-locale-keys.mjs` fills the 29 with English), and extend `steps.test.ts`.

## Re-entry

Settings → Help: **Run setup again** (overlay wizard, pre-filled, disabled during a session) and **Restart Setup Guide** (tour, built from the live stores).
```

- [ ] **Step 2: Update the analytics doc**

In `docs/app/app-analytics-events.md`, replace the "🎯 Onboarding Events" section (from `### 🎯 Onboarding Events` to just before the next `###`) with:

```markdown
### 🎯 Setup wizard events

#### `setup_started`
**Properties**: `variant` (`'first-run' | 'rerun'`)
**Implementation**: `src/components/SetupWizard/SetupWizard.tsx`

#### `setup_step_viewed`
**Properties**: `step` (number, 0-based), `step_id` (`language | scenario | path | credentials | language-pair | finish`)

#### `setup_abandoned`
**Properties**: `step` (number) — fired when the re-run overlay is closed before Finish (best effort; a first-run wizard cannot be abandoned except by quitting).

#### `setup_completed`
**Properties**: `scenario`, `provider_path`, `provider`, `source_language`, `target_language` (strings), `credentials_pending` (boolean — "Skip for now" was taken)

### 🎯 Tour events

#### `onboarding_started`
**Properties**: `chapter` (`'basics'`), `is_first_time_user` (boolean — false for migrated users), `onboarding_version` (number, `TOUR_VERSION`)
**Implementation**: `src/components/Tour/TourProvider.tsx`

#### `onboarding_step_viewed`
**Properties**: `chapter`, `step_index` (number, 0-based within the visible list), `step_id` (catalogue id)

#### `onboarding_step_skipped`
**Properties**: `chapter`, `step_id`, `reason` (`'target-missing'`)

#### `onboarding_completed`
**Properties**: `chapter`, `completion_method` (`'finished' | 'skipped'`), `steps_completed`, `total_steps`, `duration_ms`, `onboarding_version`

Retired: `user_type_selected`, `user_type_applied` (the first-launch user-type screen no longer exists).
```

Also search the doc for `user_type_selected` / `user_type_applied` sections elsewhere and delete them.

- [ ] **Step 3: Commit**

```bash
git add docs/guides/onboarding-guide.md docs/app/app-analytics-events.md
git commit -m "docs: describe the setup wizard and tour; update analytics events"
```

---

### Task 4: Rendering pass

Per the house rule (`sokuji-ui-decisions-by-rendering` memory): decisions about copy length, card layout and spotlight behaviour are made by looking, not arguing. This task produces screenshots and fixes; it may touch `SetupWizard.scss`, `Tour.scss`, the `en` (and, for changed sentences, `zh_CN`/`ja`) catalogues **and** the components' default strings together.

- [ ] **Step 1: Electron renderer, fresh profile**

Start `npm run dev` from the worktree; open `http://localhost:5173` in headless Chromium (chrome-devtools MCP `new_page` / `navigate_page`, or Playwright). Clear `localStorage` (`evaluate_script`: `localStorage.clear()`), reload. Walk:
1. Wizard, managed path, scenario #4 (two-way-voice) → Finish → tour (9 steps). Screenshot every wizard step and every tour step at 1200×800 and at 420×800.
2. Wizard, own-key path with OpenAI, "Skip for now", scenario #1 → Finish → tour; confirm the pending copy on `provider-settings` and `start`.
3. Wizard, offline path, scenario #2 → tour; confirm `models` step opens the provider section and highlights the chip row.
4. Help → Run setup again (overlay over the running app; close with Escape and with ×). Help → Restart Setup Guide.

- [ ] **Step 2: Extension surface**

Build the extension (`npm run extension:build`) and load `extension/dist` (or the build output directory `manifest.json` points at) as an unpacked extension in headless Chromium with `--load-extension`; open the side panel page (`fullpage.html`) at 360×800. Repeat walk 1 and confirm the `output-routing` and `participant-source` copy shows the **extension** variants.

- [ ] **Step 3: Longest and RTL locales**

Set the interface language to `ja` (step 0 of the wizard) and to `ar`; screenshot the scenario and path steps. Cards must not overflow; the RTL direction must not break the step footer's Back/Next order (they should mirror).

- [ ] **Step 4: What to look at, specifically** (from spec §4.3)

- The three path cards' cost sentences at 360px: fully visible, no clipping.
- The spotlight over `participant-section` after the settings panel scrolls to it: cutout follows, popover stays on screen.
- The centred `output-routing` card: readable, buttons reachable.
- Focus: lands in the popover on each step; returns to the opener after Finish.
- Wizard `ja`: card titles wrap to at most two lines.

- [ ] **Step 5: Fix, re-render, commit**

Every fix is a normal commit (`fix(setup): …` / `fix(tour): …`). If a sentence changes in `en`, change the component default too (the tests read defaults) and re-author it in `zh_CN`/`ja`; the other 27 keep English via the sync script (`node scripts/sync-locale-keys.mjs` is a no-op for value changes — edit the 27 only if the *key* changed).

Save screenshots under `/home/jiangzhuo/.claude/jobs/fc13055c/tmp/render/` (not in the repo) and list their paths in the report.

---

### Task 5: Final verification

- [ ] **Step 1: The full suite, judged against the floor**

```bash
npx vitest run -c vitest.worktree.config.ts 2>&1 | grep -E "Test Files|Tests  |Errors|FAIL"
```
Expected: no `FAIL`; `Errors  4 errors` (nativeGate). Record the file/test counts.

- [ ] **Step 2: Repo-wide type-check** — `npx tsc --noEmit 2>&1 | grep -cE "error TS"` ≤ 329 (the Plan 1 baseline; deletions should have lowered it).

- [ ] **Step 3: Clean tree and branch summary**

```bash
git status --short          # empty (vitest.worktree.config.ts is excluded)
git log --oneline 7a259f20..HEAD
```

- [ ] **Step 4: Report** — counts, the commit table across all four plans, the placeholder-key worklist from Task 1, screenshot paths, and the three or four non-obvious findings from executing the whole feature. Do **not** push or open a PR; jiangzhuo triggers both.
