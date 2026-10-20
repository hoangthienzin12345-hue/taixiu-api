// ═══════════════════════════════════════════════════════════════════════════════
//  TÀI XỈU LC79 — CÂN BẰNG: CẦU + 10 THUẬT TOÁN + BẢNG ĐIỂM
//  Không copy last · Cân bằng T/X · Diagnostic rõ ràng
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
const MAX  = 105;
const POLL = 4000;

// ═══════════════════════════════════════════════════════════════════════════════
//  BẢNG ĐIỂM MD5 (16 mức)
// ═══════════════════════════════════════════════════════════════════════════════
const BANG_DIEM = {
    3:  { pred: "X", conf: 70, note: "X3  → XỈU 70%" },
    4:  { pred: "T", conf: 60, note: "X4  → TÀI 60%" },
    5:  { pred: "T", conf: 70, note: "X5  → TÀI 70%" },
    6:  { pred: "X", conf: 60, note: "X6  → XỈU 60%" },
    7:  { pred: "T", conf: 80, note: "X7  → TÀI 80%" },
    8:  { pred: "X", conf: 80, note: "X8  → XỈU 80%" },
    9:  { pred: "X", conf: 70, note: "X9  → XỈU 70%" },
    10: { pred: "T", conf: 80, note: "X10 → TÀI 80%" },
    11: { pred: "X", conf: 60, note: "T11 → XỈU 60%" },
    12: { pred: "T", conf: 80, note: "T12 → TÀI 80%" },
    13: { pred: "T", conf: 80, note: "T13 → TÀI 80%" },
    14: { pred: "X", conf: 60, note: "T14 → XỈU 60%" },
    15: { pred: "X", conf: 70, note: "T15 → XỈU 70%" },
    16: { pred: "T", conf: 60, note: "T16 → TÀI 60%" },
    17: { pred: "X", conf: 60, note: "T17 → XỈU 60%" },
    18: { pred: "X", conf: 80, note: "T18 → XỈU 80%" },
};

// ═══════════════════════════════════════════════════════════════════════════════
//  FETCH & PARSE
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
        return { id: String(x.id ?? x._id ?? x.sessionId ?? ""), id_num: idNum, r, dices: x.dices || x.dice || [], point };
    }).filter(x => x.id && x.r && x.id_num > 0).sort((a, b) => a.id_num - b.id_num);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CẦU CƠ BẢN (7)
// ═══════════════════════════════════════════════════════════════════════════════
const opp = x => x === 1 ? 0 : 1;

function cau11(bits) {
    if (bits.length < 4) return null;
    const r = bits.slice(-4);
    if (r[0] !== r[1] && r[1] !== r[2] && r[2] !== r[3])
        return { pT: opp(r[3]), weight: 3.5, name: "Cầu 1-1" };
    return null;
}

function cau12(bits) {
    if (bits.length < 6) return null;
    const r = bits.slice(-6);
    if (r[0] !== r[1] && r[1] === r[2] && r[3] !== r[4] && r[4] === r[5] && r[0] === r[3])
        return { pT: r[0], weight: 3, name: "Cầu 1-2" };
    return null;
}

function cau21(bits) {
    if (bits.length < 6) return null;
    const r = bits.slice(-6);
    if (r[0] === r[1] && r[1] !== r[2] && r[3] === r[4] && r[4] !== r[5] && r[0] === r[3])
        return { pT: r[0], weight: 3, name: "Cầu 2-1" };
    return null;
}

function cau22(bits) {
    if (bits.length < 4) return null;
    const r = bits.slice(-4);
    if (r[0] === r[1] && r[2] === r[3] && r[0] !== r[2])
        return { pT: r[0], weight: 3.5, name: "Cầu 2-2" };
    return null;
}

function cau33(bits) {
    if (bits.length < 6) return null;
    const r = bits.slice(-6);
    if (r[0] === r[1] && r[1] === r[2] && r[3] === r[4] && r[4] === r[5] && r[0] !== r[3])
        return { pT: r[0], weight: 4, name: "Cầu 3-3" };
    return null;
}

function cau44(bits) {
    if (bits.length < 8) return null;
    const r = bits.slice(-8);
    if (r[0] === r[1] && r[1] === r[2] && r[2] === r[3] &&
        r[4] === r[5] && r[5] === r[6] && r[6] === r[7] && r[0] !== r[4])
        return { pT: r[0], weight: 4, name: "Cầu 4-4" };
    return null;
}

function cauBet(bits) {
    const n = bits.length;
    if (n < 2) return null;
    let run = 1;
    for (let i = n - 2; i >= 0; i--) {
        if (bits[i] === bits[n - 1]) run++;
        else break;
    }
    if (run >= 2 && run <= 5)
        return { pT: bits[n - 1], weight: 1.5 + run * 0.3, name: `Bệt ${run} follow` };
    if (run >= 6)
        return { pT: opp(bits[n - 1]), weight: 2.5 + (run - 6) * 0.4, name: `Bệt ${run} break` };
    return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  10 THUẬT TOÁN CÂN BẰNG (không copy last)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── [1] Context Match 3-gram: tìm pattern 3 phiên gần nhất trong history ───
function algoContext3(bits) {
    const n = bits.length;
    if (n < 10) return null;
    const ctx = bits.slice(-3);
    let t = 0, x = 0;
    for (let i = 3; i < n - 1; i++) {
        if (bits[i - 3] === ctx[0] && bits[i - 2] === ctx[1] && bits[i - 1] === ctx[2]) {
            if (bits[i] === 1) t++;
            else x++;
        }
    }
    if (t + x < 3) return null;
    const pT = t / (t + x);
    const w = Math.min(1.2 + (t + x) * 0.15, 3.0);
    return { pT, weight: w, name: `Context3 [${ctx.join("")}] n=${t + x}` };
}

// ─── [2] Context Match 4-gram ───
function algoContext4(bits) {
    const n = bits.length;
    if (n < 12) return null;
    const ctx = bits.slice(-4);
    let t = 0, x = 0;
    for (let i = 4; i < n - 1; i++) {
        if (bits[i - 4] === ctx[0] && bits[i - 3] === ctx[1] && bits[i - 2] === ctx[2] && bits[i - 1] === ctx[3]) {
            if (bits[i] === 1) t++;
            else x++;
        }
    }
    if (t + x < 2) return null;
    const pT = t / (t + x);
    const w = Math.min(1.5 + (t + x) * 0.2, 3.2);
    return { pT, weight: w, name: `Context4 [${ctx.join("")}] n=${t + x}` };
}

// ─── [3] Markov Order 2: P(next | last 2) ───
function algoMarkov2(bits) {
    const n = bits.length;
    if (n < 10) return null;
    const a = bits[n - 2], b = bits[n - 1];
    let t = 0, x = 0;
    for (let i = 2; i < n; i++) {
        if (bits[i - 2] === a && bits[i - 1] === b) {
            if (bits[i] === 1) t++;
            else x++;
        }
    }
    if (t + x < 3) return null;
    const pT = t / (t + x);
    return { pT, weight: Math.min(1.5 + (t + x) * 0.1, 3), name: `Markov2 [${a}${b}] n=${t + x}` };
}

// ─── [4] Frequency Balance: lệch nhiều → đảo (contrarian) ───
function algoFreqBalance(bits) {
    const n = bits.length;
    if (n < 20) return null;
    const w = Math.min(n, 30);
    const s = bits.slice(-w);
    const tCount = s.reduce((a, b) => a + b, 0);
    const pT = tCount / w;
    if (Math.abs(pT - 0.5) < 0.15) return null;
    // Nếu T nhiều → dự X; X nhiều → dự T (mean reversion)
    return {
        pT: 1 - pT,
        weight: Math.min(Math.abs(pT - 0.5) * 6, 3),
        name: `FreqBal ${(pT * 100).toFixed(0)}%T/${(1 - pT) * 100 | 0}%X`,
    };
}

// ─── [5] Streak Break: bệt dài → bẻ ───
function algoStreakBreak(bits) {
    const n = bits.length;
    if (n < 10) return null;
    let run = 1;
    for (let i = n - 2; i >= 0; i--) {
        if (bits[i] === bits[n - 1]) run++;
        else break;
    }
    if (run < 4) return null;
    return {
        pT: opp(bits[n - 1]),
        weight: Math.min(1.8 + (run - 4) * 0.5, 4),
        name: `StreakBrk ${run}`,
    };
}

// ─── [6] Streak Follow: bệt ngắn → theo ───
function algoStreakFollow(bits) {
    const n = bits.length;
    if (n < 10) return null;
    let run = 1;
    for (let i = n - 2; i >= 0; i--) {
        if (bits[i] === bits[n - 1]) run++;
        else break;
    }
    if (run < 2 || run > 4) return null;
    return {
        pT: bits[n - 1],
        weight: 1.0 + run * 0.2,
        name: `StreakFol ${run}`,
    };
}

// ─── [7] Alternation Detector: đảo chiều nhiều → đảo tiếp ───
function algoAlternation(bits) {
    const n = bits.length;
    if (n < 10) return null;
    const w = Math.min(n, 10);
    const s = bits.slice(-w);
    let alt = 0;
    for (let i = 1; i < s.length; i++) if (s[i] !== s[i - 1]) alt++;
    const rate = alt / (s.length - 1);
    if (rate < 0.6) return null;
    return {
        pT: opp(bits[n - 1]),
        weight: Math.min((rate - 0.5) * 6, 3),
        name: `Alter ${(rate * 100).toFixed(0)}%`,
    };
}

// ─── [8] Transition Matrix: T→T vs T→X ───
function algoTransition(bits) {
    const n = bits.length;
    if (n < 10) return null;
    let tt = 0, tx = 0, xt = 0, xx = 0;
    for (let i = 1; i < n; i++) {
        if (bits[i - 1] === 1 && bits[i] === 1) tt++;
        else if (bits[i - 1] === 1) tx++;
        else if (bits[i] === 1) xt++;
        else xx++;
    }
    const last = bits[n - 1];
    const stay = last === 1 ? tt : xx;
    const flip = last === 1 ? tx : xt;
    const tot = stay + flip;
    if (tot < 5) return null;
    const pStay = stay / tot;
    return {
        pT: pStay >= 0.5 ? last : opp(last),
        weight: Math.min(Math.abs(pStay - 0.5) * 5, 2.5),
        name: `Trans ${(pStay * 100).toFixed(0)}% stay`,
    };
}

// ─── [9] Momentum: so sánh ngắn vs dài hạn ───
function algoMomentum(bits) {
    const n = bits.length;
    if (n < 20) return null;
    const short = bits.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const long = bits.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const diff = short - long;
    if (Math.abs(diff) < 0.15) return null;
    return {
        pT: diff > 0 ? 1 : 0,
        weight: Math.min(Math.abs(diff) * 5, 2.5),
        name: `Momentum ${diff > 0 ? "↑" : "↓"} ${(Math.abs(diff) * 100).toFixed(0)}%`,
    };
}

// ─── [10] Anti-Momentum: ngược momentum ───
function algoAntiMomentum(bits) {
    const n = bits.length;
    if (n < 20) return null;
    const short = bits.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const long = bits.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const diff = short - long;
    if (Math.abs(diff) < 0.15) return null;
    return {
        pT: diff > 0 ? 0 : 1,
        weight: Math.min(Math.abs(diff) * 4, 2),
        name: `AntiMom ${diff > 0 ? "↓" : "↑"}`,
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PREDICT — Cân bằng + Diagnostic
// ═══════════════════════════════════════════════════════════════════════════════
const ALL_CAU = [cau11, cau12, cau21, cau22, cau33, cau44, cauBet];
const ALL_ALGOS = [
    algoContext3, algoContext4, algoMarkov2, algoFreqBalance,
    algoStreakBreak, algoStreakFollow, algoAlternation,
    algoTransition, algoMomentum, algoAntiMomentum,
];

function predict(seq, lastPoint) {
    const bits = seq.map(x => x === "T" ? 1 : 0);
    if (bits.length < 20) return null;

    const signals = [];

    // Thu thập cầu
    for (const fn of ALL_CAU) {
        try { const s = fn(bits); if (s) signals.push({ ...s, source: "cau" }); } catch (e) {}
    }
    // Thu thập algo
    for (const fn of ALL_ALGOS) {
        try { const s = fn(bits); if (s) signals.push({ ...s, source: "algo" }); } catch (e) {}
    }

    // Điểm từ bảng
    const diem = BANG_DIEM[lastPoint] || null;

    if (!signals.length && !diem) {
        return {
            prediction: "CHỜ", confidence: 0,
            method: "Không có tín hiệu", signals: [],
            continueRatio: 0.5, tScore: 0, xScore: 0,
        };
    }

    // Weighted vote với prior 50/50
    let tScore = 1.0, xScore = 1.0;
    for (const s of signals) {
        const w = s.weight;
        tScore += w * s.pT;
        xScore += w * (1 - s.pT);
    }

    // Thêm điểm vào vote (trọng số cao hơn)
    if (diem) {
        const w = 2.5;
        if (diem.pred === "T") tScore += w;
        else xScore += w;
    }

    const total = tScore + xScore;
    const pT = tScore / total;
    const prediction = pT >= 0.5 ? "TAI" : "XIU";
    let confidence = Math.round(50 + Math.abs(pT - 0.5) * 90);

    // ── Diagnostic: đo continue vs reversal ──
    const lastBit = bits[bits.length - 1];
    let continueW = 0, reversalW = 0;
    let cauContinue = 0, cauReversal = 0, algoContinue = 0, algoReversal = 0;

    for (const s of signals) {
        const predBit = s.pT >= 0.5 ? 1 : 0;
        const isCont = predBit === lastBit;
        if (isCont) {
            continueW += s.weight;
            if (s.source === "cau") cauContinue++; else algoContinue++;
        } else {
            reversalW += s.weight;
            if (s.source === "cau") cauReversal++; else algoReversal++;
        }
    }

    // Điểm cũng tính
    if (diem) {
        const predBit = diem.pred === "T" ? 1 : 0;
        if (predBit === lastBit) continueW += 2.5;
        else reversalW += 2.5;
    }

    const continueRatio = continueW / (continueW + reversalW + 1e-9);
    const predIsContinue = (prediction === "TAI" && lastBit === 1) || (prediction === "XIU" && lastBit === 0);

    // ── Chống copy last ──
    if (reversalW === 0 && continueW > 0) {
        // 100% tiếp tục → chỉ là copy last → cap 52%
        confidence = Math.min(confidence, 52);
    } else if (predIsContinue && continueRatio > 0.85) {
        confidence = Math.min(confidence, 60);
    } else if (!predIsContinue && continueRatio < 0.15) {
        // Prediction đảo nhưng gần như toàn bộ nói continue
        confidence = Math.min(confidence, 56);
    }

    // ── Tăng conf nếu có sự đồng thuận đa dạng ──
    const diversity = (cauContinue > 0 && cauReversal > 0) || (algoContinue > 0 && algoReversal > 0);
    if (diversity && signals.length >= 5 && confidence < 70) {
        confidence = Math.min(72, confidence + 3);
    }

    return {
        prediction,
        confidence: Math.min(95, Math.max(50, confidence)),
        pT,
        continueRatio,
        cauContinue, cauReversal, algoContinue, algoReversal,
        lastBit,
        diem,
        method: `${signals.length} tín hiệu (${cauContinue + cauReversal}c + ${algoContinue + algoReversal}a)` +
                (diem ? ` + điểm ${lastPoint}` : "") +
                ` · continue ${(continueRatio * 100).toFixed(0)}%`,
        signals: signals.sort((a, b) => b.weight - a.weight),
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
        if (st.sessions.length > 1000) st.sessions = st.sessions.slice(-800);
        st.lastId = latest.id;
        console.log(`🆕 [${key.toUpperCase()}] +${news.length}`);
    }

    const recent = st.sessions.slice(-MAX);
    st.latest = recent[recent.length - 1];
    st.pred = predict(recent.map(s => s.r), st.latest.point);
}

async function poll(key) {
    try {
        const json = await fetchJSON(API[key]);
        update(key, parseRows(json));
    } catch (e) {
        console.error(`❌ [${key.toUpperCase()}]`, e.message);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  RESPONSE (7 field gọn)
// ═══════════════════════════════════════════════════════════════════════════════
function buildResp(key) {
    const st = state[key];
    if (!st.latest || !st.pred) return null;
    const last = st.latest, p = st.pred;

    let duDoan = "CHỜ", tyLe = "--";
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

const checkKey = q => q.key === VALID_KEY ? { valid: true } : { valid: false, error: `Sai key! Ib ${ADMIN}` };

// ═══════════════════════════════════════════════════════════════════════════════
//  SERVER
// ═══════════════════════════════════════════════════════════════════════════════
const app = fastify({ logger: false, disableRequestLogging: true });
await app.register(cors, { origin: "*" });

app.get("/", async () => ({
    status: "ok",
    admin: ADMIN,
    engine: `Cân bằng: ${ALL_CAU.length} cầu + ${ALL_ALGOS.length} thuật toán + 16 mức điểm`,
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
    if (!st.latest || !st.pred) return rep.status(503).send({ error: "Chưa đủ dữ liệu" });

    return {
        last: {
            id: st.latest.id_num,
            result: st.latest.r,
            dices: st.latest.dices,
            point: st.latest.point,
        },
        prediction: {
            pred: st.pred.prediction,
            confidence: st.pred.confidence,
            pT: +(st.pred.pT * 100).toFixed(2),
            is_continue: st.pred.prediction === (st.pred.lastBit === 1 ? "TAI" : "XIU"),
        },
        // 🔍 DIAGNOSTIC
        continue_ratio: +(st.pred.continueRatio * 100).toFixed(0) + "%",
        cau:  { continue: st.pred.cauContinue,  reversal: st.pred.cauReversal },
        algo: { continue: st.pred.algoContinue, reversal: st.pred.algoReversal },
        diem_used: st.pred.diem,
        cau_signals: st.pred.signals.filter(s => s.source === "cau"),
        algo_signals: st.pred.signals.filter(s => s.source === "algo"),
    };
});

app.get("/api/bang-diem", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    return BANG_DIEM;
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
║  🎲 TÀI XỈU LC79 — CÂN BẰNG (Cầu + Algo + Điểm)                      ║
╠══════════════════════════════════════════════════════════════════════╣
║  🚀 Port: ${PORT}
║  🔑 Key : ${VALID_KEY}
║  👤 Admin: ${ADMIN}
║
║  📊 7 CẦU: 1-1, 1-2, 2-1, 2-2, 3-3, 4-4, Bệt
║  🧠 10 ALGO CÂN BẰNG:
║     1. Context3      6. Streak Follow
║     2. Context4      7. Alternation
║     3. Markov2       8. Transition
║     4. Freq Balance  9. Momentum
║     5. Streak Break 10. Anti-Momentum
║  📋 16 mức bảng điểm (X3→T18)
║
║  ⚖️  Chống copy-last:
║     • Cap 52% nếu 100% continue
║     • Cap 60% nếu continue > 85%
║     • Bonus +3% nếu có diversity (cả continue & reversal)
║
║  📌 HŨ : /api/taixiu/lc79?key=${VALID_KEY}
║  📌 MD5: /api/taixiumd5/lc79?key=${VALID_KEY}
║  🐞 Debug (xem continue/rev): /api/debug/hu?key=${VALID_KEY}
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