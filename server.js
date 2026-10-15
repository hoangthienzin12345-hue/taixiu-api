import fastify from "fastify";
import cors from "@fastify/cors";
import fetch from "node-fetch";

// ═══════════════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════════════
const PORT       = process.env.PORT || 3000;
const VALID_KEY  = "Thien456";
const ADMIN      = "@ADMNLc79";
const N          = 30;
const BASE_TAI_RATE = 0.4861;
const MAX_HIST   = 500;

const API_HU  = "https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5";
const API_MD5 = "https://wtxmd52.tele68.com/v1/txmd5/sessions";

// ═══════════════════════════════════════════════════════════════════
//  CORE MATH
// ═══════════════════════════════════════════════════════════════════
function lgamma(x) {
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
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
const clamp   = (p, lo = 0.05, hi = 0.95) => Math.max(lo, Math.min(hi, p));
const logit   = p => Math.log(clamp(p) / (1 - clamp(p)));
const sigmoid = x => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, x))));
const softmax = (arr) => {
    const mx = Math.max(...arr);
    const ex = arr.map(v => Math.exp(v - mx));
    const Z  = ex.reduce((a, b) => a + b, 0) || 1;
    return ex.map(v => v / Z);
};

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
const opp    = x => x === "Tài" ? "Xỉu" : "Tài";
const bao    = d => d?.[0] === d?.[1] && d?.[1] === d?.[2];
const toB    = r => r === "Tài" ? 1 : 0;
const toC    = r => r === "Tài" ? "T" : "X";
const chrono = (h, n = 200) => h.slice(0, n).map(x => x.result).reverse();
const bitsOf = (h, n = 200) => chrono(h, n).map(toB);
const charsOf= (h, n = 200) => chrono(h, n).map(toC).join("");

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
//  ███  ADVANCED ALGORITHMS  ███
// ═══════════════════════════════════════════════════════════════════

// ─── [1] CTW (Context Tree Weighting) with KT estimator ────────────
function ktProb(a, b) {
    if (a === 0 && b === 0) return 0.5;
    const num = lgamma(a + 0.5) - lgamma(0.5) + lgamma(b + 0.5) - lgamma(0.5);
    const den = lgamma(a + b + 1) - lgamma(1);
    return Math.exp(num - den);
}
function ctwPredict(seq, maxDepth = 6) {
    const n = seq.length;
    if (n < 10) return { p: 0.5, depth: 0, n: 0 };
    const scores = [];
    for (let d = 1; d <= Math.min(maxDepth, n - 1); d++) {
        const ctx = seq.slice(-d).join("");
        let ct = 0, cx = 0;
        for (let i = 0; i < n - d; i++) {
            if (seq.slice(i, i + d).join("") === ctx) {
                if (seq[i + d] === "T") ct++; else cx++;
            }
        }
        const ll = Math.log(Math.max(ktProb(ct, cx), 1e-12));
        scores.push({ d, ct, cx, ll });
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
    return { p, depth: scores[0].d, n: total };
}

// ─── [2] Kalman Filter 1D (stateful, for smoothing p_tai) ──────────
class Kalman1D {
    constructor(q = 0.02, r = 0.15) {
        this.x = 0.5;
        this.P = 1.0;
        this.Q = q;
        this.R = r;
    }
    update(z) {
        const xPred = this.x;
        const PPred = this.P + this.Q;
        const K = PPred / (PPred + this.R);
        this.x = xPred + K * (z - xPred);
        this.P = (1 - K) * PPred;
        return this.x;
    }
}

// ─── [3] Wilson score lower bound (95%) ────────────────────────────
function wilsonLB(wins, total, z = 1.96) {
    if (total === 0) return 0;
    const p = wins / total;
    const n = total;
    const denom  = 1 + z * z / n;
    const center = (p + z * z / (2 * n)) / denom;
    const margin = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom;
    return Math.max(0, center - margin);
}

// ─── [4] BMA — Bayesian Model Averaging (log-weights + decay) ──────
class BMA {
    constructor(decay = 0.97) {
        this.log_w = {};
        this.decay = decay;
        this.hits  = {};
        this.totals = {};
    }
    weights() {
        const names = Object.keys(this.log_w);
        if (!names.length) return {};
        const mx = Math.max(...names.map(n => this.log_w[n]));
        const ex = names.map(n => Math.exp(this.log_w[n] - mx));
        const Z  = ex.reduce((a, b) => a + b, 0) || 1;
        const out = {};
        names.forEach((n, i) => out[n] = ex[i] / Z);
        return out;
    }
    predict(signals) {
        if (!signals.length) return 50;
        const W = this.weights();
        const hasW = Object.keys(W).length > 0;
        let num = 0, den = 0;
        for (const s of signals) {
            const w = hasW ? (W[s.id] ?? (1 / signals.length)) : (1 / signals.length);
            num += w * s.p_tai;
            den += w;
        }
        return den > 0 ? num / den : 50;
    }
    update(signals, actual) {
        const y = actual === "Tài" ? 1 : 0;
        for (const s of signals) {
            if (!(s.id in this.log_w)) this.log_w[s.id] = 0;
            const p = clamp(s.p_tai / 100, 0.05, 0.95);
            const ll = y * Math.log(p) + (1 - y) * Math.log(1 - p);
            this.log_w[s.id] = this.decay * this.log_w[s.id] + (1 - this.decay) * ll * 10;
            this.totals[s.id] = (this.totals[s.id] || 0) + 1;
            const predicted = p >= 0.5 ? "Tài" : "Xỉu";
            if (predicted === actual) this.hits[s.id] = (this.hits[s.id] || 0) + 1;
        }
    }
    snapshot() {
        const W = this.weights();
        const out = {};
        for (const [id, w] of Object.entries(W)) {
            const h = this.hits[id] || 0, t = this.totals[id] || 0;
            out[id] = {
                weight: Number(w.toFixed(4)),
                hits: h, total: t,
                acc: t > 0 ? Number((h / t * 100).toFixed(1)) : null,
            };
        }
        return out;
    }
}

// ─── [5] HMM (2-state) with Baum-Welch + forward/backward ──────────
class HMM {
    constructor(n = 2) {
        this.n  = n;
        this.A  = [[0.5, 0.5], [0.5, 0.5]];
        this.B  = [[0.7, 0.3], [0.3, 0.7]];
        this.pi = [0.5, 0.5];
    }
    forward(obs) {
        const T = obs.length;
        const a = Array.from({ length: T }, () => new Array(this.n).fill(0));
        for (let i = 0; i < this.n; i++) a[0][i] = this.pi[i] * this.B[i][obs[0]];
        let z = a[0].reduce((x, y) => x + y, 0) || 1;
        for (let i = 0; i < this.n; i++) a[0][i] /= z;
        for (let t = 1; t < T; t++) {
            for (let j = 0; j < this.n; j++) {
                let s = 0;
                for (let i = 0; i < this.n; i++) s += a[t - 1][i] * this.A[i][j];
                a[t][j] = s * this.B[j][obs[t]];
            }
            z = a[t].reduce((x, y) => x + y, 0) || 1;
            for (let j = 0; j < this.n; j++) a[t][j] /= z;
        }
        return a;
    }
    backward(obs) {
        const T = obs.length;
        const b = Array.from({ length: T }, () => new Array(this.n).fill(0));
        for (let i = 0; i < this.n; i++) b[T - 1][i] = 1;
        for (let t = T - 2; t >= 0; t--) {
            for (let i = 0; i < this.n; i++) {
                let s = 0;
                for (let j = 0; j < this.n; j++) s += this.A[i][j] * this.B[j][obs[t + 1]] * b[t + 1][j];
                b[t][i] = s;
            }
            const z = b[t].reduce((x, y) => x + y, 0) || 1;
            for (let i = 0; i < this.n; i++) b[t][i] /= z;
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
            const nA = Array.from({ length: this.n }, () => new Array(this.n).fill(0));
            const nB = Array.from({ length: this.n }, () => [0, 0]);
            for (let i = 0; i < this.n; i++) {
                for (let j = 0; j < this.n; j++) {
                    let num = 0, den = 0;
                    for (let t = 0; t < T - 1; t++) {
                        num += alpha[t][i] * this.A[i][j] * this.B[j][obs[t + 1]] * beta[t + 1][j];
                        den += g[t][i];
                    }
                    nA[i][j] = den > 0 ? num / den : 0.5;
                }
            }
            for (let i = 0; i < this.n; i++) {
                for (let v = 0; v < 2; v++) {
                    let num = 0, den = 0;
                    for (let t = 0; t < T; t++) {
                        if (obs[t] === v) num += g[t][i];
                        den += g[t][i];
                    }
                    nB[i][v] = Math.max(0.01, den > 0 ? num / den : 0.5);
                }
            }
            this.A = nA;
            this.B = nB;
        }
    }
    predictNext(obs) {
        if (obs.length < 5) return 0.5;
        const a = this.forward(obs);
        const last = a[a.length - 1];
        const z = last.reduce((x, y) => x + y, 0) || 1;
        let p = 0;
        for (let j = 0; j < this.n; j++) p += (last[j] / z) * this.B[j][1];
        return p;
    }
}

// ─── [6] BOCPD — Bayesian online change point detection ────────────
class BOCPD {
    constructor(hazard = 1 / 50) {
        this.H = hazard;
        this.a0 = 1;
        this.b0 = 1;
    }
    detect(seq, window = 60) {
        const s = seq.slice(-window);
        if (s.length < 10) return { prob: 0, runLen: 0 };
        let R = [1.0], a = [this.a0], b = [this.b0];
        let maxP = 0;
        for (const ch of s) {
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
            maxP = Math.max(maxP, R[0]);
        }
        let modeR = 0, modeP = 0;
        for (let r = 0; r < R.length; r++) if (R[r] > modeP) { modeP = R[r]; modeR = r; }
        return { prob: maxP, runLen: modeR };
    }
}

// ─── [7] Monte Carlo simulation ────────────────────────────────────
function monteCarlo(seq, sims = 3000) {
    const n = seq.length;
    if (n < 20) return 0.5;
    const recent = seq.slice(-50);
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

// ─── [8] Multi-order Markov ────────────────────────────────────────
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
    return { p, n: tot, next: p > 0.5 ? "Tài" : "Xỉu", prob: Math.max(p, 1 - p) };
}

// ─── [9] Beta posterior with exponential decay ─────────────────────
function betaDecay(seq, window = 40, a0 = 6, b0 = 6, decay = 0.95) {
    const r = seq.slice(-window);
    let a = a0, b = b0;
    const L = r.length;
    for (let i = 0; i < L; i++) {
        const w = Math.pow(decay, L - 1 - i);
        if (r[i] === "T") a += w; else b += w;
    }
    return a / (a + b);
}

// ─── [10] Bayesian posterior (Bernoulli with prior) ────────────────
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
    return { p: pT / tot };
}

// ─── [11] Shannon / Conditional / Permutation entropy ──────────────
function shannon(bits) {
    if (!bits.length) return 0;
    const p = bits.reduce((a, b) => a + b, 0) / bits.length;
    return (p <= 0 || p >= 1) ? 0 : -p * Math.log2(p) - (1 - p) * Math.log2(1 - p);
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
    return H;
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
    return H / Math.log2(6);
}

// ─── [12] Hurst exponent ───────────────────────────────────────────
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
    return den ? num / den : 0.5;
}

// ─── [13] Autocorrelation multi-lag ────────────────────────────────
function autocorr(bits, maxLag = 10) {
    const out = [];
    for (let k = 1; k <= maxLag && k < bits.length; k++) {
        let m = 0, t = 0;
        for (let i = 0; i < bits.length - k; i++) { t++; if (bits[i] === bits[i + k]) m++; }
        out.push(t ? m / t : 0.5);
    }
    return out;
}

// ─── [14] Fixed cycle detection ────────────────────────────────────
function cycleP(chars, P) {
    if (chars.length < P * 2 + 2) return null;
    const tail = chars.slice(-P * 3);
    let m = 0, t = 0;
    for (let i = 0; i < tail.length - P; i++) { t++; if (tail[i] === tail[i + P]) m++; }
    if (t < P * 2) return null;
    const score = m / t;
    if (score < 0.8) return null;
    const next = chars[chars.length - P];
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

// ─── [15] Z-score, volatility, chi-square ──────────────────────────
function zScore(bits) {
    if (bits.length < 3) return 0;
    const m = bits.reduce((a, b) => a + b, 0) / bits.length;
    const sd = Math.sqrt(bits.reduce((a, b) => a + (b - m) ** 2, 0) / bits.length) || 1e-6;
    return (bits[bits.length - 1] - m) / sd;
}
function volatility(bits) {
    if (bits.length < 2) return 0;
    let d = 0;
    for (let i = 1; i < bits.length; i++) d += Math.abs(bits[i] - bits[i - 1]);
    return d / (bits.length - 1);
}
function chiSquare(bits) {
    const t = bits.filter(x => x === 1).length, x = bits.length - t;
    const e = bits.length / 2;
    return ((t - e) ** 2 + (x - e) ** 2) / (e || 1);
}

// ═══════════════════════════════════════════════════════════════════
//  FEATURE BUNDLE (build once per predict)
// ═══════════════════════════════════════════════════════════════════
function analyze(hist) {
    const bits  = bitsOf(hist, 200);
    const chars = charsOf(hist, 200);
    const short = bits.slice(-60);
    const st    = streaks(hist);

    const hmm = new HMM(2);
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
        corr:  autocorr(short, 10),
        complexity: {
            hurst:  hurst(short),
            chi:    chiSquare(short),
            zscore: zScore(short),
            vol:    volatility(short),
        },
        markov: {
            m1: markovN(chars, 1),
            m2: markovN(chars, 2),
            m3: markovN(chars, 3),
            mW: markovN(chars, 3, true, 0.92),
        },
        ctw,
        hmm:  { p: hmmP },
        mc,
        bayes: bp,
        beta:  be,
        cp,
        cycle: cyc,
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
//  ███  44 BRIDGES (cân bằng, mỗi cầu logic độc lập)  ███
// ═══════════════════════════════════════════════════════════════════
const BRIDGES = [];
const B = (cat, id, name, fn) => BRIDGES.push({ cat, id, name, fn });

// ─── STREAK (7) ────────────────────────────────────────────────────
B("streak", "bet2",  "Bệt-2/3 theo",  (h, c) => {
    const cur = c.f.st[0]; if (!cur || cur.len < 2 || cur.len > 3) return null;
    return { pred: cur.type, conf: 60 + cur.len * 3, src: `bệt ${cur.len} theo` };
});
B("streak", "bet4",  "Bệt-4/5 theo",  (h, c) => {
    const cur = c.f.st[0]; if (!cur || cur.len < 4 || cur.len > 5) return null;
    return { pred: cur.type, conf: 66 + (cur.len - 4) * 2, src: `bệt ${cur.len} theo` };
});
B("streak", "bet6",  "Bệt-6/7 theo",  (h, c) => {
    const cur = c.f.st[0]; if (!cur || cur.len < 6 || cur.len > 7) return null;
    return { pred: cur.type, conf: 68, src: `bệt ${cur.len} theo` };
});
B("streak", "bet8",  "Bệt-8/9 bẻ",    (h, c) => {
    const cur = c.f.st[0]; if (!cur || cur.len < 8 || cur.len > 9) return null;
    return { pred: opp(cur.type), conf: 74, src: `bệt ${cur.len} bẻ` };
});
B("streak", "bet10", "Bệt-10+ bẻ mạnh",(h, c) => {
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
        return { pred: c.f.st[0].type, conf: 68, src: `bệt tăng ${L[3]}→${L[2]}→${L[1]}→${L[0]}` };
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
    if (L[1] < L[2] && L[2] < L[3] && L[3] < L[4])
        return { pred: opp(c.f.st[0].type), conf: 68, src: `xen kẽ tăng` };
    if (L[1] > L[2] && L[2] > L[3] && L[3] > L[4])
        return { pred: opp(c.f.st[0].type), conf: 68, src: `xen kẽ giảm` };
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
B("markov", "mk1", "Markov v1",         mkB(f => f.markov.m1, "MK1", 68));
B("markov", "mk2", "Markov v2",         mkB(f => f.markov.m2, "MK2", 72));
B("markov", "mk3", "Markov v3",         mkB(f => f.markov.m3, "MK3", 74));
B("markov", "mkW", "Markov weighted",   mkB(f => f.markov.mW, "MKW", 74));
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
    const pred = t > x ? "Tài" : "Xỉu";
    return { pred, conf: Math.round(62 + Math.abs(t - x) / (t + x) * 15), src: `KNN5 (T${t.toFixed(1)}/X${x.toFixed(1)})` };
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

// ─── HMM / MONTE CARLO (2) ─────────────────────────────────────────
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
        const w = (p.conf / 100) * (p.weight ?? 0.5);
        if (p.pred === "Tài") t += w; else x += w;
    }
    if (t + x === 0) return null;
    const r = Math.max(t, x) / (t + x);
    if (r < 0.6) return null;
    return { pred: t > x ? "Tài" : "Xỉu", conf: Math.round(78 * r), src: `weighted T${t.toFixed(1)}/X${x.toFixed(1)}` };
});

// ─── Verify count ──────────────────────────────────────────────────
const CATS = {};
for (const b of BRIDGES) CATS[b.cat] = (CATS[b.cat] || 0) + 1;
console.log(`🎯 Đã nạp ${BRIDGES.length} cầu | ${Object.keys(CATS).length} nhóm`);
for (const [c, n] of Object.entries(CATS)) {
    console.log(`   • ${c.padEnd(10)} ${String(n).padStart(2)} (${(n / BRIDGES.length * 100).toFixed(1)}%)`);
}

// ═══════════════════════════════════════════════════════════════════
//  ENGINE (BMA + Kalman + Wilson + BOCPD + Entropy gate)
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
                if (r?.pred && r.pred !== "BÃO")
                    out.push({ id: b.id, name: b.name, cat: b.cat, pred: r.pred, conf: r.conf || 60, src: r.src || "" });
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

        // Base bridges
        const base = this.runBridges(hist, ctx, b => b.cat !== "meta");
        // Attach BMA weights
        const W = this.bma.weights();
        const hasW = Object.keys(W).length > 0;
        for (const p of base) p.weight = hasW ? (W[p.id] ?? (1 / base.length)) : (1 / base.length);
        ctx.basePreds = base;

        // Meta bridges
        const meta = this.runBridges(hist, ctx, b => b.cat === "meta");
        for (const p of meta) p.weight = hasW ? (W[p.id] ?? (1 / meta.length)) : (1 / meta.length);

        const all = [...base, ...meta];

        // ─── BMA weighted vote ─────────────────────────────────
        let pTaiRaw = this.bma.predict(base) / 100;

        // Add meta bridges as additional vote
        if (meta.length) {
            const metaP = meta.reduce((a, p) => a + (p.pred === "Tài" ? p.weight : 1 - p.weight), 0) / meta.length;
            pTaiRaw = 0.8 * pTaiRaw + 0.2 * metaP;
        }

        // ─── Entropy gate ──────────────────────────────────────
        const H = ctx.f.entropy.shannon;
        if (H >= 0.98) {
            const avg = base.reduce((a, p) => a + (p.pred === "Tài" ? 1 : 0), 0) / Math.max(1, base.length);
            pTaiRaw = 0.4 * pTaiRaw + 0.6 * avg;
        } else if (H >= 0.92) {
            const avg = base.reduce((a, p) => a + (p.pred === "Tài" ? 1 : 0), 0) / Math.max(1, base.length);
            pTaiRaw = 0.7 * pTaiRaw + 0.3 * avg;
        }

        // ─── Balance check (chống bias) ────────────────────────
        if (this.recentPreds.length >= 15) {
            const t = this.recentPreds.filter(x => x === "Tài").length;
            const pt = t / this.recentPreds.length;
            if (pt >= 0.7)  pTaiRaw = Math.max(0.25, pTaiRaw - 0.10);
            if (pt <= 0.3)  pTaiRaw = Math.min(0.75, pTaiRaw + 0.10);
        }

        // ─── Kalman smoothing ──────────────────────────────────
        const pTai = this.kalman.update(pTaiRaw);

        // ─── BOCPD adjustment ──────────────────────────────────
        const cpAdj = ctx.f.cp.prob > 0.5 ? -0.05 : 0;

        // ─── Final prediction & confidence ─────────────────────
        const pred = pTai >= 0.5 ? "Tài" : "Xỉu";
        const baseConf = Math.max(pTai, 1 - pTai) * 100;

        // Wilson confidence from recent scoring
        let wilson = 0;
        if (this.totalScored >= 20) wilson = wilsonLB(this.totalHit, this.totalScored) * 100;

        // Combined final confidence
        let conf = baseConf + cpAdj * 100;
        if (wilson > 0) conf = 0.7 * conf + 0.3 * wilson;

        // Regime adjustment
        const adj = { PERSISTENT: 1.03, ANTIPERSISTENT: 1.02, ALTERNATING: 1.04, CYCLIC: 1.05,
                      TRENDING: 1.03, CHAOTIC: 0.85, FATIGUE: 0.95 };
        conf *= (adj[ctx.regime] || 1);

        // Top-agreement bonus
        const sorted = [...all].sort((a, b) => b.conf * b.weight - a.conf * a.weight);
        const top10 = sorted.slice(0, 10);
        const topT = top10.filter(p => p.pred === "Tài").length;
        if (topT >= 9 || topT <= 1) conf = Math.min(95, conf + 4);

        conf = Math.max(52, Math.min(95, Math.round(conf)));

        const result = {
            pred, conf,
            rawP: pTaiRaw, smoothP: pTai,
            regime: ctx.regime,
            wilson: Number(wilson.toFixed(1)),
            cpProb: Number(ctx.f.cp.prob.toFixed(3)),
            entropy: Number(H.toFixed(3)),
            cau: sorted[0]?.name || "-",
            src: `🧠 ${all.length} cầu | ${ctx.regime} | BMA p=${(pTai * 100).toFixed(1)}% | W=${wilson.toFixed(1)}%`,
            top: top10.map(p => ({
                name: p.name, cat: p.cat, pred: p.pred, conf: p.conf,
                weight: Number(p.weight.toFixed(3)),
            })),
            allBase: base.length,
            allMeta: meta.length,
        };

        this.lastPred = {
            session: next,
            regime: ctx.regime,
            signals: base.map(p => ({ id: p.id, p_tai: p.pred === "Tài" ? p.conf : (100 - p.conf) })),
            finalPred: pred,
            conf: baseConf,
            result,
        };

        return result;
    }

    onNew(newSess) {
        if (!this.lastPred) return;
        for (const s of newSess) {
            if (this.lastPred.session === s.session) {
                // Update BMA
                this.bma.update(this.lastPred.signals, s.result);
                // Track hit
                const ok = this.lastPred.finalPred === s.result;
                if (ok) this.totalHit++;
                this.totalScored++;
                // Track recent preds for balance
                this.recentPreds.push(this.lastPred.finalPred);
                if (this.recentPreds.length > 30) this.recentPreds.shift();
                this.lastPred = null;
                return;
            }
        }
    }

    stats() {
        return {
            overall: this.totalScored ? Number((this.totalHit / this.totalScored * 100).toFixed(2)) : null,
            total: this.totalScored,
            hit: this.totalHit,
            wilson: this.totalScored ? Number((wilsonLB(this.totalHit, this.totalScored) * 100).toFixed(1)) : null,
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
const engHu  = new Engine("HU");
const engMd5 = new Engine("MD5");

async function tick(url, isMd5) {
    try {
        const res = await fetch(url);
        const data = await res.json();
        const arr = parse(data, isMd5);
        if (!arr.length) return;
        const latest = arr[0].session;
        const cur    = isMd5 ? idMd5 : idHu;
        const eng    = isMd5 ? engMd5 : engHu;
        const tag    = isMd5 ? "MD5" : "HŨ";

        if (!cur) {
            if (isMd5) { md5 = arr; idMd5 = latest; } else { hu = arr; idHu = latest; }
            console.log(`✅ [${tag}] ${arr.length} phiên | Mới: ${latest} (${arr[0].result})`);
        } else if (latest > cur) {
            const news = arr.filter(r => r.session > cur).sort((a, b) => a.session - b.session);
            const target = isMd5 ? md5 : hu;
            for (let i = news.length - 1; i >= 0; i--) target.unshift(news[i]);
            if (target.length > MAX_HIST) target.length = Math.floor(MAX_HIST * 0.9);
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
    engine: `🚀 Engine v6 (BMA + Kalman + Wilson + CTW + HMM + BOCPD) | ${BRIDGES.length} cầu`,
    categories: Object.entries(CATS).map(([cat, n]) => ({
        cat, count: n, pct: (n / BRIDGES.length * 100).toFixed(1) + "%",
        bridges: BRIDGES.filter(b => b.cat === cat).map(b => b.name),
    })),
    algorithms: [
        "CTW (Krichevsky-Trofimov)",
        "Kalman Filter 1D",
        "Wilson Score Interval",
        "BMA (Bayesian Model Averaging)",
        "HMM Baum-Welch",
        "BOCPD (Bayesian Change Point)",
        "Monte Carlo simulation",
        "Markov 1/2/3 + weighted",
        "Bayesian posterior + Beta decay",
        "Entropy gate + Hurst + Z-score",
    ],
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
    keyOK(req.query) ? send(hu, engHu, rep)
                     : rep.status(401).send({ error: `Sai key! Ib ${ADMIN}` }));
app.get("/api/taixiumd5/:g", async (req, rep) =>
    keyOK(req.query) ? send(md5, engMd5, rep)
                     : rep.status(401).send({ error: `Sai key! Ib ${ADMIN}` }));

app.get("/api/stats/:loai", async (req, rep) => {
    if (!keyOK(req.query)) return rep.status(401).send({ error: "Sai key" });
    const eng = req.params.loai === "md5" ? engMd5 : engHu;
    const bmaSnap = eng.bma.snapshot();

    // Group by category
    const byCat = {};
    for (const b of BRIDGES) {
        const s = bmaSnap[b.id];
        if (!s || !s.total || s.total < 5) continue;
        if (!byCat[b.cat]) byCat[b.cat] = { n: 0, sum: 0, list: [] };
        byCat[b.cat].n++;
        byCat[b.cat].sum += s.acc || 0;
        byCat[b.cat].list.push({ id: b.id, name: b.name, total: s.total, acc: s.acc, weight: s.weight });
    }
    for (const c of Object.values(byCat)) {
        c.avg = (c.sum / c.n).toFixed(1) + "%";
        c.list.sort((a, b) => (b.acc || 0) - (a.acc || 0));
    }

    return {
        ...eng.stats(),
        top_bridges: Object.entries(bmaSnap)
            .map(([id, s]) => ({ id, ...s, name: BRIDGES.find(b => b.id === id)?.name || id }))
            .filter(x => x.total >= 10)
            .sort((a, b) => b.weight - a.weight)
            .slice(0, 30),
        by_category: byCat,
    };
});

app.get("/api/debug/:loai", async (req, rep) => {
    if (!keyOK(req.query)) return rep.status(401).send({ error: "Sai key" });
    const h = req.params.loai === "md5" ? md5 : hu;
    const eng = req.params.loai === "md5" ? engMd5 : engHu;
    if (!h.length) return rep.status(503).send({ error: "Chưa đủ dữ liệu" });

    const ctx = eng.buildContext(h);
    const base = eng.runBridges(h, ctx, b => b.cat !== "meta");
    const W = eng.bma.weights();
    for (const p of base) p.weight = W[p.id] ?? (1 / base.length);
    ctx.basePreds = base;
    const meta = eng.runBridges(h, ctx, b => b.cat === "meta");
    for (const p of meta) p.weight = W[p.id] ?? (1 / meta.length);

    const p = eng.predict(h);

    return {
        bieu_do_cau: chart(h),
        streak: streaks(h.slice(0, N)).map(s => `${s.type === "Tài" ? "T" : "X"}${s.len}`).join("-"),
        regime: ctx.regime,
        features: {
            shannon: Number(ctx.f.entropy.shannon.toFixed(3)),
            cond: Number(ctx.f.entropy.cond.toFixed(3)),
            perm: Number(ctx.f.entropy.perm.toFixed(3)),
            hurst: Number(ctx.f.complexity.hurst.toFixed(3)),
            zscore: Number(ctx.f.complexity.zscore.toFixed(3)),
            chi: Number(ctx.f.complexity.chi.toFixed(3)),
            vol: Number(ctx.f.complexity.vol.toFixed(3)),
            ac1: Number(ctx.f.corr[0].toFixed(3)),
            ac2: Number(ctx.f.corr[1].toFixed(3)),
            ctw: { p: Number(ctx.f.ctw.p.toFixed(3)), depth: ctx.f.ctw.depth },
            hmm: Number(ctx.f.hmm.p.toFixed(3)),
            monteCarlo: Number(ctx.f.mc.toFixed(3)),
            bayes: Number(ctx.f.bayes.p.toFixed(3)),
            beta: Number(ctx.f.beta.toFixed(3)),
            changePoint: Number(ctx.f.cp.prob.toFixed(3)),
            runLength: ctx.f.cp.runLen,
            cycle: ctx.f.cycle ? { P: ctx.f.cycle.P, pred: ctx.f.cycle.pred, score: Number(ctx.f.cycle.score.toFixed(3)) } : null,
            markov: {
                m1: ctx.f.markov.m1 ? { p: Number(ctx.f.markov.m1.p.toFixed(3)), n: Number(ctx.f.markov.m1.n.toFixed(1)) } : null,
                m2: ctx.f.markov.m2 ? { p: Number(ctx.f.markov.m2.p.toFixed(3)), n: Number(ctx.f.markov.m2.n.toFixed(1)) } : null,
                m3: ctx.f.markov.m3 ? { p: Number(ctx.f.markov.m3.p.toFixed(3)), n: Number(ctx.f.markov.m3.n.toFixed(1)) } : null,
                mW: ctx.f.markov.mW ? { p: Number(ctx.f.markov.mW.p.toFixed(3)), n: Number(ctx.f.markov.mW.n.toFixed(1)) } : null,
            },
        },
        base_bridges: base.sort((a, b) => b.conf * b.weight - a.conf * a.weight).map(d => ({
            id: d.id, name: d.name, cat: d.cat, pred: d.pred, conf: d.conf, src: d.src,
            bmaWeight: Number(d.weight.toFixed(4)),
            acc: eng.bma.totals[d.id] > 0 ? Number((eng.bma.hits[d.id] / eng.bma.totals[d.id] * 100).toFixed(1)) + "%" : null,
            samples: eng.bma.totals[d.id] || 0,
        })),
        meta_bridges: meta.map(d => ({
            id: d.id, name: d.name, pred: d.pred, conf: d.conf, src: d.src,
            bmaWeight: Number(d.weight.toFixed(4)),
        })),
        final: {
            pred: p.pred,
            conf: `${p.conf}%`,
            bmaP: `${(p.rawP * 100).toFixed(1)}%`,
            smoothP: `${(p.smoothP * 100).toFixed(1)}%`,
            wilson: `${p.wilson}%`,
            top: p.top,
        },
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

const cats = Object.entries(CATS);
console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║  🚀 TÀI XỈU LC79 — ENGINE v6 (BMA + Kalman + Wilson + CTW + HMM)         ║
╠══════════════════════════════════════════════════════════════════════════╣
║  🚀 http://localhost:${PORT}                                             ║
║  🔑 KEY: ${VALID_KEY}                                                    ║
║  👤 ADMIN: ${ADMIN}                                                      ║
║                                                                          ║
║  🎯 ${BRIDGES.length} CẦU — ${cats.length} NHÓM CÂN BẰNG:                                          ║
${cats.map(([c, n]) => `║     • ${c.padEnd(10)} ${String(n).padStart(2)} (${(n / BRIDGES.length * 100).toFixed(1).padStart(5)}%)                                      ║`).join("\n")}
║                                                                          ║
║  🧠 THUẬT TOÁN LÕI:                                                      ║
║     • CTW (Krichevsky-Trofimov estimator)                                ║
║     • Kalman Filter 1D (smoothing p_tai)                                 ║
║     • Wilson score lower bound (confidence)                              ║
║     • BMA (Bayesian Model Averaging with decay)                          ║
║     • HMM Baum-Welch (2-state)                                           ║
║     • BOCPD (Bayesian change point detection)                            ║
║     • Monte Carlo simulation                                             ║
║     • Markov 1/2/3 + weighted + conditional                              ║
║     • Entropy gate + Hurst + Z-score + chi²                              ║
║                                                                          ║
║  📌 API:                                                                 ║
║     HŨ    : /api/taixiu/lc79?key=${VALID_KEY}                            ║
║     MD5   : /api/taixiumd5/lc79?key=${VALID_KEY}                         ║
║     DEBUG : /api/debug/hu?key=${VALID_KEY}                               ║
║     STATS : /api/stats/hu?key=${VALID_KEY}                               ║
╚══════════════════════════════════════════════════════════════════════════╝
`);
