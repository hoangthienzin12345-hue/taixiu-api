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
//  6 PATTERN MATCHER (trên 15 phiên cuối)
// ═══════════════════════════════════════════════════════════════════
const P1 = c => { // Đảo thuận
    const w = tail(c.seq, 15);
    if (w.length < 6) return [0.5, 0, "n/a"];
    let alt = 1;
    for (let i = w.length - 1; i >= 1; i--) { if (w[i] !== w[i-1]) alt++; else break; }
    if (alt < 5) return [0.5, 0, `alt=${alt}`];
    const last = w[w.length - 1];
    return [last === "T" ? 0.42 : 0.58, Math.min(2, (alt-3)*0.55), `đảo×${alt}`];
};
const P2 = c => { // 1-1
    const w = tail(c.seq, 15);
    if (w.length < 8) return [0.5, 0, "n/a"];
    const l8 = w.slice(-8);
    for (let i = 1; i < 8; i++) if (l8[i] === l8[i-1]) return [0.5, 0, "n/a"];
    return [l8[7] === "T" ? 0.42 : 0.58, 1.6, "1-1×8"];
};
const P3 = c => { // 2-2
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
const P4 = c => { // 3-1
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
const P5 = c => { // 2-1
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
const P6 = c => { // 3-3
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

const MODULES = [
    ["P1", P1], ["P2", P2], ["P3", P3],
    ["P4", P4], ["P5", P5], ["P6", P6],
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
//  ANALYZE — 6 patterns + Fallback Đảo Bệt
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
        } catch { signals.push({ id, p_tai: 50, w: 0, note: "err" }); }
    }

    const matched = signals.filter(s => s.w > 0);
    const [streak, last] = streakLen(seq);

    let pTai, tier, note, matchNames;

    if (matched.length > 0) {
        // ── Có pattern match → ensemble có trọng số
        let num = 0, den = 0;
        for (const s of matched) { num += s.p_tai * s.w; den += s.w; }
        pTai = den ? num / den / 100 : 0.5;
        const predict = pTai >= 0.5 ? "TAI" : "XIU";
        const agree = matched.filter(s => (s.p_tai >= 50) === (predict === "TAI")).length / matched.length * 100;
        const conf = Math.max(pTai, 1 - pTai) * 100;
        if (conf >= 57 && agree >= 65)      tier = "STRONG";
        else if (conf >= 53 && agree >= 55) tier = "OK";
        else if (matched.length === 1)      tier = "SINGLE";
        else                                tier = "SPLIT";
        note = `${matched.map(s => s.note).join(" + ")}`;
        matchNames = matched.map(s => s.id).join(",");
    } else if (streak >= 4) {
        // ── FIX: bệt dài không pattern → ĐẢO BỆT
        // streak càng dài càng chắc đảo
        const pRev = last === "T" ? 0.35 : 0.65;
        pTai = pRev;
        tier = streak >= 7 ? "STRONG" : streak >= 5 ? "OK" : "SINGLE";
        note = `Đảo bệt ${last}×${streak}`;
        matchNames = "REVERSAL";
    } else {
        // ── Không match, không streak → NEUTRAL
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
        matchNames, note,
        signals,
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
    if (state.sessions.length < 15) return null;
    if (state.lastPred && state.lastPred.session === state.lastId + 1) return state.lastPred.ai_result;
    const ai = analyze(state);
    if (!ai) return null;
    state.lastPred = { session: state.lastId + 1, predict: ai.predict, ai_result: ai };
    return ai;
}

// ═══════════════════════════════════════════════════════════════════
//  BUILD RESPONSE — GỌN
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
            wilson: +ai.wilson.toFixed(1),
            streak: `${ai.streak}${ai.last}`,
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
    engine: "LC79 v12 — 6 PATTERNS + ĐẢO BỆT FALLBACK",
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
    console.log(`🚀 [${PORT}] LC79 v12 online`);
    setTimeout(() => { fetchHu().catch(() => {}); fetchMd5().catch(() => {}); }, 100);
    setInterval(() => fetchHu().catch(() => {}),  6000);
    setInterval(() => fetchMd5().catch(() => {}), 6000);
}).catch(err => { console.error("Boot:", err.message); process.exit(1); });
