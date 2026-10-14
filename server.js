import fastify from "fastify";
import cors from "@fastify/cors";
import fetch from "node-fetch";

// ═══════════════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════════════
const PORT      = process.env.PORT || 3000;
const VALID_KEY = "Thien456";
const ADMIN     = "@ADMNLc79";
const N         = 30;

const API_HU  = "https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5";
const API_MD5 = "https://wtxmd52.tele68.com/v1/txmd5/sessions";

// ═══════════════════════════════════════════════════════════════════
//  CORE HELPERS
// ═══════════════════════════════════════════════════════════════════
function norm(val, point) {
    if (val != null) {
        const s = String(val).toLowerCase().trim();
        if (["tài","tai","t","big"].includes(s)) return "Tài";
        if (["xỉu","xiu","x","small"].includes(s)) return "Xỉu";
    }
    return Number(point) >= 11 ? "Tài" : "Xỉu";
}
const opp    = x => x === "Tài" ? "Xỉu" : "Tài";
const bao    = d => d?.[0] === d?.[1] && d?.[1] === d?.[2];
const toBit  = r => r === "Tài" ? 1 : 0;
const toChar = r => r === "Tài" ? "T" : "X";
const chrono = (h, n = 100) => h.slice(0, n).map(x => x.result).reverse();
const bitsOf = (h, n = 100) => chrono(h, n).map(toBit);
const charsOf= (h, n = 100) => chrono(h, n).map(toChar).join("");

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
const chart = h => h.slice(0, N).reverse().map(x => toChar(x.result)).join("");

// ═══════════════════════════════════════════════════════════════════
//  MATH / FEATURES
// ═══════════════════════════════════════════════════════════════════
const H2 = p => (p <= 0 || p >= 1) ? 0 : -p * Math.log2(p) - (1 - p) * Math.log2(1 - p);

function autocorr(bits, lag) {
    const n = bits.length;
    if (n <= lag) return 0;
    let m = 0;
    for (let i = 0; i < n - lag; i++) if (bits[i] === bits[i + lag]) m++;
    return m / (n - lag);
}

function dft(bits) {
    const n = bits.length, out = [];
    for (let k = 1; k <= Math.min(15, Math.floor(n / 2)); k++) {
        let re = 0, im = 0;
        for (let t = 0; t < n; t++) {
            const th = -2 * Math.PI * k * t / n;
            re += bits[t] * Math.cos(th);
            im += bits[t] * Math.sin(th);
        }
        out.push({ k, mag: Math.hypot(re, im) / n });
    }
    return out;
}

function lempelZiv(s) {
    let i = 0, c = 1, l = 1;
    while (i + l <= s.length) {
        if (s.slice(i, i + l).includes(s.slice(i + l, i + l + 1))) l++;
        else { i += l; l = 1; c++; }
    }
    return c / s.length;
}

function permutationEntropy(bits, m = 3) {
    const counts = {};
    for (let i = 0; i <= bits.length - m; i++) {
        const win = bits.slice(i, i + m);
        const perm = win.map((v, idx) => ({ v, idx })).sort((a, b) => a.v - b.v).map(x => x.idx).join("");
        counts[perm] = (counts[perm] || 0) + 1;
    }
    const n = Object.values(counts).reduce((a, b) => a + b, 0);
    let H = 0;
    for (const c of Object.values(counts)) { const p = c / n; H -= p * Math.log2(p); }
    return H / Math.log2(6);
}

function hurst(bits) {
    const n = bits.length;
    if (n < 20) return 0.5;
    const lags = [2, 4, 8, 16].filter(l => l < n / 2);
    if (lags.length < 2) return 0.5;
    const taus = lags.map(l => {
        const d = [];
        for (let i = 0; i + l < n; i += l) {
            const seg = bits.slice(i, i + l);
            d.push(Math.abs(seg[seg.length - 1] - seg[0]));
        }
        return Math.sqrt(d.reduce((a, b) => a + b * b, 0) / d.length) || 1e-6;
    });
    const logL = lags.map(Math.log), logT = taus.map(Math.log);
    const mx = logL.reduce((a, b) => a + b, 0) / logL.length;
    const my = logT.reduce((a, b) => a + b, 0) / logT.length;
    let num = 0, den = 0;
    for (let i = 0; i < lags.length; i++) { num += (logL[i] - mx) * (logT[i] - my); den += (logL[i] - mx) ** 2; }
    return den ? num / den : 0.5;
}

function extractFeatures(h) {
    const bits = bitsOf(h, 80);
    const n = bits.length;
    if (n < 10) return null;
    const pT = bits.reduce((a, b) => a + b, 0) / n;
    const ac = [1,2,3,4,5,6].map(k => autocorr(bits, k));
    let alt = 0;
    for (let i = 1; i < Math.min(25, n); i++) if (bits[i] !== bits[i - 1]) alt++;
    const st = streaks(h);
    const slens = st.slice(0, 20).map(s => s.len);
    return {
        n, pT, pX: 1 - pT, entropy: H2(pT), ac, altRate: alt / Math.min(24, n - 1),
        st, curStreak: st[0]?.len || 0, curType: st[0]?.type || null,
        avgSt: slens.reduce((a, b) => a + b, 0) / slens.length,
        maxSt: Math.max(...slens, 0), slens,
        bits, chars: charsOf(h, 80),
        ratios: {
            r5:  bits.slice(-5).reduce((a, b) => a + b, 0) / 5,
            r10: bits.slice(-10).reduce((a, b) => a + b, 0) / 10,
            r20: bits.slice(-20).reduce((a, b) => a + b, 0) / 20,
            r50: bits.slice(-50).reduce((a, b) => a + b, 0) / 50,
        },
        dft: dft(bits),
        pe: permutationEntropy(bits, 3),
        lz: lempelZiv(bits.slice(-40).join("")),
        hurst: hurst(bits),
    };
}

function detectRegime(f) {
    if (!f) return "UNKNOWN";
    const { entropy, ac, altRate, pT, curStreak, maxSt, hurst } = f;
    if (hurst > 0.68) return "PERSISTENT";
    if (hurst < 0.35) return "ANTIPERSISTENT";
    if (entropy > 0.98 && ac[0] < 0.5 && altRate > 0.55) return "CHAOTIC";
    if (altRate > 0.62 && ac[0] < 0.4) return "ALTERNATING";
    if (entropy < 0.85 && ac[0] > 0.7 && maxSt >= 4) return "TRENDING";
    if (pT > 0.68) return "TREND_TAI";
    if (pT < 0.32) return "TREND_XIU";
    if (curStreak >= 9) return "FATIGUE";
    if (curStreak >= 6) return "STREAK";
    if (entropy < 0.9 && ac[1] > 0.5) return "CYCLIC";
    return "NORMAL";
}

// ═══════════════════════════════════════════════════════════════════
//  BRIDGE REGISTRY — 150+ detectors, each with UNIQUE logic
// ═══════════════════════════════════════════════════════════════════
const BRIDGES = [];
const B = (cat, id, name, fn) => BRIDGES.push({ cat, id, name, fn });

// ─── I. STREAK FAMILY (10) ─────────────────────────────────────────
B("streak", "s_cont", "Bệt tiếp diễn", (h, c) => {
    const cur = c.f.st[0];
    if (!cur || cur.len < 3 || cur.len > 6) return null;
    if (cur.len / c.f.avgSt > 1.6) return null;
    return { pred: cur.type, conf: 62 + cur.len * 2, src: `bệt ${cur.len} cân bằng → theo` };
});

B("streak", "s_break", "Bệt bẻ sớm", (h, c) => {
    const cur = c.f.st[0];
    if (!cur || cur.len < 8) return null;
    return { pred: opp(cur.type), conf: Math.min(88, 68 + (cur.len - 8) * 3), src: `bệt ${cur.len} → BẺ` };
});

B("streak", "s_fatigue", "Bệt mỏi (mũ)", (h, c) => {
    const cur = c.f.st[0];
    if (!cur || cur.len < 6) return null;
    const pB = 1 - Math.pow(0.55, cur.len - 5);
    const pred = pB > 0.5 ? opp(cur.type) : cur.type;
    return { pred, conf: Math.round(56 + Math.abs(pB - 0.5) * 60), src: `mỏi ${cur.len} (P_break=${(pB * 100).toFixed(0)}%)` };
});

B("streak", "s_mom", "Động lượng bệt", (h, c) => {
    const L = c.f.slens;
    if (L.length < 4) return null;
    const d1 = L[0] - L[1], d2 = L[1] - L[2], d3 = L[2] - L[3];
    if (d1 > 0 && d2 > 0 && d3 > 0) return { pred: c.f.curType, conf: 70, src: `bệt tăng liên tục ${L[3]}→${L[2]}→${L[1]}→${L[0]}` };
    if (d1 < 0 && d2 < 0 && d3 < 0) return { pred: opp(c.f.curType), conf: 68, src: `bệt giảm liên tục` };
    return null;
});

B("streak", "s_ratio", "Tỷ lệ bệt", (h, c) => {
    const cur = c.f.st[0];
    if (!cur || cur.len < 3) return null;
    const r = cur.len / c.f.avgSt;
    if (r > 2.5) return { pred: opp(cur.type), conf: 72, src: `bệt ${cur.len} / avg ${c.f.avgSt.toFixed(1)} = ${r.toFixed(1)}x` };
    if (r < 0.8 && cur.len >= 3) return { pred: cur.type, conf: 62, src: `bệt dưới trung bình` };
    return null;
});

B("streak", "s_pressure", "Áp lực đối kháng", (h, c) => {
    const b = c.f.bits.slice(-12);
    const t = b.reduce((a, x) => a + x, 0), x = 12 - t;
    if (Math.abs(t - x) < 5) return null;
    const cur = c.f.st[0];
    if (!cur || cur.len < 4) return null;
    if (cur.type === "Tài" && x > t + 2) return { pred: "Xỉu", conf: 68, src: `bệt Tài nhưng Xỉu áp lực ${x}/12` };
    if (cur.type === "Xỉu" && t > x + 2) return { pred: "Tài", conf: 68, src: `bệt Xỉu nhưng Tài áp lực ${t}/12` };
    return null;
});

B("streak", "s_transmat", "Ma trận chuyển bệt", (h, c) => {
    const slens = c.f.slens;
    if (slens.length < 8) return null;
    const cur = c.f.st[0];
    if (!cur || cur.len < 2) return null;
    // P(next streak opposite | current length ≥ cur.len)
    let same = 0, broke = 0;
    for (let i = 1; i < slens.length; i++) if (slens[i] >= cur.len) { i % 2 === 0 ? same++ : broke++; }
    const tot = same + broke;
    if (tot < 3) return null;
    const pB = broke / tot;
    if (pB > 0.65) return { pred: opp(cur.type), conf: Math.round(55 + pB * 25), src: `bệt ≥ ${cur.len} bẻ ${(pB * 100).toFixed(0)}%` };
    if (pB < 0.35) return { pred: cur.type, conf: Math.round(55 + (1 - pB) * 25), src: `bệt ≥ ${cur.len} tiếp ${((1 - pB) * 100).toFixed(0)}%` };
    return null;
});

B("streak", "s_exhaust", "Bệt kiệt sức", (h, c) => {
    const cur = c.f.st[0];
    if (!cur || cur.len < 5) return null;
    const last = h[0].result;
    const recentOpp = h.slice(0, Math.min(cur.len, 10)).filter(x => x.result !== last).length;
    if (recentOpp >= 4) return { pred: opp(cur.type), conf: 70, src: `bệt ${cur.len} có ${recentOpp} đối kháng gần` };
    return null;
});

B("streak", "s_short", "Bệt ngắn 2", (h, c) => {
    const st = c.f.st;
    if (st.length < 4) return null;
    if (st[1].len !== 2 || st[2].len !== 2) return null;
    if (st[0].len !== 2) return null;
    return { pred: opp(st[0].type), conf: 72, src: `chuỗi bệt-2 liên tiếp → bẻ` };
});

B("streak", "s_alt_streak", "Bệt so le (short/long)", (h, c) => {
    const L = c.f.slens;
    if (L.length < 5) return null;
    const isShort = x => x <= 2, isLong = x => x >= 4;
    if (isShort(L[1]) && isLong(L[2]) && isShort(L[3]) && isLong(L[4])) {
        return { pred: opp(c.f.curType), conf: 70, src: `nhịp ngắn-dài-ngắn-dài → bẻ ngắn` };
    }
    return null;
});

// ─── II. ALTERNATING (12) ──────────────────────────────────────────
function altDetector(A, B_, name, conf) {
    return (h, c) => {
        const st = c.f.st;
        if (st.length < 6) return null;
        if (st[1].len !== A && st[1].len !== B_) return null;
        const first = st[1].len, second = first === A ? B_ : A;
        for (let i = 2; i <= 5; i++) if (st[i].len !== (i % 2 === 0 ? second : first)) return null;
        const tgt = second, cur = st[0];
        if (cur.len < tgt) return { pred: cur.type, conf: conf - 4, src: `xen kẽ ${name} (${cur.len}/${tgt})` };
        if (cur.len === tgt) return { pred: opp(cur.type), conf, src: `xen kẽ ${name} (đảo)` };
        return null;
    };
}
B("alt", "a_11", "Xen kẽ 1-1", altDetector(1, 1, "1-1", 80));
B("alt", "a_22", "Xen kẽ 2-2", altDetector(2, 2, "2-2", 78));
B("alt", "a_33", "Xen kẽ 3-3", altDetector(3, 3, "3-3", 76));
B("alt", "a_44", "Xen kẽ 4-4", altDetector(4, 4, "4-4", 72));

B("alt", "a_12", "Xen kẽ 1-2", altDetector(1, 2, "1-2", 76));
B("alt", "a_21", "Xen kẽ 2-1", altDetector(2, 1, "2-1", 76));
B("alt", "a_13", "Xen kẽ 1-3", altDetector(1, 3, "1-3", 74));
B("alt", "a_31", "Xen kẽ 3-1", altDetector(3, 1, "3-1", 74));
B("alt", "a_23", "Xen kẽ 2-3", altDetector(2, 3, "2-3", 72));
B("alt", "a_32", "Xen kẽ 3-2", altDetector(3, 2, "3-2", 72));

B("alt", "a_inc", "Xen kẽ tăng dần", (h, c) => {
    const L = c.f.slens;
    if (L.length < 5) return null;
    if (L[1] < L[2] && L[2] < L[3] && L[3] < L[4] && L[1] >= 1) {
        const nxt = L[1] - 1 >= 1 ? L[1] - 1 : 1;
        return { pred: opp(c.f.curType), conf: 68, src: `xen kẽ tăng ${L[4]}→${L[3]}→${L[2]}→${L[1]} → bẻ ở ${nxt}` };
    }
    return null;
});

B("alt", "a_dec", "Xen kẽ giảm dần", (h, c) => {
    const L = c.f.slens;
    if (L.length < 5) return null;
    if (L[1] > L[2] && L[2] > L[3] && L[3] > L[4]) {
        return { pred: opp(c.f.curType), conf: 68, src: `xen kẽ giảm ${L[4]}→${L[3]}→${L[2]}→${L[1]}` };
    }
    return null;
});

// ─── III. CYCLE (14) ───────────────────────────────────────────────
function cycleFixed(P, conf) {
    return (h, c) => {
        const ch = c.f.chars.slice(-P * 3);
        if (ch.length < P * 2 + 1) return null;
        let m = 0, t = 0;
        for (let i = 0; i < ch.length - P; i++) { t++; if (ch[i] === ch[i + P]) m++; }
        if (t < P * 2) return null;
        const score = m / t;
        if (score < 0.85) return null;
        const next = ch[ch.length - P];
        return { pred: next === "T" ? "Tài" : "Xỉu", conf: Math.round(conf * score), src: `chu kỳ P=${P} (${(score * 100).toFixed(0)}%)` };
    };
}
for (const P of [2,3,4,5,6,7,8]) B("cycle", `c_${P}`, `Chu kỳ ${P}`, cycleFixed(P, 76 - P));

B("cycle", "c_var", "Chu kỳ biến thiên", (h, c) => {
    // find repeating pattern in streak lengths
    const L = c.f.slens.slice(0, 20);
    if (L.length < 8) return null;
    for (let P = 2; P <= 5; P++) {
        let m = 0, t = 0;
        for (let i = 0; i < L.length - P; i++) { t++; if (L[i] === L[i + P]) m++; }
        if (t < 4) continue;
        if (m / t >= 0.9) {
            const nextL = L[P - 1];
            const cur = c.f.st[0];
            if (cur.len < nextL) return { pred: cur.type, conf: 70, src: `chu kỳ var P=${P} (${cur.len}/${nextL})` };
            if (cur.len === nextL) return { pred: opp(cur.type), conf: 72, src: `chu kỳ var P=${P} (đảo)` };
        }
    }
    return null;
});

B("cycle", "c_auto", "Chu kỳ (autocorr peak)", (h, c) => {
    const ac = c.f.ac;
    let bestLag = -1, bestVal = 0;
    for (let i = 1; i < ac.length; i++) if (ac[i] > bestVal) { bestVal = ac[i]; bestLag = i + 1; }
    if (bestLag < 2 || bestVal < 0.7) return null;
    const bits = c.f.bits;
    const next = bits[bits.length - bestLag];
    return { pred: next === 1 ? "Tài" : "Xỉu", conf: Math.round(58 + bestVal * 25), src: `autocorr peak lag=${bestLag} (${bestVal.toFixed(2)})` };
});

B("cycle", "c_fft", "Chu kỳ (FFT)", (h, c) => {
    const d = c.f.dft;
    if (!d.length) return null;
    const best = d.reduce((a, b) => b.mag > a.mag ? b : a);
    if (best.mag < 0.15) return null;
    const bits = c.f.bits;
    const next = bits[bits.length - best.k] ?? bits[bits.length - 1];
    return { pred: next === 1 ? "Tài" : "Xỉu", conf: Math.round(60 + best.mag * 100), src: `FFT dominant k=${best.k} (${best.mag.toFixed(3)})` };
});

B("cycle", "c_dom", "Chu kỳ trội (2nd harm)", (h, c) => {
    const d = c.f.dft.sort((a, b) => b.mag - a.mag);
    if (d.length < 2) return null;
    const k = d[1].k;
    const bits = c.f.bits;
    const next = bits[bits.length - k] ?? bits[bits.length - 1];
    return { pred: next === 1 ? "Tài" : "Xỉu", conf: 66, src: `2nd harmonic k=${k}` };
});

B("cycle", "c_phase", "Chu kỳ lệch pha", (h, c) => {
    // detect cycle with phase offset
    const ch = c.f.chars.slice(-24);
    for (let P = 3; P <= 6; P++) {
        for (let ph = 1; ph < P; ph++) {
            let m = 0, t = 0;
            for (let i = ph; i < ch.length - P + ph; i++) {
                t++;
                if (ch[i] === ch[i - P]) m++;
            }
            if (t < 6) continue;
            if (m / t >= 0.9) {
                const next = ch[ch.length - P + ph] ?? ch[ch.length - 1];
                return { pred: next === "T" ? "Tài" : "Xỉu", conf: 68, src: `chu kỳ lệch pha P=${P} ph=${ph}` };
            }
        }
    }
    return null;
});

B("cycle", "c_nested", "Chu kỳ lồng", (h, c) => {
    const ch = c.f.chars.slice(-30);
    if (ch.length < 12) return null;
    const small = ch.slice(-6);
    const big = ch.slice(-12, -6);
    if (small === big) {
        const nxt = small[0];
        return { pred: nxt === "T" ? "Tài" : "Xỉu", conf: 72, src: `chu kỳ lồng 6+6` };
    }
    return null;
});

B("cycle", "c_wavelet", "Chu kỳ wavelet", (h, c) => {
    const bits = c.f.bits.slice(-40);
    const scales = [2, 4, 8, 16];
    const energies = scales.map(s => {
        let e = 0;
        for (let i = 0; i + s < bits.length; i++) e += (bits[i + s] - bits[i]) ** 2;
        return e / (bits.length - s);
    });
    const total = energies.reduce((a, b) => a + b, 0);
    if (!total) return null;
    const dom = energies.indexOf(Math.max(...energies));
    const k = scales[dom];
    const next = bits[bits.length - k] ?? bits[bits.length - 1];
    return { pred: next === 1 ? "Tài" : "Xỉu", conf: 64, src: `wavelet dom scale=${k}` };
});

B("cycle", "c_zero", "Zero-crossing", (h, c) => {
    const b = c.f.bits.slice(-30);
    let crossings = 0, lastZ = -1;
    for (let i = 1; i < b.length; i++) if (b[i] !== b[i - 1]) crossings++;
    const period = b.length / Math.max(1, crossings);
    if (period < 1.2) return null;
    const pred = b[b.length - Math.round(period)] ?? b[b.length - 1];
    return { pred: pred === 1 ? "Tài" : "Xỉu", conf: 62, src: `zero-cross period=${period.toFixed(1)}` };
});

B("cycle", "c_hilbert", "Chu kỳ Hilbert", (h, c) => {
    const b = c.f.bits.slice(-30);
    // simple analytic signal
    let sumRe = 0, sumIm = 0;
    for (let i = 0; i < b.length; i++) {
        const t = i / b.length;
        sumRe += (b[i] * 2 - 1) * Math.cos(2 * Math.PI * t);
        sumIm += (b[i] * 2 - 1) * Math.sin(2 * Math.PI * t);
    }
    const phase = Math.atan2(sumIm, sumRe);
    const pred = Math.cos(phase) > 0 ? "Tài" : "Xỉu";
    return { pred, conf: 60, src: `Hilbert phase=${phase.toFixed(2)}` };
});

B("cycle", "c_subharm", "Chu kỳ hạ âm", (h, c) => {
    const d = c.f.dft.sort((a, b) => b.mag - a.mag);
    if (!d.length) return null;
    const k = Math.max(2, Math.round(d[0].k / 2));
    const bits = c.f.bits;
    const next = bits[bits.length - k] ?? bits[bits.length - 1];
    return { pred: next === 1 ? "Tài" : "Xỉu", conf: 62, src: `sub-harm k=${k}` };
});

B("cycle", "c_superharm", "Chu kỳ thượng âm", (h, c) => {
    const d = c.f.dft.sort((a, b) => b.mag - a.mag);
    if (!d.length) return null;
    const k = Math.min(bits_len(c.f.bits), d[0].k * 2);
    const next = c.f.bits[c.f.bits.length - k] ?? c.f.bits[c.f.bits.length - 1];
    return { pred: next === 1 ? "Tài" : "Xỉu", conf: 62, src: `super-harm k=${k}` };
});
function bits_len(b) { return b.length; }

// ─── IV. MARKOV (8) ────────────────────────────────────────────────
function markovDetector(order, weighted, smooth, name) {
    return (h, c) => {
        const ch = chrono(h, 60);
        if (ch.length < order + 15) return null;
        const counts = {};
        for (let i = 0; i < ch.length - order; i++) {
            const state = ch.slice(i, i + order).map(toChar).join("");
            const nxt = ch[i + order];
            const w = weighted ? Math.pow(0.97, ch.length - i) : 1;
            if (!counts[state]) counts[state] = { T: smooth, X: smooth, n: 0 };
            counts[state][nxt === "Tài" ? "T" : "X"] += w;
            counts[state].n += w;
        }
        const cur = ch.slice(-order).map(toChar).join("");
        const s = counts[cur];
        if (!s || s.n < 2) return null;
        const pT = s.T / (s.T + s.X);
        const pred = pT > 0.5 ? "Tài" : "Xỉu";
        const p = Math.max(pT, 1 - pT);
        return { pred, conf: Math.round(55 + p * 35), src: `${name} [${cur}] → ${pred} (${(p * 100).toFixed(0)}%)` };
    };
}
B("markov", "mk1",  "Markov bậc 1",   markovDetector(1, false, 0, "MK1"));
B("markov", "mk2",  "Markov bậc 2",   markovDetector(2, false, 0, "MK2"));
B("markov", "mk3",  "Markov bậc 3",   markovDetector(3, false, 0, "MK3"));
B("markov", "mk4",  "Markov bậc 4",   markovDetector(4, false, 0, "MK4"));
B("markov", "mk5",  "Markov bậc 5",   markovDetector(5, false, 0, "MK5"));
B("markov", "mk6",  "Markov bậc 6",   markovDetector(6, false, 0, "MK6"));
B("markov", "mkW",  "Markov có trọng số", markovDetector(3, true, 0, "MKW"));
B("markov", "mkS",  "Markov làm mượt", markovDetector(3, false, 1, "MKS"));

// ─── V. PATTERN MATCHING (10) ──────────────────────────────────────
B("pat", "ng3", "Khớp n-gram 3", (h, c) => {
    const ch = c.f.chars;
    if (ch.length < 15) return null;
    const suf = ch.slice(-3), body = ch.slice(0, -1);
    const idx = body.lastIndexOf(suf);
    if (idx < 0 || idx + 3 >= ch.length) return null;
    const nxt = ch[idx + 3];
    return { pred: nxt === "T" ? "Tài" : "Xỉu", conf: 66, src: `n-gram3 "${suf}" → ${nxt}` };
});
B("pat", "ng4", "Khớp n-gram 4", (h, c) => {
    const ch = c.f.chars;
    if (ch.length < 20) return null;
    const suf = ch.slice(-4), body = ch.slice(0, -1);
    const idx = body.lastIndexOf(suf);
    if (idx < 0) return null;
    const nxt = ch[idx + 4];
    return { pred: nxt === "T" ? "Tài" : "Xỉu", conf: 68, src: `n-gram4 "${suf}" → ${nxt}` };
});
B("pat", "ng5", "Khớp n-gram 5", (h, c) => {
    const ch = c.f.chars;
    if (ch.length < 25) return null;
    const suf = ch.slice(-5), body = ch.slice(0, -1);
    const idx = body.lastIndexOf(suf);
    if (idx < 0) return null;
    const nxt = ch[idx + 5];
    return { pred: nxt === "T" ? "Tài" : "Xỉu", conf: 70, src: `n-gram5 "${suf}" → ${nxt}` };
});
B("pat", "ng6", "Khớp n-gram 6", (h, c) => {
    const ch = c.f.chars;
    if (ch.length < 30) return null;
    const suf = ch.slice(-6), body = ch.slice(0, -1);
    const idx = body.lastIndexOf(suf);
    if (idx < 0) return null;
    const nxt = ch[idx + 6];
    return { pred: nxt === "T" ? "Tài" : "Xỉu", conf: 72, src: `n-gram6 "${suf}" → ${nxt}` };
});
B("pat", "ng8", "Khớp n-gram 8", (h, c) => {
    const ch = c.f.chars;
    if (ch.length < 40) return null;
    const suf = ch.slice(-8), body = ch.slice(0, -1);
    const idx = body.lastIndexOf(suf);
    if (idx < 0) return null;
    const nxt = ch[idx + 8];
    return { pred: nxt === "T" ? "Tài" : "Xỉu", conf: 74, src: `n-gram8 "${suf}" → ${nxt}` };
});

function knn(h, c, k, weighted) {
    const bits = c.f.bits.slice(-40);
    if (bits.length < 12) return null;
    const q = bits.slice(-4);
    const sims = [];
    for (let i = 0; i + 4 < bits.length - 1; i++) {
        const s = bits.slice(i, i + 4);
        let d = 0;
        for (let j = 0; j < 4; j++) d += Math.abs(s[j] - q[j]);
        sims.push({ d, nxt: bits[i + 4], i });
    }
    sims.sort((a, b) => a.d - b.d);
    const top = sims.slice(0, k);
    if (!top.length) return null;
    let scoreT = 0, scoreX = 0;
    for (const s of top) {
        const w = weighted ? 1 / (1 + s.d) : 1;
        if (s.nxt === 1) scoreT += w; else scoreX += w;
    }
    const pred = scoreT > scoreX ? "Tài" : "Xỉu";
    const conf = Math.round(60 + Math.abs(scoreT - scoreX) / (scoreT + scoreX) * 20);
    return { pred, conf, src: `KNN k=${k}${weighted ? "w" : ""} (T${scoreT.toFixed(1)}/X${scoreX.toFixed(1)})` };
}
B("pat", "knn3", "KNN k=3", (h, c) => knn(h, c, 3, false));
B("pat", "knn5", "KNN k=5", (h, c) => knn(h, c, 5, false));
B("pat", "knn7", "KNN k=7", (h, c) => knn(h, c, 7, false));
B("pat", "knnW", "KNN có trọng số", (h, c) => knn(h, c, 5, true));
B("pat", "suffix", "Hậu tố dài nhất", (h, c) => {
    const ch = c.f.chars;
    if (ch.length < 20) return null;
    for (let L = 12; L >= 2; L--) {
        const suf = ch.slice(-L), body = ch.slice(0, -1);
        const idx = body.lastIndexOf(suf);
        if (idx >= 0 && idx + L < ch.length) {
            const nxt = ch[idx + L];
            return { pred: nxt === "T" ? "Tài" : "Xỉu", conf: 62 + L, src: `suffix L=${L} → ${nxt}` };
        }
    }
    return null;
});

// ─── VI. STATISTICAL (12) ──────────────────────────────────────────
B("stat", "mean_rev", "Hồi quy trung bình", (h, c) => {
    const { r20, r50 } = c.f.ratios;
    if (r20 > 0.7) return { pred: "Xỉu", conf: 66, src: `r20=${r20.toFixed(2)} → đảo` };
    if (r20 < 0.3) return { pred: "Tài", conf: 66, src: `r20=${r20.toFixed(2)} → đảo` };
    return null;
});

B("stat", "mom_s", "Động lượng ngắn", (h, c) => {
    const { r5, r20 } = c.f.ratios;
    if (r5 > 0.8 && r20 < 0.6) return { pred: "Tài", conf: 64, src: `mom short Tài (r5=${r5.toFixed(2)})` };
    if (r5 < 0.2 && r20 > 0.4) return { pred: "Xỉu", conf: 64, src: `mom short Xỉu` };
    return null;
});

B("stat", "mom_l", "Động lượng dài", (h, c) => {
    const { r50 } = c.f.ratios;
    if (r50 > 0.65) return { pred: "Tài", conf: 62, src: `mom long Tài (r50=${r50.toFixed(2)})` };
    if (r50 < 0.35) return { pred: "Xỉu", conf: 62, src: `mom long Xỉu` };
    return null;
});

B("stat", "vol", "Biến động", (h, c) => {
    const b = c.f.bits.slice(-20);
    let v = 0;
    for (let i = 1; i < b.length; i++) v += b[i] !== b[i - 1] ? 1 : 0;
    v /= b.length - 1;
    if (v > 0.7) return { pred: c.f.curType ? opp(c.f.curType) : "Tài", conf: 64, src: `vol cao ${(v * 100).toFixed(0)}% → đảo` };
    if (v < 0.25) return { pred: c.f.curType || "Tài", conf: 66, src: `vol thấp ${(v * 100).toFixed(0)}% → theo` };
    return null;
});

B("stat", "hot", "Hot-hand", (h, c) => {
    const t = c.f.ratios.r10 > 0.8, x = c.f.ratios.r10 < 0.2;
    if (t) return { pred: "Tài", conf: 62, src: `hot-hand Tài (r10=${c.f.ratios.r10.toFixed(2)})` };
    if (x) return { pred: "Xỉu", conf: 62, src: `hot-hand Xỉu` };
    return null;
});

B("stat", "gambler", "Gambler's fallacy", (h, c) => {
    const t = c.f.ratios.r20 > 0.7, x = c.f.ratios.r20 < 0.3;
    if (t) return { pred: "Xỉu", conf: 60, src: `20 phiên Tài nhiều → Xỉu` };
    if (x) return { pred: "Tài", conf: 60, src: `20 phiên Xỉu nhiều → Tài` };
    return null;
});

B("stat", "zscore", "Z-score", (h, c) => {
    const bits = c.f.bits.slice(-30);
    const m = bits.reduce((a, b) => a + b, 0) / bits.length;
    const v = bits.reduce((a, b) => a + (b - m) ** 2, 0) / bits.length;
    const sd = Math.sqrt(v) || 1e-6;
    const z = (bits[bits.length - 1] - m) / sd;
    if (z > 1.5) return { pred: "Xỉu", conf: 66, src: `z=${z.toFixed(2)} → đảo` };
    if (z < -1.5) return { pred: "Tài", conf: 66, src: `z=${z.toFixed(2)} → đảo` };
    return null;
});

B("stat", "chisq", "Chi-square", (h, c) => {
    const bits = c.f.bits.slice(-30);
    const t = bits.reduce((a, b) => a + b, 0), x = bits.length - t;
    const exp = bits.length / 2;
    const chi = ((t - exp) ** 2) / exp + ((x - exp) ** 2) / exp;
    if (chi > 4) return { pred: t > x ? "Xỉu" : "Tài", conf: 65, src: `chi²=${chi.toFixed(2)}` };
    return null;
});

B("stat", "skew", "Độ xiên", (h, c) => {
    const b = c.f.bits.slice(-30);
    const m = b.reduce((a, x) => a + x, 0) / b.length;
    const s2 = Math.sqrt(b.reduce((a, x) => a + (x - m) ** 2, 0) / b.length) || 1e-6;
    const s3 = b.reduce((a, x) => a + ((x - m) / s2) ** 3, 0) / b.length;
    if (s3 > 0.5) return { pred: "Xỉu", conf: 60, src: `skew=+${s3.toFixed(2)} → đảo` };
    if (s3 < -0.5) return { pred: "Tài", conf: 60, src: `skew=${s3.toFixed(2)} → đảo` };
    return null;
});

B("stat", "kurt", "Độ nhọn", (h, c) => {
    const b = c.f.bits.slice(-30);
    const m = b.reduce((a, x) => a + x, 0) / b.length;
    const v = b.reduce((a, x) => a + (x - m) ** 2, 0) / b.length;
    const k = b.reduce((a, x) => a + (x - m) ** 4, 0) / b.length / (v * v + 1e-6) - 3;
    if (k > 1.5) return { pred: c.f.curType || "Tài", conf: 60, src: `kurt cao=${k.toFixed(2)} → theo` };
    return null;
});

B("stat", "reg", "Hồi quy", (h, c) => {
    const b = c.f.bits.slice(-20);
    const n = b.length;
    let sX = 0, sY = 0, sXY = 0, sXX = 0;
    for (let i = 0; i < n; i++) { sX += i; sY += b[i]; sXY += i * b[i]; sXX += i * i; }
    const slope = (n * sXY - sX * sY) / (n * sXX - sX * sX + 1e-6);
    const pred = slope > 0.02 ? "Tài" : slope < -0.02 ? "Xỉu" : null;
    if (!pred) return null;
    return { pred, conf: 62, src: `reg slope=${slope.toFixed(3)}` };
});

B("stat", "ent_hi", "Entropy cao", (h, c) => {
    if (c.f.entropy < 0.98) return null;
    return { pred: opp(h[0].result), conf: 58, src: `entropy=${c.f.entropy.toFixed(3)} cao → đảo` };
});

// ─── VII. BLOCK (8) ────────────────────────────────────────────────
function blockDet(h, c, len, conf) {
    if (h.length < len * 3) return null;
    const r = h.map(x => x.result);
    const blk = r.slice(0, len);
    for (let rep = 1; rep <= 2; rep++)
        for (let i = 0; i < len; i++)
            if (r[rep * len + i] !== blk[i]) return null;
    return { pred: blk[len - 1], conf, src: `lặp block ${len}` };
}
for (const L of [2,3,4,5,6,7,8]) B("block", `blk${L}`, `Block ${L}`, (h, c) => blockDet(h, c, L, 68 + L));

B("block", "blk_nest", "Block lồng", (h, c) => {
    const ch = c.f.chars.slice(-16);
    if (ch.length < 12) return null;
    const inner = ch.slice(-4), outer = ch.slice(-8, -4);
    if (inner !== outer) return null;
    const nxt = ch[ch.length - 8] || ch[0];
    return { pred: nxt === "T" ? "Tài" : "Xỉu", conf: 70, src: `block lồng 4+4` };
});

// ─── VIII. DICE-LEVEL (10) ─────────────────────────────────────────
B("dice", "sum_trend", "Xu hướng tổng", (h, c) => {
    const sums = h.slice(0, 8).map(x => x.total);
    if (sums.length < 6) return null;
    const m = sums.reduce((a, b) => a + b, 0) / sums.length;
    const slope = (sums[0] - sums[4]) / 4;
    if (slope > 1.5) return { pred: "Tài", conf: 62, src: `tổng tăng ${sums[4]}→${sums[0]}` };
    if (slope < -1.5) return { pred: "Xỉu", conf: 62, src: `tổng giảm` };
    return null;
});

B("dice", "sum_par", "Tổng chẵn lẻ", (h, c) => {
    const par = h.slice(0, 8).map(x => x.total % 2);
    const even = par.filter(p => p === 0).length;
    if (even >= 6) return { pred: "Tài", conf: 58, src: `tổng chẵn ${even}/8 → Tài` };
    if (even <= 2) return { pred: "Xỉu", conf: 58, src: `tổng lẻ ${8 - even}/8 → Xỉu` };
    return null;
});

B("dice", "sum_m3", "Tổng mod 3", (h, c) => {
    const m = h.slice(0, 12).map(x => x.total % 3);
    const big = m.filter(x => x > 0).length;
    if (big >= 9) return { pred: "Tài", conf: 60, src: `mod3 big ${big}/12` };
    return null;
});

B("dice", "sum_m4", "Tổng mod 4", (h, c) => {
    const m = h.slice(0, 12).map(x => x.total % 4);
    const big = m.filter(x => x >= 2).length;
    if (big >= 9) return { pred: "Tài", conf: 60, src: `mod4 big ${big}/12` };
    if (big <= 3) return { pred: "Xỉu", conf: 60, src: `mod4 small ${12 - big}/12` };
    return null;
});

B("dice", "sum_m5", "Tổng mod 5", (h, c) => {
    const m = h.slice(0, 15).map(x => x.total % 5);
    const big = m.filter(x => x >= 3).length;
    if (big >= 10) return { pred: "Tài", conf: 58, src: `mod5 big ${big}/15` };
    return null;
});

B("dice", "id_rep", "Lặp mặt xúc xắc", (h, c) => {
    if (h.length < 4) return null;
    const cur = h[0].dice.join("");
    let reps = 0;
    for (let i = 1; i < h.length; i++) if (h[i].dice.join("") === cur) reps++;
    if (reps >= 2) return { pred: "Xỉu", conf: 62, src: `mặt ${cur} lặp ${reps} lần` };
    return null;
});

B("dice", "sum_rep", "Lặp tổng", (h, c) => {
    const sums = h.slice(0, 10).map(x => x.total);
    const last = sums[0];
    const reps = sums.filter(s => s === last).length;
    if (reps >= 3) return { pred: last >= 11 ? "Xỉu" : "Tài", conf: 62, src: `tổng ${last} lặp ${reps} lần` };
    return null;
});

B("dice", "pair", "Cặp xúc xắc", (h, c) => {
    const pairs = h.slice(0, 10).map(x => {
        const d = [...x.dice].sort((a, b) => a - b);
        return `${d[0]}${d[1]}`;
    });
    const last = pairs[0];
    const idx = pairs.slice(1).indexOf(last);
    if (idx < 0 || idx + 2 >= pairs.length) return null;
    const nxtPair = pairs[idx + 2];
    const d = nxtPair.split("").map(Number);
    const sum = d[0] + d[1] + h[idx + 1].dice[2];
    return { pred: sum >= 11 ? "Tài" : "Xỉu", conf: 60, src: `cặp ${last} → tổng dự ${sum}` };
});

B("dice", "seq", "Trình tự mặt", (h, c) => {
    if (h.length < 8) return null;
    const seq = h.slice(0, 6).map(x => x.dice.join("")).join("|");
    const prevSeq = h.slice(6, 12).map(x => x.dice.join("")).join("|");
    if (seq === prevSeq) return { pred: h[0].result, conf: 68, src: `trình tự mặt lặp` };
    return null;
});

B("dice", "trans", "Chuyển tổng", (h, c) => {
    if (h.length < 8) return null;
    const cur = h[0].total, prev = h[1].total;
    const d = cur - prev;
    let matchT = 0, matchX = 0;
    for (let i = 1; i < h.length - 1; i++) {
        if (h[i].total - h[i + 1].total === d) {
            if (h[i - 1].result === "Tài") matchT++; else matchX++;
        }
    }
    if (matchT + matchX < 3) return null;
    return { pred: matchT > matchX ? "Tài" : "Xỉu", conf: 62, src: `Δ=${d} → ${matchT > matchX ? "Tài" : "Xỉu"}` };
});

// ─── IX. INFORMATION THEORY (6) ────────────────────────────────────
B("info", "shannon", "Shannon entropy", (h, c) => {
    if (c.f.entropy > 0.97) return { pred: opp(h[0].result), conf: 58, src: `H=${c.f.entropy.toFixed(3)} → đảo` };
    if (c.f.entropy < 0.7) return { pred: c.f.curType || "Tài", conf: 64, src: `H=${c.f.entropy.toFixed(3)} → theo` };
    return null;
});

B("info", "cond", "Conditional entropy", (h, c) => {
    const ch = c.f.chars.slice(-30);
    const cnt = { T: { T: 0, X: 0 }, X: { T: 0, X: 0 } };
    for (let i = 0; i < ch.length - 1; i++) cnt[ch[i]][ch[i + 1]]++;
    const cur = ch[ch.length - 1];
    const s = cnt[cur], tot = s.T + s.X;
    if (!tot) return null;
    const pT = s.T / tot;
    return { pred: pT > 0.5 ? "Tài" : "Xỉu", conf: Math.round(58 + Math.abs(pT - 0.5) * 40), src: `cond H | ${cur}` };
});

B("info", "mutual", "Mutual info", (h, c) => {
    const ch = c.f.chars.slice(-40);
    if (ch.length < 15) return null;
    let same = 0, cross = 0;
    for (let i = 1; i < ch.length - 1; i++) {
        if (ch[i - 1] === ch[i]) same++; else cross++;
    }
    const ratio = same / (same + cross);
    if (ratio > 0.6) return { pred: c.f.curType || "Tài", conf: 60, src: `MI persistence=${ratio.toFixed(2)}` };
    if (ratio < 0.4) return { pred: opp(h[0].result), conf: 60, src: `MI anti-persistence=${ratio.toFixed(2)}` };
    return null;
});

B("info", "kl", "KL divergence", (h, c) => {
    const p = c.f.pT, q = 0.5;
    const kl = p > 0 ? p * Math.log2(p / q) : 0;
    const kl2 = (1 - p) > 0 ? (1 - p) * Math.log2((1 - p) / q) : 0;
    const tot = kl + kl2;
    if (tot > 0.1) return { pred: p > 0.5 ? "Tài" : "Xỉu", conf: 58, src: `KL=${tot.toFixed(3)}` };
    return null;
});

B("info", "lz", "Lempel-Ziv complexity", (h, c) => {
    if (c.f.lz > 0.7) return { pred: opp(h[0].result), conf: 58, src: `LZ=${c.f.lz.toFixed(2)} cao → đảo` };
    if (c.f.lz < 0.4) return { pred: c.f.curType || "Tài", conf: 62, src: `LZ=${c.f.lz.toFixed(2)} thấp → theo` };
    return null;
});

B("info", "pe", "Permutation entropy", (h, c) => {
    if (c.f.pe > 0.95) return { pred: opp(h[0].result), conf: 60, src: `PE=${c.f.pe.toFixed(3)} → đảo` };
    if (c.f.pe < 0.65) return { pred: c.f.curType || "Tài", conf: 64, src: `PE=${c.f.pe.toFixed(3)} → theo` };
    return null;
});

// ─── X. FREQUENCY DOMAIN (6) ───────────────────────────────────────
B("freq", "ac1", "Autocorr lag-1", (h, c) => {
    const a = c.f.ac[0];
    if (a > 0.7) return { pred: c.f.curType || "Tài", conf: 62, src: `AC1=${a.toFixed(2)} → theo` };
    if (a < 0.3) return { pred: opp(h[0].result), conf: 62, src: `AC1=${a.toFixed(2)} → đảo` };
    return null;
});

B("freq", "ac2", "Autocorr lag-2", (h, c) => {
    const a = c.f.ac[1];
    if (a > 0.7) return { pred: h[1]?.result || "Tài", conf: 62, src: `AC2=${a.toFixed(2)}` };
    if (a < 0.3) return { pred: opp(h[1]?.result || "Tài"), conf: 62, src: `AC2=${a.toFixed(2)} đảo` };
    return null;
});

B("freq", "ac3", "Autocorr lag-3", (h, c) => {
    const a = c.f.ac[2];
    if (a > 0.7) return { pred: h[2]?.result || "Tài", conf: 60, src: `AC3=${a.toFixed(2)}` };
    return null;
});

B("freq", "acN", "Autocorr peak", (h, c) => {
    const ac = c.f.ac;
    let bi = 0, bv = ac[0];
    for (let i = 1; i < ac.length; i++) if (ac[i] > bv) { bv = ac[i]; bi = i; }
    if (bv < 0.75) return null;
    return { pred: h[bi + 1]?.result || "Tài", conf: 64, src: `AC peak lag=${bi + 1} ${bv.toFixed(2)}` };
});

B("freq", "dom", "Dominant freq", (h, c) => {
    const d = c.f.dft;
    if (!d.length) return null;
    const best = d.reduce((a, b) => b.mag > a.mag ? b : a);
    if (best.mag < 0.2) return null;
    const bits = c.f.bits;
    const pred = bits[bits.length - best.k] ?? bits[bits.length - 1];
    return { pred: pred === 1 ? "Tài" : "Xỉu", conf: 64, src: `dom k=${best.k}` };
});

B("freq", "spec", "Spectral ratio", (h, c) => {
    const d = c.f.dft;
    if (d.length < 3) return null;
    const low = d.slice(0, 3).reduce((a, b) => a + b.mag, 0);
    const high = d.slice(3).reduce((a, b) => a + b.mag, 0);
    if (low > high * 2) return { pred: c.f.curType || "Tài", conf: 60, src: `low-freq dominant` };
    if (high > low * 2) return { pred: opp(h[0].result), conf: 60, src: `high-freq dominant` };
    return null;
});

// ─── XI. TRANSITION MATRIX (5) ─────────────────────────────────────
B("trans", "tt", "T→T vs T→X", (h, c) => {
    const ch = c.f.chars.slice(-40);
    const c1 = { TT: 0, TX: 0, XT: 0, XX: 0 };
    for (let i = 0; i < ch.length - 1; i++) c1[ch[i] + ch[i + 1]]++;
    const cur = ch[ch.length - 1];
    const from = cur === "T" ? ["TT", "TX"] : ["XT", "XX"];
    const stay = c1[from[0]], flop = c1[from[1]];
    if (stay + flop < 5) return null;
    const p = stay / (stay + flop);
    return { pred: p > 0.5 ? (cur === "T" ? "Tài" : "Xỉu") : (cur === "T" ? "Xỉu" : "Tài"),
             conf: Math.round(58 + Math.abs(p - 0.5) * 60),
             src: `T→T/X matrix (p=${p.toFixed(2)})` };
});

B("trans", "after_streak", "Chuyển sau bệt", (h, c) => {
    const st = c.f.st;
    if (st.length < 5 || st[0].len < 2) return null;
    const L = st[0].len;
    let same = 0, brk = 0;
    for (let i = 1; i < st.length; i++) {
        if (st[i].len >= L) { if (st[i - 1]?.type === st[i]?.type) same++; else brk++; }
    }
    if (same + brk < 3) return null;
    const p = same / (same + brk);
    return { pred: p > 0.5 ? st[0].type : opp(st[0].type), conf: 62, src: `trans after L=${L}` };
});

B("trans", "after_alt", "Chuyển sau xen kẽ", (h, c) => {
    const ch = c.f.chars.slice(-20);
    const alt = ch.split("").reduce((a, x, i, arr) => i && x !== arr[i - 1] ? a + 1 : a, 0);
    if (alt / ch.length < 0.7) return null;
    // after long alternation, expect continuation
    return { pred: opp(h[0].result), conf: 60, src: `sau xen kẽ dài → tiếp tục xen kẽ` };
});

B("trans", "streak_to_streak", "Bệt→bệt transition", (h, c) => {
    const st = c.f.st;
    if (st.length < 8) return null;
    const pairs = {};
    for (let i = 0; i < st.length - 1; i++) {
        const k = st[i].len + "→" + st[i + 1].len;
        pairs[k] = (pairs[k] || 0) + 1;
    }
    const cur = st[0].len;
    const cand = Object.entries(pairs).filter(([k]) => k.startsWith(cur + "→")).sort((a, b) => b[1] - a[1]);
    if (!cand.length) return null;
    const nextL = parseInt(cand[0][0].split("→")[1]);
    if (nextL > cur) return { pred: st[0].type, conf: 62, src: `bệt ${cur} → ${nextL}` };
    return { pred: opp(st[0].type), conf: 62, src: `bệt ${cur} → ${nextL}` };
});

B("trans", "ho", "Higher-order transition", (h, c) => {
    const ch = c.f.chars.slice(-50);
    if (ch.length < 20) return null;
    const order = 3;
    const counts = {};
    for (let i = 0; i < ch.length - order; i++) {
        const k = ch.slice(i, i + order);
        const nxt = ch[i + order];
        if (!counts[k]) counts[k] = { T: 0, X: 0 };
        counts[k][nxt]++;
    }
    const cur = ch.slice(-order);
    const s = counts[cur];
    if (!s) return null;
    const tot = s.T + s.X;
    if (tot < 3) return null;
    const p = s.T / tot;
    return { pred: p > 0.5 ? "Tài" : "Xỉu", conf: Math.round(60 + Math.abs(p - 0.5) * 40), src: `HO3 "${cur}" (${tot})` };
});

// ─── XII. ADVANCED / NOVEL (25) ────────────────────────────────────
B("adv", "cusum", "CUSUM", (h, c) => {
    const b = c.f.bits.slice(-40);
    let sP = 0, sN = 0, th = 3;
    for (const x of b) {
        sP = Math.max(0, sP + (x - 0.5));
        sN = Math.min(0, sN + (x - 0.5));
        if (sP > th) return { pred: "Xỉu", conf: 64, src: `CUSUM +${sP.toFixed(1)}` };
        if (sN < -th) return { pred: "Tài", conf: 64, src: `CUSUM ${sN.toFixed(1)}` };
    }
    return null;
});

B("adv", "sprt", "SPRT", (h, c) => {
    const b = c.f.bits.slice(-40);
    const p0 = 0.5, p1 = 0.65;
    let LLR = 0;
    for (const x of b) LLR += x * Math.log(p1 / p0) + (1 - x) * Math.log((1 - p1) / (1 - p0));
    if (LLR > 2) return { pred: "Tài", conf: 66, src: `SPRT LLR=${LLR.toFixed(2)}` };
    if (LLR < -2) return { pred: "Xỉu", conf: 66, src: `SPRT LLR=${LLR.toFixed(2)}` };
    return null;
});

B("adv", "changepoint", "Bayesian changepoint", (h, c) => {
    const b = c.f.bits.slice(-30);
    const half = Math.floor(b.length / 2);
    const p1 = b.slice(0, half).reduce((a, x) => a + x, 0) / half;
    const p2 = b.slice(half).reduce((a, x) => a + x, 0) / (b.length - half);
    if (Math.abs(p1 - p2) > 0.4) return { pred: p2 > p1 ? "Tài" : "Xỉu", conf: 64, src: `change ${p1.toFixed(2)}→${p2.toFixed(2)}` };
    return null;
});

B("adv", "ema", "EMA crossover", (h, c) => {
    const b = c.f.bits.slice(-30);
    const alpha1 = 2 / 6, alpha2 = 2 / 16;
    let e1 = b[0], e2 = b[0];
    for (let i = 1; i < b.length; i++) { e1 = alpha1 * b[i] + (1 - alpha1) * e1; e2 = alpha2 * b[i] + (1 - alpha2) * e2; }
    const diff = e1 - e2;
    if (Math.abs(diff) < 0.05) return null;
    return { pred: diff > 0 ? "Tài" : "Xỉu", conf: 62, src: `EMA cross ${diff.toFixed(3)}` };
});

B("adv", "macd", "MACD-like", (h, c) => {
    const b = c.f.bits.slice(-40);
    const ema = (data, n) => { const a = 2 / (n + 1); let e = data[0]; for (let i = 1; i < data.length; i++) e = a * data[i] + (1 - a) * e; return e; };
    const macd = ema(b, 12) - ema(b, 26);
    const signal = macd > 0 ? 1 : -1;
    if (Math.abs(macd) < 0.03) return null;
    return { pred: signal > 0 ? "Tài" : "Xỉu", conf: 62, src: `MACD=${macd.toFixed(3)}` };
});

B("adv", "rsi", "RSI", (h, c) => {
    const b = c.f.bits.slice(-14);
    let gain = 0, loss = 0;
    for (let i = 1; i < b.length; i++) { if (b[i] > b[i - 1]) gain++; else loss++; }
    const rsi = 100 - 100 / (1 + gain / (loss || 1));
    if (rsi > 75) return { pred: "Xỉu", conf: 64, src: `RSI=${rsi.toFixed(0)}` };
    if (rsi < 25) return { pred: "Tài", conf: 64, src: `RSI=${rsi.toFixed(0)}` };
    return null;
});

B("adv", "boll", "Bollinger-like", (h, c) => {
    const b = c.f.bits.slice(-20);
    const m = b.reduce((a, x) => a + x, 0) / b.length;
    const sd = Math.sqrt(b.reduce((a, x) => a + (x - m) ** 2, 0) / b.length);
    const cur = b[b.length - 1];
    if (cur > m + 2 * sd) return { pred: "Xỉu", conf: 62, src: `Bollinger upper` };
    if (cur < m - 2 * sd) return { pred: "Tài", conf: 62, src: `Bollinger lower` };
    return null;
});

B("adv", "kalman", "Kalman-like", (h, c) => {
    const b = c.f.bits.slice(-20);
    let x = b[0], P = 1, Q = 0.01, R = 0.1;
    for (const z of b) { P += Q; const K = P / (P + R); x = x + K * (z - x); P = (1 - K) * P; }
    const diff = b[b.length - 1] - x;
    if (Math.abs(diff) < 0.3) return null;
    return { pred: diff > 0 ? "Xỉu" : "Tài", conf: 60, src: `Kalman residual=${diff.toFixed(2)}` };
});

B("adv", "hurst", "Hurst exponent", (h, c) => {
    const H = c.f.hurst;
    if (H > 0.65) return { pred: c.f.curType || "Tài", conf: 64, src: `Hurst=${H.toFixed(2)} persistent` };
    if (H < 0.35) return { pred: opp(h[0].result), conf: 64, src: `Hurst=${H.toFixed(2)} anti-persistent` };
    return null;
});

B("adv", "lyap", "Lyapunov-like", (h, c) => {
    const b = c.f.bits.slice(-30);
    let d0 = 0;
    for (let i = 1; i < b.length; i++) d0 += Math.abs(b[i] - b[i - 1]);
    const rate = d0 / b.length;
    if (rate > 0.9) return { pred: opp(h[0].result), conf: 60, src: `Lyap chaos ${rate.toFixed(2)}` };
    if (rate < 0.3) return { pred: c.f.curType || "Tài", conf: 62, src: `Lyap stable` };
    return null;
});

B("adv", "frac", "Fractal dimension", (h, c) => {
    const ch = c.f.chars.slice(-40);
    const box = (s, sz) => { const set = new Set(); for (let i = 0; i + sz <= s.length; i += sz) set.add(s.slice(i, i + sz)); return set.size; };
    const s1 = box(ch, 2), s2 = box(ch, 4);
    const fd = Math.log(s2) / Math.log(s1 + 1e-6);
    if (fd > 1.5) return { pred: opp(h[0].result), conf: 58, src: `FD=${fd.toFixed(2)}` };
    return null;
});

B("adv", "fib", "Fibonacci position", (h, c) => {
    const fibs = [1,1,2,3,5,8,13,21,34];
    const n = h.length;
    if (!fibs.includes(h[0].session % 21)) return null;
    return { pred: opp(h[0].result), conf: 56, src: `Fibonacci session ${h[0].session}` };
});

B("adv", "prime", "Prime index", (h, c) => {
    const isPrime = n => { if (n < 2) return false; for (let i = 2; i <= Math.sqrt(n); i++) if (n % i === 0) return false; return true; };
    if (!isPrime(h[0].session % 100)) return null;
    return { pred: c.f.curType || "Tài", conf: 54, src: `prime session` };
});

B("adv", "nth", "Every-Nth", (h, c) => {
    for (const k of [3, 5, 7]) {
        if (h.length < k * 3) continue;
        const picks = [h[0], h[k], h[2 * k]].map(x => x.result);
        if (picks[0] === picks[1] && picks[1] === picks[2])
            return { pred: opp(picks[0]), conf: 58, src: `every-${k} đều ${picks[0]}` };
    }
    return null;
});

B("adv", "recur", "Recurrence analysis", (h, c) => {
    const ch = c.f.chars.slice(-30);
    const last = ch.slice(-4);
    let matches = 0;
    for (let i = 0; i < ch.length - 4; i++) if (ch.slice(i, i + 4) === last) matches++;
    if (matches >= 2) {
        const idx = ch.lastIndexOf(last.slice(0, -1));
        if (idx >= 0 && idx + 4 < ch.length)
            return { pred: ch[idx + 4] === "T" ? "Tài" : "Xỉu", conf: 62 + matches * 2, src: `recur ${matches}x` };
    }
    return null;
});

B("adv", "attractor", "Attractor", (h, c) => {
    // project bits into 3D phase space
    const b = c.f.bits;
    if (b.length < 20) return null;
    const dim = 3, delay = 2;
    const pts = [];
    for (let i = 0; i < b.length - delay * (dim - 1); i++)
        pts.push([b[i], b[i + delay], b[i + 2 * delay]]);
    const last = pts[pts.length - 1];
    let best = -1, bestD = 1e9;
    for (let i = 0; i < pts.length - 1; i++) {
        const d = pts[i].reduce((a, v, j) => a + (v - last[j]) ** 2, 0);
        if (d < bestD) { bestD = d; best = i; }
    }
    if (bestD > 1) return null;
    const nxt = b[best + delay * (dim - 1) + 1];
    if (nxt == null) return null;
    return { pred: nxt === 1 ? "Tài" : "Xỉu", conf: 62, src: `attractor nearest d=${Math.sqrt(bestD).toFixed(2)}` };
});

B("adv", "symb", "Symbolic dynamics", (h, c) => {
    const ch = c.f.chars.slice(-40);
    const chunks = [];
    for (let i = 0; i < ch.length; i += 4) chunks.push(ch.slice(i, i + 4));
    const last = chunks[chunks.length - 1];
    const idx = chunks.slice(0, -1).lastIndexOf(last);
    if (idx < 0) return null;
    const nxtChunk = chunks[idx + 1];
    if (!nxtChunk) return null;
    return { pred: nxtChunk[0] === "T" ? "Tài" : "Xỉu", conf: 62, src: `symbolic chunk "${last}" → ${nxtChunk[0]}` };
});

B("adv", "wave", "Wave pattern", (h, c) => {
    const ch = c.f.chars.slice(-30);
    const up = ch.includes("TXTX"), dn = ch.includes("XTXT");
    if (up && !dn) return { pred: opp(h[0].result), conf: 60, src: `wave up` };
    if (dn && !up) return { pred: opp(h[0].result), conf: 60, src: `wave down` };
    return null;
});

B("adv", "divergence", "Divergence", (h, c) => {
    const b = c.f.bits.slice(-30);
    const half = Math.floor(b.length / 2);
    const t1 = b.slice(0, half).reduce((a, x) => a + x, 0);
    const t2 = b.slice(half).reduce((a, x) => a + x, 0);
    const p1 = t1 / half, p2 = t2 / (b.length - half);
    if (p1 > 0.65 && p2 < 0.45) return { pred: "Tài", conf: 62, src: `diverge high→low` };
    if (p1 < 0.35 && p2 > 0.55) return { pred: "Xỉu", conf: 62, src: `diverge low→high` };
    return null;
});

B("adv", "breakout", "Breakout", (h, c) => {
    const b = c.f.bits.slice(-20);
    const m = b.reduce((a, x) => a + x, 0) / b.length;
    const sd = Math.sqrt(b.reduce((a, x) => a + (x - m) ** 2, 0) / b.length);
    const last3 = b.slice(-3).reduce((a, x) => a + x, 0) / 3;
    if (last3 > m + 1.5 * sd) return { pred: "Xỉu", conf: 62, src: `breakout up` };
    if (last3 < m - 1.5 * sd) return { pred: "Tài", conf: 62, src: `breakout dn` };
    return null;
});

B("adv", "pullback", "Pullback", (h, c) => {
    const ch = c.f.chars.slice(-15);
    if (ch.length < 10) return null;
    const head = ch.slice(-10, -5), tail = ch.slice(-5);
    const same = tail.split("").filter((x, i) => x === head[i]).length;
    if (same >= 4) {
        return { pred: ch[ch.length - 6] === "T" ? "Tài" : "Xỉu", conf: 60, src: `pullback pattern` };
    }
    return null;
});

B("adv", "retest", "Retest", (h, c) => {
    const ch = c.f.chars.slice(-12);
    if (ch.length < 8) return null;
    if (ch[ch.length - 1] === ch[ch.length - 3] && ch[ch.length - 2] !== ch[ch.length - 3])
        return { pred: ch[ch.length - 2] === "T" ? "Tài" : "Xỉu", conf: 58, src: `retest` };
    return null;
});

// ─── XIII. COMPLEX PATTERNS (10) ───────────────────────────────────
B("cplx", "hs", "Head & shoulders", (h, c) => {
    const ch = c.f.chars.slice(-12);
    if (ch.length < 12) return null;
    // simple: T X T (peak) then T X T (bigger peak) then T X T (smaller)
    const pattern = ch.match(/T+X+T+X+T+X+T+X+$/);
    if (pattern) return { pred: "Xỉu", conf: 60, src: `HS pattern` };
    return null;
});

B("cplx", "dt", "Double top", (h, c) => {
    const st = c.f.st.slice(0, 8);
    const lens = st.map(s => s.len);
    if (lens.length < 6) return null;
    if (lens[0] === lens[2] && lens[2] === lens[4] && lens[1] === lens[3] && lens[3] === lens[5] && lens[1] < lens[0])
        return { pred: opp(st[0].type), conf: 62, src: `double top` };
    return null;
});

B("cplx", "db", "Double bottom", (h, c) => {
    const st = c.f.st.slice(0, 8);
    if (st.length < 6) return null;
    const lens = st.map(s => s.len);
    if (lens[0] === lens[2] && lens[1] === lens[3] && lens[1] > lens[0])
        return { pred: st[0].type, conf: 62, src: `double bottom` };
    return null;
});

B("cplx", "tri", "Triangle", (h, c) => {
    const lens = c.f.slens.slice(0, 8);
    if (lens.length < 6) return null;
    let conv = true;
    for (let i = 1; i < 4; i++) if (lens[i] >= lens[i - 1]) conv = false;
    if (conv) return { pred: opp(c.f.curType), conf: 62, src: `converging triangle` };
    return null;
});

B("cplx", "wedge", "Wedge", (h, c) => {
    const lens = c.f.slens.slice(0, 8);
    if (lens.length < 6) return null;
    let rising = true, falling = true;
    for (let i = 1; i < 4; i++) { if (lens[i] <= lens[i - 1]) rising = false; if (lens[i] >= lens[i - 1]) falling = false; }
    if (rising) return { pred: opp(c.f.curType), conf: 62, src: `rising wedge` };
    if (falling) return { pred: opp(c.f.curType), conf: 62, src: `falling wedge` };
    return null;
});

B("cplx", "flag", "Flag", (h, c) => {
    const ch = c.f.chars.slice(-10);
    if (ch.length < 8) return null;
    const first = ch.slice(0, 3), last = ch.slice(-3);
    if (first.split("").filter(x => x === "T").length >= 2 && last === "XXX")
        return { pred: "Tài", conf: 60, src: `bull flag` };
    if (first.split("").filter(x => x === "X").length >= 2 && last === "TTT")
        return { pred: "Xỉu", conf: 60, src: `bear flag` };
    return null;
});

B("cplx", "gap", "Gap detection", (h, c) => {
    if (h.length < 4) return null;
    const d1 = h[0].total - h[1].total;
    const d2 = h[1].total - h[2].total;
    if (Math.abs(d1) > 8 && d1 * d2 > 0)
        return { pred: d1 > 0 ? "Xỉu" : "Tài", conf: 62, src: `gap fill` };
    return null;
});

B("cplx", "fibretr", "Fib retracement", (h, c) => {
    const sums = h.slice(0, 10).map(x => x.total);
    const mn = Math.min(...sums), mx = Math.max(...sums);
    const last = sums[0];
    const ratio = (last - mn) / (mx - mn + 1e-6);
    if (ratio < 0.382) return { pred: "Tài", conf: 58, src: `fib 0.382 support` };
    if (ratio > 0.618) return { pred: "Xỉu", conf: 58, src: `fib 0.618 resistance` };
    return null;
});

B("cplx", "sup", "Support level", (h, c) => {
    const sums = h.slice(0, 15).map(x => x.total);
    const mn = Math.min(...sums);
    if (h[0].total <= mn + 1) return { pred: "Tài", conf: 60, src: `chạm hỗ trợ ${mn}` };
    return null;
});

B("cplx", "res", "Resistance level", (h, c) => {
    const sums = h.slice(0, 15).map(x => x.total);
    const mx = Math.max(...sums);
    if (h[0].total >= mx - 1) return { pred: "Xỉu", conf: 60, src: `chạm kháng cự ${mx}` };
    return null;
});

// ─── XIV. TIME / SESSION (5) ───────────────────────────────────────
B("time", "sess_par", "Session parity", (h, c) => {
    const s = h[0].session;
    if (s % 2 === 0) return { pred: "Tài", conf: 52, src: `session chẵn` };
    return { pred: "Xỉu", conf: 52, src: `session lẻ` };
});

B("time", "sess_dig", "Session digit", (h, c) => {
    const d = h[0].session % 10;
    if (d >= 7) return { pred: "Tài", conf: 54, src: `chữ số cuối ${d}` };
    if (d <= 2) return { pred: "Xỉu", conf: 54, src: `chữ số cuối ${d}` };
    return null;
});

B("time", "sess_mod", "Session modulo", (h, c) => {
    const m = h[0].session % 7;
    if (m >= 5) return { pred: "Tài", conf: 54, src: `sess%7=${m}` };
    if (m <= 1) return { pred: "Xỉu", conf: 54, src: `sess%7=${m}` };
    return null;
});

B("time", "sess_dist", "Session distance", (h, c) => {
    const d = h[0].session % 1000;
    if (d < 100) return { pred: "Tài", conf: 54, src: `dist<100` };
    if (d > 900) return { pred: "Xỉu", conf: 54, src: `dist>900` };
    return null;
});

B("time", "sess_pat", "Session pattern", (h, c) => {
    const s = h[0].session;
    const a = Math.floor(s / 100) % 10, b = Math.floor(s / 10) % 10, cc = s % 10;
    if (a === b && b === cc) return { pred: "Xỉu", conf: 56, src: `sess lặp ${s}` };
    if (a + 1 === b && b + 1 === cc) return { pred: "Tài", conf: 56, src: `sess tăng ${s}` };
    return null;
});

// ─── XV. META (12) ─────────────────────────────────────────────────
function metaVoteFilter(filter, conf, name, minAgree = 0.6, minN = 5) {
    return (h, c) => {
        const preds = (c.basePreds || []).filter(filter);
        if (preds.length < minN) return null;
        const t = preds.filter(p => p.pred === "Tài").length, x = preds.length - t;
        const ratio = Math.max(t, x) / preds.length;
        if (ratio < minAgree) return null;
        const pred = t > x ? "Tài" : "Xỉu";
        return { pred, conf: Math.round(conf * ratio), src: `${name}: ${t}T/${x}X (${(ratio * 100).toFixed(0)}%)` };
    };
}
B("meta", "m_maj", "Meta majority", metaVoteFilter(() => true, 78, "meta-majority", 0.6, 5));
B("meta", "m_w", "Meta weighted", (h, c) => {
    const preds = c.basePreds || [];
    if (preds.length < 5) return null;
    let t = 0, x = 0;
    for (const p of preds) {
        const w = p.conf / 100;
        if (p.pred === "Tài") t += w; else x += w;
    }
    if (t + x === 0) return null;
    const pred = t > x ? "Tài" : "Xỉu";
    const ratio = Math.max(t, x) / (t + x);
    if (ratio < 0.6) return null;
    return { pred, conf: Math.round(80 * ratio), src: `meta-weight T${t.toFixed(1)}/X${x.toFixed(1)}` };
});
B("meta", "m_top5", "Meta top-5", (h, c) => {
    const preds = [...(c.basePreds || [])].sort((a, b) => b.conf - a.conf).slice(0, 5);
    if (preds.length < 5) return null;
    const t = preds.filter(p => p.pred === "Tài").length, x = 5 - t;
    if (t < 4 && x < 4) return null;
    return { pred: t > x ? "Tài" : "Xỉu", conf: 80, src: `top5 ${t}T/${x}X` };
});
B("meta", "m_top10", "Meta top-10", (h, c) => {
    const preds = [...(c.basePreds || [])].sort((a, b) => b.conf - a.conf).slice(0, 10);
    if (preds.length < 8) return null;
    const t = preds.filter(p => p.pred === "Tài").length, x = preds.length - t;
    const ratio = Math.max(t, x) / preds.length;
    if (ratio < 0.7) return null;
    return { pred: t > x ? "Tài" : "Xỉu", conf: Math.round(82 * ratio), src: `top10 ${t}T/${x}X` };
});
B("meta", "m_contra", "Meta contrarian", (h, c) => {
    const preds = c.basePreds || [];
    if (preds.length < 10) return null;
    const t = preds.filter(p => p.pred === "Tài").length;
    const ratio = t / preds.length;
    if (ratio > 0.85) return { pred: "Xỉu", conf: 62, src: `meta contrarian (T ${(ratio * 100).toFixed(0)}%)` };
    if (ratio < 0.15) return { pred: "Tài", conf: 62, src: `meta contrarian (X ${((1 - ratio) * 100).toFixed(0)}%)` };
    return null;
});
B("meta", "m_streak", "Meta streak-aware", (h, c) => {
    const cur = c.f.st[0];
    if (!cur) return null;
    const preds = (c.basePreds || []).filter(p => p.cat === "streak" || p.cat === "alt" || p.cat === "cycle");
    if (preds.length < 5) return null;
    const t = preds.filter(p => p.pred === "Tài").length, x = preds.length - t;
    const ratio = Math.max(t, x) / preds.length;
    if (ratio < 0.65) return null;
    return { pred: t > x ? "Tài" : "Xỉu", conf: Math.round(78 * ratio), src: `streak-meta ${t}/${x}` };
});
B("meta", "m_regime", "Meta regime-aware", (h, c) => {
    const relCat = { PERSISTENT: ["streak","markov"], ANTIPERSISTENT: ["alt","cycle"], TRENDING: ["streak","markov"], CHAOTIC: ["meta"], ALTERNATING: ["alt"], CYCLIC: ["cycle"], STREAK: ["streak"] }[c.regime] || ["streak","markov","alt"];
    const preds = (c.basePreds || []).filter(p => relCat.includes(p.cat));
    if (preds.length < 5) return null;
    const t = preds.filter(p => p.pred === "Tài").length, x = preds.length - t;
    const ratio = Math.max(t, x) / preds.length;
    if (ratio < 0.65) return null;
    return { pred: t > x ? "Tài" : "Xỉu", conf: Math.round(78 * ratio), src: `regime-meta(${c.regime}) ${t}/${x}` };
});
B("meta", "m_bayes", "Meta Bayesian", (h, c) => {
    const preds = c.basePreds || [];
    if (preds.length < 8) return null;
    let t = 0, x = 0;
    for (const p of preds) {
        const acc = p.weight ?? 0.5;
        const conf = p.conf / 100;
        const w = Math.pow(acc, 1.4) * Math.pow(conf, 1.2);
        if (p.pred === "Tài") t += w; else x += w;
    }
    if (t + x === 0) return null;
    const pred = t > x ? "Tài" : "Xỉu";
    const ratio = Math.max(t, x) / (t + x);
    if (ratio < 0.55) return null;
    return { pred, conf: Math.round(55 + ratio * 40), src: `meta-bayes ${ratio.toFixed(2)}` };
});
B("meta", "m_stack", "Meta stacking", (h, c) => {
    // second-stage: use confidence + accuracy of top detectors
    const preds = [...(c.basePreds || [])].sort((a, b) => (b.conf * (b.weight || 1)) - (a.conf * (a.weight || 1))).slice(0, 15);
    if (preds.length < 10) return null;
    let s = 0;
    for (const p of preds) s += (p.pred === "Tài" ? 1 : -1) * p.conf * (p.weight || 1);
    if (Math.abs(s) < 100) return null;
    return { pred: s > 0 ? "Tài" : "Xỉu", conf: Math.min(88, 60 + Math.abs(s) / 30), src: `stack score=${s.toFixed(0)}` };
});
B("meta", "m_cons60", "Meta consensus 60%", metaVoteFilter(() => true, 76, "consensus60", 0.60, 15));
B("meta", "m_cons70", "Meta consensus 70%", metaVoteFilter(() => true, 80, "consensus70", 0.70, 20));
B("meta", "m_cons80", "Meta consensus 80%", metaVoteFilter(() => true, 84, "consensus80", 0.80, 25));
B("meta", "m_extreme", "Meta extreme", (h, c) => {
    const preds = c.basePreds || [];
    if (preds.length < 30) return null;
    const t = preds.filter(p => p.pred === "Tài").length;
    const ratio = t / preds.length;
    if (ratio > 0.72) return { pred: "Tài", conf: 88, src: `extreme T ${(ratio * 100).toFixed(0)}%` };
    if (ratio < 0.28) return { pred: "Xỉu", conf: 88, src: `extreme X ${((1 - ratio) * 100).toFixed(0)}%` };
    return null;
});
B("meta", "m_hybrid", "Meta hybrid", (h, c) => {
    const preds = c.basePreds || [];
    if (preds.length < 12) return null;
    // combine weighted vote + top-K agreement
    let t = 0, x = 0;
    for (const p of preds) { const w = (p.conf / 100) * (p.weight ?? 0.5); if (p.pred === "Tài") t += w; else x += w; }
    const top = [...preds].sort((a, b) => b.conf - a.conf).slice(0, 8);
    const topT = top.filter(p => p.pred === "Tài").length;
    if (topT >= 6 && t > x) return { pred: "Tài", conf: 82, src: `hybrid T` };
    if (topT <= 2 && x > t) return { pred: "Xỉu", conf: 82, src: `hybrid X` };
    return null;
});

console.log(`🚀 Đã nạp ${BRIDGES.length} cầu | ${new Set(BRIDGES.map(b => b.cat)).size} categories`);

// ═══════════════════════════════════════════════════════════════════
//  BAYESIAN LEARNER (α/β + decay + regime-conditioned)
// ═══════════════════════════════════════════════════════════════════
class Learner {
    constructor(decay = 0.995) {
        this.stats = {};
        this.decayRate = decay;
        this.updates = 0;
    }
    tick() {
        if (++this.updates % 50) return;
        for (const s of Object.values(this.stats)) { s.a *= this.decayRate; s.b *= this.decayRate; }
    }
    record(id, regime, correct) {
        this._r(id, correct);
        if (regime) this._r(`${id}@${regime}`, correct);
        this.tick();
    }
    _r(id, correct) {
        if (!this.stats[id]) this.stats[id] = { a: 1, b: 1 };
        if (correct) this.stats[id].a++; else this.stats[id].b++;
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
        const b = this.bin(conf);
        const s = this.bins[b];
        if (!s || s.n < 15) return conf;
        const actual = s.ok / s.n * 100;
        return Math.round(conf * 0.6 + actual * 0.4);
    }
    snapshot() {
        const out = {};
        for (const [k, v] of Object.entries(this.bins)) {
            if (v.n > 0) out[`${k}-${+k + 5}%`] = { n: v.n, actual: (v.ok / v.n * 100).toFixed(1) + "%" };
        }
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
        this.totalScored = 0;
        this.totalHit = 0;
    }

    buildCtx(hist) {
        const feats = extractFeatures(hist);
        return {
            f: feats,
            regime: detectRegime(feats),
            basePreds: [],
        };
    }

    runBridges(hist, ctx, filter) {
        const out = [];
        for (const b of BRIDGES) {
            if (!filter(b)) continue;
            try {
                const r = b.fn(hist, ctx);
                if (r?.pred && r.pred !== "BÃO") {
                    out.push({ id: b.id, name: b.name, cat: b.cat, pred: r.pred, conf: r.conf, src: r.src });
                }
            } catch {}
        }
        return out;
    }

    predict(hist) {
        if (!hist.length) return { pred: "Xỉu", conf: 50, cau: "-", src: "chưa có dữ liệu", top: [], regime: "UNKNOWN" };

        if (bao(hist[0].dice)) return { pred: "BÃO", conf: 0, cau: "bão", src: "bão (nghỉ)", top: [], regime: "BÃO" };

        const next = hist[0].session + 1;
        if (this.lastPred && this.lastPred.session === next) return this.lastPred.result;

        const ctx = this.buildCtx(hist);

        // 1. Base bridges
        const base = this.runBridges(hist, ctx, b => b.cat !== "meta");
        // attach weight from learner (for meta consumer)
        for (const p of base) p.weight = this.learner.blend(p.id, ctx.regime);
        ctx.basePreds = base;

        // 2. Meta bridges
        const meta = this.runBridges(hist, ctx, b => b.cat === "meta");
        for (const p of meta) p.weight = this.learner.blend(p.id, ctx.regime);

        const all = [...base, ...meta];

        // 3. Weighted vote
        let t = 0, x = 0;
        for (const p of all) {
            const conf = (p.conf || 60) / 100;
            const acc = p.weight;
            const w = Math.pow(acc, 1.3) * Math.pow(conf, 1.1);
            if (p.pred === "Tài") t += w; else x += w;
        }

        const tot = t + x;
        let pred, conf;
        if (tot === 0) {
            pred = opp(hist[0].result);
            conf = 52;
        } else {
            pred = t >= x ? "Tài" : "Xỉu";
            const ratio = Math.max(t, x) / tot;
            const logBoost = Math.log2(all.length + 1) * 2.5;
            conf = Math.min(95, Math.round(ratio * 62 + logBoost));

            // Regime adjustments
            const adj = { PERSISTENT: 1.03, ANTIPERSISTENT: 1.02, ALTERNATING: 1.04, CYCLIC: 1.05, TRENDING: 1.03, CHAOTIC: 0.85, FATIGUE: 0.95, STREAK: 1.0 };
            conf = Math.round(conf * (adj[ctx.regime] || 1));
        }

        // Top agreement bonus
        const sorted = [...all].sort((a, b) => (b.conf * b.weight) - (a.conf * a.weight));
        const top10 = sorted.slice(0, 10);
        const topT = top10.filter(p => p.pred === "Tài").length;
        if (topT >= 9 || topT <= 1) conf = Math.min(95, conf + 4);

        const calibConf = this.calibrator.calibrate(conf);

        const result = {
            pred, conf: calibConf, rawConf: conf,
            regime: ctx.regime,
            cau: sorted[0]?.name || "-",
            src: `🧠 ${all.length} cầu | ${ctx.regime} | vote T${t.toFixed(1)}/X${x.toFixed(1)} | top: ${topT}T/${10 - topT}X`,
            top: top10.map(p => ({
                name: p.name, cat: p.cat, pred: p.pred, conf: p.conf,
                acc: (p.weight * 100).toFixed(0) + "%",
                weight: p.weight.toFixed(3)
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
//  PARSE + STATE + FETCH
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
const engHu  = new Engine();
const engMd5 = new Engine();

async function tick(url, isMd5) {
    try {
        const res = await fetch(url);
        const data = await res.json();
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
    } catch (e) {
        console.error(`❌ [${isMd5 ? "MD5" : "HŨ"}]:`, e.message);
    }
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
    engine: `🚀 Advanced Engine v3 | ${BRIDGES.length} cầu phân tích độc lập`,
    categories: [...new Set(BRIDGES.map(b => b.cat))].map(cat => ({
        cat,
        count: BRIDGES.filter(b => b.cat === cat).length,
        list: BRIDGES.filter(b => b.cat === cat).map(b => b.name),
    })),
    endpoints: {
        hu:        `/api/taixiu/lc79?key=${VALID_KEY}`,
        md5:       `/api/taixiumd5/lc79?key=${VALID_KEY}`,
        debug_hu:  `/api/debug/hu?key=${VALID_KEY}`,
        debug_md5: `/api/debug/md5?key=${VALID_KEY}`,
        stats_hu:  `/api/stats/hu?key=${VALID_KEY}`,
        stats_md5: `/api/stats/md5?key=${VALID_KEY}`,
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
        if (!s) continue;
        if (!byCat[b.cat]) byCat[b.cat] = { total_n: 0, total_acc: 0, count: 0, best: null, bridges: [] };
        const n = s.n, acc = parseFloat(s.acc) || 0;
        if (n >= 10) {
            byCat[b.cat].total_n += n;
            byCat[b.cat].total_acc += acc;
            byCat[b.cat].count++;
            byCat[b.cat].bridges.push({ id: b.id, name: b.name, n, acc: s.acc });
        }
    }
    for (const [cat, v] of Object.entries(byCat)) {
        v.avg_acc = v.count ? (v.total_acc / v.count).toFixed(1) + "%" : "N/A";
        v.bridges.sort((a, b) => parseFloat(b.acc) - parseFloat(a.acc));
        v.top5 = v.bridges.slice(0, 5);
        delete v.bridges;
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

    const ctx = eng.buildCtx(h);
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
        features: ctx.f ? {
            entropy: ctx.f.entropy.toFixed(3),
            ac1: ctx.f.ac[0].toFixed(2), ac2: ctx.f.ac[1].toFixed(2), ac3: ctx.f.ac[2].toFixed(2),
            altRate: ctx.f.altRate.toFixed(2),
            curStreak: ctx.f.curStreak, maxStreak: ctx.f.maxSt,
            hurst: ctx.f.hurst.toFixed(2),
            perm_ent: ctx.f.pe.toFixed(3),
            lz: ctx.f.lz.toFixed(3),
            ratios: ctx.f.ratios,
        } : null,
        base_count: base.length,
        meta_count: meta.length,
        base_bridges: base.sort((a, b) => b.conf - a.conf).map(d => ({
            id: d.id, name: d.name, cat: d.cat, pred: d.pred, conf: d.conf, src: d.src,
            acc: (d.weight * 100).toFixed(1) + "%", n: eng.learner.n(d.id),
        })),
        meta_bridges: meta.map(d => ({
            id: d.id, name: d.name, pred: d.pred, conf: d.conf, src: d.src,
            acc: (d.weight * 100).toFixed(1) + "%", n: eng.learner.n(d.id),
        })),
        final: { pred: p.pred, conf: `${p.conf}%`, raw: p.rawConf ? `${p.rawConf}%` : null, top: p.top },
    };
});

app.get("/check-key", async req =>
    req.query.key === VALID_KEY
        ? { status: "success", message: "KEY HỢP LỆ", admin: ADMIN }
        : { status: "error", message: `Sai key! Ib ${ADMIN}` });

// ═══════════════════════════════════════════════════════════════════
//  START
// ═══════════════════════════════════════════════════════════════════
await Promise.all([tick(API_HU, false), tick(API_MD5, true)]);
setInterval(() => tick(API_HU, false), 5000);
setInterval(() => tick(API_MD5, true), 5000);

try {
    await app.listen({ port: PORT, host: "0.0.0.0" });
} catch (err) {
    console.error("❌ Lỗi khởi động:", err.message);
    process.exit(1);
}

const cats = [...new Set(BRIDGES.map(b => b.cat))];
console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║  🚀 TÀI XỈU LC79 — ADVANCED ENGINE v3                                     ║
╠══════════════════════════════════════════════════════════════════════════╣
║  🚀 http://localhost:${PORT}                                             ║
║  🔑 KEY: ${VALID_KEY}                                                    ║
║  👤 ADMIN: ${ADMIN}                                                      ║
║                                                                          ║
║  🎯 TỔNG CẦU: ${BRIDGES.length} (thuật toán ĐỘC LẬP, không trùng lặp)         ║
${cats.map(cat => {
    const n = BRIDGES.filter(b => b.cat === cat).length;
    return `║     • ${cat.padEnd(8)} ${String(n).padStart(3)} cầu  ${BRIDGES.filter(b => b.cat === cat).slice(0, 3).map(b => b.name).join(", ").slice(0, 40).padEnd(42)}║`;
}).join("\n")}
║                                                                          ║
║  🧠 ENGINE TỰ HỌC:                                                       ║
║     • Bayesian α/β + decay                                               ║
║     • Regime-conditional learning                                        ║
║     • Feature extraction (entropy, hurst, LZ, PE, autocorr, DFT)         ║
║     • Weighted vote + meta-layer                                         ║
║     • Confidence calibration                                             ║
║                                                                          ║
║  📌 API:                                                                 ║
║     HŨ   : /api/taixiu/lc79?key=${VALID_KEY}                            ║
║     MD5  : /api/taixiumd5/lc79?key=${VALID_KEY}                         ║
║     DEBUG: /api/debug/hu?key=${VALID_KEY}                               ║
║     STATS: /api/stats/hu?key=${VALID_KEY}                               ║
╚══════════════════════════════════════════════════════════════════════════╝
`);