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
const chrono = (h, n = 100) => h.slice(0, n).map(x => x.result).reverse();
const bitsOf = (h, n = 100) => chrono(h, n).map(toB);
const charsOf = (h, n = 100) => chrono(h, n).map(toC).join("");

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

// ═══════════════════════════════════════════════════════════════════
//  📊 40 THUẬT TOÁN PHÂN TÍCH (ANALYZERS)
// ═══════════════════════════════════════════════════════════════════
const A = {};

// ─── 1. Streak analysis ───
A.streakStats = h => {
    const st = streaks(h);
    const lens = st.slice(0, 30).map(s => s.len);
    return {
        raw: st,
        cur: st[0] || null,
        lens,
        avg: lens.reduce((a, b) => a + b, 0) / (lens.length || 1),
        max: Math.max(...lens, 0),
        min: Math.min(...lens, 99),
    };
};

// ─── 2. Shannon entropy ───
A.shannon = bits => {
    if (!bits.length) return 0;
    const p = bits.reduce((a, b) => a + b, 0) / bits.length;
    if (p <= 0 || p >= 1) return 0;
    return -p * Math.log2(p) - (1 - p) * Math.log2(1 - p);
};

// ─── 3. Conditional entropy ───
A.condEntropy = bits => {
    const c = { "0": [0, 0], "1": [0, 0] };
    for (let i = 0; i < bits.length - 1; i++) c[bits[i]][bits[i + 1]]++;
    let H = 0, n = bits.length - 1;
    for (const k of ["0", "1"]) {
        const tot = c[k][0] + c[k][1];
        if (!tot) continue;
        const p = tot / n;
        for (const v of c[k]) if (v) H -= p * (v / tot) * Math.log2(v / tot);
    }
    return H;
};

// ─── 4. Joint entropy ───
A.jointEntropy = bits => {
    const c = {};
    for (let i = 0; i < bits.length - 1; i++) {
        const k = `${bits[i]}${bits[i + 1]}`;
        c[k] = (c[k] || 0) + 1;
    }
    const n = bits.length - 1;
    let H = 0;
    for (const v of Object.values(c)) { const p = v / n; H -= p * Math.log2(p); }
    return H;
};

// ─── 5. Mutual information ───
A.mutualInfo = bits => {
    const Hx = A.shannon(bits);
    const Hy = A.shannon(bits.slice(1));
    const Hxy = A.jointEntropy(bits);
    return Math.max(0, Hx + Hy - Hxy);
};

// ─── 6. Autocorrelation multi-lag ───
A.autocorr = (bits, maxLag = 10) => {
    const out = [];
    for (let k = 1; k <= maxLag && k < bits.length; k++) {
        let m = 0, t = 0;
        for (let i = 0; i < bits.length - k; i++) { t++; if (bits[i] === bits[i + k]) m++; }
        out.push(t ? m / t : 0.5);
    }
    return out;
};

// ─── 7. Cross-correlation ───
A.crossCorr = (a, b) => {
    const n = Math.min(a.length, b.length);
    if (n < 5) return 0;
    let ma = 0, mb = 0;
    for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < n; i++) {
        num += (a[i] - ma) * (b[i] - mb);
        da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2;
    }
    return num / (Math.sqrt(da * db) + 1e-9);
};

// ─── 8. DFT spectrum ───
A.dft = (bits, maxK = 15) => {
    const n = bits.length, out = [];
    for (let k = 1; k <= Math.min(maxK, Math.floor(n / 2)); k++) {
        let re = 0, im = 0;
        for (let t = 0; t < n; t++) {
            const th = -2 * Math.PI * k * t / n;
            re += bits[t] * Math.cos(th);
            im += bits[t] * Math.sin(th);
        }
        out.push({ k, mag: Math.hypot(re, im) / n });
    }
    return out;
};

// ─── 9. Wavelet (Haar) ───
A.wavelet = (bits, scales = [2, 4, 8, 16]) => {
    return scales.map(s => {
        if (bits.length < s * 2) return { s, energy: 0 };
        let e = 0;
        for (let i = 0; i + s < bits.length; i++) e += (bits[i + s] - bits[i]) ** 2;
        return { s, energy: e / (bits.length - s) };
    });
};

// ─── 10. Hurst exponent ───
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
    const logL = lags.map(Math.log), logT = taus.map(Math.log);
    const mx = logL.reduce((a, b) => a + b, 0) / logL.length;
    const my = logT.reduce((a, b) => a + b, 0) / logT.length;
    let num = 0, den = 0;
    for (let i = 0; i < lags.length; i++) { num += (logL[i] - mx) * (logT[i] - my); den += (logL[i] - mx) ** 2; }
    return den ? num / den : 0.5;
};

// ─── 11. Lempel-Ziv complexity ───
A.lz = s => {
    let i = 0, c = 1, l = 1;
    while (i + l <= s.length) {
        if (s.slice(i, i + l).includes(s[i + l])) l++;
        else { i += l; l = 1; c++; }
    }
    return c / s.length;
};

// ─── 12. Permutation entropy ───
A.permEntropy = (bits, m = 3) => {
    const c = {};
    for (let i = 0; i <= bits.length - m; i++) {
        const w = bits.slice(i, i + m);
        const p = w.map((v, idx) => ({ v, idx })).sort((a, b) => a.v - b.v).map(x => x.idx).join("");
        c[p] = (c[p] || 0) + 1;
    }
    const n = Object.values(c).reduce((a, b) => a + b, 0);
    if (!n) return 0;
    let H = 0;
    for (const v of Object.values(c)) { const p = v / n; H -= p * Math.log2(p); }
    return H / Math.log2(6);
};

// ─── 13. Sample entropy ───
A.sampleEntropy = (bits, m = 2, r = 0.2) => {
    const cnt = (len) => {
        let c = 0;
        for (let i = 0; i < bits.length - len; i++)
            for (let j = i + 1; j < bits.length - len; j++) {
                let d = 0;
                for (let k = 0; k < len; k++) d = Math.max(d, Math.abs(bits[i + k] - bits[j + k]));
                if (d <= r) c++;
            }
        return c;
    };
    const A1 = cnt(m + 1), B = cnt(m);
    return A1 > 0 && B > 0 ? -Math.log(A1 / B) : 0;
};

// ─── 14. Approximate entropy ───
A.approxEntropy = (bits, m = 2, r = 0.2) => {
    const phi = (len) => {
        let s = 0;
        for (let i = 0; i <= bits.length - len; i++) {
            let c = 0;
            for (let j = 0; j <= bits.length - len; j++) {
                let d = 0;
                for (let k = 0; k < len; k++) d = Math.max(d, Math.abs(bits[i + k] - bits[j + k]));
                if (d <= r) c++;
            }
            s += Math.log(c / (bits.length - len + 1));
        }
        return s / (bits.length - len + 1);
    };
    return phi(m) - phi(m + 1);
};

// ─── 15. Wald-Wolfowitz runs test ───
A.runsTest = bits => {
    const n1 = bits.filter(x => x === 1).length;
    const n0 = bits.length - n1;
    if (!n1 || !n0) return 0;
    let runs = 1;
    for (let i = 1; i < bits.length; i++) if (bits[i] !== bits[i - 1]) runs++;
    const mean = 2 * n1 * n0 / (n1 + n0) + 1;
    const v = 2 * n1 * n0 * (2 * n1 * n0 - n1 - n0) / ((n1 + n0) ** 2 * (n1 + n0 - 1));
    return v > 0 ? (runs - mean) / Math.sqrt(v) : 0;
};

// ─── 16. Chi-square test ───
A.chiSquare = bits => {
    const t = bits.filter(x => x === 1).length, x = bits.length - t;
    const e = bits.length / 2;
    return ((t - e) ** 2 + (x - e) ** 2) / e;
};

// ─── 17. Kolmogorov-Smirnov ───
A.ks = bits => {
    const sorted = [...bits].sort((a, b) => a - b);
    const n = sorted.length;
    let d = 0;
    for (let i = 0; i < n; i++) {
        const F = sorted[i];
        d = Math.max(d, Math.abs(F - i / n), Math.abs((i + 1) / n - F));
    }
    return d;
};

// ─── 18. Z-score ───
A.zScore = bits => {
    if (bits.length < 3) return 0;
    const m = bits.reduce((a, b) => a + b, 0) / bits.length;
    const sd = Math.sqrt(bits.reduce((a, b) => a + (b - m) ** 2, 0) / bits.length) || 1e-6;
    return (bits[bits.length - 1] - m) / sd;
};

// ─── 19. CUSUM ───
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

// ─── 20. SPRT ───
A.sprt = (bits, p0 = 0.5, p1 = 0.65) => {
    let llr = 0;
    for (const x of bits) llr += x * Math.log(p1 / p0) + (1 - x) * Math.log((1 - p1) / (1 - p0));
    return llr;
};

// ─── 21. Changepoint detection ───
A.changepoint = bits => {
    const half = Math.floor(bits.length / 2);
    if (half < 3) return 0;
    const p1 = bits.slice(0, half).reduce((a, x) => a + x, 0) / half;
    const p2 = bits.slice(half).reduce((a, x) => a + x, 0) / (bits.length - half);
    return p2 - p1;
};

// ─── 22. EMA ───
A.ema = (bits, n) => {
    const a = 2 / (n + 1);
    let e = bits[0];
    for (let i = 1; i < bits.length; i++) e = a * bits[i] + (1 - a) * e;
    return e;
};

// ─── 23. MACD ───
A.macd = bits => A.ema(bits, 12) - A.ema(bits, 26);

// ─── 24. RSI ───
A.rsi = (bits, n = 14) => {
    const seg = bits.slice(-n);
    let gain = 0, loss = 0;
    for (let i = 1; i < seg.length; i++) {
        if (seg[i] > seg[i - 1]) gain++;
        else if (seg[i] < seg[i - 1]) loss++;
    }
    return 100 - 100 / (1 + gain / (loss || 1));
};

// ─── 25. Bollinger bands ───
A.bollinger = (bits, n = 20) => {
    const seg = bits.slice(-n);
    const m = seg.reduce((a, b) => a + b, 0) / seg.length;
    const sd = Math.sqrt(seg.reduce((a, b) => a + (b - m) ** 2, 0) / seg.length);
    const cur = seg[seg.length - 1];
    return { m, sd, upper: m + 2 * sd, lower: m - 2 * sd, cur, pos: (cur - m) / (sd + 1e-6) };
};

// ─── 26. Kalman filter ───
A.kalman = (bits, Q = 0.01, R = 0.1) => {
    let x = bits[0], P = 1;
    for (const z of bits) { P += Q; const K = P / (P + R); x += K * (z - x); P = (1 - K) * P; }
    return x;
};

// ─── 27. Markov transition matrix ───
A.markov = (chars, order = 2) => {
    const c = {};
    for (let i = 0; i < chars.length - order; i++) {
        const k = chars.slice(i, i + order);
        const nx = chars[i + order];
        if (!c[k]) c[k] = { T: 0, X: 0 };
        c[k][nx]++;
    }
    return c;
};

// ─── 28. N-gram frequency ───
A.ngram = (chars, n = 4) => {
    const c = {};
    for (let i = 0; i <= chars.length - n; i++) {
        const k = chars.slice(i, i + n);
        c[k] = (c[k] || 0) + 1;
    }
    return c;
};

// ─── 29. KNN pattern search ───
A.knn = (bits, k = 5, qLen = 4) => {
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

// ─── 30. Suffix match ───
A.suffixMatch = (chars, minL = 3, maxL = 12) => {
    for (let L = Math.min(maxL, chars.length - 1); L >= minL; L--) {
        const suf = chars.slice(-L);
        const idx = chars.slice(0, -1).lastIndexOf(suf);
        if (idx >= 0 && idx + L < chars.length)
            return { L, next: chars[idx + L], pattern: suf };
    }
    return null;
};

// ─── 31. Symbolic dynamics ───
A.symbolic = (chars, chunk = 4) => {
    const chunks = [];
    for (let i = 0; i + chunk <= chars.length; i += chunk) chunks.push(chars.slice(i, i + chunk));
    if (chunks.length < 3) return null;
    const last = chunks[chunks.length - 1];
    const idx = chunks.slice(0, -1).lastIndexOf(last);
    if (idx < 0) return null;
    return { pattern: last, next: chunks[idx + 1] };
};

// ─── 32. Recurrence analysis ───
A.recurrence = (chars, L = 4) => {
    if (chars.length < L * 2) return null;
    const last = chars.slice(-L);
    let m = 0;
    for (let i = 0; i + L <= chars.length - L; i++)
        if (chars.slice(i, i + L) === last) m++;
    return { matches: m, pattern: last };
};

// ─── 33. Phase space reconstruction ───
A.phaseSpace = (bits, dim = 3, delay = 2) => {
    if (bits.length < delay * (dim - 1) + 2) return null;
    const pts = [];
    for (let i = 0; i < bits.length - delay * (dim - 1); i++)
        pts.push({ idx: i, v: [bits[i], bits[i + delay], bits[i + 2 * delay]] });
    const last = pts[pts.length - 1];
    let best = pts[0], bd = 1e9;
    for (const p of pts.slice(0, -1)) {
        const d = p.v.reduce((a, v, j) => a + (v - last.v[j]) ** 2, 0);
        if (d < bd) { bd = d; best = p; }
    }
    const nxt = bits[best.idx + delay * (dim - 1) + 1];
    return { dist: Math.sqrt(bd), next: nxt };
};

// ─── 34. Fractal dimension ───
A.fractalDim = (chars, sizes = [2, 4, 8]) => {
    if (chars.length < 8) return 1;
    const cnts = sizes.map(sz => {
        const set = new Set();
        for (let i = 0; i + sz <= chars.length; i += sz) set.add(chars.slice(i, i + sz));
        return set.size;
    });
    if (cnts[0] < 2 || cnts[cnts.length - 1] < 2) return 1;
    const ls = sizes.map(Math.log), lc = cnts.map(Math.log);
    const mx = ls.reduce((a, b) => a + b, 0) / ls.length;
    const my = lc.reduce((a, b) => a + b, 0) / lc.length;
    let num = 0, den = 0;
    for (let i = 0; i < ls.length; i++) { num += (ls[i] - mx) * (lc[i] - my); den += (ls[i] - mx) ** 2; }
    return den ? num / den : 1;
};

// ─── 35. Lyapunov exponent ───
A.lyapunov = bits => {
    const d = [];
    for (let i = 1; i < bits.length; i++) d.push(Math.abs(bits[i] - bits[i - 1]));
    const avg = d.reduce((a, b) => a + b, 0) / (d.length || 1);
    return Math.log(avg + 1e-6);
};

// ─── 36. DFA ───
A.dfa = (bits, scales = [4, 8, 16]) => {
    const fluct = [];
    for (const s of scales) {
        if (bits.length < s * 2) continue;
        const F = [];
        for (let i = 0; i + s <= bits.length; i += s) {
            const seg = bits.slice(i, i + s);
            const m = seg.reduce((a, b) => a + b, 0) / s;
            const t = seg.reduce((a, v, idx) => a + (v - m) * (idx - s / 2), 0);
            const sxx = seg.reduce((a, _, idx) => a + (idx - s / 2) ** 2, 0);
            const slope = t / (sxx + 1e-9);
            const Fseg = Math.sqrt(seg.reduce((a, v, idx) => a + (v - m - slope * (idx - s / 2)) ** 2, 0) / s);
            F.push(Fseg);
        }
        fluct.push({ s, f: F.reduce((a, b) => a + b, 0) / F.length });
    }
    if (fluct.length < 2) return 0.5;
    const ls = fluct.map(x => Math.log(x.s)), lf = fluct.map(x => Math.log(x.f + 1e-6));
    const mx = ls.reduce((a, b) => a + b, 0) / ls.length;
    const my = lf.reduce((a, b) => a + b, 0) / lf.length;
    let num = 0, den = 0;
    for (let i = 0; i < ls.length; i++) { num += (ls[i] - mx) * (lf[i] - my); den += (ls[i] - mx) ** 2; }
    return den ? num / den : 0.5;
};

// ─── 37. Visibility graph ───
A.visibilityGraph = bits => {
    let edges = 0, nodes = bits.length;
    for (let i = 0; i < bits.length; i++)
        for (let j = i + 1; j < bits.length; j++) {
            let visible = true;
            for (let k = i + 1; k < j; k++) {
                const h = bits[i] + (bits[j] - bits[i]) * (k - i) / (j - i);
                if (bits[k] >= h) { visible = false; break; }
            }
            if (visible) edges++;
        }
    return edges / (nodes * (nodes - 1) / 2 + 1e-9);
};

// ─── 38. Volatility ───
A.volatility = bits => {
    if (bits.length < 2) return 0;
    const r = [];
    for (let i = 1; i < bits.length; i++) r.push(bits[i] - bits[i - 1]);
    const m = r.reduce((a, b) => a + b, 0) / r.length;
    return Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / r.length);
};

// ─── 39. Complexity (KC) ───
A.complexity = (chars, bits) => {
    const lz = A.lz(chars);
    const ent = A.shannon(bits);
    const hurst = A.hurst(bits);
    return (1 - lz) * ent * Math.abs(hurst - 0.5);
};

// ─── 40. Detrended fluctuation ───
A.detrend = bits => {
    const n = bits.length;
    if (n < 10) return 0;
    const m = bits.reduce((a, b) => a + b, 0) / n;
    const t = bits.reduce((a, v, i) => a + (v - m) * (i - n / 2), 0);
    const sxx = bits.reduce((a, _, i) => a + (i - n / 2) ** 2, 0);
    return t / (sxx + 1e-9);
};

console.log(`📊 Đã nạp ${Object.keys(A).length} thuật toán phân tích`);

// ═══════════════════════════════════════════════════════════════════
//  FEATURE BUNDLE — chạy toàn bộ analyzers 1 lần
// ═══════════════════════════════════════════════════════════════════
function analyze(hist) {
    const bits = bitsOf(hist, 80);
    const chars = charsOf(hist, 80);
    const short = bits.slice(-30);
    const st = A.streakStats(hist);

    return {
        bits, chars, st,
        // group by type
        entropy: {
            shannon: A.shannon(short),
            cond: A.condEntropy(short),
            joint: A.jointEntropy(short),
            mutual: A.mutualInfo(short),
            perm: A.permEntropy(short, 3),
            sample: A.sampleEntropy(short, 2, 0.2),
            approx: A.approxEntropy(short, 2, 0.2),
        },
        correlation: {
            ac: A.autocorr(short, 10),
            cross: A.crossCorr(short.slice(0, -1), short.slice(1)),
        },
        frequency: {
            dft: A.dft(short, 12),
            wavelet: A.wavelet(short),
        },
        complexity: {
            hurst: A.hurst(short),
            lz: A.lz(chars.slice(-40)),
            dfa: A.dfa(short),
            fractal: A.fractalDim(chars.slice(-40)),
            lyap: A.lyapunov(short),
            visGraph: A.visibilityGraph(short.slice(-20)),
            kc: A.complexity(chars.slice(-40), short),
        },
        statistical: {
            zscore: A.zScore(short),
            chi: A.chiSquare(short),
            ks: A.ks(short),
            runs: A.runsTest(short),
            volatility: A.volatility(short),
            trend: A.detrend(short),
        },
        changepoint: {
            cusum: A.cusum(short),
            sprt: A.sprt(short),
            cp: A.changepoint(short),
        },
        tech: {
            ema6: A.ema(short, 6),
            ema12: A.ema(short, 12),
            macd: A.macd(short),
            rsi: A.rsi(short, 14),
            boll: A.bollinger(short, 20),
            kalman: A.kalman(short),
        },
        pattern: {
            markov2: A.markov(chars, 2),
            markov3: A.markov(chars, 3),
            ng4: A.ngram(chars, 4),
            knn: A.knn(short, 5, 4),
            suffix: A.suffixMatch(chars, 3, 12),
            symbolic: A.symbolic(chars, 4),
            recurrence: A.recurrence(chars, 4),
            phase: A.phaseSpace(short, 3, 2),
        },
    };
}

// ═══════════════════════════════════════════════════════════════════
//  🎯 28 LOẠI CẦU — MỖI CẦU LOGIC ĐỘC LẬP
// ═══════════════════════════════════════════════════════════════════
const BRIDGES = [];
const B = (cat, id, name, fn) => BRIDGES.push({ cat, id, name, fn });

// ─── I. STREAK (4) ─────────────────────────────────────────────────
B("streak", "s_cont", "Bệt tiếp diễn", (h, ctx) => {
    const cur = ctx.f.st.cur;
    if (!cur || cur.len < 2 || cur.len > 5) return null;
    if (cur.len / ctx.f.st.avg > 1.8) return null;
    return { pred: cur.type, conf: 60 + cur.len * 3, src: `bệt ${cur.len} → theo` };
});

B("streak", "s_break", "Bệt bẻ", (h, ctx) => {
    const cur = ctx.f.st.cur;
    if (!cur || cur.len < 7) return null;
    return { pred: opp(cur.type), conf: Math.min(88, 66 + (cur.len - 7) * 3), src: `bệt ${cur.len} → BẺ` };
});

B("streak", "s_fatigue", "Bệt mỏi", (h, ctx) => {
    const cur = ctx.f.st.cur;
    if (!cur || cur.len < 6) return null;
    const pB = 1 - Math.pow(0.55, cur.len - 5);
    return { pred: pB > 0.5 ? opp(cur.type) : cur.type,
             conf: Math.round(56 + Math.abs(pB - 0.5) * 60),
             src: `mỏi ${cur.len} (P_break=${(pB * 100).toFixed(0)}%)` };
});

B("streak", "s_momentum", "Bệt động lượng", (h, ctx) => {
    const L = ctx.f.st.lens;
    if (L.length < 4) return null;
    const d1 = L[0] - L[1], d2 = L[1] - L[2], d3 = L[2] - L[3];
    if (d1 > 0 && d2 > 0 && d3 > 0) return { pred: ctx.f.st.cur.type, conf: 68, src: `bệt tăng liên tục` };
    if (d1 < 0 && d2 < 0 && d3 < 0) return { pred: opp(ctx.f.st.cur.type), conf: 66, src: `bệt giảm liên tục` };
    return null;
});

// ─── II. ALTERNATING (4) ───────────────────────────────────────────
function makeAlt(A_, B_, conf) {
    return (h, ctx) => {
        const st = ctx.f.st.raw;
        if (st.length < 6) return null;
        if (st[1].len !== A_ && st[1].len !== B_) return null;
        const first = st[1].len, second = first === A_ ? B_ : A_;
        for (let i = 2; i <= 5; i++) if (st[i].len !== (i % 2 === 0 ? second : first)) return null;
        const tgt = second, cur = st[0];
        if (cur.len < tgt) return { pred: cur.type, conf: conf - 4, src: `xen kẽ ${A_}-${B_} (${cur.len}/${tgt})` };
        if (cur.len === tgt) return { pred: opp(cur.type), conf, src: `xen kẽ ${A_}-${B_} (đảo)` };
        return null;
    };
}
B("alt", "a_11", "Xen kẽ 1-1", makeAlt(1, 1, 80));
B("alt", "a_12", "Xen kẽ 1-2", makeAlt(1, 2, 76));
B("alt", "a_13", "Xen kẽ 1-3", makeAlt(1, 3, 74));

B("alt", "a_rise", "Xen kẽ tăng", (h, ctx) => {
    const L = ctx.f.st.lens.slice(0, 6);
    if (L.length < 5) return null;
    if (L[1] < L[2] && L[2] < L[3] && L[3] < L[4])
        return { pred: opp(ctx.f.st.cur.type), conf: 68, src: `xen kẽ tăng ${L[4]}→${L[3]}→${L[2]}→${L[1]}` };
    return null;
});

// ─── III. CYCLE (3) ────────────────────────────────────────────────
B("cycle", "c_auto", "Chu kỳ autocorr", (h, ctx) => {
    const ac = ctx.f.correlation.ac;
    let bestLag = -1, bestVal = 0;
    for (let i = 1; i < ac.length; i++) if (ac[i] > bestVal) { bestVal = ac[i]; bestLag = i + 1; }
    if (bestLag < 2 || bestVal < 0.7) return null;
    const bits = ctx.f.bits;
    const nx = bits[bits.length - bestLag];
    return { pred: nx === 1 ? "Tài" : "Xỉu", conf: Math.round(58 + bestVal * 25), src: `AC peak lag=${bestLag} (${bestVal.toFixed(2)})` };
});

B("cycle", "c_fft", "Chu kỳ FFT", (h, ctx) => {
    const d = ctx.f.frequency.dft;
    if (!d.length) return null;
    const best = d.reduce((a, b) => b.mag > a.mag ? b : a);
    if (best.mag < 0.15) return null;
    const bits = ctx.f.bits;
    const nx = bits[bits.length - best.k];
    return { pred: nx === 1 ? "Tài" : "Xỉu", conf: Math.round(60 + best.mag * 100), src: `FFT k=${best.k} (${best.mag.toFixed(3)})` };
});

B("cycle", "c_wave", "Chu kỳ wavelet", (h, ctx) => {
    const w = ctx.f.frequency.wavelet;
    if (!w.length) return null;
    const dom = w.reduce((a, b) => b.energy > a.energy ? b : a);
    const bits = ctx.f.bits;
    const nx = bits[bits.length - dom.s];
    return { pred: nx === 1 ? "Tài" : "Xỉu", conf: 62, src: `wavelet scale=${dom.s}` };
});

// ─── IV. PATTERN MATCHING (4) ──────────────────────────────────────
B("pattern", "p_suffix", "Hậu tố n-gram", (h, ctx) => {
    const s = ctx.f.pattern.suffix;
    if (!s) return null;
    return { pred: s.next === "T" ? "Tài" : "Xỉu", conf: 60 + s.L * 1.5, src: `suffix L=${s.L} "${s.pattern}"` };
});

B("pattern", "p_knn", "KNN pattern", (h, ctx) => {
    const k = ctx.f.pattern.knn;
    if (!k.length) return null;
    let t = 0, x = 0;
    for (const p of k) { const w = 1 / (1 + p.d); if (p.nxt === 1) t += w; else x += w; }
    if (t + x === 0) return null;
    const pred = t > x ? "Tài" : "Xỉu";
    return { pred, conf: Math.round(58 + Math.abs(t - x) / (t + x) * 25), src: `KNN5 (T${t.toFixed(1)}/X${x.toFixed(1)})` };
});

B("pattern", "p_symb", "Symbolic dynamics", (h, ctx) => {
    const s = ctx.f.pattern.symbolic;
    if (!s) return null;
    return { pred: s.next[0] === "T" ? "Tài" : "Xỉu", conf: 64, src: `symbolic "${s.pattern}"` };
});

B("pattern", "p_recur", "Recurrence", (h, ctx) => {
    const r = ctx.f.pattern.recurrence;
    if (!r || r.matches < 2) return null;
    const chars = ctx.f.chars;
    const last = chars.slice(-r.pattern.length);
    const idx = chars.slice(0, -1).lastIndexOf(last);
    if (idx < 0) return null;
    const nx = chars[idx + r.pattern.length];
    return { pred: nx === "T" ? "Tài" : "Xỉu", conf: 62 + r.matches * 2, src: `recur ${r.matches}x` };
});

// ─── V. MARKOV (3) ─────────────────────────────────────────────────
function mkBridge(order, weighted, name, conf) {
    return (h, ctx) => {
        const chars = ctx.f.chars;
        if (chars.length < order + 10) return null;
        const c = {};
        for (let i = 0; i < chars.length - order; i++) {
            const k = chars.slice(i, i + order);
            const nx = chars[i + order];
            const w = weighted ? Math.pow(0.97, chars.length - i) : 1;
            if (!c[k]) c[k] = { T: 0, X: 0 };
            c[k][nx] += w;
        }
        const cur = chars.slice(-order);
        const s = c[cur];
        if (!s) return null;
        const tot = s.T + s.X;
        if (tot < 2) return null;
        const p = s.T / tot;
        return { pred: p > 0.5 ? "Tài" : "Xỉu", conf: Math.round(conf * Math.abs(p - 0.5) * 2 + 55),
                 src: `${name} [${cur}] (${(Math.max(p, 1 - p) * 100).toFixed(0)}%)` };
    };
}
B("markov", "mk2", "Markov bậc 2", mkBridge(2, false, "MK2", 68));
B("markov", "mk3", "Markov bậc 3", mkBridge(3, false, "MK3", 72));
B("markov", "mkW", "Markov trọng số", mkBridge(3, true, "MKW", 72));

// ─── VI. STATISTICS (4) ────────────────────────────────────────────
B("stat", "st_meanrev", "Hồi quy trung bình", (h, ctx) => {
    const b = ctx.f.bits.slice(-20);
    const m = b.reduce((a, x) => a + x, 0) / b.length;
    if (m > 0.7) return { pred: "Xỉu", conf: 64, src: `r20=${m.toFixed(2)} → đảo` };
    if (m < 0.3) return { pred: "Tài", conf: 64, src: `r20=${m.toFixed(2)} → đảo` };
    return null;
});

B("stat", "st_mom", "Động lượng", (h, ctx) => {
    const b = ctx.f.bits;
    const r5 = b.slice(-5).reduce((a, x) => a + x, 0) / 5;
    const r20 = b.slice(-20).reduce((a, x) => a + x, 0) / 20;
    if (r5 > 0.8 && r20 < 0.6) return { pred: "Tài", conf: 62, src: `mom short Tài` };
    if (r5 < 0.2 && r20 > 0.4) return { pred: "Xỉu", conf: 62, src: `mom short Xỉu` };
    return null;
});

B("stat", "st_vol", "Biến động", (h, ctx) => {
    const v = ctx.f.statistical.volatility;
    if (v > 0.5) return { pred: ctx.f.st.cur ? opp(ctx.f.st.cur.type) : "Tài", conf: 62, src: `vol cao ${v.toFixed(2)}` };
    if (v < 0.2) return { pred: ctx.f.st.cur?.type || "Tài", conf: 64, src: `vol thấp ${v.toFixed(2)}` };
    return null;
});

B("stat", "st_z", "Z-score", (h, ctx) => {
    const z = ctx.f.statistical.zscore;
    if (z > 1.4) return { pred: "Xỉu", conf: 64, src: `z=+${z.toFixed(2)}` };
    if (z < -1.4) return { pred: "Tài", conf: 64, src: `z=${z.toFixed(2)}` };
    return null;
});

// ─── VII. INFO THEORY (3) ──────────────────────────────────────────
B("info", "in_ent", "Entropy", (h, ctx) => {
    const H = ctx.f.entropy.shannon;
    if (H > 0.97) return { pred: opp(h[0].result), conf: 58, src: `H=${H.toFixed(3)} → đảo` };
    if (H < 0.7) return { pred: ctx.f.st.cur?.type || "Tài", conf: 64, src: `H=${H.toFixed(3)} → theo` };
    return null;
});

B("info", "in_mut", "Mutual info", (h, ctx) => {
    const mi = ctx.f.entropy.mutual;
    if (mi > 0.05) return { pred: ctx.f.st.cur?.type || "Tài", conf: 60, src: `MI=${mi.toFixed(3)}` };
    return null;
});

B("info", "in_lz", "LZ complexity", (h, ctx) => {
    const lz = ctx.f.complexity.lz;
    if (lz > 0.75) return { pred: opp(h[0].result), conf: 58, src: `LZ=${lz.toFixed(2)} cao` };
    if (lz < 0.4) return { pred: ctx.f.st.cur?.type || "Tài", conf: 62, src: `LZ=${lz.toFixed(2)} thấp` };
    return null;
});

// ─── VIII. FREQUENCY (3) ───────────────────────────────────────────
B("freq", "f_ac1", "Autocorr lag-1", (h, ctx) => {
    const a = ctx.f.correlation.ac[0];
    if (a > 0.7) return { pred: ctx.f.st.cur?.type || "Tài", conf: 62, src: `AC1=${a.toFixed(2)} → theo` };
    if (a < 0.3) return { pred: opp(h[0].result), conf: 62, src: `AC1=${a.toFixed(2)} → đảo` };
    return null;
});

B("freq", "f_ac2", "Autocorr lag-2", (h, ctx) => {
    const a = ctx.f.correlation.ac[1];
    if (a > 0.7) return { pred: h[1]?.result || "Tài", conf: 62, src: `AC2=${a.toFixed(2)}` };
    if (a < 0.3) return { pred: opp(h[1]?.result || "Tài"), conf: 62, src: `AC2=${a.toFixed(2)} đảo` };
    return null;
});

B("freq", "f_dom", "Dominant freq", (h, ctx) => {
    const d = ctx.f.frequency.dft;
    if (!d.length) return null;
    const best = d.reduce((a, b) => b.mag > a.mag ? b : a);
    if (best.mag < 0.2) return null;
    const nx = ctx.f.bits[ctx.f.bits.length - best.k];
    return { pred: nx === 1 ? "Tài" : "Xỉu", conf: 64, src: `dominant k=${best.k}` };
});

// ─── IX. DICE-LEVEL (3) ────────────────────────────────────────────
B("dice", "d_sum", "Xu hướng tổng", (h, ctx) => {
    const sums = h.slice(0, 8).map(x => x.total);
    if (sums.length < 5) return null;
    const slope = (sums[0] - sums[4]) / 4;
    if (slope > 1.5) return { pred: "Tài", conf: 62, src: `tổng tăng ${sums[4]}→${sums[0]}` };
    if (slope < -1.5) return { pred: "Xỉu", conf: 62, src: `tổng giảm` };
    return null;
});

B("dice", "d_mod", "Tổng mod", (h, ctx) => {
    const s = h.slice(0, 12).map(x => x.total % 4);
    const big = s.filter(x => x >= 2).length;
    if (big >= 9) return { pred: "Tài", conf: 60, src: `mod4 big ${big}/12` };
    if (big <= 3) return { pred: "Xỉu", conf: 60, src: `mod4 small ${12 - big}/12` };
    return null;
});

B("dice", "d_rep", "Lặp tổng", (h, ctx) => {
    const sums = h.slice(0, 10).map(x => x.total);
    const last = sums[0];
    const reps = sums.filter(s => s === last).length;
    if (reps >= 3) return { pred: last >= 11 ? "Xỉu" : "Tài", conf: 62, src: `tổng ${last} lặp ${reps}x` };
    return null;
});

// ─── X. ADVANCED (4) ───────────────────────────────────────────────
B("adv", "a_cusum", "CUSUM", (h, ctx) => {
    const c = ctx.f.changepoint.cusum;
    if (c.dir > 0) return { pred: "Xỉu", conf: 64, src: `CUSUM +${c.val.toFixed(1)}` };
    if (c.dir < 0) return { pred: "Tài", conf: 64, src: `CUSUM ${c.val.toFixed(1)}` };
    return null;
});

B("adv", "a_rsi", "RSI", (h, ctx) => {
    const r = ctx.f.tech.rsi;
    if (r > 75) return { pred: "Xỉu", conf: 64, src: `RSI=${r.toFixed(0)}` };
    if (r < 25) return { pred: "Tài", conf: 64, src: `RSI=${r.toFixed(0)}` };
    return null;
});

B("adv", "a_boll", "Bollinger", (h, ctx) => {
    const b = ctx.f.tech.boll;
    if (b.pos > 2) return { pred: "Xỉu", conf: 62, src: `Bollinger upper` };
    if (b.pos < -2) return { pred: "Tài", conf: 62, src: `Bollinger lower` };
    return null;
});

B("adv", "a_hurst", "Hurst exponent", (h, ctx) => {
    const H = ctx.f.complexity.hurst;
    if (H > 0.65) return { pred: ctx.f.st.cur?.type || "Tài", conf: 64, src: `Hurst=${H.toFixed(2)} persistent` };
    if (H < 0.35) return { pred: opp(h[0].result), conf: 64, src: `Hurst=${H.toFixed(2)} anti-persistent` };
    return null;
});

// ─── XI. META (4) ──────────────────────────────────────────────────
B("meta", "m_vote", "Meta vote", (h, ctx) => {
    const preds = ctx.basePreds;
    if (preds.length < 5) return null;
    const t = preds.filter(p => p.pred === "Tài").length, x = preds.length - t;
    const r = Math.max(t, x) / preds.length;
    if (r < 0.6) return null;
    return { pred: t > x ? "Tài" : "Xỉu", conf: Math.round(72 * r), src: `vote ${t}T/${x}X (${(r * 100).toFixed(0)}%)` };
});

B("meta", "m_weighted", "Meta weighted", (h, ctx) => {
    const preds = ctx.basePreds;
    if (preds.length < 5) return null;
    let t = 0, x = 0;
    for (const p of preds) {
        const w = (p.conf / 100) * (p.weight ?? 0.5);
        if (p.pred === "Tài") t += w; else x += w;
    }
    if (t + x === 0) return null;
    const r = Math.max(t, x) / (t + x);
    if (r < 0.6) return null;
    return { pred: t > x ? "Tài" : "Xỉu", conf: Math.round(78 * r), src: `weighted T${t.toFixed(1)}/X${x.toFixed(1)}` };
});

B("meta", "m_cons", "Meta consensus", (h, ctx) => {
    const preds = ctx.basePreds;
    if (preds.length < 15) return null;
    const t = preds.filter(p => p.pred === "Tài").length, x = preds.length - t;
    const r = Math.max(t, x) / preds.length;
    if (r < 0.7) return null;
    return { pred: t > x ? "Tài" : "Xỉu", conf: Math.round(82 * r), src: `consensus ${(r * 100).toFixed(0)}%` };
});

B("meta", "m_hybrid", "Meta hybrid", (h, ctx) => {
    const preds = ctx.basePreds;
    if (preds.length < 10) return null;
    const top = [...preds].sort((a, b) => b.conf * (b.weight ?? 1) - a.conf * (a.weight ?? 1)).slice(0, 8);
    const t = top.filter(p => p.pred === "Tài").length, x = 8 - t;
    if (t >= 6) return { pred: "Tài", conf: 80, src: `hybrid top8: ${t}T/${x}X` };
    if (x >= 6) return { pred: "Xỉu", conf: 80, src: `hybrid top8: ${t}T/${x}X` };
    return null;
});

console.log(`🎯 Đã nạp ${BRIDGES.length} cầu | ${new Set(BRIDGES.map(b => b.cat)).size} nhóm`);

// ═══════════════════════════════════════════════════════════════════
//  REGIME DETECTION
// ═══════════════════════════════════════════════════════════════════
function detectRegime(f) {
    const { entropy, complexity, correlation, statistical, st } = f;
    if (complexity.hurst > 0.68) return "PERSISTENT";
    if (complexity.hurst < 0.35) return "ANTIPERSISTENT";
    if (entropy.shannon > 0.97 && correlation.ac[0] < 0.5) return "CHAOTIC";
    if (statistical.volatility > 0.55) return "ALTERNATING";
    if (entropy.shannon < 0.85 && correlation.ac[0] > 0.7) return "TRENDING";
    if (st.cur?.len >= 9) return "FATIGUE";
    if (st.cur?.len >= 6) return "STREAK";
    if (entropy.shannon < 0.9 && correlation.ac[1] > 0.5) return "CYCLIC";
    return "NORMAL";
}

// ═══════════════════════════════════════════════════════════════════
//  BAYESIAN LEARNER + CALIBRATOR
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
    record(id, regime, ok) {
        this._r(id, ok);
        if (regime) this._r(`${id}@${regime}`, ok);
        this.tick();
    }
    _r(id, ok) {
        if (!this.stats[id]) this.stats[id] = { a: 1, b: 1 };
        if (ok) this.stats[id].a++; else this.stats[id].b++;
    }
    acc(id) { const s = this.stats[id]; return s ? s.a / (s.a + s.b) : 0.5; }
    n(id) { const s = this.stats[id]; return s ? (s.a + s.b - 2) : 0; }
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
        this.totalScored = 0;
        this.totalHit = 0;
    }

    buildContext(hist) {
        const features = analyze(hist);
        return { f: features, regime: detectRegime(features), basePreds: [] };
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
            src: `🧠 ${all.length} cầu | ${ctx.regime} | vote T${t.toFixed(1)}/X${x.toFixed(1)} | top10: ${topT}T/${10 - topT}X`,
            top: top10.map(p => ({
                name: p.name, cat: p.cat, pred: p.pred, conf: p.conf,
                acc: (p.weight * 100).toFixed(0) + "%",
                weight: p.weight.toFixed(3),
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
const engHu = new Engine();
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
    engine: `🚀 Engine v4 | ${BRIDGES.length} cầu + ${Object.keys(A).length} thuật toán phân tích`,
    categories: [...new Set(BRIDGES.map(b => b.cat))].map(cat => ({
        cat, count: BRIDGES.filter(b => b.cat === cat).length,
        bridges: BRIDGES.filter(b => b.cat === cat).map(b => b.name),
    })),
    analyzers: Object.keys(A),
    endpoints: {
        hu: `/api/taixiu/lc79?key=${VALID_KEY}`,
        md5: `/api/taixiumd5/lc79?key=${VALID_KEY}`,
        debug_hu: `/api/debug/hu?key=${VALID_KEY}`,
        debug_md5: `/api/debug/md5?key=${VALID_KEY}`,
        stats_hu: `/api/stats/hu?key=${VALID_KEY}`,
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

    // group by category
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
        features_summary: {
            shannon: ctx.f.entropy.shannon.toFixed(3),
            cond_entropy: ctx.f.entropy.cond.toFixed(3),
            mutual_info: ctx.f.entropy.mutual.toFixed(3),
            perm_entropy: ctx.f.entropy.perm.toFixed(3),
            hurst: ctx.f.complexity.hurst.toFixed(3),
            dfa: ctx.f.complexity.dfa.toFixed(3),
            lz: ctx.f.complexity.lz.toFixed(3),
            fractal: ctx.f.complexity.fractal.toFixed(3),
            lyap: ctx.f.complexity.lyap.toFixed(3),
            ac1: ctx.f.correlation.ac[0].toFixed(3),
            ac2: ctx.f.correlation.ac[1].toFixed(3),
            zscore: ctx.f.statistical.zscore.toFixed(3),
            chi2: ctx.f.statistical.chi.toFixed(3),
            runs: ctx.f.statistical.runs.toFixed(3),
            volatility: ctx.f.statistical.volatility.toFixed(3),
            rsi: ctx.f.tech.rsi.toFixed(1),
            macd: ctx.f.tech.macd.toFixed(3),
            cusum: ctx.f.changepoint.cusum.dir,
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
║  🚀 TÀI XỈU LC79 — ENGINE v4                                             ║
╠══════════════════════════════════════════════════════════════════════════╣
║  🚀 http://localhost:${PORT}                                             ║
║  🔑 KEY: ${VALID_KEY}                                                    ║
║  👤 ADMIN: ${ADMIN}                                                      ║
║                                                                          ║
║  🎯 ${BRIDGES.length} CẦU — ${cats.length} NHÓM CÂN BẰNG:                                        ║
${cats.map(cat => {
    const list = BRIDGES.filter(b => b.cat === cat);
    return `║     • ${cat.padEnd(8)} (${String(list.length).padStart(2)}) ${list.map(b => b.name).join(", ").slice(0, 50).padEnd(52)}║`;
}).join("\n")}
║                                                                          ║
║  📊 ${Object.keys(A).length} THUẬT TOÁN PHÂN TÍCH:                                          ║
║     entropy(7) | correlation(2) | frequency(2) | complexity(7)           ║
║     statistical(6) | changepoint(3) | tech(6) | pattern(8)               ║
║                                                                          ║
║  🧠 ENGINE: Bayesian α/β + decay + regime + calibration                  ║
║                                                                          ║
║  📌 API:                                                                 ║
║     HŨ   : /api/taixiu/lc79?key=${VALID_KEY}                            ║
║     MD5  : /api/taixiumd5/lc79?key=${VALID_KEY}                         ║
║     DEBUG: /api/debug/hu?key=${VALID_KEY}                               ║
║     STATS: /api/stats/hu?key=${VALID_KEY}                               ║
╚══════════════════════════════════════════════════════════════════════════╝
`);