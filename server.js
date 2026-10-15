import fastify from "fastify";
import cors from "@fastify/cors";

// ═══════════════════════════════════════════════════════════════════
//  TÀI XỈU LC79 — FAST BOOT + BẢNG ĐIỂM MỚI
// ═══════════════════════════════════════════════════════════════════
const PORT      = process.env.PORT || 3000;
const VALID_KEY = "Thiên456";
const ADMIN     = "@ADMNLc79";

const API_URL_HU  = "https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5";
const API_URL_MD5 = "https://wtxmd52.tele68.com/v1/txmd5/sessions";

// ═══════════════════════════════════════════════════════════════════
//  FETCH VỚI TIMEOUT + RETRY
// ═══════════════════════════════════════════════════════════════════
async function fetchJSON(url, timeoutMs = 6000, retries = 2) {
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
            await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
        }
    }
}

// ═══════════════════════════════════════════════════════════════════
//  📊 BẢNG MẸO ĐIỂM MỚI (THEO YÊU CẦU)
// ═══════════════════════════════════════════════════════════════════
const BANG_DIEM = {
    // NHÓM XỈU (3-10)
    3:  { pred: "Nghỉ", conf: 0,  note: "X3 → NGHỈ (dữ liệu hiếm)" },
    4:  { pred: "Xỉu",  conf: 65, note: "X4 → XỈU (còn xỉu)" },
    5:  { pred: "Xỉu",  conf: 70, note: "X5 → XỈU (khả năng xỉu 7-9)" },
    6:  { pred: "Tài",  conf: 65, note: "X6 → TÀI (tài to)" },
    7:  { pred: "Xỉu",  conf: 55, note: "X7 → XỈU nhẹ (có thể bỏ)" },
    8:  { pred: "Tài",  conf: 75, note: "X8 → TÀI (tài 11 hoặc 13)" },
    9:  { pred: "Tài",  conf: 65, note: "X9 → TÀI (Tài Bé)" },
    10: { pred: "Tài",  conf: 80, note: "X10 → TÀI (Tài 11-12)" },
    // NHÓM TÀI (11-18)
    11: { pred: "Xỉu",  conf: 75, note: "T11 → XỈU (hay về Xỉu)" },
    12: { pred: "Tài",  conf: 70, note: "T12 → TÀI (sang cầu bệt)" },
    13: { pred: "Tài",  conf: 70, note: "T13 → TÀI (theo cầu)" },
    14: { pred: "Xỉu",  conf: 60, note: "T14 → XỈU (nhỏ vốn)" },
    15: { pred: "Xỉu",  conf: 70, note: "T15 → XỈU (xỉu cao)" },
    16: { pred: "Tài",  conf: 70, note: "T16 → TÀI (Tài Bé 11-12)" },
    17: { pred: "Tài",  conf: 60, note: "T17 → TÀI (nhỏ vốn)" },
    18: { pred: "Tài",  conf: 90, note: "T18 → ALL TÀI (Tài cao vẫn còn)" }
};

// ═══════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════
function getStreakLen(history, maxCheck = 20) {
    if (!history.length) return 1;
    const last = history[0].result;
    let n = 1;
    for (let i = 1; i < Math.min(history.length, maxCheck); i++) {
        if (history[i]?.result === last) n++;
        else break;
    }
    return n;
}

function streakList(history, maxCheck = 30) {
    if (!history.length) return [];
    const out = [];
    let t = history[0].result, l = 1;
    for (let i = 1; i < Math.min(history.length, maxCheck); i++) {
        if (history[i].result === t) l++;
        else { out.push({ type: t, len: l }); t = history[i].result; l = 1; }
    }
    out.push({ type: t, len: l });
    return out;
}

// ═══════════════════════════════════════════════════════════════════
//  CẦU XÚC XẮC
// ═══════════════════════════════════════════════════════════════════
function cauMatXucXac(dice) {
    if (!dice || dice.length < 3) return null;
    const [a, b, c] = dice;

    if ((a === b && a <= 2) || (b === c && b <= 2))
        return { pred: "Xỉu", conf: 80, note: `Kép Bé [${a}-${b}-${c}] → XỈU` };
    if ((a === b && a >= 5) || (b === c && b >= 5))
        return { pred: "Tài", conf: 80, note: `Kép Lớn [${a}-${b}-${c}] → TÀI` };
    if ((a === b && a === 3) || (b === c && b === 3))
        return { pred: "Xỉu", conf: 65, note: `Kép 3 → XỈU` };
    if ((a === b && a === 4) || (b === c && b === 4))
        return { pred: "Tài", conf: 65, note: `Kép 4 → TÀI` };

    const c6 = dice.filter(x => x === 6).length;
    if (c6 === 2) return { pred: "Xỉu", conf: 85, note: "2 mặt 6 → XỈU" };
    const c1 = dice.filter(x => x === 1).length;
    if (c1 === 2) return { pred: "Tài", conf: 75, note: "2 mặt 1 → TÀI" };

    if (a === c && a !== b) return { pred: "Đảo", conf: 85, note: `Gánh [${a}-${b}-${a}] → ĐẢO` };
    if (a + 1 === b && b + 1 === c) return { pred: "Tài", conf: 78, note: `Tiến [${a}-${b}-${c}] → TÀI` };
    if (a - 1 === b && b - 1 === c) return { pred: "Xỉu", conf: 78, note: `Lùi [${a}-${b}-${c}] → XỈU` };

    const sum = a + b + c;
    if (sum >= 17) return { pred: "Xỉu", conf: 70, note: `Tổng ${sum} → XỈU` };
    if (sum <= 4)  return { pred: "Tài", conf: 70, note: `Tổng ${sum} → TÀI` };
    return null;
}

// ═══════════════════════════════════════════════════════════════════
//  CẦU BỆT + CHU KỲ
// ═══════════════════════════════════════════════════════════════════
function cauBet(history, lenBET, lastResult) {
    if (lenBET >= 3 && lenBET <= 5) return { pred: lastResult, conf: 62 + (lenBET - 3) * 3, note: `Bệt ${lenBET} → theo` };
    if (lenBET === 6)               return { pred: lastResult, conf: 63, note: `Bệt 6 → theo` };
    if (lenBET >= 7 && lenBET <= 9) {
        const brk = lastResult === "Tài" ? "Xỉu" : "Tài";
        return { pred: brk, conf: 75, note: `Bệt ${lenBET} → bẻ` };
    }
    if (lenBET >= 10) {
        const brk = lastResult === "Tài" ? "Xỉu" : "Tài";
        return { pred: brk, conf: 82, note: `Bệt ${lenBET} → BẺ MẠNH` };
    }
    return null;
}

function cau11(history) {
    if (history.length < 4) return null;
    const r = history.slice(0, 4).map(h => h.result);
    if (r[0] !== r[1] && r[1] !== r[2] && r[2] !== r[3])
        return { pred: r[3] === "Tài" ? "Xỉu" : "Tài", conf: 72, note: "Cầu 1-1 → đảo" };
    return null;
}

function cau22(history) {
    if (history.length < 4) return null;
    const r = history.slice(0, 4).map(h => h.result);
    if (r[0] === r[1] && r[2] === r[3] && r[0] !== r[2])
        return { pred: r[0], conf: 75, note: "Cầu 2-2 → theo" };
    return null;
}

function cau33(history) {
    if (history.length < 6) return null;
    const r = history.slice(0, 6).map(h => h.result);
    if (r[0] === r[1] && r[1] === r[2] && r[3] === r[4] && r[4] === r[5] && r[0] !== r[3])
        return { pred: r[0], conf: 78, note: "Cầu 3-3 → theo" };
    return null;
}

function cau21(history) {
    if (history.length < 6) return null;
    const r = history.slice(0, 6).map(h => h.result);
    if (r[0] === r[1] && r[1] !== r[2] && r[3] === r[4] && r[4] !== r[5] && r[0] !== r[3])
        return { pred: r[0], conf: 74, note: "Cầu 2-1 → theo" };
    return null;
}

function cau12(history) {
    if (history.length < 6) return null;
    const r = history.slice(0, 6).map(h => h.result);
    if (r[0] !== r[1] && r[1] === r[2] && r[3] !== r[4] && r[4] === r[5] && r[0] === r[3])
        return { pred: r[0], conf: 74, note: "Cầu 1-2 → theo" };
    return null;
}

function cau31(history) {
    if (history.length < 8) return null;
    const r = history.slice(0, 8).map(h => h.result);
    if (r[0] === r[1] && r[1] === r[2] && r[2] !== r[3] &&
        r[4] === r[5] && r[5] === r[6] && r[6] !== r[7] &&
        r[0] === r[4] && r[3] === r[7])
        return { pred: r[0], conf: 76, note: "Cầu 3-1 → theo" };
    return null;
}

function cau13(history) {
    if (history.length < 8) return null;
    const r = history.slice(0, 8).map(h => h.result);
    if (r[0] !== r[1] && r[1] === r[2] && r[2] === r[3] &&
        r[3] !== r[4] && r[4] === r[5] && r[5] === r[6] && r[0] === r[4])
        return { pred: r[0], conf: 76, note: "Cầu 1-3 → theo" };
    return null;
}

function cau23(history) {
    if (history.length < 5) return null;
    const r = history.slice(0, 5).map(h => h.result);
    if (r[0] === r[1] && r[2] === r[3] && r[3] === r[4] && r[0] !== r[2])
        return { pred: r[0], conf: 72, note: "Cầu 2-3 → theo" };
    return null;
}

function cau32(history) {
    if (history.length < 5) return null;
    const r = history.slice(0, 5).map(h => h.result);
    if (r[0] === r[1] && r[1] === r[2] && r[3] === r[4] && r[0] !== r[3])
        return { pred: r[0], conf: 72, note: "Cầu 3-2 → theo" };
    return null;
}

function cauNhip3(history) {
    if (history.length < 10) return null;
    const st = streakList(history, 14);
    if (st.length < 7) return null;
    const lens = st.slice(1, 8).map(s => s.len);
    const check = (P) => {
        for (let start = 0; start < P.length; start++) {
            let ok = true;
            for (let i = 0; i < P.length * 2; i++)
                if (lens[i] !== P[(start + i) % P.length]) { ok = false; break; }
            if (ok) return true;
        }
        return false;
    };
    if (check([1, 2, 1])) return { pred: st[0].type, conf: 75, note: "Nhịp 1-2-1" };
    if (check([2, 1, 2])) return { pred: st[0].type, conf: 75, note: "Nhịp 2-1-2" };
    if (check([1, 3, 1])) return { pred: st[0].type, conf: 73, note: "Nhịp 1-3-1" };
    if (check([3, 1, 3])) return { pred: st[0].type, conf: 73, note: "Nhịp 3-1-3" };
    if (check([1, 2, 3])) return { pred: st[0].type, conf: 70, note: "Nhịp 1-2-3" };
    if (check([3, 2, 1])) return { pred: st[0].type, conf: 70, note: "Nhịp 3-2-1" };
    return null;
}

function xuLyBao(dice) {
    if (!dice || dice.length < 3) return null;
    if (dice[0] === dice[1] && dice[1] === dice[2])
        return { pred: "Nghỉ", conf: 0, note: `BÃO [${dice[0]}-${dice[0]}-${dice[0]}]` };
    return null;
}

// ═══════════════════════════════════════════════════════════════════
//  DỰ ĐOÁN TỔNG HỢP
// ═══════════════════════════════════════════════════════════════════
function predictCombo(history) {
    if (!history || history.length < 3)
        return { prediction: "Tài", confidence: 50, reason: "Chưa có dữ liệu", total: null };

    const last = history[0];
    const lastTotal = last.total;
    const lastDice = last.dice;
    const lastResult = last.result;
    const lenBET = getStreakLen(history);

    // BÃO ưu tiên cao nhất
    const bao = xuLyBao(lastDice);
    if (bao) return { prediction: "Nghỉ", confidence: 0, reason: bao.note, total: lastTotal, isBao: true };

    const signals = [];

    // Bảng điểm (ưu tiên cao nhất sau bão)
    const diem = BANG_DIEM[lastTotal];
    if (diem && diem.pred !== "Nghỉ") {
        signals.push({ pred: diem.pred, conf: diem.conf, note: diem.note, priority: 100, source: "Bảng điểm" });
    }

    // Cầu mặt xúc xắc
    const cauMat = cauMatXucXac(lastDice);
    if (cauMat) {
        let pred = cauMat.pred;
        if (pred === "Đảo") pred = lastResult === "Tài" ? "Xỉu" : "Tài";
        signals.push({ pred, conf: cauMat.conf, note: cauMat.note, priority: 90, source: "Mặt XX" });
    }

    // Cầu bệt
    const bet = cauBet(history, lenBET, lastResult);
    if (bet) signals.push({ ...bet, priority: 85, source: "Bệt" });

    // Các cầu chu kỳ
    for (const [fn, prio, name] of [
        [cau33, 82, "3-3"], [cau31, 80, "3-1"], [cau13, 80, "1-3"],
        [cau22, 78, "2-2"], [cau21, 78, "2-1"], [cau12, 78, "1-2"],
        [cau32, 76, "3-2"], [cau23, 76, "2-3"], [cauNhip3, 74, "Nhịp3"],
        [cau11, 72, "1-1"]
    ]) {
        const r = fn(history);
        if (r) signals.push({ ...r, priority: prio, source: `Cầu ${name}` });
    }

    // Sắp xếp và chọn tín hiệu tốt nhất
    signals.sort((a, b) => b.priority - a.priority || b.conf - a.conf);
    const best = signals[0];

    if (best) {
        return {
            prediction: best.pred,
            confidence: Math.min(98, Math.max(55, best.conf)),
            reason: best.note,
            total: lastTotal,
            doDaiBET: lenBET,
            source: best.source,
        };
    }

    return {
        prediction: "Xỉu", confidence: 55,
        reason: "Cầu loạn, ưu tiên Xỉu",
        total: lastTotal, doDaiBET: lenBET,
    };
}

// ═══════════════════════════════════════════════════════════════════
//  PARSE
// ═══════════════════════════════════════════════════════════════════
function parseLinesHu(data) {
    if (!data?.list || !Array.isArray(data.list)) return [];
    return data.list.sort((a, b) => b.id - a.id).map(item => ({
        session: item.id, dice: item.dices, total: item.point,
        result: item.point >= 11 ? "Tài" : "Xỉu",
        result_vn: item.point >= 11 ? "Tài" : "Xỉu",
    })).sort((a, b) => a.session - b.session);
}

function parseLinesMd5(data) {
    if (!data?.list || !Array.isArray(data.list)) return [];
    return data.list.sort((a, b) => b.id - a.id).map(item => ({
        session: item.id, dice: item.dices, total: item.point,
        result: item.resultTruyenThong === "Tài" ? "Tài" : "Xỉu",
        result_vn: item.resultTruyenThong,
    })).sort((a, b) => a.session - b.session);
}

// ═══════════════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════════════
let huHistory = [];
let md5History = [];
let idHu = null, idMd5 = null;
let lastFetchHu = 0, lastFetchMd5 = 0;

// ═══════════════════════════════════════════════════════════════════
//  FETCH
// ═══════════════════════════════════════════════════════════════════
async function fetchHu() {
    try {
        const data = await fetchJSON(API_URL_HU, 6000, 2);
        const arr = parseLinesHu(data);
        if (!arr.length) return;
        const latest = arr.at(-1).session;
        if (!idHu) {
            huHistory = arr; idHu = latest;
            console.log(`✅ [HŨ] ${arr.length} phiên`);
        } else if (latest > idHu) {
            const news = arr.filter(r => r.session > idHu);
            for (const r of news) huHistory.unshift(r);
            if (huHistory.length > 500) huHistory.length = 450;
            idHu = latest;
            console.log(`🆕 [HŨ] +${news.length}`);
        }
        lastFetchHu = Date.now();
    } catch (e) { console.error(`❌ [HŨ]`, e.message); }
}

async function fetchMd5() {
    try {
        const data = await fetchJSON(API_URL_MD5, 6000, 2);
        const arr = parseLinesMd5(data);
        if (!arr.length) return;
        const latest = arr.at(-1).session;
        if (!idMd5) {
            md5History = arr; idMd5 = latest;
            console.log(`✅ [MD5] ${arr.length} phiên`);
        } else if (latest > idMd5) {
            const news = arr.filter(r => r.session > idMd5);
            for (const r of news) md5History.unshift(r);
            if (md5History.length > 500) md5History.length = 450;
            idMd5 = latest;
            console.log(`🆕 [MD5] +${news.length}`);
        }
        lastFetchMd5 = Date.now();
    } catch (e) { console.error(`❌ [MD5]`, e.message); }
}

// ═══════════════════════════════════════════════════════════════════
//  CHECK KEY
// ═══════════════════════════════════════════════════════════════════
const checkKey = q =>
    q.key === VALID_KEY
        ? { valid: true }
        : { valid: false, error: `Sai key! Ib ${ADMIN}` };

// ═══════════════════════════════════════════════════════════════════
//  RESPONSE BUILDER
// ═══════════════════════════════════════════════════════════════════
function buildResp(history, game) {
    if (history.length < 3) return null;
    const last = history[0];
    const pred = predictCombo(history);
    const last5 = history.slice(0, 5).map((v, i) => ({
        stt: i + 1, result: v.result_vn, total: v.total,
        dice: `${v.dice[0]}-${v.dice[1]}-${v.dice[2]}`,
    }));
    const res = {
        Id: ADMIN,
        Game: game,
        Phien_truoc: last.session,
        Xuc_xac: `${last.dice[0]} - ${last.dice[1]} - ${last.dice[2]}`,
        Ket_qua: last.result_vn.toLowerCase(),
        Tong: last.total,
        Phien_nay: last.session + 1,
        Du_doan: pred.prediction === "Tài" ? "tài" : pred.prediction === "Xỉu" ? "xỉu" : "nghỉ",
        Do_tin_cay: `${pred.confidence}%`,
        Ly_do: pred.reason,
        Biet_hien_tai: `${pred.doDaiBET} ván`,
        Nguon_cau: pred.source || "Tổng hợp",
    };
    if (pred.isBao) res.Canh_bao = "⚠️ BÃO - NGHỈ 3 PHIÊN ⚠️";
    res["5_van_gan_nhat"] = last5;
    return res;
}

// ═══════════════════════════════════════════════════════════════════
//  SERVER
// ═══════════════════════════════════════════════════════════════════
const app = fastify({ logger: false, disableRequestLogging: true });
app.register(cors, { origin: "*" });

// ─── HEALTHCHECK ───
app.get("/", async () => ({
    status: "ok",
    admin: ADMIN,
    hu_loaded: huHistory.length,
    md5_loaded: md5History.length,
    hu_age: lastFetchHu ? Math.floor((Date.now() - lastFetchHu) / 1000) + "s" : "never",
    md5_age: lastFetchMd5 ? Math.floor((Date.now() - lastFetchMd5) / 1000) + "s" : "never",
}));

// ─── API HŨ ───
app.get("/api/taixiu/lc79", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const r = buildResp(huHistory, "HŨ");
    return r || rep.status(503).send({ error: "Đang tải dữ liệu HŨ..." });
});

app.get("/api/taixiu/lc79/history", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    return huHistory.slice(0, 30).map(i => ({
        session: i.session, dice: i.dice, total: i.total, result: i.result_vn.toLowerCase(),
    }));
});

// ─── API MD5 ───
app.get("/api/taixiumd5/lc79", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const r = buildResp(md5History, "MD5");
    return r || rep.status(503).send({ error: "Đang tải dữ liệu MD5..." });
});

app.get("/api/taixiumd5/lc79/history", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    return md5History.slice(0, 30).map(i => ({
        session: i.session, dice: i.dice, total: i.total, result: i.result_vn.toLowerCase(),
    }));
});

// ─── BẢNG ĐIỂM ───
app.get("/api/bang-diem", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    return {
        bang_diem: BANG_DIEM,
        admin: ADMIN,
        note: "Bảng điểm mới — X3 nghỉ, X10/X8/X9 Tài, T11/T14/T15 Xỉu, T18 All Tài",
    };
});

// ─── CHECK KEY ───
app.get("/check-key", async req =>
    req.query.key === VALID_KEY
        ? { status: "success", message: "KEY HỢP LỆ", admin: ADMIN }
        : { status: "error", message: `Sai key! Ib ${ADMIN}` });

// ─── STATS ───
app.get("/api/stats", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    return {
        hu: { length: huHistory.length, last: huHistory[0] || null },
        md5: { length: md5History.length, last: md5History[0] || null },
        admin: ADMIN,
    };
});

// ═══════════════════════════════════════════════════════════════════
//  🚀 BOOT — LISTEN NGAY, FETCH SAU
// ═══════════════════════════════════════════════════════════════════
app.listen({ port: PORT, host: "0.0.0.0" })
    .then(() => {
        console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  🎲 TÀI XỈU LC79 — BẢNG ĐIỂM MỚI                                 ║
╠══════════════════════════════════════════════════════════════════╣
║  🚀 Port: ${PORT}                                                  ║
║  🔑 Key: ${VALID_KEY}                                            ║
║  👤 Admin: ${ADMIN}                                             ║
║                                                                  ║
║  📊 BẢNG ĐIỂM MỚI:                                               ║
║    X3  → NGHỈ                                                    ║
║    X4  → XỈU (còn xỉu) 65%                                      ║
║    X5  → XỈU (7-9) 70%                                          ║
║    X6  → TÀI (tài to) 65%                                       ║
║    X7  → XỈU nhẹ 55%                                            ║
║    X8  → TÀI (11/13) 75%                                        ║
║    X9  → TÀI (Tài Bé) 65%                                       ║
║    X10 → TÀI (11-12) 80%                                        ║
║    T11 → XỈU (hay về) 75%                                       ║
║    T12 → TÀI (cầu bệt) 70%                                      ║
║    T13 → TÀI (theo cầu) 70%                                     ║
║    T14 → XỈU (nhỏ vốn) 60%                                      ║
║    T15 → XỈU (xỉu cao) 70%                                      ║
║    T16 → TÀI (Bé 11-12) 70%                                     ║
║    T17 → TÀI (nhỏ vốn) 60%                                      ║
║    T18 → ALL TÀI 90%                                            ║
║                                                                  ║
║  🎯 API:                                                         ║
║    HŨ : /api/taixiu/lc79?key=${VALID_KEY}                       ║
║    MD5: /api/taixiumd5/lc79?key=${VALID_KEY}                    ║
║    Bảng điểm: /api/bang-diem?key=${VALID_KEY}                   ║
╚══════════════════════════════════════════════════════════════════╝
        `);

        setTimeout(() => {
            fetchHu().catch(() => {});
            fetchMd5().catch(() => {});
        }, 100);

        setInterval(() => fetchHu().catch(() => {}), 6000);
        setInterval(() => fetchMd5().catch(() => {}), 6000);
    })
    .catch(err => {
        console.error("❌ Boot:", err.message);
        process.exit(1);
    });