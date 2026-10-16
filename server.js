// ═══════════════════════════════════════════════════════════════════════════════
//  TÀI XỈU LC79 — CẦU ENGINE
//  6 pattern: Đảo/Thuận, 1-1, 2-2, 2-1-2, 1-2-1, 3-3 (dựa trên 5 phiên gần nhất)
// ═══════════════════════════════════════════════════════════════════════════════
import fastify from "fastify";
import cors from "@fastify/cors";

const PORT      = process.env.PORT || 3000;
const VALID_KEY = "Thien456";
const ADMIN     = "@ADMNLc79";

const API = {
    md5: "https://wtxmd52.tele68.com/v1/txmd5/sessions",
    hu:  "https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5",
};
const MAX  = 30;
const POLL = 5000;

// ═══════════════════════════════════════════════════════════════════════════════
//  FETCH
// ═══════════════════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════════════════
//  PARSE
// ═══════════════════════════════════════════════════════════════════════════════
function parseRows(json) {
    const a = Array.isArray(json) ? json : (json?.list || json?.data || json?.sessions || []);
    return a.map(x => {
        const idNum = parseInt(String(x.id ?? x._id ?? x.sessionId ?? "").replace(/\D/g, ""));
        const point = Number(x.point ?? x.total ?? 0);
        const raw = String(x.resultTruyenThong ?? x.result ?? x.resultName ?? x.type ?? "").toUpperCase();
        let r = null;
        if (raw.includes("TAI") || raw.includes("TÀI")) r = "T";
        else if (raw.includes("XIU") || raw.includes("XỈU")) r = "X";
        else if (point > 0) r = point >= 11 ? "T" : "X";
        return {
            id: String(x.id ?? x._id ?? x.sessionId ?? ""),
            id_num: idNum,
            r,
            dices: x.dices || x.dice || [],
            point,
        };
    }).filter(x => x.id && x.r && x.id_num > 0)
      .sort((a, b) => a.id_num - b.id_num);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  6 CẦU — CHỈ DÙNG 5 PHIÊN GẦN NHẤT
// ═══════════════════════════════════════════════════════════════════════════════
function detect(seq) {
    if (seq.length < 5) return [];

    const last  = seq[seq.length - 1];
    const last4 = seq.slice(-4);   // 4 phiên cuối
    const last5 = seq.slice(-5);   // 5 phiên cuối
    const OPP   = last === "T" ? "X" : "T";
    const signals = [];

    // ─── [1] ĐẢO / THUẬN — đếm số lần đảo trong 5 phiên ───
    let alt = 0;
    for (let i = 1; i < 5; i++) if (last5[i] !== last5[i - 1]) alt++;

    if (alt === 4) {
        // 5 phiên đảo hoàn toàn (T-X-T-X-T hoặc X-T-X-T-X)
        signals.push({ name: "Đảo", side: OPP, conf: 72, note: "5 phiên đảo 4/4 → tiếp đảo" });
    } else if (alt === 3) {
        // 4/5 đảo
        signals.push({ name: "Đảo", side: OPP, conf: 62, note: "Đảo 3/4 → nghiêng đảo" });
    } else if (alt === 1) {
        // 1/5 đảo = gần như thuận
        signals.push({ name: "Thuận", side: last, conf: 68, note: "5 phiên thuận 3/4" });
    } else if (alt === 0) {
        // Không đảo lần nào = bệt 5 tay
        signals.push({ name: "Thuận", side: last, conf: 60, note: "5 phiên thuận 4/4" });
    }

    // ─── [2] CẦU 1-1 (T-X-T-X) ───
    if (last4[0] !== last4[1] && last4[1] !== last4[2] && last4[2] !== last4[3]) {
        // TXTX hoặc XTXT → phiên tiếp là đảo của phiên cuối
        signals.push({ name: "1-1", side: last4[3] === "T" ? "X" : "T", conf: 76, note: "Cầu 1-1 (T-X-T-X)" });
    }

    // ─── [3] CẦU 2-2 (TT-XX hoặc XX-TT) ───
    if (last4[0] === last4[1] && last4[2] === last4[3] && last4[0] !== last4[2]) {
        // TTXX → next T ; XXTT → next X
        signals.push({ name: "2-2", side: last4[0], conf: 74, note: "Cầu 2-2 (TT-XX)" });
    }

    // ─── [4] CẦU 2-1-2 (TT-X-TT hoặc XX-T-XX) ───
    if (last5[0] === last5[1] &&
        last5[1] !== last5[2] &&
        last5[2] !== last5[3] &&
        last5[3] === last5[4] &&
        last5[0] !== last5[2]) {
        // TTXTT → next X ; XXTXX → next T
        signals.push({ name: "2-1-2", side: last5[2], conf: 76, note: "Cầu 2-1-2 (TT-X-TT)" });
    }

    // ─── [5] CẦU 1-2-1 (T-XX-T hoặc X-TT-X) ───
    if (last4[0] !== last4[1] &&
        last4[1] === last4[2] &&
        last4[2] !== last4[3]) {
        // TXXT → next X ; XTTX → next T
        signals.push({ name: "1-2-1", side: last4[1], conf: 72, note: "Cầu 1-2-1 (T-XX-T)" });
    }

    // ─── [6] CẦU 3-3 (TTT-XXX hoặc XXX-TTT) — dùng 6 phiên cuối ───
    const last6 = seq.slice(-6);
    if (last6.length === 6 &&
        last6[0] === last6[1] && last6[1] === last6[2] &&
        last6[3] === last6[4] && last6[4] === last6[5] &&
        last6[0] !== last6[3]) {
        // TTTXXX → next T ; XXXTTT → next X
        signals.push({ name: "3-3", side: last6[0], conf: 78, note: "Cầu 3-3 (TTT-XXX)" });
    }

    return signals;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DỰ ĐOÁN TỔNG HỢP — WEIGHTED VOTE (cân bằng)
// ═══════════════════════════════════════════════════════════════════════════════
function predict(seq) {
    if (seq.length < 5) return null;

    const signals = detect(seq);

    if (signals.length === 0) {
        return {
            prediction: "CHỜ",
            confidence: 0,
            method: "Không nhận diện được cầu",
            signals: [],
            tScore: 0, xScore: 0,
        };
    }

    // Vote có trọng số theo conf
    let tScore = 0, xScore = 0;
    for (const s of signals) {
        const w = s.conf;
        if (s.side === "T") tScore += w;
        else xScore += w;
    }

    const total = tScore + xScore;
    const ratio = Math.max(tScore, xScore) / total;
    const prediction = tScore >= xScore ? "TAI" : "XIU";

    // Confidence = % đồng thuận, giới hạn 50-95
    const confidence = Math.min(95, Math.round(50 + (ratio - 0.5) * 90));

    const agree = signals.filter(s => (s.side === "T" ? "TAI" : "XIU") === prediction).length;

    return {
        prediction,
        confidence,
        method: `${agree}/${signals.length} cầu đồng thuận`,
        signals: signals.sort((a, b) => b.conf - a.conf),
        tScore: Math.round(tScore),
        xScore: Math.round(xScore),
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════════════════════════
const state = {
    md5: { sessions: [], lastId: null, pred: null, latest: null },
    hu:  { sessions: [], lastId: null, pred: null, latest: null },
};

function update(key, arr) {
    const st = state[key];
    if (!arr.length) return;
    const latest = arr[arr.length - 1];

    if (!st.lastId) {
        st.sessions = arr;
        st.lastId = latest.id;
        console.log(`✅ [${key.toUpperCase()}] ${arr.length} phiên`);
    } else if (latest.id_num > st.lastId) {
        const news = arr.filter(r => r.id_num > st.lastId);
        for (const r of news) st.sessions.push(r);
        if (st.sessions.length > 500) st.sessions = st.sessions.slice(-450);
        st.lastId = latest.id;
        console.log(`🆕 [${key.toUpperCase()}] +${news.length}`);
    }

    // Dự đoán dựa trên phiên gần nhất
    const recent = st.sessions.slice(-MAX);
    st.latest = recent[recent.length - 1];
    st.pred = predict(recent.map(s => s.r));
}

async function poll(key) {
    try {
        const json = await fetchJSON(API[key]);
        const arr = parseRows(json);
        update(key, arr);
    } catch (e) {
        console.error(`❌ [${key.toUpperCase()}]`, e.message);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  RESPONSE
// ═══════════════════════════════════════════════════════════════════════════════
function buildResp(key) {
    const st = state[key];
    if (!st.latest || !st.pred) return null;
    const last = st.latest;
    const p = st.pred;

    let duDoan = "CHỜ";
    let tyLe = "--";
    if (p.prediction === "TAI") { duDoan = "TÀI"; tyLe = `${p.confidence}%`; }
    else if (p.prediction === "XIU") { duDoan = "XỈU"; tyLe = `${p.confidence}%`; }

    return {
        Id:          ADMIN,
        Phien_nay:   last.id_num + 1,
        Du_doan:     duDoan,
        Ty_le:       tyLe,
        Phien_truoc: last.id_num,
        Xuc_xac:     last.dices?.length === 3 ? last.dices.join("-") : "—",
        Ket_qua:     last.r === "T" ? "TÀI" : "XỈU",
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CHECK KEY
// ═══════════════════════════════════════════════════════════════════════════════
const checkKey = q => q.key === VALID_KEY ? { valid: true } : { valid: false, error: `Sai key! Ib ${ADMIN}` };

// ═══════════════════════════════════════════════════════════════════════════════
//  SERVER
// ═══════════════════════════════════════════════════════════════════════════════
const app = fastify({ logger: false, disableRequestLogging: true });
await app.register(cors, { origin: "*" });

app.get("/", async () => ({
    status: "ok",
    admin: ADMIN,
    engine: "Cầu Engine — Đảo/Thuận · 1-1 · 2-2 · 2-1-2 · 1-2-1 · 3-3",
    hu:  { loaded: state.hu.sessions.length,  last_id: state.hu.lastId },
    md5: { loaded: state.md5.sessions.length, last_id: state.md5.lastId },
}));

app.get("/api/taixiu/lc79", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const r = buildResp("hu");
    return r || rep.status(503).send({ error: "Đang tải dữ liệu HŨ..." });
});

app.get("/api/taixiumd5/lc79", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const r = buildResp("md5");
    return r || rep.status(503).send({ error: "Đang tải dữ liệu MD5..." });
});

app.get("/api/debug/:loai", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const st = req.params.loai === "md5" ? state.md5 : state.hu;
    if (!st.latest) return rep.status(503).send({ error: "Chưa đủ dữ liệu" });

    const last5 = st.sessions.slice(-5).map(s => s.r);
    return {
        last: {
            id: st.latest.id_num,
            result: st.latest.r,
            dice: st.latest.dices,
            point: st.latest.point,
        },
        last5: last5.join(""),
        last5_pretty: last5.map(x => x === "T" ? "Tài" : "Xỉu").join(" - "),
        prediction: st.pred,
    };
});

app.get("/check-key", async req =>
    req.query.key === VALID_KEY
        ? { status: "success", message: "KEY HỢP LỆ", admin: ADMIN }
        : { status: "error", message: `Sai key! Ib ${ADMIN}` });

// ═══════════════════════════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════════════════════════
app.listen({ port: PORT, host: "0.0.0.0" })
    .then(() => {
        console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  🎲 TÀI XỈU LC79 — CẦU ENGINE                                        ║
╠══════════════════════════════════════════════════════════════════════╣
║  🚀 Port: ${PORT}
║  🔑 Key : ${VALID_KEY}
║  👤 Admin: ${ADMIN}
║  🎯 6 cầu: Đảo/Thuận · 1-1 · 2-2 · 2-1-2 · 1-2-1 · 3-3
║  📌 HŨ : /api/taixiu/lc79?key=${VALID_KEY}
║  📌 MD5: /api/taixiumd5/lc79?key=${VALID_KEY}
║  🐞 Debug: /api/debug/hu?key=${VALID_KEY}
╚══════════════════════════════════════════════════════════════════════╝
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
