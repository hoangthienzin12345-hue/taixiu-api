import fastify from "fastify";
import cors from "@fastify/cors";
import fetch from "node-fetch";

// ==================== CẤU HÌNH ====================
const PORT = process.env.PORT || 3000;
const VALID_KEY = "Thien456";
const ADMIN = "@ADMNLc79";

// ==================== API URLs ====================
const API_URL_HU  = "https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5";
const API_URL_MD5 = "https://wtxmd52.tele68.com/v1/txmd5/sessions";

// ================================================================
// BẢNG MẸO TỔNG ĐIỂM (RÚT TỪ 8 FILE - 1872 PHIÊN)
// ================================================================
const BANG_DIEM = {
    3:  { pred: "Xỉu", conf: 65, note: "X3 Xỉu nhỏ bệt tiếp" },
    4:  { pred: "Tài", conf: 60, note: "X4 Bật Tài hồi" },
    5:  { pred: "Xỉu", conf: 62, note: "X5 Vẫn nghiêng Xỉu" },
    6:  { pred: "Xỉu", conf: 60, note: "X6 Đứng Xỉu" },
    7:  { pred: "Tài", conf: 66, note: "X7 Hay mở Tài" },
    8:  { pred: "Xỉu", conf: 65, note: "X8 Bệt Xỉu" },
    9:  { pred: "Xỉu", conf: 62, note: "X9 Nghiêng Xỉu" },
    10: { pred: "Tài", conf: 62, note: "X10 Gãy sang Tài" },
    11: { pred: "Xỉu", conf: 60, note: "T11 Hồi Xỉu" },
    12: { pred: "Tài", conf: 62, note: "T12 Nghiêng Tài bệt" },
    13: { pred: "Tài", conf: 63, note: "T13 Nghiêng Tài" },
    14: { pred: "Xỉu", conf: 60, note: "T14 Dễ gãy" },
    15: { pred: "Xỉu", conf: 63, note: "T15 Về Xỉu" },
    16: { pred: "Tài", conf: 60, note: "T16 Nhảy Tài" },
    17: { pred: "Xỉu", conf: 62, note: "T17 Về Xỉu" },
    18: { pred: "Xỉu", conf: 70, note: "T18 Bẻ Xỉu mạnh" }
};

// ================================================================
// NHẬN DIỆN CẦU (CHỈ NHỮNG CẦU XUẤT HIỆN TRONG FILE)
// history[0] = phiên mới nhất
// ================================================================
function nhanDienCau(history) {
    if (!history || history.length < 8) return null;
    const r = history.map(h => h.result); // r[0] mới nhất

    // ---- 1. BỆT (STREAK) ----
    let bet = 1;
    for (let i = 1; i < history.length; i++) {
        if (r[i] === r[0]) bet++;
        else break;
    }
    if (bet >= 7) {
        return {
            pred: r[0] === "Tài" ? "Xỉu" : "Tài",
            conf: 78,
            note: `Bệt ${bet} tay BẺ NGƯỢC`
        };
    }
    if (bet >= 4 && bet <= 6) {
        return {
            pred: r[0],
            conf: Math.min(76, 62 + bet * 2),
            note: `Bệt ${bet} tay THEO TIẾP`
        };
    }

    // ---- 2. CẦU 1-1 (T-X-T-X-T-X) → ĐẢO ----
    if (r[0] !== r[1] && r[1] !== r[2] && r[2] !== r[3] && r[3] !== r[4] && r[4] !== r[5]) {
        return {
            pred: r[0] === "Tài" ? "Xỉu" : "Tài",
            conf: 72,
            note: "Cầu 1-1 ĐẢO"
        };
    }

    // ---- 3. CẦU 2-2 (TT-XX-TT-XX) → ĐẢO ----
    if (r[0] === r[1] && r[2] === r[3] && r[4] === r[5]
        && r[0] !== r[2] && r[2] !== r[4]) {
        return {
            pred: r[0] === "Tài" ? "Xỉu" : "Tài",
            conf: 75,
            note: "Cầu 2-2 ĐẢO CHU KỲ"
        };
    }

    // ---- 4. CẦU 3-3 (TTT-XXX-TTT-XXX) → ĐẢO ----
    if (r[0] === r[1] && r[1] === r[2]
        && r[3] === r[4] && r[4] === r[5]
        && r[0] !== r[3]) {
        return {
            pred: r[0] === "Tài" ? "Xỉu" : "Tài",
            conf: 78,
            note: "Cầu 3-3 ĐẢO CHU KỲ"
        };
    }

    // ---- 5. CẦU 2-1 (AA-B-AA-B) → THEO ----
    if (r[0] === r[1] && r[1] !== r[2]
        && r[2] === r[3] && r[3] !== r[4]
        && r[4] === r[5] && r[5] !== r[6]) {
        return {
            pred: r[2],
            conf: 70,
            note: "Cầu 2-1 THEO NHỊP"
        };
    }

    // ---- 6. CẦU 1-2 (A-BB-A-BB) → THEO ----
    if (r[0] !== r[1] && r[1] === r[2]
        && r[2] !== r[3] && r[3] === r[4] && r[4] === r[5]
        && r[5] !== r[6]) {
        return {
            pred: r[0],
            conf: 70,
            note: "Cầu 1-2 THEO NHỊP"
        };
    }

    // ---- 7. CẦU 1-2-1 (A-BB-A) → THEO BB ----
    if (r[0] !== r[1] && r[1] === r[2]
        && r[2] !== r[3] && r[0] === r[3]) {
        return {
            pred: r[1],
            conf: 68,
            note: "Cầu 1-2-1 THEO BB"
        };
    }

    // ---- 8. CẦU 2-1-2 (AA-B-AA) → THEO AA ----
    if (r[0] === r[1] && r[1] !== r[2]
        && r[2] === r[3] && r[0] === r[3]) {
        return {
            pred: r[2],
            conf: 68,
            note: "Cầu 2-1-2 THEO AA"
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
            note: `BÃO [${dice[0]}-${dice[0]}-${dice[0]}] DỪNG 1-3 PHIÊN`
        };
    }
    return null;
}

// ================================================================
// DỰ ĐOÁN TỔNG HỢP: CẦU + ĐIỂM
// ================================================================
function predictCombo(history) {
    if (!history || history.length < 3) {
        return {
            prediction: "Tài", confidence: 50,
            reason: "Chưa đủ dữ liệu", total: null
        };
    }

    const lastResult = history[0];
    const lastTotal = lastResult.total;
    const lastDice = lastResult.dice;

    // 1. BÃO ưu tiên cao nhất
    const bao = xuLyBao(lastDice);
    if (bao) {
        return {
            prediction: bao.pred, confidence: bao.conf,
            reason: bao.note, total: lastTotal, isBao: true
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
            finalConf = Math.min(95, Math.round((diemMeo.conf + cauMeo.conf) / 2 + 10));
            finalReason = `ĐỒNG THUẬN (Điểm: ${diemMeo.note} | Cầu: ${cauMeo.note})`;
        } else {
            // MÂU THUẪN
            if (diemMeo.conf >= cauMeo.conf) {
                finalPrediction = diemMeo.pred;
                finalConf = diemMeo.conf - 5;
                finalReason = `MÂU THUẪN ưu tiên ĐIỂM (Điểm: ${diemMeo.note} | Cầu phản: ${cauMeo.note})`;
            } else {
                finalPrediction = cauMeo.pred;
                finalConf = cauMeo.conf - 5;
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
        finalReason = "Cầu loạn không có mẹo rõ - mặc định Xỉu";
    }

    finalConf = Math.min(95, Math.max(55, Math.round(finalConf)));

    return {
        prediction: finalPrediction,
        confidence: finalConf,
        reason: finalReason,
        total: lastTotal
    };
}

// ==================== PARSE ====================
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

// ==================== STATE ====================
let huHistory = [];
let md5History = [];
let currentSessionIdHu = null;
let currentSessionIdMd5 = null;

// ==================== FETCH ====================
async function fetchHuData() {
    try {
        const r = await fetch(API_URL_HU);
        const data = await r.json();
        const newHistory = parseLinesHu(data);
        if (newHistory.length === 0) return;

        const lastSession = newHistory.at(-1);

        if (!currentSessionIdHu) {
            huHistory = newHistory;
            currentSessionIdHu = lastSession.session;
            console.log(`✅ [HŨ] Đã tải ${newHistory.length} phiên`);
        } else if (lastSession.session > currentSessionIdHu) {
            const newRecords = newHistory.filter(r => r.session > currentSessionIdHu);
            for (const rec of newRecords) huHistory.unshift(rec);
            if (huHistory.length > 500) huHistory = huHistory.slice(0, 450);
            currentSessionIdHu = lastSession.session;
            if (newRecords.length) console.log(`🆕 [HŨ] +${newRecords.length} phiên`);
        }
    } catch (e) { console.error(`❌ [HŨ]`, e.message); }
}

async function fetchMd5Data() {
    try {
        const r = await fetch(API_URL_MD5);
        const data = await r.json();
        const newHistory = parseLinesMd5(data);
        if (newHistory.length === 0) return;

        const lastSession = newHistory.at(-1);

        if (!currentSessionIdMd5) {
            md5History = newHistory;
            currentSessionIdMd5 = lastSession.session;
            console.log(`✅ [MD5] Đã tải ${newHistory.length} phiên`);
        } else if (lastSession.session > currentSessionIdMd5) {
            const newRecords = newHistory.filter(r => r.session > currentSessionIdMd5);
            for (const rec of newRecords) md5History.unshift(rec);
            if (md5History.length > 500) md5History = md5History.slice(0, 450);
            currentSessionIdMd5 = lastSession.session;
            if (newRecords.length) console.log(`🆕 [MD5] +${newRecords.length} phiên`);
        }
    } catch (e) { console.error(`❌ [MD5]`, e.message); }
}

// ==================== KEY ====================
function checkKey(query) {
    const k = query.key;
    if (!k || k !== VALID_KEY) return { valid: false, error: `Sai key! Mua key ib ${ADMIN}` };
    return { valid: true };
}

// ==================== BUILD RESPONSE ====================
function buildResponse(game, history) {
    const last = history[0];
    const p = predictCombo(history);
    const lyDo = p.reason.replace(/\s*\([^)]*\)/g, '');

    return {
        "id": ADMIN,
        "phien_truoc": last.session,
        "xuc_xac": `${last.dice[0]} - ${last.dice[1]} - ${last.dice[2]}`,
        "ket_qua": last.result_vn.toLowerCase(),
        "tong": last.total,
        "phien_nay": last.session + 1,
        "du_doan": p.prediction === "Tài" ? "tài" : (p.prediction === "Nghỉ" ? "nghỉ" : "xỉu"),
        "do_tin_cay": `${p.confidence}%`,
        "ly_do": lyDo
    };
}

// ==================== SERVER ====================
const app = fastify({ logger: false });
await app.register(cors, { origin: "*" });

app.get("/", async () => ({
    status: "active",
    admin: ADMIN,
    algorithm: "🎲 TÀI XỈU VIP - CẦU + ĐIỂM (từ 1872 phiên) 🎲",
    endpoints: {
        hu: "/api/taixiu/{game}?key=Thien456",
        md5: "/api/taixiumd5/{game}?key=Thien456",
        hu_history: "/api/taixiu/{game}/history?key=Thien456",
        md5_history: "/api/taixiumd5/{game}/history?key=Thien456",
        bang_diem: "/api/bang-diem?key=Thien456",
        stats: "/api/stats?key=Thien456"
    }
}));

// HŨ
app.get("/api/taixiu/:game", async (req, reply) => {
    const k = checkKey(req.query);
    if (!k.valid) return reply.status(401).send({ error: k.error });
    if (huHistory.length < 3) return reply.status(503).send({ error: "Đang tải dữ liệu HŨ..." });
    return buildResponse(`HŨ - ${req.params.game || "lc79"}`, huHistory);
});

app.get("/api/taixiu/:game/history", async (req, reply) => {
    const k = checkKey(req.query);
    if (!k.valid) return reply.status(401).send({ error: k.error });
    return [...huHistory].sort((a, b) => b.session - a.session).slice(0, 30)
        .map(i => ({ phien: i.session, xuc_xac: i.dice, tong: i.total, ket_qua: i.result_vn.toLowerCase() }));
});

// MD5
app.get("/api/taixiumd5/:game", async (req, reply) => {
    const k = checkKey(req.query);
    if (!k.valid) return reply.status(401).send({ error: k.error });
    if (md5History.length < 3) return reply.status(503).send({ error: "Đang tải dữ liệu MD5..." });
    return buildResponse(`MD5 - ${req.params.game || "lc79"}`, md5History);
});

app.get("/api/taixiumd5/:game/history", async (req, reply) => {
    const k = checkKey(req.query);
    if (!k.valid) return reply.status(401).send({ error: k.error });
    return [...md5History].sort((a, b) => b.session - a.session).slice(0, 30)
        .map(i => ({ phien: i.session, xuc_xac: i.dice, tong: i.total, ket_qua: i.result_vn.toLowerCase() }));
});

// BẢNG ĐIỂM
app.get("/api/bang-diem", async (req, reply) => {
    const k = checkKey(req.query);
    if (!k.valid) return reply.status(401).send({ error: k.error });

    return {
        title: "📊 BẢNG MẸO TỔNG ĐIỂM + CẦU (từ 1872 phiên)",
        admin: ADMIN,
        bang_diem: {
            "3":  "XỈU 65% - X3 nhỏ bệt",
            "4":  "TÀI 60% - Bật Tài hồi",
            "5":  "XỈU 62% - Nghiêng Xỉu",
            "6":  "XỈU 60% - Đứng Xỉu",
            "7":  "TÀI 66% - Mở Tài",
            "8":  "XỈU 65% - Bệt Xỉu",
            "9":  "XỈU 62% - Nghiêng Xỉu",
            "10": "TÀI 62% - Gãy Tài",
            "11": "XỈU 60% - Hồi Xỉu",
            "12": "TÀI 62% - Bệt Tài",
            "13": "TÀI 63% - Nghiêng Tài",
            "14": "XỈU 60% - Dễ gãy",
            "15": "XỈU 63% - Về Xỉu",
            "16": "TÀI 60% - Nhảy Tài",
            "17": "XỈU 62% - Về Xỉu",
            "18": "XỈU 70% - Bẻ Xỉu"
        },
        cau: {
            "1-1 (T-X-T-X)":      "ĐẢO 72%",
            "2-2 (TT-XX)":        "ĐẢO 75%",
            "3-3 (TTT-XXX)":      "ĐẢO 78%",
            "2-1 (AA-B-AA-B)":    "THEO 70%",
            "1-2 (A-BB-A-BB)":    "THEO 70%",
            "1-2-1 (A-BB-A)":     "THEO BB 68%",
            "2-1-2 (AA-B-AA)":    "THEO AA 68%",
            "Bệt 4-6 tay":        "THEO 62-76%",
            "Bệt 7+ tay":         "BẺ 78%"
        },
        bao: "BÃO (3 mặt giống) → NGHỈ 1-3 PHIÊN",
        nguyen_tac: "ĐỒNG THUẬN → +10% conf | MÂU THUẪN → ưu tiên conf cao, -5%"
    };
});

// STATS
app.get("/api/stats", async (req, reply) => {
    const k = checkKey(req.query);
    if (!k.valid) return reply.status(401).send({ error: k.error });

    const huTai = huHistory.filter(h => h.result === "Tài").length;
    const md5Tai = md5History.filter(h => h.result === "Tài").length;

    return {
        admin: ADMIN,
        hu: {
            history_length: huHistory.length,
            last_session: huHistory[0]?.session || null,
            ti_le: huHistory.length > 0
                ? `${(huTai / huHistory.length * 100).toFixed(1)}% Tài`
                : "Chưa có"
        },
        md5: {
            history_length: md5History.length,
            last_session: md5History[0]?.session || null,
            ti_le: md5History.length > 0
                ? `${(md5Tai / md5History.length * 100).toFixed(1)}% Tài`
                : "Chưa có"
        },
        algorithm: "CẦU + ĐIỂM (từ 1872 phiên)"
    };
});

// CHECK KEY
app.get("/check-key", async (req) => {
    const u = req.query.key;
    if (u === VALID_KEY) return { status: "success", message: "KEY HỢP LỆ", admin: ADMIN };
    return { status: "error", message: `Sai key! Ib ${ADMIN}` };
});

// ==================== START ====================
const start = async () => {
    await Promise.all([fetchHuData(), fetchMd5Data()]);
    setInterval(fetchHuData, 5000);
    setInterval(fetchMd5Data, 5000);

    try {
        await app.listen({ port: PORT, host: "0.0.0.0" });
    } catch (e) {
        console.error("❌", e.message);
        process.exit(1);
    }

    console.log(`
╔══════════════════════════════════════════════════════╗
║   TÀI XỈU VIP - CẦU + ĐIỂM (1872 PHIÊN)             ║
╠══════════════════════════════════════════════════════╣
║  🚀 http://localhost:${PORT}                            ║
║  🔑 KEY: ${VALID_KEY}                                  ║
║  👤 ADMIN: ${ADMIN}                               ║
║                                                      ║
║  HŨ : /api/taixiu/lc79?key=${VALID_KEY}             ║
║  MD5: /api/taixiumd5/lc79?key=${VALID_KEY}          ║
╚══════════════════════════════════════════════════════╝
`);
};

start();
