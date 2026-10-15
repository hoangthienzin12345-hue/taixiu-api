import fastify from "fastify";
import cors from "@fastify/cors";

const PORT      = process.env.PORT || 3000;
const VALID_KEY = "Thiên456";
const ADMIN     = "@ADMNLc79";

const API_URL_HU  = "https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5";
const API_URL_MD5 = "https://wtxmd52.tele68.com/v1/txmd5/sessions";

const clamp = (v, lo = 0.05, hi = 0.95) => Math.max(lo, Math.min(hi, v));
const tail  = (a, n) => a.slice(-n);

function streakLen(seq) {
    if (!seq.length) return [0, ""];
    const L = seq[seq.length - 1];
    let s = 1;
    for (let i = seq.length - 2; i >= 0; i--) { if (seq[i] === L) s++; else break; }
    return [s, L];
}

// ═══════════════════════════════════════════════════════════════════
//  NHÓM A — CẦU (6)
// ═══════════════════════════════════════════════════════════════════
const P1 = c => {
    const w = tail(c.seq, 15);
    if (w.length < 6) return [0.5, 0, "n/a"];
    let alt = 1;
    for (let i = w.length - 1; i >= 1; i--) { if (w[i] !== w[i-1]) alt++; else break; }
    if (alt < 5) return [0.5, 0, `alt=${alt}`];
    const last = w[w.length - 1];
    return [last === "T" ? 0.42 : 0.58, Math.min(2, (alt-3)*0.55), `đảo×${alt}`];
};
const P2 = c => {
    const w = tail(c.seq, 15);
    if (w.length < 8) return [0.5, 0, "n/a"];
    const l8 = w.slice(-8);
    for (let i = 1; i < 8; i++) if (l8[i] === l8[i-1]) return [0.5, 0, "n/a"];
    return [l8[7] === "T" ? 0.42 : 0.58, 1.6, "1-1×8"];
};
const P3 = c => {
    const w = tail(c.seq, 15);
    if (w.length < 8) return [0.5, 0, "n/a"];
    const p8 = w.slice(-8).join("");
    if (p8 === "TTXXTTXX") return [0.58, 1.6, "2-2×4→T"];
    if (p8 === "XXTTXXTT") return [0.42, 1.6, "2-2×4→X"];
    const p4 = w.slice(-4).join("");
    if (p4 === "TTXX") return [0.58, 1.0, "2-2×2→T"];
    if (p4 === "XXTT") return [0.42, 1.0, "2-2×2→X"];
    return [0.5, 0, "n/a"];
};
const P4 = c => {
    const w = tail(c.seq, 15);
    if (w.length < 8) return [0.5, 0, "n/a"];
    const p8 = w.slice(-8).join("");
    if (p8 === "TTTXTTTX") return [0.58, 1.5, "3-1×2→T"];
    if (p8 === "XXXTXXXT") return [0.42, 1.5, "3-1×2→X"];
    const p4 = w.slice(-4).join("");
    if (p4 === "TTTX") return [0.42, 1.0, "3-1 bẻ→X"];
    if (p4 === "XXXT") return [0.58, 1.0, "3-1 bẻ→T"];
    return [0.5, 0, "n/a"];
};
const P5 = c => {
    const w = tail(c.seq, 15);
    if (w.length < 6) return [0.5, 0, "n/a"];
    const p6 = w.slice(-6).join("");
    if (p6 === "TTXTTX") return [0.58, 1.3, "2-1×2→T"];
    if (p6 === "XXTXXT") return [0.42, 1.3, "2-1×2→X"];
    const p3 = w.slice(-3).join("");
    if (p3 === "TTX") return [0.58, 0.9, "2-1→T"];
    if (p3 === "XXT") return [0.42, 0.9, "2-1→X"];
    return [0.5, 0, "n/a"];
};
const P6 = c => {
    const w = tail(c.seq, 15);
    if (w.length < 6) return [0.5, 0, "n/a"];
    const p12 = w.slice(-12).join("");
    if (p12 === "TTTXXXTTTXXX") return [0.58, 1.8, "3-3×2→T"];
    if (p12 === "XXXTTTXXXTTT") return [0.42, 1.8, "3-3×2→X"];
    const p6 = w.slice(-6).join("");
    if (p6 === "TTTXXX") return [0.58, 1.4, "3-3→T"];
    if (p6 === "XXXTTT") return [0.42, 1.4, "3-3→X"];
    return [0.5, 0, "n/a"];
};

// ═══════════════════════════════════════════════════════════════════
//  NHÓM B — MARKOV BẬC 1→10 (10)
// ═══════════════════════════════════════════════════════════════════
function markov(seq, order) {
    if (seq.length < order + 5) return [0.5, 0, `MK${order} short`];
    const ctx = seq.slice(-order).join("");
    let t = 0, x = 0;
    for (let i = 0; i <= seq.length - order - 1; i++) {
        if (seq.slice(i, i + order).join("") === ctx) {
            if (seq[i + order] === "T") t++; else x++;
        }
    }
    const n = t + x;
    if (n < 2) return [0.5, 0, `MK${order} n<2`];
    const p = (t + 0.5) / (n + 1);
    // Bậc cao → weight cao nhưng phải có đủ mẫu
    const w = Math.min(2.5, Math.log2(order + 1) * Math.min(1, n / 8) * 1.2);
    return [p, w, `MK${order} n=${n} T${t}/X${x}`];
}
const MK1  = c => markov(c.seq, 1);
const MK2  = c => markov(c.seq, 2);
const MK3  = c => markov(c.seq, 3);
const MK4  = c => markov(c.seq, 4);
const MK5  = c => markov(c.seq, 5);
const MK6  = c => markov(c.seq, 6);
const MK7  = c => markov(c.seq, 7);
const MK8  = c => markov(c.seq, 8);
const MK9  = c => markov(c.seq, 9);
const MK10 = c => markov(c.seq, 10);

// ═══════════════════════════════════════════════════════════════════
//  NHÓM C — NÂNG CAO (6)
// ═══════════════════════════════════════════════════════════════════

// R1 — Random Ensemble (KNN quét mẫu 5-window tương tự)
const R1 = c => {
    const seq = c.seq;
    if (seq.length < 30) return [0.5, 0, "n/a"];
    const query = seq.slice(-5);
    let tV = 0, xV = 0, matches = 0;
    for (let i = 0; i <= seq.length - 6; i++) {
        let score = 0;
        for (let j = 0; j < 5; j++) if (seq[i + j] === query[j]) score++;
        if (score >= 4) {
            matches++;
            if (seq[i + 5] === "T") tV++; else xV++;
        }
    }
    if (matches < 3) return [0.5, 0, `RND n=${matches}`];
    const p = (tV + 0.5) / (tV + xV + 1);
    return [p, Math.min(2, matches / 3), `RND n=${matches} T${tV}/X${xV}`];
};

// CYC — Lặp chu kỳ (tìm chu kỳ P tốt nhất 2-15)
const CYC = c => {
    const seq = c.seq;
    if (seq.length < 30) return [0.5, 0, "n/a"];
    let bestP = 0, bestScore = 0;
    for (let P = 2; P <= 15; P++) {
        let m = 0, t = 0;
        for (let i = P; i < seq.length; i++) {
            t++;
            if (seq[i] === seq[i - P]) m++;
        }
        const score = m / t;
        if (score > bestScore) { bestScore = score; bestP = P; }
    }
    if (bestScore < 0.6) return [0.5, 0, `CYC none ${(bestScore*100).toFixed(0)}%`];
    const ref = seq[seq.length - bestP];
    const w = Math.min(2.2, (bestScore - 0.5) * 6);
    return [ref === "T" ? 0.55 : 0.45, w, `CYC P=${bestP} ${(bestScore*100).toFixed(0)}%`];
};

// BLK — Lặp Block (block dài L lặp lại ≥2 lần)
const BLK = c => {
    const seq = c.seq;
    if (seq.length < 12) return [0.5, 0, "n/a"];
    for (let L = 3; L <= 8; L++) {
        if (seq.length < L * 2) continue;
        const b1 = seq.slice(-L).join("");
        const b2 = seq.slice(-2*L, -L).join("");
        if (b1 !== b2) continue;
        if (seq.length >= L * 3) {
            const b3 = seq.slice(-3*L, -2*L).join("");
            if (b2 === b3) {
                const ref = seq[seq.length - L];
                return [ref === "T" ? 0.58 : 0.42, 2.0, `BLK×3 L=${L}`];
            }
        }
        const ref = seq[seq.length - L];
        return [ref === "T" ? 0.56 : 0.44, 1.5, `BLK×2 L=${L}`];
    }
    return [0.5, 0, "n/a"];
};

// CMP — So sánh 15 phiên gần vs 15 phiên trước
const CMP = c => {
    const seq = c.seq;
    if (seq.length < 30) return [0.5, 0, "n/a"];
    const recent = seq.slice(-15);
    const prev   = seq.slice(-30, -15);
    let same = 0;
    for (let i = 0; i < 15; i++) if (recent[i] === prev[i]) same++;
    const ref = seq[seq.length - 16]; // kết quả nối tiếp khối prev
    if (same >= 10) return [ref === "T" ? 0.55 : 0.45, 1.3, `CMP~ ${same}/15`];
    if (same <= 5)  return [ref === "T" ? 0.45 : 0.55, 1.3, `CMP≠ ${same}/15`];
    return [0.5, 0, `CMP ${same}/15`];
};

// XV — Cross-validation Markov (đồng thuận bậc 1-5)
const XV = c => {
    const preds = [];
    for (let o = 1; o <= 5; o++) {
        const r = markov(c.seq, o);
        if (r[1] > 0) preds.push(r[0]);
    }
    if (preds.length < 3) return [0.5, 0, `XV n/a`];
    const avg = preds.reduce((a, b) => a + b) / preds.length;
    const std = Math.sqrt(preds.reduce((a, b) => a + (b - avg) ** 2, 0) / preds.length);
    const agree = 1 - Math.min(1, std * 4);
    return [avg, agree * 2, `XV ${preds.length} σ=${std.toFixed(2)}`];
};

// META — Meta ensemble (các thuật toán lõi mạnh nhất)
const META = c => {
    const parts = [P1(c), P2(c), P4(c), BLK(c), CYC(c), MK3(c), MK5(c)];
    const act = parts.filter(r => r[1] > 0);
    if (!act.length) return [0.5, 0, "META n/a"];
    let num = 0, den = 0;
    for (const r of act) { num += r[0] * r[1]; den += r[1]; }
    return [num / den, 1.8, `META n=${act.length}`];
};

// ═══════════════════════════════════════════════════════════════════
//  22 MODULE REGISTRY
// ═══════════════════════════════════════════════════════════════════
const MODULES = [
    // Cầu (6)
    ["P1", P1], ["P2", P2], ["P3", P3], ["P4", P4], ["P5", P5], ["P6", P6],
    // Markov (10)
    ["MK1", MK1], ["MK2", MK2], ["MK3", MK3], ["MK4", MK4], ["MK5", MK5],
    ["MK6", MK6], ["MK7", MK7], ["MK8", MK8], ["MK9", MK9], ["MK10", MK10],
    // Nâng cao (6)
    ["R1", R1], ["CYC", CYC], ["BLK", BLK], ["CMP", CMP], ["XV", XV], ["META", META],
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
//  ANALYZE — 22 module + Anti-All + Fallback
// ═══════════════════════════════════════════════════════════════════
function analyze(state) {
    const sessions = state.sessions;
    if (sessions.length < 15) return null;
    const seq = sessions.map(s => s.result === "TAI" ? "T" : "X");
    const ctx = { seq, sessions, state };

    const signals = [];
    for (const [id, fn] of MODULES) {
        try {
            const [p, w, note] = fn(ctx);
            signals.push({ id, p_tai: clamp(p, 0.05, 0.95) * 100, w: +w.toFixed(2), note });
        } catch { signals.push({ id, p_tai: 50, w: 0, note: "err" }); }
    }

    const active = signals.filter(s => s.w > 0);
    const [streak, last] = streakLen(seq);
    const w15 = seq.slice(-15);
    const allSame15 = w15.length === 15 && w15.every(x => x === w15[0]);

    let pTai, tier, note, matchNames;

    // ── ƯU TIÊN 1: 15 phiên toàn 1 phía → đảo bệt
    if (allSame15) {
        pTai = w15[0] === "T" ? 0.35 : 0.65;
        tier = "STRONG";
        note = `Đảo bệt ${w15[0]}×15`;
        matchNames = "ANTI_ALL";
    }
    // ── ƯU TIÊN 2: ensemble có trọng số
    else if (active.length > 0) {
        let num = 0, den = 0;
        for (const s of active) { num += s.p_tai * s.w; den += s.w; }
        pTai = den ? num / den / 100 : 0.5;
        const predict = pTai >= 0.5 ? "TAI" : "XIU";
        const agree = active.filter(s => (s.p_tai >= 50) === (predict === "TAI")).length / active.length * 100;
        const conf = Math.max(pTai, 1 - pTai) * 100;
        if (conf >= 60 && agree >= 70 && active.length >= 5) tier = "STRONG";
        else if (conf >= 55 && agree >= 55)                 tier = "OK";
        else if (active.length <= 2)                        tier = "SINGLE";
        else                                                tier = "SPLIT";
        note = `${active.length} alg · ${agree.toFixed(0)}% agree`;
        // top 4 match
        matchNames = active.slice().sort((a, b) => b.w - a.w).slice(0, 4).map(s => s.id).join(",");
    }
    // ── ƯU TIÊN 3: streak >= 4 không có signal
    else if (streak >= 4) {
        pTai = last === "T" ? 0.35 : 0.65;
        tier = streak >= 7 ? "STRONG" : streak >= 5 ? "OK" : "SINGLE";
        note = `Đảo bệt ${last}×${streak}`;
        matchNames = "REVERSAL";
    }
    // ── Fallback
    else {
        pTai = 0.5;
        tier = "NO_PATTERN";
        note = "Không có pattern";
        matchNames = "none";
    }

    const predict = pTai >= 0.5 ? "TAI" : "XIU";
    const conf    = Math.max(pTai, 1 - pTai) * 100;

    // Wilson
    const h = state.history.slice(-100);
    let wilson = 0;
    if (h.length >= 20) {
        const wins = h.filter(x => x.result === "WIN").length;
        const ph = wins / h.length, z = 1.96, d = 1 + z*z/h.length;
        const ctr = (ph + z*z/(2*h.length)) / d;
        const mg  = z * Math.sqrt(ph*(1-ph)/h.length + z*z/(4*h.length*h.length)) / d;
        wilson = Math.max(0, ctr - mg) * 100;
    }

    return {
        predict, confidence: conf, tier,
        p_tai: pTai * 100, p_xiu: (1 - pTai) * 100,
        wilson, streak, last,
        last15: seq.slice(-15).join(""),
        matchNames, note, activeCount: active.length,
        topSignals: active.slice().sort((a, b) => b.w - a.w).slice(0, 6)
            .map(s => `${s.id}:${s.p_tai.toFixed(0)}%×${s.w}`),
    };
}

// ═══════════════════════════════════════════════════════════════════
//  PARSE — dùng point, KHÔNG dựa string field
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
        result: it.point >= 11 ? "TAI" : "XIU",
        result_vn: it.point >= 11 ? "Tài" : "Xỉu",
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
    if (state.sessions.length < 15) return null;
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
    if (state.sessions.length < 15) return null;
    const ai = getPrediction(state);
    if (!ai) return null;
    const last = state.sessions[state.sessions.length - 1];

    return {
        id: ADMIN,
        game,
        phien: last.id + 1,
        du_doan: ai.predict === "TAI" ? "tài" : "xỉu",
        do_tin_cay: `${ai.confidence.toFixed(1)}%`,
        ly_do: `[${ai.tier}] ${ai.note}`,
        last15: ai.last15,
        vua_qua: state.sessions.slice(-5).reverse().map(v => v.point),
        ai: {
            tier: ai.tier,
            p_tai: +ai.p_tai.toFixed(1),
            p_xiu: +ai.p_xiu.toFixed(1),
            match: ai.matchNames,
            active: `${ai.activeCount}/22`,
            wilson: +ai.wilson.toFixed(1),
            streak: `${ai.streak}${ai.last}`,
            top: ai.topSignals,
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
    engine: "LC79 v14 — 22 THUẬT TOÁN",
    groups: {
        cau:     "P1-P6 (Đảo thuận · 1-1 · 2-2 · 3-1 · 2-1 · 3-3)",
        markov:  "MK1→MK10 (bậc 1 đến 10)",
        nangcao: "R1 Random Ensemble · CYC chu kỳ · BLK block · CMP so sánh · XV cross-val · META meta",
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
    console.log(`🚀 [${PORT}] LC79 v14 · 22 modules online`);
    setTimeout(() => { fetchHu().catch(() => {}); fetchMd5().catch(() => {}); }, 100);
    setInterval(() => fetchHu().catch(() => {}),  6000);
    setInterval(() => fetchMd5().catch(() => {}), 6000);
}).catch(err => { console.error("Boot:", err.message); process.exit(1); });