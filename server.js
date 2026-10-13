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

// ==================== BẢNG MẸO TỔNG ĐIỂM (TỪ 8 FILE - 1872 PHIÊN) ====================
const BANG_DIEM = {
    // NHÓM XỈU (3-10)
    3:  { pred: "Xỉu", conf: 70, note: "X3 Bệt Xỉu nhỏ" },
    4:  { pred: "Tài", conf: 60, note: "X4 Bật Tài hồi" },
    5:  { pred: "Tài", conf: 70, note: "X5 Tài rất hay nổ" },
    6:  { pred: "Xỉu", conf: 60, note: "X6 Đứng Xỉu tiếp" },
    7:  { pred: "Tài", conf: 80, note: "X7 Mở Tài cực mạnh" },
    8:  { pred: "Xỉu", conf: 80, note: "X8 Bệt Xỉu tiếp" },
    9:  { pred: "Xỉu", conf: 70, note: "X9 Nghiêng Xỉu" },
    10: { pred: "Tài", conf: 80, note: "X10 Gãy sang Tài" },
    // NHÓM TÀI (11-18)
    11: { pred: "Xỉu", conf: 60, note: "T11 Hồi Xỉu" },
    12: { pred: "Tài", conf: 80, note: "T12 Bệt Tài" },
    13: { pred: "Tài", conf: 80, note: "T13 Nghiêng Tài" },
    14: { pred: "Xỉu", conf: 60, note: "T14 Dễ gãy" },
    15: { pred: "Xỉu", conf: 70, note: "T15 Về Xỉu" },
    16: { pred: "Tài", conf: 60, note: "T16 Hay nhảy Tài" },
    17: { pred: "Xỉu", conf: 60, note: "T17 Về Xỉu" },
    18: { pred: "Xỉu", conf: 80, note: "T18 Bẻ Xỉu mạnh" }
};

// ==================== NHẬN DIỆN CẦU (TỪ FILE) ====================
// history[0] = phiên mới nhất
function nhanDienCau(history) {
    if (!history || history.length < 8) return null;
    const r = history.map(h => h.result); // "Tài" | "Xỉu"

    // ---- 1. BỆT ----
    let bet = 1;
    for (let i = 1; i < history.length; i++) {
        if (r[i] === r[0]) bet++;
        else break;
    }
    if (bet >= 7) {
        return {
            pred: r[0] === "Tài" ? "Xỉu" : "Tài",
            conf: 80,
            note: `Bệt ${bet} tay BẺ NGƯỢC`
        };
    }
    if (bet >= 4 && bet <= 6) {
        return {
            pred: r[0],
            conf: Math.min(80, 66 + bet * 2),
            note: `Bệt ${bet} tay THEO TIẾP`
        };
    }

    // ---- 2. CẦU 1-1 (T-X-T-X-T-X) ----
    if (r[0] !== r[1] && r[1] !== r[2] && r[2] !== r[3] && r[3] !== r[4] && r[4] !== r[5]) {
        return {
            pred: r[0] === "Tài" ? "Xỉu" : "Tài",
            conf: 75,
            note: "Cầu 1-1 (T-X-T-X) ĐẢO"
        };
    }

    // ---- 3. CẦU 2-2 (TT-XX-TT-XX) ----
    if (r[0] === r[1] && r[2] === r[3] && r[4] === r[5] && r[0] !== r[2] && r[2] !== r[4]) {
        return {
            pred: r[0] === "Tài" ? "Xỉu" : "Tài",
            conf: 75,
            note: "Cầu 2-2 (TT-XX-TT-XX) ĐẢO"
        };
    }

    // ---- 4. CẦU 3-3 (TTT-XXX-TTT-XXX) ----
    if (r[0] === r[1] && r[1] === r[2] && r[3] === r[4] && r[4] === r[5] && r[0] !== r[3]) {
        return {
            pred: r[0] === "Tài" ? "Xỉu" : "Tài",
            conf: 78,
            note: "Cầu 3-3 (TTT-XXX) ĐẢO CHU KỲ"
        };
    }

    // ---- 5. CẦU 3-1 (TTT-X-TTT-X) ----
    if (r[0] === r[1] && r[1] === r[2] && r[3] !== r[2] && r[4] === r[3] && r[5] === r[3] && r[6] !== r[3]) {
        return {
            pred: r[3],
            conf: 72,
            note: "Cầu 3-1 (TTT-X) THEO NHỊP"
        };
    }

    // ---- 6. CẦU 2-1 (AA-B-AA-B) ----
    if (r[0] === r[1] && r[2] !== r[1] && r[3] === r[2] && r[4] !== r[3] && r[5] === r[4]) {
        return {
            pred: r[2],
            conf: 70,
            note: "Cầu 2-1 (AA-B-AA-B) THEO"
        };
    }

    // ---- 7. CẦU 1-2 (A-BB-A-BB) ----
    if (r[0] !== r[1] && r[1] === r[2] && r[3] !== r[2] && r[4] === r[3] && r[5] !== r[4]) {
        return {
            pred: r[0],
            conf: 70,
            note: "Cầu 1-2 (A-BB-A-BB) THEO"
        };
    }

    // ---- 8. CẦU 1-2-1 (A-BB-A) ngắn ----
    if (r[0] !== r[1] && r[1] === r[2] && r[2] !== r[3] && r[0] === r[3]) {
        return {
            pred: r[1],
            conf: 68,
            note: "Cầu 1-2-1 (A-BB-A) THEO BB"
        };
    }

    // ---- 9. CẦU 2-1-2 (AA-B-AA) ngắn ----
    if (r[0] === r[1] && r[1] !== r[2] && r[2] === r[3] && r[0] === r[3]) {
        return {
            pred: r[2],
            conf: 68,
            note: "Cầu 2-1-2 (AA-B-AA) THEO AA"
        };
    }

    return null;
}

// ==================== XỬ LÝ BÃO ====================
function xuLyBao(dice) {
    if (!dice || dice.length < 3) return null;
    if (dice[0] === dice[1] && dice[1] === dice[2]) {
        return {
            pred: "Nghỉ",
            conf: 0,
            note: `BÃO [${dice[0]}-${dice[0]}-${dice[0]}] Dừng 1-3 phiên`
        };
    }
    return null;
}

// ==================== DỰ ĐOÁN TỔNG HỢP: CẦU + ĐIỂM ====================
function predictCombo(history) {
    if (!history || history.length < 3) {
        return { prediction: "Tài", confidence: 50, reason: "Chưa đủ dữ liệu", total: null };
    }

    const lastResult = history[0];
    const lastTotal = lastResult.total;
    const lastDice = lastResult.dice;

    // 1. BÃO
    const bao = xuLyBao(lastDice);
    if (bao) {
        return {
            prediction: bao.pred,
            confidence: bao.conf,
            reason: bao.note,
            total: lastTotal,
            isBao: true
        };
    }

    // 2. MẸO ĐIỂM
    const diemMeo = BANG_DIEM[lastTotal];

    // 3. MẸO CẦU
    const cauMeo = nhanDienCau(history);

    // 4. KẾT HỢP
    let finalPrediction, finalConf, finalReason;

    if (diemMeo && cauMeo) {
        if (diemMeo.pred === cauMeo.pred) {
            // ĐỒNG THUẬN
            finalPrediction = diemMeo.pred;
            finalConf = Math.min(95, Math.round((diemMeo.conf + cauMeo.conf) / 2 + 12));
            finalReason = `ĐỒNG THUẬN (Điểm: ${diemMeo.note} | Cầu: ${cauMeo.note})`;
        } else {
            // MÂU THUẪN
            if (diemMeo.conf >= cauMeo.conf) {
                finalPrediction = diemMeo.pred;
                finalConf = diemMeo.conf - 8;
                finalReason = `MÂU THUẪN ưu tiên ĐIỂM (Điểm: ${diemMeo.note} | Cầu phản: ${cauMeo.note})`;
            } else {
                finalPrediction = cauMeo.pred;
                finalConf = cauMeo.conf - 8;
                finalReason = `MÂU THUẪN ưu tiên CẦU (Cầu: ${cauMeo.note} | Điểm phản: ${diemMeo.note})`;
            }
        }
    } else if (diemMeo) {
        finalPrediction = diemMeo.pred;
        finalConf = diemMeo.conf;
        finalReason = `MẸO ĐIỂM: ${diemMeo.note}`;
    } else if (cauMeo) {
        finalPrediction = cauMeo.pred;
        finalConf = cauMeo.conf;
        finalReason = `MẸO CẦU: ${cauMeo.note}`;
    } else {
        finalPrediction = "Xỉu";
        finalConf = 55;
        finalReason = "Cầu loạn không có mẹo rõ ưu tiên Xỉu";
    }

    finalConf = Math.min(95, Math.max(55, Math.round(finalConf)));

    return {
        prediction: finalPrediction,
        confidence: finalConf,
        reason: finalReason,
        total: lastTotal
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
function buildResponse(game, history) {
    const lastResult = history[0];
    const prediction = predictCombo(history);

    // Bỏ chữ trong ngoặc (...) của lý do
    const lyDo = prediction.reason.replace(/\s*\([^)]*\)/g, '');

    const response = {
        "id": ADMIN,
        "phien_truoc": lastResult.session,
        "xuc_xac": `${lastResult.dice[0]} - ${lastResult.dice[1]} - ${lastResult.dice[2]}`,
        "ket_qua": lastResult.result_vn.toLowerCase(),
        "tong": lastResult.total,
        "phien_nay": lastResult.session + 1,
        "du_doan": prediction.prediction === "Tài" ? "tài" : "xỉu",
        "do_tin_cay": `${prediction.confidence}%`,
        "ly_do": lyDo
    };

    return response;
}

// ==================== FASTIFY SERVER ====================
const app = fastify({ logger: false });
await app.register(cors, { origin: "*" });

// Route gốc
app.get("/", async () => ({
    status: "active",
    admin: ADMIN,
    algorithm: "🎲 TÀI XỈU VIP - KẾT HỢP CẦU + ĐIỂM 🎲",
    endpoints: {
        hu: "/api/taixiu/{ten_game}?key=Thien456",
        md5: "/api/taixiumd5/{ten_game}?key=Thien456",
        hu_history: "/api/taixiu/{ten_game}/history?key=Thien456",
        md5_history: "/api/taixiumd5/{ten_game}/history?key=Thien456",
        bang_diem: "/api/bang-diem?key=Thien456",
        stats: "/api/stats?key=Thien456",
        check_key: "/check-key?key=Thien456"
    }
}));

// ==================== API HŨ ====================
// GET /api/taixiu/{ten_game}
app.get("/api/taixiu/:game", async (request, reply) => {
    const keyCheck = checkKey(request.query);
    if (!keyCheck.valid) return reply.status(401).send({ error: keyCheck.error });

    if (huHistory.length < 3) {
        return reply.status(503).send({ error: "Đang phân tích dữ liệu HŨ, vui lòng chờ...", need: "Cần ít nhất 3 phiên" });
    }

    const game = request.params.game || "lc79";
    return buildResponse(`HŨ - ${game}`, huHistory);
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
// GET /api/taixiumd5/{ten_game}
app.get("/api/taixiumd5/:game", async (request, reply) => {
    const keyCheck = checkKey(request.query);
    if (!keyCheck.valid) return reply.status(401).send({ error: keyCheck.error });

    if (md5History.length < 3) {
        return reply.status(503).send({ error: "Đang phân tích dữ liệu MD5, vui lòng chờ...", need: "Cần ít nhất 3 phiên" });
    }

    const game = request.params.game || "lc79";
    return buildResponse(`MD5 - ${game}`, md5History);
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
        title: "📊 BẢNG MẸO TỔNG ĐIỂM + CẦU 📊",
        admin: ADMIN,
        xiu: {
            "3": "XỈU 70% (Bệt Xỉu nhỏ)",
            "4": "TÀI 60% (Bật Tài hồi)",
            "5": "TÀI 70% (Tài hay nổ)",
            "6": "XỈU 60% (Đứng Xỉu tiếp)",
            "7": "TÀI 80% (Mở Tài cực mạnh)",
            "8": "XỈU 80% (Bệt Xỉu tiếp)",
            "9": "XỈU 70% (Nghiêng Xỉu)",
            "10": "TÀI 80% (Gãy sang Tài)"
        },
        tai: {
            "11": "XỈU 60% (Hồi Xỉu)",
            "12": "TÀI 80% (Bệt Tài)",
            "13": "TÀI 80% (Nghiêng Tài)",
            "14": "XỈU 60% (Dễ gãy)",
            "15": "XỈU 70% (Về Xỉu)",
            "16": "TÀI 60% (Hay nhảy Tài)",
            "17": "XỈU 60% (Về Xỉu)",
            "18": "XỈU 80% (Bẻ Xỉu mạnh)"
        },
        cau: {
            "1-1 (T-X-T-X)": "ĐẢO 75%",
            "1-2 (A-BB-A-BB)": "THEO 70%",
            "2-1 (AA-B-AA-B)": "THEO 70%",
            "2-2 (TT-XX-TT-XX)": "ĐẢO 75%",
            "3-1 (TTT-X-TTT-X)": "THEO 72%",
            "3-3 (TTT-XXX)": "ĐẢO 78%",
            "1-2-1 (A-BB-A)": "THEO BB 68%",
            "2-1-2 (AA-B-AA)": "THEO AA 68%",
            "Bệt 4-6 tay": "THEO 70-80%",
            "Bệt 7+ tay": "BẺ 80%"
        },
        bao: "BÃO (3 mặt giống nhau) → NGHỈ 1-3 PHIÊN",
        nguyen_tac: "ĐỒNG THUẬN → tăng conf. MÂU THUẪN → ưu tiên conf cao hơn, giảm 8%"
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
        algorithm: "TÀI XỈU VIP - KẾT HỢP CẦU + ĐIỂM",
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
║     TÀI XỈU HŨ & MD5 - KẾT HỢP CẦU + ĐIỂM                    ║
╠══════════════════════════════════════════════════════════════╣
║  🚀 Server: http://localhost:${PORT}                            ║
║  🔑 KEY: ${VALID_KEY}                                          ║
║  👤 ADMIN: ${ADMIN}                                       ║
║                                                              ║
║  🎯 API ENDPOINTS:                                           ║
║     HŨ :  /api/taixiu/lc79?key=${VALID_KEY}                 ║
║     MD5:  /api/taixiumd5/lc79?key=${VALID_KEY}              ║
║                                                              ║
║  📞 ADMIN: ${ADMIN}                                       ║
╚══════════════════════════════════════════════════════════════╝
`);
};

start();