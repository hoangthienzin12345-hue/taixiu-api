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
    3:  { pred: "Xỉu", conf: 70, note: "X3 Bệt Xỉu nhỏ" },
    4:  { pred: "Tài", conf: 65, note: "X4 Bật Tài hồi" },
    5:  { pred: "Tài", conf: 70, note: "X5 Tài hay nổ" },
    6:  { pred: "Xỉu", conf: 60, note: "X6 Đứng Xỉu tiếp" },
    7:  { pred: "Tài", conf: 75, note: "X7 Mở Tài cực mạnh" },
    8:  { pred: "Xỉu", conf: 80, note: "X8 Bệt Xỉu tiếp" },
    9:  { pred: "Xỉu", conf: 70, note: "X9 Nghiêng Xỉu" },
    10: { pred: "Tài", conf: 80, note: "X10 Gãy sang Tài" },
    11: { pred: "Xỉu", conf: 60, note: "T11 Hồi Xỉu" },
    12: { pred: "Tài", conf: 80, note: "T12 Bệt Tài" },
    13: { pred: "Tài", conf: 80, note: "T13 Nghiêng Tài" },
    14: { pred: "Xỉu", conf: 60, note: "T14 Dễ gãy" },
    15: { pred: "Xỉu", conf: 70, note: "T15 Về Xỉu" },
    16: { pred: "Tài", conf: 60, note: "T16 Hay nhảy Tài" },
    17: { pred: "Xỉu", conf: 60, note: "T17 Về Xỉu" },
    18: { pred: "Xỉu", conf: 80, note: "T18 Bẻ Xỉu mạnh" }
};

// ==================== NHẬN DIỆN CẦU (CHỈ CẦN 6 PHIÊN) ====================
// history[0] = phiên MỚI NHẤT
function nhanDienCau(history) {
    if (!history || history.length < 6) return null;
    const r = history.map(h => h.result);
    const doi = (x) => (x === "Tài" ? "Xỉu" : "Tài");

    // ---- 1. BỆT ----
    let bet = 1;
    for (let i = 1; i < history.length; i++) {
        if (r[i] === r[0]) bet++;
        else break;
    }
    if (bet >= 7) {
        return { pred: doi(r[0]), conf: 82, note: `Bệt ${bet} tay BẺ NGƯỢC` };
    }
    if (bet >= 4 && bet <= 6) {
        return { pred: r[0], conf: Math.min(80, 66 + bet * 2), note: `Bệt ${bet} tay THEO TIẾP` };
    }

    // ---- 2. CẦU 1-1 (T-X-T-X-T-X) ----
    if (r[0] !== r[1] && r[1] !== r[2] && r[2] !== r[3] && r[3] !== r[4] && r[4] !== r[5]) {
        return { pred: doi(r[0]), conf: 75, note: "Cầu 1-1 (T-X-T-X) ĐẢO" };
    }

    // ---- 3. CẦU 2-2 (TT-XX-TT-XX) ----
    if (r[0] === r[1] && r[2] === r[3] && r[4] === r[5] && r[0] !== r[2] && r[2] !== r[4]) {
        return { pred: doi(r[0]), conf: 75, note: "Cầu 2-2 (TT-XX-TT-XX) ĐẢO" };
    }

    // ---- 4. CẦU 3-3 (TTT-XXX) ----
    if (r[0] === r[1] && r[1] === r[2] && r[3] === r[4] && r[4] === r[5] && r[0] !== r[3]) {
        return { pred: doi(r[0]), conf: 78, note: "Cầu 3-3 (TTT-XXX) ĐẢO" };
    }

    // ---- 5. CẦU 2-1 (AA-B-AA-B) ----
    if (r[0] === r[1] && r[2] !== r[1] && r[3] === r[2] && r[4] !== r[3] && r[5] === r[4]) {
        return { pred: r[2], conf: 70, note: "Cầu 2-1 (AA-B-AA-B) THEO" };
    }

    // ---- 6. CẦU 1-2 (A-BB-A-BB) ----
    if (r[0] !== r[1] && r[1] === r[2] && r[3] !== r[2] && r[4] === r[3] && r[5] !== r[4]) {
        return { pred: r[0], conf: 70, note: "Cầu 1-2 (A-BB-A-BB) THEO" };
    }

    // ---- 7. CẦU 1-2-1 (A-BB-A) ----
    if (r[0] !== r[1] && r[1] === r[2] && r[2] !== r[3] && r[0] === r[3]) {
        return { pred: r[1], conf: 68, note: "Cầu 1-2-1 (A-BB-A) THEO BB" };
    }

    // ---- 8. CẦU 2-1-2 (AA-B-AA) ----
    if (r[0] === r[1] && r[1] !== r[2] && r[2] === r[3] && r[0] === r[3]) {
        return { pred: r[2], conf: 68, note: "Cầu 2-1-2 (AA-B-AA) THEO AA" };
    }

    // ---- 9. CẦU 3-1 (TTT-X-TTT-X) ----
    if (r[0] === r[1] && r[1] === r[2] && r[3] !== r[2] && r[4] === r[3] && r[5] === r[3]) {
        return { pred: r[3], conf: 72, note: "Cầu 3-1 (TTT-X) THEO NHỊP" };
    }

    return null;
}

// ==================== XỬ LÝ BÃO ====================
function xuLyBao(dice) {
    if (!dice || dice.length < 3) return null;
    if (dice[0] === dice[1] && dice[1] === dice[2]) {
        return { pred: "BÃO", conf: 0, note: `BÃO [${dice[0]}-${dice[0]}-${dice[0]}] Dừng 1-3 phiên` };
    }
    return null;
}

// ==================== XU HƯỚNG 10 PHIÊN ====================
function phanTichXuHuong(history) {
    if (!history || history.length < 10) return null;
    const r = history.slice(0, 10).map(h => h.result);
    const tai = r.filter(x => x === "Tài").length;
    const xiu = 10 - tai;

    if (tai >= 8) return { pred: "Xỉu", conf: 72, note: `10 phiên có ${tai} Tài → ĐẢO XỈU` };
    if (xiu >= 8) return { pred: "Tài", conf: 72, note: `10 phiên có ${xiu} Xỉu → ĐẢO TÀI` };
    if (tai >= 7) return { pred: "Xỉu", conf: 65, note: `10 phiên có ${tai} Tài → Nghiêng XỈU` };
    if (xiu >= 7) return { pred: "Tài", conf: 65, note: `10 phiên có ${xiu} Xỉu → Nghiêng TÀI` };
    return null;
}

// ==================== DỰ ĐOÁN TỔNG HỢP ====================
function predictCombo(history) {
    if (!history || history.length < 3) {
        return { prediction: "Xỉu", confidence: 50, reason: "Chưa đủ dữ liệu", signals: [] };
    }

    const lastResult = history[0];
    const lastTotal = Number(lastResult.total); // ép số
    const lastDice = lastResult.dice;

    // 1. BÃO — dừng luôn
    const bao = xuLyBao(lastDice);
    if (bao) return { prediction: bao.pred, confidence: bao.conf, reason: bao.note, signals: ["BÃO"] };

    // 2. THU THẬP TÍN HIỆU
    const diemMeo = BANG_DIEM[lastTotal] || null;
    const cauMeo = nhanDienCau(history);
    const xuHuong = phanTichXuHuong(history);

    const signals = [];
    if (diemMeo) signals.push(`ĐIỂM(${diemMeo.pred}|${diemMeo.conf}%): ${diemMeo.note}`);
    if (cauMeo) signals.push(`CẦU(${cauMeo.pred}|${cauMeo.conf}%): ${cauMeo.note}`);
    if (xuHuong) signals.push(`XU_HƯỚNG(${xuHuong.pred}|${xuHuong.conf}%): ${xuHuong.note}`);

    // 3. ĐIỂM (WEIGHTED VOTE) — gom tất cả signal, cộng conf theo từng hướng
    const voteTai = [];
    const voteXiu = [];

    if (diemMeo) {
        if (diemMeo.pred === "Tài") voteTai.push({ src: "ĐIỂM", conf: diemMeo.conf, note: diemMeo.note });
        else voteXiu.push({ src: "ĐIỂM", conf: diemMeo.conf, note: diemMeo.note });
    }
    if (cauMeo) {
        if (cauMeo.pred === "Tài") voteTai.push({ src: "CẦU", conf: cauMeo.conf, note: cauMeo.note });
        else voteXiu.push({ src: "CẦU", conf: cauMeo.conf, note: cauMeo.note });
    }
    if (xuHuong) {
        if (xuHuong.pred === "Tài") voteTai.push({ src: "XU_HƯỚNG", conf: xuHuong.conf, note: xuHuong.note });
        else voteXiu.push({ src: "XU_HƯỚNG", conf: xuHuong.conf, note: xuHuong.note });
    }

    // 4. TÍNH ĐIỂM
    const taiCount = voteTai.length;
    const xiuCount = voteXiu.length;
    const taiConf = voteTai.reduce((s, v) => s + v.conf, 0);
    const xiuConf = voteXiu.reduce((s, v) => s + v.conf, 0);

    let finalPrediction, finalConf, finalReason;

    // Không có signal nào
    if (taiCount === 0 && xiuCount === 0) {
        // Fallback: THEO kết quả phiên trước (an toàn hơn ép Xỉu)
        finalPrediction = lastResult.result;
        finalConf = 52;
        finalReason = `Không có mẹo rõ → THEO phiên trước (${lastResult.result})`;
    }
    // Chỉ 1 bên có signal
    else if (taiCount === 0) {
        finalPrediction = "Xỉu";
        // 1 tín hiệu: giữ conf gốc. Nhiều tín hiệu: cộng dồn
        finalConf = xiuCount === 1 ? xiuConf : Math.min(95, Math.round(xiuConf / xiuCount + 10));
        finalReason = `XỈU (${voteXiu.map(v => v.src).join("+")}): ${voteXiu.map(v => v.note).join(" | ")}`;
    }
    else if (xiuCount === 0) {
        finalPrediction = "Tài";
        finalConf = taiCount === 1 ? taiConf : Math.min(95, Math.round(taiConf / taiCount + 10));
        finalReason = `TÀI (${voteTai.map(v => v.src).join("+")}): ${voteTai.map(v => v.note).join(" | ")}`;
    }
    // Cả 2 bên đều có
    else {
        // ĐỒNG THUẬN ưu tiên: bên nào nhiều signal hơn HOẶC tổng conf cao hơn
        if (taiConf > xiuConf) {
            finalPrediction = "Tài";
            finalConf = Math.min(95, Math.round(taiConf / taiCount + (taiCount - xiuCount) * 5));
            finalReason = `TÀI thắng vote (${taiCount} vs ${xiuCount}) | ${voteTai.map(v => v.src).join("+")}`;
        } else if (xiuConf > taiConf) {
            finalPrediction = "Xỉu";
            finalConf = Math.min(95, Math.round(xiuConf / xiuCount + (xiuCount - taiCount) * 5));
            finalReason = `XỈU thắng vote (${xiuCount} vs ${taiCount}) | ${voteXiu.map(v => v.src).join("+")}`;
        } else {
            // Bằng nhau — theo phiên trước
            finalPrediction = lastResult.result;
            finalConf = 55;
            finalReason = `Cân bằng vote → THEO phiên trước (${lastResult.result})`;
        }
    }

    finalConf = Math.min(95, Math.max(50, Math.round(finalConf)));

    return {
        prediction: finalPrediction,
        confidence: finalConf,
        reason: finalReason,
        total: lastTotal,
        signals
    };
}

// ==================== PARSE DỮ LIỆU ====================
// ⚠️ QUAN TRỌNG: đảo ngược để [0] = MỚI NHẤT
function parseLinesHu(data) {
    if (!data || !Array.isArray(data.list)) return [];
    return data.list
        .map(item => ({
            session: item.id,
            dice: item.dices,
            total: Number(item.point),
            result: Number(item.point) >= 11 ? "Tài" : "Xỉu",
            result_vn: Number(item.point) >= 11 ? "Tài" : "Xỉu",
            timestamp: Date.now()
        }))
        .sort((a, b) => b.session - a.session); // MỚI NHẤT lên đầu
}

function parseLinesMd5(data) {
    if (!data || !Array.isArray(data.list)) return [];
    return data.list
        .map(item => ({
            session: item.id,
            dice: item.dices,
            total: Number(item.point),
            result: item.resultTruyenThong === 'Tài' ? "Tài" : "Xỉu",
            result_vn: item.resultTruyenThong || (Number(item.point) >= 11 ? "Tài" : "Xỉu"),
            timestamp: Date.now()
        }))
        .sort((a, b) => b.session - a.session); // MỚI NHẤT lên đầu
}

// ==================== GLOBAL STATE ====================
let huHistory = [];   // [0] = MỚI NHẤT
let md5History = [];  // [0] = MỚI NHẤT
let currentSessionIdHu = null;
let currentSessionIdMd5 = null;

// ==================== FETCH DATA ====================
async function fetchHuData() {
    try {
        const response = await fetch(API_URL_HU);
        const data = await response.json();
        // MỚI NHẤT đứng đầu (đã sort trong parseLinesHu)
        const newHistory = parseLinesHu(data);
        if (newHistory.length === 0) return;

        const latestSession = newHistory[0].session;

        if (!currentSessionIdHu) {
            huHistory = newHistory;          // [0] = MỚI NHẤT ✅
            currentSessionIdHu = latestSession;
            console.log(`✅ [HŨ] Đã tải ${newHistory.length} phiên | Mới nhất: ${latestSession} (${newHistory[0].result})`);
        } else if (latestSession > currentSessionIdHu) {
            const newRecords = newHistory.filter(r => r.session > currentSessionIdHu);
            // unshift từ CŨ đến MỚI để cuối cùng [0] = MỚI NHẤT
            for (let i = newRecords.length - 1; i >= 0; i--) {
                huHistory.unshift(newRecords[i]);
            }
            if (huHistory.length > 500) huHistory = huHistory.slice(0, 450);
            currentSessionIdHu = latestSession;
            if (newRecords.length > 0) {
                console.log(`🆕 [HŨ] +${newRecords.length} phiên | Mới: ${newRecords[0].session} (${newRecords[0].result})`);
            }
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

        const latestSession = newHistory[0].session;

        if (!currentSessionIdMd5) {
            md5History = newHistory;
            currentSessionIdMd5 = latestSession;
            console.log(`✅ [MD5] Đã tải ${newHistory.length} phiên | Mới nhất: ${latestSession} (${newHistory[0].result})`);
        } else if (latestSession > currentSessionIdMd5) {
            const newRecords = newHistory.filter(r => r.session > currentSessionIdMd5);
            for (let i = newRecords.length - 1; i >= 0; i--) {
                md5History.unshift(newRecords[i]);
            }
            if (md5History.length > 500) md5History = md5History.slice(0, 450);
            currentSessionIdMd5 = latestSession;
            if (newRecords.length > 0) {
                console.log(`🆕 [MD5] +${newRecords.length} phiên | Mới: ${newRecords[0].session} (${newRecords[0].result})`);
            }
        }
    } catch (e) {
        console.error(`❌ [MD5] Lỗi:`, e.message);
    }
}

// ==================== KEY CHECK ====================
function checkKey(query) {
    if (!query.key || query.key !== VALID_KEY) {
        return { valid: false, error: `Sai key! Mua key ib ${ADMIN}` };
    }
    return { valid: true };
}

// ==================== BUILD JSON RESPONSE ====================
function buildResponse(game, history) {
    const lastResult = history[0]; // ✅ MỚI NHẤT
    const prediction = predictCombo(history);

    // Map prediction → du_doan (xử lý cả BÃO)
    let duDoan = "xỉu";
    if (prediction.prediction === "Tài") duDoan = "tài";
    else if (prediction.prediction === "Xỉu") duDoan = "xỉu";
    else if (prediction.prediction === "BÃO") duDoan = "nghỉ";

    return {
        "id": ADMIN,
        "phien_truoc": lastResult.session,
        "xuc_xac": `${lastResult.dice[0]} - ${lastResult.dice[1]} - ${lastResult.dice[2]}`,
        "ket_qua": lastResult.result_vn.toLowerCase(),
        "tong": lastResult.total,
        "phien_nay": lastResult.session + 1,
        "du_doan": duDoan,
        "do_tin_cay": `${prediction.confidence}%`,
        "ly_do": prediction.reason,
        "tin_hieu": prediction.signals || []
    };
}

// ==================== FASTIFY SERVER ====================
const app = fastify({ logger: false });
await app.register(cors, { origin: "*" });

app.get("/", async () => ({
    status: "active",
    admin: ADMIN,
    algorithm: "🎲 TÀI XỈU VIP v2 - WEIGHTED VOTE (ĐIỂM + CẦU + XU HƯỚNG) 🎲",
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
    const keyCheck = checkKey(request.query);
    if (!keyCheck.valid) return reply.status(401).send({ error: keyCheck.error });
    if (huHistory.length < 3) return reply.status(503).send({ error: "Đang tải dữ liệu HŨ...", need: "≥3 phiên" });
    return buildResponse(`HŨ - ${request.params.game || "lc79"}`, huHistory);
});

app.get("/api/taixiu/:game/history", async (request, reply) => {
    const keyCheck = checkKey(request.query);
    if (!keyCheck.valid) return reply.status(401).send({ error: keyCheck.error });
    return huHistory.slice(0, 30).map(i => ({
        phien: i.session, xuc_xac: i.dice, tong: i.total, ket_qua: i.result_vn.toLowerCase()
    }));
});

// ==================== API MD5 ====================
app.get("/api/taixiumd5/:game", async (request, reply) => {
    const keyCheck = checkKey(request.query);
    if (!keyCheck.valid) return reply.status(401).send({ error: keyCheck.error });
    if (md5History.length < 3) return reply.status(503).send({ error: "Đang tải dữ liệu MD5...", need: "≥3 phiên" });
    return buildResponse(`MD5 - ${request.params.game || "lc79"}`, md5History);
});

app.get("/api/taixiumd5/:game/history", async (request, reply) => {
    const keyCheck = checkKey(request.query);
    if (!keyCheck.valid) return reply.status(401).send({ error: keyCheck.error });
    return md5History.slice(0, 30).map(i => ({
        phien: i.session, xuc_xac: i.dice, tong: i.total, ket_qua: i.result_vn.toLowerCase()
    }));
});

// ==================== DEBUG — XEM CHI TIẾT DỰ ĐOÁN ====================
app.get("/api/debug/:loai", async (request, reply) => {
    const keyCheck = checkKey(request.query);
    if (!keyCheck.valid) return reply.status(401).send({ error: keyCheck.error });

    const hist = request.params.loai === "md5" ? md5History : huHistory;
    if (hist.length < 3) return reply.status(503).send({ error: "Chưa đủ dữ liệu" });

    const pred = predictCombo(hist);
    const last = hist[0];

    return {
        admin: ADMIN,
        loai: request.params.loai.toUpperCase(),
        so_phien: hist.length,
        phien_moi_nhat: { id: last.session, dice: last.dice, tong: last.total, ket_qua: last.result },
        du_doan: pred.prediction,
        do_tin_cay: `${pred.confidence}%`,
        ly_do: pred.reason,
        tin_hieu: pred.signals,
        _10_phien_gan_nhat: hist.slice(0, 10).map(h => `${h.session}:${h.result}(T${h.total})`)
    };
});

// ==================== BẢNG ĐIỂM ====================
app.get("/api/bang-diem", async (request, reply) => {
    const keyCheck = checkKey(request.query);
    if (!keyCheck.valid) return reply.status(401).send({ error: keyCheck.error });
    return {
        title: "📊 BẢNG MẸO TỔNG ĐIỂM",
        admin: ADMIN,
        xiu: { "3": "XỈU 70%", "4": "TÀI 65%", "5": "TÀI 70%", "6": "XỈU 60%", "7": "TÀI 75%", "8": "XỈU 80%", "9": "XỈU 70%", "10": "TÀI 80%" },
        tai: { "11": "XỈU 60%", "12": "TÀI 80%", "13": "TÀI 80%", "14": "XỈU 60%", "15": "XỈU 70%", "16": "TÀI 60%", "17": "XỈU 60%", "18": "XỈU 80%" },
        bao: "BÃO → NGHỈ 1-3 PHIÊN"
    };
});

// ==================== BẢNG CẦU ====================
app.get("/api/bang-cau", async (request, reply) => {
    const keyCheck = checkKey(request.query);
    if (!keyCheck.valid) return reply.status(401).send({ error: keyCheck.error });
    return {
        title: "📊 BẢNG NHẬN DIỆN CẦU",
        admin: ADMIN,
        cau_dao: {
            "1-1 (T-X-T-X)": "ĐẢO 75%", "2-2 (TT-XX)": "ĐẢO 75%",
            "3-3 (TTT-XXX)": "ĐẢO 78%", "Bệt 7+": "BẺ 82%"
        },
        cau_theo: {
            "Bệt 4-6": "THEO 70-80%", "1-2 (A-BB-A-BB)": "THEO 70%",
            "2-1 (AA-B-AA-B)": "THEO 70%", "3-1 (TTT-X)": "THEO 72%",
            "1-2-1 (A-BB-A)": "THEO BB 68%", "2-1-2 (AA-B-AA)": "THEO AA 68%"
        },
        xu_huong: { "8/10 Tài": "ĐẢO XỈU 72%", "8/10 Xỉu": "ĐẢO TÀI 72%" }
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
    const keyCheck = checkKey(request.query);
    if (!keyCheck.valid) return reply.status(401).send({ error: keyCheck.error });

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
║   TÀI XỈU VIP v2 - WEIGHTED VOTE (ĐIỂM + CẦU + XU HƯỚNG)   ║
╠══════════════════════════════════════════════════════════════╣
║  🚀 http://localhost:${PORT}                                    ║
║  🔑 KEY: ${VALID_KEY}                                          ║
║  👤 ADMIN: ${ADMIN}                                       ║
║                                                              ║
║  📌 API:                                                     ║
║     HŨ :  /api/taixiu/lc79?key=${VALID_KEY}                 ║
║     MD5:  /api/taixiumd5/lc79?key=${VALID_KEY}              ║
║     DEBUG: /api/debug/hu?key=${VALID_KEY}                   ║
║     DEBUG: /api/debug/md5?key=${VALID_KEY}                  ║
╚══════════════════════════════════════════════════════════════╝
`);
};

start();