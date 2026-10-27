# dsh-fish-radar

![ci](https://github.com/lls578/dsh-fish-radar/actions/workflows/ci.yml/badge.svg) ![license](https://img.shields.io/badge/license-MIT-green)

DSH（DeepSeek Harness）插件：**鱼群雷达**。给一个 B站 视频做评论区「AI 鱼浓度」体检——只读、本地计算、0–100 分。

> 背景：DSH 刷B站插件火起来之后，很多视频评论区被 AI「大肥鱼」评论淹没（模板化、@主人、互相抄摘要）。这个插件不是骂鱼，而是给创作者一个**自查工具**：我的评论区被鱼攻占了吗？有多严重？

## 工具

| 工具 | 作用 |
|---|---|
| `fish_scan(bvid)` | 单视频体检：拉最新 + 热门评论，输出鱼浓度评分、指标、匿名证据、建议 |
| `fish_compare(bvid_a, bvid_b)` | 两个视频对比：谁更像鱼灾区、差多少分 |
| `fish_claim_check(bvid)` | **传闻核查**：热评里的技术断言（判重/原子锁/版本/bug…）拿去和字幕比对，字幕没讲的标「字幕未提及」 |
| `fish_rules()` | 评分规则说明（对用户解释结果时用） |

## 评分怎么算

| 指标 | 权重 | 含义 |
|---|---|---|
| `mention_ratio` | 30（另：@主人比例 ≥0.7 额外 +10） | 评论里出现 `@昵称` 的比例 |
| `keyword_ratio` | 15 | 命中「本鱼 / 主人 / 鲸鱼娘 / 大肥鱼 / 刷B站 / 鱼饵 / 总结 / 值得」等词的比例 |
| `template_ratio` | 30 | 最大「模板相似簇」占比（去 @/表情/标点后，两两字符 3-gram 相似度 ≥ 0.35 算同模板） |
| `reply_score` | 15 | 评论/播放比（开根号归一，防刷屏） |
| `long_ratio` | 10 | 长评论（≥60 字）比例 |

- **≥55 分**：高，评论区大概率被鱼攻占
- **30–54 分**：中，有鱼混入
- **<30 分**：低
- **样本 <5 条**：样本不足，不下结论

> 启发式估计，不是判定；样本 <10 条时仅供参考。

## 示例输出

```json
{
  "video": { "bvid": "BV1HrJb6iEQk", "play": 4257, "reply": 911 },
  "analyzed": 80,
  "fish_score": 82,
  "level": "高",
  "metrics": { "mention_ratio": 0.71, "template_ratio": 0.55, "reply_ratio": 0.21 },
  "evidence": [{ "excerpt": "@*** 刷B站插件的这个分支挺对症……", "reasons": ["@提及", "鱼关键词", "模板相似(9条同簇)"] }],
  "advice": "评论区大概率被 AI 鱼攻占……"
}
```

## 传闻核查怎么判断

1. 从热评里切出「技术断言」句子（必须命中强技术词：判重 / 原子锁 / 并发 / 隔离 / 报错 / 崩溃 / 版本 / 权限…）
2. 每一句提取其中的强技术词，去字幕原文里找：
   - 全部命中 → **字幕提及**（不算传闻，跳过）
   - 部分命中 → **字幕部分提及**
   - 都没命中 → **字幕未提及**（可能以讹传讹）
3. 输出按点赞排序的断言清单 + 「未证实」数量

> 这正好对应「鱼灾」的机制：鱼只读字幕，字幕没讲的细节会从前排热评补——补来的东西没有根据。

## 隐私

- 只读公开数据（视频信息 + 评论），**不写任何东西**
- 证据样例里的 `@昵称` 会替换成 `@***`，报告里不出现用户 ID
- 可选本地 cookie（默认 `~/.dsh/bili-main/credentials.json`），只用于请求、不写日志


## 视频介绍

- B站：<https://www.bilibili.com/video/BV1DdxT6MEa7>（「拒绝废话：给B站评论区装个鱼群雷达」）


## 安装

```powershell
# 本地
dsh plugin --profile desktop add link:C:\path\to\dsh-fish-radar

# GitHub / npm
dsh plugin --profile desktop add https://github.com/<you>/dsh-fish-radar/archive/refs/heads/main.tar.gz
```

装完重启 DSH。

## 开发

```powershell
node test/plugin.test.mjs        # 单元测试（不联网）
node scripts/demo.mjs BV1HrJb6iEQk BV16CnZ6DEyc   # 真实数据演示（联网）
```

## License

MIT
