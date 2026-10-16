// ═══════════════════════════════════════════════════════════════════════════════
//  TÀI XỈU LC79 — 10 THUẬT TOÁN + CẦU CƠ BẢN
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
const MAX  = 60;
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
//  10 THUẬT TOÁN PHÂN TÍCH
// ═══════════════════════════════════════════════════════════════════════════════
const A = {};

// [1] Streak — độ dài bệt hiện tại
A.streak = seq => {
    if (!seq.length) return { len: 0, side: null };
    const side = seq[seq.length - 1];
    let len = 1;
    for (let i = seq.length - 2; i >= 0; i--) {
        if (seq[i] === side) len++;
        else break;
    }
    return { len, side };
};

// [2] Frequency — tỷ lệ Tài trong N phiên
A.freq = (seq, w = 20) => {
    const s = seq.slice(-w);
    if (!s.length) return 0.5;
    return s.filter(x => x === "T").length / s.length;
};

// [3] Markov chain — P(next | last k)
A.markov = (seq, order = 2) => {
    if (seq.length < order + 5) return null;
    const ctx = seq.slice(-order).join("");
    let t = 0, x = 0;
    for (let i = order; i < seq.length; i++) {
        if (seq.slice(i - order, i).join("") === ctx) {
            if (seq[i] === "T") t++;
            else x++;
        }
    }
    const tot = t + x;
    if (tot < 3) return null;
    return { pT: t / tot, n: tot };
};

// [4] Alternating — chuỗi đảo chiều
A.alternating = seq => {
    const s = seq.slice(-10);
    if (s.length < 4) return null;
    let alt = 0;
    for (let i = 1; i < s.length; i++) if (s[i] !== s[i - 1]) alt++;
    return { rate: alt / (s.length - 1), last: s[s.length - 1] };
};

// [5] Momentum — so sánh ngắn vs dài hạn
A.momentum = seq => {
    const short = A.freq(seq, 5);
    const long  = A.freq(seq, 20);
    return short - long;
};

// [6] Entropy — độ hỗn loạn
A.entropy = seq => {
    const s = seq.slice(-30);
    if (!s.length) return 1;
    const p = s.filter(x => x === "T").length / s.length;
    if (p <= 0 || p >= 1) return 0;
    return -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
};

// [7] Mean reversion — hồi quy trung bình
A.meanRev = seq => {
    const p = A.freq(seq, 15);
    if (p > 0.7) return -1;
    if (p < 0.3) return 1;
    return 0;
};

// [8] Transition matrix — T→T vs X→X
A.trans = seq => {
    if (seq.length < 8) return null;
    let tt = 0, tx = 0, xt = 0, xx = 0;
    for (let i = 1; i < seq.length; i++) {
        if (seq[i-1] === "T" && seq[i] === "T") tt++;
        else if (seq[i-1] === "T") tx++;
        else if (seq[i] === "T") xt++;
        else xx++;
    }
    const last = seq[seq.length - 1];
    if (last === "T") {
        const tot = tt + tx;
        if (tot < 3) return null;
        return { pT: tt / tot, n: tot };
    }
    const tot = xt + xx;
    if (tot < 3) return null;
    return { pT: xt / tot, n: tot };
};

// [9] Cycle — chu kỳ lặp (đơn giản)
A.cycle = seq => {
    for (let P = 2; P <= 8; P++) {
        if (seq.length < P * 3) continue;
        const tail = seq.slice(-P * 3);
        let m = 0;
        for (let i = 0; i < tail.length - P; i++) if (tail[i] === tail[i + P]) m++;
        const score = m / (tail.length - P);
        if (score >= 0.85) {
            return { P, pred: seq[seq.length - P] };
        }
    }
    return null;
};

// [10] Bayesian — Beta(a,b) với decay
A.bayes = seq => {
    const s = seq.slice(-30);
    let a = 1, b = 1;
    for (let i = 0; i < s.length; i++) {
        const w = Math.pow(0.95, s.length - 1 - i);
        if (s[i] === "T") a += w;
        else b += w;
    }
    return a / (a + b);
};

// ═══════════════════════════════════════════════════════════════════════════════
//  CẦU CƠ BẢN
// ═══════════════════════════════════════════════════════════════════════════════

// [C1] Cầu bệt — theo/bẻ
function cauBet(seq) {
    const st = A.streak(seq);
    if (st.len < 2) return null;
    if (st.len >= 3 && st.len <= 5) {
        return { pred: st.side, conf: 62 + (st.len - 3) * 3, note: `Bệt ${st.len} → theo` };
    }
    if (st.len === 6) {
        return { pred: st.side, conf: 63, note: `Bệt 6 → theo` };
    }
    if (st.len >= 7 && st.len <= 9) {
        return { pred: st.side === "T" ? "X" : "T", conf: 75, note: `Bệt ${st.len} → BẺ` };
    }
    if (st.len >= 10) {
        return { pred: st.side === "T" ? "X" : "T", conf: 82, note: `Bệt ${st.len} → BẺ mạnh` };
    }
    return null;
}

// [C2] Cầu 1-1 (T-X-T-X)
function cau11(seq) {
    if (seq.length < 4) return null;
    const r = seq.slice(-4);
    if (r[0] !== r[1] && r[1] !== r[2] && r[2] !== r[3]) {
        return { pred: r[3] === "T" ? "X" : "T", conf: 72, note: "Cầu 1-1 → đảo" };
    }
    return null;
}

// [C3] Cầu 2-2 (TT-XX)
function cau22(seq) {
    if (seq.length < 4) return null;
    const r = seq.slice(-4);
    if (r[0] === r[1] && r[2] === r[3] && r[0] !== r[2]) {
        return { pred: r[0], conf: 75, note: "Cầu 2-2 → theo" };
    }
    return null;
}

// [C4] Cầu 3-3 (TTT-XXX)
function cau33(seq) {
    if (seq.length < 6) return null;
    const r = seq.slice(-6);
    if (r[0] === r[1] && r[1] === r[2] && r[3] === r[4] && r[4] === r[5] && r[0] !== r[3]) {
        return { pred: r[0], conf: 78, note: "Cầu 3-3 → theo" };
    }
    return null;
}

// [C5] Cầu 2-1 (TT-X)
function cau21(seq) {
    if (seq.length < 3) return null;
    const r = seq.slice(-3);
    if (r[0] === r[1] && r[0] !== r[2]) {
        return { pred: r[0], conf: 68, note: "Cầu 2-1 → tiếp" };
    }
    return null;
}

// [C6] Cầu 1-2 (T-XX)
function cau12(seq) {
    if (seq.length < 3) return null;
    const r = seq.slice(-3);
    if (r[0] !== r[1] && r[1] === r[2]) {
        return { pred: r[0], conf: 68, note: "Cầu 1-2 → tiếp" };
    }
    return null;
}

// [C7] Cầu 3-1 (TTT-X)
function cau31(seq) {
    if (seq.length < 4) return null;
    const r = seq.slice(-4);
    if (r[0] === r[1] && r[1] === r[2] && r[2] !== r[3]) {
        return { pred: r[0], conf: 72, note: "Cầu 3-1 → tiếp" };
    }
    return null;
}

// [C8] Nhịp 1-2-1
function cauNhip121(seq) {
    if (seq.length < 4) return null;
    const r = seq.slice(-4);
    if (r[0] !== r[1] && r[1] === r[2] && r[2] !== r[3]) {
        return { pred: r[1], conf: 70, note: "Nhịp 1-2-1" };
    }
    return null;
}

// [C9] Cầu mặt xúc xắc
function cauDice(dice) {
    if (!dice || dice.length < 3) return null;
    const [a, b, c] = dice;

    // Kép bé (1-1, 2-2) → XỈU
    if ((a === b && a <= 2) || (b === c && b <= 2))
        return { pred: "X", conf: 78, note: `Kép bé [${a}-${b}-${c}] → XỈU` };

    // Kép lớn (5-5, 6-6) → TÀI
    if ((a === b && a >= 5) || (b === c && b >= 5))
        return { pred: "T", conf: 78, note: `Kép lớn [${a}-${b}-${c}] → TÀI` };

    // 2 mặt 6 → XỈU
    const c6 = dice.filter(x => x === 6).length;
    if (c6 === 2) return { pred: "X", conf: 82, note: "2 mặt 6 → XỈU" };

    // 2 mặt 1 → TÀI
    const c1 = dice.filter(x => x === 1).length;
    if (c1 === 2) return { pred: "T", conf: 72, note: "2 mặt 1 → TÀI" };

    // Gánh (a-b-a) → ĐẢO
    if (a === c && a !== b) return { pred: "ĐẢO", conf: 82, note: `Gánh [${a}-${b}-${a}]` };

    // Tiến (1-2-3) → TÀI
    if (a + 1 === b && b + 1 === c) return { pred: "T", conf: 75, note: `Tiến [${a}-${b}-${c}]` };

    // Lùi (6-5-4) → XỈU
    if (a - 1 === b && b - 1 === c) return { pred: "X", conf: 75, note: `Lùi [${a}-${b}-${c}]` };

    return null;
}

// [C10] Cầu tổng điểm
function cauTong(point) {
    if (!point || point < 3 || point > 18) return null;
    if (point >= 17) return { pred: "X", conf: 70, note: `Tổng ${point} → XỈU` };
    if (point <= 4)  return { pred: "T", conf: 70, note: `Tổng ${point} → TÀI` };
    if (point === 10) return { pred: "T", conf: 75, note: "Tổng 10 → TÀI" };
    if (point === 11) return { pred: "X", conf: 72, note: "Tổng 11 → XỈU" };
    if (point === 14) return { pred: "X", conf: 68, note: "Tổng 14 → XỈU" };
    if (point === 18) return { pred: "T", conf: 85, note: "Tổng 18 → TÀI" };
    return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DỰ ĐOÁN TỔNG HỢP
// ═══════════════════════════════════════════════════════════════════════════════
function predict(sessions) {
    if (sessions.length < 10) return null;

    const seq = sessions.map(s => s.r);
    const last = sessions[sessions.length - 1];
    const signals = [];

    // ── 10 thuật toán phân tích ──
    const st   = A.streak(seq);
    const f20  = A.freq(seq, 20);
    const f10  = A.freq(seq, 10);
    const mk2  = A.markov(seq, 2);
    const mk3  = A.markov(seq, 3);
    const alt  = A.alternating(seq);
    const mom  = A.momentum(seq);
    const ent  = A.entropy(seq);
    const mr   = A.meanRev(seq);
    const tr   = A.trans(seq);
    const cyc  = A.cycle(seq);
    const bay  = A.bayes(seq);

    // 1. Streak
    if (st.len >= 3 && st.len <= 5) {
        signals.push({ src: "Streak", pred: st.side, conf: 60 + st.len * 2 });
    } else if (st.len >= 7) {
        signals.push({ src: "Streak", pred: st.side === "T" ? "X" : "T", conf: 72 });
    }

    // 2. Frequency
    if (f20 > 0.65) signals.push({ src: "Freq20", pred: "X", conf: 62 });
    else if (f20 < 0.35) signals.push({ src: "Freq20", pred: "T", conf: 62 });

    // 3. Markov bậc 2
    if (mk2 && mk2.n >= 5 && Math.abs(mk2.pT - 0.5) > 0.15) {
        signals.push({ src: "Markov2", pred: mk2.pT > 0.5 ? "T" : "X", conf: 60 + Math.abs(mk2.pT - 0.5) * 60 });
    }

    // 4. Markov bậc 3
    if (mk3 && mk3.n >= 3 && Math.abs(mk3.pT - 0.5) > 0.2) {
        signals.push({ src: "Markov3", pred: mk3.pT > 0.5 ? "T" : "X", conf: 65 + Math.abs(mk3.pT - 0.5) * 50 });
    }

    // 5. Alternating
    if (alt && alt.rate > 0.7) {
        signals.push({ src: "Alt", pred: alt.last === "T" ? "X" : "T", conf: 68 });
    }

    // 6. Momentum
    if (Math.abs(mom) > 0.15) {
        signals.push({ src: "Momentum", pred: mom > 0 ? "T" : "X", conf: 58 + Math.abs(mom) * 40 });
    }

    // 7. Entropy thấp (đồng nhất cao)
    if (ent < 0.75) {
        signals.push({ src: "Entropy", pred: st.side || "T", conf: 62 });
    }

    // 8. Mean reversion
    if (mr > 0) signals.push({ src: "MeanRev", pred: "T", conf: 62 });
    else if (mr < 0) signals.push({ src: "MeanRev", pred: "X", conf: 62 });

    // 9. Transition
    if (tr && tr.n >= 5 && Math.abs(tr.pT - 0.5) > 0.12) {
        signals.push({ src: "Trans", pred: tr.pT > 0.5 ? "T" : "X", conf: 58 + Math.abs(tr.pT - 0.5) * 50 });
    }

    // 10. Cycle
    if (cyc) signals.push({ src: `Cycle P=${cyc.P}`, pred: cyc.pred, conf: 70 });

    // 11. Bayesian
    if (bay > 0.6) signals.push({ src: "Bayes", pred: "T", conf: 58 + (bay - 0.5) * 40 });
    else if (bay < 0.4) signals.push({ src: "Bayes", pred: "X", conf: 58 + (0.5 - bay) * 40 });

    // ── Cầu cơ bản ──
    const cauList = [
        cauBet(seq),
        cau11(seq),
        cau22(seq),
        cau33(seq),
        cau21(seq),
        cau12(seq),
        cau31(seq),
        cauNhip121(seq),
        cauDice(last.dices),
        cauTong(last.point),
    ];

    for (const c of cauList) {
        if (!c) continue;
        let pred = c.pred;
        if (pred === "ĐẢO") pred = last.r === "T" ? "X" : "T";
        signals.push({ src: `Cầu`, pred, conf: c.conf, note: c.note });
    }

    if (signals.length === 0) {
        return { prediction: "T", confidence: 52, method: "Không có tín hiệu", signals: [] };
    }

    // ── Weighted vote ──
    let tScore = 0, xScore = 0;
    for (const s of signals) {
        const w = s.conf / 100;
        if (s.pred === "T") tScore += w;
        else xScore += w;
    }

    const total = tScore + xScore;
    const prediction = tScore >= xScore ? "TAI" : "XIU";
    const ratio = Math.max(tScore, xScore) / total;
    const confidence = Math.min(95, Math.round(50 + (ratio - 0.5) * 90));
    const agree = signals.filter(s => (s.pred === "T" ? "TAI" : "XIU") === prediction).length;

    return {
        prediction,
        confidence,
        method: `${agree}/${signals.length} tín hiệu đồng thuận`,
        signals: signals.sort((a, b) => b.conf - a.conf),
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
        return;
    }

    if (latest.id_num > st.lastId) {
        const news = arr.filter(r => r.id > st.lastId);
        for (const r of news) st.sessions.push(r);
        if (st.sessions.length > 500) st.sessions = st.sessions.slice(-450);
        st.lastId = latest.id;
        console.log(`🆕 [${key.toUpperCase()}] +${news.length}`);
    }

    // Dự đoán
    const recent = st.sessions.slice(-MAX);
    st.latest = recent[recent.length - 1];
    st.pred = predict(recent);
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

    return {
        Id:          ADMIN,
        Phien_nay:   last.id_num + 1,
        Du_doan:     p.prediction === "TAI" ? "TÀI" : "XỈU",
        Ty_le:       `${p.confidence}%`,
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
    engine: "10 thuật toán + cầu cơ bản",
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
    return {
        last: { id: st.latest.id_num, result: st.latest.r, dice: st.latest.dices, point: st.latest.point },
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
║  🎲 TÀI XỈU LC79 — 10 THUẬT TOÁN + CẦU CƠ BẢN                       ║
╠══════════════════════════════════════════════════════════════════════╣
║  🚀 Port: ${PORT}
║  🔑 Key : ${VALID_KEY}
║  👤 Admin: ${ADMIN}
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