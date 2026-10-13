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
const BANG_DIEM = {
    3:  { pred: "Xỉu", conf: 70 },
    4:  { pred: "Tài", conf: 65 },
    5:  { pred: "Tài", conf: 70 },
    6:  { pred: "Xỉu", conf: 60 },
    7:  { pred: "Tài", conf: 75 },
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

// ==================== XỬ LÝ BÃO ====================
function xuLyBao(dice) {
    if (!dice || dice.length < 3) return null;
    if (dice[0] === dice[1] && dice[1] === dice[2]) {
        return { pred: "BÃO", conf: 0 };
    }
    return null;
}

// ==================== DỰ ĐOÁN ====================
function predict(history) {
    if (!history || history.length < 1) {
        return { prediction: "Xỉu", confidence: 50 };
    }

    const last = history[0];
    const lastTotal = Number(last.total);

    // BÃO → nghỉ
    const bao = xuLyBao(last.dice);
    if (bao) {
        return { prediction: bao.pred, confidence: bao.conf };
    }

    // Tra bảng điểm
    const meo = BANG_DIEM[lastTotal];

    if (meo) {
        return { prediction: meo.pred, confidence: meo.conf };
    }

    // Fallback: điểm không có trong bảng (3 < x < 18)
    return { prediction: last.result, confidence: 52 };
}

// ==================== PARSE DỮ LIỆU ====================
// [0] = MỚI NHẤT
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

    let duDoan = "xỉu";
    if (pred.prediction === "Tài") duDoan = "tài";
    else if (pred.prediction === "Xỉu") duDoan = "xỉu";
    else if (pred.prediction === "BÃO") duDoan = "nghỉ";

    return {
        "id": ADMIN,
        "phien_truoc": last.session,
        "xuc_xac": `${last.dice[0]} - ${last.dice[1]} - ${last.dice[2]}`,
        "ket_qua": last.result_vn.toLowerCase(),
        "tong": last.total,
        "phien_nay": last.session + 1,
        "du_doan": duDoan,
        "do_tin_cay": `${pred.confidence}%`
    };
}

// ==================== FASTIFY SERVER ====================
const app = fastify({ logger: false });
await app.register(cors, { origin: "*" });

app.get("/", async () => ({
    status: "active",
    admin: ADMIN,
    algorithm: "🎲 TÀI XỈU - BẢNG ĐIỂM 🎲",
    endpoints: {
        hu: "/api/taixiu/{game}?key=Thien456",
        md5: "/api/taixiumd5/{game}?key=Thien456",
        hu_history: "/api/taixiu/{game}/history?key=Thien456",
        md5_history: "/api/taixiumd5/{game}/history?key=Thien456",
        bang_diem: "/api/bang-diem?key=Thien456",
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

    return {
        loai: request.params.loai.toUpperCase(),
        so_phien: hist.length,
        phien_moi_nhat: { id: last.session, dice: last.dice, tong: last.total, ket_qua: last.result },
        bang_diem_tra: BANG_DIEM[last.total] || null,
        du_doan: pred.prediction,
        do_tin_cay: `${pred.confidence}%`
    };
});

// ==================== BẢNG ĐIỂM ====================
app.get("/api/bang-diem", async (request, reply) => {
    const k = checkKey(request.query);
    if (!k.valid) return reply.status(401).send({ error: k.error });
    return {
        title: "📊 BẢNG MẸO TỔNG ĐIỂM",
        admin: ADMIN,
        xiu: {
            "3": "XỈU 70%", "4": "TÀI 65%", "5": "TÀI 70%", "6": "XỈU 60%",
            "7": "TÀI 75%", "8": "XỈU 80%", "9": "XỈU 70%", "10": "TÀI 80%"
        },
        tai: {
            "11": "XỈU 60%", "12": "TÀI 80%", "13": "TÀI 80%", "14": "XỈU 60%",
            "15": "XỈU 70%", "16": "TÀI 60%", "17": "XỈU 60%", "18": "XỈU 80%"
        },
        bao: "BÃO (3 mặt giống nhau) → NGHỈ 1-3 PHIÊN"
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
║           TÀI XỈU - BẢNG ĐIỂM (ĐƠN GIẢN)                     ║
╠══════════════════════════════════════════════════════════════╣
║  🚀 http://localhost:${PORT}                                    ║
║  🔑 KEY: ${VALID_KEY}                                          ║
║  👤 ADMIN: ${ADMIN}                                       ║
║                                                              ║
║  📌 API:                                                     ║
║     HŨ :  /api/taixiu/lc79?key=${VALID_KEY}                 ║
║     MD5:  /api/taixiumd5/lc79?key=${VALID_KEY}              ║
╚══════════════════════════════════════════════════════════════╝
`);
};

start();