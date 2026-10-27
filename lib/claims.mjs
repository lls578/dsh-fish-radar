/**
 * 传闻核查：把热评里的「技术断言」拿去和字幕比对——
 * 字幕里没讲的技术点，就是「无法证实」的传闻。
 *
 * 这是鱼群雷达抓出的核心机制：鱼只读字幕，字幕没讲的细节，
 * 它们会从前排热评里补——补来的东西没有根据。
 */

const TECH_WORDS =
  /(判重|原子锁|共用|冲突|bug|报错|版本|账本|安装|卸载|权限|接口|设置|删除|丢失|数据|插件|字幕|转写|评论|弹幕|锁|token|缓存|上下文)/;

// 强技术词：必须命中至少一个才算"技术断言"（过滤「评论区好多鱼」这类闲聊）
const STRONG_TECH =
  /(判重|原子锁|并发|冲突|覆盖|隔离|报错|bug|崩溃|丢失|删库|安装失败|权限|版本号|回滚|缓存命中|加锁|锁表|账本)/i;

// 情绪/玩梗类，直接排除
const NOISE = /(哈哈|笑死|起飞|好鱼|牛逼|太强|沙发|前排|可爱|好玩|谁用谁知道|笑不活|绷不住)/;

// 强技术词表：用于"字幕到底讲没讲这个点"的命中判断
const STRONG_TERMS = [
  "原子锁", "判重表", "判重", "并发", "冲突", "覆盖", "隔离", "报错", "bug",
  "崩溃", "丢失", "删库", "安装", "卸载", "权限", "版本", "回滚", "缓存",
  "上下文", "token", "转写", "提示词", "人设", "账本",
];

const STOP_BIGRAMS = new Set([
  "这个", "那个", "就是", "的是", "不是", "可以", "一个", "没有", "什么", "自己",
  "因为", "所以", "但是", "如果", "已经", "还是", "而且", "然后", "这种", "这样",
  "真的", "其实", "感觉", "觉得", "有点", "比较", "非常", "特别", "直接", "确实",
]);

export function bigrams(text) {
  const s = String(text ?? "").replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "");
  const set = new Set();
  for (let i = 0; i + 2 <= s.length; i++) {
    const g = s.slice(i, i + 2);
    if (!STOP_BIGRAMS.has(g)) set.add(g);
  }
  return set;
}

export function splitSentences(text) {
  return String(text ?? "")
    .split(/[。！？!?；;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8);
}

function mask(text) {
  return String(text ?? "").replace(/@[^\s@]{1,20}/g, "@***").replace(/\s+/g, " ").trim();
}

/**
 * @param {Array<{content:string, like?:number}>} hotComments
 * @param {string} subtitleText
 * @param {{maxClaims?:number}} [opts]
 */
export function checkClaims(hotComments, subtitleText, opts = {}) {
  const subtitle = String(subtitleText ?? "");
  if (!subtitle.trim()) {
    return { ok: false, error: "没有字幕，无法核查（这条视频没有字幕/没有语音）" };
  }
  const subGrams = bigrams(subtitle);
  const claims = [];

  for (const c of hotComments || []) {
    for (const sent of splitSentences(c.content)) {
      if (!TECH_WORDS.test(sent)) continue;
      if (NOISE.test(sent)) continue;
      // 高精度：必须命中强技术词；否则至少要同时出现 2 个普通技术词
      const techHits = (sent.match(new RegExp(TECH_WORDS.source, "g")) || []).length;
      if (!STRONG_TECH.test(sent) && techHits < 2) continue;
      const grams = bigrams(sent);
      if (grams.size < 3) continue;
      let hit = 0;
      for (const g of grams) if (subGrams.has(g)) hit++;
      const ratio = hit / grams.size;

      // 以「强技术词」是否在字幕里出现过来判断字幕讲没讲这个点
      const terms = STRONG_TERMS.filter((t) => sent.includes(t));
      const hitTerms = terms.filter((t) => subtitle.includes(t));
      let support;
      if (terms.length === 0) {
        support = ratio >= 0.4 ? "字幕提及" : "字幕未提及";
      } else if (hitTerms.length === terms.length) {
        support = "字幕提及";
      } else if (hitTerms.length > 0) {
        support = "字幕部分提及";
      } else {
        support = "字幕未提及";
      }
      if (support === "字幕提及" && terms.length > 0) continue; // 字幕讲过了，不算传闻
      claims.push({
        claim: mask(sent).slice(0, 90),
        from_like: c.like ?? 0,
        overlap: Number(ratio.toFixed(2)),
        support,
        terms,
        hit_terms: hitTerms,
      });
    }
  }

  claims.sort((a, b) => b.from_like - a.from_like || a.overlap - b.overlap);
  const top = claims.slice(0, Math.max(1, Math.min(12, opts.maxClaims ?? 8)));
  const unverified = top.filter((x) => x.support === "字幕未提及").length;
  return {
    ok: true,
    subtitle_chars: subtitle.length,
    claims_checked: claims.length,
    unverified,
    claims: top,
    verdict:
      unverified > 0
        ? `有 ${unverified} 条热评技术断言在字幕里找不到依据——这类"评论区补充"很可能就是以讹传讹的来源。`
        : "热评里的技术断言基本都能在字幕里找到依据（或没有明显技术断言）。",
  };
}
