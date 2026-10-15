import fastify from "fastify";
import cors from "@fastify/cors";
import fetch from "node-fetch";

// ==================== CẤU HÌNH ====================
const PORT = 3000;
const VALID_KEY = "Thiên456";
const ADMIN = "@ADMNLc79";

const API_URL_HU  = "https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5";
const API_URL_MD5 = "https://wtxmd52.tele68.com/v1/txmd5/sessions";

// ==================== BẢNG MẸO ĐIỂM (SỬA TỪ 4 FILE TXT) ====================
const BANG_DIEM = {
    // NHÓM XỈU (3-10)
    3:  { pred: "Xỉu", conf: 65, note: "X3 Hiếm - thường về Xỉu nhỏ (X4-X7)" },
    4:  { pred: "Tài", conf: 80, note: "X4 Hiếm - khi về thường bẻ Tài" },
    5:  { pred: "Xỉu", conf: 62, note: "X5 Hay đứng Xỉu (X6-X9)" },
    6:  { pred: "Xỉu", conf: 65, note: "X6 Thường về Xỉu tiếp" },
    7:  { pred: "Tài", conf: 62, note: "X7 Hay bẻ Tài" },
    8:  { pred: "Xỉu", conf: 65, note: "X8 Hay đứng Xỉu" },
    9:  { pred: "Xỉu", conf: 70, note: "X9 Hay đứng Xỉu 10" },
    10: { pred: "Tài", conf: 80, note: "X10 Bẻ sang Tài (T11-T12)" },
    // NHÓM TÀI (11-18)
    11: { pred: "Tài", conf: 65, note: "T11 Hay đứng Tài tiếp" },
    12: { pred: "Tài", conf: 70, note: "T12 Bệt Tài" },
    13: { pred: "Xỉu", conf: 68, note: "T13 Hay về Xỉu" },
    14: { pred: "Xỉu", conf: 85, note: "T14 SIÊU XỈU - Điểm vàng để bẻ" },
    15: { pred: "Tài", conf: 70, note: "T15 Hay nổ Tài 16, 17" },
    16: { pred: "Xỉu", conf: 72, note: "T16 Hay về Xỉu" },
    17: { pred: "Xỉu", conf: 72, note: "T17 Hay về Xỉu" },
    18: { pred: "Xỉu", conf: 95, note: "T18 BẺ XỈU" }
};

// ==================== HELPERS ====================
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

// ==================== CẦU THEO MẶT XÚC XẮC ====================
function cauMatXucXac(dice) {
    if (!dice || dice.length < 3) return null;
    const [a, b, c] = dice;

    if ((a === b && a <= 2) || (b === c && b <= 2)) {
        return { pred: "Xỉu", conf: 80, note: `Cầu Kép Bé [${a}-${b}-${c}] → XỈU` };
    }
    if ((a === b && a >= 5) || (b === c && b >= 5)) {
        return { pred: "Tài", conf: 80, note: `Cầu Kép Lớn [${a}-${b}-${c}] → TÀI` };
    }
    if ((a === b && a === 3) || (b === c && b === 3)) {
        return { pred: "Xỉu", conf: 65, note: `Kép 3 [${a}-${b}-${c}] → XỈU` };
    }
    if ((a === b && a === 4) || (b === c && b === 4)) {
        return { pred: "Tài", conf: 65, note: `Kép 4 [${a}-${b}-${c}] → TÀI` };
    }
    const count6 = dice.filter(x => x === 6).length;
    if (count6 === 2) return { pred: "Xỉu", conf: 85, note: "2 mặt 6 xuất hiện → XỈU" };

    const count1 = dice.filter(x => x === 1).length;
    if (count1 === 2) return { pred: "Tài", conf: 75, note: "2 mặt 1 xuất hiện → TÀI" };

    if (a === c && a !== b) {
        return { pred: "Đảo", conf: 85, note: `Cầu Gánh [${a}-${b}-${a}] → ĐẢO CẦU` };
    }
    if (a + 1 === b && b + 1 === c) {
        return { pred: "Tài", conf: 78, note: `Cầu Tiến [${a}-${b}-${c}] → TÀI` };
    }
    if (a - 1 === b && b - 1 === c) {
        return { pred: "Xỉu", conf: 78, note: `Cầu Lùi [${a}-${b}-${c}] → XỈU` };
    }
    const sum = a + b + c;
    if (sum >= 17) return { pred: "Xỉu", conf: 70, note: `Tổng cao [${sum}] → XỈU` };
    if (sum <= 4)  return { pred: "Tài", conf: 70, note: `Tổng thấp [${sum}] → TÀI` };
    return null;
}

// ==================== CẦU BỆT ====================
function cauBet(history, lenBET, lastResult) {
    if (lenBET >= 3 && lenBET <= 5) {
        return { pred: lastResult, conf: 62 + (lenBET - 3) * 3, note: `Bệt ${lenBET} tay → theo tiếp` };
    }
    if (lenBET === 6) {
        return { pred: lastResult, conf: 63, note: `Bệt ${lenBET} tay → hay đứng` };
    }
    if (lenBET >= 7 && lenBET <= 9) {
        const brk = lastResult === "Tài" ? "Xỉu" : "Tài";
        return { pred: brk, conf: 75, note: `Bệt ${lenBET} tay → bẻ ngược` };
    }
    if (lenBET >= 10) {
        const brk = lastResult === "Tài" ? "Xỉu" : "Tài";
        return { pred: brk, conf: 82, note: `Bệt ${lenBET} tay → BẺ MẠNH` };
    }
    return null;
}

// ==================== CẦU 1-1 ====================
function cau11(history) {
    if (history.length < 5) return null;
    const r = history.slice(0, 5).map(h => h.result);
    if (r[0] !== r[1] && r[1] !== r[2] && r[2] !== r[3] && r[3] !== r[4]) {
        return { pred: r[4] === "Tài" ? "Xỉu" : "Tài", conf: 72, note: "Cầu 1-1 (T-X-T-X-T) → đảo" };
    }
    if (history.length >= 4) {
        const l4 = history.slice(0, 4).map(h => h.result);
        if (l4[0] !== l4[1] && l4[1] !== l4[2] && l4[2] !== l4[3]) {
            return { pred: l4[3] === "Tài" ? "Xỉu" : "Tài", conf: 68, note: "Cầu 1-1 (T-X-T-X) → đảo" };
        }
    }
    return null;
}

// ==================== CẦU 2-2 ====================
function cau22(history) {
    if (history.length < 6) return null;
    const r = history.slice(0, 6).map(h => h.result);
    if (r[0] === r[1] && r[2] === r[3] && r[4] === r[5] &&
        r[0] !== r[2] && r[2] !== r[4]) {
        return { pred: r[0], conf: 75, note: "Cầu 2-2 (TT-XX-TT) → theo" };
    }
    if (history.length >= 4) {
        const l4 = history.slice(0, 4).map(h => h.result);
        if (l4[0] === l4[1] && l4[2] === l4[3] && l4[0] !== l4[2]) {
            return { pred: l4[0], conf: 72, note: "Cầu 2-2 (TT-XX) → theo" };
        }
    }
    return null;
}

// ==================== CẦU 3-3 ====================
function cau33(history) {
    if (history.length < 6) return null;
    const r = history.slice(0, 6).map(h => h.result);
    if (r[0] === r[1] && r[1] === r[2] &&
        r[3] === r[4] && r[4] === r[5] &&
        r[0] !== r[3]) {
        return { pred: r[0], conf: 78, note: "Cầu 3-3 (TTT-XXX) → theo chu kỳ" };
    }
    return null;
}

// ==================== CẦU 2-1 ====================
function cau21(history) {
    if (history.length < 6) return null;
    const r = history.slice(0, 6).map(h => h.result);
    if (r[0] === r[1] && r[1] !== r[2] &&
        r[3] === r[4] && r[4] !== r[5] &&
        r[0] !== r[3]) {
        return { pred: r[0], conf: 74, note: "Cầu 2-1 (TT-X-TT-X) → theo chu kỳ" };
    }
    return null;
}

// ==================== CẦU 1-2 ====================
function cau12(history) {
    if (history.length < 6) return null;
    const r = history.slice(0, 6).map(h => h.result);
    if (r[0] !== r[1] && r[1] === r[2] &&
        r[3] !== r[4] && r[4] === r[5] &&
        r[0] === r[3]) {
        return { pred: r[0], conf: 74, note: "Cầu 1-2 (T-XX-T-XX) → theo chu kỳ" };
    }
    return null;
}

// ==================== CẦU 3-1 ====================
function cau31(history) {
    if (history.length < 8) return null;
    const r = history.slice(0, 8).map(h => h.result);
    if (r[0] === r[1] && r[1] === r[2] && r[2] !== r[3] &&
        r[4] === r[5] && r[5] === r[6] && r[6] !== r[7] &&
        r[0] === r[4] && r[3] === r[7]) {
        return { pred: r[0], conf: 76, note: "Cầu 3-1 (TTT-X) → theo chu kỳ" };
    }
    return null;
}

// ==================== CẦU 1-3 ====================
function cau13(history) {
    if (history.length < 8) return null;
    const r = history.slice(0, 8).map(h => h.result);
    if (r[0] !== r[1] && r[1] === r[2] && r[2] === r[3] &&
        r[3] !== r[4] && r[4] === r[5] && r[5] === r[6] &&
        r[0] === r[4]) {
        return { pred: r[0], conf: 76, note: "Cầu 1-3 (T-XXX) → theo chu kỳ" };
    }
    return null;
}

// ==================== CẦU 2-3 ====================
function cau23(history) {
    if (history.length < 5) return null;
    const r = history.slice(0, 5).map(h => h.result);
    if (r[0] === r[1] && r[2] === r[3] && r[3] === r[4] && r[0] !== r[2]) {
        return { pred: r[0], conf: 72, note: "Cầu 2-3 (TT-XXX) → theo chu kỳ" };
    }
    return null;
}

// ==================== CẦU 3-2 ====================
function cau32(history) {
    if (history.length < 5) return null;
    const r = history.slice(0, 5).map(h => h.result);
    if (r[0] === r[1] && r[1] === r[2] && r[3] === r[4] && r[0] !== r[3]) {
        return { pred: r[0], conf: 72, note: "Cầu 3-2 (TTT-XX) → theo chu kỳ" };
    }
    return null;
}

// ==================== CẦU NHỊP 3 ====================
function cauNhip3(history) {
    if (history.length < 10) return null;
    const st = streakList(history, 14);
    if (st.length < 7) return null;
    const lens = st.slice(1, 8).map(s => s.len);

    const check = (P) => {
        for (let start = 0; start < P.length; start++) {
            let ok = true;
            for (let i = 0; i < P.length * 2; i++) {
                if (lens[i] !== P[(start + i) % P.length]) { ok = false; break; }
            }
            if (ok) return true;
        }
        return false;
    };

    if (check([1, 2, 1])) return { pred: st[0].type, conf: 75, note: "Cầu nhịp 1-2-1" };
    if (check([2, 1, 2])) return { pred: st[0].type, conf: 75, note: "Cầu nhịp 2-1-2" };
    if (check([1, 3, 1])) return { pred: st[0].type, conf: 73, note: "Cầu nhịp 1-3-1" };
    if (check([3, 1, 3])) return { pred: st[0].type, conf: 73, note: "Cầu nhịp 3-1-3" };
    if (check([1, 2, 3])) return { pred: st[0].type, conf: 70, note: "Cầu nhịp 1-2-3" };
    if (check([3, 2, 1])) return { pred: st[0].type, conf: 70, note: "Cầu nhịp 3-2-1" };
    return null;
}

// ==================== XỬ LÝ BÃO ====================
function xuLyBao(dice) {
    if (!dice || dice.length < 3) return null;
    if (dice[0] === dice[1] && dice[1] === dice[2]) {
        return { pred: "Nghỉ", conf: 0, note: `BÃO [${dice[0]}-${dice[0]}-${dice[0]}] → NGHỈ 3 PHIÊN` };
    }
    return null;
}

// ==================== DỰ ĐOÁN TỔNG HỢP ====================
function predictCombo(history) {
    if (!history || history.length < 3) {
        return { prediction: "Tài", confidence: 50, reason: "Chưa có dữ liệu", total: null };
    }

    const last = history[0];
    const lastTotal = last.total;
    const lastDice = last.dice;
    const lastResult = last.result;
    const lenBET = getStreakLen(history);

    // 1. BÃO
    const bao = xuLyBao(lastDice);
    if (bao) {
        return { prediction: "Nghỉ", confidence: 0, reason: bao.note, total: lastTotal, isBao: true };
    }

    const signals = [];

    // 2. Bảng điểm
    const diem = BANG_DIEM[lastTotal];
    if (diem && diem.pred !== "Nghỉ") {
        signals.push({ pred: diem.pred, conf: diem.conf, note: diem.note, priority: 100, source: "Bảng điểm" });
    }

    // 3. Cầu mặt xúc xắc
    const cauMat = cauMatXucXac(lastDice);
    if (cauMat) {
        let pred = cauMat.pred;
        if (pred === "Đảo") pred = lastResult === "Tài" ? "Xỉu" : "Tài";
        signals.push({ pred, conf: cauMat.conf, note: cauMat.note, priority: 90, source: "Mặt XX" });
    }

    // 4. Bệt
    const bet = cauBet(history, lenBET, lastResult);
    if (bet) signals.push({ ...bet, priority: 85, source: "Bệt" });

    // 5. Cầu 3-3
    const c33 = cau33(history);
    if (c33) signals.push({ ...c33, priority: 82, source: "Cầu 3-3" });

    // 6. Cầu 3-1
    const c31r = cau31(history);
    if (c31r) signals.push({ ...c31r, priority: 80, source: "Cầu 3-1" });

    // 7. Cầu 1-3
    const c13r = cau13(history);
    if (c13r) signals.push({ ...c13r, priority: 80, source: "Cầu 1-3" });

    // 8. Cầu 2-2
    const c22r = cau22(history);
    if (c22r) signals.push({ ...c22r, priority: 78, source: "Cầu 2-2" });

    // 9. Cầu 2-1
    const c21r = cau21(history);
    if (c21r) signals.push({ ...c21r, priority: 78, source: "Cầu 2-1" });

    // 10. Cầu 1-2
    const c12r = cau12(history);
    if (c12r) signals.push({ ...c12r, priority: 78, source: "Cầu 1-2" });

    // 11. Cầu 3-2
    const c32r = cau32(history);
    if (c32r) signals.push({ ...c32r, priority: 76, source: "Cầu 3-2" });

    // 12. Cầu 2-3
    const c23r = cau23(history);
    if (c23r) signals.push({ ...c23r, priority: 76, source: "Cầu 2-3" });

    // 13. Nhịp 3
    const rh = cauNhip3(history);
    if (rh) signals.push({ ...rh, priority: 74, source: "Nhịp 3" });

    // 14. Cầu 1-1
    const c11r = cau11(history);
    if (c11r) signals.push({ ...c11r, priority: 72, source: "Cầu 1-1" });

    signals.sort((a, b) => b.priority - a.priority || b.conf - a.conf);
    const best = signals[0];

    if (best) {
        return {
            prediction: best.pred,
            confidence: Math.min(98, Math.max(55, best.conf)),
            reason: best.note,
            total: lastTotal,
            doDaiBET: lenBET,
            priority: best.priority,
            source: best.source,
            all_signals: signals.slice(0, 5).map(s => `${s.source}: ${s.pred} (${s.conf}%)`)
        };
    }

    return {
        prediction: "Xỉu",
        confidence: 55,
        reason: "Cầu loạn, ưu tiên Xỉu (tỉ lệ ~52%)",
        total: lastTotal,
        doDaiBET: lenBET,
        priority: 0,
        all_signals: []
    };
}

// ==================== PARSE DỮ LIỆU ====================
function parseLinesHu(data) {
    if (!data || !Array.isArray(data.list)) return [];
    return data.list.sort((a, b) => b.id - a.id).map(item => ({
        session: item.id,
        dice: item.dices,
        total: item.point,
        result: item.point >= 11 ? "Tài" : "Xỉu",
        result_vn: item.point >= 11 ? "Tài" : "Xỉu",
        timestamp: Date.now()
    })).sort((a, b) => a.session - b.session);
}

function parseLinesMd5(data) {
    if (!data || !Array.isArray(data.list)) return [];
    return data.list.sort((a, b) => b.id - a.id).map(item => ({
        session: item.id,
        dice: item.dices,
        total: item.point,
        result: item.resultTruyenThong === "Tài" ? "Tài" : "Xỉu",
        result_vn: item.resultTruyenThong,
        timestamp: Date.now()
    })).sort((a, b) => a.session - b.session);
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
            if (newRecords.length > 0) console.log(`🆕 [HŨ] +${newRecords.length} phiên mới`);
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
            if (newRecords.length > 0) console.log(`🆕 [MD5] +${newRecords.length} phiên mới`);
        }
    } catch (e) {
        console.error(`❌ [MD5] Lỗi:`, e.message);
    }
}

// ==================== MIDDLEWARE CHECK KEY ====================
function checkKey(query) {
    const userKey = query.key;
    if (!userKey || userKey !== VALID_KEY) {
        return { valid: false, error: `Sai key! Ib ${ADMIN} để mua key` };
    }
    return { valid: true };
}

// ==================== FASTIFY SERVER ====================
const app = fastify({ logger: false });
await app.register(cors, { origin: "*" });

app.get("/", async () => {
    return {
        status: "active",
        admin: ADMIN,
        message: `API hỗ trợ 2 bàn HŨ + MD5, mua key ib ${ADMIN}`,
        algorithm: "🎲 TÀI XỈU VIP - BẮT CẦU CHUYÊN SÂU 🎲",
        key: VALID_KEY,
        features: [
            "📊 Bảng bắt điểm hốt bạc (cập nhật từ 800+ phiên thực tế)",
            "🎲 Cầu theo mặt xúc xắc (Kép bé→Xỉu, Kép lớn→Tài, Gánh→Đảo, Tiến→Tài, Lùi→Xỉu)",
            "🔥 Cầu bệt (3-6 tay → theo, 7+ tay → bẻ)",
            "🔄 Full cầu: 1-1, 2-2, 3-3, 2-1, 1-2, 3-1, 1-3, 2-3, 3-2",
            "🌀 Cầu nhịp 3: 1-2-1, 2-1-2, 1-3-1, 3-1-3, 1-2-3, 3-2-1",
            "⚠️ Xử lý BÃO (3 mặt giống → nghỉ)"
        ],
        endpoints: {
            hu:  `/api/taixiu/lc79?key=${VALID_KEY}`,
            md5: `/api/taixiumd5/lc79?key=${VALID_KEY}`,
            bang_diem: `/api/bang-diem?key=${VALID_KEY}`,
            stats: `/api/stats?key=${VALID_KEY}`
        }
    };
});

// ==================== API HŨ ====================
app.get("/api/taixiu/lc79", async (request, reply) => {
    const keyCheck = checkKey(request.query);
    if (!keyCheck.valid) return reply.status(401).send({ error: keyCheck.error });

    if (huHistory.length < 3) {
        return reply.status(503).send({ error: "Đang phân tích dữ liệu HŨ, vui lòng chờ...", need: "Cần ít nhất 3 phiên" });
    }

    const lastResult = huHistory[0];
    const prediction = predictCombo(huHistory);

    const last5 = huHistory.slice(0, 5).map((v, i) => ({
        stt: i + 1,
        result: v.result_vn,
        total: v.total,
        dice: `${v.dice[0]}-${v.dice[1]}-${v.dice[2]}`
    }));

    const response = {
        "Id": ADMIN,
        "Game": "HŨ",
        "Phien_truoc": lastResult.session,
        "Xuc_xac": `${lastResult.dice[0]} - ${lastResult.dice[1]} - ${lastResult.dice[2]}`,
        "Ket_qua": lastResult.result_vn.toLowerCase(),
        "Tong": lastResult.total,
        "Phien_nay": lastResult.session + 1,
        "Du_doan": prediction.prediction === "Tài" ? "tài" : prediction.prediction === "Xỉu" ? "xỉu" : "nghỉ",
        "Do_tin_cay": `${prediction.confidence}%`,
        "Ly_do": prediction.reason,
        "Biet_hien_tai": `${prediction.doDaiBET} ván`,
        "Nguon_cau": prediction.source || "Tổng hợp"
    };

    if (prediction.isBao) {
        response["Canh_bao"] = "⚠️ BÃO XUẤT HIỆN - NÊN NGHỈ 3 PHIÊN ⚠️";
    }

    response["5_van_gan_nhat"] = last5;
    return response;
});

app.get("/api/taixiu/lc79/history", async (request, reply) => {
    const keyCheck = checkKey(request.query);
    if (!keyCheck.valid) return reply.status(401).send({ error: keyCheck.error });
    return [...huHistory].sort((a, b) => b.session - a.session).slice(0, 30).map(i => ({
        session: i.session, dice: i.dice, total: i.total, result: i.result_vn.toLowerCase()
    }));
});

// ==================== API MD5 ====================
app.get("/api/taixiumd5/lc79", async (request, reply) => {
    const keyCheck = checkKey(request.query);
    if (!keyCheck.valid) return reply.status(401).send({ error: keyCheck.error });

    if (md5History.length < 3) {
        return reply.status(503).send({ error: "Đang phân tích dữ liệu MD5, vui lòng chờ...", need: "Cần ít nhất 3 phiên" });
    }

    const lastResult = md5History[0];
    const prediction = predictCombo(md5History);

    const last5 = md5History.slice(0, 5).map((v, i) => ({
        stt: i + 1,
        result: v.result_vn,
        total: v.total,
        dice: `${v.dice[0]}-${v.dice[1]}-${v.dice[2]}`
    }));

    const response = {
        "Id": ADMIN,
        "Game": "MD5",
        "Phien_truoc": lastResult.session,
        "Xuc_xac": `${lastResult.dice[0]} - ${lastResult.dice[1]} - ${lastResult.dice[2]}`,
        "Ket_qua": lastResult.result_vn.toLowerCase(),
        "Tong": lastResult.total,
        "Phien_nay": lastResult.session + 1,
        "Du_doan": prediction.prediction === "Tài" ? "tài" : prediction.prediction === "Xỉu" ? "xỉu" : "nghỉ",
        "Do_tin_cay": `${prediction.confidence}%`,
        "Ly_do": prediction.reason,
        "Biet_hien_tai": `${prediction.doDaiBET} ván`,
        "Nguon_cau": prediction.source || "Tổng hợp"
    };

    if (prediction.isBao) {
        response["Canh_bao"] = "⚠️ BÃO XUẤT HIỆN - NÊN NGHỈ 3 PHIÊN ⚠️";
    }

    response["5_van_gan_nhat"] = last5;
    return response;
});

app.get("/api/taixiumd5/lc79/history", async (request, reply) => {
    const keyCheck = checkKey(request.query);
    if (!keyCheck.valid) return reply.status(401).send({ error: keyCheck.error });
    return [...md5History].sort((a, b) => b.session - a.session).slice(0, 30).map(i => ({
        session: i.session, dice: i.dice, total: i.total, result: i.result_vn.toLowerCase()
    }));
});

// ==================== API BẢNG ĐIỂM ====================
app.get("/api/bang-diem", async (request, reply) => {
    const keyCheck = checkKey(request.query);
    if (!keyCheck.valid) return reply.status(401).send({ error: keyCheck.error });

    return {
        title: "📊 BẢNG BẮT ĐIỂM 'HỐT BẠC' 📊",
        description: "Đã điều chỉnh từ 4 file txt (800+ phiên thực tế)",
        xiu: {
            title: "NHÓM XỈU (3-10)",
            "3": "X3 → XỈU 65%",
            "4": "X4 → TÀI 80%",
            "5": "X5 → XỈU 62%",
            "6": "X6 → XỈU 65%",
            "7": "X7 → TÀI 62%",
            "8": "X8 → XỈU 65%",
            "9": "X9 → XỈU 70%",
            "10": "X10 → TÀI 80%"
        },
        tai: {
            title: "NHÓM TÀI (11-18)",
            "11": "T11 → TÀI 65%",
            "12": "T12 → TÀI 70%",
            "13": "T13 → XỈU 68%",
            "14": "T14 → XỈU 85%",
            "15": "T15 → TÀI 70%",
            "16": "T16 → XỈU 72%",
            "17": "T17 → XỈU 72%",
            "18": "T18 → XỈU 95%"
        },
        cau: {
            mat_xuc_xac: {
                "Kép Bé (1-1, 2-2)": "XỈU 80%",
                "Kép Lớn (5-5, 6-6)": "TÀI 80%",
                "Kép 3": "XỈU 65%",
                "Kép 4": "TÀI 65%",
                "2 mặt 6": "XỈU 85%",
                "2 mặt 1": "TÀI 75%",
                "Cầu Gánh (a-b-a)": "ĐẢO 85%",
                "Cầu Tiến (1-2-3)": "TÀI 78%",
                "Cầu Lùi (6-5-4)": "XỈU 78%"
            },
            bet: {
                "Bệt 3-5 tay": "Theo tiếp 62-68%",
                "Bệt 6 tay": "Theo tiếp 63%",
                "Bệt 7-9 tay": "Bẻ ngược 75%",
                "Bệt 10+ tay": "Bẻ mạnh 82%"
            },
            full_cau: {
                "1-1 (T-X-T-X)": "Đảo 72%",
                "2-2 (TT-XX)": "Theo 75%",
                "3-3 (TTT-XXX)": "Theo 78%",
                "2-1 (TT-X-TT-X)": "Theo 74%",
                "1-2 (T-XX-T-XX)": "Theo 74%",
                "3-1 (TTT-X)": "Theo 76%",
                "1-3 (T-XXX)": "Theo 76%",
                "2-3 (TT-XXX)": "Theo 72%",
                "3-2 (TTT-XX)": "Theo 72%",
                "Nhịp 1-2-1": "Theo 75%",
                "Nhịp 2-1-2": "Theo 75%",
                "Nhịp 1-3-1": "Theo 73%",
                "Nhịp 3-1-3": "Theo 73%",
                "Nhịp 1-2-3": "Theo 70%",
                "Nhịp 3-2-1": "Theo 70%"
            }
        },
        xu_ly_bao: "BÃO (3 mặt giống) → NGHỈ 3 PHIÊN",
        note: `⚠️ Ưu tiên tín hiệu: BÃO > Bảng điểm > Mặt XX > Bệt > Cầu khác`
    };
});

// ==================== API CHECK KEY ====================
app.get("/check-key", async (request) => {
    const userKey = request.query.key;
    if (!userKey) return { status: "error", message: `Sai key! Ib ${ADMIN} để mua key` };
    if (userKey === VALID_KEY) return { status: "success", message: "KEY HỢP LỆ", admin: ADMIN };
    return { status: "error", message: `Sai key! Ib ${ADMIN} để mua key` };
});

// ==================== API THỐNG KÊ ====================
app.get("/api/stats", async (request, reply) => {
    const keyCheck = checkKey(request.query);
    if (!keyCheck.valid) return reply.status(401).send({ error: keyCheck.error });

    const huTai  = huHistory.filter(h => h.result === "Tài").length;
    const huXiu  = huHistory.length - huTai;
    const md5Tai = md5History.filter(h => h.result === "Tài").length;
    const md5Xiu = md5History.length - md5Tai;

    return {
        hu: {
            history_length: huHistory.length,
            last_session: huHistory[0] || null,
            ti_le: huHistory.length > 0
                ? `${(huTai / huHistory.length * 100).toFixed(1)}% Tài - ${(huXiu / huHistory.length * 100).toFixed(1)}% Xỉu`
                : "Chưa có dữ liệu"
        },
        md5: {
            history_length: md5History.length,
            last_session: md5History[0] || null,
            ti_le: md5History.length > 0
                ? `${(md5Tai / md5History.length * 100).toFixed(1)}% Tài - ${(md5Xiu / md5History.length * 100).toFixed(1)}% Xỉu`
                : "Chưa có dữ liệu"
        },
        algorithm: "TÀI XỈU VIP - BẮT CẦU CHUYÊN SÂU",
        key: VALID_KEY,
        admin: ADMIN
    };
});

// ==================== START SERVER ====================
const start = async () => {
    try {
        await app.listen({ port: PORT, host: "0.0.0.0" });
    } catch (err) {
        console.error("❌ Lỗi khởi động server:", err.message);
        process.exit(1);
    }

    fetchHuData().catch(() => {});
    fetchMd5Data().catch(() => {});
    setInterval(fetchHuData, 5000);
    setInterval(fetchMd5Data, 5000);

    console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║  TÀI XỈU HŨ & MD5 - BẮT CẦU CHUYÊN SÂU (FULL CẦU + BẢNG ĐIỂM CẬP NHẬT)      ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  🚀 Server running on port ${PORT}
║  🔑 KEY: ${VALID_KEY}
║  👤 ADMIN: ${ADMIN}
║                                                                              ║
║  📊 BẢNG MẸO ĐIỂM (đã sửa từ 4 file txt 800+ phiên):                        ║
║     X3→Xỉu65, X4→Tài80, X5→Xỉu62, X6→Xỉu65, X7→Tài62, X8→Xỉu65              ║
║     X9→Xỉu70, X10→Tài80, T11→Tài65, T12→Tài70, T13→Xỉu68                   ║
║     T14→Xỉu85, T15→Tài70, T16→Xỉu72, T17→Xỉu72, T18→Xỉu95                  ║
║                                                                              ║
║  🎲 CẦU THEO MẶT XÚC XẮC:                                                   ║
║     Kép bé→Xỉu, Kép lớn→Tài, Gánh→Đảo, Tiến→Tài, Lùi→Xỉu                   ║
║     2 mặt 6→Xỉu85, 2 mặt 1→Tài75, Kép 3→Xỉu, Kép 4→Tài                     ║
║                                                                              ║
║  🔥 FULL CẦU:                                                               ║
║     • 1-1 (T-X-T-X)      • 2-2 (TT-XX)       • 3-3 (TTT-XXX)              ║
║     • 2-1 (TT-X-TT-X)    • 1-2 (T-XX-T-XX)   • 3-1 (TTT-X)                 ║
║     • 1-3 (T-XXX)        • 2-3 (TT-XXX)      • 3-2 (TTT-XX)                ║
║     • Nhịp 3: 1-2-1, 2-1-2, 1-3-1, 3-1-3, 1-2-3, 3-2-1                    ║
║                                                                              ║
║  🔥 CẦU BỆT: 3-6 tay→theo, 7-9 tay→bẻ, 10+→bẻ mạnh                         ║
║  ⚠️ BÃO: 3 mặt giống → NGHỈ 3 PHIÊN                                         ║
║                                                                              ║
║  🎯 API ENDPOINTS:                                                           ║
║     HŨ:  /api/taixiu/lc79?key=${VALID_KEY}
║     MD5: /api/taixiumd5/lc79?key=${VALID_KEY}
║     Bảng điểm: /api/bang-diem?key=${VALID_KEY}
║     Stats: /api/stats?key=${VALID_KEY}
║                                                                              ║
║  📞 ADMIN: ${ADMIN}
╚══════════════════════════════════════════════════════════════════════════════╝
`);
};

start();
