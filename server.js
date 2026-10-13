import fastify from "fastify";
import cors from "@fastify/cors";
import fetch from "node-fetch";

// ==================== CẤU HÌNH ====================
const PORT = process.env.PORT || 3000;
const VALID_KEY = "Thien456";
const ADMIN = "@ADMNLc79";

// ==================== API URLs (API GỐC) ====================
const API_URL_HU = "https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5";
const API_URL_MD5 = "https://wtxmd52.tele68.com/v1/txmd5/sessions";

// ==================== BẢNG BẮT ĐIỂM "HỐT BẠC" ====================
const BANG_DIEM = {
    // NHÓM XỈU (3-10)
    3:  { pred: "Nghỉ", conf: 0,  note: "X3 dữ liệu hiếm" },
    4:  { pred: "Tài",  conf: 90, note: "X4 ALL TÀI" },
    5:  { pred: "Tài",  conf: 70, note: "X5 TÀI" },
    6:  { pred: "Tài",  conf: 80, note: "X6 ALL TÀI" },
    7:  { pred: "Xỉu",  conf: 80, note: "X7 BỆT XỈU" },
    8:  { pred: "Tài",  conf: 85, note: "X8 ALL TÀI" },
    9:  { pred: "Xỉu",  conf: 80, note: "X9 ALL XỈU" },
    10: { pred: "Tài",  conf: 90, note: "X10 ALL TÀI" },
    // NHÓM TÀI (11-18)
    11: { pred: "Xỉu",  conf: 85, note: "T11 ALL XỈU" },
    12: { pred: "Tài",  conf: 70, note: "T12 BỆT TÀI" },
    13: { pred: "Xỉu",  conf: 70, note: "T13 XỈU" },
    14: { pred: "Xỉu",  conf: 95, note: "T14 SIÊU XỈU" },
    15: { pred: "Tài",  conf: 70, note: "T15 ALL TÀI" },
    16: { pred: "Xỉu",  conf: 85, note: "T16 ALL XỈU" },
    17: { pred: "Xỉu",  conf: 90, note: "T17 ALL XỈU" },
    18: { pred: "Xỉu",  conf: 100, note: "T18 BẺ XỈU 100%" }
};

// ==================== DỰ ĐOÁN CHỈ DÙNG BẢNG ĐIỂM ====================
function predictByScore(diceHistory) {
    if (!diceHistory || diceHistory.length === 0) {
        return {
            prediction: "Tài",
            confidence: 50,
            reason: "Chưa có dữ liệu"
        };
    }

    const lastTotal = diceHistory[0].total;
    const diemMeo = BANG_DIEM[lastTotal];

    // Nếu tổng điểm có trong bảng
    if (diemMeo) {
        if (diemMeo.pred === "Nghỉ") {
            return {
                prediction: "Nghỉ",
                confidence: 0,
                reason: diemMeo.note
            };
        }
        return {
            prediction: diemMeo.pred,
            confidence: diemMeo.conf,
            reason: diemMeo.note
        };
    }

    // Fallback nếu điểm ngoài bảng (không xảy ra với xúc xắc 3-18)
    return {
        prediction: "Xỉu",
        confidence: 55,
        reason: "Điểm ngoài bảng, ưu tiên Xỉu"
    };
}

// ==================== PARSE DỮ LIỆU ====================
function parseLinesHu(data) {
    if (!data || !Array.isArray(data.list)) return [];
    return data.list
        .sort((a, b) => b.id - a.id)
        .map(item => ({
            session: item.id,
            dice: item.dices,
            total: item.point,
            result: item.point >= 11 ? "Tài" : "Xỉu",
            result_vn: item.point >= 11 ? "Tài" : "Xỉu",
            timestamp: Date.now()
        }))
        .sort((a, b) => a.session - b.session);
}

function parseLinesMd5(data) {
    if (!data || !Array.isArray(data.list)) return [];
    return data.list
        .sort((a, b) => b.id - a.id)
        .map(item => ({
            session: item.id,
            dice: item.dices,
            total: item.point,
            result: item.resultTruyenThong === 'Tài' ? "Tài" : "Xỉu",
            result_vn: item.resultTruyenThong,
            timestamp: Date.now()
        }))
        .sort((a, b) => a.session - b.session);
}

// ==================== GLOBAL STATE ====================
let huHistory = [];
let md5History = [];
let currentSessionIdHu = null;
let currentSessionIdMd5 = null;

// ==================== FETCH DATA ====================
async function fetchHuData() {
    try {
        const response = await fetch(API_URL_HU);
        const data = await response.json();
        const newHistory = parseLinesHu(data);
        if (newHistory.length === 0) return;

        const lastSession = newHistory.at(-1);

        if (!currentSessionIdHu) {
            huHistory = newHistory;
            currentSessionIdHu = lastSession.session;
            console.log(`✅ [HŨ] Đã tải ${newHistory.length} phiên`);
        } else if (lastSession.session > currentSessionIdHu) {
            const newRecords = newHistory.filter(r => r.session > currentSessionIdHu);
            for (const record of newRecords) huHistory.unshift(record);
            if (huHistory.length > 500) huHistory = huHistory.slice(0, 450);
            currentSessionIdHu = lastSession.session;
            if (newRecords.length > 0) console.log(`🆕 [HŨ] +${newRecords.length} phiên`);
        }
    } catch (e) {
        console.error(`❌ [HŨ] Lỗi:`, e.message);
    }
}

async function fetchMd5Data() {
    try {
        const response = await fetch(API_URL_MD5);
        const data = await response.json();
        const newHistory = parseLinesMd5(data);
        if (newHistory.length === 0) return;

        const lastSession = newHistory.at(-1);

        if (!currentSessionIdMd5) {
            md5History = newHistory;
            currentSessionIdMd5 = lastSession.session;
            console.log(`✅ [MD5] Đã tải ${newHistory.length} phiên`);
        } else if (lastSession.session > currentSessionIdMd5) {
            const newRecords = newHistory.filter(r => r.session > currentSessionIdMd5);
            for (const record of newRecords) md5History.unshift(record);
            if (md5History.length > 500) md5History = md5History.slice(0, 450);
            currentSessionIdMd5 = lastSession.session;
            if (newRecords.length > 0) console.log(`🆕 [MD5] +${newRecords.length} phiên`);
        }
    } catch (e) {
        console.error(`❌ [MD5] Lỗi:`, e.message);
    }
}

// ==================== KEY CHECK ====================
function checkKey(query) {
    const userKey = query.key;
    if (!userKey || userKey !== VALID_KEY) {
        return { valid: false, error: `Sai key! Mua key ib ${ADMIN}` };
    }
    return { valid: true };
}

// ==================== BUILD JSON RESPONSE ====================
function buildResponse(history) {
    const lastResult = history[0];
    const prediction = predictByScore(history);

    return {
        "id": ADMIN,
        "phien_truoc": lastResult.session,
        "xuc_xac": `${lastResult.dice[0]} - ${lastResult.dice[1]} - ${lastResult.dice[2]}`,
        "ket_qua": lastResult.result_vn.toLowerCase(),
        "tong": lastResult.total,
        "phien_nay": lastResult.session + 1,
        "du_doan": prediction.prediction === "Tài" ? "tài" : (prediction.prediction === "Xỉu" ? "xỉu" : "nghỉ"),
        "do_tin_cay": `${prediction.confidence}%`,
        "ly_do": prediction.reason
    };
}

// ==================== FASTIFY SERVER ====================
const app = fastify({ logger: false });
await app.register(cors, { origin: "*" });

// Route gốc
app.get("/", async () => ({
    status: "active",
    admin: ADMIN,
    algorithm: "🎲 TÀI XỈU VIP - BẢNG ĐIỂM HỐT BẠC 🎲",
    endpoints: {
        hu: "/api/taixiu/{ten_game}?key=" + VALID_KEY,
        md5: "/api/taixiumd5/{ten_game}?key=" + VALID_KEY,
        hu_history: "/api/taixiu/{ten_game}/history?key=" + VALID_KEY,
        md5_history: "/api/taixiumd5/{ten_game}/history?key=" + VALID_KEY,
        bang_diem: "/api/bang-diem?key=" + VALID_KEY,
        stats: "/api/stats?key=" + VALID_KEY,
        check_key: "/check-key?key=" + VALID_KEY
    }
}));

// ==================== API HŨ ====================
app.get("/api/taixiu/:game", async (request, reply) => {
    const keyCheck = checkKey(request.query);
    if (!keyCheck.valid) return reply.status(401).send({ error: keyCheck.error });

    if (huHistory.length < 3) {
        return reply.status(503).send({ error: "Đang phân tích dữ liệu HŨ, vui lòng chờ...", need: "Cần ít nhất 3 phiên" });
    }

    return buildResponse(huHistory);
});

// History HŨ
app.get("/api/taixiu/:game/history", async (request, reply) => {
    const keyCheck = checkKey(request.query);
    if (!keyCheck.valid) return reply.status(401).send({ error: keyCheck.error });

    return [...huHistory]
        .sort((a, b) => b.session - a.session)
        .slice(0, 30)
        .map(i => ({
            phien: i.session,
            xuc_xac: i.dice,
            tong: i.total,
            ket_qua: i.result_vn.toLowerCase()
        }));
});

// ==================== API MD5 ====================
app.get("/api/taixiumd5/:game", async (request, reply) => {
    const keyCheck = checkKey(request.query);
    if (!keyCheck.valid) return reply.status(401).send({ error: keyCheck.error });

    if (md5History.length < 3) {
        return reply.status(503).send({ error: "Đang phân tích dữ liệu MD5, vui lòng chờ...", need: "Cần ít nhất 3 phiên" });
    }

    return buildResponse(md5History);
});

// History MD5
app.get("/api/taixiumd5/:game/history", async (request, reply) => {
    const keyCheck = checkKey(request.query);
    if (!keyCheck.valid) return reply.status(401).send({ error: keyCheck.error });

    return [...md5History]
        .sort((a, b) => b.session - a.session)
        .slice(0, 30)
        .map(i => ({
            phien: i.session,
            xuc_xac: i.dice,
            tong: i.total,
            ket_qua: i.result_vn.toLowerCase()
        }));
});

// ==================== BẢNG ĐIỂM ====================
app.get("/api/bang-diem", async (request, reply) => {
    const keyCheck = checkKey(request.query);
    if (!keyCheck.valid) return reply.status(401).send({ error: keyCheck.error });

    return {
        title: "📊 BẢNG ĐIỂM HỐT BẠC 📊",
        admin: ADMIN,
        xiu: {
            "3":  "NGHỈ (Dữ liệu hiếm)",
            "4":  "TÀI 90%",
            "5":  "TÀI 70%",
            "6":  "TÀI 80%",
            "7":  "XỈU 80%",
            "8":  "TÀI 85%",
            "9":  "XỈU 80%",
            "10": "TÀI 90%"
        },
        tai: {
            "11": "XỈU 85%",
            "12": "TÀI 70%",
            "13": "XỈU 70%",
            "14": "XỈU 95%",
            "15": "TÀI 70%",
            "16": "XỈU 85%",
            "17": "XỈU 90%",
            "18": "XỈU 100%"
        }
    };
});

// ==================== CHECK KEY ====================
app.get("/check-key", async (request) => {
    const userKey = request.query.key;
    if (!userKey) return { status: "error", message: `Sai key! Mua key ib ${ADMIN}` };
    if (userKey === VALID_KEY) return { status: "success", message: "KEY HỢP LỆ", key: VALID_KEY, admin: ADMIN };
    return { status: "error", message: `Sai key! Mua key ib ${ADMIN}` };
});

// ==================== STATS ====================
app.get("/api/stats", async (request, reply) => {
    const keyCheck = checkKey(request.query);
    if (!keyCheck.valid) return reply.status(401).send({ error: keyCheck.error });

    const huTai = huHistory.filter(h => h.result === "Tài").length;
    const md5Tai = md5History.filter(h => h.result === "Tài").length;

    return {
        admin: ADMIN,
        hu: {
            history_length: huHistory.length,
            last_session: huHistory[0]?.session || null,
            ti_le: huHistory.length > 0
                ? `${(huTai / huHistory.length * 100).toFixed(1)}% Tài - ${((huHistory.length - huTai) / huHistory.length * 100).toFixed(1)}% Xỉu`
                : "Chưa có dữ liệu"
        },
        md5: {
            history_length: md5History.length,
            last_session: md5History[0]?.session || null,
            ti_le: md5History.length > 0
                ? `${(md5Tai / md5History.length * 100).toFixed(1)}% Tài - ${((md5History.length - md5Tai) / md5History.length * 100).toFixed(1)}% Xỉu`
                : "Chưa có dữ liệu"
        },
        algorithm: "BẢNG ĐIỂM HỐT BẠC",
        key: VALID_KEY
    };
});

// ==================== START SERVER ====================
const start = async () => {
    await Promise.all([fetchHuData(), fetchMd5Data()]);
    setInterval(fetchHuData, 5000);
    setInterval(fetchMd5Data, 5000);

    try {
        await app.listen({ port: PORT, host: "0.0.0.0" });
    } catch (err) {
        console.error("❌ Lỗi khởi động server:", err.message);
        process.exit(1);
    }

    console.log(`
╔══════════════════════════════════════════════════════════════╗
║     TÀI XỈU - BẢNG ĐIỂM HỐT BẠC                              ║
╠══════════════════════════════════════════════════════════════╣
║  🚀 Server: http://localhost:${PORT}                            ║
║  🔑 KEY: ${VALID_KEY}                                          ║
║  👤 ADMIN: ${ADMIN}                                       ║
╚══════════════════════════════════════════════════════════════╝
`);
};

start();
