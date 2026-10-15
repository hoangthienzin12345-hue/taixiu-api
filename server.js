import fastify from "fastify";
import cors from "@fastify/cors";

// ═══════════════════════════════════════════════════════════════════
//  TÀI XỈU LC79 — ENGINE v7 (16 TTOÁN + FULL CẦU)
// ═══════════════════════════════════════════════════════════════════
const PORT      = process.env.PORT || 3000;
const VALID_KEY = "Thien456";
const ADMIN     = "@ADMNLc79";
const N         = 30;

const API_HU  = "https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5";
const API_MD5 = "https://wtxmd52.tele68.com/v1/txmd5/sessions";

// ═══════════════════════════════════════════════════════════════════
//  FETCH CÓ TIMEOUT
// ═══════════════════════════════════════════════════════════════════
async function fetchJSON(url, timeoutMs = 8000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try { return await (await fetch(url, { signal: ctrl.signal })).json(); }
    finally { clearTimeout(t); }
}

// ═══════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════
function norm(val, point) {
    if (val != null) {
        const s = String(val).toLowerCase().trim();
        if (["tài","tai","t","big"].includes(s)) return "Tài";
        if (["xỉu","xiu","x","small"].includes(s)) return "Xỉu";
    }
    return Number(point) >= 11 ? "Tài" : "Xỉu";
}
const opp = x => x === "Tài" ? "Xỉu" : "Tài";
const bao = d => d?.[0] === d?.[1] && d?.[1] === d?.[2];
const toB = r => r === "Tài" ? 1 : 0;
const toC = r => r === "Tài" ? "T" : "X";

function streaks(h) {
    if (!h.length) return [];
    const out = [];
    let t = h[0].result, l = 1;
    for (let i = 1; i < h.length; i++) {
        if (h[i].result === t) l++;
        else { out.push({ type: t, len: l }); t = h[i].result; l = 1; }
    }
    out.push({ type: t, len: l });
    return out;
}
const chart = h => h.slice(0, N).reverse().map(x => toC(x.result)).join("");
const bitsOf  = (h, n = 60) => h.slice(0, n).map(x => toB(x.result)).reverse();
const charsOf = (h, n = 60) => h.slice(0, n).map(x => toC(x.result)).reverse().join("");

// ═══════════════════════════════════════════════════════════════════
//  📊 16 THUẬT TOÁN PHÂN TÍCH
// ═══════════════════════════════════════════════════════════════════
const A = {};

// [1] Streak stats — thống kê bệt
A.streakStats = h => {
    const st = streaks(h);
    const lens = st.slice(0, 30).map(s => s.len);
    return {
        raw: st,
        cur: st[0] || null,
        prev: st[1] || null,
        lens,
        avg: lens.reduce((a, b) => a + b, 0) / (lens.length || 1),
        max: Math.max(...lens, 0),
    };
};

// [2] Shannon entropy
A.shannon = bits => {
    if (!bits.length) return 0;
    const p = bits.reduce((a, b) => a + b, 0) / bits.length;
    return (p <= 0 || p >= 1) ? 0 : -p * Math.log2(p) - (1 - p) * Math.log2(1 - p);
};

// [3] Autocorrelation
A.autocorr = (bits, maxLag = 10) => {
    const out = [];
    for (let k = 1; k <= maxLag && k < bits.length; k++) {
        let m = 0, t = 0;
        for (let i = 0; i < bits.length - k; i++) { t++; if (bits[i] === bits[i + k]) m++; }
        out.push(t ? m / t : 0.5);
    }
    return out;
};

// [4] Markov v1 (bậc 1)
A.markov1 = (chars, w = false, decay = 0.97) => {
    if (chars.length < 5) return null;
    const cur = chars[chars.length - 1];
    const c = { T: 0, X: 0 };
    for (let i = 0; i < chars.length - 1; i++) {
        if (chars[i] !== cur) continue;
        c[chars[i + 1]] += w ? Math.pow(decay, chars.length - i) : 1;
    }
    const tot = c.T + c.X;
    if (tot < 2) return null;
    const pT = c.T / tot;
    return { state: cur, next: pT > 0.5 ? "Tài" : "Xỉu", prob: Math.max(pT, 1 - pT), n: tot };
};

// [5] Markov v2 (bậc 2)
A.markov2 = (chars, w = false, decay = 0.97) => {
    if (chars.length < 8) return null;
    const cur = chars.slice(-2);
    const c = { T: 0, X: 0 };
    for (let i = 0; i < chars.length - 2; i++) {
        if (chars.slice(i, i + 2) !== cur) continue;
        c[chars[i + 2]] += w ? Math.pow(decay, chars.length - i) : 1;
    }
    const tot = c.T + c.X;
    if (tot < 2) return null;
    const pT = c.T / tot;
    return { state: cur, next: pT > 0.5 ? "Tài" : "Xỉu", prob: Math.max(pT, 1 - pT), n: tot };
};

// [6] Markov weighted (bậc 3)
A.markovW = (chars, decay = 0.9) => {
    if (chars.length < 12) return null;
    const cur = chars.slice(-3);
    const c = { T: 0, X: 0 };
    for (let i = 0; i < chars.length - 3; i++) {
        if (chars.slice(i, i + 3) !== cur) continue;
        c[chars[i + 3]] += Math.pow(decay, chars.length - i);
    }
    const tot = c.T + c.X;
    if (tot < 1.5) return null;
    const pT = c.T / tot;
    return { state: cur, next: pT > 0.5 ? "Tài" : "Xỉu", prob: Math.max(pT, 1 - pT), n: tot };
};

// [7] Cycle detection (tự dò chu kỳ P=2..10)
A.cycleAuto = (chars, minP = 2, maxP = 10) => {
    let best = null;
    for (let P = minP; P <= maxP; P++) {
        if (chars.length < P * 2 + 2) continue;
        const tail = chars.slice(-(P * 3));
        let m = 0, t = 0;
        for (let i = 0; i < tail.length - P; i++) { t++; if (tail[i] === tail[i + P]) m++; }
        if (t < P * 2) continue;
        const score = m / t;
        if (score < 0.75) continue;
        const pred = chars[chars.length - P] === "T" ? "Tài" : "Xỉu";
        if (!best || score > best.score) best = { P, score, pred };
    }
    return best;
};

// [8] Suffix match (n-gram dài nhất)
A.suffixMatch = (chars, minL = 3, maxL = 12) => {
    for (let L = Math.min(maxL, chars.length - 1); L >= minL; L--) {
        const suf = chars.slice(-L);
        const idx = chars.slice(0, -1).lastIndexOf(suf);
        if (idx >= 0 && idx + L < chars.length)
            return { L, pattern: suf, next: chars[idx + L] };
    }
    return null;
};

// [9] KNN pattern matching
A.knn = (bits, k = 5, qLen = 4) => {
    if (bits.length < qLen + 5) return null;
    const q = bits.slice(-qLen);
    const sims = [];
    for (let i = 0; i + qLen < bits.length - 1; i++) {
        let d = 0;
        for (let j = 0; j < qLen; j++) d += Math.abs(bits[i + j] - q[j]);
        sims.push({ d, nxt: bits[i + qLen] });
    }
    sims.sort((a, b) => a.d - b.d);
    return sims.slice(0, k);
};

// [10] RSI
A.rsi = (bits, n = 14) => {
    const seg = bits.slice(-n);
    if (seg.length < 3) return 50;
    let g = 0, l = 0;
    for (let i = 1; i < seg.length; i++) {
        if (seg[i] > seg[i - 1]) g++;
        else if (seg[i] < seg[i - 1]) l++;
    }
    return 100 - 100 / (1 + g / (l || 1));
};

// [11] Volatility
A.volatility = bits => {
    if (bits.length < 2) return 0;
    let d = 0;
    for (let i = 1; i < bits.length; i++) d += Math.abs(bits[i] - bits[i - 1]);
    return d / (bits.length - 1);
};

// [12] CUSUM (changepoint)
A.cusum = (bits, th = 3) => {
    let sP = 0, sN = 0;
    for (const x of bits) {
        sP = Math.max(0, sP + (x - 0.5));
        sN = Math.min(0, sN + (x - 0.5));
        if (sP > th) return { dir: 1, val: sP };
        if (sN < -th) return { dir: -1, val: sN };
    }
    return { dir: 0, val: 0 };
};

// [13] Hurst exponent
A.hurst = bits => {
    const n = bits.length;
    if (n < 20) return 0.5;
    const lags = [2, 4, 8, 16].filter(l => l < n / 2);
    if (lags.length < 2) return 0.5;
    const taus = lags.map(l => {
        const d = [];
        for (let i = 0; i + l < n; i += l) {
            const s = bits.slice(i, i + l);
            d.push(Math.abs(s[s.length - 1] - s[0]));
        }
        return Math.sqrt(d.reduce((a, b) => a + b * b, 0) / d.length) || 1e-6;
    });
    return slopeLogLog(lags, taus);
};

// [14] Z-score
A.zScore = bits => {
    if (bits.length < 3) return 0;
    const m = bits.reduce((a, b) => a + b, 0) / bits.length;
    const sd = Math.sqrt(bits.reduce((a, b) => a + (b - m) ** 2, 0) / bits.length) || 1e-6;
    return (bits[bits.length - 1] - m) / sd;
};

// [15] Bayesian posterior
A.bayesPosterior = (bits, prior = 0.5, pTrue = 0.55) => {
    const n = bits.length;
    const k = bits.filter(x => x === 1).length;
    const lT = k * Math.log(pTrue) + (n - k) * Math.log(1 - pTrue);
    const lX = k * Math.log(1 - pTrue) + (n - k) * Math.log(pTrue);
    const mx = Math.max(lT, lX);
    const pT = (Math.exp(lT - mx) * prior) / (Math.exp(lT - mx) * prior + Math.exp(lX - mx) * (1 - prior));
    return { pT, next: pT > 0.5 ? "Tài" : "Xỉu", prob: Math.max(pT, 1 - pT) };
};

// [16] Recurrence
A.recurrence = (chars, L = 4) => {
    if (chars.length < L * 2) return null;
    const last = chars.slice(-L);
    let m = 0;
    for (let i = 0; i + L <= chars.length - L; i++)
        if (chars.slice(i, i + L) === last) m++;
    return { matches: m, pattern: last };
};

function slopeLogLog(xs, ys) {
    if (xs.length < 2) return 0.5;
    const lx = xs.map(Math.log), ly = ys.map(y => Math.log(y + 1e-9));
    const mx = lx.reduce((a, b) => a + b, 0) / lx.length;
    const my = ly.reduce((a, b) => a + b, 0) / ly.length;
    let num = 0, den = 0;
    for (let i = 0; i < xs.length; i++) { num += (lx[i] - mx) * (ly[i] - my); den += (lx[i] - mx) ** 2; }
    return den ? num / den : 0.5;
}

console.log(`📊 Analyzers: ${Object.keys(A).length}`);

// ═══════════════════════════════════════════════════════════════════
//  FEATURE BUNDLE
// ═══════════════════════════════════════════════════════════════════
function analyze(hist) {
    const bits = bitsOf(hist, 60);
    const chars = charsOf(hist, 60);
    const short = bits.slice(-30);
    const st = A.streakStats(hist);

    return {
        bits, chars, st,
        entropy: A.shannon(short),
        ac: A.autocorr(short, 10),
        markov: {
            m1: A.markov1(chars, false),
            m2: A.markov2(chars, false),
            mW: A.markovW(chars, 0.9),
            m1w: A.markov1(chars, true),
        },
        cycle: A.cycleAuto(chars, 2, 10),
        suffix: A.suffixMatch(chars, 3, 12),
        knn: A.knn(short, 5, 4),
        rsi: A.rsi(short, 14),
        vol: A.volatility(short),
        cusum: A.cusum(short, 3),
        hurst: A.hurst(short),
        zscore: A.zScore(short),
        bayes: A.bayesPosterior(short, 0.5, 0.55),
        recurrence: A.recurrence(chars, 4),
    };
}

// ═══════════════════════════════════════════════════════════════════
//  🎯 FULL CẦU — XEN KẼ, KÉP, ĐỒNG NHẤT, BỆT, CHU KỲ, MARKOV
// ═══════════════════════════════════════════════════════════════════
const BRIDGES = [];
const B = (cat, id, name, fn) => BRIDGES.push({ cat, id, name, fn });

/* ─── I. BỆT (7) ─────────────────────────────────────────────── */
function betBridge(L, mode, conf) {
    return (h, ctx) => {
        const cur = ctx.f.st.cur;
        if (!cur || cur.len < L) return null;
        if (mode === "cont" && cur.len > L + 1) return null;
        if (mode === "brk"  && cur.len > L + 2) return null;
        const pred = mode === "brk" ? opp(cur.type) : cur.type;
        return { pred, conf, src: `bệt ${cur.len} → ${mode === "brk" ? "BẺ" : "THEO"}` };
    };
}
B("streak", "bet2", "Bệt-2 theo",  betBridge(2, "cont", 60));
B("streak", "bet3", "Bệt-3 theo",  betBridge(3, "cont", 62));
B("streak", "bet4", "Bệt-4 theo",  betBridge(4, "cont", 63));
B("streak", "bet5", "Bệt-5 theo",  betBridge(5, "cont", 64));
B("streak", "bet6", "Bệt-6 theo",  betBridge(6, "cont", 64));
B("streak", "bet7", "Bệt-7 bẻ",    betBridge(7, "brk",  68));
B("streak", "bet8", "Bệt-8+ bẻ",   (h, ctx) => {
    const cur = ctx.f.st.cur;
    if (!cur || cur.len < 8) return null;
    return { pred: opp(cur.type), conf: Math.min(92, 70 + (cur.len - 8) * 2), src: `bệt ${cur.len} → BẺ MẠNH` };
});

/* ─── II. XEN KẼ ĐỒNG NHẤT (7) ───────────────────────────────── */
function altBridge(A_, B_, conf) {
    return (h, ctx) => {
        const st = ctx.f.st.raw;
        if (st.length < 6) return null;
        if (st[1].len !== A_ && st[1].len !== B_) return null;
        const first = st[1].len, second = first === A_ ? B_ : A_;
        for (let i = 2; i <= 5; i++)
            if (st[i].len !== (i % 2 === 0 ? second : first)) return null;
        const cur = st[0];
        if (cur.len === second) return { pred: opp(cur.type), conf, src: `xen kẽ ${A_}-${B_} (đảo)` };
        if (cur.len < second)   return { pred: cur.type, conf: conf - 4, src: `xen kẽ ${A_}-${B_} (${cur.len}/${second})` };
        return null;
    };
}
B("xenke", "xk11", "Xen kẽ 1-1", altBridge(1, 1, 80));
B("xenke", "xk22", "Xen kẽ 2-2", altBridge(2, 2, 78));
B("xenke", "xk33", "Xen kẽ 3-3", altBridge(3, 3, 76));
B("xenke", "xk44", "Xen kẽ 4-4", altBridge(4, 4, 74));
B("xenke", "xk55", "Xen kẽ 5-5", altBridge(5, 5, 72));
B("xenke", "xk12", "Xen kẽ 1-2", altBridge(1, 2, 76));
B("xenke", "xk21", "Xen kẽ 2-1", altBridge(2, 1, 76));

/* ─── III. KÉP (nhịp ngắn-dài xen kẽ) (6) ────────────────────── */
B("kep", "kep13", "Kép 1-3", altBridge(1, 3, 74));
B("kep", "kep31", "Kép 3-1", altBridge(3, 1, 74));
B("kep", "kep14", "Kép 1-4", altBridge(1, 4, 72));
B("kep", "kep41", "Kép 4-1", altBridge(4, 1, 72));
B("kep", "kep23", "Kép 2-3", altBridge(2, 3, 72));
B("kep", "kep32", "Kép 3-2", altBridge(3, 2, 72));

/* ─── IV. NHỊP 3 TAY (1-2-1, 2-1-2, 1-3-1, 3-1-3) (6) ────────── */
function rhythm3(P, conf) {
    return (h, ctx) => {
        const L = ctx.f.st.lens;
        if (L.length < 7) return null;
        const [a, b, c] = P;
        // kiểm tra pattern khớp với 2 chu kỳ gần nhất
        for (let start = 0; start < 3; start++) {
            let ok = true;
            for (let i = 0; i < 6; i++) {
                const expect = P[(start + i) % 3];
                if (L[i + 1] !== expect) { ok = false; break; }
            }
            if (!ok) continue;
            const tgt = P[(start + 6) % 3];
            const cur = ctx.f.st.cur;
            if (!cur) return null;
            if (cur.len < tgt) return { pred: cur.type, conf: conf - 4, src: `nhịp ${P.join("-")} (${cur.len}/${tgt})` };
            if (cur.len === tgt) return { pred: opp(cur.type), conf, src: `nhịp ${P.join("-")} (đảo)` };
            return null;
        }
        return null;
    };
}
B("nhip", "rh121", "Nhịp 1-2-1", rhythm3([1,2,1], 74));
B("nhip", "rh212", "Nhịp 2-1-2", rhythm3([2,1,2], 74));
B("nhip", "rh131", "Nhịp 1-3-1", rhythm3([1,3,1], 73));
B("nhip", "rh313", "Nhịp 3-1-3", rhythm3([3,1,3], 73));
B("nhip", "rh123", "Nhịp 1-2-3", rhythm3([1,2,3], 72));
B("nhip", "rh321", "Nhịp 3-2-1", rhythm3([3,2,1], 72));

/* ─── V. CHU KỲ (7) ──────────────────────────────────────────── */
function cycleBridge(P, conf) {
    return (h, ctx) => {
        const chars = ctx.f.chars;
        if (chars.length < P * 2 + 2) return null;
        const tail = chars.slice(-(P * 3));
        let m = 0, t = 0;
        for (let i = 0; i < tail.length - P; i++) { t++; if (tail[i] === tail[i + P]) m++; }
        if (t < P * 2) return null;
        const score = m / t;
        if (score < 0.75) return null;
        const pred = chars[chars.length - P] === "T" ? "Tài" : "Xỉu";
        return { pred, conf: Math.round(conf * score), src: `chu kỳ P=${P} (${(score * 100).toFixed(0)}%)` };
    };
}
B("cycle", "cyc2", "Chu kỳ 2", cycleBridge(2, 78));
B("cycle", "cyc3", "Chu kỳ 3", cycleBridge(3, 78));
B("cycle", "cyc4", "Chu kỳ 4", cycleBridge(4, 76));
B("cycle", "cyc5", "Chu kỳ 5", cycleBridge(5, 76));
B("cycle", "cyc6", "Chu kỳ 6", cycleBridge(6, 74));
B("cycle", "cyc7", "Chu kỳ 7", cycleBridge(7, 74));
B("cycle", "cyc8", "Chu kỳ 8", cycleBridge(8, 72));

/* ─── VI. MARKOV (4) ─────────────────────────────────────────── */
function mkBridge(getter, name, conf) {
    return (h, ctx) => {
        const m = getter(ctx.f);
        if (!m || m.n < 2) return null;
        return { pred: m.next, conf: Math.round(55 + (m.prob - 0.5) * conf),
                 src: `${name} [${m.state}] (${(m.prob * 100).toFixed(0)}%)` };
    };
}
B("markov", "mk1",  "Markov v1",       mkBridge(f => f.markov.m1,  "MK1", 60));
B("markov", "mk2",  "Markov v2",       mkBridge(f => f.markov.m2,  "MK2", 64));
B("markov", "mk3",  "Markov bậc 3",    mkBridge(f => f.markov.mW,  "MK3", 66));
B("markov", "mkW",  "Markov weighted", mkBridge(f => f.markov.m1w, "MKW", 68));

/* ─── VII. PATTERN (5) ───────────────────────────────────────── */
B("pattern", "ng3", "N-gram 3", (h, ctx) => {
    const ch = ctx.f.chars;
    if (ch.length < 15) return null;
    const suf = ch.slice(-3);
    const idx = ch.slice(0, -1).lastIndexOf(suf);
    if (idx < 0) return null;
    const nx = ch[idx + 3];
    return { pred: nx === "T" ? "Tài" : "Xỉu", conf: 66, src: `ng3 "${suf}" → ${nx}` };
});
B("pattern", "ng4", "N-gram 4", (h, ctx) => {
    const ch = ctx.f.chars;
    if (ch.length < 20) return null;
    const suf = ch.slice(-4);
    const idx = ch.slice(0, -1).lastIndexOf(suf);
    if (idx < 0) return null;
    const nx = ch[idx + 4];
    return { pred: nx === "T" ? "Tài" : "Xỉu", conf: 68, src: `ng4 "${suf}" → ${nx}` };
});
B("pattern", "ng5", "N-gram 5", (h, ctx) => {
    const ch = ctx.f.chars;
    if (ch.length < 25) return null;
    const suf = ch.slice(-5);
    const idx = ch.slice(0, -1).lastIndexOf(suf);
    if (idx < 0) return null;
    const nx = ch[idx + 5];
    return { pred: nx === "T" ? "Tài" : "Xỉu", conf: 70, src: `ng5 "${suf}" → ${nx}` };
});
B("pattern", "suffix", "Suffix dài nhất", (h, ctx) => {
    const s = ctx.f.suffix;
    if (!s) return null;
    return { pred: s.next === "T" ? "Tài" : "Xỉu", conf: Math.min(82, 60 + s.L * 1.5), src: `suffix L=${s.L}` };
});
B("pattern", "recur", "Recurrence", (h, ctx) => {
    const r = ctx.f.recurrence;
    if (!r || r.matches < 2) return null;
    const ch = ctx.f.chars;
    const idx = ch.slice(0, -1).lastIndexOf(r.pattern);
    if (idx < 0) return null;
    const nx = ch[idx + r.pattern.length];
    return { pred: nx === "T" ? "Tài" : "Xỉu", conf: 62 + r.matches * 2, src: `recur ${r.matches}x` };
});

/* ─── VIII. KNN (2) ──────────────────────────────────────────── */
function knnBridge(k, conf) {
    return (h, ctx) => {
        const top = ctx.f.knn;
        if (!top || top.length < k) return null;
        let t = 0, x = 0;
        for (const s of top.slice(0, k)) { const w = 1 / (1 + s.d); if (s.nxt === 1) t += w; else x += w; }
        if (t + x === 0) return null;
        const pred = t > x ? "Tài" : "Xỉu";
        return { pred, conf: Math.round(conf + Math.abs(t - x) / (t + x) * 15),
                 src: `KNN${k} (T${t.toFixed(1)}/X${x.toFixed(1)})` };
    };
}
B("knn", "knn3", "KNN k=3", knnBridge(3, 62));
B("knn", "knn5", "KNN k=5", knnBridge(5, 64));

/* ─── IX. REVERSAL / MOMENTUM (2) ────────────────────────────── */
B("rev", "meanrev", "Hồi quy TB", (h, ctx) => {
    const r = ctx.f.bits.slice(-20).reduce((a, b) => a + b, 0) / 20;
    if (r > 0.7) return { pred: "Xỉu", conf: 64, src: `r20=${r.toFixed(2)} → đảo` };
    if (r < 0.3) return { pred: "Tài", conf: 64, src: `r20=${r.toFixed(2)} → đảo` };
    return null;
});
B("rev", "momentum", "Động lượng", (h, ctx) => {
    const b = ctx.f.bits;
    const r5  = b.slice(-5).reduce((a, x) => a + x, 0) / 5;
    const r20 = b.slice(-20).reduce((a, x) => a + x, 0) / 20;
    if (r5 > 0.8 && r20 < 0.6) return { pred: "Tài", conf: 62, src: `mom ngắn Tài` };
    if (r5 < 0.2 && r20 > 0.4) return { pred: "Xỉu", conf: 62, src: `mom ngắn Xỉu` };
    return null;
});

/* ─── X. THỐNG KÊ (3) ────────────────────────────────────────── */
B("stat", "zscore", "Z-score", (h, ctx) => {
    const z = ctx.f.zscore;
    if (z > 1.4)  return { pred: "Xỉu", conf: 64, src: `z=+${z.toFixed(2)}` };
    if (z < -1.4) return { pred: "Tài", conf: 64, src: `z=${z.toFixed(2)}` };
    return null;
});
B("stat", "entropy", "Entropy", (h, ctx) => {
    const H = ctx.f.entropy;
    if (H > 0.97) return { pred: opp(h[0].result), conf: 58, src: `H=${H.toFixed(3)} → đảo` };
    if (H < 0.7)  return { pred: ctx.f.st.cur?.type || "Tài", conf: 64, src: `H=${H.toFixed(3)} → theo` };
    return null;
});
B("stat", "vol", "Biến động", (h, ctx) => {
    const v = ctx.f.vol;
    if (v > 0.55) return { pred: ctx.f.st.cur ? opp(ctx.f.st.cur.type) : "Tài", conf: 62, src: `vol cao ${v.toFixed(2)}` };
    if (v < 0.25) return { pred: ctx.f.st.cur?.type || "Tài", conf: 64, src: `vol thấp ${v.toFixed(2)}` };
    return null;
});

/* ─── XI. DICE (3) ───────────────────────────────────────────── */
B("dice", "sumTrend", "Xu hướng tổng", (h, ctx) => {
    const s = h.slice(0, 8).map(x => x.total);
    if (s.length < 5) return null;
    const slope = (s[0] - s[4]) / 4;
    if (slope > 1.5)  return { pred: "Tài", conf: 62, src: `tổng tăng ${s[4]}→${s[0]}` };
    if (slope < -1.5) return { pred: "Xỉu", conf: 62, src: `tổng giảm` };
    return null;
});
B("dice", "sumMod", "Mod tổng", (h, ctx) => {
    const m = h.slice(0, 12).map(x => x.total % 4);
    const big = m.filter(x => x >= 2).length;
    if (big >= 9) return { pred: "Tài", conf: 60, src: `mod4 big ${big}/12` };
    if (big <= 3) return { pred: "Xỉu", conf: 60, src: `mod4 small ${12 - big}/12` };
    return null;
});
B("dice", "sumRep", "Lặp tổng", (h, ctx) => {
    const s = h.slice(0, 10).map(x => x.total);
    const last = s[0];
    const reps = s.filter(v => v === last).length;
    if (reps >= 3) return { pred: last >= 11 ? "Xỉu" : "Tài", conf: 62, src: `tổng ${last} lặp ${reps}x` };
    return null;
});

/* ─── XII. RỦI RO (2) ────────────────────────────────────────── */
B("risk", "cusum", "CUSUM", (h, ctx) => {
    const c = ctx.f.cusum;
    if (c.dir > 0) return { pred: "Xỉu", conf: 64, src: `CUSUM +${c.val.toFixed(1)}` };
    if (c.dir < 0) return { pred: "Tài", conf: 64, src: `CUSUM ${c.val.toFixed(1)}` };
    return null;
});
B("risk", "rsi", "RSI", (h, ctx) => {
    const r = ctx.f.rsi;
    if (r > 75) return { pred: "Xỉu", conf: 64, src: `RSI=${r.toFixed(0)}` };
    if (r < 25) return { pred: "Tài", conf: 64, src: `RSI=${r.toFixed(0)}` };
    return null;
});

/* ─── XIII. PHỨC TẠP (2) ─────────────────────────────────────── */
B("complex", "hurst", "Hurst exponent", (h, ctx) => {
    const H = ctx.f.hurst;
    if (H > 0.65) return { pred: ctx.f.st.cur?.type || "Tài", conf: 62, src: `Hurst=${H.toFixed(2)} persistent` };
    if (H < 0.35) return { pred: opp(h[0].result), conf: 62, src: `Hurst=${H.toFixed(2)} anti-persist` };
    return null;
});
B("complex", "bayes", "Bayesian post", (h, ctx) => {
    const b = ctx.f.bayes;
    if (b.prob < 0.6) return null;
    return { pred: b.next, conf: Math.round(55 + b.prob * 25), src: `Bayes (${(b.prob * 100).toFixed(0)}%)` };
});

/* ─── XIV. META (3) ──────────────────────────────────────────── */
B("meta", "vote", "Meta vote", (h, ctx) => {
    const preds = ctx.basePreds;
    if (preds.length < 8) return null;
    const t = preds.filter(p => p.pred === "Tài").length, x = preds.length - t;
    const r = Math.max(t, x) / preds.length;
    if (r < 0.6) return null;
    return { pred: t > x ? "Tài" : "Xỉu", conf: Math.round(72 * r), src: `vote ${t}T/${x}X (${(r * 100).toFixed(0)}%)` };
});
B("meta", "cons", "Meta consensus", (h, ctx) => {
    const preds = ctx.basePreds;
    if (preds.length < 20) return null;
    const t = preds.filter(p => p.pred === "Tài").length, x = preds.length - t;
    const r = Math.max(t, x) / preds.length;
    if (r < 0.68) return null;
    return { pred: t > x ? "Tài" : "Xỉu", conf: Math.round(84 * r), src: `consensus ${(r * 100).toFixed(0)}%` };
});
B("meta", "weighted", "Meta weighted", (h, ctx) => {
    const preds = ctx.basePreds;
    if (preds.length < 8) return null;
    let t = 0, x = 0;
    for (const p of preds) {
        const w = (p.conf / 100) * (p.weight ?? 0.5);
        if (p.pred === "Tài") t += w; else x += w;
    }
    if (t + x === 0) return null;
    const r = Math.max(t, x) / (t + x);
    if (r < 0.6) return null;
    return { pred: t > x ? "Tài" : "Xỉu", conf: Math.round(80 * r), src: `weighted T${t.toFixed(1)}/X${x.toFixed(1)}` };
});

const CATS = {};
for (const b of BRIDGES) CATS[b.cat] = (CATS[b.cat] || 0) + 1;
console.log(`🎯 Cầu: ${BRIDGES.length} | Nhóm: ${Object.keys(CATS).length}`);
for (const [c, n] of Object.entries(CATS))
    console.log(`   • ${c.padEnd(10)} ${String(n).padStart(2)} (${(n / BRIDGES.length * 100).toFixed(1)}%)`);

// ═══════════════════════════════════════════════════════════════════
//  REGIME DETECTION
// ═══════════════════════════════════════════════════════════════════
function detectRegime(f) {
    if (f.hurst > 0.65) return "PERSISTENT";
    if (f.hurst < 0.35) return "ANTIPERSISTENT";
    if (f.entropy > 0.97 && f.ac[0] < 0.5) return "CHAOTIC";
    if (f.vol > 0.55) return "ALTERNATING";
    if (f.entropy < 0.85 && f.ac[0] > 0.7) return "TRENDING";
    if (f.st.cur?.len >= 9) return "FATIGUE";
    if (f.st.cur?.len >= 6) return "STREAK";
    if (f.entropy < 0.9 && f.ac[1] > 0.5) return "CYCLIC";
    return "NORMAL";
}

// ═══════════════════════════════════════════════════════════════════
//  BAYESIAN LEARNER + CALIBRATOR
// ═══════════════════════════════════════════════════════════════════
class Learner {
    constructor(decay = 0.995) { this.stats = {}; this.decayRate = decay; this.updates = 0; }
    tick() {
        if (++this.updates % 50) return;
        for (const s of Object.values(this.stats)) { s.a *= this.decayRate; s.b *= this.decayRate; }
    }
    record(id, regime, ok) { this._r(id, ok); if (regime) this._r(`${id}@${regime}`, ok); this.tick(); }
    _r(id, ok) {
        if (!this.stats[id]) this.stats[id] = { a: 1, b: 1 };
        if (ok) this.stats[id].a++; else this.stats[id].b++;
    }
    acc(id) { const s = this.stats[id]; return s ? s.a / (s.a + s.b) : 0.5; }
    n(id)   { const s = this.stats[id]; return s ? (s.a + s.b - 2) : 0; }
    blend(id, regime) {
        const g = this.acc(id);
        const r = regime ? this.acc(`${id}@${regime}`) : 0.5;
        const rn = regime ? this.n(`${id}@${regime}`) : 0;
        const rw = Math.min(1, rn / 20);
        return g * (1 - rw) + r * rw;
    }
    snapshot() {
        const out = {};
        for (const [id, s] of Object.entries(this.stats)) {
            const n = s.a + s.b - 2;
            out[id] = { n: Math.round(n), acc: n > 0 ? ((s.a - 1) / n * 100).toFixed(1) + "%" : "N/A" };
        }
        return out;
    }
}

class Calibrator {
    constructor() { this.bins = {}; }
    bin(c) { return Math.max(50, Math.min(95, Math.floor(c / 5) * 5)); }
    record(conf, ok) {
        const b = this.bin(conf);
        if (!this.bins[b]) this.bins[b] = { n: 0, ok: 0 };
        this.bins[b].n++;
        if (ok) this.bins[b].ok++;
    }
    calibrate(conf) {
        const s = this.bins[this.bin(conf)];
        if (!s || s.n < 15) return conf;
        return Math.round(conf * 0.6 + (s.ok / s.n * 100) * 0.4);
    }
    snapshot() {
        const out = {};
        for (const [k, v] of Object.entries(this.bins))
            if (v.n > 0) out[`${k}-${+k + 5}%`] = { n: v.n, actual: (v.ok / v.n * 100).toFixed(1) + "%" };
        return out;
    }
}

// ═══════════════════════════════════════════════════════════════════
//  ENGINE
// ═══════════════════════════════════════════════════════════════════
class Engine {
    constructor() {
        this.learner = new Learner(0.995);
        this.calibrator = new Calibrator();
        this.lastPred = null;
        this.cache = new Map();
        this.totalScored = 0;
        this.totalHit = 0;
    }

    buildContext(hist) {
        const key = hist[0]?.session;
        let cached = this.cache.get(key);
        if (!cached) {
            const f = analyze(hist);
            cached = { f, regime: detectRegime(f) };
            this.cache.set(key, cached);
            if (this.cache.size > 30) this.cache.delete(this.cache.keys().next().value);
        }
        return { f: cached.f, regime: cached.regime, basePreds: [] };
    }

    runBridges(hist, ctx, filter) {
        const out = [];
        for (const b of BRIDGES) {
            if (!filter(b)) continue;
            try {
                const r = b.fn(hist, ctx);
                if (r?.pred && r.pred !== "BÃO")
                    out.push({ id: b.id, name: b.name, cat: b.cat, pred: r.pred, conf: r.conf, src: r.src });
            } catch {}
        }
        return out;
    }

    predict(hist) {
        if (!hist.length) return { pred: "Xỉu", conf: 50, cau: "-", src: "chưa có dữ liệu", top: [], regime: "UNKNOWN" };
        if (bao(hist[0].dice)) return { pred: "BÃO", conf: 0, cau: "bão", src: "bão (nghỉ)", top: [], regime: "BÃO" };

        const next = hist[0].session + 1;
        if (this.lastPred && this.lastPred.session === next) return this.lastPred.result;

        const ctx = this.buildContext(hist);
        const base = this.runBridges(hist, ctx, b => b.cat !== "meta");
        for (const p of base) p.weight = this.learner.blend(p.id, ctx.regime);
        ctx.basePreds = base;
        const meta = this.runBridges(hist, ctx, b => b.cat === "meta");
        for (const p of meta) p.weight = this.learner.blend(p.id, ctx.regime);

        const all = [...base, ...meta];

        let t = 0, x = 0;
        for (const p of all) {
            const w = Math.pow(p.weight, 1.3) * Math.pow(p.conf / 100, 1.1);
            if (p.pred === "Tài") t += w; else x += w;
        }
        const tot = t + x;
        let pred, conf;
        if (tot === 0) { pred = opp(hist[0].result); conf = 52; }
        else {
            pred = t >= x ? "Tài" : "Xỉu";
            const r = Math.max(t, x) / tot;
            conf = Math.min(95, Math.round(r * 62 + Math.log2(all.length + 1) * 2.5));
            const adj = { PERSISTENT: 1.03, ANTIPERSISTENT: 1.02, ALTERNATING: 1.04, CYCLIC: 1.05, TRENDING: 1.03, CHAOTIC: 0.85, FATIGUE: 0.95 };
            conf = Math.round(conf * (adj[ctx.regime] || 1));
        }

        const sorted = [...all].sort((a, b) => b.conf * b.weight - a.conf * a.weight);
        const top10 = sorted.slice(0, 10);
        const topT = top10.filter(p => p.pred === "Tài").length;
        if (topT >= 9 || topT <= 1) conf = Math.min(95, conf + 4);

        const calibConf = this.calibrator.calibrate(conf);

        const result = {
            pred, conf: calibConf, rawConf: conf,
            regime: ctx.regime,
            cau: sorted[0]?.name || "-",
            src: `🧠 ${all.length} cầu | ${ctx.regime} | T${t.toFixed(1)}/X${x.toFixed(1)} | top10: ${topT}T/${10 - topT}X`,
            top: top10.map(p => ({
                name: p.name, cat: p.cat, pred: p.pred, conf: p.conf,
                acc: (p.weight * 100).toFixed(0) + "%",
            })),
            allBase: base.length,
            allMeta: meta.length,
        };

        this.lastPred = {
            session: next,
            regime: ctx.regime,
            predictions: base.map(p => ({ id: p.id, pred: p.pred })),
            finalPred: pred,
            conf,
            result,
        };
        return result;
    }

    onNew(newSess) {
        if (!this.lastPred) return;
        for (const s of newSess) {
            if (this.lastPred.session === s.session) {
                for (const p of this.lastPred.predictions)
                    this.learner.record(p.id, this.lastPred.regime, p.pred === s.result);
                const ok = this.lastPred.finalPred === s.result;
                this.calibrator.record(this.lastPred.conf, ok);
                if (ok) this.totalHit++;
                this.totalScored++;
                this.lastPred = null;
                return;
            }
        }
    }

    stats() {
        return {
            overall: this.totalScored ? (this.totalHit / this.totalScored * 100).toFixed(2) + "%" : "N/A",
            total: this.totalScored,
            hit: this.totalHit,
        };
    }
}

// ═══════════════════════════════════════════════════════════════════
//  PARSE / STATE / FETCH
// ═══════════════════════════════════════════════════════════════════
function parse(data, isMd5) {
    if (!data?.list || !Array.isArray(data.list)) return [];
    return data.list.map(it => {
        const point = Number(it.point);
        const result = isMd5 ? norm(it.resultTruyenThong, point) : (point >= 11 ? "Tài" : "Xỉu");
        return { session: it.id, dice: it.dices, total: point, result };
    }).sort((a, b) => b.session - a.session);
}

let hu = [], md5 = [], idHu = null, idMd5 = null;
const engHu = new Engine();
const engMd5 = new Engine();

async function tick(url, isMd5) {
    try {
        const data = await fetchJSON(url, 8000);
        const arr = parse(data, isMd5);
        if (!arr.length) return;
        const latest = arr[0].session;
        const cur = isMd5 ? idMd5 : idHu;
        const eng = isMd5 ? engMd5 : engHu;
        const tag = isMd5 ? "MD5" : "HŨ";

        if (!cur) {
            if (isMd5) { md5 = arr; idMd5 = latest; } else { hu = arr; idHu = latest; }
            console.log(`✅ [${tag}] ${arr.length} phiên | Mới: ${latest} (${arr[0].result})`);
        } else if (latest > cur) {
            const news = arr.filter(r => r.session > cur).sort((a, b) => a.session - b.session);
            const target = isMd5 ? md5 : hu;
            for (let i = news.length - 1; i >= 0; i--) target.unshift(news[i]);
            if (target.length > 500) target.length = 450;
            if (isMd5) idMd5 = latest; else idHu = latest;
            eng.onNew(news);
            console.log(`🆕 [${tag}] +${news.length} | Mới: ${latest} (${arr[0].result})`);
        }
    } catch (e) { console.error(`❌ [${isMd5 ? "MD5" : "HŨ"}]:`, e.message); }
}

// ═══════════════════════════════════════════════════════════════════
//  RESPONSE
// ═══════════════════════════════════════════════════════════════════
function resp(hist, eng) {
    const l = hist[0];
    const p = eng.predict(hist);
    const duDoan = p.pred === "Tài" ? "tài" : p.pred === "Xỉu" ? "xỉu" : "nghỉ";
    return {
        id: ADMIN,
        phien_truoc: l.session,
        xuc_xac: `${l.dice[0]} - ${l.dice[1]} - ${l.dice[2]}`,
        ket_qua: l.result.toLowerCase(),
        tong: l.total,
        phien_nay: l.session + 1,
        bieu_do_cau: chart(hist),
        du_doan: duDoan,
        do_tin_cay: `${p.conf}%`,
        cau_phat_hien: p.cau || "-",
        nguon: p.src || "-",
        regime: p.regime || "-",
        top_cau: p.top || [],
        so_cau_hoat_dong: (p.allBase || 0) + (p.allMeta || 0),
    };
}

// ═══════════════════════════════════════════════════════════════════
//  SERVER
// ═══════════════════════════════════════════════════════════════════
const app = fastify({ logger: false });
await app.register(cors, { origin: "*" });
const keyOK = q => q.key === VALID_KEY;

app.get("/", async () => ({
    status: "active",
    admin: ADMIN,
    engine: `Engine v7 | ${BRIDGES.length} cầu | ${Object.keys(A).length} analyzers`,
    loaded: { hu: hu.length, md5: md5.length },
    categories: Object.entries(CATS).map(([cat, n]) => ({
        cat, count: n, pct: (n / BRIDGES.length * 100).toFixed(1) + "%",
        bridges: BRIDGES.filter(b => b.cat === cat).map(b => b.name),
    })),
    endpoints: {
        hu: `/api/taixiu/lc79?key=${VALID_KEY}`,
        md5: `/api/taixiumd5/lc79?key=${VALID_KEY}`,
        debug_hu: `/api/debug/hu?key=${VALID_KEY}`,
        stats_hu: `/api/stats/hu?key=${VALID_KEY}`,
    }
}));

const send = (hist, eng, reply) =>
    hist.length ? resp(hist, eng) : reply.status(503).send({ error: "Đang tải dữ liệu..." });

app.get("/api/taixiu/:g", async (req, rep) =>
    keyOK(req.query) ? send(hu, engHu, rep) : rep.status(401).send({ error: `Sai key! Ib ${ADMIN}` }));
app.get("/api/taixiumd5/:g", async (req, rep) =>
    keyOK(req.query) ? send(md5, engMd5, rep) : rep.status(401).send({ error: `Sai key! Ib ${ADMIN}` }));

app.get("/api/stats/:loai", async (req, rep) => {
    if (!keyOK(req.query)) return rep.status(401).send({ error: "Sai key" });
    const eng = req.params.loai === "md5" ? engMd5 : engHu;
    const snapshot = eng.learner.snapshot();

    const byCat = {};
    for (const b of BRIDGES) {
        const s = snapshot[b.id];
        if (!s || s.n < 10) continue;
        if (!byCat[b.cat]) byCat[b.cat] = { n: 0, sum: 0, list: [] };
        byCat[b.cat].n++;
        byCat[b.cat].sum += parseFloat(s.acc);
        byCat[b.cat].list.push({ id: b.id, name: b.name, n: s.n, acc: s.acc });
    }
    for (const c of Object.values(byCat)) {
        c.avg = (c.sum / c.n).toFixed(1) + "%";
        c.list.sort((a, b) => parseFloat(b.acc) - parseFloat(a.acc));
    }

    return {
        ...eng.stats(),
        calibration: eng.calibrator.snapshot(),
        by_category: byCat,
        top_bridges: Object.entries(snapshot)
            .filter(([id]) => !id.includes("@"))
            .map(([id, s]) => ({ id, ...s }))
            .filter(x => x.n >= 15)
            .sort((a, b) => parseFloat(b.acc) - parseFloat(a.acc))
            .slice(0, 30),
    };
});

app.get("/api/debug/:loai", async (req, rep) => {
    if (!keyOK(req.query)) return rep.status(401).send({ error: "Sai key" });
    const h = req.params.loai === "md5" ? md5 : hu;
    const eng = req.params.loai === "md5" ? engMd5 : engHu;
    if (!h.length) return rep.status(503).send({ error: "Chưa đủ dữ liệu" });

    const ctx = eng.buildContext(h);
    const base = eng.runBridges(h, ctx, b => b.cat !== "meta");
    for (const p of base) p.weight = eng.learner.blend(p.id, ctx.regime);
    ctx.basePreds = base;
    const meta = eng.runBridges(h, ctx, b => b.cat === "meta");
    for (const p of meta) p.weight = eng.learner.blend(p.id, ctx.regime);
    const p = eng.predict(h);

    return {
        bieu_do_cau: chart(h),
        streak: streaks(h.slice(0, N)).map(s => `${s.type === "Tài" ? "T" : "X"}${s.len}`).join("-"),
        regime: ctx.regime,
        features: {
            entropy: ctx.f.entropy.toFixed(3),
            hurst: ctx.f.hurst.toFixed(3),
            vol: ctx.f.vol.toFixed(3),
            rsi: ctx.f.rsi.toFixed(1),
            zscore: ctx.f.zscore.toFixed(3),
            ac1: ctx.f.ac[0].toFixed(3),
            ac2: ctx.f.ac[1].toFixed(3),
            bayes: `${ctx.f.bayes.next}(${(ctx.f.bayes.prob * 100).toFixed(0)}%)`,
            markov1: ctx.f.markov.m1 ? `${ctx.f.markov.m1.next}(${(ctx.f.markov.m1.prob * 100).toFixed(0)}%)` : "-",
            markov2: ctx.f.markov.m2 ? `${ctx.f.markov.m2.next}(${(ctx.f.markov.m2.prob * 100).toFixed(0)}%)` : "-",
            cycle: ctx.f.cycle ? `P=${ctx.f.cycle.P} ${ctx.f.cycle.pred}` : "-",
            suffix: ctx.f.suffix ? `L=${ctx.f.suffix.L} → ${ctx.f.suffix.next}` : "-",
            cusum: ctx.f.cusum.dir,
        },
        base_bridges: base.sort((a, b) => b.conf - a.conf).map(d => ({
            id: d.id, name: d.name, cat: d.cat, pred: d.pred, conf: d.conf, src: d.src,
            acc: (d.weight * 100).toFixed(1) + "%", n: eng.learner.n(d.id),
        })),
        meta_bridges: meta.map(d => ({
            id: d.id, name: d.name, pred: d.pred, conf: d.conf, src: d.src,
            acc: (d.weight * 100).toFixed(1) + "%",
        })),
        final: { pred: p.pred, conf: `${p.conf}%`, raw: p.rawConf ? `${p.rawConf}%` : null, top: p.top },
    };
});

app.get("/check-key", async req =>
    req.query.key === VALID_KEY
        ? { status: "success", message: "KEY HỢP LỆ", admin: ADMIN }
        : { status: "error", message: `Sai key! Ib ${ADMIN}` });

// ═══════════════════════════════════════════════════════════════════
//  🚀 START — LISTEN TRƯỚC, FETCH NGẦM SAU
// ═══════════════════════════════════════════════════════════════════
try {
    await app.listen({ port: PORT, host: "0.0.0.0" });
    console.log(`🚀 Server ONLINE tại http://localhost:${PORT}`);
} catch (err) {
    console.error("❌ Lỗi khởi động:", err.message);
    process.exit(1);
}

tick(API_HU, false).catch(() => {});
tick(API_MD5, true).catch(() => {});
setInterval(() => tick(API_HU, false).catch(() => {}), 5000);
setInterval(() => tick(API_MD5, true).catch(() => {}), 5000);

console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║  🚀 TÀI XỈU LC79 — ENGINE v7                                             ║
╠══════════════════════════════════════════════════════════════════════════╣
║  🔑 KEY: ${VALID_KEY}                                                    ║
║  👤 ADMIN: ${ADMIN}                                                      ║
║                                                                          ║
║  📊 ${Object.keys(A).length} THUẬT TOÁN:  StreakStats, Shannon, Autocorr, Markov v1,        ║
║     Markov v2, Markov W, CycleAuto, Suffix, KNN, RSI,                    ║
║     Volatility, CUSUM, Hurst, ZScore, BayesPosterior, Recurrence         ║
║                                                                          ║
║  🎯 ${BRIDGES.length} CẦU — FULL:                                                       ║
║     • Bệt (7)         : bệt-2 → bệt-8+                                   ║
║     • Xen kẽ (7)      : 1-1, 2-2, 3-3, 4-4, 5-5, 1-2, 2-1                ║
║     • Kép (6)         : 1-3, 3-1, 1-4, 4-1, 2-3, 3-2                      ║
║     • Nhịp 3 (6)      : 1-2-1, 2-1-2, 1-3-1, 3-1-3, 1-2-3, 3-2-1         ║
║     • Chu kỳ (7)      : P=2..8                                           ║
║     • Markov (4)      : v1, v2, bậc-3, weighted                          ║
║     • Pattern (5)     : n-gram 3/4/5, suffix, recurrence                 ║
║     • KNN (2)         : k=3, k=5                                         ║
║     • Rev (2)         : mean-rev, momentum                               ║
║     • Stat (3)        : z-score, entropy, volatility                     ║
║     • Dice (3)        : tổng trend, mod, lặp                             ║
║     • Risk (2)        : CUSUM, RSI                                       ║
║     • Complex (2)     : Hurst, Bayes                                     ║
║     • Meta (3)        : vote, consensus, weighted                        ║
║                                                                          ║
║  📌 API:                                                                 ║
║     HŨ   : /api/taixiu/lc79?key=${VALID_KEY}                            ║
║     DEBUG: /api/debug/hu?key=${VALID_KEY}                               ║
║     STATS: /api/stats/hu?key=${VALID_KEY}                               ║
╚══════════════════════════════════════════════════════════════════════════╝
`);