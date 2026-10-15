import fastify from "fastify";
import cors from "@fastify/cors";
import fetch from "node-fetch";

// ═══════════════════════════════════════════════════════════════════
//  TÀI XỈU LC79 — ENGINE v6 (REFINED)
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
const chrono  = (h, n = 100) => h.slice(0, n).map(x => x.result).reverse();
const bitsOf  = (h, n = 100) => chrono(h, n).map(toB);
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
//  📊 50 THUẬT TOÁN PHÂN TÍCH (mỗi cái 1 chức năng riêng)
// ═══════════════════════════════════════════════════════════════════
const A = {};

/* ── ENTROPY FAMILY ───────────────────────────────────────────── */
A.shannon = bits => {
    if (!bits.length) return 0;
    const p = bits.reduce((a, b) => a + b, 0) / bits.length;
    return (p <= 0 || p >= 1) ? 0 : -p * Math.log2(p) - (1 - p) * Math.log2(1 - p);
};
A.condEnt = bits => {
    const c = [[0, 0], [0, 0]];
    for (let i = 0; i < bits.length - 1; i++) c[bits[i]][bits[i + 1]]++;
    let H = 0, n = bits.length - 1;
    for (let k = 0; k < 2; k++) {
        const tot = c[k][0] + c[k][1];
        if (!tot) continue;
        for (const v of c[k]) if (v) H -= (tot / n) * (v / tot) * Math.log2(v / tot);
    }
    return H;
};
A.mutualInfo = bits => {
    const n = bits.length - 1;
    if (n < 5) return 0;
    let mi = 0;
    const pT = bits.slice(1).filter(x => x === 1).length / n;
    for (let a = 0; a <= 1; a++)
        for (let b = 0; b <= 1; b++) {
            let c = 0;
            for (let i = 0; i < n; i++) if (bits[i] === a && bits[i + 1] === b) c++;
            if (!c) continue;
            const pj = c / n;
            const pa = a === 1 ? pT : 1 - pT;
            const pb = b === 1 ? pT : 1 - pT;
            if (pa > 0 && pb > 0) mi += pj * Math.log2(pj / (pa * pb));
        }
    return Math.max(0, mi);
};
A.permEnt = (bits, m = 3) => {
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
A.sampleEnt = (bits, m = 2, r = 0.2) => {
    const cnt = len => {
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
A.approxEnt = (bits, m = 2, r = 0.2) => {
    const phi = len => {
        let s = 0;
        for (let i = 0; i <= bits.length - len; i++) {
            let c = 0;
            for (let j = 0; j <= bits.length - len; j++) {
                let d = 0;
                for (let k = 0; k < len; k++) d = Math.max(d, Math.abs(bits[i + k] - bits[j + k]));
                if (d <= r) c++;
            }
            if (c > 0) s += Math.log(c / (bits.length - len + 1));
        }
        return s / (bits.length - len + 1);
    };
    return phi(m) - phi(m + 1);
};

/* ── CORRELATION ──────────────────────────────────────────────── */
A.autocorr = (bits, maxLag = 10) => {
    const out = [];
    for (let k = 1; k <= maxLag && k < bits.length; k++) {
        let m = 0, t = 0;
        for (let i = 0; i < bits.length - k; i++) { t++; if (bits[i] === bits[i + k]) m++; }
        out.push(t ? m / t : 0.5);
    }
    return out;
};
A.partialCorr = (bits, lag = 2) => {
    const ac = A.autocorr(bits, lag);
    if (ac.length < lag || ac[0] === 0) return 0;
    let pac = ac[0];
    for (let k = 2; k <= lag; k++) pac = (ac[k - 1] - ac[k - 2]) / (1 - pac);
    return isFinite(pac) ? pac : 0;
};

/* ── FREQUENCY / SPECTRAL ─────────────────────────────────────── */
A.dft = (bits, maxK = 12) => {
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
A.wavelet = (bits, scales = [2, 4, 8, 16]) =>
    scales.map(s => {
        if (bits.length < s * 2) return { s, e: 0 };
        let e = 0;
        for (let i = 0; i + s < bits.length; i++) e += (bits[i + s] - bits[i]) ** 2;
        return { s, e: e / (bits.length - s) };
    });
A.cepstrum = bits => {
    const n = bits.length;
    if (n < 16) return null;
    const logMag = [];
    for (let k = 1; k <= n / 2; k++) {
        let re = 0, im = 0;
        for (let t = 0; t < n; t++) {
            const th = -2 * Math.PI * k * t / n;
            re += bits[t] * Math.cos(th);
            im += bits[t] * Math.sin(th);
        }
        logMag.push(Math.log(Math.hypot(re, im) + 1e-6));
    }
    const m = logMag.length;
    const cep = [];
    for (let q = 0; q < m; q++) {
        let re = 0;
        for (let k = 0; k < m; k++) re += logMag[k] * Math.cos(2 * Math.PI * k * q / m);
        cep.push(re / m);
    }
    let dom = 1, mx = -1e9;
    for (let i = 1; i < Math.min(10, cep.length); i++)
        if (cep[i] > mx) { mx = cep[i]; dom = i; }
    return { quefrency: dom, peak: mx };
};

/* ── COMPLEXITY ───────────────────────────────────────────────── */
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
A.hurstRS = bits => {
    const n = bits.length;
    if (n < 20) return 0.5;
    const lags = [8, 16, 32].filter(l => l <= n);
    if (lags.length < 2) return 0.5;
    const rs = lags.map(l => {
        const seg = bits.slice(0, l);
        const m = seg.reduce((a, b) => a + b, 0) / l;
        let cum = 0, mn = 1e9, mx = -1e9;
        for (const v of seg) { cum += v - m; mn = Math.min(mn, cum); mx = Math.max(mx, cum); }
        const sd = Math.sqrt(seg.reduce((a, b) => a + (b - m) ** 2, 0) / l);
        return sd > 0 ? (mx - mn) / sd : 1e-6;
    });
    return slopeLogLog(lags, rs);
};
A.lz = s => {
    let i = 0, c = 1, l = 1;
    while (i + l <= s.length) {
        if (s.slice(i, i + l).includes(s[i + l])) l++;
        else { i += l; l = 1; c++; }
    }
    return c / s.length;
};
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
            const sl = t / (sxx + 1e-9);
            F.push(Math.sqrt(seg.reduce((a, v, idx) => a + (v - m - sl * (idx - s / 2)) ** 2, 0) / s));
        }
        fluct.push({ s, f: F.reduce((a, b) => a + b, 0) / F.length });
    }
    if (fluct.length < 2) return 0.5;
    return slopeLogLog(fluct.map(x => x.s), fluct.map(x => x.f + 1e-6));
};
A.fractalDim = (chars, sizes = [2, 4, 8]) => {
    if (chars.length < 8) return 1;
    const cnts = sizes.map(sz => {
        const set = new Set();
        for (let i = 0; i + sz <= chars.length; i += sz) set.add(chars.slice(i, i + sz));
        return set.size;
    });
    if (cnts[0] < 2 || cnts[cnts.length - 1] < 2) return 1;
    return slopeLogLog(sizes, cnts);
};
A.lyapunov = bits => {
    const d = [];
    for (let i = 1; i < bits.length; i++) d.push(Math.abs(bits[i] - bits[i - 1]));
    const avg = d.reduce((a, b) => a + b, 0) / (d.length || 1);
    return Math.log(avg + 1e-6);
};
A.transferEnt = (bits, lag = 1) => {
    const n = bits.length;
    if (n < lag + 5) return 0;
    const joint = {}, pX = {}, pY = {}, pYX = {};
    for (let i = lag; i < n; i++) {
        const x = bits[i - lag], y = bits[i - 1], yn = bits[i];
        joint[`${x}${y}${yn}`] = (joint[`${x}${y}${yn}`] || 0) + 1;
        pX[x] = (pX[x] || 0) + 1;
        pY[y] = (pY[y] || 0) + 1;
        pYX[`${y}${yn}`] = (pYX[`${y}${yn}`] || 0) + 1;
    }
    let TE = 0;
    const tot = n - lag;
    for (const [k, v] of Object.entries(joint)) {
        const p = v / tot;
        const px = pX[+k[0]] / tot;
        const pyx = pYX[k.slice(1)] / tot;
        const py = pY[+k[1]] / tot;
        if (p > 0 && px > 0 && pyx > 0 && py > 0) TE += p * Math.log2((p * py) / (px * pyx));
    }
    return Math.max(0, TE);
};
A.rqa = (bits, dim = 3, delay = 1, eps = 0.5) => {
    const n = bits.length - (dim - 1) * delay;
    if (n < 6) return { rr: 0, det: 0 };
    const vec = [];
    for (let i = 0; i < n; i++) {
        const v = [];
        for (let d = 0; d < dim; d++) v.push(bits[i + d * delay]);
        vec.push(v);
    }
    const R = [];
    for (let i = 0; i < vec.length; i++) {
        R.push([]);
        for (let j = 0; j < vec.length; j++) {
            const d = Math.sqrt(vec[i].reduce((a, v, k) => a + (v - vec[j][k]) ** 2, 0));
            R[i].push(d < eps ? 1 : 0);
        }
    }
    let rr = 0, tot = 0;
    for (let i = 0; i < R.length; i++)
        for (let j = i + 1; j < R.length; j++) { tot++; if (R[i][j]) rr++; }
    let det = 0, diagTot = 0;
    for (let k = 1; k < R.length; k++) {
        let run = 0, hits = 0;
        for (let i = 0; i + k < R.length; i++) {
            if (R[i][i + k]) { run++; hits++; }
            else { if (run >= 2) det += run; run = 0; }
        }
        if (run >= 2) det += run;
        diagTot += hits;
    }
    return { rr: tot ? rr / tot : 0, det: diagTot ? det / diagTot : 0 };
};

/* ── STATISTICAL ──────────────────────────────────────────────── */
A.zScore = bits => {
    if (bits.length < 3) return 0;
    const m = bits.reduce((a, b) => a + b, 0) / bits.length;
    const sd = Math.sqrt(bits.reduce((a, b) => a + (b - m) ** 2, 0) / bits.length) || 1e-6;
    return (bits[bits.length - 1] - m) / sd;
};
A.chiSquare = bits => {
    const t = bits.filter(x => x === 1).length, x = bits.length - t;
    const e = bits.length / 2;
    return ((t - e) ** 2 + (x - e) ** 2) / e;
};
A.runsTest = bits => {
    const n1 = bits.filter(x => x === 1).length, n0 = bits.length - n1;
    if (!n1 || !n0) return 0;
    let runs = 1;
    for (let i = 1; i < bits.length; i++) if (bits[i] !== bits[i - 1]) runs++;
    const mean = 2 * n1 * n0 / (n1 + n0) + 1;
    const v = 2 * n1 * n0 * (2 * n1 * n0 - n1 - n0) / ((n1 + n0) ** 2 * (n1 + n0 - 1));
    return v > 0 ? (runs - mean) / Math.sqrt(v) : 0;
};
A.volatility = bits => {
    if (bits.length < 2) return 0;
    let d = 0;
    for (let i = 1; i < bits.length; i++) d += Math.abs(bits[i] - bits[i - 1]);
    return d / (bits.length - 1);
};
A.jensenShannon = bits => {
    if (bits.length < 10) return 0;
    const h = Math.floor(bits.length / 2);
    const pA = bits.slice(0, h).reduce((a, b) => a + b, 0) / h;
    const pB = bits.slice(h).reduce((a, b) => a + b, 0) / (bits.length - h);
    const pM = (pA + pB) / 2;
    const kl = (p, q) => (p > 0 && q > 0) ? p * Math.log2(p / q) : 0;
    return 0.5 * (kl(pA, pM) + kl(1 - pA, 1 - pM) + kl(pB, pM) + kl(1 - pB, 1 - pM));
};
A.cramersV = (bits, order = 2) => {
    const n = bits.length - order;
    if (n < 10) return 0;
    const table = {};
    for (let i = 0; i < n; i++) {
        const k = bits.slice(i, i + order + 1).join("");
        table[k] = (table[k] || 0) + 1;
    }
    const chi = Object.values(table).reduce((a, v) => a + v * v, 0) / n - n;
    const k = new Set(Object.keys(table).map(x => x.slice(0, order))).size;
    return Math.min(1, Math.sqrt(chi / (n * (k - 1 + 1e-9))));
};

/* ── CHANGEPOINT ──────────────────────────────────────────────── */
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
A.sprt = (bits, p0 = 0.5, p1 = 0.6) => {
    let llr = 0;
    for (const x of bits) llr += x * Math.log(p1 / p0) + (1 - x) * Math.log((1 - p1) / (1 - p0));
    return llr;
};
A.changepoint = bits => {
    const half = Math.floor(bits.length / 2);
    if (half < 3) return 0;
    const p1 = bits.slice(0, half).reduce((a, x) => a + x, 0) / half;
    const p2 = bits.slice(half).reduce((a, x) => a + x, 0) / (bits.length - half);
    return p2 - p1;
};

/* ── TECHNICAL INDICATORS ─────────────────────────────────────── */
A.ema = (bits, n) => {
    const a = 2 / (n + 1);
    let e = bits[0];
    for (let i = 1; i < bits.length; i++) e = a * bits[i] + (1 - a) * e;
    return e;
};
A.macd = bits => A.ema(bits, 12) - A.ema(bits, 26);
A.rsi = (bits, n = 14) => {
    const seg = bits.slice(-n);
    let g = 0, l = 0;
    for (let i = 1; i < seg.length; i++) {
        if (seg[i] > seg[i - 1]) g++;
        else if (seg[i] < seg[i - 1]) l++;
    }
    return 100 - 100 / (1 + g / (l || 1));
};
A.bollinger = (bits, n = 20) => {
    const seg = bits.slice(-n);
    const m = seg.reduce((a, b) => a + b, 0) / seg.length;
    const sd = Math.sqrt(seg.reduce((a, b) => a + (b - m) ** 2, 0) / seg.length);
    const cur = seg[seg.length - 1];
    return { m, sd, upper: m + 2 * sd, lower: m - 2 * sd, cur, pos: (cur - m) / (sd + 1e-6) };
};
A.kalman = (bits, Q = 0.01, R = 0.1) => {
    let x = bits[0], P = 1;
    for (const z of bits) { P += Q; const K = P / (P + R); x += K * (z - x); P = (1 - K) * P; }
    return x;
};
A.theilSen = bits => {
    const n = bits.length;
    if (n < 5) return 0;
    const slopes = [];
    for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++) slopes.push((bits[j] - bits[i]) / (j - i));
    slopes.sort((a, b) => a - b);
    const mid = Math.floor(slopes.length / 2);
    return slopes.length % 2 ? slopes[mid] : (slopes[mid - 1] + slopes[mid]) / 2;
};

/* ── MARKOV FAMILY ────────────────────────────────────────────── */
function buildMarkov(chars, order, weighted, decay = 0.97) {
    if (chars.length < order + 5) return null;
    const cur = chars.slice(-order);
    const counts = { T: 0, X: 0 };
    for (let i = 0; i <= chars.length - order - 1; i++) {
        if (chars.slice(i, i + order) !== cur) continue;
        const w = weighted ? Math.pow(decay, chars.length - i) : 1;
        counts[chars[i + order]] += w;
    }
    const tot = counts.T + counts.X;
    if (tot < 2) return null;
    const pT = counts.T / tot;
    return {
        state: cur,
        next: pT > 0.5 ? "Tài" : "Xỉu",
        prob: Math.max(pT, 1 - pT),
        n: tot,
    };
}
A.markov1 = (chars, w = false) => buildMarkov(chars, 1, w);
A.markov2 = (chars, w = false) => buildMarkov(chars, 2, w);
A.markov3 = (chars, w = false) => buildMarkov(chars, 3, w);
A.markovW = (chars, order = 2, decay = 0.9) => buildMarkov(chars, order, true, decay);

/* ── CYCLE / PATTERN ──────────────────────────────────────────── */
A.cycleP = (chars, P) => {
    if (chars.length < P * 2 + 2) return null;
    const tail = chars.slice(-(P * 3));
    let m = 0, t = 0;
    for (let i = 0; i < tail.length - P; i++) { t++; if (tail[i] === tail[i + P]) m++; }
    if (t < P * 2) return null;
    const score = m / t;
    if (score < 0.75) return null;
    return { P, score, pred: chars[chars.length - P] === "T" ? "Tài" : "Xỉu" };
};
A.cycleAuto = (chars, minP = 2, maxP = 10) => {
    let best = null;
    for (let P = minP; P <= maxP; P++) {
        const r = A.cycleP(chars, P);
        if (r && (!best || r.score > best.score)) best = r;
    }
    return best;
};
A.suffixMatch = (chars, minL = 3, maxL = 14) => {
    for (let L = Math.min(maxL, chars.length - 1); L >= minL; L--) {
        const suf = chars.slice(-L);
        const idx = chars.slice(0, -1).lastIndexOf(suf);
        if (idx >= 0 && idx + L < chars.length)
            return { L, pattern: suf, next: chars[idx + L] };
    }
    return null;
};
A.ngram = (chars, n) => {
    const c = {};
    for (let i = 0; i <= chars.length - n; i++) {
        const k = chars.slice(i, i + n);
        c[k] = (c[k] || 0) + 1;
    }
    return c;
};
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
A.recurrence = (chars, L = 4) => {
    if (chars.length < L * 2) return null;
    const last = chars.slice(-L);
    let m = 0;
    for (let i = 0; i + L <= chars.length - L; i++)
        if (chars.slice(i, i + L) === last) m++;
    return { matches: m, pattern: last };
};
A.symbolic = (chars, chunk = 4) => {
    const chunks = [];
    for (let i = 0; i + chunk <= chars.length; i += chunk) chunks.push(chars.slice(i, i + chunk));
    if (chunks.length < 3) return null;
    const last = chunks[chunks.length - 1];
    const idx = chunks.slice(0, -1).lastIndexOf(last);
    if (idx < 0) return null;
    return { pattern: last, next: chunks[idx + 1] };
};

/* ── BAYESIAN / PROBABILISTIC ─────────────────────────────────── */
A.bayesPosterior = (bits, prior = 0.5, pTrue = 0.55) => {
    const n = bits.length;
    const k = bits.filter(x => x === 1).length;
    const lT = k * Math.log(pTrue) + (n - k) * Math.log(1 - pTrue);
    const lX = k * Math.log(1 - pTrue) + (n - k) * Math.log(pTrue);
    const mx = Math.max(lT, lX);
    const postT = Math.exp(lT - mx) * prior;
    const postX = Math.exp(lX - mx) * (1 - prior);
    const pT = postT / (postT + postX);
    return { pT, next: pT > 0.5 ? "Tài" : "Xỉu", prob: Math.max(pT, 1 - pT) };
};

/* ── SHARED UTILS ─────────────────────────────────────────────── */
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
    const bits = bitsOf(hist, 80);
    const chars = charsOf(hist, 80);
    const short = bits.slice(-30);
    const st = (() => {
        const all = streaks(hist);
        const lens = all.slice(0, 30).map(s => s.len);
        return {
            raw: all,
            cur: all[0] || null,
            prev: all[1] || null,
            lens,
            avg: lens.reduce((a, b) => a + b, 0) / (lens.length || 1),
            max: Math.max(...lens, 0),
        };
    })();

    return {
        bits, chars, st,
        entropy: {
            shannon: A.shannon(short),
            cond: A.condEnt(short),
            mutual: A.mutualInfo(short),
            perm: A.permEnt(short, 3),
            sample: A.sampleEnt(short, 2, 0.2),
            approx: A.approxEnt(short, 2, 0.2),
        },
        corr: {
            ac: A.autocorr(short, 10),
            pac2: A.partialCorr(short, 2),
        },
        freq: {
            dft: A.dft(short, 12),
            wavelet: A.wavelet(short),
            cepstrum: A.cepstrum(short),
        },
        complexity: {
            hurst: A.hurst(short),
            hurstRS: A.hurstRS(short),
            lz: A.lz(chars.slice(-40)),
            dfa: A.dfa(short),
            fractal: A.fractalDim(chars.slice(-40)),
            lyap: A.lyapunov(short),
            transfer: A.transferEnt(short, 1),
            rqa: A.rqa(short, 3, 1, 0.5),
        },
        stat: {
            zscore: A.zScore(short),
            chi: A.chiSquare(short),
            runs: A.runsTest(short),
            vol: A.volatility(short),
            js: A.jensenShannon(short),
            cramer: A.cramersV(short, 2),
        },
        change: {
            cusum: A.cusum(short),
            sprt: A.sprt(short),
            cp: A.changepoint(short),
        },
        tech: {
            rsi: A.rsi(short, 14),
            boll: A.bollinger(short, 20),
            kalman: A.kalman(short),
            theil: A.theilSen(short),
            macd: A.macd(short),
        },
        markov: {
            m1: A.markov1(chars, false),
            m2: A.markov2(chars, false),
            m3: A.markov3(chars, false),
            mW: A.markovW(chars, 2, 0.9),
        },
        cycle: {
            auto: A.cycleAuto(chars, 2, 10),
        },
        pattern: {
            suffix: A.suffixMatch(chars, 3, 14),
            knn: A.knn(short, 5, 4),
            recurrence: A.recurrence(chars, 4),
            symbolic: A.symbolic(chars, 4),
        },
        bayes: A.bayesPosterior(short, 0.5, 0.55),
    };
}

// ═══════════════════════════════════════════════════════════════════
//  🎯 44 CẦU — PHÂN BỐ CÂN BẰNG, MỖI CẦU LOGIC RIÊNG
// ═══════════════════════════════════════════════════════════════════
const BRIDGES = [];
const B = (cat, id, name, fn) => BRIDGES.push({ cat, id, name, fn });

/* ─── I. STREAK (7) ───────────────────────────────────────────── */
function betBridge(L, mode, conf) {
    return (h, ctx) => {
        const cur = ctx.f.st.cur;
        if (!cur || cur.len < L) return null;
        if (mode === "cont" && cur.len > L + 1) return null;
        if (mode === "brk" && cur.len > L + 2) return null;
        const pred = mode === "brk" ? opp(cur.type) : cur.type;
        return { pred, conf, src: `bệt ${cur.len} → ${mode === "brk" ? "BẺ" : "THEO"}` };
    };
}
B("streak", "bet2", "Bệt-2 theo", betBridge(2, "cont", 60));
B("streak", "bet3", "Bệt-3 theo", betBridge(3, "cont", 62));
B("streak", "bet4", "Bệt-4 theo", betBridge(4, "cont", 63));
B("streak", "bet5", "Bệt-5 theo", betBridge(5, "cont", 64));
B("streak", "bet6", "Bệt-6 theo", betBridge(6, "cont", 64));
B("streak", "bet7", "Bệt-7 bẻ",  betBridge(7, "brk",  68));
B("streak", "bet8", "Bệt-8+ bẻ", (h, ctx) => {
    const cur = ctx.f.st.cur;
    if (!cur || cur.len < 8) return null;
    return { pred: opp(cur.type), conf: Math.min(90, 70 + (cur.len - 8) * 2), src: `bệt ${cur.len} → BẺ` };
});

/* ─── II. ALTERNATING (8) ─────────────────────────────────────── */
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
B("alt", "alt11", "Xen kẽ 1-1", altBridge(1, 1, 80));
B("alt", "alt22", "Xen kẽ 2-2", altBridge(2, 2, 78));
B("alt", "alt33", "Xen kẽ 3-3", altBridge(3, 3, 76));
B("alt", "alt44", "Xen kẽ 4-4", altBridge(4, 4, 74));
B("alt", "alt12", "Xen kẽ 1-2", altBridge(1, 2, 76));
B("alt", "alt21", "Xen kẽ 2-1", altBridge(2, 1, 76));
B("alt", "alt13", "Xen kẽ 1-3", altBridge(1, 3, 74));
B("alt", "alt31", "Xen kẽ 3-1", altBridge(3, 1, 74));

/* ─── III. CYCLE (8) ──────────────────────────────────────────── */
function cycleBridge(P, conf) {
    return (h, ctx) => {
        const r = A.cycleP(ctx.f.chars, P);
        if (!r) return null;
        return { pred: r.pred, conf: Math.round(conf * r.score), src: `chu kỳ P=${P} (${(r.score * 100).toFixed(0)}%)` };
    };
}
B("cycle", "cyc2", "Chu kỳ 2", cycleBridge(2, 78));
B("cycle", "cyc3", "Chu kỳ 3", cycleBridge(3, 78));
B("cycle", "cyc4", "Chu kỳ 4", cycleBridge(4, 76));
B("cycle", "cyc5", "Chu kỳ 5", cycleBridge(5, 76));
B("cycle", "cyc6", "Chu kỳ 6", cycleBridge(6, 74));
B("cycle", "cyc7", "Chu kỳ 7", cycleBridge(7, 74));
B("cycle", "cyc8", "Chu kỳ 8", cycleBridge(8, 72));
B("cycle", "cyc9", "Chu kỳ 9", cycleBridge(9, 72));

/* ─── IV. MARKOV (4) ─────────────────────────────────────────── */
function markovBridge(getter, name, conf) {
    return (h, ctx) => {
        const m = getter(ctx.f);
        if (!m || m.n < 2) return null;
        return { pred: m.next, conf: Math.round(55 + (m.prob - 0.5) * conf), src: `${name} [${m.state}] (${(m.prob * 100).toFixed(0)}%)` };
    };
}
B("markov", "mk1", "Markov v1", markovBridge(f => f.markov.m1, "MK1", 60));
B("markov", "mk2", "Markov v2", markovBridge(f => f.markov.m2, "MK2", 64));
B("markov", "mk3", "Markov v3", markovBridge(f => f.markov.m3, "MK3", 66));
B("markov", "mkW", "Markov weighted", markovBridge(f => f.markov.mW, "MKW", 68));

/* ─── V. PATTERN (4) ─────────────────────────────────────────── */
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
    const s = ctx.f.pattern.suffix;
    if (!s) return null;
    return { pred: s.next === "T" ? "Tài" : "Xỉu", conf: Math.min(82, 60 + s.L * 1.5), src: `suffix L=${s.L}` };
});

/* ─── VI. KNN (2) ────────────────────────────────────────────── */
function knnBridge(k, name, conf) {
    return (h, ctx) => {
        const top = ctx.f.pattern.knn;
        if (!top || top.length < k) return null;
        let t = 0, x = 0;
        for (const s of top) { const w = 1 / (1 + s.d); if (s.nxt === 1) t += w; else x += w; }
        if (t + x === 0) return null;
        const pred = t > x ? "Tài" : "Xỉu";
        return { pred, conf: Math.round(conf + Math.abs(t - x) / (t + x) * 15), src: `${name} (T${t.toFixed(1)}/X${x.toFixed(1)})` };
    };
}
B("knn", "knn3", "KNN k=3", knnBridge(3, "KNN3", 62));
B("knn", "knn5", "KNN k=5", knnBridge(5, "KNN5", 64));

/* ─── VII. REVERSAL / MOMENTUM (2) ───────────────────────────── */
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

/* ─── VIII. STATISTICS (3) ───────────────────────────────────── */
B("stat", "zscore", "Z-score", (h, ctx) => {
    const z = ctx.f.stat.zscore;
    if (z > 1.4)  return { pred: "Xỉu", conf: 64, src: `z=+${z.toFixed(2)}` };
    if (z < -1.4) return { pred: "Tài", conf: 64, src: `z=${z.toFixed(2)}` };
    return null;
});
B("stat", "entropy", "Entropy", (h, ctx) => {
    const H = ctx.f.entropy.shannon;
    if (H > 0.97) return { pred: opp(h[0].result), conf: 58, src: `H=${H.toFixed(3)} → đảo` };
    if (H < 0.7)  return { pred: ctx.f.st.cur?.type || "Tài", conf: 64, src: `H=${H.toFixed(3)} → theo` };
    return null;
});
B("stat", "volatility", "Biến động", (h, ctx) => {
    const v = ctx.f.stat.vol;
    if (v > 0.55) return { pred: ctx.f.st.cur ? opp(ctx.f.st.cur.type) : "Tài", conf: 62, src: `vol cao ${v.toFixed(2)}` };
    if (v < 0.25) return { pred: ctx.f.st.cur?.type || "Tài", conf: 64, src: `vol thấp ${v.toFixed(2)}` };
    return null;
});

/* ─── IX. DICE-LEVEL (3) ─────────────────────────────────────── */
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

/* ─── X. CUSUM/RISK (2) ──────────────────────────────────────── */
B("risk", "cusum", "CUSUM", (h, ctx) => {
    const c = ctx.f.change.cusum;
    if (c.dir > 0) return { pred: "Xỉu", conf: 64, src: `CUSUM +${c.val.toFixed(1)}` };
    if (c.dir < 0) return { pred: "Tài", conf: 64, src: `CUSUM ${c.val.toFixed(1)}` };
    return null;
});
B("risk", "rsi", "RSI", (h, ctx) => {
    const r = ctx.f.tech.rsi;
    if (r > 75) return { pred: "Xỉu", conf: 64, src: `RSI=${r.toFixed(0)}` };
    if (r < 25) return { pred: "Tài", conf: 64, src: `RSI=${r.toFixed(0)}` };
    return null;
});

/* ─── XI. COMPLEXITY (2) ─────────────────────────────────────── */
B("complex", "hurst", "Hurst exponent", (h, ctx) => {
    const H = ctx.f.complexity.hurst;
    if (H > 0.65) return { pred: ctx.f.st.cur?.type || "Tài", conf: 62, src: `Hurst=${H.toFixed(2)} persistent` };
    if (H < 0.35) return { pred: opp(h[0].result), conf: 62, src: `Hurst=${H.toFixed(2)} anti-persist` };
    return null;
});
B("complex", "bayes", "Bayesian post", (h, ctx) => {
    const b = ctx.f.bayes;
    if (b.prob < 0.6) return null;
    return { pred: b.next, conf: Math.round(55 + b.prob * 25), src: `Bayes (${(b.prob * 100).toFixed(0)}%)` };
});

/* ─── XII. META (3) ──────────────────────────────────────────── */
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

// Count
const CATS = {};
for (const b of BRIDGES) CATS[b.cat] = (CATS[b.cat] || 0) + 1;
console.log(`🎯 Cầu: ${BRIDGES.length} | Nhóm: ${Object.keys(CATS).length}`);
for (const [c, n] of Object.entries(CATS))
    console.log(`   • ${c.padEnd(10)} ${String(n).padStart(2)} (${(n / BRIDGES.length * 100).toFixed(1)}%)`);

// ═══════════════════════════════════════════════════════════════════
//  REGIME DETECTION
// ═══════════════════════════════════════════════════════════════════
function detectRegime(f) {
    const { entropy, corr, stat, complexity, st } = f;
    if (complexity.hurst > 0.65) return "PERSISTENT";
    if (complexity.hurst < 0.35) return "ANTIPERSISTENT";
    if (entropy.shannon > 0.97 && corr.ac[0] < 0.5) return "CHAOTIC";
    if (stat.vol > 0.55) return "ALTERNATING";
    if (entropy.shannon < 0.85 && corr.ac[0] > 0.7) return "TRENDING";
    if (st.cur?.len >= 9) return "FATIGUE";
    if (st.cur?.len >= 6) return "STREAK";
    if (entropy.shannon < 0.9 && corr.ac[1] > 0.5) return "CYCLIC";
    return "NORMAL";
}

// ═══════════════════════════════════════════════════════════════════
//  BAYESIAN LEARNER
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

// ═══════════════════════════════════════════════════════════════════
//  CALIBRATOR
// ═══════════════════════════════════════════════════════════════════
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
        this.totalScored = 0;
        this.totalHit = 0;
    }

    buildContext(hist) {
        const f = analyze(hist);
        return { f, regime: detectRegime(f), basePreds: [] };
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

        // Weighted vote
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
    engine: `Engine v6 | ${BRIDGES.length} cầu | ${Object.keys(A).length} analyzers`,
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
            shannon: ctx.f.entropy.shannon.toFixed(3),
            condEnt: ctx.f.entropy.cond.toFixed(3),
            mutualInfo: ctx.f.entropy.mutual.toFixed(3),
            permEnt: ctx.f.entropy.perm.toFixed(3),
            sampleEnt: ctx.f.entropy.sample.toFixed(3),
            hurst: ctx.f.complexity.hurst.toFixed(3),
            hurstRS: ctx.f.complexity.hurstRS.toFixed(3),
            dfa: ctx.f.complexity.dfa.toFixed(3),
            lz: ctx.f.complexity.lz.toFixed(3),
            fractal: ctx.f.complexity.fractal.toFixed(3),
            lyap: ctx.f.complexity.lyap.toFixed(3),
            transfer: ctx.f.complexity.transfer.toFixed(3),
            rqa_rr: ctx.f.complexity.rqa.rr.toFixed(3),
            rqa_det: ctx.f.complexity.rqa.det.toFixed(3),
            ac1: ctx.f.corr.ac[0].toFixed(3),
            ac2: ctx.f.corr.ac[1].toFixed(3),
            pac2: ctx.f.corr.pac2.toFixed(3),
            zscore: ctx.f.stat.zscore.toFixed(3),
            chi: ctx.f.stat.chi.toFixed(3),
            runs: ctx.f.stat.runs.toFixed(3),
            vol: ctx.f.stat.vol.toFixed(3),
            js: ctx.f.stat.js.toFixed(3),
            cramer: ctx.f.stat.cramer.toFixed(3),
            rsi: ctx.f.tech.rsi.toFixed(1),
            theil: ctx.f.tech.theil.toFixed(3),
            kalman: ctx.f.tech.kalman.toFixed(3),
            markov1: ctx.f.markov.m1 ? `${ctx.f.markov.m1.next}(${(ctx.f.markov.m1.prob * 100).toFixed(0)}%|n${ctx.f.markov.m1.n})` : "-",
            markov2: ctx.f.markov.m2 ? `${ctx.f.markov.m2.next}(${(ctx.f.markov.m2.prob * 100).toFixed(0)}%|n${ctx.f.markov.m2.n})` : "-",
            markov3: ctx.f.markov.m3 ? `${ctx.f.markov.m3.next}(${(ctx.f.markov.m3.prob * 100).toFixed(0)}%|n${ctx.f.markov.m3.n})` : "-",
            markovW: ctx.f.markov.mW ? `${ctx.f.markov.mW.next}(${(ctx.f.markov.mW.prob * 100).toFixed(0)}%)` : "-",
            cycleAuto: ctx.f.cycle.auto ? `P=${ctx.f.cycle.auto.P} ${ctx.f.cycle.auto.pred} (${(ctx.f.cycle.auto.score * 100).toFixed(0)}%)` : "-",
            bayes: ctx.f.bayes ? `${ctx.f.bayes.next}(${(ctx.f.bayes.prob * 100).toFixed(0)}%)` : "-",
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

console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║  🚀 TÀI XỈU LC79 — ENGINE v6 (REFINED)                                   ║
╠══════════════════════════════════════════════════════════════════════════╣
║  🚀 http://localhost:${PORT}                                             ║
║  🔑 KEY: ${VALID_KEY}                                                    ║
║  👤 ADMIN: ${ADMIN}                                                      ║
║                                                                          ║
║  🎯 ${BRIDGES.length} CẦU — ${Object.keys(CATS).length} NHÓM CÂN BẰNG                                        ║
${Object.entries(CATS).map(([c, n]) => {
    const pct = (n / BRIDGES.length * 100).toFixed(1);
    return `║     • ${c.padEnd(10)} ${String(n).padStart(2)} cầu (${pct.padStart(5)}%)                              ║`;
}).join("\n")}
║                                                                          ║
║  📊 ${Object.keys(A).length} THUẬT TOÁN PHÂN TÍCH                                            ║
║     Entropy(6) | Correlation(2) | Freq(3) | Complexity(8)                ║
║     Statistical(6) | Changepoint(3) | Tech(5) | Markov(4)                ║
║     Cycle(2) | Pattern(5) | Bayesian(1)                                  ║
║                                                                          ║
║  🧠 Bayesian α/β + Regime + Calibration                                  ║
║                                                                          ║
║  📌 API:                                                                 ║
║     HŨ   : /api/taixiu/lc79?key=${VALID_KEY}                            ║
║     DEBUG: /api/debug/hu?key=${VALID_KEY}                               ║
║     STATS: /api/stats/hu?key=${VALID_KEY}                               ║
╚══════════════════════════════════════════════════════════════════════════╝
`);