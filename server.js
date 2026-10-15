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
const MAX_HIST  = 500;

const API_HU  = "https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5";
const API_MD5 = "https://wtxmd52.tele68.com/v1/txmd5/sessions";

// ═══════════════════════════════════════════════════════════════════
//  SAFE HELPERS (chống NaN toàn hệ thống)
// ═══════════════════════════════════════════════════════════════════
const fin   = (x, f = 60) => Number.isFinite(x) ? x : f;
const clamp = (p, lo = 0.05, hi = 0.95) => {
    if (!Number.isFinite(p)) return 0.5;
    return Math.max(lo, Math.min(hi, p));
};
const softmax = (arr) => {
    const safe = arr.map(v => Number.isFinite(v) ? v : -50);
    const mx = Math.max(...safe, -50);
    const ex = safe.map(v => Math.exp(v - mx));
    const Z  = ex.reduce((a, b) => a + b, 0) || 1;
    return ex.map(v => (Number.isFinite(v / Z) ? v / Z : 0));
};

function lgamma(x) {
    if (!Number.isFinite(x) || x <= 0) return 0;
    const g = 7;
    const C = [
        0.99999999999980993, 676.5203681218851, -1259.1392167224028,
        771.32342877765313, -176.61502916214059, 12.507343278686905,
        -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
    ];
    if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
    x -= 1;
    let a = C[0];
    const t = x + g + 0.5;
    for (let i = 1; i < g + 2; i++) a += C[i] / (x + i);
    const r = 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
    return Number.isFinite(r) ? r : 0;
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
const opp     = x => x === "Tài" ? "Xỉu" : "Tài";
const bao     = d => d?.[0] === d?.[1] && d?.[1] === d?.[2];
const toB     = r => r === "Tài" ? 1 : 0;
const toC     = r => r === "Tài" ? "T" : "X";
const toArr   = s => typeof s === "string" ? [...s] : s;
const chrono  = (h, n = 200) => h.slice(0, n).map(x => x.result).reverse();
const bitsOf  = (h, n = 200) => chrono(h, n).map(toB);
const charsOf = (h, n = 200) => chrono(h, n).map(toC).join("");

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
//  ALGORITHMS
// ═══════════════════════════════════════════════════════════════════
function ktProb(a, b) {
    if (a === 0 && b === 0) return 0.5;
    const num = lgamma(a + 0.5) - lgamma(0.5) + lgamma(b + 0.5) - lgamma(0.5);
    const den = lgamma(a + b + 1) - lgamma(1);
    const r = Math.exp(num - den);
    return Number.isFinite(r) && r > 0 ? r : 0.5;
}
function ctwPredict(seq, maxDepth = 6) {
    const arr = toArr(seq);
    const n = arr.length;
    if (n < 10) return { p: 0.5, depth: 0, n: 0 };
    const scores = [];
    for (let d = 1; d <= Math.min(maxDepth, n - 1); d++) {
        const ctx = arr.slice(-d).join("");
        let ct = 0, cx = 0;
        for (let i = 0; i < n - d; i++) {
            if (arr.slice(i, i + d).join("") === ctx) {
                if (arr[i + d] === "T") ct++; else cx++;
            }
        }
        const kt = ktProb(ct, cx);
        const ll = Math.log(Math.max(kt, 1e-12));
        scores.push({ d, ct, cx, ll: Number.isFinite(ll) ? ll : -50 });
    }
    if (!scores.length) return { p: 0.5, depth: 0, n: 0 };
    const W = softmax(scores.map(s => s.ll));
    let p = 0, total = 0;
    for (let i = 0; i < scores.length; i++) {
        const s = scores[i];
        const pD = (s.ct + 0.5) / (s.ct + s.cx + 1);
        p += W[i] * pD;
        total += s.ct + s.cx;
    }
    return { p: fin(p, 0.5), depth: scores[0].d, n: total };
}

class Kalman1D {
    constructor(q = 0.02, r = 0.15) { this.x = 0.5; this.P = 1.0; this.Q = q; this.R = r; }
    update(z) {
        if (!Number.isFinite(z)) return this.x;
        const PPred = this.P + this.Q;
        const K = PPred / (PPred + this.R);
        this.x = this.x + K * (z - this.x);
        this.P = (1 - K) * PPred;
        if (!Number.isFinite(this.x)) this.x = 0.5;
        if (!Number.isFinite(this.P)) this.P = 1.0;
        return this.x;
    }
}

function wilsonLB(wins, total, z = 1.96) {
    if (!Number.isFinite(wins) || !Number.isFinite(total) || total <= 0) return 0;
    const p = wins / total, n = total;
    const denom  = 1 + z * z / n;
    const center = (p + z * z / (2 * n)) / denom;
    const margin = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom;
    const r = center - margin;
    return Number.isFinite(r) && r > 0 ? r : 0;
}

class BMA {
    constructor(decay = 0.97) { this.log_w = {}; this.decay = decay; this.hits = {}; this.totals = {}; }
    weights() {
        const names = Object.keys(this.log_w).filter(n => Number.isFinite(this.log_w[n]));
        if (!names.length) return {};
        const mx = Math.max(...names.map(n => this.log_w[n]));
        const ex = names.map(n => Math.exp(this.log_w[n] - mx));
        const Z  = ex.reduce((a, b) => a + b, 0) || 1;
        const out = {};
        names.forEach((n, i) => out[n] = fin(ex[i] / Z, 0));
        return out;
    }
    predict(signals) {
        if (!signals.length) return 50;
        const W = this.weights();
        const hasW = Object.keys(W).length > 0;
        let num = 0, den = 0;
        for (const s of signals) {
            const pt = Number.isFinite(s.p_tai) ? s.p_tai : 50;
            const w = hasW ? fin(W[s.id], 1 / signals.length) : (1 / signals.length);
            num += w * pt;
            den += w;
        }
        return den > 0 && Number.isFinite(num / den) ? num / den : 50;
    }
    update(signals, actual) {
        const y = actual === "Tài" ? 1 : 0;
        for (const s of signals) {
            if (!(s.id in this.log_w)) this.log_w[s.id] = 0;
            const pRaw = Number.isFinite(s.p_tai) ? s.p_tai : 50;
            const p = clamp(pRaw / 100, 0.05, 0.95);
            const ll = y * Math.log(p) + (1 - y) * Math.log(1 - p);
            const nw = this.decay * this.log_w[s.id] + (1 - this.decay) * ll * 10;
            this.log_w[s.id] = Number.isFinite(nw) ? nw : 0;
            this.totals[s.id] = (this.totals[s.id] || 0) + 1;
            if ((p >= 0.5 ? "Tài" : "Xỉu") === actual) this.hits[s.id] = (this.hits[s.id] || 0) + 1;
        }
    }
}

class HMM {
    constructor() {
        this.n  = 2;
        this.A  = [[0.5, 0.5], [0.5, 0.5]];
        this.B  = [[0.7, 0.3], [0.3, 0.7]];
        this.pi = [0.5, 0.5];
    }
    forward(obs) {
        const T = obs.length;
        if (T === 0) return [];
        const a = Array.from({ length: T }, () => new Array(2).fill(0));
        for (let i = 0; i < 2; i++) {
            const b = this.B[i][obs[0]];
            a[0][i] = Number.isFinite(b) ? this.pi[i] * b : 0.5;
        }
        let z = a[0].reduce((x, y) => x + y, 0) || 1;
        for (let i = 0; i < 2; i++) a[0][i] /= z;
        for (let t = 1; t < T; t++) {
            for (let j = 0; j < 2; j++) {
                let s = 0;
                for (let i = 0; i < 2; i++) s += a[t - 1][i] * this.A[i][j];
                const b = this.B[j][obs[t]];
                a[t][j] = Number.isFinite(b) ? s * b : 0;
            }
            z = a[t].reduce((x, y) => x + y, 0) || 1;
            for (let j = 0; j < 2; j++) a[t][j] /= z;
        }
        return a;
    }
    backward(obs) {
        const T = obs.length;
        if (T === 0) return [];
        const b = Array.from({ length: T }, () => new Array(2).fill(0));
        for (let i = 0; i < 2; i++) b[T - 1][i] = 1;
        for (let t = T - 2; t >= 0; t--) {
            for (let i = 0; i < 2; i++) {
                let s = 0;
                for (let j = 0; j < 2; j++) {
                    const bj = this.B[j][obs[t + 1]];
                    if (Number.isFinite(bj)) s += this.A[i][j] * bj * b[t + 1][j];
                }
                b[t][i] = s;
            }
            const z = b[t].reduce((x, y) => x + y, 0) || 1;
            for (let i = 0; i < 2; i++) b[t][i] /= z;
        }
        return b;
    }
    baumWelch(obs, iters = 2) {
        const T = obs.length;
        if (T < 15) return;
        for (let iter = 0; iter < iters; iter++) {
            const alpha = this.forward(obs);
            const beta  = this.backward(obs);
            const g = Array.from({ length: T }, (_, t) => {
                const r = alpha[t].map((v, i) => v * beta[t][i]);
                const z = r.reduce((x, y) => x + y, 0) || 1;
                return r.map(v => v / z);
            });
            const nA = Array.from({ length: 2 }, () => new Array(2).fill(0));
            const nB = Array.from({ length: 2 }, () => [0, 0]);
            for (let i = 0; i < 2; i++) {
                for (let j = 0; j < 2; j++) {
                    let num = 0, den = 0;
                    for (let t = 0; t < T - 1; t++) {
                        const bj = this.B[j][obs[t + 1]];
                        if (Number.isFinite(bj)) num += alpha[t][i] * this.A[i][j] * bj * beta[t + 1][j];
                        den += g[t][i];
                    }
                    const v = den > 0 ? num / den : 0.5;
                    nA[i][j] = Number.isFinite(v) ? v : 0.5;
                }
            }
            for (let i = 0; i < 2; i++) {
                for (let v = 0; v < 2; v++) {
                    let num = 0, den = 0;
                    for (let t = 0; t < T; t++) {
                        if (obs[t] === v) num += g[t][i];
                        den += g[t][i];
                    }
                    const val = den > 0 ? num / den : 0.5;
                    nB[i][v] = Math.max(0.01, Number.isFinite(val) ? val : 0.5);
                }
            }
            this.A = nA;
            this.B = nB;
        }
    }
    predictNext(obs) {
        if (obs.length < 5) return 0.5;
        const a = this.forward(obs);
        if (!a.length) return 0.5;
        const last = a[a.length - 1];
        const z = last.reduce((x, y) => x + y, 0) || 1;
        let p = 0;
        for (let j = 0; j < 2; j++) {
            const bj = this.B[j][1];
            if (Number.isFinite(bj)) p += (last[j] / z) * bj;
        }
        return Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : 0.5;
    }
}

class BOCPD {
    constructor(hazard = 1 / 50) { this.H = hazard; this.a0 = 1; this.b0 = 1; }
    detect(seq, window = 60) {
        const arr = toArr(seq).slice(-window);
        if (arr.length < 10) return { prob: 0, runLen: 0 };
        let R = [1.0], a = [this.a0], b = [this.b0];
        let maxP = 0;
        for (const ch of arr) {
            const x = ch === "T" ? 1 : 0;
            const pr = R.map((_, r) => a[r] / (a[r] + b[r]));
            const nR = new Array(R.length + 1).fill(0);
            const na = new Array(R.length + 1).fill(0);
            const nb = new Array(R.length + 1).fill(0);
            for (let r = 0; r < R.length; r++) {
                nR[r + 1] += R[r] * (1 - this.H) * (x ? pr[r] : 1 - pr[r]);
                na[r + 1] = a[r] + x;
                nb[r + 1] = b[r] + (1 - x);
            }
            nR[0] = R.reduce((s, v) => s + v, 0) * this.H;
            na[0] = this.a0 + x;
            nb[0] = this.b0 + (1 - x);
            const z = nR.reduce((s, v) => s + v, 0) || 1;
            for (let i = 0; i < nR.length; i++) nR[i] /= z;
            R = nR; a = na; b = nb;
            if (Number.isFinite(R[0])) maxP = Math.max(maxP, R[0]);
        }
        let modeR = 0, modeP = 0;
        for (let r = 0; r < R.length; r++) if (R[r] > modeP) { modeP = R[r]; modeR = r; }
        return { prob: Number.isFinite(maxP) ? maxP : 0, runLen: modeR };
    }
}

function monteCarlo(seq, sims = 3000) {
    const arr = toArr(seq);
    const n = arr.length;
    if (n < 20) return 0.5;
    const recent = arr.slice(-50);
    const taiRatio = recent.filter(x => x === "T").length / recent.length;
    let tai = 0;
    for (let s = 0; s < sims; s++) {
        if (Math.random() < 0.7) {
            if (Math.random() < taiRatio) tai++;
        } else {
            let sum = 0;
            for (let d = 0; d < 3; d++) sum += 1 + Math.floor(Math.random() * 6);
            if (sum >= 11) tai++;
        }
    }
    return tai / sims;
}

function markovN(chars, order, weighted = false, decay = 0.97) {
    const n = chars.length;
    if (n < order + 8) return null;
    const cur = chars.slice(-order);
    let cT = 0, cX = 0;
    for (let i = 0; i < n - order; i++) {
        if (chars.slice(i, i + order) !== cur) continue;
        const w = weighted ? Math.pow(decay, n - i) : 1;
        if (chars[i + order] === "T") cT += w; else cX += w;
    }
    const tot = cT + cX;
    if (tot < 1.5) return null;
    const p = cT / tot;
    if (!Number.isFinite(p)) return null;
    return { p, n: tot, next: p > 0.5 ? "Tài" : "Xỉu", prob: Math.max(p, 1 - p) };
}

function betaDecay(seq, window = 40, a0 = 6, b0 = 6, decay = 0.95) {
    const arr = toArr(seq).slice(-window);
    let a = a0, b = b0;
    const L = arr.length;
    for (let i = 0; i < L; i++) {
        const w = Math.pow(decay, L - 1 - i);
        if (arr[i] === "T") a += w; else b += w;
    }
    const r = a / (a + b);
    return Number.isFinite(r) ? r : 0.5;
}

function bayesPosterior(bits, prior = 0.5) {
    const n = bits.length;
    if (!n) return { p: 0.5 };
    const k = bits.reduce((a, b) => a + b, 0);
    const llT = k * Math.log(0.55) + (n - k) * Math.log(0.45);
    const llX = k * Math.log(0.45) + (n - k) * Math.log(0.55);
    const mx = Math.max(llT, llX);
    const pT = Math.exp(llT - mx) * prior;
    const pX = Math.exp(llX - mx) * (1 - prior);
    const tot = pT + pX || 1;
    const r = pT / tot;
    return { p: Number.isFinite(r) ? r : 0.5 };
}

function shannon(bits) {
    if (!bits.length) return 0;
    const p = bits.reduce((a, b) => a + b, 0) / bits.length;
    if (p <= 0 || p >= 1) return 0;
    const r = -p * Math.log2(p) - (1 - p) * Math.log2(1 - p);
    return Number.isFinite(r) ? r : 0;
}
function condEntropy(bits) {
    const c = { "0": [0, 0], "1": [0, 0] };
    for (let i = 0; i < bits.length - 1; i++) c[bits[i]][bits[i + 1]]++;
    let H = 0;
    const n = bits.length - 1;
    for (const k of ["0", "1"]) {
        const tot = c[k][0] + c[k][1];
        if (!tot) continue;
        const p = tot / n;
        for (const v of c[k]) if (v) H -= p * (v / tot) * Math.log2(v / tot);
    }
    return Number.isFinite(H) ? H : 0;
}
function permEntropy(bits, m = 3) {
    const c = {};
    for (let i = 0; i <= bits.length - m; i++) {
        const w = bits.slice(i, i + m);
        const perm = w.map((v, idx) => ({ v, idx })).sort((a, b) => a.v - b.v).map(x => x.idx).join("");
        c[perm] = (c[perm] || 0) + 1;
    }
    const n = Object.values(c).reduce((a, b) => a + b, 0);
    if (!n) return 0;
    let H = 0;
    for (const v of Object.values(c)) { const p = v / n; H -= p * Math.log2(p); }
    const r = H / Math.log2(6);
    return Number.isFinite(r) ? r : 0;
}

function hurst(bits) {
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
    const r = den ? num / den : 0.5;
    return Number.isFinite(r) ? r : 0.5;
}

function autocorr(bits, maxLag = 10) {
    const out = [];
    for (let k = 1; k <= maxLag && k < bits.length; k++) {
        let m = 0, t = 0;
        for (let i = 0; i < bits.length - k; i++) { t++; if (bits[i] === bits[i + k]) m++; }
        out.push(t ? m / t : 0.5);
    }
    return out;
}

function cycleP(chars, P) {
    if (chars.length < P * 2 + 2) return null;
    const tail = chars.slice(-P * 3);
    let m = 0, t = 0;
    for (let i = 0; i < tail.length - P; i++) { t++; if (tail[i] === tail[i + P]) m++; }
    if (t < P * 2) return null;
    const score = m / t;
    if (!Number.isFinite(score) || score < 0.8) return null;
    const next = chars[chars.length - P];
    if (!next) return null;
    return { pred: next === "T" ? "Tài" : "Xỉu", score, P };
}
function cycleAuto(chars, minP = 2, maxP = 10) {
    let best = null;
    for (let P = minP; P <= maxP; P++) {
        const r = cycleP(chars, P);
        if (r && (!best || r.score > best.score)) best = r;
    }
    return best;
}

function zScore(bits) {
    if (bits.length < 3) return 0;
    const m = bits.reduce((a, b) => a + b, 0) / bits.length;
    const sd = Math.sqrt(bits.reduce((a, b) => a + (b - m) ** 2, 0) / bits.length) || 1e-6;
    const r = (bits[bits.length - 1] - m) / sd;
    return Number.isFinite(r) ? r : 0;
}
function volatility(bits) {
    if (bits.length < 2) return 0;
    let d = 0;
    for (let i = 1; i < bits.length; i++) d += Math.abs(bits[i] - bits[i - 1]);
    const r = d / (bits.length - 1);
    return Number.isFinite(r) ? r : 0;
}
function chiSquare(bits) {
    const t = bits.filter(x => x === 1).length, x = bits.length - t;
    const e = bits.length / 2;
    const r = ((t - e) ** 2 + (x - e) ** 2) / (e || 1);
    return Number.isFinite(r) ? r : 0;
}

// ═══════════════════════════════════════════════════════════════════
//  FEATURES
// ═══════════════════════════════════════════════════════════════════
function analyze(hist) {
    const bits  = bitsOf(hist, 200);
    const chars = charsOf(hist, 200);
    const short = bits.slice(-60);
    const st    = streaks(hist);

    const hmm = new HMM();
    const obs = bits.slice(-120);
    hmm.baumWelch(obs, 2);
    const hmmP = hmm.predictNext(obs);

    const ctw = ctwPredict(chars, 6);
    const mc  = monteCarlo(chars, 3000);
    const bp  = bayesPosterior(short, 0.5);
    const be  = betaDecay(chars, 40, 6, 6, 0.95);
    const cp  = new BOCPD(1 / 40).detect(chars, 60);
    const cyc = cycleAuto(chars, 2, 10);

    return {
        bits, chars, st,
        entropy: {
            shannon: shannon(short),
            cond:    condEntropy(short),
            perm:    permEntropy(short, 3),
        },
        corr: autocorr(short, 10),
        complexity: {
            hurst: hurst(short),
            chi:   chiSquare(short),
            zscore: zScore(short),
            vol:   volatility(short),
        },
        markov: {
            m1: markovN(chars, 1),
            m2: markovN(chars, 2),
            m3: markovN(chars, 3),
            mW: markovN(chars, 3, true, 0.92),
        },
        ctw, hmm: { p: hmmP }, mc, bayes: bp, beta: be, cp, cycle: cyc,
    };
}

function detectRegime(f) {
    const { entropy, corr, complexity, st } = f;
    if (complexity.hurst > 0.65) return "PERSISTENT";
    if (complexity.hurst < 0.35) return "ANTIPERSISTENT";
    if (entropy.shannon > 0.97 && corr[0] < 0.5) return "CHAOTIC";
    if (complexity.vol > 0.55) return "ALTERNATING";
    if (entropy.shannon < 0.85 && corr[0] > 0.7) return "TRENDING";
    if (st[0]?.len >= 9) return "FATIGUE";
    if (st[0]?.len >= 6) return "STREAK";
    if (entropy.shannon < 0.9 && corr[1] > 0.5) return "CYCLIC";
    return "NORMAL";
}

// ═══════════════════════════════════════════════════════════════════
//  44 BRIDGES
// ═══════════════════════════════════════════════════════════════════
const BRIDGES = [];
const B = (cat, id, name, fn) => BRIDGES.push({ cat, id, name, fn });

// ─── STREAK (7) ────────────────────────────────────────────────────
B("streak", "bet2", "Bệt-2/3 theo", (h, c) => {
    const cur = c.f.st[0]; if (!cur || cur.len < 2 || cur.len > 3) return null;
    return { pred: cur.type, conf: 60 + cur.len * 3, src: `bệt ${cur.len} theo` };
});
B("streak", "bet4", "Bệt-4/5 theo", (h, c) => {
    const cur = c.f.st[0]; if (!cur || cur.len < 4 || cur.len > 5) return null;
    return { pred: cur.type, conf: 66 + (cur.len - 4) * 2, src: `bệt ${cur.len} theo` };
});
B("streak", "bet6", "Bệt-6/7 theo", (h, c) => {
    const cur = c.f.st[0]; if (!cur || cur.len < 6 || cur.len > 7) return null;
    return { pred: cur.type, conf: 68, src: `bệt ${cur.len} theo` };
});
B("streak", "bet8", "Bệt-8/9 bẻ", (h, c) => {
    const cur = c.f.st[0]; if (!cur || cur.len < 8 || cur.len > 9) return null;
    return { pred: opp(cur.type), conf: 74, src: `bệt ${cur.len} bẻ` };
});
B("streak", "bet10", "Bệt-10+ bẻ mạnh", (h, c) => {
    const cur = c.f.st[0]; if (!cur || cur.len < 10) return null;
    return { pred: opp(cur.type), conf: Math.min(90, 78 + (cur.len - 10) * 2), src: `bệt ${cur.len} BẺ mạnh` };
});
B("streak", "bet_fatigue", "Bệt mỏi (mũ)", (h, c) => {
    const cur = c.f.st[0]; if (!cur || cur.len < 6) return null;
    const pB = 1 - Math.pow(0.55, cur.len - 5);
    const pred = pB > 0.5 ? opp(cur.type) : cur.type;
    return { pred, conf: Math.round(56 + Math.abs(pB - 0.5) * 60), src: `mỏi ${cur.len} (P=${(pB * 100).toFixed(0)}%)` };
});
B("streak", "bet_mom", "Bệt động lượng", (h, c) => {
    const L = c.f.st.slice(0, 5).map(s => s.len);
    if (L.length < 4) return null;
    if (L[0] > L[1] && L[1] > L[2] && L[2] > L[3])
        return { pred: c.f.st[0].type, conf: 68, src: `bệt tăng` };
    if (L[0] < L[1] && L[1] < L[2] && L[2] < L[3])
        return { pred: opp(c.f.st[0].type), conf: 66, src: `bệt giảm → bẻ` };
    return null;
});

// ─── ALTERNATING (6) ───────────────────────────────────────────────
function altB(A_, B_, conf) {
    return (h, c) => {
        const st = c.f.st;
        if (st.length < 6) return null;
        if (st[1].len !== A_ && st[1].len !== B_) return null;
        const first = st[1].len, second = first === A_ ? B_ : A_;
        for (let i = 2; i <= 5; i++) if (st[i].len !== (i % 2 === 0 ? second : first)) return null;
        const cur = st[0];
        if (cur.len === second) return { pred: opp(cur.type), conf, src: `xen kẽ ${A_}-${B_} (đảo)` };
        if (cur.len < second)   return { pred: cur.type, conf: conf - 4, src: `xen kẽ ${A_}-${B_} (${cur.len}/${second})` };
        return null;
    };
}
B("alt", "alt11", "Xen kẽ 1-1", altB(1, 1, 80));
B("alt", "alt22", "Xen kẽ 2-2", altB(2, 2, 78));
B("alt", "alt33", "Xen kẽ 3-3", altB(3, 3, 76));
B("alt", "alt12", "Xen kẽ 1-2", altB(1, 2, 76));
B("alt", "alt21", "Xen kẽ 2-1", altB(2, 1, 76));
B("alt", "alt_rise", "Xen kẽ tăng/giảm", (h, c) => {
    const L = c.f.st.slice(0, 6).map(s => s.len);
    if (L.length < 5) return null;
    if (L[1] < L[2] && L[2] < L[3] && L[3] < L[4]) return { pred: opp(c.f.st[0].type), conf: 68, src: `xen kẽ tăng` };
    if (L[1] > L[2] && L[2] > L[3] && L[3] > L[4]) return { pred: opp(c.f.st[0].type), conf: 68, src: `xen kẽ giảm` };
    return null;
});

// ─── CYCLE (6) ─────────────────────────────────────────────────────
function cycB(P, conf) {
    return (h, c) => {
        const r = cycleP(c.f.chars, P);
        if (!r) return null;
        return { pred: r.pred, conf: Math.round(conf * r.score), src: `chu kỳ P=${P} (${(r.score * 100).toFixed(0)}%)` };
    };
}
B("cycle", "cyc2", "Chu kỳ 2", cycB(2, 76));
B("cycle", "cyc3", "Chu kỳ 3", cycB(3, 76));
B("cycle", "cyc4", "Chu kỳ 4", cycB(4, 74));
B("cycle", "cyc5", "Chu kỳ 5", cycB(5, 74));
B("cycle", "cyc6", "Chu kỳ 6", cycB(6, 72));
B("cycle", "cyc_auto", "Chu kỳ tự dò", (h, c) => {
    if (!c.f.cycle) return null;
    return { pred: c.f.cycle.pred, conf: Math.round(70 * c.f.cycle.score), src: `auto P=${c.f.cycle.P}` };
});

// ─── MARKOV (5) ────────────────────────────────────────────────────
function mkB(getter, name, conf) {
    return (h, c) => {
        const m = getter(c.f);
        if (!m) return null;
        return { pred: m.next, conf: Math.round(conf * m.prob + 55 * (1 - m.prob)), src: `${name} (${(m.prob * 100).toFixed(0)}%, n=${m.n.toFixed(0)})` };
    };
}
B("markov", "mk1", "Markov v1",       mkB(f => f.markov.m1, "MK1", 68));
B("markov", "mk2", "Markov v2",       mkB(f => f.markov.m2, "MK2", 72));
B("markov", "mk3", "Markov v3",       mkB(f => f.markov.m3, "MK3", 74));
B("markov", "mkW", "Markov weighted", mkB(f => f.markov.mW, "MKW", 74));
B("markov", "mk_cond", "Markov có điều kiện", (h, c) => {
    const chars = c.f.chars;
    const cur = chars.slice(-2);
    let cT = 0, cX = 0;
    for (let i = 0; i < chars.length - 2; i++) {
        if (chars.slice(i, i + 2) !== cur) continue;
        const w = Math.pow(0.9, chars.length - i);
        if (chars[i + 2] === "T") cT += w; else cX += w;
    }
    const tot = cT + cX;
    if (tot < 1) return null;
    const p = cT / tot;
    if (!Number.isFinite(p)) return null;
    return { pred: p > 0.5 ? "Tài" : "Xỉu", conf: Math.round(60 + Math.abs(p - 0.5) * 50), src: `MK-cond [${cur}]` };
});

// ─── PATTERN (5) ───────────────────────────────────────────────────
function ngB(L, conf) {
    return (h, c) => {
        const ch = c.f.chars;
        if (ch.length < L * 3) return null;
        const suf = ch.slice(-L), body = ch.slice(0, -1);
        const idx = body.lastIndexOf(suf);
        if (idx < 0 || idx + L >= ch.length) return null;
        const nx = ch[idx + L];
        return { pred: nx === "T" ? "Tài" : "Xỉu", conf, src: `n-gram${L} "${suf}"` };
    };
}
B("pattern", "ng3", "N-gram 3", ngB(3, 66));
B("pattern", "ng4", "N-gram 4", ngB(4, 68));
B("pattern", "ng5", "N-gram 5", ngB(5, 70));
B("pattern", "suffix", "Suffix dài nhất", (h, c) => {
    const ch = c.f.chars;
    for (let L = 12; L >= 3; L--) {
        const suf = ch.slice(-L), body = ch.slice(0, -1);
        const idx = body.lastIndexOf(suf);
        if (idx >= 0 && idx + L < ch.length) {
            const nx = ch[idx + L];
            return { pred: nx === "T" ? "Tài" : "Xỉu", conf: 62 + L, src: `suffix L=${L}` };
        }
    }
    return null;
});
B("pattern", "knn", "KNN k=5", (h, c) => {
    const bits = c.f.bits.slice(-60);
    if (bits.length < 15) return null;
    const q = bits.slice(-4);
    const sims = [];
    for (let i = 0; i + 4 < bits.length - 1; i++) {
        let d = 0;
        for (let j = 0; j < 4; j++) d += Math.abs(bits[i + j] - q[j]);
        sims.push({ d, nxt: bits[i + 4] });
    }
    sims.sort((a, b) => a.d - b.d);
    const top = sims.slice(0, 5);
    if (top.length < 5) return null;
    let t = 0, x = 0;
    for (const s of top) { const w = 1 / (1 + s.d); if (s.nxt === 1) t += w; else x += w; }
    if (t + x === 0) return null;
    const pred = t > x ? "Tài" : "Xỉu";
    return { pred, conf: Math.round(62 + Math.abs(t - x) / (t + x) * 15), src: `KNN5` };
});

// ─── CTW (2) ───────────────────────────────────────────────────────
B("ctw", "ctw_full", "CTW full depth-6", (h, c) => {
    const r = c.f.ctw;
    if (!r || r.n < 4) return null;
    return { pred: r.p > 0.5 ? "Tài" : "Xỉu", conf: Math.round(60 + Math.abs(r.p - 0.5) * 60),
             src: `CTW d=${r.depth} n=${r.n} p=${(r.p * 100).toFixed(1)}%` };
});
B("ctw", "ctw_short", "CTW depth-3", (h, c) => {
    const r = ctwPredict(c.f.chars, 3);
    if (!r || r.n < 3) return null;
    return { pred: r.p > 0.5 ? "Tài" : "Xỉu", conf: 62, src: `CTW d3 p=${(r.p * 100).toFixed(1)}%` };
});

// ─── BAYESIAN (2) ──────────────────────────────────────────────────
B("bayes", "bayes_post", "Bayes posterior", (h, c) => {
    const bp = c.f.bayes;
    if (!bp) return null;
    return { pred: bp.p > 0.5 ? "Tài" : "Xỉu", conf: Math.round(58 + Math.abs(bp.p - 0.5) * 55),
             src: `Bayes p=${(bp.p * 100).toFixed(1)}%` };
});
B("bayes", "beta_decay", "Beta decay", (h, c) => {
    const p = c.f.beta;
    return { pred: p > 0.5 ? "Tài" : "Xỉu", conf: Math.round(60 + Math.abs(p - 0.5) * 50),
             src: `Beta decay p=${(p * 100).toFixed(1)}%` };
});

// ─── STATISTICAL (4) ───────────────────────────────────────────────
B("stat", "entropy", "Entropy gate", (h, c) => {
    const H = c.f.entropy.shannon;
    if (H > 0.97) return { pred: opp(h[0].result), conf: 58, src: `H=${H.toFixed(3)} cao → đảo` };
    if (H < 0.7)  return { pred: c.f.st[0]?.type || "Tài", conf: 64, src: `H=${H.toFixed(3)} thấp → theo` };
    return null;
});
B("stat", "hurst", "Hurst exponent", (h, c) => {
    const H = c.f.complexity.hurst;
    if (H > 0.65) return { pred: c.f.st[0]?.type || "Tài", conf: 64, src: `Hurst=${H.toFixed(2)} persistent` };
    if (H < 0.35) return { pred: opp(h[0].result), conf: 64, src: `Hurst=${H.toFixed(2)} anti-persistent` };
    return null;
});
B("stat", "zscore", "Z-score", (h, c) => {
    const z = c.f.complexity.zscore;
    if (z > 1.4)  return { pred: "Xỉu", conf: 64, src: `z=+${z.toFixed(2)} → đảo` };
    if (z < -1.4) return { pred: "Tài", conf: 64, src: `z=${z.toFixed(2)} → đảo` };
    return null;
});
B("stat", "runs", "Runs + chi²", (h, c) => {
    const chi = c.f.complexity.chi;
    const H   = c.f.entropy.shannon;
    if (chi > 4 && H < 0.92) return { pred: c.f.st[0]?.type || "Tài", conf: 60, src: `chi²=${chi.toFixed(2)} lệch` };
    return null;
});

// ─── DICE (3) ──────────────────────────────────────────────────────
B("dice", "sum_trend", "Xu hướng tổng", (h, c) => {
    const sums = h.slice(0, 8).map(x => x.total);
    if (sums.length < 5) return null;
    const slope = (sums[0] - sums[4]) / 4;
    if (slope > 1.5)  return { pred: "Tài", conf: 62, src: `tổng tăng ${sums[4]}→${sums[0]}` };
    if (slope < -1.5) return { pred: "Xỉu", conf: 62, src: `tổng giảm ${sums[4]}→${sums[0]}` };
    return null;
});
B("dice", "sum_mod", "Mod 4", (h, c) => {
    const s = h.slice(0, 12).map(x => x.total % 4);
    const big = s.filter(x => x >= 2).length;
    if (big >= 9) return { pred: "Tài", conf: 60, src: `mod4 big ${big}/12` };
    if (big <= 3) return { pred: "Xỉu", conf: 60, src: `mod4 small ${12 - big}/12` };
    return null;
});
B("dice", "sum_rep", "Lặp tổng", (h, c) => {
    const sums = h.slice(0, 10).map(x => x.total);
    const last = sums[0];
    const reps = sums.filter(s => s === last).length;
    if (reps >= 3) return { pred: last >= 11 ? "Xỉu" : "Tài", conf: 62, src: `tổng ${last} lặp ${reps}x` };
    return null;
});

// ─── ADV (2) ───────────────────────────────────────────────────────
B("adv", "hmm", "HMM Baum-Welch", (h, c) => {
    const p = c.f.hmm.p;
    return { pred: p > 0.5 ? "Tài" : "Xỉu", conf: Math.round(60 + Math.abs(p - 0.5) * 60),
             src: `HMM p=${(p * 100).toFixed(1)}%` };
});
B("adv", "montecarlo", "Monte Carlo sim", (h, c) => {
    const p = c.f.mc;
    return { pred: p > 0.5 ? "Tài" : "Xỉu", conf: Math.round(58 + Math.abs(p - 0.5) * 55),
             src: `MC p=${(p * 100).toFixed(1)}%` };
});

// ─── META (2) ──────────────────────────────────────────────────────
B("meta", "meta_vote", "Meta vote", (h, c) => {
    const preds = c.basePreds;
    if (preds.length < 8) return null;
    const t = preds.filter(p => p.pred === "Tài").length, x = preds.length - t;
    const r = Math.max(t, x) / preds.length;
    if (r < 0.6) return null;
    return { pred: t > x ? "Tài" : "Xỉu", conf: Math.round(72 * r), src: `vote ${t}T/${x}X (${(r * 100).toFixed(0)}%)` };
});
B("meta", "meta_weighted", "Meta weighted", (h, c) => {
    const preds = c.basePreds;
    if (preds.length < 10) return null;
    let t = 0, x = 0;
    for (const p of preds) {
        const w = (fin(p.conf, 60) / 100) * fin(p.weight, 0.5);
        if (p.pred === "Tài") t += w; else x += w;
    }
    if (t + x === 0) return null;
    const r = Math.max(t, x) / (t + x);
    if (!Number.isFinite(r) || r < 0.6) return null;
    return { pred: t > x ? "Tài" : "Xỉu", conf: Math.round(78 * r), src: `weighted T${t.toFixed(1)}/X${x.toFixed(1)}` };
});

// ═══════════════════════════════════════════════════════════════════
//  ENGINE
// ═══════════════════════════════════════════════════════════════════
class Engine {
    constructor(name) {
        this.name = name;
        this.bma = new BMA(0.97);
        this.kalman = new Kalman1D(0.02, 0.15);
        this.lastPred = null;
        this.recentPreds = [];
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
                if (r?.pred && r.pred !== "BÃO") {
                    out.push({
                        id: b.id, name: b.name, cat: b.cat,
                        pred: r.pred,
                        conf: fin(r.conf, 60),
                        src: r.src || "",
                    });
                }
            } catch {}
        }
        return out;
    }

    predict(hist) {
        if (!hist.length) return { pred: "Xỉu", conf: 55, regime: "UNKNOWN" };
        if (bao(hist[0].dice)) return { pred: "BÃO", conf: 0, regime: "BÃO" };

        const next = hist[0].session + 1;
        if (this.lastPred && this.lastPred.session === next) return this.lastPred.result;

        const ctx = this.buildContext(hist);

        const base = this.runBridges(hist, ctx, b => b.cat !== "meta");
        const W = this.bma.weights();
        const hasW = Object.keys(W).length > 0;
        for (const p of base) p.weight = hasW ? fin(W[p.id], 1 / base.length) : (1 / base.length);
        ctx.basePreds = base;

        const meta = this.runBridges(hist, ctx, b => b.cat === "meta");
        for (const p of meta) p.weight = hasW ? fin(W[p.id], 1 / meta.length) : (1 / meta.length);

        let pTaiRaw = this.bma.predict(base) / 100;
        if (!Number.isFinite(pTaiRaw)) pTaiRaw = 0.5;

        if (meta.length) {
            const metaP = meta.reduce((a, p) => a + (p.pred === "Tài" ? p.weight : 1 - p.weight), 0) / meta.length;
            if (Number.isFinite(metaP)) pTaiRaw = 0.8 * pTaiRaw + 0.2 * metaP;
        }

        const H = ctx.f.entropy.shannon;
        if (Number.isFinite(H)) {
            if (H