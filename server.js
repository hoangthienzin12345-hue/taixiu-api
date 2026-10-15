import fastify from "fastify";
import cors from "@fastify/cors";

// ═══════════════════════════════════════════════════════════════════
//  TÀI XỈU LC79 — ENSEMBLE AI SERVER (Monte Carlo + Markov + Bayesian)
// ═══════════════════════════════════════════════════════════════════
const PORT      = process.env.PORT || 3000;
const VALID_KEY = "Thiên456";
const ADMIN     = "@ADMNLc79";

const API_URL_HU  = "https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5";
const API_URL_MD5 = "https://wtxmd52.tele68.com/v1/txmd5/sessions";

// ═══════════════════════════════════════════════════════════════════
//  FETCH VỚI TIMEOUT
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
            await new Promise(r => setTimeout(r, 700 * (attempt + 1)));
        }
    }
}

// ═══════════════════════════════════════════════════════════════════
//  🎲 ENSEMBLE AI — Monte Carlo (35%) + Markov (35%) + Bayesian (30%)
// ═══════════════════════════════════════════════════════════════════

// [1] Monte Carlo — mô phỏng 3000 ván
function monteCarlo(history) {
    if (!history.length) return 0.5;
    const recent = history.slice(-50);
    const taiRatio = recent.filter(h => h === "TAI").length / recent.length;
    let simTai = 0;
    const SIMS = 3000;
    for (let i = 0; i < SIMS; i++) {
        if (Math.random() < 0.7) {
            // Bám theo phân phối thực tế
            if (Math.random() < taiRatio) simTai++;
        } else {
            // Mô phỏng 3 xúc xắc
            const d1 = (Math.random() * 6 | 0) + 1;
            const d2 = (Math.random() * 6 | 0) + 1;
            const d3 = (Math.random() * 6 | 0) + 1;
            if (d1 + d2 + d3 >= 11) simTai++;
        }
    }
    return simTai / SIMS;
}

// [2] Markov Chain bậc 2 (TT, TX, XT, XX)
function markovChain(history) {
    if (history.length < 3) return 0.5;
    const matrix = {
        TT: { t: 0, total: 0 },
        TX: { t: 0, total: 0 },
        XT: { t: 0, total: 0 },
        XX: { t: 0, total: 0 },
    };
    for (let i = 2; i < history.length; i++) {
        const key = history[i - 2][0] + history[i - 1][0];
        if (matrix[key]) {
            if (history[i] === "TAI") matrix[key].t++;
            matrix[key].total++;
        }
    }
    const currKey = history[history.length - 2][0] + history[history.length - 1][0];
    if (matrix[currKey]?.total > 0) {
        return matrix[currKey].t / matrix[currKey].total;
    }
    return 0.5;
}

// [3] Bayesian — weighted với decay 0.95
function bayesian(history) {
    if (!history.length) return 0.5;
    let alpha = 1.0, beta = 1.0;
    const L = history.length;
    for (let i = 0; i < L; i++) {
        const distance = L - 1 - i;
        const weight = Math.pow(0.95, distance);
        if (history[i] === "TAI") alpha += weight;
        else beta += weight;
    }
    return alpha / (alpha + beta);
}

// [4] Kết hợp 3 module
function ensemble(history) {
    if (!history.length) {
        return { prediction: "XIU", taiProb: 0.5, confidence: 0, pattern: "no-data" };
    }
    const mc  = monteCarlo(history);
    const mkv = markovChain(history);
    const bay = bayesian(history);
    const combined = mc * 0.35 + mkv * 0.35 + bay * 0.30;
    const prediction = combined >= 0.5 ? "TAI" : "XIU";
    const confidence = Math.abs(combined - 0.5) * 2; // 0..1
    return {
        prediction,
        taiProb: combined,
        xiuProb: 1 - combined,
        confidence,
        pattern: `MC:${mc.toFixed(2)} MKV:${mkv.toFixed(2)} BAY:${bay.toFixed(2)}`,
    };
}

// ═══════════════════════════════════════════════════════════════════
//  PARSE
// ═══════════════════════════════════════════════════════════════════
function parseHu(data) {
    if (!data?.list || !Array.isArray(data.list)) return [];
    return data.list
        .sort((a, b) => b.id - a.id)
        .map(item => ({
            id: item.id,
            dices: item.dices,
            point: item.point,
            result: item.point >= 11 ? "TAI" : "XIU",
        }))
        .sort((a, b) => a.id - b.id); // chrono
}

function parseMd5(data) {
    if (!data?.list || !Array.isArray(data.list)) return [];
    return data.list
        .sort((a, b) => b.id - a.id)
        .map(item => ({
            id: item.id,
            dices: item.dices,
            point: item.point,
            result: item.resultTruyenThong === "Tài" ? "TAI" : "XIU",
        }))
        .sort((a, b) => a.id - b.id);
}

// ═══════════════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════════════
function makeState() {
    return {
        sessions: [],
        lastId: null,
        lastPred: null,   // {session, data}
        lastFetch: 0,
    };
}

const stateHu  = makeState();
const stateMd5 = makeState();

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
        for (const r of news) state.sessions.push(r);
        if (state.sessions.length > 800) state.sessions = state.sessions.slice(-700);
        state.lastId = latest;
        state.lastPred = null; // invalidate cache
        console.log(`🆕 +${news.length} sessions → ${latest}`);
    }
}

// ═══════════════════════════════════════════════════════════════════
//  GET PREDICTION (có cache theo session)
// ═══════════════════════════════════════════════════════════════════
function getPrediction(state) {
    if (state.sessions.length < 10) return null;
    const nextId = state.lastId + 1;

    // Cache
    if (state.lastPred && state.lastPred.session === nextId) {
        return state.lastPred.data;
    }

    const history = state.sessions.map(s => s.result);
    const result = ensemble(history);

    state.lastPred = { session: nextId, data: result };
    return result;
}

// ═══════════════════════════════════════════════════════════════════
//  FETCH LOOPS
// ═══════════════════════════════════════════════════════════════════
async function fetchHu() {
    try {
        const data = await fetchJSON(API_URL_HU);
        updateState(stateHu, parseHu(data));
        stateHu.lastFetch = Date.now();
    } catch (e) { console.error("❌ [HŨ]", e.message); }
}

async function fetchMd5() {
    try {
        const data = await fetchJSON(API_URL_MD5);
        updateState(stateMd5, parseMd5(data));
        stateMd5.lastFetch = Date.now();
    } catch (e) { console.error("❌ [MD5]", e.message); }
}

// ═══════════════════════════════════════════════════════════════════
//  RESPONSE BUILDER (FORMAT GỌN)
// ═══════════════════════════════════════════════════════════════════
function buildResp(state, game) {
    if (state.sessions.length < 10) return null;

    const pred = getPrediction(state);
    if (!pred) return null;

    const last = state.sessions[state.sessions.length - 1];

    return {
        Id:           ADMIN,
        Game:         game,
        Phien_truoc:  last.id,
        Xuc_xac:      `${last.dices[0]}-${last.dices[1]}-${last.dices[2]}`,
        Ket_qua:      last.result === "TAI" ? "tài" : "xỉu",
        Phien_nay:    last.id + 1,
        Du_doan:      pred.prediction === "TAI" ? "tài" : "xỉu",
        Ty_le:        `${(pred.confidence * 100).toFixed(1)}%`,
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

// ─── HEALTHCHECK ───
app.get("/", async () => ({
    status: "ok",
    admin: ADMIN,
    engine: "Ensemble AI (Monte Carlo 35% + Markov 35% + Bayesian 30%)",
    hu:  { loaded: stateHu.sessions.length,  last_id: stateHu.lastId,
           age: stateHu.lastFetch  ? Math.floor((Date.now() - stateHu.lastFetch) / 1000) + "s"  : "never" },
    md5: { loaded: stateMd5.sessions.length, last_id: stateMd5.lastId,
           age: stateMd5.lastFetch ? Math.floor((Date.now() - stateMd5.lastFetch) / 1000) + "s" : "never" },
}));

// ─── API HŨ ───
app.get("/api/taixiu/lc79", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const r = buildResp(stateHu, "HŨ");
    return r || rep.status(503).send({ error: "Đang tải dữ liệu HŨ (cần ≥10 phiên)..." });
});

// ─── API MD5 ───
app.get("/api/taixiumd5/lc79", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const r = buildResp(stateMd5, "MD5");
    return r || rep.status(503).send({ error: "Đang tải dữ liệu MD5 (cần ≥10 phiên)..." });
});

// ─── CHECK KEY ───
app.get("/check-key", async req =>
    req.query.key === VALID_KEY
        ? { status: "success", message: "KEY HỢP LỆ", admin: ADMIN }
        : { status: "error", message: `Sai key! Ib ${ADMIN}` });

// ─── DEBUG (xem chi tiết AI) ───
app.get("/api/debug/:loai", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const state = req.params.loai === "md5" ? stateMd5 : stateHu;
    if (state.sessions.length < 10) return rep.status(503).send({ error: "Chưa đủ dữ liệu" });

    const history = state.sessions.map(s => s.result);
    const mc  = monteCarlo(history);
    const mkv = markovChain(history);
    const bay = bayesian(history);
    const pred = getPrediction(state);

    return {
        sessions: state.sessions.length,
        last_id: state.lastId,
        monte_carlo: +(mc * 100).toFixed(2),
        markov:      +(mkv * 100).toFixed(2),
        bayesian:    +(bay * 100).toFixed(2),
        combined:    +(pred.taiProb * 100).toFixed(2),
        prediction:  pred.prediction,
        confidence:  +(pred.confidence * 100).toFixed(1) + "%",
        pattern:     pred.pattern,
    };
});

// ═══════════════════════════════════════════════════════════════════
//  🚀 BOOT — LISTEN TRƯỚC, FETCH SAU
// ═══════════════════════════════════════════════════════════════════
app.listen({ port: PORT, host: "0.0.0.0" })
    .then(() => {
        console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  🎲 TÀI XỈU LC79 — ENSEMBLE AI SERVER                            ║
╠══════════════════════════════════════════════════════════════════╣
║  🚀 Port: ${PORT}                                                  
║  🔑 Key : ${VALID_KEY}                                          
║  👤 Admin: ${ADMIN}                                             
║                                                                  
║  🧠 ENGINE:                                                      
║     • Monte Carlo  35%                                           
║     • Markov Chain 35%                                           
║     • Bayesian     30%                                           
║                                                                  
║  📌 API:                                                         
║     HŨ : /api/taixiu/lc79?key=${VALID_KEY}                      
║     MD5: /api/taixiumd5/lc79?key=${VALID_KEY}                   
║     Debug: /api/debug/hu?key=${VALID_KEY}                       
╚══════════════════════════════════════════════════════════════════╝
        `);

        // Fetch sau 100ms
        setTimeout(() => {
            fetchHu().catch(() => {});
            fetchMd5().catch(() => {});
        }, 100);

        // Poll mỗi 6s
        setInterval(() => fetchHu().catch(() => {}), 6000);
        setInterval(() => fetchMd5().catch(() => {}), 6000);
    })
    .catch(err => {
        console.error("❌ Boot:", err.message);
        process.exit(1);
    });
