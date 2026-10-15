import fastify from "fastify";
import cors from "@fastify/cors";
import fetch from "node-fetch";

// ═══════════════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════════════
const PORT      = process.env.PORT || 3000;
const VALID_KEY = "Thien456";
const ADMIN     = "@ADMNLc79";
const N_CHART   = 30;
const MAX_HIST  = 500;

const API_HU  = "https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5";
const API_MD5 = "https://wtxmd52.tele68.com/v1/txmd5/sessions";

// ═══════════════════════════════════════════════════════════════════
//  SAFE MATH HELPERS
// ═══════════════════════════════════════════════════════════════════
const fin   = (x, f = 0.5) => Number.isFinite(x) ? x : f;
const clamp = (p, lo = 0.05, hi = 0.95) => Number.isFinite(p) ? Math.max(lo, Math.min(hi, p)) : 0.5;
const softmax = (arr) => {
    const safe = arr.map(v => Number.isFinite(v) ? v : -50);
    const mx = Math.max(...safe, -50);
    const ex = safe.map(v => Math.exp(v - mx));
    const Z  = ex.reduce((a, b) => a + b, 0) || 1;
    return ex.map(v => fin(v / Z, 0));
};
const sigmoid = (x) => {
    x = Math.max(-30, Math.min(30, fin(x, 0)));
    return 1 / (1 + Math.exp(-x));
};
const logit = (p) => {
    p = clamp(p);
    return Math.log(p / (1 - p));
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
//  DATA UTILS
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
const toB     = r => r === "Tài" ? 1 : 0;
const toC     = r => r === "Tài" ? "T" : "X";
const chrono  = (h, n = 200) => h.slice(0, n).map(x => x.result).reverse();
const bitsOf  = (h, n = 200) => chrono(h, n).map(toB);
const charsOf = (h, n = 200) => chrono(h, n).map(toC).join("");
const chart   = h => h.slice(0, N_CHART).reverse().map(x => toC(x.result)).join("");

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

// ═══════════════════════════════════════════════════════════════════
//  ALGORITHM 1: CTW (Context Tree Weighting)
// ═══════════════════════════════════════════════════════════════════
function ktProb(a, b) {
    if (a === 0 && b === 0) return 0.5;
    const num = lgamma(a + 0.5) - lgamma(0.5) + lgamma(b + 0.5) - lgamma(0.5);
    const den = lgamma(a + b + 1) - lgamma(1);
    const r = Math.exp(num - den);
    return Number.isFinite(r) && r > 0 ? r : 0.5;
}
function ctwPredict(chars, maxDepth = 6) {
    const n = chars.length;
    if (n < 10) return { p: 0.5, depth: 0, n: 0 };
    const scores = [];
    for (let d = 1; d <= Math.min(maxDepth, n - 1); d++) {
        const ctx = chars.slice(-d);
        let ct = 0, cx = 0;
        for (let i = 0; i < n - d; i++) {
            if (chars.slice(i, i + d) === ctx) {
                if (chars[i + d] === "T") ct++; else cx++;
            }
        }
        const ll = Math.log(Math.max(ktProb(ct, cx), 1e-12));
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

// ═══════════════════════════════════════════════════════════════════
//  ALGORITHM 2: KALMAN FILTER 1D
// ═══════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════
//  ALGORITHM 3: WILSON SCORE INTERVAL
// ═══════════════════════════════════════════════════════════════════
function wilsonLB(wins, total, z = 1.96) {
    if (!Number.isFinite(wins) || !Number.isFinite(total) || total <= 0) return 0;
    const p = wins / total, n = total;
    const denom  = 1 + z * z / n;
    const center = (p + z * z / (2 * n)) / denom;
    const margin = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom;
    const r = center - margin;
    return Number.isFinite(r) && r > 0 ? r : 0;
}

// ═══════════════════════════════════════════════════════════════════
//  ALGORITHM 4: BMA (Bayesian Model Averaging)
// ═══════════════════════════════════════════════════════════════════
class BMA {
    constructor(decay = 0.97) {
        this.log_w = {};
        this.decay = decay;
        this.hits = {};
        this.totals = {};
    }
    weights() {
        const names = Object.keys(this.log_w).filter(n => Number.isFinite(this.log_w[n]));
        if (!names.length) return {};
        const mx = Math.max(...names.map(n => this.log_w[n]));
        const ex = names.map(n => Math.exp(this.log_w[n] - mx));
        const Z = ex.reduce((a, b) => a + b, 0) || 1;
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
            const p = clamp((Number.isFinite(s.p_tai) ? s.p_tai : 50) / 100, 0.05, 0.95);
            const ll = y * Math.log(p) + (1 - y) * Math.log(1 - p);
            const nw = this.decay * this.log_w[s.id] + (1 - this.decay) * ll * 10;
            this.log_w[s.id] = Number.isFinite(nw) ? nw : 0;
            this.totals[s.id] = (this.totals[s.id] || 0) + 1;
            if ((p >= 0.5 ? "Tài" : "Xỉu") === actual) this.hits[s.id] = (this.hits[s.id] || 0) + 1;
        }
    }
}

// ═══════════════════════════════════════════════════════════════════
//  ALGORITHM 5: HMM (Baum-Welch)
// ═══════════════════════════════════════════════════════════════════
class HMM {
    constructor() {
        this.n = 2;
        this.A = [[0.5, 0.5], [0.5, 0.5]];
        this.B = [[0.7, 0.3], [0.3, 0.7]];
        this.pi = [0.5, 0.5];
    }
    forward(obs) {
        const T = obs.length;
        if (!T) return [];
        const a = Array.from({ length: T }, () => [0, 0]);
        for (let i = 0; i < 2; i++) a[0][i] = this.pi[i] * this.B[i][obs[0]];
        let z = a[0][0] + a[0][1] || 1;
        for (let i = 0; i < 2; i++) a[0][i] /= z;
        for (let t = 1; t < T; t++) {
            for (let j = 0; j < 2; j++) {
                let s = 0;
                for (let i = 0; i < 2; i++) s += a[t - 1][i] * this.A[i][j];
                a[t][j] = s * this.B[j][obs[t]];
            }
            z = a[t][0] + a[t][1] || 1;
            for (let j = 0; j < 2; j++) a[t][j] /= z;
        }
        return a;
    }
    backward(obs) {
        const T = obs.length;
        if (!T) return [];
        const b = Array.from({ length: T }, () => [0, 0]);
        b[T - 1] = [1, 1];
        for (let t = T - 2; t >= 0; t--) {
            for (let i = 0; i < 2; i++) {
                let s = 0;
                for (let j = 0; j < 2; j++) s += this.A[i][j] * this.B[j][obs[t + 1]] * b[t + 1][j];
                b[t][i] = s;
            }
            const z = b[t][0] + b[t][1] || 1;
            for (let i = 0; i < 2; i++) b[t][i] /= z;
        }
        return b;
    }
    baumWelch(obs, iters = 2) {
        const T = obs.length;
        if (T < 15) return;
        for (let it = 0; it < iters; it++) {
            const alpha = this.forward(obs);
            const beta  = this.backward(obs);
            const g = Array.from({ length: T }, (_, t) => {
                const r = [alpha[t][0] * beta[t][0], alpha[t][1] * beta[t][1]];
                const z = r[0] + r[1] || 1;
                return [r[0] / z, r[1] / z];
            });
            const nA = [[0, 0], [0, 0]], nB = [[0, 0], [0, 0]];
            for (let i = 0; i < 2; i++) {
                for (let j = 0; j < 2; j++) {
                    let num = 0, den = 0;
                    for (let t = 0; t < T - 1; t++) {
                        num += alpha[t][i] * this.A[i][j] * this.B[j][obs[t + 1]] * beta[t + 1][j];
                        den += g[t][i];
                    }
                    nA[i][j] = den > 0 ? num / den : 0.5;
                }
            }
            for (let i = 0; i < 2; i++) {
                for (let v = 0; v < 2; v++) {
                    let num = 0, den = 0;
                    for (let t = 0; t < T; t++) {
                        if (obs[t] === v) num += g[t][i];
                        den += g[t][i];
                    }
                    nB[i][v] = Math.max(0.01, den > 0 ? num / den : 0.5);
                }
            }
            this.A = nA; this.B = nB;
        }
    }
    predictNext(obs) {
        if (obs.length < 5) return 0.5;
        const a = this.forward(obs);
        if (!a.length) return 0.5;
        const last = a[a.length - 1];
        const z = last[0] + last[1] || 1;
        const p = (last[0] / z) * this.B[0][1] + (last[1] / z) * this.B[1][1];
        return clamp(fin(p, 0.5));
    }
}

// ═══════════════════════════════════════════════════════════════════
//  ALGORITHM 6: BOCPD (Bayesian Change Point Detection)
// ═══════════════════════════════════════════════════════════════════
class BOCPD {
    constructor(hazard = 1 / 50) { this.H = hazard; this.a0 = 1; this.b0 = 1; }
    detect(chars, window = 60) {
        const arr = chars.slice(-window);
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
        return { prob: fin(maxP, 0), runLen: modeR };
    }
}

// ═══════════════════════════════════════════════════════════════════
//  ALGORITHM 7: MONTE CARLO
// ═══════════════════════════════════════════════════════════════════
function monteCarlo(chars, sims = 3000) {
    const n = chars.length;
    if (n < 20) return 0.5;
    const recent = chars.slice(-50);
    const taiRatio = recent.split("").filter(x => x === "T").length / recent.length;
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

// ═══════════════════════════════════════════════════════════════════
//  ALGORITHM 8: MARKOV N-ORDER
// ═══════════════════════════════════════════════════════════════════
function markovN(chars, order, decay = 0.97) {
    const n = chars.length;
    if (n < order + 5) return null;
    const cur = chars.slice(-order);
    let cT = 0, cX = 0;
    for (let i = 0; i < n - order; i++) {
        if (chars.slice(i, i + order) !== cur) continue;
        const w = Math.pow(decay, n - i);
        if (chars[i + order] === "T") cT += w; else cX += w;
    }
    const tot = cT + cX;
    if (tot < 1) return null;
    return { p: fin(cT / tot, 0.5), n: tot };
}

// ═══════════════════════════════════════════════════════════════════
//  ALGORITHM 9: BAYESIAN BETA DECAY
// ═══════════════════════════════════════════════════════════════════
function betaDecay(chars, window = 40, a0 = 6, b0 = 6, decay = 0.95) {
    const arr = chars.slice(-window).split("");
    let a = a0, b = b0;
    const L = arr.length;
    for (let i = 0; i < L; i++) {
        const w = Math.pow(decay, L - 1 - i);
        if (arr[i] === "T") a += w; else b += w;
    }
    return fin(a / (a + b), 0.5);
}

// ═══════════════════════════════════════════════════════════════════
//  ALGORITHM 10: PATTERN DETECTOR (1-1, 2-2, 3-3, 2-1-2, 1-2-3, ...)
// ═══════════════════════════════════════════════════════════════════
function detectPattern(chars) {
    const n = chars.length;
    if (n < 8) return null;

    // Bệt (streak) — kiểm tra trước
    const st = [];
    let cur = chars[n - 1], len = 1;
    for (let i = n - 2; i >= 0; i--) {
        if (chars[i] === cur) len++;
        else { st.push({ t: cur, len }); cur = chars[i]; len = 1; }
    }
    st.push({ t: cur, len });

    const s0 = st[0]?.len || 0;
    const s0t = st[0]?.t || "";

    // Bệt ≥ 4 → theo
    if (s0 >= 4 && s0 < 9) {
        return {
            id: `bet${s0}`, name: `Bệt ${s0} theo`,
            pred: s0t === "T" ? "Tài" : "Xỉu",
            conf: 60 + s0 * 2, src: `Bệt ${s0}`
        };
    }
    // Bệt ≥ 9 → bẻ
    if (s0 >= 9) {
        return {
            id: "bet_break", name: `Bẻ bệt ${s0}`,
            pred: s0t === "T" ? "Xỉu" : "Tài",
            conf: Math.min(88, 72 + (s0 - 9) * 2), src: `Bẻ bệt ${s0}`
        };
    }

    // Pattern phức tạp — khớp đuôi chuỗi
    const patterns = [
        { id: "p_1_1",     name: "Cầu 1-1",     seqs: ["TXT", "XTX"],       next: { TXT: "X", XTX: "T" },     conf: 78 },
        { id: "p_2_2",     name: "Cầu 2-2",     seqs: ["TTXX", "XXTT"],     next: { TTXX: "X", XXTT: "T" },   conf: 76 },
        { id: "p_3_3",     name: "Cầu 3-3",     seqs: ["TTTXXX", "XXXTTT"], next: { TTTXXX: "X", XXXTTT: "T" }, conf: 74 },
        { id: "p_2_1_2",   name: "Cầu 2-1-2",   seqs: ["TTXTT", "XXTXX"],   next: { TTXTT: "X", XXTXX: "T" }, conf: 77 },
        { id: "p_1_2_3",   name: "Cầu 1-2-3",   seqs: ["TXXTTT", "XTTXXX"], next: { TXXTTT: "X", XTTXXX: "T" }, conf: 73 },
        { id: "p_2_3_2",   name: "Cầu 2-3-2",   seqs: ["TTXXXTT", "XXTTTXX"], next: { TTXXXTT: "X", XXTTTXX: "T" }, conf: 75 },
        { id: "p_3_1_3",   name: "Cầu 3-1-3",   seqs: ["TTTXTTT", "XXXTXXX"], next: { TTTXTTT: "X", XXXTXXX: "T" }, conf: 75 },
    ];

    for (const pat of patterns) {
        for (const seq of pat.seqs) {
            if (chars.endsWith(seq)) {
                return {
                    id: pat.id, name: pat.name,
                    pred: pat.next[seq] === "T" ? "Tài" : "Xỉu",
                    conf: pat.conf, src: `${pat.name}`
                };
            }
        }
    }

    // Kiểm tra pattern chu kỳ nhỏ ở chuỗi dài (2-2 lặp)
    for (const P of [2, 3, 4]) {
        if (n < P * 3 + 1) continue;
        const tail = chars.slice(-P * 2);
        if (tail.slice(0, P) === tail.slice(P)) {
            const nx = chars[n - P];
            return {
                id: `cyc_${P}`, name: `Chu kỳ ${P}`,
                pred: nx === "T" ? "Tài" : "Xỉu",
                conf: 70, src: `Chu kỳ P=${P}`
            };
        }
    }

    return null;
}

// ═══════════════════════════════════════════════════════════════════
//  SELF-LEARNING ENGINE (học cầu từ biểu đồ)
// ═══════════════════════════════════════════════════════════════════
class PatternLearner {
    constructor() {
        this.stats = {}; // id → { hits, total, streak }
    }
    get(id) {
        if (!this.stats[id]) this.stats[id] = { hits: 0, total: 0, streak: 0 };
        return this.stats[id];
    }
    update(id, isWin) {
        const s = this.get(id);
        s.total++;
        if (isWin) { s.hits++; s.streak++; }
        else s.streak = 0;
    }
    weight(id) {
        const s = this.get(id);
        if (s.total < 3) return 1.0;
        const acc = s.hits / s.total;
        // Wilson lower-bound as conservative estimate
        const lb = wilsonLB(s.hits, s.total, 1.5);
        const base = 0.5 + lb;
        const streakBonus = 1 + Math.min(s.streak, 5) * 0.15;
        return clamp(base * streakBonus, 0.3, 2.5);
    }
    rate(id) {
        const s = this.get(id);
        return s.total ? s.hits / s.total : 0;
    }
}

// ═══════════════════════════════════════════════════════════════════
//  ENSEMBLE ENGINE
// ═══════════════════════════════════════════════════════════════════
class Engine {
    constructor() {
        this.bma = new BMA(0.97);
        this.kalman = new Kalman1D(0.02, 0.15);
        this.learner = new PatternLearner();
        this.lastPred = null;
    }

    buildSignals(hist) {
        const chars = charsOf(hist, 200);
        const bits  = bitsOf(hist, 200);
        const n = chars.length;
        if (n < 12) return null;

        const signals = [];

        // α — CTW
        const ctw = ctwPredict(chars, 6);
        signals.push({
            id: "α", name: "CTW", p_tai: ctw.p * 100,
            w: ctw.n >= 8 ? 2.5 : 1.2, src: `d${ctw.depth}/n${ctw.n}`
        });

        // β — Beta decay
        const beta = betaDecay(chars, 40, 6, 6, 0.95);
        signals.push({ id: "β", name: "Beta", p_tai: beta * 100, w: 1.5, src: "Bayes" });

        // γ — Autocorrelation lag-1
        let corr = 0;
        const shortBits = bits.slice(-50);
        if (shortBits.length > 10) {
            let match = 0;
            for (let i = 0; i < shortBits.length - 1; i++)
                if (shortBits[i] === shortBits[i + 1]) match++;
            corr = match / (shortBits.length - 1) - 0.5;
        }
        if (Math.abs(corr) >= 0.08 && n > 1) {
            const ref = chars[n - 1];
            const pG = (corr > 0)
                ? (ref === "T" ? 1 : 0)
                : (ref === "T" ? 0 : 1);
            signals.push({
                id: "γ", name: "Autocorr", p_tai: pG * 100,
                w: Math.min(3, Math.abs(corr) * 7), src: `r${corr >= 0 ? "+" : ""}${corr.toFixed(2)}`
            });
        }

        // δ — Streak
        const st = streaks(hist);
        const cur = st[0];
        if (cur) {
            let pD = 0.5, wD = 0;
            if (cur.len >= 4 && cur.len < 9) {
                pD = cur.type === "Tài" ? 0.62 : 0.38;
                wD = 1.5;
            } else if (cur.len >= 9) {
                pD = cur.type === "Tài" ? 0.35 : 0.65;
                wD = 2.0;
            } else if (cur.len === 1) {
                pD = cur.type === "Tài" ? 0.55 : 0.45;
                wD = 0.5;
            }
            if (wD > 0) signals.push({
                id: "δ", name: "Streak", p_tai: pD * 100, w: wD,
                src: `${cur.type === "Tài" ? "T" : "X"}×${cur.len}`
            });
        }

        // ε — Frequency 20
        const rec20 = chars.slice(-20);
        const pE = rec20.split("").filter(x => x === "T").length / rec20.length;
        signals.push({ id: "ε", name: "Freq20", p_tai: pE * 100, w: 0.7, src: `${(pE * 100).toFixed(0)}%` });

        // ζ — Pattern match (new detector)
        const pat = detectPattern(chars);
        if (pat) {
            const lw = this.learner.weight(pat.id);
            signals.push({
                id: "ζ", name: pat.name, p_tai: pat.pred === "Tài" ? pat.conf : 100 - pat.conf,
                w: 2.2 * lw, src: `${pat.src} ×${lw.toFixed(2)}`,
                pattern_id: pat.id, pattern_pred: pat.pred, pattern_conf: pat.conf
            });
        }

        // η — Base rate adaptive
        const longWin = chars.slice(-400);
        const etaBase = 0.4861;
        const kEta = 80;
        const pH = (longWin.split("").filter(x => x === "T").length + etaBase * kEta) / (longWin.length + kEta);
        signals.push({ id: "η", name: "Base", p_tai: pH * 100, w: 0.4, src: `${(pH * 100).toFixed(1)}%` });

        // λ — Dice bias (mean sum)
        const recent = hist.slice(0, 30);
        let sumAll = 0, cnt = 0;
        for (const h of recent) if (h.dice && h.dice.length === 3) {
            sumAll += h.dice[0] + h.dice[1] + h.dice[2];
            cnt++;
        }
        if (cnt > 0) {
            const avg = sumAll / (cnt * 3);
            const pL = sigmoid((avg * 3 - 10.5) * 0.8);
            const dev = Math.abs(avg - 3.5);
            const wL = Math.min(2, 0.4 + dev * 0.7);
            signals.push({ id: "λ", name: "Dice", p_tai: pL * 100, w: wL, src: `avg${avg.toFixed(1)}` });
        }

        // μ — HMM
        const hmm = new HMM();
        const obs = bits.slice(-120);
        hmm.baumWelch(obs, 2);
        const pHmm = hmm.predictNext(obs);
        signals.push({ id: "μ", name: "HMM", p_tai: pHmm * 100, w: 2.2, src: "Baum-Welch" });

        // ν — Sum band transition
        const recent80 = hist.slice(0, 80);
        if (recent80.length >= 15) {
            const band = t => t <= 7 ? 0 : t <= 10 ? 1 : t <= 14 ? 2 : 3;
            const bands = recent80.map(h => band(h.total || 0));
            const curBand = bands[0];
            let tt = 0, tot = 0;
            for (let i = 1; i < bands.length; i++) {
                if (bands[i] === curBand) {
                    tot++;
                    if (recent80[i - 1].result === "Tài") tt++;
                }
            }
            if (tot >= 3) {
                signals.push({
                    id: "ν", name: "Sum-band", p_tai: (tt / tot) * 100,
                    w: tot >= 8 ? 1.5 : 1.0, src: `b${curBand}/n${tot}`
                });
            }
        }

        // ξ — Markov 2
        const mk2 = markovN(chars, 2, 0.95);
        if (mk2) signals.push({
            id: "ξ", name: "Markov2", p_tai: mk2.p * 100,
            w: Math.min(2, mk2.n / 4), src: `n=${mk2.n.toFixed(0)}`
        });

        // π — Monte Carlo
        const mc = monteCarlo(chars, 2000);
        signals.push({ id: "π", name: "MonteCarlo", p_tai: mc * 100, w: 1.2, src: "sim" });

        // σ — CTW depth-3
        const ctw3 = ctwPredict(chars, 3);
        signals.push({ id: "σ", name: "CTW-d3", p_tai: ctw3.p * 100, w: 1.0, src: `p${(ctw3.p * 100).toFixed(0)}` });

        return { signals, chars, bits, ctw, hmm: pHmm, pat };
    }

    predict(hist) {
        const ctx = this.buildSignals(hist);
        if (!ctx) return { pred: "Xỉu", conf: 50, signals: [], chart: "", pattern: null };

        const { signals, chars } = ctx;

        // BMA weighted prediction
        let pTaiRaw = this.bma.predict(signals) / 100;
        if (!Number.isFinite(pTaiRaw)) pTaiRaw = 0.5;

        // Entropy gate
        const recent50 = chars.slice(-50);
        const pT = recent50.split("").filter(x => x === "T").length / recent50.length;
        let H = 1.0;
        if (pT > 0 && pT < 1) H = -(pT * Math.log2(pT) + (1 - pT) * Math.log2(1 - pT));

        if (H >= 0.98) {
            const avg = signals.reduce((a, s) => a + s.p_tai, 0) / signals.length / 100;
            pTaiRaw = 0.7 * avg + 0.3 * pTaiRaw;
        } else if (H >= 0.92) {
            const avg = signals.reduce((a, s) => a + s.p_tai, 0) / signals.length / 100;
            pTaiRaw = 0.5 * pTaiRaw + 0.5 * avg;
        }

        // Kalman smoothing
        const pSmoothed = this.kalman.update(pTaiRaw);

        // Clamp
        const pFinal = Math.max(0.25, Math.min(0.75, pSmoothed));
        const pred = pFinal >= 0.5 ? "Tài" : "Xỉu";
        const conf = Math.max(pFinal, 1 - pFinal) * 100;

        const pat = ctx.pat;

        return {
            pred, conf, pTai: pFinal * 100, pXiu: (1 - pFinal) * 100,
            signals, chart: chart(hist),
            pattern: pat,
            entropy: H,
            ctw: ctx.ctw, hmm: ctx.hmm,
        };
    }

    // Cập nhật sau khi có kết quả
    update(hist, actual, lastSignals, lastPatternId) {
        if (lastSignals && lastSignals.length) this.bma.update(lastSignals, actual);
        if (lastPatternId) {
            const pat = lastSignals.find(s => s.pattern_id === lastPatternId);
            if (pat) this.learner.update(lastPatternId, pat.pattern_pred === actual);
        }
    }
}

// ═══════════════════════════════════════════════════════════════════
//  GLOBAL STATE
// ═══════════════════════════════════════════════════════════════════
const engine = new Engine();
let history = [];       // mới nhất ở index 0
let lastEval = null;    // { session, pred, actual, win, signals, patternId }
let stats = { wins: 0, total: 0, streak: 0 };

// ═══════════════════════════════════════════════════════════════════
//  FETCH SESSIONS
// ═══════════════════════════════════════════════════════════════════
async function fetchSessions(url) {
    try {
        const r = await fetch(url, { timeout: 15000 });
        const data = await r.json();
        const raw = data.list || data;
        if (!Array.isArray(raw)) return [];
        const out = [];
        for (const it of raw) {
            try {
                const point = Number(it.point ?? it.Tong ?? 0);
                const result = norm(it.resultTruyenThong ?? it.ket_qua, point);
                out.push({
                    session: Number(it.id ?? it.phien ?? 0),
                    dice: it.dices || it.xuc_xac || [0, 0, 0],
                    total: point,
                    result,
                });
            } catch { continue; }
        }
        out.sort((a, b) => b.session - a.session);
        return out;
    } catch (e) {
        return [];
    }
}

// ═══════════════════════════════════════════════════════════════════
//  UPDATE HISTORY + LEARN
// ═══════════════════════════════════════════════════════════════════
function updateHistory(newSessions) {
    if (!newSessions.length) return;
    if (!history.length) {
        history = newSessions.slice(0, MAX_HIST);
        return;
    }
    const known = new Set(history.map(h => h.session));
    const fresh = newSessions.filter(s => !known.has(s.session) && s.session > history[0].session);
    if (!fresh.length) return;

    // Đánh giá prediction cũ nếu có
    if (lastEval && lastEval.session === history[0].session) {
        const actual = history[0].result;
        const win = actual === lastEval.pred;
        lastEval.actual = actual;
        lastEval.win = win;
        stats.total++;
        if (win) { stats.wins++; stats.streak++; } else stats.streak = 0;
        engine.update(history, actual, lastEval.signals, lastEval.patternId);
    }

    fresh.sort((a, b) => b.session - a.session);
    history = [...fresh, ...history].slice(0, MAX_HIST);
}

// ═══════════════════════════════════════════════════════════════════
//  FASTIFY SERVER
// ═══════════════════════════════════════════════════════════════════
const app = fastify({ logger: false });
await app.register(cors, { origin: "*" });

app.get("/", async (req, reply) => {
    return reply.type("text/plain").send(
        `🤖 LC79 ENGINE — CTW + BMA + Kalman + HMM + PatternLearner\n` +
        `📊 History: ${history.length} phiên\n` +
        `🎯 Tỷ lệ: ${stats.total ? (stats.wins / stats.total * 100).toFixed(1) : 0}% (${stats.wins}/${stats.total})\n` +
        `👑 Admin: ${ADMIN}`
    );
});

app.get("/predict", async (req, reply) => {
    const key = req.query.key;
    if (key !== VALID_KEY) {
        return reply.code(403).send({ error: "Invalid key" });
    }

    // Fetch từ 2 nguồn song song
    const [hu, md5] = await Promise.all([
        fetchSessions(API_HU),
        fetchSessions(API_MD5),
    ]);

    // Chọn nguồn có dữ liệu nhiều hơn / mới hơn
    const merged = new Map();
    for (const s of [...hu, ...md5]) {
        if (!merged.has(s.session) || merged.get(s.session).total === 0) {
            merged.set(s.session, s);
        }
    }
    const all = Array.from(merged.values()).sort((a, b) => b.session - a.session);

    updateHistory(all);

    if (history.length < 12) {
        return reply.send({
            admin: ADMIN,
            error: "Chưa đủ dữ liệu",
            history_count: history.length,
        });
    }

    // Chạy dự đoán
    const result = engine.predict(history);

    // Lưu eval để lần sau chấm điểm
    const prevSession = history[0].session;
    const nextSession = prevSession + 1;
    lastEval = {
        session: prevSession,
        pred: result.pred,
        signals: result.signals,
        patternId: result.pattern?.id || null,
    };

    // Build chart
    const ch = chart(history);

    // Tỷ lệ hiển thị (dùng confidence)
    const rate = result.conf.toFixed(1);

    // Response gọn
    const prev = history[0];
    const response = {
        admin: ADMIN,
        phien_truoc: `#${prev.session}`,
        xuc_xac: `${prev.dice[0]}-${prev.dice[1]}-${prev.dice[2]}`,
        ket_qua: prev.result,
        bieu_do_cau: ch,
        phien_hien_tai: `#${nextSession}`,
        du_doan: result.pred,
        ty_le: `${rate}%`,
    };

    return reply.send(response);
});

app.get("/stats", async (req, reply) => {
    const key = req.query.key;
    if (key !== VALID_KEY) return reply.code(403).send({ error: "Invalid key" });

    const bmaW = engine.bma.weights();
    const topSignals = Object.entries(bmaW)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([id, w]) => ({
            id,
            weight: Number(w.toFixed(3)),
            hits: engine.bma.hits[id] || 0,
            total: engine.bma.totals[id] || 0,
            acc: engine.bma.totals[id]
                ? Number(((engine.bma.hits[id] || 0) / engine.bma.totals[id] * 100).toFixed(1))
                : 0,
        }));

    const patterns = Object.entries(engine.learner.stats).map(([id, s]) => ({
        id,
        hits: s.hits,
        total: s.total,
        acc: s.total ? Number((s.hits / s.total * 100).toFixed(1)) : 0,
        streak: s.streak,
        weight: Number(engine.learner.weight(id).toFixed(2)),
    })).sort((a, b) => b.acc - a.acc);

    return reply.send({
        admin: ADMIN,
        history: history.length,
        bot: {
            wins: stats.wins,
            total: stats.total,
            rate: stats.total ? Number((stats.wins / stats.total * 100).toFixed(1)) : 0,
            streak: stats.streak,
            wilson_lb: Number((wilsonLB(stats.wins, stats.total) * 100).toFixed(1)),
        },
        bma_top: topSignals,
        patterns,
    });
});

app.listen({ port: PORT, host: "0.0.0.0" }, (err, addr) => {
    if (err) { console.error(err); process.exit(1); }
    console.log(`🚀 LC79 Engine @ ${addr}`);
    console.log(`👑 Admin: ${ADMIN}`);
    console.log(`🔑 Key: ${VALID_KEY}`);
});