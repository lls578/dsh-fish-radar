/**
 * 真实数据演示：node scripts/demo.mjs BV1HrJb6iEQk BV16CnZ6DEyc
 * 输出两个视频的鱼群雷达报告（打分 + 指标 + 证据）。
 */
import { collectVideo, loadCookie, defaultCredentialPath } from "../lib/bili.mjs";
import { analyzeComments } from "../lib/fish.mjs";

const bvids = process.argv.slice(2);
if (!bvids.length) {
  console.log("用法：node scripts/demo.mjs <BV号> [BV号2 ...]");
  process.exit(0);
}
const cookie = loadCookie(defaultCredentialPath());

for (const bvid of bvids) {
  try {
    const { info, comments } = await collectVideo(bvid, { pages: 3, cookie });
    const r = analyzeComments(comments.slice(0, 80), { play: info.play });
    console.log("\n====", bvid, "|", info.title);
    console.log(
      `播放 ${info.play} ｜ 评论样本 ${r.total} ｜ 鱼浓度 ${r.fish_score}（${r.level}）`,
    );
    console.log("指标:", JSON.stringify(r.metrics));
    for (const e of r.evidence || []) console.log("  证据:", e.reasons.join("/"), "|", e.excerpt);
    console.log("建议:", r.advice);
  } catch (e) {
    console.log(bvid, "失败:", e.message);
  }
}
