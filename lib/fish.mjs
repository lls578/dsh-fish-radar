/**
 * 鱼群雷达核心：评论特征分析（纯函数，可单测）。
 *
 * 思路：AI 鱼评论有几个明显特征——
 *  1) 大量 @主人
 *  2) 高频出现「本鱼 / 主人 / 鲸鱼娘 / 大肥鱼 / 刷B站 / 鱼饵」等词
 *  3) 模板化：互相之间高度相似（同一个摘要的排列组合）
 *  4) 评论 / 播放比异常高
 */

const FISH_WORDS = /(本鱼|主人|鲸鱼娘|大肥鱼|刷B站|鱼饵|DSH|插件|总结|值得|干货|收藏|省流|评测|实测)/;

/** 去掉 @ 昵称，避免把别人 ID 写进报告。 */
export function maskText(text) {
  return String(text ?? "")
    .replace(/@[^\s@]{1,20}/g, "@***")
    .replace(/\s+/g, " ")
    .trim();
}

/** 评论骨架：去掉 @昵称、表情、标点，只留中文/字母/数字（用于模板相似度）。 */
export function skeleton(text) {
  return String(text ?? "")
    .replace(/@[^\s@]{1,20}/g, "")
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "");
}

/** 字符 3-gram 集合（中文不需要分词）。 */
export function trigrams(text) {
  const s = skeleton(text);
  const set = new Set();
  for (let i = 0; i + 3 <= s.length; i++) set.add(s.slice(i, i + 3));
  return set;
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function clamp(v, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * @param {Array<{rpid?:number, content:string, like?:number}>} comments
 * @param {{play?:number}} meta
 */
export function analyzeComments(comments, meta = {}) {
  const list = (comments || []).filter((c) => c && c.content);
  const total = list.length;
  if (total === 0) {
    return { ok: false, error: "没有评论可分析" };
  }
  const lowSample = total < 5;

  const texts = list.map((c) => c.content);
  const grams = texts.map(trigrams);

  let mention = 0;
  let keyword = 0;
  let long = 0;
  for (const t of texts) {
    if (/@[^\s@]{1,20}/.test(t)) mention++;
    if (FISH_WORDS.test(t)) keyword++;
    if (t.length >= 60) long++;
  }

  // 模板化：两两骨架相似度 >= 0.35 视为"同一个模板"
  const SIM = 0.35;
  const n = total;
  const adj = Array.from({ length: n }, () => []);
  let similarPairs = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (jaccard(grams[i], grams[j]) >= SIM) {
        similarPairs++;
        adj[i].push(j);
        adj[j].push(i);
      }
    }
  }
  // 有相似评论的比例（比"最大簇"更能反映整体模板化程度）
  const dupCount = adj.filter((a) => a.length > 0).length;
  // 最大"模板簇"占比
  const seen = new Array(n).fill(false);
  let biggest = 1;
  for (let i = 0; i < n; i++) {
    if (seen[i]) continue;
    const stack = [i];
    seen[i] = true;
    let size = 0;
    while (stack.length) {
      const u = stack.pop();
      size++;
      for (const v of adj[u]) if (!seen[v]) { seen[v] = true; stack.push(v); }
    }
    if (size > biggest) biggest = size;
  }

  const mentionRatio = mention / total;
  const keywordRatio = keyword / total;
  const templateRatio = Math.max(biggest / total, dupCount / total);
  const pairRatio = (2 * similarPairs) / Math.max(1, n * (n - 1));
  const longRatio = long / total;
  const play = Number(meta.play) || 0;
  const replyRatio = play > 0 ? total / play : 0;
  const replyScore = clamp(Math.sqrt(replyRatio / 0.08) * 15, 0, 15);

  // @主人比例本身就是最强信号：大量 @主人 基本只有 AI 鱼会做
  const mentionBonus = mentionRatio >= 0.7 ? 10 : mentionRatio >= 0.5 ? 5 : 0;
  const score = Math.round(
    clamp(
      mentionRatio * 30 + keywordRatio * 15 + templateRatio * 30 + replyScore + longRatio * 10 + mentionBonus,
    ),
  );

  const level = lowSample ? "样本不足" : score >= 55 ? "高" : score >= 30 ? "中" : "低";

  // 每条评论的"鱼味"，取前 5 条当证据
  const perComment = texts.map((t, i) => {
    const sim = adj[i].length > 0 ? 1 : 0;
    let s = 0;
    if (/@[^\s@]{1,20}/.test(t)) s += 2;
    if (FISH_WORDS.test(t)) s += 1;
    if (sim) s += 2;
    if (t.length >= 60) s += 1;
    return { i, s };
  });
  perComment.sort((a, b) => b.s - a.s || b.i - a.i);
  const evidence = perComment
    .filter((x) => x.s >= 3)
    .slice(0, 5)
    .map((x) => ({
      excerpt: maskText(texts[x.i]).slice(0, 70),
      reasons: [
        /@[^\s@]{1,20}/.test(texts[x.i]) ? "@提及" : "",
        FISH_WORDS.test(texts[x.i]) ? "鱼关键词" : "",
        adj[x.i].length > 0 ? `模板相似(${adj[x.i].length + 1}条同簇)` : "",
        texts[x.i].length >= 60 ? "长总结" : "",
      ].filter(Boolean),
    }));

  const advice =
    level === "高"
      ? "评论区大概率被 AI 鱼攻占：模板化评论占比很高。建议开评论精选 / 提升评论门槛 / 关注真实互动。"
      : level === "中"
        ? "有 AI 鱼混入，但还没淹掉评论区。可以观察几天，必要时开评论精选。"
        : "评论区看起来比较正常（或样本太少）。";

  if (lowSample) {
    return {
      ok: true,
      total,
      low_sample: true,
      fish_score: null,
      level: "样本不足",
      metrics: {
        mention_ratio: Number(mentionRatio.toFixed(3)),
        keyword_ratio: Number(keywordRatio.toFixed(3)),
        template_ratio: Number(templateRatio.toFixed(3)),
        play: Number(meta.play) || 0,
      },
      evidence: [],
      advice: `只有 ${total} 条评论，样本太少，不下结论（至少 5 条才有参考意义）。`,
    };
  }

  return {
    ok: true,
    total,
    metrics: {
      mention_ratio: Number(mentionRatio.toFixed(3)),
      keyword_ratio: Number(keywordRatio.toFixed(3)),
      template_ratio: Number(templateRatio.toFixed(3)),
      similar_pairs: similarPairs,
      pair_ratio: Number(pairRatio.toFixed(3)),
      long_ratio: Number(longRatio.toFixed(3)),
      reply_ratio: Number(replyRatio.toFixed(4)),
      play,
    },
    fish_score: score,
    level,
    evidence,
    advice,
  };
}
