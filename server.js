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

// ═══════════════════════════════════════════════════════════════════
//  NHÓM 1 — CẦU  (6 thuật toán, đã cân bằng chống bias)
// ═══════════════════════════════════════════════════════════════════

// N1 — Cầu bệt: theo trend khi streak ngắn, CHÙNG khi vừa, ĐẢO khi dài
const N1 = c => {
    const [s, last] = streakLen(c.seq);
    if (s === 0) return [0.5, 0, "n/a"];
    if (s <= 2) return [last === "T" ? 0.56 : 0.44, 0.9, `bệt ${last}×${s}`];
    if (s === 3) return [last === "T" ? 0.47 : 0.53, 1.0, `chùng ${last}×${s}`];
    if (s === 4) return [last === "T" ? 0.42 : 0.58, 1.3, `đảo ${last}×${s}`];
    return [last === "T" ? 0.38 : 0.62, 1.6, `đảo mạnh ${last}×${s}`];
};

// N2 — Cầu đảo: LUÔN ngược lại kết quả cuối (counter-balance N1)
const N2 = c => {
    const [s, last] = streakLen(c.seq);
    if (s === 0) return [0.5, 0, "n/a"];
    const w = 0.7 + Math.min(1.3, (s - 1) * 0.35);
    return [last === "T" ? 0.44 : 0.56, w, `đảo ${last}×${s}`];
};

// N3 — Cầu 2-2 / 3-3 / 1-1 xen kẽ
const N3 = c => {
    const w8 = tail(c.seq, 8).join("");
    const pats = [
        { p: "TTXX",   n: "T", b: 1.3, txt: "2-2→T" },
        { p: "XXTT",   n: "X", b: 1.3, txt: "2-2→X" },
        { p: "TTTXXX", n: "T", b: 1.5, txt: "3-3→T" },
        { p: "XXXTTT", n: "X", b: 1.5, txt: "3-3→X" },
    ];
    for (const { p, n, b, txt } of pats) {
        if (w8.endsWith(p)) return [n === "T" ? 0.58 : 0.42, b, txt];
    }
    const w6 = tail(c.seq, 6);
    if (w6.length === 6) {
        let alt = true;
        for (let i = 1; i < 6; i++) if (w6[i] === w6[i - 1]) { alt = false; break; }
        if (alt) {
            const last = w6[5];
            return [last === "T" ? 0.44 : 0.56, 0.9, "1-1 xen kẽ"];
        }
    }
    return [0.5, 0, "n/a"];
};

// N4 — Markov bậc 1
const N4 = c => { const r = mkv(c.seq, 1); return [r[0], r[1] * 1.2, r[2]]; };

// N5 — Markov bậc 2
const N5 = c => { const r = mkv(c.seq, 2); return [r[0], r[1] * 1.5, r[2]]; };

// N6 — Markov bậc 3 (mạnh nhất)
const N6 = c => { const r = mkv(c.seq, 3); return [r[0], r[1] * 1.8, r[2]]; };

// ═══════════════════════════════════════════════════════════════════
//  6 MODULE REGISTRY
// ═══════════════════════════════════════════════════════════════════
const MODULES = [
    ["N1", N1], ["N2", N2], ["N3", N3],
    ["N4", N4], ["N5", N5], ["N6", N6],
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
//  ANALYZE — 6 module + Anti-Drift
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
    let pTai = den ? num / den / 100 : 0.5;

    // ═══════════════════════════════════════════════════════════
    //  ANTI-DRIFT: kéo về trung tính nếu 20 phiên lệch > 65%
    // ═══════════════════════════════════════════════════════════
    const w20 = seq.slice(-20);
    let driftNote = "";
    if (w20.length >= 20) {
        const fT = cnt(w20, "T") / w20.length;
        if (fT >= 0.65 || fT <= 0.35) {
            const before = pTai;
            pTai = pTai * 0.82 + 0.5 * 0.18; // soft mean-reversion
            driftNote = ` · drift ${(fT*100).toFixed(0)}%T→${(pTai*100).toFixed(0)}%`;
        }
    }

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

    // Wilson
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

    return {
        predict, confidence: conf, tier, agreement: agree, wilson,
        p_tai: pTai * 100, p_xiu: (1 - pTai) * 100,
        streak, last, driftNote, signals,
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
        Ly_do: `Tier ${ai.tier} · Agree ${ai.agreement.toFixed(0)}% · Wilson ${ai.wilson.toFixed(1)}%${ai.driftNote}`,
        Biet_hien_tai: `${ai.streak} ${ai.last}`,
        Nguon_cau: `6 modules CẦU · ${topSig}`,
        AI: {
            tier: ai.tier,
            p_tai: +ai.p_tai.toFixed(2), p_xiu: +ai.p_xiu.toFixed(2),
            wilson: +ai.wilson.toFixed(2), agreement: +ai.agreement.toFixed(1),
            drift: ai.driftNote || "none",
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
    engine: "LC79 v10 — 6 THUẬT TOÁN CẦU + ANTI-DRIFT",
    modules: {
        N1: "Cầu bệt (streak follow/chùng/đảo)",
        N2: "Cầu đảo (counter-balance)",
        N3: "Cầu 2-2 / 3-3 / 1-1",
        N4: "Markov bậc 1",
        N5: "Markov bậc 2",
        N6: "Markov bậc 3",
        AntiDrift: "Kéo về 0.5 nếu 20 phiên lệch >65%",
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
    console.log(`🚀 [${PORT}] LC79 v10 · 6 modules CẦU + Anti-Drift online`);
    setTimeout(() => { fetchHu().catch(() => {}); fetchMd5().catch(() => {}); }, 100);
    setInterval(() => fetchHu().catch(() => {}),  6000);
    setInterval(() => fetchMd5().catch(() => {}), 6000);
}).catch(err => { console.error("Boot:", err.message); process.exit(1); });
