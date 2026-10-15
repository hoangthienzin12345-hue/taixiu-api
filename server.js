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

function streakLen(seq) {
    if (!seq.length) return [0, ""];
    const L = seq[seq.length - 1];
    let s = 1;
    for (let i = seq.length - 2; i >= 0; i--) { if (seq[i] === L) s++; else break; }
    return [s, L];
}

// Markov bậc o dùng chung cho N4/N5/N6
function mkv(seq, o) {
    if (seq.length < o + 5) return [0.5, 0, "n/a"];
    const ctx = seq.slice(-o).join("");
    let t = 0, x = 0;
    for (let i = 0; i < seq.length - o; i++) {
        if (seq.slice(i, i + o).join("") === ctx) {
            if (seq[i + o] === "T") t++; else x++;
        }
    }
    if (t + x < 3) return [0.5, 0, `o${o} n/a`];
    return [(t + 0.5) / (t + x + 1), Math.min(2, (t + x) / 5), `o${o} n${t + x}`];
}

// Tổng điểm 3 phiên gần nhất
function sum3(c) {
    const s = c.sessions;
    if (s.length < 3) return null;
    return s[s.length - 1].point + s[s.length - 2].point + s[s.length - 3].point;
}

// ═══════════════════════════════════════════════════════════════════
//  NHÓM 1 — CẦU  (6 thuật toán)
// ═══════════════════════════════════════════════════════════════════

// N1 — Cầu bệt (Streak Follow): theo bệt khi chưa tới ngưỡng đảo
const N1 = c => {
    const [s, last] = streakLen(c.seq);
    if (s >= 4) return [0.5, 0, `bệt ${last}×${s}→đảo`];
    const p = last === "T" ? 0.56 : 0.44;
    return [p, 1.0, `bệt ${last}×${s}`];
};

// N2 — Cầu đảo (Reversal): streak ≥ 4 kỳ vọng bẻ
const N2 = c => {
    const [s, last] = streakLen(c.seq);
    if (s < 4) return [0.5, 0, `s=${s}`];
    const p = last === "T" ? 0.40 : 0.60;
    return [p, Math.min(2.5, (s - 2) * 0.6), `đảo ${last}×${s}`];
};

// N3 — Cầu 2-2 / 3-3 + nhận diện bẻ cầu
const N3 = c => {
    const w = tail(c.seq, 8).join("");
    const pats = [
        { p: "TTXX", b: "T" }, { p: "XXTT", b: "X" },
        { p: "TTTXXX", b: "T" }, { p: "XXXTTT", b: "X" },
    ];
    for (const { p, b } of pats) {
        if (w.endsWith(p)) {
            const next = b === "T" ? 0.60 : 0.40;
            return [next, 1.2, `2-2/3-3 ${p}`];
        }
    }
    const s5 = tail(c.seq, 5).join("");
    if (s5 === "TXXXT") return [0.60, 1.0, "bẻ XIU→TAI"];
    if (s5 === "XTTTX") return [0.40, 1.0, "bẻ TAI→XIU"];
    return [0.5, 0, "n/a"];
};

// N4 — Markov bậc 1
const N4 = c => mkv(c.seq, 1);

// N5 — Markov bậc 2
const N5 = c => mkv(c.seq, 2);

// N6 — Markov bậc 3 (weight ×1.8 — tín hiệu mạnh)
const N6 = c => {
    const r = mkv(c.seq, 3);
    return [r[0], r[1] * 1.8, r[2]];
};

// ═══════════════════════════════════════════════════════════════════
//  NHÓM 2 — TỔNG ĐIỂM 3 PHIÊN  (6 thuật toán)
// ═══════════════════════════════════════════════════════════════════

// N7 — Ngưỡng tuyệt đối Sum3: ≤24 TAI · ≥33 XIU
const N7 = c => {
    const s3 = sum3(c);
    if (s3 === null) return [0.5, 0, "n/a"];
    if (s3 <= 24) return [0.62, 1.5, `S3=${s3} thấp`];
    if (s3 >= 33) return [0.38, 1.5, `S3=${s3} cao`];
    return [0.5 + (31.5 - s3) * 0.01, 0.6, `S3=${s3}`];
};

// N8 — Sum3 vs MA10
const N8 = c => {
    const s3 = sum3(c);
    if (s3 === null) return [0.5, 0, "n/a"];
    const pts = c.sessions.slice(-10).map(x => x.point);
    if (pts.length < 10) return [0.5, 0, "n/a"];
    const avg3 = s3 / 3;
    const ma10avg = pts.reduce((a, b) => a + b, 0) / 10;
    if (avg3 < ma10avg - 0.3) return [0.56, 1.0, `S3<MA10`];
    if (avg3 > ma10avg + 0.3) return [0.44, 1.0, `S3>MA10`];
    return [0.5, 0, "≈"];
};

// N9 — Xu hướng Sum3 (5 cửa sổ gần nhất)
const N9 = c => {
    const s = c.sessions;
    if (s.length < 7) return [0.5, 0, "n/a"];
    const sums = [];
    for (let i = 4; i >= 0; i--) {
        sums.push(s[s.length - 1 - i].point + s[s.length - 2 - i].point + s[s.length - 3 - i].point);
    }
    const slope = sums[4] - sums[0];
    if (slope > 3) return [0.58, 1.2, `S3↑${slope}`];
    if (slope < -3) return [0.42, 1.2, `S3↓${slope}`];
    return [0.5, 0, "flat"];
};

// N10 — Chẵn/Lẻ Sum3 (không tương quan → neutral)
const N10 = c => {
    const s3 = sum3(c);
    if (s3 === null) return [0.5, 0, "n/a"];
    return [0.5, 0, s3 % 2 ? "lẻ" : "chẵn"];
};

// N11 — Mean Reversion vs 10.5
const N11 = c => {
    const s3 = sum3(c);
    if (s3 === null) return [0.5, 0, "n/a"];
    const avg = s3 / 3;
    if (avg < 10.5) return [0.55, 1.0, `avg=${avg.toFixed(1)}<10.5`];
    if (avg > 10.5) return [0.45, 1.0, `avg=${avg.toFixed(1)}>10.5`];
    return [0.5, 0, "="];
};

// N12 — Z-Score điểm phiên mới nhất
const N12 = c => {
    const s = c.sessions.slice(-50);
    if (s.length < 20) return [0.5, 0, "n/a"];
    const pts = s.map(x => x.point);
    const m = pts.reduce((a, b) => a + b, 0) / pts.length;
    const v = pts.reduce((a, b) => a + (b - m) ** 2, 0) / pts.length;
    const sd = Math.sqrt(v) || 1;
    const last = c.sessions[c.sessions.length - 1].point;
    const z = (last - m) / sd;
    if (z >= 1.5) return [0.42, 1.0, `z=+${z.toFixed(2)}`];
    if (z <= -1.5) return [0.58, 1.0, `z=${z.toFixed(2)}`];
    return [0.5, 0.3, `z=${z.toFixed(2)}`];
};

// ═══════════════════════════════════════════════════════════════════
//  NHÓM 3 — ENSEMBLE KẾT HỢP  (6 thuật toán)
// ═══════════════════════════════════════════════════════════════════

// N13 — MA5 vs MA10 (điểm trung bình)
const N13 = c => {
    const s = c.sessions;
    if (s.length < 10) return [0.5, 0, "n/a"];
    const ma5  = s.slice(-5).map(x => x.point).reduce((a, b) => a + b, 0) / 5;
    const ma10 = s.slice(-10).map(x => x.point).reduce((a, b) => a + b, 0) / 10;
    if (ma5 < ma10 - 0.2) return [0.56, 1.0, `MA5<MA10`];
    if (ma5 > ma10 + 0.2) return [0.44, 1.0, `MA5>MA10`];
    return [0.5, 0, "≈"];
};

// N14 — RSI 14 phiên (overbought/oversold theo tần suất TAI)
const N14 = c => {
    const w = tail(c.seq, 14);
    if (w.length < 14) return [0.5, 0, "n/a"];
    const rsi = cnt(w, "T") / w.length * 100;
    if (rsi >= 71) return [0.42, 1.5, `RSI=${rsi.toFixed(0)} quá mua`];
    if (rsi <= 29) return [0.58, 1.5, `RSI=${rsi.toFixed(0)} quá bán`];
    return [0.5, 0, `RSI=${rsi.toFixed(0)}`];
};

// N15 — Bollinger Band (20 phiên)
const N15 = c => {
    const s = c.sessions.slice(-20);
    if (s.length < 20) return [0.5, 0, "n/a"];
    const pts = s.map(x => x.point);
    const m = pts.reduce((a, b) => a + b, 0) / 20;
    const v = pts.reduce((a, b) => a + (b - m) ** 2, 0) / 20;
    const sd = Math.sqrt(v);
    const last = c.sessions[c.sessions.length - 1].point;
    if (last >= m + 2 * sd) return [0.42, 1.0, "trên BB"];
    if (last <= m - 2 * sd) return [0.58, 1.0, "dưới BB"];
    return [0.5, 0.3, "giữa BB"];
};

// N16 — Cân bằng tần suất 20 phiên (chống nghiêng lệch)
const N16 = c => {
    const w = tail(c.seq, 20);
    if (w.length < 20) return [0.5, 0, "n/a"];
    const p = cnt(w, "T") / w.length;
    const dev = p - 0.5;
    if (Math.abs(dev) > 0.15) {
        return [clamp(0.5 - dev * 0.8), 2.0, `lệch ${(dev * 100).toFixed(0)}%`];
    }
    return [0.5, 0, `cb ${(p * 100).toFixed(0)}%`];
};

// N17 — Momentum (ROC Sum3)
const N17 = c => {
    const s = c.sessions;
    if (s.length < 6) return [0.5, 0, "n/a"];
    const cur  = s[s.length - 1].point + s[s.length - 2].point + s[s.length - 3].point;
    const prev = s[s.length - 2].point + s[s.length - 3].point + s[s.length - 4].point;
    const delta = cur - prev;
    if (delta >= 3)  return [0.57, 1.0, `Δ=+${delta}`];
    if (delta <= -3) return [0.43, 1.0, `Δ=${delta}`];
    return [0.5, 0, `Δ=${delta}`];
};

// N18 — Meta-Ensemble mini: Markov3 + RSI14 + Freq20
const N18 = c => {
    const m3 = N6(c), rsi = N14(c), fr = N16(c);
    const totalW = m3[1] + rsi[1] + fr[1];
    if (!totalW) return [0.5, 0, "meta n/a"];
    const p = (m3[0] * m3[1] + rsi[0] * rsi[1] + fr[0] * fr[1]) / totalW;
    return [clamp(p), 1.5, "meta3"];
};

// ═══════════════════════════════════════════════════════════════════
//  18 MODULE REGISTRY
// ═══════════════════════════════════════════════════════════════════
const MODULES = [
    // Nhóm 1 — Cầu (6)
    ["N1", N1], ["N2", N2], ["N3", N3], ["N4", N4], ["N5", N5], ["N6", N6],
    // Nhóm 2 — Tổng điểm 3 phiên (6)
    ["N7", N7], ["N8", N8], ["N9", N9], ["N10", N10], ["N11", N11], ["N12", N12],
    // Nhóm 3 — Ensemble kết hợp (6)
    ["N13", N13], ["N14", N14], ["N15", N15], ["N16", N16], ["N17", N17], ["N18", N18],
];

// ═══════════════════════════════════════════════════════════════════
//  FETCH
// ═══════════════════════════════════════════════════════════════════
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
//  ANALYZE — chạy 18 module + ensemble có trọng số
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
            signals.push({ id, p_tai: clamp(p, 0.05, 0.95) * 100, w, note });
        } catch (e) {
            signals.push({ id, p_tai: 50, w: 0, note: "err" });
        }
    }

    // Ensemble có trọng số
    let num = 0, den = 0;
    for (const s of signals) { num += s.p_tai * s.w; den += s.w; }
    const pTai = den ? num / den / 100 : 0.5;

    // Agreement + Tier
    const active = signals.filter(s => s.w > 0);
    const predict = pTai >= 0.5 ? "TAI" : "XIU";
    const agree = active.length
        ? active.filter(s => (s.p_tai >= 50) === (predict === "TAI")).length / active.length * 100
        : 50;
    const conf = Math.max(pTai, 1 - pTai) * 100;

    let tier = "WEAK";
    if (conf >= 57 && agree >= 65) tier = "STRONG";
    else if (conf >= 53 && agree >= 55) tier = "OK";
    else if (agree < 40) tier = "SPLIT";

    // Wilson lower bound từ lịch sử thắng
    const h = state.history.slice(-100);
    let wilson = 0;
    if (h.length >= 20) {
        const wins = h.filter(x => x.result === "WIN").length;
        const ph = wins / h.length, z = 1.96, d = 1 + z * z / h.length;
        const ctr = (ph + z * z / (2 * h.length)) / d;
        const mg = z * Math.sqrt(ph * (1 - ph) / h.length + z * z / (4 * h.length * h.length)) / d;
        wilson = Math.max(0, ctr - mg) * 100;
    }

    const [streak, last] = streakLen(seq);
    const s3 = sum3(ctx);

    return {
        predict, confidence: conf, tier, agreement: agree, wilson,
        p_tai: pTai * 100, p_xiu: (1 - pTai) * 100,
        streak, last, sum3: s3, signals,
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
function mkState() {
    return { sessions: [], lastId: null, history: [], lastPred: null, lastFetchAt: 0 };
}
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

async function fetchHu()  { try { updateState(stateHu,  parseHu(await fetchJSON(API_URL_HU)));   stateHu.lastFetchAt  = Date.now(); } catch (e) { console.error("HU:",  e.message); } }
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
//  BUILD RESPONSE
// ═══════════════════════════════════════════════════════════════════
function buildResp(state, game) {
    if (state.sessions.length < 30) return null;
    const ai = getPrediction(state);
    if (!ai) return null;
    const last = state.sessions[state.sessions.length - 1];
    const topSig = ai.signals.slice().sort((a, b) => b.w - a.w).slice(0, 10)
        .map(s => `${s.id}:${s.p_tai.toFixed(0)}%×${s.w.toFixed(1)}`).join(" | ");

    return {
        Id: ADMIN, Game: game,
        Phien_truoc: last.id,
        Xuc_xac: `${last.dices[0]} - ${last.dices[1]} - ${last.dices[2]}`,
        Ket_qua: last.result_vn.toLowerCase(),
        Tong: last.point,
        Sum3: ai.sum3,
        Phien_nay: last.id + 1,
        Du_doan: ai.predict === "TAI" ? "tài" : "xỉu",
        Do_tin_cay: `${ai.confidence.toFixed(1)}%`,
        Ly_do: `Tier ${ai.tier} · Agree ${ai.agreement.toFixed(0)}% · Wilson ${ai.wilson.toFixed(1)}%`,
        Biet_hien_tai: `${ai.streak} ${ai.last}`,
        Nguon_cau: `18 modules (Cầu / Sum3 / Ensemble) · top: ${topSig}`,
        AI: {
            tier: ai.tier,
            p_tai: +ai.p_tai.toFixed(2), p_xiu: +ai.p_xiu.toFixed(2),
            wilson: +ai.wilson.toFixed(2), agreement: +ai.agreement.toFixed(1),
            sum3: ai.sum3,
            signals: ai.signals.map(s => ({ id: s.id, p_tai: +s.p_tai.toFixed(1), w: +s.w.toFixed(2), note: s.note })),
        },
        "5_van_gan_nhat": state.sessions.slice(-5).reverse().map((v, i) => ({
            stt: i + 1, result: v.result_vn, total: v.point,
            dice: `${v.dices[0]}-${v.dices[1]}-${v.dices[2]}`,
        })),
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
    engine: "LC79 v9 — 18 THUẬT TOÁN / 3 NHÓM ENSEMBLE",
    groups: {
        "1_Cau":                "Cầu bệt · Cầu đảo · 2-2/3-3 · Markov 1 · Markov 2 · Markov 3  (6)",
        "2_Tong_diem_3_phien":  "Ngưỡng Sum3 · Sum3 vs MA10 · Xu hướng Sum3 · Chẵn/Lẻ · Mean Rev · Z-Score  (6)",
        "3_Ensemble_ket_hop":   "MA5/10 · RSI14 · Bollinger · Freq20 · Momentum · Meta3  (6)",
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
app.get("/api/taixiu/lc79",    route("HŨ",  stateHu));
app.get("/api/taixiumd5/lc79", route("MD5", stateMd5));

app.get("/api/taixiu/lc79/history", async (req, rep) => {
    const k = checkKey(req.query); if (!k.valid) return rep.status(401).send({ error: k.error });
    return stateHu.sessions.slice(-30).reverse().map(i => ({ session: i.id, dice: i.dices, total: i.point, result: i.result_vn.toLowerCase() }));
});
app.get("/api/taixiumd5/lc79/history", async (req, rep) => {
    const k = checkKey(req.query); if (!k.valid) return rep.status(401).send({ error: k.error });
    return stateMd5.sessions.slice(-30).reverse().map(i => ({ session: i.id, dice: i.dices, total: i.point, result: i.result_vn.toLowerCase() }));
});

app.get("/api/taixiu/lc79/ai-history", async (req, rep) => {
    const k = checkKey(req.query); if (!k.valid) return rep.status(401).send({ error: k.error });
    const wins = stateHu.history.filter(x => x.result === "WIN").length, tot = stateHu.history.length;
    return { total: tot, wins, loses: tot - wins, winrate: tot ? (wins / tot * 100).toFixed(2) + "%" : "N/A", recent: stateHu.history.slice(-30).reverse() };
});

app.get("/check-key", async req => req.query.key === VALID_KEY
    ? { status: "success", message: "KEY HỢP LỆ", admin: ADMIN }
    : { status: "error", message: `Sai key! Ib ${ADMIN}` });

app.listen({ port: PORT, host: "0.0.0.0" }).then(() => {
    console.log(`🚀 [${PORT}] LC79 v9 · 18 modules online`);
    setTimeout(() => { fetchHu().catch(() => {}); fetchMd5().catch(() => {}); }, 100);
    setInterval(() => fetchHu().catch(() => {}),  6000);
    setInterval(() => fetchMd5().catch(() => {}), 6000);
}).catch(err => { console.error("Boot:", err.message); process.exit(1); });
