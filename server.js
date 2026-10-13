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

// ==================== DANH SÁCH CẦU ====================
// Sort theo cycleLen giảm dần (cầu dài ưu tiên trước vì cụ thể hơn)
const CAU_PATTERNS = [
    { name: "3-3", pattern: [3, 3], conf: 78 },
    { name: "4-2", pattern: [4, 2], conf: 76 },
    { name: "4-1", pattern: [4, 1], conf: 76 },
    { name: "3-2", pattern: [3, 2], conf: 75 },
    { name: "2-3", pattern: [2, 3], conf: 75 },
    { name: "1-4", pattern: [1, 4], conf: 75 },
    { name: "3-1", pattern: [3, 1], conf: 74 },
    { name: "1-3", pattern: [1, 3], conf: 74 },
    { name: "2-2", pattern: [2, 2], conf: 75 },
    { name: "2-1", pattern: [2, 1], conf: 72 },
    { name: "1-2", pattern: [1, 2], conf: 72 },
    { name: "1-1", pattern: [1, 1], conf: 75 }
];

// ==================== MATCH CẦU ====================
function matchCau(r, cauDef) {
    const pattern = cauDef.pattern;
    const cycleLen = pattern.reduce((s, x) => s + x, 0);
    if (r.length < cycleLen * 2) return null;

    // Tạo template 1 chu kỳ: [0,0,1,1,...]
    const template = [];
    for (let i = 0; i < pattern.length; i++) {
        for (let j = 0; j < pattern[i]; j++) {
            template.push(i % 2);
        }
    }

    // Thử từng vị trí pos trong chu kỳ (r[0] tương ứng template[pos])
    const maxMatch = Math.min(r.length, cycleLen * 3);
    const matches = [];

    for (let pos = 0; pos < cycleLen; pos++) {
        let ok = true;
        for (let k = 0; k < maxMatch; k++) {
            const tPos = ((pos - k) % cycleLen + cycleLen) % cycleLen;
            const r0Group = template[pos];
            const rkGroup = template[tPos];
            const same = r0Group === rkGroup;
            if (same ? r[k] !== r[0] : r[k] === r[0]) {
                ok = false;
                break;
            }
        }
        if (ok) matches.push(pos);
    }

    if (matches.length === 0) return null;

    // Lấy match đầu tiên
    const pos = matches[0];
    const nextPos = (pos + 1) % cycleLen;
    const r0Group = template[pos];
    const nextGroup = template[nextPos];

    const pred = nextGroup === r0Group
        ? r[0]
        : (r[0] === "Tài" ? "Xỉu" : "Tài");

    return { pred, cau: cauDef.name, conf: cauDef.conf };
}

function nhanDienCau(r) {
    for (const cauDef of CAU_PATTERNS) {
        const res = matchCau(r, cauDef);
        if (res) return res;
    }
    return null;
}

// ==================== XỬ LÝ BÃO ====================
function laBao(dice) {
    return dice && dice.length === 3 && dice[0] === dice[1] && dice[1] === dice[2];
}

// ==================== DỰ ĐOÁN TỔNG HỢP ====================
function predict(history) {
    if (!history || history.length < 1) {
        return { prediction: "Xỉu", confidence: 50 };
    }

    const last = history[0];
    const lastTotal = Number(last.total);
    const r = history.map(h => h.result);
    const doi = (x) => (x === "Tài" ? "Xỉu" : "Tài");

    // ---- 1. BÃO → NGHỈ ----
    if (laBao(last.dice)) {
        return { prediction: "BÃO", confidence: 0 };
    }

    // ---- 2. BỆT 7+ → BẺ NGƯỢC ----
    let bet = 1;
    for (let i = 1; i < r.length; i++) {
        if (r[i] === r[0]) bet++;
        else break;
    }
    if (bet >= 7) {
        return { prediction: doi(r[0]), confidence: 82 };
    }

    // ---- 3. NHẬN DIỆN CẦU ----
    const cauResult = nhanDienCau(r);

    // ---- 4. BẢNG ĐIỂM ----
    const diemMeo = BANG_DIEM[lastTotal];

    // ---- 5. KẾT HỢP ----
    // Cả cầu và điểm đều có
    if (cauResult && diemMeo) {
        if (cauResult.pred === diemMeo.pred) {
            // Đồng thuận → cộng conf
            return {
                prediction: cauResult.pred,
                confidence: Math.min(95, Math.round((cauResult.conf + diemMeo.conf) / 2 + 10))
            };
        } else {
            // Mâu thuẫn → ưu tiên CẦU (cụ thể hơn)
            return { prediction: cauResult.pred, confidence: cauResult.conf };
        }
    }
    // Chỉ có cầu
    if (cauResult) {
        return { prediction: cauResult.pred, confidence: cauResult.conf };
    }

    // ---- 6. BỆT 4-6 → THEO ----
    if (bet >= 4 && bet <= 6) {
        return { prediction: r[0], confidence: Math.min(80, 66 + bet * 2) };
    }

    // ---- 7. CHỈ CÓ ĐIỂM ----
    if (diemMeo) {
        return { prediction: diemMeo.pred, confidence: diemMeo.conf };
    }

    // ---- 8. FALLBACK: theo phiên trước ----
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
    algorithm: "🎲 TÀI XỈU - BẢNG ĐIỂM + CẦU NÂNG CAO 🎲",
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
    const r = hist.map(h => h.result);
    const cauResult = nhanDienCau(r);
    const diemMeo = BANG_DIEM[Number(last.total)];

    let bet = 1;
    for (let i = 1; i < r.length; i++) {
        if (r[i] === r[0]) bet++;
        else break;
    }

    const pred = predict(hist);

    return {
        loai: request.params.loai.toUpperCase(),
        so_phien: hist.length,
        phien_moi_nhat: {
            id: last.session, dice: last.dice, tong: last.total, ket_qua: last.result
        },
        cau_match: cauResult,
        bang_diem_tra: diemMeo || null,
        bet_hien_tai: bet,
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

// ==================== BẢNG CẦU ====================
app.get("/api/bang-cau", async (request, reply) => {
    const k = checkKey(request.query);
    if (!k.valid) return reply.status(401).send({ error: k.error });
    return {
        title: "📊 BẢNG NHẬN DIỆN CẦU",
        admin: ADMIN,
        danh_sach_cau: CAU_PATTERNS.map(c => ({
            cau: c.name,
            do_tin_cay: `${c.conf}%`,
            do_dai_chu_ky: c.pattern.reduce((s, x) => s + x, 0)
        })),
        bet: {
            "Bệt 1-3": "Không tính",
            "Bệt 4-6": "THEO (conf 70-80%)",
            "Bệt 7+": "BẺ (conf 82%)"
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
║      TÀI XỈU - BẢNG ĐIỂM + CẦU NÂNG CAO                      ║
╠══════════════════════════════════════════════════════════════╣
║  🚀 http://localhost:${PORT}                                    ║
║  🔑 KEY: ${VALID_KEY}                                          ║
║  👤 ADMIN: ${ADMIN}                                       ║
║                                                              ║
║  📌 CẦU HỖ TRỢ: 1-1, 1-2, 2-1, 2-2, 3-1, 1-3, 3-2, 2-3,     ║
║                3-3, 4-1, 4-2, 1-4, BET                       ║
║                                                              ║
║  📌 API:                                                     ║
║     HŨ :  /api/taixiu/lc79?key=${VALID_KEY}                 ║
║     MD5:  /api/taixiumd5/lc79?key=${VALID_KEY}              ║
║     DEBUG: /api/debug/hu?key=${VALID_KEY}                   ║
╚══════════════════════════════════════════════════════════════╝
`);
};

start();
