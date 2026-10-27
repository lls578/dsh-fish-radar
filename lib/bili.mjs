/**
 * B站 只读接口（公开数据 + 可选本地 cookie）。只用原生 fetch，无第三方依赖。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export function defaultCredentialPath() {
  return join(process.env.USERPROFILE || homedir(), ".dsh", "bili-main", "credentials.json");
}

export function loadCookie(path) {
  try {
    if (!path || !existsSync(path)) return "";
    const c = JSON.parse(readFileSync(path, "utf8"));
    return `SESSDATA=${c.sessdata}; bili_jct=${c.bili_jct}; buvid3=${c.buvid3 || ""}; DedeUserID=${c.dedeuserid || ""}`;
  } catch {
    return "";
  }
}

async function api(url, cookie) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Referer: "https://www.bilibili.com/",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

export async function getVideoInfo(bvid) {
  const q = new URLSearchParams({ bvid });
  const d = await api(`https://api.bilibili.com/x/web-interface/view?${q}`, "");
  if (d.code !== 0) throw new Error(`获取视频信息失败：${d.code} ${d.message}`);
  const v = d.data || {};
  return {
    bvid: v.bvid,
    aid: v.aid,
    title: v.title,
    duration: v.duration,
    play: v.stat?.view ?? 0,
    reply: v.stat?.reply ?? 0,
    danmaku: v.stat?.danmaku ?? 0,
    owner: v.owner?.name,
    pubdate: v.pubdate,
  };
}

/** 拉评论：sort 0=最新，1=热度 */
export async function getComments(aid, { pages = 3, sort = 0, cookie = "" } = {}) {
  const out = [];
  const seen = new Set();
  for (let pn = 1; pn <= pages; pn++) {
    const q = new URLSearchParams({ type: "1", oid: String(aid), pn: String(pn), ps: "20", sort: String(sort) });
    const d = await api(`https://api.bilibili.com/x/v2/reply?${q}`, cookie);
    if (d.code !== 0) break;
    const replies = d.data?.replies || [];
    if (!replies.length) break;
    for (const r of replies) {
      if (!r?.rpid || seen.has(r.rpid)) continue;
      seen.add(r.rpid);
      out.push({ rpid: r.rpid, content: r.content?.message || "", like: r.like ?? 0 });
    }
    await new Promise((r) => setTimeout(r, 350)); // 温和限速
  }
  return out;
}

/** 视频信息 + 评论（最新 + 热度，去重） */
export async function collectVideo(bvid, { pages = 3, cookie = "" } = {}) {
  const info = await getVideoInfo(bvid);
  const newest = await getComments(info.aid, { pages, sort: 0, cookie });
  const hot = await getComments(info.aid, { pages: 1, sort: 1, cookie });
  const map = new Map();
  for (const c of [...newest, ...hot]) if (!map.has(c.rpid)) map.set(c.rpid, c);
  return { info, comments: [...map.values()] };
}

/** 拿视频字幕原文（AI 字幕优先）。没有字幕返回空串。 */
export async function getSubtitleText(aid, cid, cookie = "") {
  const q = new URLSearchParams({ aid: String(aid), cid: String(cid) });
  let d = null;
  for (const path of ["/x/player/wbi/v2", "/x/player/v2"]) {
    try {
      d = await api(`https://api.bilibili.com${path}?${q}`, cookie);
      if (d.code === 0) break;
    } catch {
      d = null;
    }
  }
  const subs = d?.data?.subtitle?.subtitles || [];
  const pick = subs.find((x) => (x.lan || "").startsWith("ai")) || subs[0];
  if (!pick?.subtitle_url) return "";
  let url = pick.subtitle_url;
  if (url.startsWith("//")) url = "https:" + url;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: "https://www.bilibili.com/" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) return "";
  const json = await res.json();
  return (json.body || []).map((x) => x.content || "").join("\n");
}
