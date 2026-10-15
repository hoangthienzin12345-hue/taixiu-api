import fastify from "fastify";
import cors from "@fastify/cors";

const PORT      = process.env.PORT || 3000;
const VALID_KEY = "Thiên456";
const ADMIN     = "@ADMNLc79";

const API_URL_HU  = "https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5";
const API_URL_MD5 = "https://wtxmd52.tele68.com/v1/txmd5/sessions";

// ═══════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════
const clamp = (v, lo = 0.05, hi = 0.95) => Math.max(lo, Math.min(hi, v));
const tail  = (a, n) => a.slice(-n);

// ═══════════════════════════════════════════════════════════════════
//  6 THUẬT TOÁN CẦU — PHÂN TÍCH 15 PHIÊN GẦN NHẤT
// ═══════════════════════════════════════════════════════════════════

// P1 — ĐẢO THUẬN: chuỗi T-X-T-X-... dài ≥5 → tiếp tục đảo (ngược last)
const P1 = c => {
    const w = tail(c.seq, 15);
    if (w.length < 6) return [0.5, 0, "n/a"];
    let alt = 1;
    for (let i = w.length - 1; i >= 1; i--) {
        if (w[i] !== w[i - 1]) alt++; else break;
    }
    if (alt < 5) return [0.5, 0, `alt=${alt}`];
    const last = w[w.length - 1];
    return [last === "T" ? 0.42 : 0.58, Math.min(2, (alt - 3) * 0.55), `đảo×${alt}`];
};

// P2 — CẦU 1-1: 8 phiên cuối là TXTXTXTX (đảo đều hoàn hảo)
const P2 = c => {
    const w = tail(c.seq, 15);
    if (w.length < 8) return [0.5, 0, "n/a"];
    const last8 = w.slice(-8);
    for (let i = 1; i < 8; i++) if (last8[i] === last8[i - 1]) return [0.5, 0, "n/a"];
    const last = last8[7];
    return [last === "T" ? 0.42 : 0.58, 1.6, "1-1×8"];
};

// P3 — CẦU 2-2: TTXXTTXX (→T) hoặc XXTTXXTT (→X)
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

// P4 — CẦU 3-1: TTTXTTTX (→T) hoặc XXXTXXXT (→X)
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

// P5 — CẦU 2-1: TTXTTX (→T) hoặc XXTXXT (→X)
const P5 = c => {
    const w = tail(c.seq, 15);
    if (w.length < 6) return [0.5, 0, "n/a"];
    const p6 = w.slice(-6).join("");
    if (p6 === "TTXTTX") return [0.58, 1.3, "2-1×2→T"];
    if (p6 === "XXTXXT") return [0.42, 1.3, "2-1×2→X"];
    const p3 = w.slice(-3).join("");
    if (p3 === "TTX") return [0.58, 0.9, "2-1×1→T"];
    if (p3 === "XXT") return [0.42, 0.9, "2-1×1→X"];
    return [0.5, 0, "n/a"];
};

// P6 — CẦU 3-3: TTTXXX (→T) hoặc XXXTTT (→X)
const P6 = c => {
    const w = tail(c.seq, 15);
    if (w.length < 6) return [0.5, 0, "n/a"];
    const p12 = w.slice(-12).join("");
    if (p12 === "TTTXXXTTTXXX") return [0.58, 1.8, "3-3×2→T"];
    if (p12 === "XXXTTTXXXTTT") return [0.42, 1.8, "3-3×2→X"];
    const p6 = w.slice(-6).join("");
    if (p6 === "TTTXXX") return [0.58, 1.4, "3-3×1→T"];
    if (p6 === "XXXTTT") return [0.42, 1.4, "3-3×1→X"];
    return [0.5, 0, "n/a"];
};

const MODULES = [
    ["P1_ĐảoThuận", P1],
    ["P2_Cầu1-1",   P2],
    ["P3_Cầu2-2",   P3],
    ["P4_Cầu3-1",   P4],
    ["P5_Cầu2-1",   P5],
    ["P6_Cầu3-3",   P6],
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
//  ANALYZE — chạy 6 module cầu
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
            signals.push({ id, p_tai: clamp(p, 0.05, 0.95) * 100, w, note });
        } catch (e) {
            signals.push({ id, p_tai: 50, w: 0, note: "err" });
        }
    }

    // Ensemble có trọng số — CHỈ tính các pattern có match (w > 0)
    const matched = signals.filter(s => s.w > 0);

    let pTai = 0.5, verdict = "NEUTRAL", matchedNames = [];
    if (matched.length === 0) {
        // Không pattern nào match → dựa vào phiên cuối đảo nhẹ (fallback 50/50)
        verdict = "NO_PATTERN";
    } else {
        let num = 0, den = 0;
        for (const s of matched) { num += s.p_tai * s.w; den += s.w; }
        pTai = den ? num / den / 100 : 0.5;
        verdict = "MATCHED";
        matchedNames = matched.map(s => s.id);
    }

    const predict = pTai >= 0.5 ? "TAI" : "XIU";
    const conf = Math.max(pTai, 1 - pTai) * 100;

    // Agreement trên các pattern match
    const agree = matched.length
        ? matched.filter(s => (s.p_tai >= 50) === (predict === "TAI")).length / matched.length * 100
        : 0;

    // Tier
    let tier = "WEAK";
    if (matched.length === 0) tier = "NO_PATTERN";
    else if (matched.length === 1) tier = "SINGLE";
    else if (conf >= 57 && agree >= 65) tier = "STRONG";
    else if (conf >= 53 && agree >= 55) tier = "OK";
    else if (agree < 40) tier = "SPLIT";

    // Wilson từ lịch sử thắng
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
    const last15 = seq.slice(-15);

    return {
        predict, confidence: conf, tier, agreement: agree, wilson,
        p_tai: pTai * 100, p_xiu: (1 - pTai) * 100,
        streak, last, last15: last15.join(""),
        matchedCount: matched.length,
        matchedNames: matchedNames.join(","),
        signals,
    };
}

function streakLen(seq) {
    if (!seq.length) return [0, ""];
    const L = seq[seq.length - 1];
    let s = 1;
    for (let i = seq.length - 2; i >= 0; i--) { if (seq[i] === L) s++; else break; }
    return [s, L];
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
    const topSig = ai.signals.slice().sort((a, b) => b.w - a.w)
        .map(s => `${s.id}:${s.p_tai.toFixed(0)}%×${s.w.toFixed(1)}`).join(" | ");

    return {
        Id: ADMIN, Game: game,
        Phien_truoc: last.id,
        Xuc_xac: `${last.dices[0]} - ${last.dices[1]} - ${last.dices[2]}`,
        Ket_qua: last.result_vn.toLowerCase(),
        Tong: last.point,
        Phien_nay: last.id + 1,
        Du_doan: ai.predict === "TAI" ? "tài" : "xỉu",
        Do_tin_cay: `${ai.confidence.toFixed(1)}%`,
        Ly_do: `Tier ${ai.tier} · Match ${ai.matchedCount}/6 (${ai.matchedNames || "none"}) · Agree ${ai.agreement.toFixed(0)}% · Wilson ${ai.wilson.toFixed(1)}%`,
        Biet_hien_tai: `${ai.streak} ${ai.last}`,
        Last15: ai.last15,
        Nguon_cau: `6 patterns × 15 phiên · ${topSig}`,
        AI: {
            tier: ai.tier,
            p_tai: +ai.p_tai.toFixed(2), p_xiu: +ai.p_xiu.toFixed(2),
            wilson: +ai.wilson.toFixed(2), agreement: +ai.agreement.toFixed(1),
            matched_count: ai.matchedCount,
            matched: ai.matchedNames || "none",
            last15: ai.last15,
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
    engine: "LC79 v11 — 6 PATTERNS × 15 PHIÊN",
    patterns: {
        P1: "Đảo thuận (T-X-T-X ≥5 nhịp)",
        P2: "Cầu 1-1 (TXTXTXTX)",
        P3: "Cầu 2-2 (TTXXTTXX / XXTTXXTT)",
        P4: "Cầu 3-1 (TTTXTTTX / XXXTXXXT)",
        P5: "Cầu 2-1 (TTXTTX / XXTXXT)",
        P6: "Cầu 3-3 (TTTXXX / XXXTTT)",
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
    console.log(`🚀 [${PORT}] LC79 v11 · 6 patterns × 15 phiên online`);
    setTimeout(() => { fetchHu().catch(() => {}); fetchMd5().catch(() => {}); }, 100);
    setInterval(() => fetchHu().catch(() => {}),  6000);
    setInterval(() => fetchMd5().catch(() => {}), 6000);
}).catch(err => { console.error("Boot:", err.message); process.exit(1); });
