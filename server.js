import fastify from "fastify";
import cors from "@fastify/cors";

// ═══════════════════════════════════════════════════════════════════
//  TÀI XỈU LC79 — BRAIN v7Pro (BMA + Kalman + Wilson + CTW + HMM)
// ═══════════════════════════════════════════════════════════════════
const PORT      = process.env.PORT || 3000;
const VALID_KEY = "Thiên456";
const ADMIN     = "@ADMNLc79";
const BASE_TAI_RATE = 0.4861;

const API_URL_HU  = "https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5";
const API_URL_MD5 = "https://wtxmd52.tele68.com/v1/txmd5/sessions";

// ═══════════════════════════════════════════════════════════════════
//  FETCH
// ═══════════════════════════════════════════════════════════════════
async function fetchJSON(url, timeoutMs = 8000, retries = 2) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            const res = await fetch(url, {
                signal: ctrl.signal,
                headers: { "User-Agent": "Mozilla/5.0 LC79" },
            });
            clearTimeout(t);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (e) {
            clearTimeout(t);
            if (attempt === retries) throw e;
            await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
        }
    }
}

// ═══════════════════════════════════════════════════════════════════
//  MATH UTILS
// ═══════════════════════════════════════════════════════════════════
const clamp = (p, lo = 0.05, hi = 0.95) => Math.max(lo, Math.min(hi, p));
const logit = p => Math.log(clamp(p) / (1 - clamp(p)));
const sigmoid = x => {
    x = Math.max(-30, Math.min(30, x));
    return 1 / (1 + Math.exp(-x));
};

// Lanczos approximation — gần đúng lgamma
function lgamma(x) {
    const g = 7;
    const c = [
        0.99999999999980993, 676.5203681218851, -1259.1392167224028,
        771.32342877765313, -176.61502916214059, 12.507343278686905,
        -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
    ];
    if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
    x -= 1;
    let a = c[0];
    const t = x + g + 0.5;
    for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// ═══════════════════════════════════════════════════════════════════
//  1) CTW — Context Tree Weighting
// ═══════════════════════════════════════════════════════════════════
function ktProb(a, b) {
    if (a === 0 && b === 0) return 0.5;
    const num = lgamma(a + 0.5) - lgamma(0.5) + lgamma(b + 0.5) - lgamma(0.5);
    const den = lgamma(a + b + 1) - lgamma(1);
    return Math.exp(num - den);
}

function ctwPredict(seq, maxDepth = 6) {
    const n = seq.length;
    if (n < 10) return [0.5, 0, 0];
    const depthScores = [];
    for (let d = 1; d <= Math.min(maxDepth, n - 1); d++) {
        const ctx = seq.slice(-d).join("");
        let ct = 0, cx = 0;
        for (let i = 0; i < n - d; i++) {
            if (seq.slice(i, i + d).join("") === ctx) {
                if (seq[i + d] === "T") ct++;
                else cx++;
            }
        }
        const ll = Math.log(Math.max(ktProb(ct, cx), 1e-10));
        depthScores.push([d, ct, cx, ll]);
    }
    if (!depthScores.length) return [0.5, 0, 0];
    const maxLL = Math.max(...depthScores.map(s => s[3]));
    const weights = depthScores.map(s => Math.exp(s[3] - maxLL));
    const wSum = weights.reduce((a, b) => a + b, 0) || 1;
    let pTai = 0, total = 0;
    for (let i = 0; i < depthScores.length; i++) {
        const [d, ct, cx] = depthScores[i];
        const pD = (ct + cx) > 0 ? (ct + 0.5) / (ct + cx + 1) : 0.5;
        pTai += (weights[i] / wSum) * pD;
        total += ct + cx;
    }
    return [pTai, depthScores[0][0], total];
}

// ═══════════════════════════════════════════════════════════════════
//  2) KALMAN 1D
// ═══════════════════════════════════════════════════════════════════
class Kalman1D {
    constructor(q = 0.02, r = 0.15, x = 0.5, P = 1.0) {
        this.x = x; this.P = P; this.Q = q; this.R = r;
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

// ═══════════════════════════════════════════════════════════════════
//  3) WILSON LOWER BOUND
// ═══════════════════════════════════════════════════════════════════
function wilsonLower(wins, total, z = 1.96) {
    if (total === 0) return 0;
    const pHat = wins / total;
    const denom = 1 + z * z / total;
    const center = (pHat + z * z / (2 * total)) / denom;
    const margin = z * Math.sqrt(pHat * (1 - pHat) / total + z * z / (4 * total * total)) / denom;
    return Math.max(0, center - margin);
}

// ═══════════════════════════════════════════════════════════════════
//  4) BMA — Bayesian Model Averaging
// ═══════════════════════════════════════════════════════════════════
class BMA {
    constructor(names = [], decay = 0.97) {
        this.names = [...names];
        this.logW = {};
        for (const n of this.names) this.logW[n] = 0.0;
        this.decay = decay;
        this.hits = {};
        this.totals = {};
    }
    weights() {
        if (!this.names.length) return {};
        const mx = Math.max(...this.names.map(n => this.logW[n] ?? 0));
        const exps = {};
        let Z = 0;
        for (const n of this.names) {
            exps[n] = Math.exp((this.logW[n] ?? 0) - mx);
            Z += exps[n];
        }
        Z = Z || 1;
        const out = {};
        for (const n of this.names) out[n] = exps[n] / Z;
        return out;
    }
    predict(signals) {
        const W = this.weights();
        let num = 0;
        for (const s of signals) {
            if (s.name in W) num += W[s.name] * s.p_tai;
        }
        return num / 100;
    }
    update(signals, actual) {
        const y = actual === "TAI" ? 1 : 0;
        for (const s of signals) {
            const nm = s.name;
            if (!(nm in this.logW)) continue;
            const p = Math.max(0.05, Math.min(0.95, s.p_tai / 100));
            const ll = y * Math.log(p) + (1 - y) * Math.log(1 - p);
            this.logW[nm] = this.decay * this.logW[nm] + (1 - this.decay) * ll * 10;
            this.totals[nm] = (this.totals[nm] || 0) + 1;
            if ((p >= 0.5) === (actual === "TAI")) this.hits[nm] = (this.hits[nm] || 0) + 1;
        }
    }
}

// ═══════════════════════════════════════════════════════════════════
//  5) HMM — Baum-Welch
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
        const a = Array.from({ length: T }, () => [0, 0]);
        for (let i = 0; i < this.n; i++) a[0][i] = this.pi[i] * this.B[i][obs[0]];
        for (let t = 1; t < T; t++) {
            for (let j = 0; j < this.n; j++) {
                let s = 0;
                for (let i = 0; i < this.n; i++) s += a[t - 1][i] * this.A[i][j];
                a[t][j] = s * this.B[j][obs[t]];
            }
            const z = a[t].reduce((a, b) => a + b, 0) || 1;
            for (let j = 0; j < this.n; j++) a[t][j] /= z;
        }
        return a;
    }
    backward(obs) {
        const T = obs.length;
        const b = Array.from({ length: T }, () => [0, 0]);
        for (let i = 0; i < this.n; i++) b[T - 1][i] = 1;
        for (let t = T - 2; t >= 0; t--) {
            for (let i = 0; i < this.n; i++) {
                let s = 0;
                for (let j = 0; j < this.n; j++) s += this.A[i][j] * this.B[j][obs[t + 1]] * b[t + 1][j];
                b[t][i] = s;
            }
            const z = b[t].reduce((a, b) => a + b, 0) || 1;
            for (let i = 0; i < this.n; i++) b[t][i] /= z;
        }
        return b;
    }
    baumWelch(obs, iters = 2) {
        const T = obs.length;
        if (T < 10) return;
        for (let iter = 0; iter < iters; iter++) {
            const alpha = this.forward(obs);
            const beta = this.backward(obs);
            const g = Array.from({ length: T }, (_, t) => {
                const row = [alpha[t][0] * beta[t][0], alpha[t][1] * beta[t][1]];
                const z = row[0] + row[1] || 1;
                return [row[0] / z, row[1] / z];
            });
            const nA = [[0, 0], [0, 0]], nB = [[0, 0], [0, 0]];
            for (let i = 0; i < this.n; i++) {
                for (let j = 0; j < this.n; j++) {
                    let num = 0, den = 0;
                    for (let t = 0; t < T - 1; t++) {
                        num += alpha[t][i] * this.A[i][j] * this.B[j][obs[t + 1]] * beta[t + 1][j];
                        den += g[t][i];
                    }
                    nA[i][j] = den ? num / den : 0.5;
                }
            }
            for (let i = 0; i < this.n; i++) {
                for (let v = 0; v < 2; v++) {
                    let num = 0, den = 0;
                    for (let t = 0; t < T; t++) {
                        if (obs[t] === v) num += g[t][i];
                        den += g[t][i];
                    }
                    nB[i][v] = Math.max(0.01, den ? num / den : 0.5);
                }
            }
            this.A = nA; this.B = nB;
        }
    }
    predictNext(obs) {
        if (obs.length < 5) return 0.5;
        const a = this.forward(obs);
        const last = a[a.length - 1];
        const z = last[0] + last[1] || 1;
        return (last[0] / z) * this.B[0][1] + (last[1] / z) * this.B[1][1];
    }
}

// ═══════════════════════════════════════════════════════════════════
//  6) BOCPD — Bayesian Change Point Detection
// ═══════════════════════════════════════════════════════════════════
class BOCPD {
    constructor(hazard = 1 / 50) { this.H = hazard; this.a0 = 1; this.b0 = 1; }
    detect(seq, window = 60) {
        const s = seq.slice(-window);
        if (s.length < 10) return [0, 0];
        let R = [1.0], a = [this.a0], b = [this.b0];
        let mx = 0;
        for (const obs of s) {
            const x = obs === "T" ? 1 : 0;
            const pr = R.map((_, r) => a[r] / (a[r] + b[r]));
            const nR = new Array(R.length + 1).fill(0);
            const na = new Array(R.length + 1).fill(0);
            const nb = new Array(R.length + 1).fill(0);
            for (let r = 0; r < R.length; r++) {
                nR[r + 1] += R[r] * (1 - this.H) * (x ? pr[r] : 1 - pr[r]);
                na[r + 1] = a[r] + x;
                nb[r + 1] = b[r] + (1 - x);
            }
            nR[0] += R.reduce((p, c) => p + c, 0) * this.H;
            na[0] = this.a0 + x;
            nb[0] = this.b0 + (1 - x);
            const z = nR.reduce((p, c) => p + c, 0) || 1;
            for (let r = 0; r < nR.length; r++) nR[r] /= z;
            R = nR; a = na; b = nb;
            mx = Math.max(mx, R[0]);
        }
        const modeR = R.length ? R.indexOf(Math.max(...R)) : 0;
        return [mx, modeR];
    }
}

// ═══════════════════════════════════════════════════════════════════
//  MODULES
// ═══════════════════════════════════════════════════════════════════
function modCtw(seq, maxDepth = 6) {
    const [p, d, n] = ctwPredict(seq, maxDepth);
    return [p, n >= 8 ? 2.5 : (n >= 4 ? 1.2 : 0.4), `d${d}/n${n}`];
}

function modBeta(seq, window = 40, a0 = 6.0, b0 = 6.0, decay = 0.95) {
    const r = seq.slice(-window);
    let a = a0, b = b0;
    const L = r.length;
    for (let i = 0; i < L; i++) {
        const w = Math.pow(decay, L - 1 - i);
        if (r[i] === "T") a += w; else b += w;
    }
    return a / (a + b);
}

function modGamma(seq, maxLag = 25) {
    const x = seq.map(s => s === "T" ? 1 : 0);
    const n = x.length;
    if (n < 10) return [0, 0];
    const m = x.reduce((a, b) => a + b, 0) / n;
    const v = x.reduce((a, b) => a + (b - m) ** 2, 0) / n;
    if (v === 0) return [0, 0];
    let bl = 0, bc = 0;
    for (let lag = 2; lag < Math.min(maxLag, Math.floor(n / 2)); lag++) {
        let cov = 0;
        for (let i = 0; i < n - lag; i++) cov += (x[i] - m) * (x[i + lag] - m);
        cov /= (n - lag);
        const c = cov / v;
        if (Math.abs(c) > Math.abs(bc)) { bc = c; bl = lag; }
    }
    return [bl, bc];
}

function modDelta(seq) {
    const last = seq[seq.length - 1];
    let s = 1;
    for (let i = seq.length - 2; i >= 0; i--) {
        if (seq[i] === last) s++; else break;
    }
    let p = 0.5, w = 0.0;
    if (s >= 4) {
        const d = Math.min(0.30, 0.06 * (s - 3));
        p = last === "T" ? 0.5 - d : 0.5 + d;
        w = 1.5;
    } else if (s === 1) {
        p = last === "T" ? 0.55 : 0.45;
        w = 0.6;
    }
    return [p, w, s, last];
}

function modEpsilon(seq, window = 20) {
    const r = seq.slice(-window);
    return r.length ? r.filter(x => x === "T").length / r.length : 0.5;
}

function modZeta(seq, maxLen = 6, minCount = 4) {
    const n = seq.length;
    let best = [0.5, null, 0, 0];
    for (let L = 2; L <= Math.min(maxLen, n - 1); L++) {
        const ctx = seq.slice(-L).join("");
        let ct = 0, cx = 0;
        for (let i = 0; i < n - L; i++) {
            if (seq.slice(i, i + L).join("") === ctx) {
                if (seq[i + L] === "T") ct++; else cx++;
            }
        }
        const tot = ct + cx;
        if (tot >= minCount && L > best[3]) {
            best = [(ct + 0.5) / (tot + 1), ctx, tot, L];
        }
    }
    return [best[0], best[1], best[2]];
}

function modEta(seq, longW = 400, k = 80) {
    const w = seq.slice(-longW);
    const n = w.length;
    if (n < 50) return BASE_TAI_RATE;
    const tCount = w.filter(x => x === "T").length;
    return (tCount + BASE_TAI_RATE * k) / (n + k);
}

function modLambda(sessions, window = 30) {
    const recent = sessions.slice(-window);
    if (!recent.length) return [0.5, 0, "no-data"];
    const sums = [0, 0, 0];
    let cnt = 0;
    for (const s of recent) {
        const d = s.dices || [];
        if (d.length === 3) { sums[0] += d[0]; sums[1] += d[1]; sums[2] += d[2]; cnt++; }
    }
    if (!cnt) return [0.5, 0, "no-dice"];
    const avg = sums.map(x => x / cnt);
    const p = sigmoid((avg[0] + avg[1] + avg[2] - 10.5) * 0.8);
    const dev = avg.reduce((a, x) => a + Math.abs(x - 3.5), 0);
    const w = Math.min(2.0, 0.4 + dev * 0.7);
    return [p, w, `${avg[0].toFixed(1)}/${avg[1].toFixed(1)}/${avg[2].toFixed(1)}`];
}

function modMu(sessions, window = 80) {
    const band = t => t <= 7 ? 0 : t <= 10 ? 1 : t <= 14 ? 2 : 3;
    const recent = sessions.slice(-window);
    if (recent.length < 15) return [0.5, 0, "no-data"];
    const bands = recent.map(s => band(s.point));
    const cur = bands[bands.length - 1];
    const tt = [0, 0, 0, 0], tot = [0, 0, 0, 0];
    for (let i = 0; i < bands.length - 1; i++) {
        const b = bands[i];
        tot[b]++;
        if (recent[i + 1].result === "TAI" || recent[i + 1].result === "Tài") tt[b]++;
    }
    if (tot[cur] < 3) return [0.5, 0, `b${cur}/n${tot[cur]}`];
    return [tt[cur] / tot[cur], tot[cur] >= 8 ? 1.5 : 1.0, `b${cur}/n${tot[cur]}`];
}

function entropy(seq, w = 50) {
    const r = seq.slice(-w);
    if (!r.length) return 1;
    const p = r.filter(x => x === "T").length / r.length;
    if (p === 0 || p === 1) return 0;
    return -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
}

// ═══════════════════════════════════════════════════════════════════
//  ENSEMBLE ANALYZE
// ═══════════════════════════════════════════════════════════════════
function analyze(sessions, history, state) {
    // sessions: chrono (oldest → newest) với .result = "TAI"|"XIU"
    const results = sessions.map(s => s.result);
    const n = results.length;
    if (n < 30) return null;
    const seq = results.map(r => r === "TAI" ? "T" : "X");
    const raw = [];

    // α CTW
    const [pa, wa, note_a] = modCtw(seq, 6);
    raw.push(["α", pa, wa, note_a]);

    // β Beta
    raw.push(["β", modBeta(seq, 40), 1.5, ""]);

    // γ Autocorr
    const [lag, corr] = modGamma(seq);
    let pg = 0.5, wg = 0.0;
    if (lag > 0 && Math.abs(corr) >= 0.10 && n > lag) {
        const ref = seq[n - lag];
        pg = corr > 0
            ? (ref === "T" ? 1.0 : 0.0)
            : (ref === "T" ? 0.0 : 1.0);
        wg = Math.min(3.0, Math.abs(corr) * 7);
    }
    raw.push(["γ", pg, wg, `L${lag}/r${corr >= 0 ? "+" : ""}${corr.toFixed(2)}`]);

    // δ Streak
    const [pd, wd, streak, last] = modDelta(seq);
    raw.push(["δ", pd, wd, `${last}×${streak}`]);

    // ε Freq20
    const pe = modEpsilon(seq, 20);
    raw.push(["ε", pe, 0.7, `${(pe * 100).toFixed(0)}%`]);

    // ζ Pattern
    const [pz, ctxz, nz] = modZeta(seq, 6, 4);
    const wz = nz >= 6 ? 2.2 : (nz >= 4 ? 1.3 : 0.0);
    raw.push(["ζ", pz, wz, `${ctxz || "—"}/n${nz}`]);

    // η Base adaptive
    const ph = modEta(seq);
    raw.push(["η", ph, 0.4, `${(ph * 100).toFixed(1)}%`]);

    // λ Dice
    const [pl, wl, notel] = modLambda(sessions, 30);
    raw.push(["λ", pl, wl, notel]);

    // μ HMM
    const hmm = state.hmm;
    const obs = seq.map(x => x === "T" ? 1 : 0);
    hmm.baumWelch(obs, 2);
    const phmm = hmm.predictNext(obs);
    raw.push(["μ", phmm, 2.2, "HMM"]);

    // ν Sum-band
    const [pm, wm, notem] = modMu(sessions, 80);
    raw.push(["ν", pm, wm, notem]);

    // BOCPD
    const [cpProb, runLen] = new BOCPD(1 / 40).detect(seq, 50);

    // BMA ensemble
    const bma = state.bma;
    if (!bma.names.length) {
        bma.names = raw.map(s => s[0]);
        for (const n of bma.names) bma.logW[n] = 0;
    }
    const W = bma.weights();

    const signals = raw.map(([nm, p, w, note]) => {
        const mw = W[nm] ?? (1.0 / Math.max(1, raw.length));
        const ew = mw * w;
        return {
            name: nm, p_tai: p * 100, w, meta: mw * raw.length,
            strength: 1.0, eff_w: ew, note,
        };
    });

    const pTaiRaw = bma.predict(raw.map(([nm, p]) => ({ name: nm, p_tai: p * 100 })));

    // Entropy gate
    const H = entropy(seq, 50);
    let pTai;
    if (H >= 0.98) {
        const avg = raw.reduce((a, s) => a + s[1], 0) / raw.length;
        pTai = 0.7 * avg + 0.3 * pTaiRaw;
    } else if (H >= 0.92) {
        const avg = raw.reduce((a, s) => a + s[1], 0) / raw.length;
        pTai = 0.5 * pTaiRaw + 0.5 * avg;
    } else {
        pTai = pTaiRaw;
    }

    // Kalman smoothing
    pTai = state.kalman.update(pTai);

    // Balance chống nghiêng
    const recentH = history.slice(-30);
    if (recentH.length >= 15) {
        const taiC = recentH.filter(h => h.predict === "TAI").length;
        const pt = taiC / recentH.length, px = 1 - pt;
        if (px >= 0.70) pTai = Math.min(0.75, pTai + 0.10);
        else if (px >= 0.60) pTai = Math.min(0.75, pTai + 0.05);
        else if (pt >= 0.70) pTai = Math.max(0.25, pTai - 0.10);
        else if (pt >= 0.60) pTai = Math.max(0.25, pTai - 0.05);
    }

    pTai = Math.max(0.25, Math.min(0.75, pTai));
    const predict = pTai >= 0.5 ? "TAI" : "XIU";

    // Wilson confidence
    const validH = history.slice(-100);
    let wilson = 0;
    if (validH.length >= 20) {
        const wins = validH.filter(h => h.result === "WIN").length;
        wilson = wilsonLower(wins, validH.length) * 100;
    }
    const conf = Math.max(pTai, 1 - pTai) * 100;

    // Agreement
    const active = signals.filter(s => s.eff_w > 0);
    let agreement = 50;
    if (active.length) {
        const agree = active.filter(s => (s.p_tai >= 50) === (predict === "TAI")).length;
        agreement = agree / active.length * 100;
    }

    // Tier
    let tier;
    if (conf >= 58 && agreement >= 70 && wilson >= 50) tier = "STRONG";
    else if (conf >= 54 && agreement >= 55) tier = "OK";
    else if (agreement < 40) tier = "SPLIT";
    else tier = "WEAK";

    return {
        predict, confidence: conf,
        p_tai: pTai * 100, p_xiu: (1 - pTai) * 100,
        wilson, streak, last,
        f10: (seq.slice(-10).filter(x => x === "T").length / 10) * 100,
        f20: pe * 100,
        f50: (seq.slice(-50).filter(x => x === "T").length / Math.min(50, n)) * 100,
        entropy: H,
        cp_prob: cpProb, run_len: runLen,
        pattern_ctx: ctxz, pattern_n: nz,
        agreement, tier,
        signals,
        top_id: sessions[sessions.length - 1].id,
        n,
    };
}

// ═══════════════════════════════════════════════════════════════════
//  PARSE
// ═══════════════════════════════════════════════════════════════════
function parseHu(data) {
    if (!data?.list || !Array.isArray(data.list)) return [];
    return data.list.sort((a, b) => b.id - a.id).map(item => ({
        id: item.id, dices: item.dices, point: item.point,
        result: item.point >= 11 ? "TAI" : "XIU",
        result_vn: item.point >= 11 ? "Tài" : "Xỉu",
    })).sort((a, b) => a.id - b.id);
}

function parseMd5(data) {
    if (!data?.list || !Array.isArray(data.list)) return [];
    return data.list.sort((a, b) => b.id - a.id).map(item => ({
        id: item.id, dices: item.dices, point: item.point,
        result: item.resultTruyenThong === "Tài" ? "TAI" : "XIU",
        result_vn: item.resultTruyenThong,
    })).sort((a, b) => a.id - b.id);
}

// ═══════════════════════════════════════════════════════════════════
//  STATE (per game)
// ═══════════════════════════════════════════════════════════════════
function makeState() {
    return {
        sessions: [],       // chrono, oldest → newest
        lastId: null,
        bma: new BMA([], 0.97),
        kalman: new Kalman1D(0.02, 0.15),
        hmm: new HMM(),
        history: [],        // [{predict, actual, result, sessionId}]
        lastPred: null,     // {session, predict, ai_result}
        lastFetchAt: 0,
    };
}

const stateHu = makeState();
const stateMd5 = makeState();

// ═══════════════════════════════════════════════════════════════════
//  UPDATE STATE
// ═══════════════════════════════════════════════════════════════════
function updateState(state, arr) {
    if (!arr.length) return;
    const latest = arr[arr.length - 1].id;

    if (!state.lastId) {
        state.sessions = arr;
        state.lastId = latest;
        console.log(`✅ Loaded ${arr.length} sessions`);
        return;
    }

    if (latest > state.lastId) {
        const news = arr.filter(r => r.id > state.lastId);
        for (const r of news) {
            // Score previous prediction if matching
            if (state.lastPred && state.lastPred.session === r.id) {
                // Update BMA
                const actual = r.result;
                const signalsForBMA = state.lastPred.signals.map(s => ({
                    name: s.name, p_tai: s.p_tai,
                }));
                state.bma.update(signalsForBMA, actual);
                const win = state.lastPred.predict === actual;
                state.history.push({
                    sessionId: r.id,
                    predict: state.lastPred.predict,
                    actual,
                    result: win ? "WIN" : "LOSE",
                    signals: state.lastPred.signals,
                });
                if (state.history.length > 500) state.history.shift();
                state.lastPred = null;
            }
            state.sessions.push(r);
        }
        if (state.sessions.length > 800) state.sessions = state.sessions.slice(-700);
        state.lastId = latest;
        console.log(`🆕 +${news.length} sessions → ${latest}`);
    }
}

// ═══════════════════════════════════════════════════════════════════
//  FETCH LOOPS
// ═══════════════════════════════════════════════════════════════════
async function fetchHu() {
    try {
        const data = await fetchJSON(API_URL_HU);
        updateState(stateHu, parseHu(data));
        stateHu.lastFetchAt = Date.now();
    } catch (e) { console.error("❌ HU:", e.message); }
}

async function fetchMd5() {
    try {
        const data = await fetchJSON(API_URL_MD5);
        updateState(stateMd5, parseMd5(data));
        stateMd5.lastFetchAt = Date.now();
    } catch (e) { console.error("❌ MD5:", e.message); }
}

// ═══════════════════════════════════════════════════════════════════
//  GET PREDICTION
// ═══════════════════════════════════════════════════════════════════
function getPrediction(state) {
    if (state.sessions.length < 30) return null;
    // Cache per last session id
    if (state.lastPred && state.lastPred.session === state.lastId + 1) {
        return state.lastPred.ai_result;
    }
    const ai = analyze(state.sessions, state.history, state);
    if (!ai) return null;
    state.lastPred = {
        session: state.lastId + 1,
        predict: ai.predict,
        signals: ai.signals,
        ai_result: ai,
    };
    return ai;
}

// ═══════════════════════════════════════════════════════════════════
//  BUILD RESPONSE
// ═══════════════════════════════════════════════════════════════════
function buildResp(state, game) {
    if (state.sessions.length < 30) return null;
    const ai = getPrediction(state);
    if (!ai) return null;

    const last = state.sessions[state.sessions.length - 1];
    const last5 = state.sessions.slice(-5).reverse().map((v, i) => ({
        stt: i + 1,
        result: v.result_vn,
        total: v.point,
        dice: `${v.dices[0]}-${v.dices[1]}-${v.dices[2]}`,
    }));

    const topSignals = ai.signals
        .slice()
        .sort((a, b) => b.eff_w - a.eff_w)
        .slice(0, 5)
        .map(s => `${s.name}:${s.p_tai.toFixed(0)}%×${s.meta.toFixed(1)}`)
        .join(" | ");

    return {
        Id: ADMIN,
        Game: game,
        Phien_truoc: last.id,
        Xuc_xac: `${last.dices[0]} - ${last.dices[1]} - ${last.dices[2]}`,
        Ket_qua: last.result_vn.toLowerCase(),
        Tong: last.point,
        Phien_nay: last.id + 1,
        Du_doan: ai.predict === "TAI" ? "tài" : "xỉu",
        Do_tin_cay: `${ai.confidence.toFixed(1)}%`,
        Ly_do: `Tier ${ai.tier} · Wilson ${ai.wilson.toFixed(1)}% · Agreement ${ai.agreement.toFixed(0)}%`,
        Biet_hien_tai: `${ai.streak} ${ai.last}`,
        Nguon_cau: `BMA(${ai.signals.length}) · ${topSignals}`,
        AI: {
            tier: ai.tier,
            p_tai: +ai.p_tai.toFixed(2),
            p_xiu: +ai.p_xiu.toFixed(2),
            wilson: +ai.wilson.toFixed(2),
            agreement: +ai.agreement.toFixed(1),
            entropy: +ai.entropy.toFixed(3),
            cp_prob: +ai.cp_prob.toFixed(3),
            run_len: ai.run_len,
            f10: +ai.f10.toFixed(1),
            f20: +ai.f20.toFixed(1),
            f50: +ai.f50.toFixed(1),
            streak: ai.streak,
            pattern_ctx: ai.pattern_ctx,
            pattern_n: ai.pattern_n,
            signals: ai.signals.map(s => ({
                name: s.name,
                p_tai: +s.p_tai.toFixed(1),
                w: +s.w.toFixed(2),
                meta: +s.meta.toFixed(2),
                note: s.note,
            })),
        },
        "5_van_gan_nhat": last5,
    };
}

// ═══════════════════════════════════════════════════════════════════
//  CHECK KEY
// ═══════════════════════════════════════════════════════════════════
const checkKey = q =>
    q.key === VALID_KEY
        ? { valid: true }
        : { valid: false, error: `Sai key! Ib ${ADMIN}` };

// ═══════════════════════════════════════════════════════════════════
//  SERVER
// ═══════════════════════════════════════════════════════════════════
const app = fastify({ logger: false, disableRequestLogging: true });
app.register(cors, { origin: "*" });

app.get("/", async () => ({
    status: "ok",
    admin: ADMIN,
    engine: "BRAIN v7Pro (BMA + Kalman + Wilson + CTW + HMM)",
    modules: ["α CTW", "β Beta", "γ Autocorr", "δ Streak", "ε Freq20",
              "ζ Pattern", "η Base", "λ Dice", "μ HMM", "ν Sum-band"],
    hu: {
        loaded: stateHu.sessions.length,
        last_id: stateHu.lastId,
        history: stateHu.history.length,
        age: stateHu.lastFetchAt ? Math.floor((Date.now() - stateHu.lastFetchAt) / 1000) + "s" : "never",
    },
    md5: {
        loaded: stateMd5.sessions.length,
        last_id: stateMd5.lastId,
        history: stateMd5.history.length,
        age: stateMd5.lastFetchAt ? Math.floor((Date.now() - stateMd5.lastFetchAt) / 1000) + "s" : "never",
    },
}));

// API HŨ
app.get("/api/taixiu/lc79", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const r = buildResp(stateHu, "HŨ");
    return r || rep.status(503).send({ error: "Đang tải dữ liệu HŨ (cần ≥30 phiên)..." });
});

app.get("/api/taixiu/lc79/history", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    return stateHu.sessions.slice(-30).reverse().map(i => ({
        session: i.id, dice: i.dices, total: i.point, result: i.result_vn.toLowerCase(),
    }));
});

app.get("/api/taixiu/lc79/ai-history", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const h = stateHu.history.slice(-30).reverse();
    const wins = stateHu.history.filter(x => x.result === "WIN").length;
    const total = stateHu.history.length;
    return {
        total, wins, loses: total - wins,
        winrate: total ? (wins / total * 100).toFixed(2) + "%" : "N/A",
        wilson: total ? (wilsonLower(wins, total) * 100).toFixed(2) + "%" : "N/A",
        recent: h,
    };
});

// API MD5
app.get("/api/taixiumd5/lc79", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const r = buildResp(stateMd5, "MD5");
    return r || rep.status(503).send({ error: "Đang tải dữ liệu MD5 (cần ≥30 phiên)..." });
});

app.get("/api/taixiumd5/lc79/history", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    return stateMd5.sessions.slice(-30).reverse().map(i => ({
        session: i.id, dice: i.dices, total: i.point, result: i.result_vn.toLowerCase(),
    }));
});

app.get("/api/taixiumd5/lc79/ai-history", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const h = stateMd5.history.slice(-30).reverse();
    const wins = stateMd5.history.filter(x => x.result === "WIN").length;
    const total = stateMd5.history.length;
    return {
        total, wins, loses: total - wins,
        winrate: total ? (wins / total * 100).toFixed(2) + "%" : "N/A",
        wilson: total ? (wilsonLower(wins, total) * 100).toFixed(2) + "%" : "N/A",
        recent: h,
    };
});

// STATS
app.get("/api/stats", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    return {
        hu: {
            sessions: stateHu.sessions.length,
            predictions: stateHu.history.length,
            last_id: stateHu.lastId,
            bma_weights: stateHu.bma.weights(),
        },
        md5: {
            sessions: stateMd5.sessions.length,
            predictions: stateMd5.history.length,
            last_id: stateMd5.lastId,
            bma_weights: stateMd5.bma.weights(),
        },
    };
});

// CHECK KEY
app.get("/check-key", async req =>
    req.query.key === VALID_KEY
        ? { status: "success", message: "KEY HỢP LỆ", admin: ADMIN }
        : { status: "error", message: `Sai key! Ib ${ADMIN}` });

// ═══════════════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════════════
app.listen({ port: PORT, host: "0.0.0.0" })
    .then(() => {
        console.log(`🚀 [${PORT}] BRAIN v7Pro online · key: ${VALID_KEY} · admin: ${ADMIN}`);

        setTimeout(() => {
            fetchHu().catch(() => {});
            fetchMd5().catch(() => {});
        }, 100);

        setInterval(() => fetchHu().catch(() => {}), 6000);
        setInterval(() => fetchMd5().catch(() => {}), 6000);
    })
    .catch(err => {
        console.error("❌ Boot:", err.message);
        process.exit(1);
    });