import fastify from "fastify";
import cors from "@fastify/cors";
import fetch from "node-fetch";

// ==================== CẤU HÌNH ====================
const PORT = process.env.PORT || 3000;
const VALID_KEY = "Thien456";
const ADMIN = "@ADMNLc79";

// ==================== API URLs ====================
const API_URL_HU = "https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5";
const API_URL_MD5 = "https://wtxmd52.tele68.com/v1/txmd5/sessions";

// ==================== BẢNG MẸO TỔNG ĐIỂM ====================
// Phân tích từ 501 phiên (341 + 160):
// - Điểm 3-10 luôn Xỉu, điểm 11-18 luôn Tài
// - % dưới đây = xác suất PHIÊN SAU ĐẢO chiều theo Markov chain
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

// ==================== BẢNG MẸO CẦU ====================
const BANG_CAU = {
    "1-1": { mo_ta: "T-X-T-X-T-X (đảo liên tục)", quy_tac: "Mỗi phiên đổi chiều", conf: 78 },
    "1-2": { mo_ta: "T-XX-T-XX (1 rồi 2)", quy_tac: "Đủ 1 đổi, đủ 2 đổi tiếp", conf: 70 },
    "2-1": { mo_ta: "TT-X-TT-X (2 rồi 1)", quy_tac: "Đủ 2 đổi, đủ 1 đổi tiếp", conf: 70 },
    "2-2": { mo_ta: "TT-XX-TT-XX", quy_tac: "Đủ 2 thì đổi", conf: 78 },
    "3-3": { mo_ta: "TTT-XXX-TTT-XXX", quy_tac: "Đủ 3 thì đổi", conf: 72 },
    "bệt": { mo_ta: "Chuỗi dài cùng chiều", quy_tac: "Theo đến khi gãy", conf: 68 }
};

// ==================== XỬ LÝ BÃO ====================
function xuLyBao(dice) {
    if (!dice || dice.length < 3) return null;
    if (dice[0] === dice[1] && dice[1] === dice[2]) {
        return { pred: "BÃO", conf: 0 };
    }
    return null;
}

// ==================== PHÂN TÍCH STREAK ====================
// Trả về mảng [{type, len}] với phần tử [0] = streak hiện tại (mới nhất)
function analyzeStreaks(history) {
    if (!history || history.length === 0) return [];
    const streaks = [];
    let curType = history[0].result_vn;
    let curLen = 1;
    for (let i = 1; i < history.length; i++) {
        const r = history[i].result_vn;
        if (r === curType) curLen++;
        else {
            streaks.push({ type: curType, len: curLen });
            curType = r;
            curLen = 1;
        }
    }
    streaks.push({ type: curType, len: curLen });
    return streaks;
}

// ==================== PHÁT HIỆN CHU KỲ (Period Detection) ====================
// Tìm chu kỳ P (2..7) sao cho r[i] == r[i+P] với >=90% số điểm kiểm tra
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
        if (ratio >= 0.9) {
            return { period: P, ratio };
        }
    }
    return null;
}

// ==================== DỰ ĐOÁN THEO CẦU ====================
function predictByCau(history) {
    if (!history || history.length < 6) return null;

    const results = history.map(h => h.result_vn); // [mới nhất, ...]

    // ---- ƯU TIÊN 1: PHÁT HIỆN CHU KỲ ----
    const per = detectPeriod(results);
    if (per) {
        const P = per.period;
        const nextResult = results[P - 1]; // phần tử tiếp theo trong chu kỳ

        let cauName, conf;
        if (P === 2)      { cauName = "1-1"; conf = 80; }
        else if (P === 3) { cauName = "1-2 hoặc 2-1"; conf = 72; }
        else if (P === 4) { cauName = "2-2"; conf = 78; }
        else if (P === 6) { cauName = "3-3"; conf = 74; }
        else              { cauName = `tuần hoàn ${P}`; conf = 68; }

        return {
            pred: nextResult,
            conf,
            cau: cauName,
            source: `cầu tuần hoàn P=${P} (khớp ${Math.round(per.ratio * 100)}%)`
        };
    }

    // ---- ƯU TIÊN 2: PHÂN TÍCH STREAK ----
    const streaks = analyzeStreaks(history);
    if (streaks.length < 2) return null;

    const cur = streaks[0];
    const curType = cur.type;
    const opposite = curType === "Tài" ? "Xỉu" : "Tài";
    const prev = streaks[1];
    const prev2 = streaks[2];
    const prev3 = streaks[3];

    // Cầu 1-1 (cần 3+ streak len=1 liên tiếp)
    if (prev && prev2 && prev.len === 1 && prev2.len === 1) {
        const isConfirmed = prev3 && prev3.len === 1;
        if (cur.len === 1) {
            return {
                pred: opposite,
                conf: isConfirmed ? 78 : 66,
                cau: "1-1",
                source: isConfirmed ? "cầu 1-1 xác nhận" : "cầu 1-1 (chưa xác nhận)"
            };
        }
    }

    // Cầu 2-2
    if (prev && prev.len === 2 && prev2 && prev2.len === 2) {
        if (cur.len === 2) return { pred: opposite, conf: 78, cau: "2-2", source: "cầu 2-2" };
        if (cur.len === 1) return { pred: curType,  conf: 72, cau: "2-2", source: "cầu 2-2 (bước 1/2)" };
    }

    // Cầu 3-3
    if (prev && prev.len === 3 && prev2 && prev2.len === 3) {
        if (cur.len === 3) return { pred: opposite, conf: 74, cau: "3-3", source: "cầu 3-3" };
        if (cur.len < 3)   return { pred: curType,  conf: 70, cau: "3-3", source: "cầu 3-3" };
    }

    // Cầu 1-2 (mẫu recent: 2,1,2 → cur là đầu phase 1)
    if (prev && prev2 && prev3 &&
        prev.len === 2 && prev2.len === 1 && prev3.len === 2) {
        if (cur.len === 1) return { pred: curType,  conf: 68, cau: "1-2", source: "cầu 1-2" };
        if (cur.len === 2) return { pred: opposite, conf: 72, cau: "1-2", source: "cầu 1-2" };
    }

    // Cầu 2-1 (mẫu recent: 1,2,1 → cur là đầu phase 2)
    if (prev && prev2 && prev3 &&
        prev.len === 1 && prev2.len === 2 && prev3.len === 1) {
        if (cur.len === 1) return { pred: opposite, conf: 68, cau: "2-1", source: "cầu 2-1" };
        if (cur.len === 2) return { pred: curType,  conf: 72, cau: "2-1", source: "cầu 2-1" };
    }

    // Bệt cầu (streak dài)
    if (cur.len >= 5) {
        return { pred: opposite, conf: 62, cau: "bệt-bẻ", source: "cầu bệt (bẻ)" };
    }
    if (cur.len >= 3 && prev && prev.len >= 3) {
        return { pred: curType, conf: 68, cau: "bệt", source: "cầu bệt" };
    }

    return null;
}

// ==================== DỰ ĐOÁN THEO ĐIỂM ====================
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

// ==================== DỰ ĐOÁN TỔNG HỢP ====================
function predict(history) {
    if (!history || history.length < 1) {
        return { prediction: "Xỉu", confidence: 50, source: "mặc định", cau: "-" };
    }

    const last = history[0];
    const lastTotal = Number(last.total);

    // BÃO → nghỉ
    const bao = xuLyBao(last.dice);
    if (bao) {
        return { prediction: bao.pred, confidence: bao.conf, source: "bão", cau: "bão" };
    }

    const pointPred = predictByPoint(lastTotal);
    const cauPred = predictByCau(history);

    // ---- KẾT HỢP 2 NGUỒN ----
    if (pointPred && cauPred) {
        if (pointPred.pred === cauPred.pred) {
            // ĐỒNG THUẬN → tăng độ tin cậy
            const avg = Math.round((pointPred.conf + cauPred.conf) / 2);
            const conf = Math.min(95, avg + 12);
            return {
                prediction: pointPred.pred,
                confidence: conf,
                cau: cauPred.cau,
                source: `✅ ${cauPred.source} + ${pointPred.source} (ĐỒNG THUẬN)`
            };
        } else {
            // XUNG ĐỘT → ưu tiên cầu
            return {
                prediction: cauPred.pred,
                confidence: Math.max(55, cauPred.conf - 3),
                cau: cauPred.cau,
                source: `⚠️ ${cauPred.source} (xung đột ${pointPred.source})`
            };
        }
    }

    if (cauPred) return { prediction: cauPred.pred, confidence: cauPred.conf, source: cauPred.source, cau: cauPred.cau };
    if (pointPred) return { prediction: pointPred.pred, confidence: pointPred.conf, source: pointPred.source, cau: pointPred.cau };

    // Fallback: đảo chiều phiên trước
    const opposite = last.result_vn === "Tài" ? "Xỉu" : "Tài";
    return { prediction: opposite, confidence: 52, source: "mặc định (đảo)", cau: "-" };
}

// ==================== PARSE DỮ LIỆU ====================
function parseLinesHu(data) {
    if (!data || !Array.isArray(data.list)) return [];
    return data.list
        .map(item => ({
            session: item.id,
            dice: item.dices,
            total: Number(item.point),
            result: Number(item.point) >= 11 ? "Tài" : "Xỉu",
            result_vn: Number(item.point) >= 11 ? "Tài" : "Xỉu"
        }))
        .sort((a, b) => b.session - a.session);
}

function parseLinesMd5(data) {
    if (!data || !Array.isArray(data.list)) return [];
    return data.list
        .map(item => ({
            session: item.id,
            dice: item.dices,
            total: Number(item.point),
            result: item.resultTruyenThong === 'Tài' ? "Tài" : "Xỉu",
            result_vn: item.resultTruyenThong || (Number(item.point) >= 11 ? "Tài" : "Xỉu")
        }))
        .sort((a, b) => b.session - a.session);
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
    } catch (e) {
        console.error(`❌ [HŨ]:`, e.message);
    }
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
    } catch (e) {
        console.error(`❌ [MD5]:`, e.message);
    }
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

    let duDoan = "nghỉ";
    if (pred.prediction === "Tài") duDoan = "tài";
    else if (pred.prediction === "Xỉu") duDoan = "xỉu";

    return {
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
}

// ==================== FASTIFY SERVER ====================
const app = fastify({ logger: false });
await app.register(cors, { origin: "*" });

app.get("/", async () => ({
    status: "active",
    admin: ADMIN,
    algorithm: "🎲 TÀI XỈU - CẦU + BẢNG ĐIỂM (KẾT HỢP 2 TẦNG) 🎲",
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

    return {
        loai: request.params.loai.toUpperCase(),
        so_phien: hist.length,
        phien_moi_nhat: { id: last.session, dice: last.dice, tong: last.total, ket_qua: last.result_vn },
        bang_diem_tra: BANG_DIEM[last.total] || null,
        streak_gan_nhat: streaks.map(s => `${s.type === "Tài" ? "T" : "X"}${s.len}`).join(" - "),
        chu_ky_phat_hien: period ? `P=${period.period} (khớp ${Math.round(period.ratio * 100)}%)` : "không phát hiện",
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
        title: "📊 BẢNG MẸO TỔNG ĐIỂM (Markov Chain)",
        admin: ADMIN,
        bang: Object.fromEntries(
            Object.entries(BANG_DIEM).map(([pt, v]) => [pt, `${v.pred.toUpperCase()} ${v.conf}%`])
        ),
        ghi_chu: "Số % = xác suất PHIÊN SAU có kết quả như trên (dựa vào tổng điểm phiên trước)",
        bao: "BÃO (3 mặt giống nhau) → NGHỈ 1-3 PHIÊN"
    };
});

// ==================== BẢNG CẦU ====================
app.get("/api/bang-cau", async (request, reply) => {
    const k = checkKey(request.query);
    if (!k.valid) return reply.status(401).send({ error: k.error });
    return {
        title: "📊 BẢNG MẸO CẦU (Period + Streak Detection)",
        admin: ADMIN,
        bang: BANG_CAU,
        thuat_toan: {
            buoc_1: "Quét lịch sử, tìm chu kỳ P (2-7) khớp ≥90%",
            buoc_2: "Nếu có chu kỳ → dự đoán theo chu kỳ (conf 68-80%)",
            buoc_3: "Nếu không → phân tích streak (1-1, 2-2, 3-3, 1-2, 2-1, bệt)",
            buoc_4: "Kết hợp với bảng điểm → đồng thuận +12% conf, xung đột ưu tiên cầu"
        }
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
║     TÀI XỈU - CẦU + BẢNG ĐIỂM (KẾT HỢP 2 TẦNG)              ║
╠══════════════════════════════════════════════════════════════╣
║  🚀 http://localhost:${PORT}                                    ║
║  🔑 KEY: ${VALID_KEY}                                          ║
║  👤 ADMIN: ${ADMIN}                                       ║
║                                                              ║
║  📌 API:                                                     ║
║     HŨ :  /api/taixiu/lc79?key=${VALID_KEY}                 ║
║     MD5:  /api/taixiumd5/lc79?key=${VALID_KEY}              ║
║     DEBUG: /api/debug/hu?key=${VALID_KEY}                   ║
║     BẢNG CẦU: /api/bang-cau?key=${VALID_KEY}                ║
╚══════════════════════════════════════════════════════════════╝
`);
};

start();                                             
