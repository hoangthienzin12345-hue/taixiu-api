import fastify from "fastify";
import cors from "@fastify/cors";
import fetch from "node-fetch";

// ==================== CẤU HÌNH ====================
const PORT = 3000;
const VALID_KEY = "Thien456";
const ADMIN_ID = "@ADMNLc79";

// ==================== API URLs ====================
const API_URL_HU  = "https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5";
const API_URL_MD5 = "https://wtxmd52.tele68.com/v1/txmd5/sessions";

// ==================== CÁC MẪU CẦU ====================
// lens: độ dài các đoạn liên tiếp (mới nhất đứng trước), tự động đảo Tài/Xỉu
const PATTERNS = [
    { name: "1-1",       lens: [1,1,1,1],     weight: 72 },
    { name: "2-2",       lens: [2,2,2],       weight: 76 },
    { name: "2-1-2",     lens: [2,1,2],       weight: 80 },
    { name: "3-1-3",     lens: [3,1,3],       weight: 82 },
    { name: "3-3",       lens: [3,3,3],       weight: 78 },
    { name: "2-3-2",     lens: [2,3,2],       weight: 80 },
    { name: "3-2-3",     lens: [3,2,3],       weight: 82 },
    { name: "Kép 4",     lens: [2,2,2,2],     weight: 74 },
    { name: "ZigZag",    lens: [1,1,1,1,1],   weight: 70 }
];

// ==================== MATCH PATTERN ====================
function matchPattern(seq, lens) {
    let idx = 0;
    const segs = [];
    for (const len of lens) {
        if (idx + len > seq.length) return null;
        const seg = seq.slice(idx, idx + len);
        if (!seg.every(x => x === seg[0])) return null;
        segs.push(seg[0]);
        idx += len;
    }
    for (let i = 1; i < segs.length; i++) {
        if (segs[i] === segs[i - 1]) return null;
    }
    // Đoán ngược lại với đoạn mới nhất
    return { pred: segs[0] === "Tài" ? "Xỉu" : "Tài", segs };
}

// ==================== MARKOV (bậc 1, 2) ====================
function markov(seqOld, order) {
    if (seqOld.length < order + 4) return null;
    const counts = {};
    for (let i = order; i < seqOld.length; i++) {
        const key = seqOld.slice(i - order, i).join("|");
        if (!counts[key]) counts[key] = { "Tài": 0, "Xỉu": 0 };
        counts[key][seqOld[i]]++;
    }
    const recentKey = seqOld.slice(-order).join("|");
    const c = counts[recentKey];
    if (!c) return null;
    const total = c["Tài"] + c["Xỉu"];
    if (total < 3) return null;
    const pred = c["Tài"] > c["Xỉu"] ? "Tài" : "Xỉu";
    const conf = Math.round(50 + (Math.abs(c["Tài"] - c["Xỉu"]) / total) * 50);
    return { pred, weight: conf, name: `Markov${order} (${c["Tài"]}-${c["Xỉu"]})` };
}

// ==================== LẶP BLOCK ====================
function blockRepeat(seqOld) {
    const maxLen = Math.min(15, Math.floor(seqOld.length / 2));
    for (let len = maxLen; len >= 3; len--) {
        const suffix = seqOld.slice(-len).join("");
        for (let i = 0; i <= seqOld.length - len - 1; i++) {
            if (seqOld.slice(i, i + len).join("") === suffix) {
                const next = seqOld[i + len];
                if (next) return { pred: next, weight: Math.min(90, 55 + len * 3), name: `Lặp block ${len}` };
            }
        }
    }
    return null;
}

// ==================== LẶP CHU KÌ ====================
function cycleDetect(seqOld) {
    if (seqOld.length < 8) return null;
    for (let p = 2; p <= 8; p++) {
        let ok = true;
        let checks = 0;
        for (let i = seqOld.length - 1; i >= seqOld.length - p * 2 && i >= p; i--) {
            if (seqOld[i] !== seqOld[i - p]) { ok = false; break; }
            checks++;
        }
        if (ok && checks >= p * 2) {
            const next = seqOld[seqOld.length - p];
            return { pred: next, weight: 72, name: `Chu kì ${p}` };
        }
    }
    return null;
}

// ==================== ENTROPY ====================
function entropy(seq) {
    if (!seq.length) return 1;
    const pT = seq.filter(x => x === "Tài").length / seq.length;
    const pX = 1 - pT;
    let h = 0;
    if (pT > 0) h -= pT * Math.log2(pT);
    if (pX > 0) h -= pX * Math.log2(pX);
    return h;
}

// ==================== BỆT & BẺ BỆT ====================
function detectBet(seq) {
    let streak = 1;
    for (let i = 1; i < seq.length; i++) {
        if (seq[i] === seq[0]) streak++;
        else break;
    }
    if (streak >= 9) {
        return { pred: seq[0] === "Tài" ? "Xỉu" : "Tài", weight: 85, name: `Bẻ bệt ${streak} tay`, streak };
    }
    if (streak >= 4) {
        return { pred: seq[0], weight: Math.min(80, 65 + (streak - 4) * 3), name: `Bệt ${streak} tay`, streak };
    }
    return { pred: null, weight: 0, name: null, streak };
}

// ==================== DỰ ĐOÁN TỔNG HỢP ====================
function predictCombo(history) {
    if (!history || history.length < 3) {
        return {
            prediction: "Xỉu",
            confidence: 55,
            reason: "Chưa đủ dữ liệu, ưu tiên Xỉu",
            votes: [],
            streak: 1,
            entropy: 1,
            taiScore: 0,
            xiuScore: 0
        };
    }

    const seq    = history.map(h => h.result);        // mới nhất đứng đầu
    const seqOld = [...seq].reverse();                // cũ nhất đứng đầu
    const votes  = [];

    // 1. Các mẫu cầu
    for (const p of PATTERNS) {
        const m = matchPattern(seq, p.lens);
        if (m) votes.push({ pred: m.pred, weight: p.weight, name: `Cầu ${p.name}` });
    }

    // 2. Bệt / bẻ bệt
    const bet = detectBet(seq);
    if (bet.pred) votes.push({ pred: bet.pred, weight: bet.weight, name: bet.name });

    // 3. Markov 1 & 2
    const m1 = markov(seqOld, 1); if (m1) votes.push(m1);
    const m2 = markov(seqOld, 2); if (m2) votes.push(m2);

    // 4. Lặp block
    const br = blockRepeat(seqOld); if (br) votes.push(br);

    // 5. Lặp chu kì
    const cy = cycleDetect(seqOld); if (cy) votes.push(cy);

    // 6. Entropy
    const h = entropy(seqOld.slice(-30));
    if (h > 0.92) {
        votes.push({ pred: "Xỉu", weight: 55, name: `Entropy cao ${h.toFixed(2)} → ưu tiên Xỉu` });
    } else if (h < 0.7) {
        const last15 = seqOld.slice(-15);
        const pT = last15.filter(x => x === "Tài").length / last15.length;
        const pred = pT > 0.5 ? "Tài" : "Xỉu";
        votes.push({ pred, weight: 58, name: `Entropy thấp ${h.toFixed(2)} → theo xu hướng` });
    }

    // Cộng điểm vote
    let taiScore = 0, xiuScore = 0;
    for (const v of votes) {
        if (v.pred === "Tài") taiScore += v.weight;
        else xiuScore += v.weight;
    }

    if (taiScore === 0 && xiuScore === 0) {
        return {
            prediction: "Xỉu",
            confidence: 55,
            reason: "Không nhận diện được cầu, ưu tiên Xỉu",
            votes: [],
            streak: bet.streak,
            entropy: h,
            taiScore: 0,
            xiuScore: 0
        };
    }

    const total = taiScore + xiuScore;
    let finalPred, finalConf;
    if (taiScore > xiuScore) {
        finalPred = "Tài";
        finalConf = Math.round((taiScore / total) * 100);
    } else {
        finalPred = "Xỉu";
        finalConf = Math.round((xiuScore / total) * 100);
    }

    const sortedVotes = votes.slice().sort((a, b) => b.weight - a.weight);

    return {
        prediction: finalPred,
        confidence: Math.min(95, Math.max(55, finalConf)),
        reason: sortedVotes[0]?.name || "Tổng hợp",
        votes: sortedVotes.slice(0, 6),
        streak: bet.streak,
        entropy: h,
        taiScore,
        xiuScore
    };
}

// ==================== PARSE DỮ LIỆU ====================
function parseLinesHu(data) {
    if (!data || !Array.isArray(data.list)) return [];
    const sortedList = data.list.sort((a, b) => b.id - a.id);
    return sortedList.map(item => ({
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
    const sortedList = data.list.sort((a, b) => b.id - a.id);
    return sortedList.map(item => ({
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
        }
        else if (lastSession.session > currentSessionIdHu) {
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
        }
        else if (lastSession.session > currentSessionIdMd5) {
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

// ==================== MIDDLEWARE KIỂM TRA KEY ====================
function checkKey(query) {
    const userKey = query.key;
    if (!userKey) return { valid: false, error: "sai key rồi mua key ib @ADMNLc79" };
    if (userKey !== VALID_KEY) return { valid: false, error: "sai key rồi mua key ib @ADMNLc79" };
    return { valid: true };
}

// ==================== FORMAT RESPONSE ====================
function buildResponse(gameName, history) {
    const lastResult = history[0];
    const prediction = predictCombo(history);

    const last5 = history.slice(0, 5).map((v, i) => ({
        stt: i + 1,
        ket_qua: v.result_vn.toLowerCase(),
        tong: v.total,
        xuc_xac: `${v.dice[0]}-${v.dice[1]}-${v.dice[2]}`
    }));

    return {
        "Id": ADMIN_ID,
        "Game": gameName,
        "Phien_truoc": lastResult.session,
        "Xuc_xac": `${lastResult.dice[0]} - ${lastResult.dice[1]} - ${lastResult.dice[2]}`,
        "Ket_qua": lastResult.result_vn.toLowerCase(),
        "Phien_nay": lastResult.session + 1,
        "Du_doan": prediction.prediction.toLowerCase(),
        "Ty_le": `${prediction.confidence}%`,
        "Ly_do": prediction.reason,
        "Biet": `${prediction.streak} ván`,
        "Entropy": prediction.entropy.toFixed(3),
        "Cac_cau_phat_hien": prediction.votes.map(v => ({
            ten: v.name,
            du_doan: v.pred.toLowerCase(),
            diem: v.weight
        })),
        "5_van_gan_nhat": last5
    };
}

// ==================== FASTIFY SERVER ====================
const app = fastify({ logger: false });
await app.register(cors, { origin: "*" });

// Route gốc
app.get("/", async () => {
    return {
        status: "active",
        message: "API Tài Xỉu HŨ + MD5 - mua key ib @ADMNLc79",
        algorithm: "🎲 TÀI XỈU VIP - PHÂN TÍCH ĐA THUẬT TOÁN 🎲",
        admin: ADMIN_ID,
        key: VALID_KEY,
        features: [
            "🧠 Markov bậc 1 & bậc 2",
            "🔁 Lặp block & lặp chu kì",
            "📊 Entropy nhận diện cầu loạn / cầu bias",
            "🧩 Cầu: 1-1, 2-2, 2-1-2, 3-1-3, 3-3, 2-3-2, 3-2-3, kép, zigzag",
            "🔥 Bệt ≥4 theo, bệt ≥9 bẻ",
            "🎯 Voting hệ thống đa tầng"
        ]
    };
});

// ==================== API CHO BÀN HŨ ====================
app.get("/api/taixiu/lc79", async (request, reply) => {
    const keyCheck = checkKey(request.query);
    if (!keyCheck.valid) return reply.status(401).send({ error: keyCheck.error });

    if (huHistory.length < 3) {
        return reply.status(503).send({
            error: "Đang phân tích dữ liệu HŨ, vui lòng chờ...",
            need: "Cần ít nhất 3 phiên"
        });
    }

    return buildResponse("HŨ", huHistory);
});

// API lịch sử HŨ
app.get("/api/taixiu/lc79/history", async (request, reply) => {
    const keyCheck = checkKey(request.query);
    if (!keyCheck.valid) return reply.status(401).send({ error: keyCheck.error });
    return [...huHistory]
        .sort((a, b) => b.session - a.session)
        .slice(0, 30)
        .map(i => ({
            session: i.session,
            dice: i.dice,
            total: i.total,
            result: i.result_vn.toLowerCase()
        }));
});

// ==================== API CHO BÀN MD5 ====================
app.get("/api/taixiumd5/lc79", async (request, reply) => {
    const keyCheck = checkKey(request.query);
    if (!keyCheck.valid) return reply.status(401).send({ error: keyCheck.error });

    if (md5History.length < 3) {
        return reply.status(503).send({
            error: "Đang phân tích dữ liệu MD5, vui lòng chờ...",
            need: "Cần ít nhất 3 phiên"
        });
    }

    return buildResponse("MD5", md5History);
});

// API lịch sử MD5
app.get("/api/taixiumd5/lc79/history", async (request, reply) => {
    const keyCheck = checkKey(request.query);
    if (!keyCheck.valid) return reply.status(401).send({ error: keyCheck.error });
    return [...md5History]
        .sort((a, b) => b.session - a.session)
        .slice(0, 30)
        .map(i => ({
            session: i.session,
            dice: i.dice,
            total: i.total,
            result: i.result_vn.toLowerCase()
        }));
});

// ==================== API KIỂM TRA KEY ====================
app.get("/check-key", async (request) => {
    const userKey = request.query.key;
    if (!userKey) return { status: "error", message: "sai key rồi mua key ib @ADMNLc79" };
    if (userKey === VALID_KEY) return { status: "success", message: "KEY HỢP LỆ", key: VALID_KEY, admin: ADMIN_ID };
    return { status: "error", message: "sai key rồi mua key ib @ADMNLc79" };
});

// API thống kê
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
        algorithm: "TÀI XỈU VIP - PHÂN TÍCH ĐA THUẬT TOÁN",
        admin: ADMIN_ID,
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

    console.log("\n╔══════════════════════════════════════════════════════════════════════════════╗");
    console.log("║     TÀI XỈU HŨ & MD5 - PHÂN TÍCH ĐA THUẬT TOÁN (VOTING)                     ║");
    console.log("╠══════════════════════════════════════════════════════════════════════════════╣");
    console.log("║  🚀 Server running on port", PORT);
    console.log("║  🔑 KEY   :", VALID_KEY);
    console.log("║  👤 ADMIN :", ADMIN_ID);
    console.log("║                                                                              ║");
    console.log("║  🧩 MẪU CẦU:                                                                  ║");
    console.log("║     1-1, 2-2, 2-1-2, 3-1-3, 3-3, 2-3-2, 3-2-3, Kép 4, ZigZag               ║");
    console.log("║                                                                              ║");
    console.log("║  🧠 THUẬT TOÁN:                                                              ║");
    console.log("║     Markov 1, Markov 2, Lặp block, Lặp chu kì, Entropy                     ║");
    console.log("║     Bệt ≥4 → theo, Bệt ≥9 → bẻ                                              ║");
    console.log("║                                                                              ║");
    console.log("║  🎯 ENDPOINTS:                                                               ║");
    console.log("║     HŨ :  /api/taixiu/lc79?key=" + VALID_KEY + "                            ║");
    console.log("║     MD5:  /api/taixiumd5/lc79?key=" + VALID_KEY + "                         ║");
    console.log("║                                                                              ║");
    console.log("║  📞 ADMIN:", ADMIN_ID);
    console.log("╚══════════════════════════════════════════════════════════════════════════════╝\n");
};

start();
