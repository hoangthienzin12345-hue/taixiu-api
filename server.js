import fastify from "fastify";
import cors from "@fastify/cors";

// ═══════════════════════════════════════════════════════════════════
//  TÀI XỈU LC79 — ENSEMBLE AI (Monte Carlo + Markov + Bayesian)
// ═══════════════════════════════════════════════════════════════════
const PORT      = process.env.PORT || 3000;
const VALID_KEY = "Thienvskhangs37";
const ADMIN     = "@ADMNLc79";

const API = {
    md5: "https://wtxmd52.tele68.com/v1/txmd5/sessions",
    hu:  "https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5",
};
const POLL = 4000;

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
            await new Promise(r => setTimeout(r, 700 * (a + 1)));
        }
    }
}

// ═══════════════════════════════════════════════════════════════════
//  PARSE
// ═══════════════════════════════════════════════════════════════════
function parseRows(json) {
    const a = Array.isArray(json) ? json : (json?.list || json?.data || json?.sessions || []);
    return a
        .map(x => {
            const point = Number(x.point) || 0;
            let r = null;
            const raw = String(x.resultTruyenThong ?? x.result ?? x.resultName ?? x.type ?? "").toUpperCase();
            if (raw.includes("TAI") || raw.includes("TÀI")) r = "Tài";
            else if (raw.includes("XIU") || raw.includes("XỈU")) r = "Xỉu";
            else if (point >= 11) r = "Tài";
            else if (point > 0) r = "Xỉu";
            return {
                id: String(x.id ?? x._id ?? x.sessionId ?? ""),
                result: r,
                dices: x.dices || x.dice || [0, 0, 0],
                point,
            };
        })
        .filter(x => x.id && x.result)
        .sort((a, b) => {
            const na = Number(a.id), nb = Number(b.id);
            if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
            return a.id.localeCompare(b.id, undefined, { numeric: true });
        });
}

// ═══════════════════════════════════════════════════════════════════
//  1. MONTE CARLO — 5000 mô phỏng
// ═══════════════════════════════════════════════════════════════════
function monteCarloPrediction(history) {
    if (history.length === 0) return { prediction: "Tài", confidence: 0, taiProb: 0.5 };

    const recent = history.slice(-50);
    const taiRatio = recent.filter(h => h.result === "Tài").length / recent.length;

    let simulatedTai = 0;
    const simulations = 5000;

    for (let i = 0; i < simulations; i++) {
        if (Math.random() < 0.7) {
            if (Math.random() < taiRatio) simulatedTai++;
        } else {
            const d1 = Math.floor(Math.random() * 6) + 1;
            const d2 = Math.floor(Math.random() * 6) + 1;
            const d3 = Math.floor(Math.random() * 6) + 1;
            if ((d1 + d2 + d3) >= 11) simulatedTai++;
        }
    }

    const prob = simulatedTai / simulations;
    return {
        prediction: prob >= 0.5 ? "Tài" : "Xỉu",
        confidence: Math.abs(prob - 0.5) * 2,
        taiProb: prob,
    };
}

// ═══════════════════════════════════════════════════════════════════
//  2. MARKOV CHAIN — bậc 2 (TT/TX/XT/XX)
// ═══════════════════════════════════════════════════════════════════
function markovChainPrediction(history) {
    if (history.length < 2) return { prediction: "Tài", confidence: 0, taiProb: 0.5 };

    const matrix = {
        TT: { t: 0, total: 0 },
        TX: { t: 0, total: 0 },
        XT: { t: 0, total: 0 },
        XX: { t: 0, total: 0 },
    };

    for (let i = 2; i < history.length; i++) {
        const key = history[i - 2].result[0] + history[i - 1].result[0];
        if (matrix[key] !== undefined) {
            if (history[i].result === "Tài") matrix[key].t++;
            matrix[key].total++;
        }
    }

    const currKey = history[history.length - 2].result[0] + history[history.length - 1].result[0];

    if (matrix[currKey] && matrix[currKey].total > 0) {
        const prob = matrix[currKey].t / matrix[currKey].total;
        return {
            prediction: prob >= 0.5 ? "Tài" : "Xỉu",
            confidence: Math.abs(prob - 0.5) * 2,
            taiProb: prob,
        };
    }

    return { prediction: "Tài", confidence: 0.1, taiProb: 0.5 };
}

// ═══════════════════════════════════════════════════════════════════
//  3. BAYESIAN — decay 0.95
// ═══════════════════════════════════════════════════════════════════
function bayesianPrediction(history) {
    if (history.length === 0) return { prediction: "Tài", confidence: 0, taiProb: 0.5 };

    let alpha = 1;
    let beta = 1;

    for (let i = 0; i < history.length; i++) {
        const distance = history.length - 1 - i;
        const weight = Math.pow(0.95, distance);

        if (history[i].result === "Tài") alpha += weight;
        else beta += weight;
    }

    const prob = alpha / (alpha + beta);
    const variance = (alpha * beta) / (Math.pow(alpha + beta, 2) * (alpha + beta + 1));
    const confidence = Math.min(1 - Math.sqrt(variance) * 2, 0.95);

    return {
        prediction: prob >= 0.5 ? "Tài" : "Xỉu",
        confidence,
        taiProb: prob,
    };
}

// ═══════════════════════════════════════════════════════════════════
//  4. ENSEMBLE — MC 35% + Markov 35% + Bayesian 30%
// ═══════════════════════════════════════════════════════════════════
function getFinalAIDecision(history) {
    if (!history || history.length === 0) {
        return { prediction: null, confidenceStr: "0%", confidenceNum: 0, details: null };
    }

    const mc  = monteCarloPrediction(history);
    const mkv = markovChainPrediction(history);
    const bay = bayesianPrediction(history);

    const combinedProb = mc.taiProb * 0.35 + mkv.taiProb * 0.35 + bay.taiProb * 0.30;
    const finalPrediction = combinedProb >= 0.5 ? "Tài" : "Xỉu";
    const finalConfidence = Math.abs(combinedProb - 0.5) * 2;

    return {
        prediction: finalPrediction,
        confidenceStr: (finalConfidence * 100).toFixed(1) + "%",
        confidenceNum: finalConfidence,
        combinedProb,
        details: { monteCarlo: mc, markovChain: mkv, bayesian: bay },
    };
}

// ═══════════════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════════════
const state = {
    md5: { sessions: [], lastId: null, pred: null, lastFetch: 0 },
    hu:  { sessions: [], lastId: null, pred: null, lastFetch: 0 },
};

function updateState(st, arr) {
    if (!arr.length) return;
    const latest = arr[arr.length - 1].id;
    if (!st.lastId) {
        st.sessions = arr;
        st.lastId = latest;
        console.log(`✅ Loaded ${arr.length} sessions · last=${latest}`);
        return;
    }
    if (latest > st.lastId) {
        const news = arr.filter(r => r.id > st.lastId);
        for (const r of news) st.sessions.push(r);
        if (st.sessions.length > 800) st.sessions = st.sessions.slice(-700);
        st.lastId = latest;
        st.pred = null; // invalidate
        console.log(`🆕 +${news.length} → ${latest}`);
    }
}

function getPrediction(st) {
    if (st.sessions.length < 2) return null;
    const nextId = String(Number(st.lastId) + 1);
    if (st.pred && st.pred.targetId === nextId) return st.pred.data;

    const ai = getFinalAIDecision(st.sessions);
    if (!ai || !ai.prediction) return null;

    st.pred = { targetId: nextId, data: ai };
    return ai;
}

async function poll(key) {
    try {
        const json = await fetchJSON(API[key]);
        const arr = parseRows(json);
        updateState(state[key], arr);
        state[key].lastFetch = Date.now();
    } catch (e) {
        console.error(`❌ [${key.toUpperCase()}]`, e.message);
    }
}

// ═══════════════════════════════════════════════════════════════════
//  RESPONSE
// ═══════════════════════════════════════════════════════════════════
function buildResp(st) {
    if (!st.sessions.length) return null;
    const last = st.sessions[st.sessions.length - 1];
    const ai = getPrediction(st);
    if (!ai) return null;

    return {
        Id:          ADMIN,
        Phien_nay:   String(Number(last.id) + 1),
        Du_doan:     ai.prediction === "Tài" ? "TÀI" : "XỈU",
        Ty_le:       ai.confidenceStr,
        Phien_truoc: last.id,
        Xuc_xac:     `${last.dices[0]}-${last.dices[1]}-${last.dices[2]}`,
        Ket_qua:     last.result === "Tài" ? "TÀI" : "XỈU",
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
    engine: "ENSEMBLE AI — Monte Carlo 35% + Markov Chain 35% + Bayesian 30%",
    hu:  { loaded: state.hu.sessions.length,  last_id: state.hu.lastId },
    md5: { loaded: state.md5.sessions.length, last_id: state.md5.lastId },
}));

app.get("/api/taixiu/lc79", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const r = buildResp(state.hu);
    return r || rep.status(503).send({ error: "Đang tải dữ liệu HŨ..." });
});

app.get("/api/taixiumd5/lc79", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const r = buildResp(state.md5);
    return r || rep.status(503).send({ error: "Đang tải dữ liệu MD5..." });
});

app.get("/api/debug/:loai", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const st = req.params.loai === "md5" ? state.md5 : state.hu;
    if (!st.sessions.length) return rep.status(503).send({ error: "Chưa có dữ liệu" });
    const ai = getPrediction(st);
    return {
        sessions: st.sessions.length,
        last_id: st.lastId,
        details: ai?.details || null,
        combined_prob: ai?.combinedProb,
        prediction: ai?.prediction,
        confidence: ai?.confidenceStr,
    };
});

app.get("/check-key", async req =>
    req.query.key === VALID_KEY
        ? { status: "success", message: "KEY HỢP LỆ", admin: ADMIN }
        : { status: "error", message: `Sai key! Ib ${ADMIN}` });

// ═══════════════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════════════
app.listen({ port: PORT, host: "0.0.0.0" })
    .then(() => {
        console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  🎲 TÀI XỈU LC79 — ENSEMBLE AI                                   ║
╠══════════════════════════════════════════════════════════════════╣
║  🚀 Port: ${PORT}
║  🔑 Key : ${VALID_KEY}
║  👤 Admin: ${ADMIN}
║  🧠 Engine:
║     • Monte Carlo  (35%)  — 5000 mô phỏng
║     • Markov Chain (35%)  — bậc 2
║     • Bayesian     (30%)  — decay 0.95
║  📌 API:
║     HŨ : /api/taixiu/lc79?key=${VALID_KEY}
║     MD5: /api/taixiumd5/lc79?key=${VALID_KEY}
╚══════════════════════════════════════════════════════════════════╝
        `);

        setTimeout(() => {
            poll("hu").catch(() => {});
            poll("md5").catch(() => {});
        }, 100);

        setInterval(() => poll("hu").catch(() => {}),  POLL);
        setInterval(() => poll("md5").catch(() => {}), POLL);
    })
    .catch(err => {
        console.error("❌ Boot:", err.message);
        process.exit(1);
    });
