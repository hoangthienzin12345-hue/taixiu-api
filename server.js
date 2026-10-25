// ═══════════════════════════════════════════════════════════════════════════════
//  TÀI XỈU LC79 — FULL ENGINE (Port từ file gốc)
//  34 cầu + ensemble thích nghi + walk-forward backtest + 4 games
//  + Key + Id admin + Ty_le
// ═══════════════════════════════════════════════════════════════════════════════
// Cài:  npm i express cors
// Chạy: node server.js  →  http://localhost:3000/lichsu
"use strict";

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

// ================= CONFIG =================
const PORT       = process.env.PORT || 3000;
const VALID_KEY  = "Thien456";
const ADMIN      = "@ADMNLc79";
const POLL_MS    = 5000;
const KEEP       = 300;
const DATA_DIR   = path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

// ================= ENGINE =================
const T = "TAI", X = "XIU";
const opp = (r) => (r === T ? X : T);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const WARM = 12;
const WINDOW = 40;

function toRuns(seq) {
    const runs = [];
    for (const r of seq) {
        const last = runs[runs.length - 1];
        if (last && last.val === r) last.len++;
        else runs.push({ val: r, len: 1 });
    }
    return runs;
}

function makeCtx(hist) {
    const seq = hist.map((h) => h.result);
    return { hist, seq, pts: hist.map((h) => h.point), runs: toRuns(seq) };
}

// ─── 1. Cầu chu kỳ ───
function cyclePattern(ctx, cycle) {
    const runs = ctx.runs;
    const cur = runs[runs.length - 1];
    const done = runs.slice(0, -1);
    const k = cycle.length;
    const need = Math.max(3, 2 * k);
    if (done.length < need) return null;
    for (let p = 0; p < k; p++) {
        if (cur.len > cycle[p]) continue;
        let ok = true;
        for (let j = 0; j < need; j++) {
            const idx = (((p - 1 - j) % k) + k) % k;
            if (done[done.length - 1 - j].len !== cycle[idx]) { ok = false; break; }
        }
        if (ok) return { pick: cur.len < cycle[p] ? cur.val : opp(cur.val), weight: 1 + need * 0.25 };
    }
    return null;
}
const CYCLES = {
    "cau-1-1": [1], "cau-2-2": [2], "cau-3-3": [3], "cau-4-4": [4],
    "cau-2-1-2": [2, 1], "cau-3-2": [3, 2], "cau-4-1": [4, 1], "cau-3-1": [3, 1], "cau-4-2": [4, 2],
    "cau-1-1-2": [1, 1, 2], "cau-2-2-1": [2, 2, 1], "cau-1-2-3": [1, 2, 3], "cau-3-2-1": [3, 2, 1],
};

// ─── 2. Cầu bệt / bẻ cầu ───
const catBet = (c) => {
    const cur = c.runs[c.runs.length - 1];
    return cur.len >= 3 ? { pick: cur.val, weight: 1 + cur.len * 0.5 } : null;
};
const beCau = (c) => {
    const cur = c.runs[c.runs.length - 1];
    return cur.len >= 9 ? { pick: opp(cur.val), weight: 1 + cur.len * 0.7 } : null;
};

// ─── 3. Xác suất ngắt chuỗi ───
function runMarkov(c) {
    const runs = c.runs, cur = runs[runs.length - 1], L = cur.len;
    let cont = 0, end = 0;
    for (let i = 0; i < runs.length - 1; i++) {
        if (runs[i].len > L) cont++;
        else if (runs[i].len === L) end++;
    }
    if (cont + end < 4) return null;
    const p = (cont + 1) / (cont + end + 2);
    if (Math.abs(p - 0.5) < 0.1) return null;
    return { pick: p > 0.5 ? cur.val : opp(cur.val), weight: 1 + 6 * Math.abs(p - 0.5) };
}

// ─── 4. Markov bậc k ───
function markovK(c, k) {
    const s = c.seq;
    if (s.length <= k + 3) return null;
    const ctx = s.slice(-k).join(",");
    let a = 0, b = 0;
    for (let i = k; i < s.length; i++) {
        if (s.slice(i - k, i).join(",") === ctx) (s[i] === T ? a++ : b++);
    }
    const t = a + b;
    if (t < 3) return null;
    const p = (a + 1) / (t + 2);
    if (Math.abs(p - 0.5) < 0.12) return null;
    return { pick: p > 0.5 ? T : X, weight: 1 + 4 * Math.abs(p - 0.5) };
}

// ─── 5. Lặp chuỗi ───
function lapChuoi(c) {
    const s = c.seq;
    for (let L = Math.min(7, s.length - 2); L >= 5; L--) {
        const suf = s.slice(-L).join(",");
        let a = 0, b = 0;
        for (let i = s.length - L - 1; i >= 0; i--) {
            if (s.slice(i, i + L).join(",") === suf) (s[i + L] === T ? a++ : b++);
        }
        const t = a + b;
        if (t >= 2) {
            const p = (a + 1) / (t + 2);
            if (Math.abs(p - 0.5) >= 0.15) return { pick: p > 0.5 ? T : X, weight: 0.6 + 3 * Math.abs(p - 0.5) };
        }
    }
    return null;
}

// ─── 6. Chu kỳ lặp p phiên ───
function chuKy(c, p) {
    const s = c.seq, n = s.length;
    if (n < p * 2) return null;
    for (let j = 0; j < p; j++) if (s[n - 1 - j] !== s[n - 1 - j - p]) return null;
    const unit = s.slice(n - p);
    if (unit.every((v) => v === unit[0])) return null;
    return { pick: s[n - p], weight: 1 + 0.3 * p };
}

// ─── 7. Bayes tỉ lệ ───
function bayesTyLe(c) {
    const n = c.seq.length, tai = c.seq.filter((r) => r === T).length;
    const p = (tai + 1) / (n + 2);
    if (Math.abs(p - 0.5) < 0.08) return null;
    return { pick: p > 0.5 ? T : X, weight: 0.8 };
}

// ─── 8. Markov vùng điểm ───
const bucket = (p) => (p <= 7 ? 0 : p <= 10 ? 1 : p <= 13 ? 2 : 3);
function markovTong(c) {
    const n = c.seq.length;
    if (n < 20) return null;
    const b = bucket(c.pts[n - 1]);
    let a = 0, x = 0;
    for (let i = 1; i < n; i++) if (bucket(c.pts[i - 1]) === b) (c.seq[i] === T ? a++ : x++);
    const t = a + x;
    if (t < 6) return null;
    const p = (a + 1) / (t + 2);
    if (Math.abs(p - 0.5) < 0.1) return null;
    return { pick: p > 0.5 ? T : X, weight: 1 + 4 * Math.abs(p - 0.5) };
}

// ─── 9. Cân bằng N phiên ───
function canBang(c, n) {
    const s = c.seq;
    if (s.length < n) return null;
    const tai = s.slice(-n).filter((v) => v === T).length;
    const d = tai / n - 0.5;
    if (Math.abs(d) < 0.17) return null;
    return { pick: d > 0 ? X : T, weight: 0.8 + 3 * (Math.abs(d) - 0.17) };
}

// ─── 10. Nhịp chuỗi kép ───
function runMarkov2(c) {
    const runs = c.runs;
    if (runs.length < 8) return null;
    const cur = runs[runs.length - 1], L = cur.len, prev = Math.min(runs[runs.length - 2].len, 4);
    let cont = 0, end = 0;
    for (let i = 1; i < runs.length - 1; i++) {
        if (Math.min(runs[i - 1].len, 4) !== prev) continue;
        if (runs[i].len > L) cont++;
        else if (runs[i].len === L) end++;
    }
    if (cont + end < 3) return null;
    const p = (cont + 1) / (cont + end + 2);
    if (Math.abs(p - 0.5) < 0.15) return null;
    return { pick: p > 0.5 ? cur.val : opp(cur.val), weight: 1 + 5 * Math.abs(p - 0.5) };
}

// ─── 11. Markov điểm chính xác ───
function markovDiemChinh(c) {
    const n = c.seq.length;
    if (n < 30) return null;
    const v = c.pts[n - 1];
    let a = 0, b = 0;
    for (let i = 1; i < n; i++) if (c.pts[i - 1] === v) (c.seq[i] === T ? a++ : b++);
    const t = a + b;
    if (t < 8) return null;
    const p = (a + 1) / (t + 2);
    if (Math.abs(p - 0.5) < 0.12) return null;
    return { pick: p > 0.5 ? T : X, weight: 1 + 4 * Math.abs(p - 0.5) };
}

// ─── 12. Markov 2 vùng điểm liên tiếp ───
function markovTong2(c) {
    const n = c.seq.length;
    if (n < 30) return null;
    const key = bucket(c.pts[n - 2]) * 4 + bucket(c.pts[n - 1]);
    let a = 0, b = 0;
    for (let i = 2; i < n; i++) if (bucket(c.pts[i - 2]) * 4 + bucket(c.pts[i - 1]) === key) (c.seq[i] === T ? a++ : b++);
    const t = a + b;
    if (t < 6) return null;
    const p = (a + 1) / (t + 2);
    if (Math.abs(p - 0.5) < 0.12) return null;
    return { pick: p > 0.5 ? T : X, weight: 1 + 4 * Math.abs(p - 0.5) };
}

// ─── 13. Markov xúc xắc lớn ───
const bigCount = (d) => d.filter((x) => x >= 4).length;
function markovXucXac(c) {
    const n = c.seq.length, h = c.hist;
    if (n < 30 || !Array.isArray(h[n - 1].dices)) return null;
    const key = bigCount(h[n - 1].dices);
    let a = 0, b = 0;
    for (let i = 1; i < n; i++) if (Array.isArray(h[i - 1].dices) && bigCount(h[i - 1].dices) === key) (c.seq[i] === T ? a++ : b++);
    const t = a + b;
    if (t < 8) return null;
    const p = (a + 1) / (t + 2);
    if (Math.abs(p - 0.5) < 0.12) return null;
    return { pick: p > 0.5 ? T : X, weight: 1 + 4 * Math.abs(p - 0.5) };
}

// ─── 14. Xu hướng EWMA ───
function xuHuong(c) {
    const s = c.seq;
    if (s.length < 20) return null;
    const al = 0.15;
    let e = 0.5;
    for (const r of s) e = e * (1 - al) + (r === T ? 1 : 0) * al;
    const d = e - 0.5;
    if (Math.abs(d) < 0.12) return null;
    return { pick: d > 0 ? T : X, weight: 0.8 + 3 * (Math.abs(d) - 0.12) };
}

// ─── REGISTRY (34 strategies) ───
const STRATEGIES = {};
for (const [name, cycle] of Object.entries(CYCLES)) STRATEGIES[name] = (c) => cyclePattern(c, cycle);
Object.assign(STRATEGIES, {
    "cau-bet": catBet,
    "be-cau": beCau,
    "run-markov": runMarkov,
    "markov-2": (c) => markovK(c, 2),
    "markov-3": (c) => markovK(c, 3),
    "markov-4": (c) => markovK(c, 4),
    "markov-5": (c) => markovK(c, 5),
    "markov-diem-chinh": markovDiemChinh,
    "markov-tong-2": markovTong2,
    "markov-xuc-xac": markovXucXac,
    "xu-huong": xuHuong,
    "lap-chuoi": lapChuoi,
    "chu-ky-3": (c) => chuKy(c, 3),
    "chu-ky-4": (c) => chuKy(c, 4),
    "chu-ky-5": (c) => chuKy(c, 5),
    "chu-ky-6": (c) => chuKy(c, 6),
    "bayes-ty-le": bayesTyLe,
    "markov-tong": markovTong,
    "run-markov-2": runMarkov2,
    "can-bang-12": (c) => canBang(c, 12),
    "can-bang-24": (c) => canBang(c, 24),
});
const NAMES = Object.keys(STRATEGIES);
const WINDOW_LONG = 150;

function zRecord(preds, name, hist, from, to) {
    let h = 0, t = 0;
    for (let j = Math.max(WARM, from); j < to; j++) {
        const q = preds[name][j];
        if (q) { t++; if (q.pick === hist[j].result) h++; }
    }
    return t < 6 ? 0 : (h - t / 2) / Math.sqrt(t / 4);
}

const BAL = 12;
const memo = new Map();
function analyze(hist) {
    const key = hist.length + ":" + hist[0].id + ":" + hist[hist.length - 1].id + ":" +
        hist.slice(-24).map((h) => (h.result === T ? "T" : "X")).join("");
    if (memo.has(key)) return memo.get(key);
    const n = hist.length;
    const preds = {};
    for (const name of NAMES) preds[name] = new Array(n + 1).fill(null);
    for (let i = WARM; i <= n; i++) {
        const ctx = makeCtx(hist.slice(0, i));
        for (const name of NAMES) { try { preds[name][i] = STRATEGIES[name](ctx); } catch (_) {} }
    }
    const ens = new Array(n + 1).fill(null);
    for (let i = WARM; i <= n; i++) {
        const recent = [];
        for (let j = Math.max(WARM, i - BAL); j < i; j++) recent.push(ens[j].pick);
        ens[i] = ensembleAt(preds, hist, i, recent);
    }
    if (memo.size > 6) memo.clear();
    const val = { preds, ens };
    memo.set(key, val);
    return val;
}

function ensembleAt(preds, hist, i, recent) {
    const list = [];
    let sT = 0, sX = 0;
    for (const name of NAMES) {
        const r = preds[name][i];
        if (!r) continue;
        const rel = clamp(1 + 0.3 * zRecord(preds, name, hist, i - WINDOW, i) + 0.3 * zRecord(preds, name, hist, i - WINDOW_LONG, i), 0.15, 1.8);
        const w = Math.min(r.weight * rel, 2.6);
        list.push({ name, pick: r.pick, w });
        if (r.pick === T) sT += w; else sX += w;
    }
    const raw = sT + sX;
    const tai = recent.filter((p) => p === T).length;
    const share = recent.length >= 4 ? tai / recent.length : 0.5;
    const d = share - 0.5;
    const aT = sT * clamp(1 - 1.5 * d, 0.35, 1.65);
    const aX = sX * clamp(1 + 1.5 * d, 0.35, 1.65);
    const enough = (list.length >= 2 && raw >= 2.0) || raw >= 2.8;
    let pick, fallback = false;
    if (!enough || Math.abs(aT - aX) < 1e-9) {
        fallback = true;
        pick = d > 0.05 ? X : d < -0.05 ? T : recent.length ? opp(recent[recent.length - 1]) : hist[i - 1].result;
    } else pick = aT > aX ? T : X;
    const aligned = list.filter((x) => x.pick === pick).sort((a, b) => b.w - a.w);
    const pT = fallback ? (pick === T ? 0.52 : 0.48) : (aT + 1.5) / (aT + aX + 3);
    const firing = {};
    for (const x of list) firing[x.name] = x.pick;
    return { pick, pT: +pT.toFixed(2), pX: +(1 - pT).toFixed(2), top: aligned[0] || null, aligned, fallback, strategiesFiring: list.length, firing };
}

function predict(hist, issued) {
    const { preds, ens } = analyze(hist), n = hist.length;
    if (issued && issued.length >= 4) return ensembleAt(preds, hist, n, issued.slice(-BAL));
    return ens[n];
}

function backtest(hist) {
    const { preds, ens } = analyze(hist), n = hist.length;
    const st = {};
    for (const k of [...NAMES, "TONG-HOP"]) st[k] = { fired: 0, right: 0 };
    for (let i = WARM; i < n; i++) {
        const actual = hist[i].result;
        for (const name of NAMES) {
            const r = preds[name][i];
            if (r) { st[name].fired++; if (r.pick === actual) st[name].right++; }
        }
        st["TONG-HOP"].fired++;
        if (ens[i].pick === actual) st["TONG-HOP"].right++;
    }
    const out = {};
    for (const [k, v] of Object.entries(st)) {
        out[k] = { fired: v.fired, accuracy: v.fired ? +((v.right / v.fired) * 100).toFixed(1) + "%" : "n/a" };
    }
    return out;
}

function pickShare(hist) {
    const { ens } = analyze(hist);
    const picks = ens.slice(WARM, hist.length).map((e) => e.pick);
    const tai = picks.filter((p) => p === T).length;
    return { tai, xiu: picks.length - tai, taiPercent: picks.length ? +((tai / picks.length) * 100).toFixed(1) : null };
}

function stats(hist) {
    const seq = hist.map((h) => h.result);
    const runs = toRuns(seq);
    const tai = seq.filter((r) => r === T).length;
    return {
        sessions: seq.length, tai, xiu: seq.length - tai,
        taiPercent: +((tai / seq.length) * 100).toFixed(1),
        longestStreak: Math.max(...runs.map((r) => r.len)),
        currentStreak: { result: runs[runs.length - 1].val, length: runs[runs.length - 1].len },
        runLengths: runs.slice(-15).map((r) => r.len).join("-"),
    };
}
const engine = { STRATEGIES, predict, backtest, stats, toRuns, pickShare };

// ================= HTML =================
const LICHSU_HTML = String.raw`<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lịch sử dự đoán</title>
<style>
:root{--bg:#070b1c;--line:#1b2a55;--mut:#7f8cb5;--tai:#ff5c8a;--xiu:#3d8bff;--gold:#ffd23f;--ok:#19f08a;--bad:#ff3d6e}
*{box-sizing:border-box;margin:0;padding:0}
body{background:radial-gradient(900px 500px at 85% -10%,#18306b 0%,transparent 60%),var(--bg);color:#e8ecf7;font:14px/1.5 system-ui,sans-serif;min-height:100vh}
.wrap{max-width:1180px;margin:0 auto;padding:22px 14px 40px}
header{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:14px}
h1{font-size:20px;letter-spacing:.5px}h1 span{color:var(--gold);text-shadow:0 0 14px #ffd23f66}
.tabs{display:flex;gap:6px;flex-wrap:wrap}
.tabs button{background:#0b1230;color:var(--mut);border:1px solid var(--line);border-radius:99px;padding:6px 14px;font-size:12px;font-weight:800;cursor:pointer}
.tabs button.on{color:var(--gold);border-color:#ffd23f88;box-shadow:0 0 14px #ffd23f33}
.sum{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}
.s{background:linear-gradient(180deg,#0e1738,#0a1130);border:1px solid var(--line);border-radius:12px;padding:8px 16px;min-width:120px}
.s b{display:block;font-size:20px}.s span{font-size:10.5px;color:var(--mut);text-transform:uppercase;letter-spacing:1.2px}
.s.w b{color:var(--ok)}.s.l b{color:var(--bad)}
.box{background:linear-gradient(180deg,#0c1431cc,#080e26cc);border:1px solid var(--line);border-radius:18px;overflow:auto}
table{width:100%;border-collapse:collapse;min-width:980px}
th{color:#5f9bff;font-size:11px;text-transform:uppercase;text-align:left;padding:16px 14px 12px;font-weight:700}
td{padding:11px 14px;border-top:1px solid #121c40;font-size:13px;white-space:nowrap}
.id{color:var(--gold);font-weight:800}
.dice{font-weight:700;color:#cfd8ff}
.pill{display:inline-block;min-width:60px;text-align:center;padding:4px 12px;border-radius:9px;font-weight:800;font-size:12px;border:1px solid}
.pill.tai{color:var(--tai);border-color:#ff5c8a88;background:#ff5c8a1c}
.pill.xiu{color:var(--xiu);border-color:#3d8bff88;background:#3d8bff1c}
.pill.na{color:var(--mut);border-color:var(--line)}
.mau{display:inline-block;padding:4px 12px;border-radius:7px;font-weight:700;font-size:12px;border:1px solid #ffd23f88;background:#ffd23f12;color:#ffe27a}
.st{display:inline-block;min-width:78px;text-align:center;padding:4px 12px;border-radius:8px;font-weight:800;font-size:11.5px}
.st.w{color:var(--ok);background:#19f08a1c;border:1px solid #19f08a88}
.st.l{color:var(--bad);background:#ff3d6e1c;border:1px solid #ff3d6e88}
.st.p{color:var(--mut);background:#ffffff0d;border:1px solid var(--line)}
.empty{padding:40px;text-align:center;color:var(--mut)}
.foot{margin-top:12px;color:var(--mut);font-size:12px}
</style></head><body>
<div class="wrap">
<header><h1>📊 LỊCH SỬ <span>DỰ ĐOÁN</span></h1>
<div class="tabs"><button id="tab-tx" onclick="setGame('tx')">TÀI XỈU</button><button id="tab-txmd5" onclick="setGame('txmd5')">MD5</button><button id="tab-betvip_tx" onclick="setGame('betvip_tx')">BETVIP TX</button><button id="tab-betvip_md5" onclick="setGame('betvip_md5')">BETVIP MD5</button></div></header>
<div class="sum" id="sum"></div><div class="foot" id="nx" style="margin:-4px 0 12px"></div>
<div class="box"><table><thead><tr><th>Phiên</th><th>Xúc xắc</th><th class="c">Dự đoán</th><th class="c">Kết quả</th><th>Cầu gần nhất</th><th>Mẫu cầu</th><th class="c">Trạng thái</th></tr></thead><tbody id="body"></tbody></table></div>
<div class="foot">Chỉ gồm các phiên đã được dự đoán trước khi có kết quả.</div>
</div>
<script>
const $=id=>document.getElementById(id);const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const cls=v=>v==="Tài"?"tai":"xiu";let game=localStorage.getItem("game")||"txmd5";
function setGame(g){game=g;localStorage.setItem("game",g);mark();load()}
function mark(){for(const k of["tx","txmd5","betvip_tx","betvip_md5"])$("tab-"+k).className=k===game?"on":""}
async function load(){try{const d=await(await fetch("/lichsu/"+game+"?limit=60")).json();if(d.error)throw new Error(d.error);const t=d.thong_ke;
$("sum").innerHTML=[["Đã đối chiếu",t.tong,""],["Thắng",t.thang,"w"],["Thua",t.thua,"l"],["Tỉ lệ thắng",t.ti_le_thang,""],["KTC 95%",t.ktc_95,""]].map(([a,b,c])=>'<div class="s '+c+'"><b>'+esc(b)+'</b><span>'+a+'</span></div>').join("");
$("nx").textContent=t.nhan_xet+(t.p_value!=null?" (p = "+t.p_value+")":"");
if(!d.danh_sach.length){$("body").innerHTML='<tr><td colspan="7" class="empty">Chưa có phiên nào.</td></tr>';return}
$("body").innerHTML=d.danh_sach.map(r=>{const st=r.trang_thai==="Thắng"?"w":r.trang_thai==="Thua"?"l":"p";const ico=r.trang_thai==="Thắng"?"✔ ":r.trang_thai==="Thua"?"✖ ":"⏳ ";
return "<tr><td class='id'>#"+esc(r.Phien)+"</td><td class='dice'>"+(r.Xuc_xac?"["+r.Xuc_xac.map(esc).join(", ")+"]":"—")+"</td><td class='c'><span class='pill "+cls(r.du_doan)+"'>"+esc(r.du_doan.toUpperCase())+"</span></td><td class='c'>"+(r.Ket_qua?"<span class='pill "+cls(r.Ket_qua)+"'>"+esc(r.Ket_qua.toUpperCase())+"</span>":"<span class='pill na'>—</span>")+"</td><td class='dice'>"+esc(r.cau||"—")+"</td><td><span class='mau'>"+esc(r.mau_cau||"")+"</span></td><td class='c'><span class='st "+st+"'>"+ico+esc(r.trang_thai.toUpperCase())+"</span></td></tr>"}).join("")}
catch(e){$("body").innerHTML='<tr><td colspan="7" class="empty" style="color:#ff3d6e">Lỗi: '+esc(e.message)+"</td></tr>"}}
mark();load();setInterval(load,5000);
</script></body></html>`;

// ================= GAMES =================
const GAMES = {
    tx:         { name: "Tài Xỉu",       source: process.env.SOURCE_TX         || "https://wtx.tele68.com/v1/tx/sessions" },
    txmd5:      { name: "Tài Xỉu MD5",   source: process.env.SOURCE_TXMD5      || "https://wtxmd52.tele68.com/v1/txmd5/sessions" },
    betvip_tx:  { name: "BETVIP Tài Xỉu",source: process.env.SOURCE_BETVIP_TX  || "https://wtx.macminim6.online/v1/tx/sessions" },
    betvip_md5: { name: "BETVIP MD5",    source: process.env.SOURCE_BETVIP_MD5 || "https://wtxmd52.macminim6.online/v1/txmd5/sessions" },
};

const vn = (r) => (r === "TAI" ? "Tài" : "Xỉu");

const LABELS = {
    "run-markov": "Xác suất ngắt chuỗi", "lap-chuoi": "Lặp chuỗi", "bayes-ty-le": "Bayes tỉ lệ",
    "markov-tong": "Markov điểm", "markov-diem-chinh": "Markov điểm chính xác", "markov-tong-2": "Markov 2 vùng điểm",
    "markov-xuc-xac": "Markov xúc xắc", "xu-huong": "Xu hướng EWMA", "cau-bet": "Cầu bệt", "be-cau": "Bẻ cầu", "run-markov-2": "Nhịp chuỗi kép",
};
function prettyName(n) {
    if (LABELS[n]) return LABELS[n];
    let m;
    if ((m = n.match(/^markov-(\d+)$/))) return "Markov " + m[1];
    if ((m = n.match(/^chu-ky-(\d+)$/))) return "Chu kỳ " + m[1];
    return n;
}
function moTaCau(hist) {
    const seq = hist.map((h) => h.result);
    const runs = engine.toRuns(seq);
    const cur = runs[runs.length - 1];
    const lens = runs.slice(-6).map((r) => r.len);
    const l4 = lens.slice(-4);
    const same = (a) => a.length >= 4 && a.every((v) => v === a[0]);
    let ten;
    if (cur.len >= 3) ten = "Cầu bệt " + (cur.val === "TAI" ? "Tài" : "Xỉu") + " " + cur.len;
    else if (same(l4) && l4[0] === 1) ten = "Cầu 1-1";
    else if (same(l4) && l4[0] === 2) ten = "Cầu đôi " + (cur.val === "TAI" ? "TT" : "XX");
    else if (lens.length >= 3 && lens.slice(-3).every((v, i, a) => i === 0 || v === a[i - 1] + 1)) ten = "Cầu thang";
    else if (lens.length >= 3 && lens.slice(-3).every((v, i, a) => i === 0 || v === a[i - 1] - 1)) ten = "Cầu thang lùi";
    else ten = "Nhịp " + lens.slice(-4).join("-");
    const chuoi = seq.slice(-10).map((r) => (r === "TAI" ? "T" : "X")).join("");
    return chuoi + " · " + ten;
}
const PRIORITY = /^(cau-|be-cau|chu-ky|run-markov|can-bang)/;
function mauCau(e, hist) {
    const last = hist[hist.length - 1].result;
    const d = "dự " + vn(e.pick);
    if (!e.top || e.fallback) return `Ensemble ${e.strategiesFiring} model | Cân bằng nhịp → ${d}`;
    const n = (e.aligned.find((x) => PRIORITY.test(x.name)) || e.top).name;
    const kind = e.pick === last ? "Theo cầu" : "Bẻ cầu";
    let m;
    if (n === "cau-bet" || n === "be-cau") {
        const len = engine.toRuns(hist.map((h) => h.result)).pop().len;
        return `${kind} – Cầu bệt ${len} | Bệt ${len} phiên → ${d}`;
    }
    if ((m = n.match(/^cau-([\d-]+)$/))) return `${kind} – Cầu ${m[1]} | Nhịp ${m[1]} → ${d}`;
    if ((m = n.match(/^can-bang-(\d+)$/))) {
        const N = +m[1], tai = hist.slice(-N).filter((h) => h.result === "TAI").length;
        return `Cân bằng ${N} phiên | Tài ${tai}/${N} → ${d}`;
    }
    return `Ensemble ${e.strategiesFiring} model | ${prettyName(n)} · T:${e.pT.toFixed(2)} X:${e.pX.toFixed(2)} → ${d}`;
}

// ================= STATE =================
for (const [key, g] of Object.entries(GAMES)) {
    g.key = key;
    g.file = path.join(DATA_DIR, `lichsu-${key}.json`);
    g.cache = { t: 0, data: null };
    g.items = {};
    try { g.items = JSON.parse(fs.readFileSync(g.file, "utf8")); } catch (_) {}
    for (const id of Object.keys(g.items)) if (g.items[id].nguon === "backfill") delete g.items[id];
}

function save(g) {
    try {
        const ids = Object.keys(g.items).map(Number).sort((a, b) => b - a).slice(0, KEEP);
        const keep = {};
        for (const id of ids) keep[id] = g.items[id];
        g.items = keep;
        const tmp = g.file + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify(keep));
        fs.renameSync(tmp, g.file);
    } catch (e) { console.error("Lỗi lưu:", e.message); }
}

async function getHistory(g, maxAge = POLL_MS) {
    if (g.cache.data && Date.now() - g.cache.t < maxAge) return { hist: g.cache.data, stale: false };
    try {
        const res = await fetch(g.source, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const json = await res.json();
        if (!Array.isArray(json.list) || json.list.length < 20) throw new Error("Data invalid");
        const hist = json.list
            .map((s) => ({ id: s.id, result: s.resultTruyenThong, dices: s.dices, point: s.point }))
            .filter((h) => Number.isFinite(h.id) && (h.result === T || h.result === X) && Number.isFinite(h.point))
            .sort((a, b) => a.id - b.id);
        if (hist.length < 20) throw new Error("Not enough valid");
        g.cache = { t: Date.now(), data: hist };
        sync(g, hist);
        return { hist, stale: false };
    } catch (e) {
        if (g.cache.data) return { hist: g.cache.data, stale: true };
        throw e;
    }
}

function issuedPicks(g, nid) {
    return Object.values(g.items).filter((i) => i.id < nid).sort((a, b) => a.id - b.id).map((i) => i.pick);
}

function sync(g, hist) {
    let changed = false;
    const byId = new Map(hist.map((h) => [h.id, h]));
    for (const it of Object.values(g.items)) {
        if (!it.ket_qua) {
            const h = byId.get(it.id);
            if (h) {
                it.ket_qua = h.result;
                it.dices = h.dices;
                it.tong = h.point;
                it.thang = it.pick === h.result;
                changed = true;
            } else if (it.id < hist[0].id) {
                delete g.items[it.id];
                changed = true;
            }
        }
    }
    const nid = hist[hist.length - 1].id + 1;
    if (!g.items[nid]) {
        const e = predict(hist, issuedPicks(g, nid));
        g.items[nid] = {
            id: nid, pick: e.pick, pT: e.pT, pX: e.pX,
            mau_cau: mauCau(e, hist), cau: moTaCau(hist),
        };
        changed = true;
    }
    if (changed) save(g);
}

// ================= RESPONSE BUILDERS =================
function compact(g, hist) {
    const last = hist[hist.length - 1];
    const nid = last.id + 1;
    const it = g.items[nid];
    const conf = it.pick === T ? (it.pT || 0.5) : (it.pX || 0.5);
    return {
        Id: ADMIN,
        Phien_nay: nid,
        Du_doan: vn(it.pick),
        Ty_le: (conf * 100).toFixed(1) + "%",
        Phien_truoc: last.id,
        Xuc_xac: last.dices?.length === 3 ? last.dices.join("-") : "—",
        Ket_qua: vn(last.result),
    };
}

function full(g, hist, stale) {
    const last = hist[hist.length - 1];
    const it = g.items[last.id + 1];
    const conf = it.pick === T ? (it.pT || 0.5) : (it.pX || 0.5);
    return {
        Id: ADMIN,
        game: g.key,
        totalStrategies: Object.keys(STRATEGIES).length,
        updatedAt: new Date().toISOString(),
        stale,
        latest: last,
        nextSessionId: last.id + 1,
        prediction: engine.predict(hist, issuedPicks(g, last.id + 1)),
        lockedPick: it.pick,
        Ty_le: (conf * 100).toFixed(1) + "%",
        backtest: engine.backtest(hist),
        stats: engine.stats(hist),
        pickBalance: engine.pickShare(hist),
    };
}

function kiemDinh(n, w) {
    if (!n) return { ktc_95: "n/a", p_value: null, nhan_xet: "Chưa có dữ liệu." };
    const p = w / n, z = 1.96, z2 = z * z;
    const den = 1 + z2 / n;
    const ctr = (p + z2 / (2 * n)) / den;
    const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / den;
    const zs = (w - n / 2) / Math.sqrt(n / 4);
    const pv = 2 * (1 - normalCDF(Math.abs(zs)));
    let nx;
    if (n < 30) nx = "Mẫu quá nhỏ (" + n + " phiên).";
    else if (pv < 0.05 && p > 0.5) nx = "Cao hơn 50% có ý nghĩa thống kê.";
    else if (pv < 0.05) nx = "Thấp hơn 50% có ý nghĩa thống kê.";
    else nx = "Chưa khác mức ngẫu nhiên 50%.";
    return {
        ktc_95: ((ctr - half) * 100).toFixed(1) + "% – " + ((ctr + half) * 100).toFixed(1) + "%",
        p_value: +pv.toFixed(3), nhan_xet: nx,
    };
}
function normalCDF(x) {
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989423 * Math.exp(-x * x / 2);
    const prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return x > 0 ? 1 - prob : prob;
}

function lichsu(g, limit) {
    const all = Object.values(g.items).sort((a, b) => b.id - a.id);
    const done = all.filter((i) => i.ket_qua);
    const win = done.filter((i) => i.thang).length;
    return {
        game: g.key,
        thong_ke: {
            tong: done.length, thang: win, thua: done.length - win,
            ti_le_thang: done.length ? ((win / done.length) * 100).toFixed(1) + "%" : "n/a",
            ...kiemDinh(done.length, win),
        },
        danh_sach: all.slice(0, limit).map((i) => ({
            Phien: i.id,
            Xuc_xac: i.dices || null,
            Tong: i.tong ?? null,
            du_doan: vn(i.pick),
            Ket_qua: i.ket_qua ? vn(i.ket_qua) : null,
            cau: i.cau || "",
            mau_cau: i.mau_cau,
            trang_thai: !i.ket_qua ? "Chờ" : i.thang ? "Thắng" : "Thua",
        })),
    };
}

// ================= KEY CHECK =================
const checkKey = (q) => q.key === VALID_KEY
    ? { valid: true }
    : { valid: false, error: `Sai key! Ib ${ADMIN}` };

// ================= SERVER =================
const app = express();
app.use(cors());

const wrap = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (e) { res.status(502).json({ error: e.message }); }
};
const limitOf = (req) => Math.min(Math.max(parseInt(req.query.limit) || 30, 1), KEEP);
const both = async (req) => {
    const n = limitOf(req);
    const out = {};
    await Promise.all(Object.values(GAMES).map(async (g) => {
        let loi = null;
        try { await getHistory(g); } catch (e) { loi = e.message; }
        out[g.key] = lichsu(g, n);
        if (loi) out[g.key].loi = loi;
    }));
    return out;
};

app.get("/", (req, res) => res.redirect("/lichsu"));

app.get("/lichsu", wrap(async (req, res) => {
    if (req.accepts(["json", "html"]) === "html") return res.type("html").send(LICHSU_HTML);
    res.json(await both(req));
}));
app.get("/lichsu.json", wrap(async (req, res) => res.json(await both(req))));

// ─── COMPAT ROUTES (key + Id + Ty_le) ───
app.get("/api/taixiu/lc79", wrap(async (req, res) => {
    const k = checkKey(req.query);
    if (!k.valid) return res.status(401).json({ error: k.error });
    const { hist } = await getHistory(GAMES.tx);
    res.json(compact(GAMES.tx, hist));
}));

app.get("/api/taixiumd5/lc79", wrap(async (req, res) => {
    const k = checkKey(req.query);
    if (!k.valid) return res.status(401).json({ error: k.error });
    const { hist } = await getHistory(GAMES.txmd5);
    res.json(compact(GAMES.txmd5, hist));
}));

// ─── ORIGINAL ROUTES (no key) ───
for (const key of Object.keys(GAMES)) {
    const g = GAMES[key];
    app.get("/" + key, wrap(async (req, res) => {
        const { hist } = await getHistory(g);
        res.json(compact(g, hist));
    }));
    app.get("/api/" + key, wrap(async (req, res) => {
        const { hist, stale } = await getHistory(g);
        res.json(full(g, hist, stale));
    }));
    app.get("/lichsu/" + key, wrap(async (req, res) => {
        await getHistory(g);
        res.json(lichsu(g, limitOf(req)));
    }));
}

app.get("/check-key", (req, res) => {
    const k = checkKey(req.query);
    if (k.valid) return res.json({ status: "success", message: "KEY HỢP LỆ", admin: ADMIN });
    res.json({ status: "error", message: k.error });
});

app.get("/health", (req, res) => res.json({ ok: true, strategies: Object.keys(STRATEGIES).length }));

async function poll() {
    await Promise.all(Object.values(GAMES).map((g) => getHistory(g).catch((e) => console.error(`[${g.key}]`, e.message))));
}
setInterval(poll, POLL_MS);

app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  🎲 TÀI XỈU LC79 — FULL ENGINE (34 cầu + ensemble thích nghi)        ║
╠══════════════════════════════════════════════════════════════════════╣
║  🚀 Port: ${PORT}  🔑 ${VALID_KEY}  👤 ${ADMIN}
║
║  🧠 ${Object.keys(STRATEGIES).length} thuật toán:
║     • 13 cầu chu kỳ (1-1, 2-2, 3-3, 4-4, 2-1-2, ...)
║     • Cầu bệt, bẻ cầu
║     • Xác suất ngắt chuỗi, nhịp chuỗi kép
║     • Markov 2-5, Markov điểm, Markov xúc xắc
║     • Lặp chuỗi, chu kỳ 3-6, Bayes, xu hướng EWMA
║     • Cân bằng 12, 24
║
║  🎯 Ensemble: z-score weights + balance + fallback
║  📊 Walk-forward backtest, Wilson CI 95%, p-value
║
║  📌 With key:
║     HŨ : /api/taixiu/lc79?key=${VALID_KEY}
║     MD5: /api/taixiumd5/lc79?key=${VALID_KEY}
║  📌 No key:
║     /tx  /txmd5  /betvip_tx  /betvip_md5  /lichsu  /lichsu.json
╚══════════════════════════════════════════════════════════════════════╝
    `);
    poll();
});