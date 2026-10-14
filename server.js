import fastify from "fastify";
import cors from "@fastify/cors";
import fetch from "node-fetch";

// ==================== CẤU HÌNH ====================
const PORT = process.env.PORT || 3000;
const VALID_KEY = "Thien456";
const ADMIN = "@ADMNLc79";

const API_URL_HU  = "https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5";
const API_URL_MD5 = "https://wtxmd52.tele68.com/v1/txmd5/sessions";

// ==================== BẢNG MẸO TỔNG ĐIỂM ====================
const BANG_DIEM = {
    3:  { pred: "Xỉu", conf: 70 },
    4:  { pred: "Tài", conf: 60 },
    5:  { pred: "Tài", conf: 70 },
    6:  { pred: "Xỉu", conf: 60 },
    7:  { pred: "Tài", conf: 80 },
    8:  { pred: "Xỉu", conf: 80 },
    9:  { pred: "Xỉu", conf: 70 },
    10: { pred: "Tài", conf: 80 },
    11: { pred: "Xỉu", conf: 60 },
    12: { pred: "Tài", conf: 80 },
    13: { pred: "Tài", conf: 80 },
    14: { pred: "Xỉu", conf: 60 },
    15: { pred: "Xỉu", conf: 70 },
    16: { pred: "Tài", conf: 60 },
    17: { pred: "Xỉu", conf: 60 },
    18: { pred: "Xỉu", conf: 80 }
};

const BANG_DIEM_STR = Object.entries(BANG_DIEM)
    .map(([pt, v]) => `${Number(pt) >= 11 ? "T" : "X"}${pt} - ${v.pred.toUpperCase()} ${v.conf}%`)
    .join(" | ");

// ==================== BẢNG MẸO CẦU ====================
const BANG_CAU = {
    "1-1":    { mo_ta: "T-X-T-X-T-X",           quy_tac: "Mỗi phiên đổi chiều (1-1)",               conf: 80 },
    "1-2":    { mo_ta: "T-XX-T-XX",             quy_tac: "1 rồi 2, đủ 1 đổi, đủ 2 đổi tiếp",         conf: 75 },
    "2-1":    { mo_ta: "TT-X-TT-X",             quy_tac: "2 rồi 1, đủ 2 đổi, đủ 1 đổi tiếp",         conf: 75 },
    "2-2":    { mo_ta: "TT-XX-TT-XX",           quy_tac: "Đủ 2 thì đổi",                            conf: 80 },
    "3-1":    { mo_ta: "TTT-X-TTT-X",           quy_tac: "3 tài rồi 1 xỉu (hoặc ngược lại)",         conf: 73 },
    "1-3":    { mo_ta: "T-XXX-T-XXX",           quy_tac: "1 tài rồi 3 xỉu (hoặc ngược lại)",         conf: 73 },
    "4-1":    { mo_ta: "TTTT-X-TTTT-X",         quy_tac: "4 tài rồi 1 xỉu (hoặc ngược lại)",         conf: 70 },
    "1-4":    { mo_ta: "T-XXXX-T-XXXX",         quy_tac: "1 tài rồi 4 xỉu (hoặc ngược lại)",         conf: 70 },
    "3-3":    { mo_ta: "TTT-XXX-TTT-XXX",       quy_tac: "Đủ 3 thì đổi",                            conf: 75 },
    "1-2-3":  { mo_ta: "T-XX-TTT-T-XX-TTT",     quy_tac: "Nhịp 1-2-3 (tăng dần)",                    conf: 72 },
    "1-3-1":  { mo_ta: "T-XXX-T-T-XXX-T",       quy_tac: "Chu kỳ 1-3-1",                             conf: 70 },
    "bệt":    { mo_ta: "Bệt 5-11 tay",          quy_tac: "Theo bệt đến khi gãy",                    conf: 62 },
    "bệt12+": { mo_ta: "Bệt từ 12 tay trở lên", quy_tac: "Bệt quá dài, theo đến khi gãy mới thôi",  conf: 75 }
};

// ==================== HÀM HỖ TRỢ ====================
function xuLyBao(dice) {
    if (!dice || dice.length < 3) return null;
    if (dice[0] === dice[1] && dice[1] === dice[2]) return { pred: "BÃO", conf: 0 };
    return null;
}

function analyzeStreaks(history) {
    if (!history || history.length === 0) return [];
    const streaks = [];
    let curType = history[0].result_vn;
    let curLen = 1;
    for (let i = 1; i < history.length; i++) {
        const r = history[i].result_vn;
        if (r === curType) curLen++;
        else { streaks.push({ type: curType, len: curLen }); curType = r; curLen = 1; }
    }
    streaks.push({ type: curType, len: curLen });
    return streaks;
}

function detectPeriod(results) {
    if (results.length < 10) return null;
    for (let P = 2; P <= 7; P++) {
        if (results.length < P * 3) continue;
        const checkLen = Math.min(results.length - P, P * 4);
        let matches = 0;
        for (let i = 0; i < checkLen; i++) {
            if (results[i] === results[i + P]) matches++;
        }
        const ratio = matches / checkLen;
        if (ratio >= 0.9) return { period: P, ratio };
    }
    return null;
}

// ==================== CÁC DETECTOR CẦU ====================

// Cầu đồng nhất: 1-1, 2-2, 3-3
function detectUniform(streaks, len, cauName, conf) {
    if (streaks.length < 3) return null;
    const l = streaks.slice(0, 4).map(s => s.len);
    if (l[1] !== len || l[2] !== len) return null;
    const confirmed = l[3] === len;
    const baseConf = confirmed ? conf : conf - 6;

    const curLen  = streaks[0].len;
    const curType = streaks[0].type;
    const opposite = curType === "Tài" ? "Xỉu" : "Tài";

    if (curLen < len) {
        return { pred: curType, conf: baseConf - 5, cau: cauName,
                 source: `cầu ${cauName} (đang chạy ${curLen}/${len})` };
    }
    if (curLen === len) {
        return { pred: opposite, conf: baseConf, cau: cauName,
                 source: `cầu ${cauName} (hoàn tất nhịp ${len})` };
    }
    return null;
}

// Cầu xen kẽ 2 độ dài: 1-2, 2-1, 3-1, 1-3, 4-1, 1-4
function detectAlternating(streaks, lenA, lenB, cauName, conf) {
    if (streaks.length < 5) return null;
    const l = streaks.slice(0, 6).map(s => s.len);

    let phaseLen = null;
    if (l[1] === lenA && l[2] === lenB && l[3] === lenA && l[4] === lenB) phaseLen = lenA;
    else if (l[1] === lenB && l[2] === lenA && l[3] === lenB && l[4] === lenA) phaseLen = lenB;
    else return null;

    const curLen   = streaks[0].len;
    const curType  = streaks[0].type;
    const opposite = curType === "Tài" ? "Xỉu" : "Tài";

    if (curLen < phaseLen) {
        return { pred: curType, conf: conf - 4, cau: cauName,
                 source: `cầu ${cauName} (đang chạy ${curLen}/${phaseLen})` };
    }
    if (curLen === phaseLen) {
        return { pred: opposite, conf, cau: cauName,
                 source: `cầu ${cauName} (hoàn tất nhịp ${phaseLen})` };
    }
    return null;
}

// Nhịp tăng dần 1-2-3 (hoặc giảm dần 3-2-1)
function detectRising(streaks) {
    if (streaks.length < 6) return null;
    const l = streaks.slice(0, 6).map(s => s.len);

    // Pattern: 1,2,3,1,2,3 hoặc 3,2,1,3,2,1
    let startLen = null, sequence = null;
    if (l[1] === 1 && l[2] === 2 && l[3] === 3 && l[4] === 1 && l[5] === 2) {
        startLen = 1; sequence = [1, 2, 3];
    } else if (l[1] === 3 && l[2] === 2 && l[3] === 1 && l[4] === 3 && l[5] === 2) {
        startLen = 3; sequence = [3, 2, 1];
    } else return null;

    // Tìm nhịp hiện tại trong sequence
    const curLen = streaks[0].len;
    const curType = streaks[0].type;
    const opposite = curType === "Tài" ? "Xỉu" : "Tài";

    // Tìm vị trí của curLen trong sequence
    const idx = sequence.indexOf(curLen);
    if (idx === -1) return null;

    const targetLen = sequence[idx];

    if (curLen < targetLen) {
        return { pred: curType, conf: 70, cau: "1-2-3",
                 source: `cầu nhịp 1-2-3 (đang chạy ${curLen}/${targetLen})` };
    }
    if (curLen === targetLen) {
        return { pred: opposite, conf: 72, cau: "1-2-3",
                 source: `cầu nhịp 1-2-3 (hoàn tất nhịp ${targetLen})` };
    }
    return null;
}

// Chu kỳ 1-3-1
function detect131(streaks) {
    if (streaks.length < 5) return null;
    const l = streaks.slice(0, 5).map(s => s.len);

    // Pattern: 1,3,1,3 → nhịp hiện tại là 1 hoặc 3
    if (l[1] === 1 && l[2] === 3 && l[3] === 1 && l[4] === 3) {
        const curLen = streaks[0].len;
        const curType = streaks[0].type;
        const opposite = curType === "Tài" ? "Xỉu" : "Tài";

        if (curLen === 1) {
            return { pred: curType, conf: 68, cau: "1-3-1",
                     source: "cầu chu kỳ 1-3-1 (đang chạy nhịp 1)" };
        }
        if (curLen === 3) {
            return { pred: opposite, conf: 70, cau: "1-3-1",
                     source: "cầu chu kỳ 1-3-1 (hoàn tất nhịp 3)" };
        }
    }
    return null;
}

// ==================== DỰ ĐOÁN THEO CẦU (ƯU TIÊN 1) ====================
function predictByCau(history) {
    if (!history || history.length < 4) return null;

    const streaks = analyzeStreaks(history);
    if (streaks.length < 3) return null;

    const cur = streaks[0];

    // 1. Bệt 12+ tay — cực đoan, theo đến khi gãy
    if (cur.len >= 12) {
        return {
            pred: cur.type, conf: 75, cau: "bệt12+",
            source: `cầu bệt 12+ tay (${cur.len} tay) - theo đến khi gãy`
        };
    }

    // 2. Cầu đồng nhất
    let r;
    r = detectUniform(streaks, 1, "1-1", 80); if (r) return r;
    r = detectUniform(streaks, 2, "2-2", 80); if (r) return r;
    r = detectUniform(streaks, 3, "3-3", 75); if (r) return r;

    // 3. Cầu xen kẽ
    r = detectAlternating(streaks, 1, 2, "1-2", 75); if (r) return r;
    r = detectAlternating(streaks, 2, 1, "2-1", 75); if (r) return r;
    r = detectAlternating(streaks, 3, 1, "3-1", 73); if (r) return r;
    r = detectAlternating(streaks, 1, 3, "1-3", 73); if (r) return r;
    r = detectAlternating(streaks, 4, 1, "4-1", 70); if (r) return r;
    r = detectAlternating(streaks, 1, 4, "1-4", 70); if (r) return r;

    // 4. Nhịp tăng/giảm 1-2-3
    r = detectRising(streaks); if (r) return r;

    // 5. Chu kỳ 1-3-1
    r = detect131(streaks); if (r) return r;

    // 6. Bệt thường (5-11 tay)
    if (cur.len >= 5) {
        return {
            pred: cur.type, conf: 62, cau: "bệt",
            source: `cầu bệt ${cur.len} tay (theo)`
        };
    }

    // 7. Chu kỳ tuần hoàn (fallback trong họ cầu)
    const results = history.map(h => h.result_vn);
    const per = detectPeriod(results);
    if (per) {
        const P = per.period;
        const nextResult = results[P - 1];
        let cauName = `tuần hoàn ${P}`;
        let conf = 70;
        if (P === 2)      { cauName = "1-1"; conf = 80; }
        else if (P === 3) { cauName = "1-2/2-1"; conf = 73; }
        else if (P === 4) { cauName = "2-2"; conf = 78; }
        else if (P === 6) { cauName = "3-3"; conf = 74; }
        return {
            pred: nextResult, conf, cau: cauName,
            source: `cầu tuần hoàn P=${P} (khớp ${Math.round(per.ratio * 100)}%)`
        };
    }

    return null;
}

// ==================== DỰ ĐOÁN THEO ĐIỂM (ƯU TIÊN 2) ====================
function predictByPoint(lastTotal) {
    const entry = BANG_DIEM[lastTotal];
    if (!entry) return null;
    return {
        pred: entry.pred,
        conf: entry.conf,
        cau: `điểm ${lastTotal}`,
        source: `bảng điểm (tổng ${lastTotal})`
    };
}

// ==================== CẢNH BÁO BẺ CẦU ====================
function checkBreakSignal(history) {
    const streaks = analyzeStreaks(history);
    if (streaks.length < 3) return null;

    const cur = streaks[0];
    const prev = streaks[1];

    // Bệt dài >= 7 tay có dấu hiệu gãy
    if (cur.len >= 7 && prev.len <= 2) {
        return {
            warning: `⚠️ Cầu bệt ${cur.len} tay có dấu hiệu sắp gãy`,
            suggest: cur.type === "Tài" ? "Xỉu" : "Tài"
        };
    }

    // Cầu 1-1 dài bất thường
    const l = streaks.slice(0, 6).map(s => s.len);
    if (l[0] === 1 && l[1] === 1 && l[2] === 1 && l[3] === 1 && l[4] === 1) {
        return {
            warning: `⚠️ Cầu 1-1 đã dài, dễ gãy bất ngờ`,
            suggest: cur.type === "Tài" ? "Xỉu" : "Tài"
        };
    }

    return null;
}

// ==================== DỰ ĐOÁN TỔNG HỢP ====================
// THỨ TỰ: BÃO > CẦU > BẢNG ĐIỂM > ĐẢO
function predict(history) {
    if (!history || history.length < 1) {
        return { prediction: "Xỉu", confidence: 50, source: "mặc định", cau: "-" };
    }

    const last = history[0];

    // 1. BÃO → nghỉ
    const bao = xuLyBao(last.dice);
    if (bao) {
        return { prediction: bao.pred, confidence: bao.conf, source: "bão", cau: "bão" };
    }

    // 2. CẦU → ưu tiên tuyệt đối
    const cauPred = predictByCau(history);
    if (cauPred) {
        return {
            prediction: cauPred.pred,
            confidence: cauPred.conf,
            cau: cauPred.cau,
            source: `🎯 ${cauPred.source}`
        };
    }

    // 3. BẢNG ĐIỂM → chỉ dùng khi KHÔNG có cầu
    const pointPred = predictByPoint(Number(last.total));
    if (pointPred) {
        return {
            prediction: pointPred.pred,
            confidence: pointPred.conf,
            cau: pointPred.cau,
            source: `📊 ${pointPred.source} (không có cầu)`
        };
    }

    // 4. Fallback: đảo phiên trước
    const opposite = last.result_vn === "Tài" ? "Xỉu" : "Tài";
    return { prediction: opposite, confidence: 52, source: "mặc định (đảo)", cau: "-" };
}

// ==================== PARSE DỮ LIỆU ====================
function parseLinesHu(data) {
    if (!data || !Array.isArray(data.list)) return [];
    return data.list.map(item => ({
        session: item.id,
        dice: item.dices,
        total: Number(item.point),
        result: Number(item.point) >= 11 ? "Tài" : "Xỉu",
        result_vn: Number(item.point) >= 11 ? "Tài" : "Xỉu"
    })).sort((a, b) => b.session - a.session);
}

function parseLinesMd5(data) {
    if (!data || !Array.isArray(data.list)) return [];
    return data.list.map(item => ({
        session: item.id,
        dice: item.dices,
        total: Number(item.point),
        result: item.resultTruyenThong === 'Tài' ? "Tài" : "Xỉu",
        result_vn: item.resultTruyenThong || (Number(item.point) >= 11 ? "Tài" : "Xỉu")
    })).sort((a, b) => b.session - a.session);
}

// ==================== GLOBAL STATE ====================
let huHistory = [];
let md5History = [];
let currentSessionIdHu = null;
let currentSessionIdMd5 = null;

// ==================== FETCH DATA ====================
async function fetchHuData() {
    try {
        const res = await fetch(API_URL_HU);
        const data = await res.json();
        const newHistory = parseLinesHu(data);
        if (newHistory.length === 0) return;
        const latestSession = newHistory[0].session;

        if (!currentSessionIdHu) {
            huHistory = newHistory;
            currentSessionIdHu = latestSession;
            console.log(`✅ [HŨ] ${newHistory.length} phiên | Mới: ${latestSession} (${newHistory[0].result})`);
        } else if (latestSession > currentSessionIdHu) {
            const newRecords = newHistory.filter(r => r.session > currentSessionIdHu);
            for (let i = newRecords.length - 1; i >= 0; i--) huHistory.unshift(newRecords[i]);
            if (huHistory.length > 500) huHistory = huHistory.slice(0, 450);
            currentSessionIdHu = latestSession;
            console.log(`🆕 [HŨ] +${newRecords.length} | Mới: ${latestSession} (${newHistory[0].result})`);
        }
    } catch (e) { console.error(`❌ [HŨ]:`, e.message); }
}

async function fetchMd5Data() {
    try {
        const res = await fetch(API_URL_MD5);
        const data = await res.json();
        const newHistory = parseLinesMd5(data);
        if (newHistory.length === 0) return;
        const latestSession = newHistory[0].session;

        if (!currentSessionIdMd5) {
            md5History = newHistory;
            currentSessionIdMd5 = latestSession;
            console.log(`✅ [MD5] ${newHistory.length} phiên | Mới: ${latestSession} (${newHistory[0].result})`);
        } else if (latestSession > currentSessionIdMd5) {
            const newRecords = newHistory.filter(r => r.session > currentSessionIdMd5);
            for (let i = newRecords.length - 1; i >= 0; i--) md5History.unshift(newRecords[i]);
            if (md5History.length > 500) md5History = md5History.slice(0, 450);
            currentSessionIdMd5 = latestSession;
            console.log(`🆕 [MD5] +${newRecords.length} | Mới: ${latestSession} (${newHistory[0].result})`);
        }
    } catch (e) { console.error(`❌ [MD5]:`, e.message); }
}

// ==================== KEY CHECK ====================
function checkKey(query) {
    if (!query.key || query.key !== VALID_KEY) {
        return { valid: false, error: `Sai key! Mua key ib ${ADMIN}` };
    }
    return { valid: true };
}

// ==================== BUILD RESPONSE ====================
function buildResponse(history) {
    const last = history[0];
    const pred = predict(history);
    const breakSig = checkBreakSignal(history);

    let duDoan = "nghỉ";
    if (pred.prediction === "Tài") duDoan = "tài";
    else if (pred.prediction === "Xỉu") duDoan = "xỉu";

    const resp = {
        "id": ADMIN,
        "phien_truoc": last.session,
        "xuc_xac": `${last.dice[0]} - ${last.dice[1]} - ${last.dice[2]}`,
        "ket_qua": last.result_vn.toLowerCase(),
        "tong": last.total,
        "phien_nay": last.session + 1,
        "du_doan": duDoan,
        "do_tin_cay": `${pred.confidence}%`,
        "nguon_du_doan": pred.source,
        "cau_phat_hien": pred.cau || "-"
    };

    if (breakSig) {
        resp.canh_bao_be_cau = breakSig.warning;
        resp.goi_y_be = breakSig.suggest === "Tài" ? "tài" : "xỉu";
    }

    return resp;
}

// ==================== FASTIFY SERVER ====================
const app = fastify({ logger: false });
await app.register(cors, { origin: "*" });

app.get("/", async () => ({
    status: "active",
    admin: ADMIN,
    algorithm: "🎲 TÀI XỈU - ƯU TIÊN CẦU → FALLBACK BẢNG ĐIỂM 🎲",
    uu_tien: "BÃO → CẦU → BẢNG ĐIỂM → ĐẢO",
    endpoints: {
        hu: "/api/taixiu/{game}?key=Thien456",
        md5: "/api/taixiumd5/{game}?key=Thien456",
        hu_history: "/api/taixiu/{game}/history?key=Thien456",
        md5_history: "/api/taixiumd5/{game}/history?key=Thien456",
        bang_diem: "/api/bang-diem?key=Thien456",
        bang_cau: "/api/bang-cau?key=Thien456",
        stats: "/api/stats?key=Thien456",
        debug: "/api/debug/{loai}?key=Thien456"
    }
}));

// ==================== API HŨ ====================
app.get("/api/taixiu/:game", async (request, reply) => {
    const k = checkKey(request.query);
    if (!k.valid) return reply.status(401).send({ error: k.error });
    if (huHistory.length < 1) return reply.status(503).send({ error: "Đang tải dữ liệu HŨ..." });
    return buildResponse(huHistory);
});

app.get("/api/taixiu/:game/history", async (request, reply) => {
    const k = checkKey(request.query);
    if (!k.valid) return reply.status(401).send({ error: k.error });
    return huHistory.slice(0, 30).map(i => ({
        phien: i.session, xuc_xac: i.dice, tong: i.total, ket_qua: i.result_vn.toLowerCase()
    }));
});

// ==================== API MD5 ====================
app.get("/api/taixiumd5/:game", async (request, reply) => {
    const k = checkKey(request.query);
    if (!k.valid) return reply.status(401).send({ error: k.error });
    if (md5History.length < 1) return reply.status(503).send({ error: "Đang tải dữ liệu MD5..." });
    return buildResponse(md5History);
});

app.get("/api/taixiumd5/:game/history", async (request, reply) => {
    const k = checkKey(request.query);
    if (!k.valid) return reply.status(401).send({ error: k.error });
    return md5History.slice(0, 30).map(i => ({
        phien: i.session, xuc_xac: i.dice, tong: i.total, ket_qua: i.result_vn.toLowerCase()
    }));
});

// ==================== DEBUG ====================
app.get("/api/debug/:loai", async (request, reply) => {
    const k = checkKey(request.query);
    if (!k.valid) return reply.status(401).send({ error: k.error });

    const hist = request.params.loai === "md5" ? md5History : huHistory;
    if (hist.length < 1) return reply.status(503).send({ error: "Chưa đủ dữ liệu" });

    const last = hist[0];
    const pred = predict(hist);
    const streaks = analyzeStreaks(hist).slice(0, 10);
    const period = detectPeriod(hist.map(h => h.result_vn));
    const cauCheck = predictByCau(hist);
    const pointCheck = predictByPoint(Number(last.total));
    const breakSig = checkBreakSignal(hist);

    return {
        loai: request.params.loai.toUpperCase(),
        so_phien: hist.length,
        phien_moi_nhat: { id: last.session, dice: last.dice, tong: last.total, ket_qua: last.result_vn },
        bang_diem_tra: pointCheck ? { pred: pointCheck.pred, conf: pointCheck.conf } : null,
        cau_tra: cauCheck ? { pred: cauCheck.pred, conf: cauCheck.conf, cau: cauCheck.cau } : null,
        streak_gan_nhat: streaks.map(s => `${s.type === "Tài" ? "T" : "X"}${s.len}`).join(" - "),
        chu_ky_phat_hien: period ? `P=${period.period} (khớp ${Math.round(period.ratio * 100)}%)` : "không phát hiện",
        uu_tien_ap_dung: cauCheck ? "CẦU" : (pointCheck ? "BẢNG ĐIỂM" : "ĐẢO"),
        canh_bao_be_cau: breakSig || null,
        du_doan: pred.prediction,
        do_tin_cay: `${pred.confidence}%`,
        nguon: pred.source,
        cau: pred.cau
    };
});

// ==================== BẢNG ĐIỂM ====================
app.get("/api/bang-diem", async (request, reply) => {
    const k = checkKey(request.query);
    if (!k.valid) return reply.status(401).send({ error: k.error });
    return {
        title: "📊 BẢNG MẸO TỔNG ĐIỂM",
        admin: ADMIN,
        hien_thi: BANG_DIEM_STR,
        bang: Object.fromEntries(
            Object.entries(BANG_DIEM).map(([pt, v]) => [pt, `${v.pred.toUpperCase()} ${v.conf}%`])
        ),
        ghi_chu: "Chỉ dùng khi KHÔNG phát hiện cầu nào",
        bao: "BÃO (3 mặt giống nhau) → NGHỈ 1-3 PHIÊN"
    };
});

// ==================== BẢNG CẦU ====================
app.get("/api/bang-cau", async (request, reply) => {
    const k = checkKey(request.query);
    if (!k.valid) return reply.status(401).send({ error: k.error });
    return {
        title: "📊 BẢNG MẸO CẦU (ƯU TIÊN SỐ 1)",
        admin: ADMIN,
        bang: BANG_CAU,
        thu_tu_uu_tien: [
            "1. Bệt 12+ tay (theo đến khi gãy)",
            "2. Cầu đồng nhất: 1-1, 2-2, 3-3",
            "3. Cầu xen kẽ: 1-2, 2-1, 3-1, 1-3, 4-1, 1-4",
            "4. Nhịp 1-2-3 (tăng/giảm dần)",
            "5. Chu kỳ 1-3-1",
            "6. Bệt thường (5-11 tay)",
            "7. Chu kỳ tuần hoàn (P=2..7)"
        ],
        ghi_chu: "Nếu phát hiện cầu → CHỈ dùng cầu, bỏ qua bảng điểm. Nếu không có cầu → mới dùng bảng điểm.",
        canh_bao_be_cau: "Khi cầu bệt >= 7 tay hoặc cầu 1-1 quá dài (>=5 nhịp) → cảnh báo bẻ cầu với mức cược nhỏ (2-5% vốn)."
    };
});

// ==================== CHECK KEY ====================
app.get("/check-key", async (request) => {
    const k = request.query.key;
    if (k === VALID_KEY) return { status: "success", message: "KEY HỢP LỆ", admin: ADMIN };
    return { status: "error", message: `Sai key! Mua key ib ${ADMIN}` };
});

// ==================== STATS ====================
app.get("/api/stats", async (request, reply) => {
    const k = checkKey(request.query);
    if (!k.valid) return reply.status(401).send({ error: k.error });

    const huTai = huHistory.filter(h => h.result === "Tài").length;
    const md5Tai = md5History.filter(h => h.result === "Tài").length;

    return {
        admin: ADMIN,
        hu: {
            history_length: huHistory.length,
            last_session: huHistory[0]?.session || null,
            last_result: huHistory[0]?.result || null,
            ti_le: huHistory.length ? `${(huTai / huHistory.length * 100).toFixed(1)}% Tài - ${((huHistory.length - huTai) / huHistory.length * 100).toFixed(1)}% Xỉu` : "N/A"
        },
        md5: {
            history_length: md5History.length,
            last_session: md5History[0]?.session || null,
            last_result: md5History[0]?.result || null,
            ti_le: md5History.length ? `${(md5Tai / md5History.length * 100).toFixed(1)}% Tài - ${((md5History.length - md5Tai) / md5History.length * 100).toFixed(1)}% Xỉu` : "N/A"
        }
    };
});

// ==================== START ====================
const start = async () => {
    await Promise.all([fetchHuData(), fetchMd5Data()]);
    setInterval(fetchHuData, 5000);
    setInterval(fetchMd5Data, 5000);

    try {
        await app.listen({ port: PORT, host: "0.0.0.0" });
    } catch (err) {
        console.error("❌ Lỗi khởi động:", err.message);
        process.exit(1);
    }

    console.log(`
╔══════════════════════════════════════════════════════════════╗
║     TÀI XỈU - ƯU TIÊN CẦU → FALLBACK BẢNG ĐIỂM              ║
╠══════════════════════════════════════════════════════════════╣
║  🚀 http://localhost:${PORT}                                    ║
║  🔑 KEY: ${VALID_KEY}                                          ║
║  👤 ADMIN: ${ADMIN}                                       ║
║                                                              ║
║  ⚡ THỨ TỰ ƯU TIÊN:                                          ║
║     1. BÃO → nghỉ                                            ║
║     2. CẦU → ưu tiên tuyệt đối (bỏ qua bảng điểm)            ║
║     3. BẢNG ĐIỂM → chỉ khi không có cầu                      ║
║     4. ĐẢO → fallback cuối                                   ║
║                                                              ║
║  🎯 CẦU HỖ TRỢ:                                              ║
║     1-1, 1-2, 2-1, 2-2, 3-1, 1-3, 4-1, 1-4, 3-3             ║
║     Nhịp 1-2-3, chu kỳ 1-3-1, bệt, bệt 12+                   ║
║     + Cảnh báo bẻ cầu tự động                                ║
║                                                              ║
║  📌 API:                                                     ║
║     HŨ :  /api/taixiu/lc79?key=${VALID_KEY}                 ║
║     MD5:  /api/taixiumd5/lc79?key=${VALID_KEY}              ║
║     DEBUG: /api/debug/hu?key=${VALID_KEY}                   ║
║     BẢNG CẦU: /api/bang-cau?key=${VALID_KEY}                ║
║     BẢNG ĐIỂM: /api/bang-diem?key=${VALID_KEY}              ║
╚══════════════════════════════════════════════════════════════╝
`);
};

start();
