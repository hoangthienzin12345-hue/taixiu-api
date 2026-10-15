import fastify from "fastify";
import cors from "@fastify/cors";

const PORT      = process.env.PORT || 3000;
const VALID_KEY = "Thiên456";
const ADMIN     = "@ADMNLc79";
const BASE_RATE = 0.4861;

const API_URL_HU  = "https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5";
const API_URL_MD5 = "https://wtxmd52.tele68.com/v1/txmd5/sessions";

// ═══════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════
const clamp = (v, lo = 0.05, hi = 0.95) => Math.max(lo, Math.min(hi, v));
const sig   = x => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, x))));
const T2N   = s => (s === "T" ? 1 : 0);
const freq  = (a, v = "T") => a.length ? a.filter(x => x === v).length / a.length : 0.5;
const cnt   = (a, v) => a.filter(x => x === v).length;
const tail  = (a, n) => a.slice(-n);
const ent   = p => (p <= 0 || p >= 1) ? 0 : -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
const runs  = seq => { if (!seq.length) return 0; let r = 1; for (let i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1]) r++; return r; };

async function fetchJSON(url, timeoutMs = 8000, retries = 2) {
    for (let a = 0; a <= retries; a++) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 LC79" } });
            clearTimeout(t);
            if (!r.ok) throw new Error("HTTP " + r.status);
            return await r.json();
        } catch (e) {
            clearTimeout(t);
            if (a === retries) throw e;
            await new Promise(r => setTimeout(r, 800 * (a + 1)));
        }
    }
}

// ═══════════════════════════════════════════════════════════════════
//  NHÓM A — THỐNG KÊ & XÁC SUẤT (8)
// ═══════════════════════════════════════════════════════════════════
const A1 = c => { const w = tail(c.seq, 10); return [freq(w), w.length >= 6 ? 0.8 : 0, "freq10"]; };
const A2 = c => { const w = tail(c.seq, 40); let a = 6, b = 6; for (const x of w) x === "T" ? a++ : b++; return [a / (a + b), 1.5, "beta"]; };
const A3 = c => { const w = tail(c.seq, 30); return [(cnt(w, "T") + 1) / (w.length + 2), 0.8, "laplace"]; };
const A4 = c => { let p = 0.5; for (const x of tail(c.seq, 50)) p = 0.15 * T2N(x) + 0.85 * p; return [p, 1.2, "ewma"]; };
const A5 = c => {
    const w = tail(c.seq, 40), n = w.length;
    if (n < 10) return [0.5, 0, "n/a"];
    const z = (cnt(w, "T") - n * 0.5) / Math.sqrt(n * 0.25);
    return [clamp(0.5 - Math.tanh(z * 0.4) * 0.4), Math.min(2, Math.abs(z)), `z${z.toFixed(1)}`];
};
const A6 = c => {
    const w = tail(c.seq, 50), n1 = cnt(w, "T"), n2 = cnt(w, "X");
    if (n1 + n2 < 10) return [0.5, 0, "n/a"];
    const r = runs(w), exp = 2 * n1 * n2 / (n1 + n2) + 1;
    const vr = 2 * n1 * n2 * (2 * n1 * n2 - n1 - n2) / ((n1 + n2) ** 2 * (n1 + n2 - 1));
    const z = (r - exp) / Math.sqrt(Math.max(0.001, vr));
    return [clamp(0.5 - Math.tanh(z * 0.3) * 0.35), 1.0, `runs${r}`];
};
const A7 = c => {
    const w = tail(c.seq, 60).map(T2N);
    if (w.length < 20) return [0.5, 0, "n/a"];
    const m = w.reduce((a, b) => a + b, 0) / w.length;
    let num = 0, den = 0;
    for (let i = 1; i < w.length; i++) { num += (w[i] - m) * (w[i - 1] - m); den += (w[i - 1] - m) ** 2; }
    const phi = den ? num / den : 0, last = w[w.length - 1];
    return [clamp(m + phi * (last - m)), Math.min(2, Math.abs(phi) * 4), `phi${phi.toFixed(2)}`];
};
const A8 = c => {
    const w = tail(c.seq, 60);
    let num = 0, den = 0;
    for (let i = 0; i < w.length; i++) { const wt = Math.pow(0.94, w.length - 1 - i); if (w[i] === "T") num += wt; den += wt; }
    return [den ? num / den : 0.5, 1.0, "recency"];
};

// ═══════════════════════════════════════════════════════════════════
//  NHÓM B — MARKOV & CHUỖI MẪU (8)
// ═══════════════════════════════════════════════════════════════════
function mkv(seq, o) {
    if (seq.length < o + 5) return [0.5, 0, "n/a"];
    const ctx = seq.slice(-o).join("");
    let t = 0, x = 0;
    for (let i = 0; i < seq.length - o; i++) {
        if (seq.slice(i, i + o).join("") === ctx) { if (seq[i + o] === "T") t++; else x++; }
    }
    if (t + x < 3) return [0.5, 0, `o${o}n/a`];
    return [(t + 0.5) / (t + x + 1), Math.min(2, (t + x) / 5), `mk${o}n${t + x}`];
}
const B1 = c => mkv(c.seq, 1);
const B2 = c => mkv(c.seq, 2);
const B3 = c => mkv(c.seq, 3);
const B4 = c => {
    let b = [0.5, 0, ""], bn = 0;
    for (let o = 1; o <= 4; o++) {
        const r = mkv(c.seq, o);
        const m = r[2].match(/n(\d+)/), n = m ? +m[1] : 0;
        if (n > bn) { bn = n; b = r; }
    }
    return b;
};
const B5 = c => {
    const w = tail(c.seq, 6).join("");
    const pats = ["TXXT", "XTTX", "TTXX", "XXTT", "TXTX", "XTXT"];
    for (const p of pats) if (w.endsWith(p)) return [p[0] === "T" ? 0.58 : 0.42, 1.0, p];
    return [0.5, 0, "n/a"];
};
const B6 = c => {
    const w = tail(c.seq, 8);
    if (w.length < 6) return [0.5, 0, "n/a"];
    let alt = true;
    for (let i = 1; i < w.length; i++) if (w[i] === w[i - 1]) { alt = false; break; }
    if (!alt) return [0.5, 0, "no"];
    const last = w[w.length - 1];
    return [last === "T" ? 0.4 : 0.6, 1.5, "alt"];
};
const B7 = c => {
    const w = tail(c.seq, 80).map(T2N);
    if (w.length < 20) return [0.5, 0, "n/a"];
    let tt = 0, tx = 0, ct = 0, cx = 0;
    for (let i = 1; i < w.length; i++) {
        if (w[i - 1] === 1) { ct++; if (w[i] === 1) tt++; }
        else { cx++; if (w[i] === 1) tx++; }
    }
    const pT = ct ? tt / ct : 0.5, pX = cx ? tx / cx : 0.5;
    const last = w[w.length - 1];
    return [last === 1 ? pT : pX, 1.3, "trans"];
};
const B8 = c => {
    if (c.seq.length < 20) return [0.5, 0, "n/a"];
    let best = [0.5, 0, "n/a"];
    for (let L = 2; L <= 6; L++) {
        const ctx = c.seq.slice(-L).join("");
        let t = 0, x = 0;
        for (let i = 0; i < c.seq.length - L; i++) {
            if (c.seq.slice(i, i + L).join("") === ctx) { if (c.seq[i + L] === "T") t++; else x++; }
        }
        if (t + x >= 3) {
            const p = (t + 0.5) / (t + x + 1);
            if (L === 6 || best[2] === "n/a" || t + x >= 5) best = [p, Math.min(1.5, (t + x) / 6), `L${L}n${t + x}`];
        }
    }
    return best;
};

// ═══════════════════════════════════════════════════════════════════
//  NHÓM C — CHUỖI THỜI GIAN & LỌC (8)
// ═══════════════════════════════════════════════════════════════════
const C1 = c => {
    let x = 0.5, P = 1; const Q = 0.02, R = 0.15;
    for (const z of tail(c.seq, 40).map(T2N)) {
        const xp = x, Pp = P + Q, K = Pp / (Pp + R);
        x = xp + K * (z - xp); P = (1 - K) * Pp;
    }
    return [x, 1.2, "kalman"];
};
const C2 = c => {
    const w = tail(c.seq, 40).map(T2N);
    if (w.length < 10) return [0.5, 0, "n/a"];
    let l = w[0], b = 0; const a = 0.3, be = 0.1;
    for (let i = 1; i < w.length; i++) { const lp = l; l = a * w[i] + (1 - a) * (l + b); b = be * (l - lp) + (1 - be) * b; }
    return [clamp(l + b), 1.0, "holt"];
};
const C3 = c => {
    const w = tail(c.seq, 30).map(T2N), n = w.length;
    if (n < 10) return [0.5, 0, "n/a"];
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { sx += i; sy += w[i]; sxy += i * w[i]; sxx += i * i; }
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx), inter = (sy - slope * sx) / n, nxt = inter + slope * n;
    return [clamp(0.5 + (nxt - 0.5) * 0.7), Math.min(1.5, Math.abs(slope) * 8), "lin"];
};
const C4 = c => {
    const w = tail(c.seq, 30).map(T2N);
    if (w.length < 20) return [0.5, 0, "n/a"];
    const ma5 = w.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const ma20 = w.reduce((a, b) => a + b, 0) / w.length;
    return [clamp(0.5 + (ma5 - ma20)), 1.0, "ma"];
};
const C5 = c => {
    const w = tail(c.seq, 60).map(T2N);
    if (w.length < 20) return [0.5, 0, "n/a"];
    const P = 4, r = w.slice(-P * 2);
    const s1 = r.slice(0, P).reduce((a, b) => a + b, 0) / P;
    const s2 = r.slice(P).reduce((a, b) => a + b, 0) / P;
    return [clamp(0.5 + (s2 - s1) * 0.5), 0.8, "hw"];
};
const C6 = c => {
    const w = tail(c.seq, 40).map(T2N);
    if (w.length < 15) return [0.5, 0, "n/a"];
    const m = w.reduce((a, b) => a + b, 0) / w.length;
    const v = w.reduce((a, b) => a + (b - m) ** 2, 0) / w.length;
    const vol = Math.sqrt(v), last = w[w.length - 1];
    return [clamp(0.5 + (0.5 - last) * (0.5 - vol) * 0.6), Math.min(1.5, vol * 3), "vol"];
};
const C7 = c => {
    const w = tail(c.seq, 32).map(T2N);
    if (w.length < 16) return [0.5, 0, "n/a"];
    const ap = [];
    for (let i = 0; i < w.length - 1; i += 2) ap.push((w[i] + w[i + 1]) / 2);
    const recent = ap.slice(-4).reduce((a, b) => a + b, 0) / 4;
    return [clamp(recent), 0.9, "haar"];
};
const C8 = c => {
    const ema = (arr, a) => { let e = arr[0]; for (const x of arr) e = a * x + (1 - a) * e; return e; };
    const w = tail(c.seq, 50).map(T2N);
    if (w.length < 15) return [0.5, 0, "n/a"];
    const e1 = ema(w, 0.3), e2 = ema(w, 0.1);
    return [clamp(0.5 + (e1 - e2) * 1.5 + (e1 - 0.5) * 0.3), 1.1, "ema-multi"];
};

// ═══════════════════════════════════════════════════════════════════
//  NHÓM D — THÔNG TIN & META-ENSEMBLE (8)
// ═══════════════════════════════════════════════════════════════════
const D1 = c => {
    const w = tail(c.seq, 50), H = ent(freq(w));
    return [clamp(0.5 + (freq(w) - 0.5) * (1 - H)), Math.max(0.1, (1 - H) * 2), `H${H.toFixed(2)}`];
};
const D2 = c => {
    const ps = freq(tail(c.seq, 15)), pl = freq(tail(c.seq, 60));
    const kl = ps * Math.log(ps / pl + 1e-9) + (1 - ps) * Math.log((1 - ps) / (1 - pl) + 1e-9);
    return [clamp(0.5 + (ps - 0.5) * Math.min(1, 1 / (1 + Math.abs(kl)))), Math.min(1.5, Math.abs(kl)), `KL${kl.toFixed(2)}`];
};
const D3 = c => {
    const p = freq(tail(c.seq, 15)), q = freq(tail(c.seq, 60)), m = (p + q) / 2;
    const js = 0.5 * p * Math.log(p / m + 1e-9) + 0.5 * q * Math.log(q / m + 1e-9)
             + 0.5 * (1 - p) * Math.log((1 - p) / (1 - m) + 1e-9) + 0.5 * (1 - q) * Math.log((1 - q) / (1 - m) + 1e-9);
    return [0.5 + (p - 0.5) * 0.7, Math.max(0.1, 1 - js * 2), `JS${js.toFixed(2)}`];
};
const D4 = c => {
    const p = freq(tail(c.seq, 40)), b = BASE_RATE;
    const ce = -(p * Math.log(b) + (1 - p) * Math.log(1 - b));
    return [0.5 + (p - b) * 0.8, 0.7, `CE${ce.toFixed(2)}`];
};
const D5 = c => {
    const p = freq(tail(c.seq, 30));
    const pp = Math.exp(-(p * Math.log(p + 1e-9) + (1 - p) * Math.log(1 - p + 1e-9)));
    return [0.5 + (p - 0.5) * 0.7, Math.max(0.1, 1 - pp / 2), `PPL${pp.toFixed(1)}`];
};
const D6 = c => {
    const s = tail(c.seq, 40).join("");
    let cx = 1, cur = ""; const dict = new Set();
    for (const ch of s) { if (dict.has(cur + ch)) cur += ch; else { dict.add(cur + ch); cx++; cur = ch; } }
    return [0.5 + (freq(tail(c.seq, 20)) - 0.5) * 0.6, Math.min(1.3, cx / 20), `LZ${cx}`];
};
const D7 = c => {
    const p10 = freq(tail(c.seq, 10)), p30 = freq(tail(c.seq, 30)), p100 = freq(tail(c.seq, 100));
    return [p10 * 0.5 + p30 * 0.3 + p100 * 0.2, 1.0, "bma"];
};
const D8 = c => {
    const ps = [freq(tail(c.seq, 8)), freq(tail(c.seq, 20)), freq(tail(c.seq, 50)), freq(tail(c.seq, 100))];
    const m = ps.reduce((a, b) => a + b, 0) / ps.length;
    const v = ps.reduce((a, b) => a + (b - m) ** 2, 0) / ps.length;
    return [m, Math.max(0.3, 1.5 - Math.sqrt(v) * 4), `meta${(m * 100).toFixed(0)}`];
};

// ═══════════════════════════════════════════════════════════════════
//  32 MODULES REGISTRY
// ═══════════════════════════════════════════════════════════════════
const MODULES = [
    ["A1", A1], ["A2", A2], ["A3", A3], ["A4", A4], ["A5", A5], ["A6", A6], ["A7", A7], ["A8", A8],
    ["B1", B1], ["B2", B2], ["B3", B3], ["B4", B4], ["B5", B5], ["B6", B6], ["B7", B7], ["B8", B8],
    ["C1", C1], ["C2", C2], ["C3", C3], ["C4", C4], ["C5", C5], ["C6", C6], ["C7", C7], ["C8", C8],
    ["D1", D1], ["D2", D2], ["D3", D3], ["D4", D4], ["D5", D5], ["D6", D6], ["D7", D7], ["D8", D8],
];

// ═══════════════════════════════════════════════════════════════════
//  ENSEMBLE ENGINE — kết hợp 32 module
// ═══════════════════════════════════════════════════════════════════
function analyze(state) {
    const sessions = state.sessions;
    if (sessions.length < 30) return null;

    const seq = sessions.map(s => s.result === "TAI" ? "T" : "X");
    const ctx = { seq, sessions, state };

    const signals = [];
    for (const [id, fn] of MODULES) {
        try {
            const [p, w, note] = fn(ctx);
            const pSafe = clamp(p, 0.05, 0.95);
            signals.push({ id, p_tai: pSafe * 100, w, note });
        } catch {
            signals.push({ id, p_tai: 50, w: 0, note: "err" });
        }
    }

    // ── Ensemble 1: weighted mean (xác suất trung bình có trọng số) ──
    let num = 0, den = 0;
    for (const s of signals) { num += s.p_tai * s.w; den += s.w; }
    const pMean = den ? num / den / 100 : 0.5;

    // ── Ensemble 2: log-odds pooling (hợp nhất Bayes) ──
    let lo = 0, lw = 0;
    for (const s of signals) {
        if (s.w <= 0) continue;
        const p = Math.max(0.02, Math.min(0.98, s.p_tai / 100));
        lo += Math.log(p / (1 - p)) * s.w;
        lw += s.w;
    }
    const pLog = lw ? sig(lo / lw) : 0.5;

    // ── Blend 50/50 ──
    const pTai = pMean * 0.5 + pLog * 0.5;

    // ── Agreement ──
    const active = signals.filter(s => s.w > 0);
    const predict = pTai >= 0.5 ? "TAI" : "XIU";
    const agree = active.length
        ? active.filter(s => (s.p_tai >= 50) === (predict === "TAI")).length / active.length * 100
        : 50;
    const conf = Math.max(pTai, 1 - pTai) * 100;

    // ── Tier ──
    let tier = "WEAK";
    if (conf >= 60 && agree >= 70) tier = "STRONG";
    else if (conf >= 55 && agree >= 60) tier = "OK";
    else if (agree < 40) tier = "SPLIT";

    // ── Wilson lower bound ──
    const h = state.history.slice(-100);
    let wilson = 0;
    if (h.length >= 20) {
        const wins = h.filter(x => x.result === "WIN").length;
        const ph = wins / h.length, z = 1.96, d = 1 + z * z / h.length;
        const c = (ph + z * z / (2 * h.length)) / d;
        const m = z * Math.sqrt(ph * (1 - ph) / h.length + z * z / (4 * h.length * h.length)) / d;
        wilson = Math.max(0, c - m) * 100;
    }

    return {
        predict, confidence: conf, tier, agreement: agree, wilson,
        p_tai: pTai * 100, p_xiu: (1 - pTai) * 100,
    };
}

// ═══════════════════════════════════════════════════════════════════
//  PARSE
// ═══════════════════════════════════════════════════════════════════
function parseHu(data) {
    if (!data?.list || !Array.isArray(data.list)) return [];
    return data.list.sort((a, b) => b.id - a.id).map(it => ({
        id: it.id, dices: it.dices, point: it.point,
        result: it.point >= 11 ? "TAI" : "XIU",
        result_vn: it.point >= 11 ? "Tài" : "Xỉu",
    })).sort((a, b) => a.id - b.id);
}
function parseMd5(data) {
    if (!data?.list || !Array.isArray(data.list)) return [];
    return data.list.sort((a, b) => b.id - a.id).map(it => ({
        id: it.id, dices: it.dices, point: it.point,
        result: it.resultTruyenThong === "Tài" ? "TAI" : "XIU",
        result_vn: it.resultTruyenThong,
    })).sort((a, b) => a.id - b.id);
}

// ═══════════════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════════════
const mkState = () => ({ sessions: [], lastId: null, history: [], lastPred: null, lastFetchAt: 0 });
const stateHu = mkState(), stateMd5 = mkState();

function updateState(state, arr) {
    if (!arr.length) return;
    const latest = arr[arr.length - 1].id;
    if (!state.lastId) { state.sessions = arr; state.lastId = latest; console.log(`✅ Loaded ${arr.length}`); return; }
    if (latest > state.lastId) {
        const news = arr.filter(r => r.id > state.lastId);
        for (const r of news) {
            if (state.lastPred && state.lastPred.session === r.id) {
                const win = state.lastPred.predict === r.result;
                state.history.push({ sessionId: r.id, predict: state.lastPred.predict, actual: r.result, result: win ? "WIN" : "LOSE" });
                if (state.history.length > 500) state.history.shift();
                state.lastPred = null;
            }
            state.sessions.push(r);
        }
        if (state.sessions.length > 800) state.sessions = state.sessions.slice(-700);
        state.lastId = latest;
        console.log(`🆕 +${news.length} → ${latest}`);
    }
}

async function fetchHu() { try { updateState(stateHu, parseHu(await fetchJSON(API_URL_HU))); stateHu.lastFetchAt = Date.now(); } catch (e) { console.error("HU:", e.message); } }
async function fetchMd5() { try { updateState(stateMd5, parseMd5(await fetchJSON(API_URL_MD5))); stateMd5.lastFetchAt = Date.now(); } catch (e) { console.error("MD5:", e.message); } }

function getPrediction(state) {
    if (state.sessions.length < 30) return null;
    if (state.lastPred && state.lastPred.session === state.lastId + 1) return state.lastPred.ai_result;
    const ai = analyze(state);
    if (!ai) return null;
    state.lastPred = { session: state.lastId + 1, predict: ai.predict, ai_result: ai };
    return ai;
}

// ═══════════════════════════════════════════════════════════════════
//  BUILD RESPONSE (đã bỏ bảng điểm & cầu)
// ═══════════════════════════════════════════════════════════════════
function buildResp(state, game) {
    if (state.sessions.length < 30) return null;
    const ai = getPrediction(state);
    if (!ai) return null;
    const last = state.sessions[state.sessions.length - 1];

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
        Ly_do: `ENSEMBLE-32 · Tier ${ai.tier} · Đồng thuận ${ai.agreement.toFixed(0)}%`,
        AI: {
            engine: "ENSEMBLE-32",
            tier: ai.tier,
            p_tai: +ai.p_tai.toFixed(2),
            p_xiu: +ai.p_xiu.toFixed(2),
            agreement: +ai.agreement.toFixed(1),
            wilson: +ai.wilson.toFixed(2),
        },
    };
}

// ═══════════════════════════════════════════════════════════════════
//  SERVER
// ═══════════════════════════════════════════════════════════════════
const checkKey = q => q.key === VALID_KEY ? { valid: true } : { valid: false, error: `Sai key! Ib ${ADMIN}` };
const app = fastify({ logger: false, disableRequestLogging: true });
app.register(cors, { origin: "*" });

app.get("/", async () => ({
    status: "ok", admin: ADMIN,
    engine: "LC79 v9 — ENSEMBLE 32 THUẬT TOÁN / 4 NHÓM",
    groups: {
        A: "Thống kê & Xác suất (8)",
        B: "Markov & Chuỗi mẫu (8)",
        C: "Chuỗi thời gian & Lọc (8)",
        D: "Thông tin & Meta-Ensemble (8)",
    },
    hu:  { loaded: stateHu.sessions.length,  last_id: stateHu.lastId },
    md5: { loaded: stateMd5.sessions.length, last_id: stateMd5.lastId },
}));

const route = (game, state) => async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const r = buildResp(state, game);
    return r || rep.status(503).send({ error: `Đang tải ${game}...` });
};
app.get("/api/taixiu/lc79",  route("HŨ",  stateHu));
app.get("/api/taixiumd5/lc79", route("MD5", stateMd5));

app.get("/api/taixiu/lc79/history", async (req, rep) => {
    const k = checkKey(req.query); if (!k.valid) return rep.status(401).send({ error: k.error });
    return stateHu.sessions.slice(-30).reverse().map(i => ({ session: i.id, dice: i.dices, total: i.point, result: i.result_vn.toLowerCase() }));
});
app.get("/api/taixiumd5/lc79/history", async (req, rep) => {
    const k = checkKey(req.query); if (!k.valid) return rep.status(401).send({ error: k.error });
    return stateMd5.sessions.slice(-30).reverse().map(i => ({ session: i.id, dice: i.dices, total: i.point, result: i.result_vn.toLowerCase() }));
});

app.get("/check-key", async req => req.query.key === VALID_KEY
    ? { status: "success", message: "KEY HỢP LỆ", admin: ADMIN }
    : { status: "error", message: `Sai key! Ib ${ADMIN}` });

app.listen({ port: PORT, host: "0.0.0.0" }).then(() => {
    console.log(`🚀 [${PORT}] LC79 v9 · ENSEMBLE 32 modules online`);
    setTimeout(() => { fetchHu().catch(() => {}); fetchMd5().catch(() => {}); }, 100);
    setInterval(() => fetchHu().catch(() => {}), 6000);
    setInterval(() => fetchMd5().catch(() => {}), 6000);
}).catch(err => { console.error("Boot:", err.message); process.exit(1); });
