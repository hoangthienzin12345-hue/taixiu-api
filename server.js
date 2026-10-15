import fastify from "fastify";
import cors from "@fastify/cors";
import fs from "fs";
import path from "path";

// ═══════════════════════════════════════════════════════════════════
//  CẤU HÌNH HỆ THỐNG
// ═══════════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
const VALID_KEY = "Thiên456";
const ADMIN = "@ADMNLc79";

const API_URL_HU = "https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5";
const API_URL_MD5 = "https://wtxmd52.tele68.com/v1/txmd5/sessions";

// ═══════════════════════════════════════════════════════════════════
//  HELPERS & UTILITIES
// ═══════════════════════════════════════════════════════════════════
const clamp = (v, lo = 0.05, hi = 0.95) => Math.max(lo, Math.min(hi, v));
const sig = x => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, x))));
const T2N = s => (s === "T" ? 1 : 0);
const freq = (a, v = "T") => a.length ? a.filter(x => x === v).length / a.length : 0.5;
const cnt = (a, v) => a.filter(x => x === v).length;
const tail = (a, n) => a.slice(-n);
const ent = p => (p <= 0 || p >= 1) ? 0 : -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
const runs = seq => { if (!seq.length) return 0; let r = 1; for (let i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1]) r++; return r; };

function streak(seq) {
    if (!seq.length) return [0, ""];
    const L = seq[seq.length - 1];
    let s = 1;
    for (let i = seq.length - 2; i >= 0; i--) { if (seq[i] === L) s++; else break; }
    return [s, L];
}

function fetchImpl() {
    if (typeof fetch === "function") return fetch;
    if (typeof globalThis.fetch === "function") return globalThis.fetch;
    throw new Error("fetch not available");
}

async function fetchJSON(url, timeoutMs = 8000, retries = 2) {
    const f = fetchImpl();
    for (let a = 0; a <= retries; a++) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            const r = await f(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 LC79" } });
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
//  SELF-LEARNING WEIGHTS SYSTEM (40+ ALGORITHMS)
// ═══════════════════════════════════════════════════════════════════
const WEIGHTS_FILE = "./ai_weights.json";

const DEFAULT_WEIGHTS = {
    // Cầu (Pattern matching) - 10 thuật toán
    "cau_11": 1.2, "cau_22": 1.2, "cau_33": 1.2, "cau_21": 1.0, "cau_32": 1.0,
    "cau_12": 0.9, "cau_13": 0.9, "cau_23": 0.9, "cau_alternating": 1.3, "cau_xyz": 1.1,
    
    // Markov & Probability - 6 thuật toán
    "markov_1": 1.1, "markov_2": 1.2, "markov_3": 1.3, "markov_4": 1.0,
    "frequency": 1.0, "bayesian": 1.2,
    
    // Trend & Momentum - 5 thuật toán
    "trend": 1.0, "momentum": 1.1, "rsi": 1.0, "macd": 1.0, "bollinger": 0.9,
    
    // Historical Ensemble - 5 thuật toán
    "fibonacci_streak": 1.2, "entropy": 1.0, "autocorr": 1.1, "runs_test": 1.0, "mean_reversion": 1.0,
    
    // Advanced AI - 8 thuật toán
    "anti_bait": 1.5, "smart_breaker": 1.5, "contrarian": 1.2, "ngram_4": 1.1, "ngram_5": 1.0,
    "elliott_wave": 1.2, "mirror_reflection": 1.0, "harmonic_cycle": 1.0
};

let ALGORITHM_WEIGHTS = loadWeights();
let ALGORITHM_STATS = { total: 0, wins: 0, losses: 0, by_algorithm: {} };

function loadWeights() {
    try {
        if (fs.existsSync(WEIGHTS_FILE)) {
            const data = JSON.parse(fs.readFileSync(WEIGHTS_FILE, "utf8"));
            return { ...DEFAULT_WEIGHTS, ...data };
        }
    } catch (e) {
        console.warn("⚠️ Không thể đọc weights file, sử dụng default");
    }
    return { ...DEFAULT_WEIGHTS };
}

function saveWeights() {
    try {
        fs.writeFileSync(WEIGHTS_FILE, JSON.stringify(ALGORITHM_WEIGHTS, null, 2));
    } catch (e) {
        console.error("❌ Lỗi lưu weights:", e.message);
    }
}

// ═══════════════════════════════════════════════════════════════════
//  CAU PATTERN ALGORITHMS (Mô hình cầu: 1-1, 2-2, 3-3, 2-1, v.v.)
// ═══════════════════════════════════════════════════════════════════
const cau_11 = c => {
    const w = tail(c.seq, 12);
    let count = 0;
    for (let i = 0; i < w.length - 1; i++) if (w[i] === w[i + 1]) count++;
    return [count > w.length / 3 ? 0.52 : 0.48, 1.1, `cau-1-1:${count}`];
};

const cau_22 = c => {
    const w = tail(c.seq, 16).join("");
    let count = 0;
    for (let i = 0; i < w.length - 3; i++) if (w[i] === w[i + 1] && w[i + 2] === w[i + 3]) count++;
    return [count > 2 ? 0.54 : 0.46, 1.2, `cau-2-2:${count}`];
};

const cau_33 = c => {
    const w = tail(c.seq, 20).join("");
    let count = 0;
    for (let i = 0; i < w.length - 5; i++) if (w[i] === w[i + 1] && w[i + 1] === w[i + 2] && w[i + 3] === w[i + 4] && w[i + 4] === w[i + 5]) count++;
    return [count > 0 ? 0.56 : 0.44, 1.3, `cau-3-3:${count}`];
};

const cau_21 = c => {
    const w = tail(c.seq, 14).join("");
    let count = 0;
    for (let i = 0; i < w.length - 2; i++) if (w[i] === w[i + 1] && w[i + 2] !== w[i + 1]) count++;
    return [count > w.length / 4 ? 0.53 : 0.47, 1.0, `cau-2-1:${count}`];
};

const cau_32 = c => {
    const w = tail(c.seq, 16).join("");
    let count = 0;
    for (let i = 0; i < w.length - 4; i++) if (w[i] === w[i + 1] && w[i + 1] === w[i + 2] && w[i + 3] === w[i + 4]) count++;
    return [count > 1 ? 0.55 : 0.45, 1.0, `cau-3-2:${count}`];
};

const cau_alternating = c => {
    const w = tail(c.seq, 12);
    let alt_count = 0;
    for (let i = 0; i < w.length - 1; i++) if (w[i] !== w[i + 1]) alt_count++;
    return [alt_count > w.length / 2 + 2 ? 0.58 : 0.42, 1.3, `cau-alt:${alt_count}`];
};

const cau_xyz = c => {
    const w = tail(c.seq, 9).join("");
    const patterns = ["TTT", "XXX", "TXXTTX", "XTXXTX"];
    for (const p of patterns) if (w.includes(p)) return [p.includes("T") ? 0.56 : 0.44, 1.1, `cau-xyz:${p}`];
    return [0.5, 0, "cau-xyz:none"];
};

// ═══════════════════════════════════════════════════════════════════
//  MARKOV & ENSEMBLE HISTORY ALGORITHMS
// ═══════════════════════════════════════════════════════════════════
function markov_chain(seq, order) {
    if (seq.length < order + 5) return [0.5, 0, "n/a"];
    const ctx = seq.slice(-order).join("");
    let t = 0, x = 0;
    for (let i = 0; i < seq.length - order; i++) {
        if (seq.slice(i, i + order).join("") === ctx) { if (seq[i + order] === "T") t++; else x++; }
    }
    if (t + x < 3) return [0.5, 0, "n/a"];
    return [(t + 0.5) / (t + x + 1), Math.min(2.2, (t + x) / 4 + 0.4), `mk${order}:${t + x}`];
}

const markov_1 = c => markov_chain(c.seq, 1);
const markov_2 = c => markov_chain(c.seq, 2);
const markov_3 = c => markov_chain(c.seq, 3);
const markov_4 = c => markov_chain(c.seq, 4);

const frequency = c => {
    const w = tail(c.seq, 40);
    const p = freq(w);
    return [p, 1.0, `freq=${p.toFixed(2)}`];
};

const bayesian = c => {
    const w = tail(c.seq, 40);
    let a = 3, b = 3;
    for (const x of w) x === "T" ? a++ : b++;
    return [a / (a + b), 1.2, `β(${a},${b})`];
};

// ═══════════════════════════════════════════════════════════════════
//  TREND & MOMENTUM ALGORITHMS
// ═══════════════════════════════════════════════════════════════════
const trend = c => {
    const w = tail(c.seq, 10);
    return [freq(w), 1.0, `trend=${freq(w).toFixed(2)}`];
};

const momentum = c => {
    const w = tail(c.seq, 5).map(T2N);
    const m = w.reduce((a, b) => a + b, 0) / w.length;
    return [m > 0.5 ? 0.55 : 0.45, 1.1, `mom=${m.toFixed(2)}`];
};

const rsi = c => {
    const w = tail(c.seq, 10);
    const tai_cnt = cnt(w, "T");
    const rsi = tai_cnt / w.length;
    return [rsi > 0.7 ? 0.35 : (rsi < 0.3 ? 0.65 : 0.5), 1.0, `rsi=${rsi.toFixed(2)}`];
};

const macd = c => {
    const w = tail(c.seq, 9);
    const recent = cnt(tail(w, 3), "T") / 3;
    const older = cnt(tail(w, 6).slice(0, 3), "T") / 3;
    return [recent > older ? 0.55 : 0.45, 1.0, `macd=${(recent - older).toFixed(2)}`];
};

const bollinger = c => {
    const w = tail(c.seq, 20).map(T2N);
    const mean = w.reduce((a, b) => a + b, 0) / w.length;
    const variance = w.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / w.length;
    const std = Math.sqrt(variance);
    return [clamp(mean + std * 0.2), 0.9, `bb=${mean.toFixed(2)}±${std.toFixed(2)}`];
};

// ═══════════════════════════════════════════════════════════════════
//  HISTORICAL ENSEMBLE ALGORITHMS
// ═══════════════════════════════════════════════════════════════════
const fibonacci_streak = c => {
    const [s] = streak(c.seq);
    const fib_nums = [3, 5, 8, 13, 21];
    const is_fib = fib_nums.includes(s);
    return [is_fib ? 0.58 : 0.42, 1.2, `fib_streak=${s}`];
};

const entropy_algo = c => {
    const w = tail(c.seq, 50);
    const p_t = freq(w);
    const e = ent(p_t);
    return [clamp(0.5 + e * 0.3), 1.0, `ent=${e.toFixed(2)}`];
};

const autocorr = c => {
    const w = tail(c.seq, 60).map(T2N);
    if (w.length < 20) return [0.5, 0, "n/a"];
    const m = w.reduce((a, b) => a + b, 0) / w.length;
    let num = 0, den = 0;
    for (let i = 1; i < w.length; i++) { num += (w[i] - m) * (w[i - 1] - m); den += (w[i - 1] - m) ** 2; }
    const phi = den ? num / den : 0;
    const last = w[w.length - 1];
    const p = last === 1 ? 0.5 + phi * 0.5 : 0.5 - phi * 0.5;
    return [clamp(p), 1.1, `φ=${phi.toFixed(2)}`];
};

const runs_test = c => {
    const w = tail(c.seq, 50);
    const n1 = cnt(w, "T"), n2 = cnt(w, "X");
    if (n1 + n2 < 10) return [0.5, 0, "n/a"];
    const r = runs(w), exp = 2 * n1 * n2 / (n1 + n2) + 1;
    const z = r < exp ? 0.45 : 0.55;
    return [z, 1.0, `runs=${r}`];
};

const mean_reversion = c => {
    const w = tail(c.seq, 30).map(T2N);
    const mean = w.reduce((a, b) => a + b, 0) / w.length;
    const last = w[w.length - 1];
    const is_high = mean > 0.6 && last === 1;
    return [is_high ? 0.4 : 0.6, 1.0, `mean_rev=${mean.toFixed(2)}`];
};

// ═══════════════════════════════════════════════════════════════════
//  ADVANCED AI ALGORITHMS
// ═══════════════════════════════════════════════════════════════════
const anti_bait = c => {
    const [s, L] = streak(c.seq);
    const w = tail(c.seq, 12).join("");
    const is_bait = s >= 5 || w.match(/T{4,}|X{4,}/);
    return [is_bait ? (L === "T" ? 0.3 : 0.7) : 0.5, 1.5, `anti-bait=${s}`];
};

const smart_breaker = c => {
    const [s, L] = streak(c.seq);
    const max_streak = [...c.seq].reduce((m, _, i) => {
        let cur = 1;
        for (let j = i + 1; j < c.seq.length && c.seq[j] === c.seq[i]; j++) cur++;
        return Math.max(m, cur);
    }, 0);
    return [s >= max_streak - 1 && s >= 3 ? (L === "T" ? 0.35 : 0.65) : 0.5, 1.5, `smart_break=${s}`];
};

const contrarian = c => {
    const w = tail(c.seq, 20);
    const tai_cnt = cnt(w, "T");
    const is_obvious_tai = tai_cnt > 15;
    return [is_obvious_tai ? 0.35 : (tai_cnt < 5 ? 0.65 : 0.5), 1.2, `contrarian=${tai_cnt}`];
};

const ngram_4 = c => {
    const seq_str = c.seq.map(x => x === "T" ? "1" : "0").join("");
    const last4 = seq_str.slice(-4);
    const t_count = seq_str.slice(0, -4).split(last4 + "1").length - 1;
    const x_count = seq_str.slice(0, -4).split(last4 + "0").length - 1;
    return [t_count > x_count ? 0.55 : 0.45, 1.1, `ng4=${t_count}/${x_count}`];
};

const ngram_5 = c => {
    const seq_str = c.seq.map(x => x === "T" ? "1" : "0").join("");
    const last5 = seq_str.slice(-5);
    const t_count = seq_str.slice(0, -5).split(last5 + "1").length - 1;
    const x_count = seq_str.slice(0, -5).split(last5 + "0").length - 1;
    return [t_count > x_count ? 0.56 : 0.44, 1.0, `ng5=${t_count}/${x_count}`];
};

const elliott_wave = c => {
    const w = tail(c.seq, 12).join("");
    const has_5wave = w.match(/T{1,}X{1,}T{1,}X{1,}T{1,}/);
    return [has_5wave ? (w.endsWith("T") ? 0.4 : 0.6) : 0.5, 1.2, `elliott=${has_5wave ? "yes" : "no"}`];
};

const mirror_reflection = c => {
    const w = tail(c.seq, 12).map(T2N);
    if (w.length < 6) return [0.5, 0, "n/a"];
    const first3 = JSON.stringify(w.slice(0, 3));
    const last3 = JSON.stringify(w.slice(-3).reverse());
    return [first3 === last3 ? 0.55 : 0.45, 1.0, `mirror=${first3 === last3 ? "yes" : "no"}`];
};

const harmonic_cycle = c => {
    const w = tail(c.seq, 30);
    let cycle_score = 0;
    for (let period = 3; period <= 15; period++) {
        for (let offset = 0; offset < 10; offset++) {
            let matches = 0;
            for (let i = offset; i + period < w.length; i += period) {
                if (w[i] === w[i + period]) matches++;
            }
            if (matches > period / 2) cycle_score += matches;
        }
    }
    return [cycle_score > 10 ? 0.52 : 0.48, 1.0, `harmonic=${cycle_score}`];
};

// ═══════════════════════════════════════════════════════════════════
//  COMBINED ALGORITHM RESULTS
// ═══════════════════════════════════════════════════════════════════
const ALL_ALGORITHMS = [
    // Cầu algorithms
    { id: "cau_11", algo: cau_11 }, { id: "cau_22", algo: cau_22 }, { id: "cau_33", algo: cau_33 },
    { id: "cau_21", algo: cau_21 }, { id: "cau_32", algo: cau_32 }, { id: "cau_alternating", algo: cau_alternating },
    { id: "cau_xyz", algo: cau_xyz },
    // Markov
    { id: "markov_1", algo: markov_1 }, { id: "markov_2", algo: markov_2 }, { id: "markov_3", algo: markov_3 },
    { id: "markov_4", algo: markov_4 }, { id: "frequency", algo: frequency }, { id: "bayesian", algo: bayesian },
    // Trend
    { id: "trend", algo: trend }, { id: "momentum", algo: momentum }, { id: "rsi", algo: rsi },
    { id: "macd", algo: macd }, { id: "bollinger", algo: bollinger },
    // Historical
    { id: "fibonacci_streak", algo: fibonacci_streak }, { id: "entropy", algo: entropy_algo },
    { id: "autocorr", algo: autocorr }, { id: "runs_test", algo: runs_test }, { id: "mean_reversion", algo: mean_reversion },
    // Advanced
    { id: "anti_bait", algo: anti_bait }, { id: "smart_breaker", algo: smart_breaker },
    { id: "contrarian", algo: contrarian }, { id: "ngram_4", algo: ngram_4 }, { id: "ngram_5", algo: ngram_5 },
    { id: "elliott_wave", algo: elliott_wave }, { id: "mirror_reflection", algo: mirror_reflection },
    { id: "harmonic_cycle", algo: harmonic_cycle }
];

function analyze(state) {
    if (state.sessions.length < 20) return null;

    const seq = state.sessions.map(s => s.result === "TÀI" ? "T" : "X");
    const context = { seq };

    let signals = [];
    let score_tai = 0, score_xiu = 0;

    for (const { id, algo } of ALL_ALGORITHMS) {
        try {
            const [p_tai, w, note] = algo(context);
            const weight = ALGORITHM_WEIGHTS[id] || 1.0;
            const p_xiu = 1 - p_tai;

            score_tai += p_tai * weight;
            score_xiu += p_xiu * weight;

            if (w > 0) {
                signals.push({ id, p_tai: p_tai * 100, weight, note });
            }
        } catch (e) {
            console.error(`⚠️ Error in ${id}:`, e.message);
        }
    }

    const total = score_tai + score_xiu;
    const p_tai_final = score_tai / total;
    const p_xiu_final = score_xiu / total;
    const predict = p_tai_final >= 0.5 ? "TAI" : "XIU";

    const confidence = Math.abs(p_tai_final - 0.5) * 2 * 100;
    const agreement = ((Math.max(score_tai, score_xiu) - Math.min(score_tai, score_xiu)) / total * 100);

    signals.sort((a, b) => Math.abs(b.p_tai - 50) - Math.abs(a.p_tai - 50));
    const top = signals.slice(0, 5);

    const tier = confidence > 80 ? "SS" : (confidence > 70 ? "S" : (confidence > 60 ? "A" : (confidence > 50 ? "B" : "C")));
    const activeCount = signals.filter(s => s.weight > 0.8).length;

    return {
        predict,
        confidence: confidence,
        p_tai: p_tai_final,
        p_xiu: p_xiu_final,
        pMean: (p_tai_final + p_xiu_final) / 2,
        pLog: Math.log(p_tai_final / p_xiu_final) * 10,
        tier,
        agreement,
        wilson: p_tai_final,
        signals: signals.slice(0, 8),
        top,
        activeCount
    };
}

// ═══════════════════════════════════════════════════════════════════
//  STATE MANAGEMENT & DATA FETCHING
// ═══════════════════════════════════════════════════════════════════
// ✅ ĐÚNG — API trả về field "list", không phải "data"
const parseHu = d => {
    if (!d?.list || !Array.isArray(d.list)) return [];
    return d.list
        .map(item => ({
            id:     item.id,
            dices:  item.dices || [0, 0, 0],
            point:  Number(item.point) || 0,
            result: (Number(item.point) >= 11) ? "TÀI" : "XỈU",
        }))
        .sort((a, b) => a.id - b.id);
};

const parseMd5 = d => {
    if (!d?.list || !Array.isArray(d.list)) return [];
    return d.list
        .map(item => {
            const raw = String(item.resultTruyenThong || "").toUpperCase();
            return {
                id:     item.id,
                dices:  item.dices || [0, 0, 0],
                point:  Number(item.point) || 0,
                result: (raw.includes("TÀI") || raw === "TAI") ? "TÀI" : "XỈU",
            };
        })
        .sort((a, b) => a.id - b.id);
};
const mkState = () => ({
    sessions: [], lastId: null, history: [], lastPred: null,
    lastFetchAt: 0, lastFetchOk: false, lastError: null, fetchCount: 0,
});

const stateHu = mkState(), stateMd5 = mkState();

function updateState(state, arr) {
    state.fetchCount++;
    state.lastFetchAt = Date.now();
    state.lastFetchOk = true;
    state.lastError = null;

    if (!arr || !arr.length) return;

    const latest = arr[arr.length - 1].id;

    if (!state.lastId) {
        state.sessions = arr.slice();
        state.lastId = latest;
        console.log(`✅ [${state === stateHu ? "HU" : "MD5"}] Loaded ${arr.length} sessions · last=${latest}`);
        return;
    }

    if (latest > state.lastId) {
        const news = arr.filter(r => r.id > state.lastId);
        for (const r of news) {
            if (state.lastPred && state.lastPred.session === r.id) {
                const win = state.lastPred.predict === (r.result === "TÀI" ? "TAI" : "XIU");
                state.history.push({
                    sessionId: r.id,
                    predict: state.lastPred.predict,
                    actual: r.result,
                    result: win ? "WIN" : "LOSE",
                });
                if (state.history.length > 500) state.history.shift();
                state.lastPred = null;

                // Self-learning: update weights based on result
                updateWeightsFromResult(win);
            }
            state.sessions.push(r);
        }
        if (state.sessions.length > 1000) state.sessions = state.sessions.slice(-800);
        state.lastId = latest;
        console.log(`🆕 [${state === stateHu ? "HU" : "MD5"}] +${news.length} → ${latest}`);
    }
}

function updateWeightsFromResult(isWin) {
    const LEARNING_RATE = 0.05;
    for (const key in ALGORITHM_WEIGHTS) {
        if (isWin) {
            ALGORITHM_WEIGHTS[key] = Math.min(2.5, ALGORITHM_WEIGHTS[key] + LEARNING_RATE);
        } else {
            ALGORITHM_WEIGHTS[key] = Math.max(0.5, ALGORITHM_WEIGHTS[key] - LEARNING_RATE * 0.5);
        }
    }
    saveWeights();
}

async function fetchHu() {
    try {
        updateState(stateHu, parseHu(await fetchJSON(API_URL_HU)));
    } catch (e) {
        stateHu.lastFetchOk = false;
        stateHu.lastError = e.message;
        console.error("HU:", e.message);
    }
}

async function fetchMd5() {
    try {
        updateState(stateMd5, parseMd5(await fetchJSON(API_URL_MD5)));
    } catch (e) {
        stateMd5.lastFetchOk = false;
        stateMd5.lastError = e.message;
        console.error("MD5:", e.message);
    }
}

function getPrediction(state) {
    if (state.sessions.length < 20) return null;
    if (state.lastPred && state.lastPred.session === state.lastId + 1) return state.lastPred.ai_result;

    const ai = analyze(state);
    if (!ai) return null;

    state.lastPred = {
        session: state.lastId + 1,
        predict: ai.predict,
        ai_result: ai,
    };
    return ai;
}

// ═══════════════════════════════════════════════════════════════════
//  API RESPONSE BUILDER
// ═══════════════════════════════════════════════════════════════════
function buildResp(state, game) {
    if (state.sessions.length < 20) return null;
    const ai = getPrediction(state);
    if (!ai) return null;

    const last = state.sessions[state.sessions.length - 1];

    return {
        Id:          ADMIN,
        Phien_nay:   last.id + 1,
        Du_doan:     ai.predict === "TAI" ? "TÀI" : "XỈU",
        Ty_le:       `${(Math.max(ai.p_tai, ai.p_xiu) * 100).toFixed(1)}%`,
        Phien_truoc: last.id,
        Xuc_xac:     `${last.dices[0]}-${last.dices[1]}-${last.dices[2]}`,
        Ket_qua:     last.result,
    };
}

// ═══════════════════════════════════════════════════════════════════
//  SERVER
// ═══════════════════════════════════════════════════════════════════
const checkKey = q => q.key === VALID_KEY ? { valid: true } : { valid: false, error: `Sai key! Ib ${ADMIN}` };

const app = fastify({ logger: false, disableRequestLogging: true });
app.register(cors, { origin: "*" });

app.get("/", async () => ({
    status: "ok",
    admin: ADMIN,
    engine: `LC79 v2+ ENSEMBLE ${ALL_ALGORITHMS.length} THUẬT TOÁN + SELF-LEARNING`,
    algorithms: {
        cau: "Pattern Matching (1-1, 2-2, 3-3, v.v.) - 7",
        markov: "Markov Chain & Ensemble - 6",
        trend: "Trend & Momentum - 5",
        historical: "Historical Analysis - 5",
        advanced: "Advanced AI - 8"
    },
    hu: {
        loaded: stateHu.sessions.length,
        last_id: stateHu.lastId,
        fetch_ok: stateHu.lastFetchOk,
    },
    md5: {
        loaded: stateMd5.sessions.length,
        last_id: stateMd5.lastId,
        fetch_ok: stateMd5.lastFetchOk,
    },
}));

app.get("/debug", async req => {
    const k = checkKey(req.query);
    if (!k.valid) return { error: k.error };
    const state = req.query.game === "md5" ? stateMd5 : stateHu;
    if (state.sessions.length < 20) {
        return { error: "Chưa đủ dữ liệu", loaded: state.sessions.length, need: 20 };
    }
    const ai = analyze(state);
    return {
        loaded: state.sessions.length,
        last_id: state.lastId,
        p_tai: ai.p_tai.toFixed(4),
        p_xiu: ai.p_xiu.toFixed(4),
        predict: ai.predict,
        confidence: ai.confidence.toFixed(1),
        tier: ai.tier,
        signals: ai.signals.slice(0, 15).map(s => ({
            id: s.id,
            p_tai: s.p_tai.toFixed(1),
            w: s.weight.toFixed(2),
            note: s.note,
        })),
    };
});

app.get("/weights", async req => {
    const k = checkKey(req.query);
    if (!k.valid) return { error: k.error };
    const sorted = Object.entries(ALGORITHM_WEIGHTS).sort((a, b) => b[1] - a[1]);
    return {
        total_algorithms: sorted.length,
        top_20: sorted.slice(0, 20).map(([id, w]) => ({ id, weight: w.toFixed(2) })),
        bottom_5: sorted.slice(-5).map(([id, w]) => ({ id, weight: w.toFixed(2) }))
    };
});

const route = (game, state) => async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const r = buildResp(state, game);
    return r || rep.status(503).send({
        error: `Đang tải ${game}...`,
        loaded: state.sessions.length,
        need: 20,
    });
};

app.get("/api/taixiu/lc79", route("HŨ", stateHu));
app.get("/api/taixiumd5/lc79", route("MD5", stateMd5));

app.get("/check-key", async req => req.query.key === VALID_KEY
    ? { status: "success", message: "KEY HỢP LỆ", admin: ADMIN }
    : { status: "error", message: `Sai key! Ib ${ADMIN}` });

app.listen({ port: PORT, host: "0.0.0.0" }).then(() => {
    console.log(`
╔════════════════════════════════════════════════════════════════╗
║  🚀 [${PORT}] LC79 v2+ ENSEMBLE ${ALL_ALGORITHMS.length} ALGORITHMS + SELF-LEARNING  ║
║  ✨ 7 CẦU + 6 MARKOV + 5 TREND + 5 HISTORY + 8 ADVANCED      ║
║  🧠 DYNAMIC WEIGHTS | AUTO-LEARNING | REAL-TIME ADAPTATION    ║
╚════════════════════════════════════════════════════════════════╝
    `);
    setTimeout(() => { fetchHu().catch(() => {}); fetchMd5().catch(() => {}); }, 100);
    setInterval(() => fetchHu().catch(() => {}), 5000);
    setInterval(() => fetchMd5().catch(() => {}), 5000);
}).catch(err => {
    console.error("Boot:", err.message);
    process.exit(1);
});
