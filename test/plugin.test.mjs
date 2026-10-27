/**
 * 插件级测试：模拟 Cordis 上下文 + 鱼群分析纯函数（不联网）。
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { apply } from "../index.js";
import { analyzeComments, jaccard, maskText, trigrams } from "../lib/fish.mjs";
import { checkClaims } from "../lib/claims.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// ── 纯函数测试 ─────────────────────────────────────────────
const fishComments = [
  { content: "@小明 这条值得看：插件只读字幕，评论区前排当事实抄，几百条鱼一起传同一个假 bug。", like: 1 },
  { content: "@小红 这条值得看：插件只读字幕，评论区前排当事实抄，几百条鱼一起传同一个假 bug。", like: 1 },
  { content: "@阿伟 这条值得看：插件只读字幕，评论区前排当事实抄，几百条鱼一起传同一个假 bug。", like: 1 },
  { content: "@小李 这条值得看：插件只读字幕，评论区前排当事实抄，几百条鱼一起传同一个假 bug。", like: 1 },
  { content: "本鱼来交作业了，主人这条值得看：五个工具全注册，写操作默认关闭。", like: 1 },
  { content: "太长不看，直接说结论。", like: 3 },
];
const fishResult = analyzeComments(fishComments, { play: 2507 });
if (!fishResult.ok) throw new Error("analyze failed");
if (fishResult.fish_score < 55) throw new Error("fish score too low: " + fishResult.fish_score);
if (!["高", "中"].includes(fishResult.level)) throw new Error("level wrong: " + fishResult.level);
console.log("[test] fish sample score:", fishResult.fish_score, fishResult.level);

const normalComments = [
  { content: "这期讲得挺细，那个账本机制我踩过坑。", like: 12 },
  { content: "UP 能不能出一期安装教程？", like: 3 },
  { content: "笑死，这也能翻车", like: 30 },
  { content: "收藏了，周末试试", like: 5 },
  { content: "求插件名字", like: 2 },
  { content: "第一次见这种分支，代码在哪个仓库？", like: 8 },
];
const normalResult = analyzeComments(normalComments, { play: 2507 });
if (normalResult.fish_score >= fishResult.fish_score) throw new Error("normal should be lower than fish");
if (normalResult.level !== "低" && normalResult.level !== "中") throw new Error("normal level wrong: " + normalResult.level);
console.log("[test] normal sample score:", normalResult.fish_score, normalResult.level);

// 相似度 / 匿名
const a = trigrams("插件只读字幕，评论区前排当事实抄");
const b = trigrams("插件只读字幕，评论区前排当事实抄");
if (jaccard(a, b) !== 1) throw new Error("jaccard same text should be 1");
const masked = maskText("@张三 你好 @李四");
if (masked.includes("张三") || masked.includes("李四")) throw new Error("mask leaked name: " + masked);
const tiny = analyzeComments([{ content: "就一条评论", like: 1 }], { play: 100 });
if (tiny.level !== "样本不足" || tiny.fish_score !== null) throw new Error("low sample guard failed: " + JSON.stringify(tiny));
console.log("[test] low sample guard ok");

console.log("[test] jaccard/mask ok");

// ── 插件注册测试 ───────────────────────────────────────────
const tools = [];
const ctx = { tools: { register: (t) => (tools.push(t), t) }, logger: { info() {}, warn() {} } };
apply(ctx, { credentialPath: join(HERE, "no-such-credential.json"), pages: 1, maxComments: 20 });

const names = tools.map((t) => t.name).sort();
if (JSON.stringify(names) !== JSON.stringify(["fish_claim_check", "fish_compare", "fish_rules", "fish_scan"])) {
  throw new Error("tools wrong: " + names.join(","));
}
for (const t of tools) {
  if (!t.parameters || t.parameters.type !== "object") throw new Error("bad schema: " + t.name);
}
console.log("[test] tools:", names.join(", "));

const rules = await tools.find((t) => t.name === "fish_rules").execute({});
if (!rules.ok || !rules.weights) throw new Error("fish_rules failed");
console.log("[test] fish_rules ok");

// 传闻核查：字幕没讲的技术点应被标成「字幕未提及」
const claimResult = checkClaims(
  [
    { content: "@小明 评论区提醒它和原版共用判重表且没加原子锁，两版别同时开。", like: 30 },
    { content: "这期封面真好看", like: 5 },
  ],
  "这期讲分支版新增的功能：人设和回复提示词搬进面板，入口挪到右栏，写操作加了原子锁，与源仓库隔离。",
);
if (!claimResult.ok) throw new Error("claim check failed: " + JSON.stringify(claimResult));
if (!claimResult.claims.length) throw new Error("no claims extracted");
console.log("[test] claim_check ok:", claimResult.claims[0].support, "|", claimResult.verdict.slice(0, 40));

console.log("[test] ✅ all passed");
