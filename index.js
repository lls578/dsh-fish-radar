/**
 * dsh-fish-radar —— 「鱼群雷达」DSH 插件
 * 输入一个视频，体检评论区的 AI 鱼浓度：评论/播放比、@主人比例、模板化相似度、关键词命中。
 * 只读公开数据，不写任何东西。
 */
import { defaultCredentialPath, loadCookie, collectVideo, getComments, getVideoInfo, getSubtitleText } from "./lib/bili.mjs";
import { checkClaims } from "./lib/claims.mjs";
import { analyzeComments } from "./lib/fish.mjs";

let defineTool = null;
let z = null;
try {
  const dt = await import("@deepseek-ai/dsh-tools");
  defineTool = dt.defineTool;
} catch {
  /* 用本地等价实现 */
}
try {
  const sm = await import("@deepseek-ai/schemastery");
  z = sm.default;
} catch {
  /* 没有 Config 也能跑 */
}

function compileParameters(spec) {
  const properties = {};
  const required = [];
  for (const [key, def] of Object.entries(spec || {})) {
    if (!def || typeof def !== "object") continue;
    if (def.required === true) required.push(key);
    const { required: _omit, ...rest } = def;
    properties[key] = rest;
  }
  const schema = { type: "object", properties };
  if (required.length) schema.required = required;
  return schema;
}
if (!defineTool) defineTool = (options) => ({ ...options, parameters: compileParameters(options.parameters) });

function cfgGet(config, key, fallback) {
  const v = config ? config[key] : undefined;
  if (v && typeof v === "object") {
    if (typeof v.get === "function") {
      try {
        const got = v.get();
        return got === undefined || got === null ? fallback : got;
      } catch {
        return fallback;
      }
    }
    return fallback;
  }
  return v === undefined || v === null ? fallback : v;
}

function safe(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return { ok: false, error: "输出无法序列化" };
  }
}

const TEXT_OUTPUT = {
  schema: { type: "object", properties: {}, additionalProperties: true },
  render: (_args, value) => [
    { type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) },
  ],
};

export const name = "fish-radar";
export const inject = ["tools"];

export const Config = !z
  ? undefined
  : z.object({
      credentialPath: z.string().default("").description("可选：B站 cookie 文件路径（空=默认主号凭据）").extra("volatile", true),
      pages: z.natural().default(3).description("拉取最新评论的页数（每页 20 条）").extra("volatile", true),
      maxComments: z.natural().default(80).description("最多分析多少条评论").extra("volatile", true),
    });

async function scan(bvid, opts) {
  const { info, comments } = await collectVideo(bvid, opts);
  const trimmed = comments.slice(0, opts.maxComments);
  const analysis = analyzeComments(trimmed, { play: info.play });
  return {
    ok: true,
    video: info,
    analyzed: trimmed.length,
    fish_score: analysis.fish_score,
    level: analysis.level,
    metrics: analysis.metrics,
    evidence: analysis.evidence,
    advice: analysis.advice,
  };
}

export function apply(ctx, config) {
  const credPath = cfgGet(config, "credentialPath", "") || defaultCredentialPath();
  const pages = Math.max(1, Math.min(10, Number(cfgGet(config, "pages", 3)) || 3));
  const maxComments = Math.max(20, Math.min(300, Number(cfgGet(config, "maxComments", 80)) || 80));
  const cookie = loadCookie(credPath);

  const tool = (spec) =>
    ctx.tools.register(
      defineTool({
        name: spec.name,
        description: spec.description,
        parameters: spec.parameters || {},
        output: TEXT_OUTPUT,
        async execute(args) {
          try {
            return safe(await spec.execute(args || {}));
          } catch (e) {
            return { ok: false, error: String(e?.message || e) };
          }
        },
      }),
    );

  tool({
    name: "fish_scan",
    description:
      "给一个 B站视频做「鱼群雷达」体检：拉最新+热门评论，算 AI 鱼浓度（评论/播放比、@主人比例、" +
      "模板化相似度、鱼关键词命中），返回 0-100 分、等级、证据样例（已匿名）和建议。只读、不改任何东西。",
    parameters: {
      bvid: { type: "string", description: "视频 BV 号，例如 BV1HrJb6iEQk", required: true },
    },
    execute: ({ bvid }) => scan(String(bvid || "").trim(), { pages, cookie, maxComments }),
  });

  tool({
    name: "fish_compare",
    description: "对比两个视频的评论区鱼浓度（各自评分 + 谁更像鱼灾区 + 差异原因）。",
    parameters: {
      bvid_a: { type: "string", description: "视频 A 的 BV 号", required: true },
      bvid_b: { type: "string", description: "视频 B 的 BV 号", required: true },
    },
    execute: async ({ bvid_a, bvid_b }) => {
      const a = await scan(String(bvid_a || "").trim(), { pages, cookie, maxComments });
      const b = await scan(String(bvid_b || "").trim(), { pages, cookie, maxComments });
      const delta = (a.fish_score ?? 0) - (b.fish_score ?? 0);
      return {
        ok: true,
        a: { bvid: a.video?.bvid, title: a.video?.title, score: a.fish_score, level: a.level, metrics: a.metrics },
        b: { bvid: b.video?.bvid, title: b.video?.title, score: b.fish_score, level: b.level, metrics: b.metrics },
        verdict:
          Math.abs(delta) < 10
            ? "两边鱼浓度差不多。"
            : delta > 0
              ? `A（${a.video?.bvid}）鱼浓度更高，高 ${Math.abs(delta)} 分。`
              : `B（${b.video?.bvid}）鱼浓度更高，高 ${Math.abs(delta)} 分。`,
      };
    },
  });

  tool({
    name: "fish_claim_check",
    description:
      "传闻核查：把视频的热评技术断言（判重/原子锁/版本/bug 等）拿去和字幕比对——" +
      "字幕里没讲的技术点会被标成「字幕未提及」。用来查评论区有没有以讹传讹。",
    parameters: {
      bvid: { type: "string", description: "视频 BV 号", required: true },
    },
    execute: async ({ bvid }) => {
      const info = await getVideoInfo(String(bvid || "").trim());
      const hot = await getComments(info.aid, { pages: 2, sort: 1, cookie });
      // 直接查 cid
      const q = new URLSearchParams({ bvid: info.bvid });
      const res = await fetch(`https://api.bilibili.com/x/web-interface/view?${q}`, {
        headers: { "User-Agent": "Mozilla/5.0", Referer: "https://www.bilibili.com/", ...(cookie ? { Cookie: cookie } : {}) },
      });
      const dj = await res.json();
      const cid = dj?.data?.cid;
      const subtitle = await getSubtitleText(info.aid, cid, cookie);
      const result = checkClaims(hot, subtitle, { maxClaims: 8 });
      return { ...result, video: info, hot_replies: hot.length };
    },
  });

  tool({
    name: "fish_rules",
    description: "说明「鱼群雷达」的评分规则和各项指标含义（给用户解释结果时用）。",
    parameters: {},
    execute: () => ({
      ok: true,
      weights: {
        mention_ratio: "评论里出现 @昵称 的比例 × 30 分",
        keyword_ratio: "命中「本鱼/主人/鲸鱼娘/大肥鱼/刷B站/鱼饵/总结/值得」等词的比例 × 20 分",
        template_ratio: "最大「模板相似簇」占全部评论的比例（两两相似度≥0.45 算同簇）× 30 分",
        reply_score: "评论/播放比（开根号归一）× 最多 15 分",
        long_ratio: "长评论（≥60 字）比例 × 5 分",
      },
      levels: { 高: "≥65 分", 中: "35-64 分", 低: "<35 分" },
      note: "分数是启发式估计，不是判定；样本量小时（<10 条）仅供参考。",
    }),
  });

  ctx.logger?.info?.(`[fish-radar] 已加载（${cookie ? "带 cookie" : "匿名"}）`);
}
