// ═══════════════════════════════════════════════════════════════════════════════
//  TÀI XỈU LC79 — EXPERT SYSTEM API (HŨ + MD5)
//  Bảng điểm + Mẹo cầu + Tự học (Self-learning)
// ═══════════════════════════════════════════════════════════════════════════════
import fastify from "fastify";
import cors from "@fastify/cors";

const PORT      = process.env.PORT || 3000;
const VALID_KEY = "Thien456";
const ADMIN     = "@ADMNLc79";

// API endpoints cho từng bàn
const API_HU  = "https://wtx.tele68.com/v1/tx/sessions";
const API_MD5 = "https://wtxmd52.tele68.com/v1/txmd5/sessions";

// ═══════════════════════════════════════════════════════════════════════════════
//  BẢNG TRA TỔNG ĐIỂM (Sắp xếp xúc xắc tăng dần)
// ═══════════════════════════════════════════════════════════════════════════════
const SCORE_TABLE = {
    "111": { pred: "Xỉu", conf: 80 },
    "112": { pred: "Xỉu", conf: 70 }, "122": { pred: "Xỉu", conf: 70 },
    "113": { pred: "Xỉu", conf: 70 }, "131": { pred: "Xỉu", conf: 70 },
    "123": { pred: "Tài", conf: 70 }, "213": { pred: "Tài", conf: 70 },
    "132": { pred: "Tài", conf: 70 }, "114": { pred: "Tài", conf: 70 },
    "222": { pred: "Xỉu", conf: 70 }, "411": { pred: "Xỉu", conf: 70 },
    "124": { pred: "Tài", conf: 89 }, "133": { pred: "Tài", conf: 89 }, "331": { pred: "Tài", conf: 89 },
    "223": { pred: "Xỉu", conf: 70 }, "232": { pred: "Xỉu", conf: 70 }, "115": { pred: "Xỉu", conf: 70 },
    "151": { pred: "Xỉu", conf: 70 }, "511": { pred: "Xỉu", conf: 70 }, "241": { pred: "Xỉu", conf: 70 },
    "134": { pred: "Tài", conf: 70 }, "224": { pred: "Tài", conf: 70 }, "323": { pred: "Tài", conf: 70 },
    "116": { pred: "Xỉu", conf: 70 }, "125": { pred: "Xỉu", conf: 70 }, "233": { pred: "Xỉu", conf: 70 },
    "143": { pred: "Xỉu", conf: 70 }, "251": { pred: "Xỉu", conf: 70 }, "512": { pred: "Xỉu", conf: 70 },
    "611": { pred: "Xỉu", conf: 70 }, "431": { pred: "Xỉu", conf: 70 },
    "126": { pred: "Tài", conf: 70 }, "135": { pred: "Tài", conf: 70 }, "144": { pred: "Tài", conf: 70 }, "333": { pred: "Tài", conf: 70 },
    "225": { pred: "Xỉu", conf: 70 }, "234": { pred: "Xỉu", conf: 70 }, "261": { pred: "Xỉu", conf: 70 },
    "252": { pred: "Xỉu", conf: 70 }, "315": { pred: "Xỉu", conf: 70 }, "153": { pred: "Xỉu", conf: 70 },
    "136": { pred: "Tài", conf: 70 }, "145": { pred: "Tài", conf: 70 }, "244": { pred: "Tài", conf: 70 }, "343": { pred: "Tài", conf: 70 },
    "226": { pred: "Xỉu", conf: 70 }, "235": { pred: "Xỉu", conf: 70 }, "334": { pred: "Xỉu", conf: 70 },
    "163": { pred: "Xỉu", conf: 70 }, "316": { pred: "Xỉu", conf: 70 }, "424": { pred: "Xỉu", conf: 70 },
    "613": { pred: "Xỉu", conf: 70 }, "451": { pred: "Xỉu", conf: 70 },
    "236": { pred: "Tài", conf: 70 }, "344": { pred: "Tài", conf: 70 }, "434": { pred: "Tài", conf: 70 },
    "632": { pred: "Xỉu", conf: 70 }, "263": { pred: "Xỉu", conf: 70 }, "326": { pred: "Xỉu", conf: 70 },
    "155": { pred: "Xỉu", conf: 70 }, "461": { pred: "Xỉu", conf: 70 }, "146": { pred: "Xỉu", conf: 70 },
    "614": { pred: "Xỉu", conf: 70 }, "452": { pred: "Xỉu", conf: 70 }, "254": { pred: "Xỉu", conf: 70 },
    "353": { pred: "Xỉu", conf: 70 }, "533": { pred: "Xỉu", conf: 70 },
    "156": { pred: "Tài", conf: 70 }, "255": { pred: "Tài", conf: 70 }, "336": { pred: "Tài", conf: 70 }, "345": { pred: "Tài", conf: 70 },
    "246": { pred: "Xỉu", conf: 80 }, "444": { pred: "Xỉu", conf: 80 },
    "651": { pred: "Tài", conf: 70 }, "561": { pred: "Tài", conf: 70 }, "165": { pred: "Tài", conf: 70 },
    "516": { pred: "Tài", conf: 70 }, "615": { pred: "Tài", conf: 70 }, "552": { pred: "Tài", conf: 70 },
    "354": { pred: "Tài", conf: 70 }, "543": { pred: "Tài", conf: 70 }, "633": { pred: "Tài", conf: 70 },
    "363": { pred: "Tài", conf: 70 }, "426": { pred: "Tài", conf: 70 }, "624": { pred: "Tài", conf: 70 },
    "346": { pred: "Tài", conf: 70 }, "355": { pred: "Tài", conf: 70 }, "445": { pred: "Tài", conf: 70 },
    "166": { pred: "Xỉu", conf: 70 }, "256": { pred: "Xỉu", conf: 70 },
    "356": { pred: "Tài", conf: 70 }, "455": { pred: "Tài", conf: 70 },
    "266": { pred: "Xỉu", conf: 70 }, "446": { pred: "Xỉu", conf: 70 }, "554": { pred: "Xỉu", conf: 70 },
    "456": { pred: "Tài", conf: 70 }, "555": { pred: "Tài", conf: 70 },
    "366": { pred: "Xỉu", conf: 70 }, "465": { pred: "Xỉu", conf: 70 },
    "556": { pred: "Xỉu", conf: 70 }, "466": { pred: "Xỉu", conf: 70 }, "664": { pred: "Tài", conf: 70 }, "646": { pred: "Tài", conf: 70 },
    "566": { pred: "Tài", conf: 70 }, "666": { pred: "Bỏ", conf: 0 }
};

// ═══════════════════════════════════════════════════════════════════════════════
//  HÀM MẸO CẦU (Bridges)
// ═══════════════════════════════════════════════════════════════════════════════
function checkBridges(hist) {
    const n = hist.length;
    if (n < 4) return null;

    const cur = hist[n - 1], p1 = hist[n - 2], p2 = hist[n - 3], p3 = hist[n - 4];
    const curOpp = cur.result === "Tài" ? "Xỉu" : "Tài";

    // 1. 3 T-X-T + 9-10-7
    if (p2.result !== p1.result && p1.result !== cur.result) {
        const sums = [cur.sum, p1.sum, p2.sum];
        if (sums.includes(9) && sums.includes(10) && sums.includes(7))
            return { pred: curOpp, conf: 85, rule: "Bridge 1: 3 T-X-T + 9-10-7" };
    }

    // 2. Cầu lặp 8,9,10,11
    if (p1.sum === p2.sum && [8, 9, 10, 11].includes(p1.sum))
        return { pred: curOpp, conf: 80, rule: "Bridge 2: Lặp 8/9/10/11" };

    // 3. Cầu 1-1 so le
    if (p2.result !== p1.result && p1.result !== cur.result && p2.sum === cur.sum)
        return { pred: curOpp, conf: 99, rule: "Bridge 3: 1-1 so le" };

    // 4. Cộng con 7-12-7
    if (p2.sum === cur.sum && [7, 12].includes(cur.sum))
        return { pred: "Xỉu", conf: 90, rule: "Bridge 4: Cộng con 7-12-7" };

    // 5. Phá bệt nhẹ
    if (p3.result === p2.result && p2.result === p1.result && p1.result !== cur.result)
        return { pred: curOpp, conf: 61, rule: "Bridge 5: Phá bệt nhẹ" };

    // 6. 3 trắng/đen
    if (p2.result === p1.result && p1.result === cur.result)
        return { pred: curOpp, conf: 70, rule: "Bridge 6: 3 trắng/3 đen" };

    // 7. 5-4-3
    if (cur.sum === 3 && p1.sum === 4 && p2.sum === 5)
        return { pred: curOpp, conf: 86, rule: "Bridge 7: 5-4-3" };

    // 8. Đầu giống nhau
    if (p2.sum === cur.sum && p2.result === cur.result)
        return { pred: "Xỉu", conf: 75, rule: "Bridge 8: Đầu giống nhau" };

    return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TRẠNG THÁI TỪNG BÀN
// ═══════════════════════════════════════════════════════════════════════════════
const state = {
    hu:  { history: [], lastPred: null, ruleStats: {}, lastError: null },
    md5: { history: [], lastPred: null, ruleStats: {}, lastError: null }
};

const sortDice = d => [...d].sort((a, b) => a - b);

function predictExpert(hist, ruleStats) {
    if (!hist.length) return { pred: "Chờ", conf: 0, rule: "No data" };

    const last = hist[hist.length - 1];
    const key = sortDice(last.dices).join("");
    const tableRes = SCORE_TABLE[key] || { pred: "Chờ", conf: 50, rule: `Bảng điểm ${key}` };
    
    const bridgeRes = checkBridges(hist);

    let finalPred = tableRes.pred;
    let finalConf = tableRes.conf;
    let finalRule = tableRes.rule || `Bảng điểm ${key}`;

    if (bridgeRes) {
        if (bridgeRes.pred !== tableRes.pred) {
            if (bridgeRes.conf >= tableRes.conf || tableRes.conf < 70) {
                finalPred = bridgeRes.pred;
                finalConf = bridgeRes.conf;
                finalRule = bridgeRes.rule;
            } else {
                finalRule = `Bảng điểm (thắng Cầu) - ${tableRes.pred}`;
            }
        } else {
            finalConf = Math.min(95, Math.round((finalConf + bridgeRes.conf) / 2 + 5));
            finalRule = `Đồng thuận: ${bridgeRes.rule}`;
        }
    }

    // Tự học: điều chỉnh confidence
    if (ruleStats[finalRule]) {
        const { hit, total } = ruleStats[finalRule];
        const acc = hit / total;
        if (acc < 0.4) finalConf = Math.round(finalConf * 0.8);
        else if (acc > 0.6) finalConf = Math.min(99, finalConf + 5);
    }

    if (finalPred === "Bỏ") return { pred: "Bỏ", conf: 0, rule: "Tổng 18 (Bỏ)" };

    return { pred: finalPred, conf: finalConf, rule: finalRule };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  FETCH & UPDATE
// ═══════════════════════════════════════════════════════════════════════════════
async function fetchAndUpdate(gameKey, apiUrl) {
    const st = state[gameKey];
    try {
        const res = await fetch(apiUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
        const json = await res.json();
        const list = json.list || json.data || [];
        
        const newSessions = list.map(item => {
            const point = Number(item.point || item.total || 0);
            const resultRaw = String(item.resultTruyenThong || item.result || "").toUpperCase();
            const result = resultRaw.includes("TAI") || resultRaw.includes("TÀI") ? "Tài" 
                         : resultRaw.includes("XIU") || resultRaw.includes("XỈU") ? "Xỉu" 
                         : (point >= 11 ? "Tài" : "Xỉu");
            return { id: Number(item.id), result, dices: item.dices || [], sum: point };
        }).filter(x => x.id > 0 && x.dices.length === 3 && x.sum > 0)
          .sort((a, b) => a.id - b.id);

        if (!newSessions.length) return;

        const existingIds = new Set(st.history.map(h => h.id));
        let added = 0;
        for (const s of newSessions) {
            if (!existingIds.has(s.id)) {
                st.history.push(s);
                added++;
            }
        }
        st.history.sort((a, b) => a.id - b.id);
        if (st.history.length > 200) st.history = st.history.slice(-200);

        // Self-learning: Đánh giá dự đoán trước
        if (st.lastPred && added > 0) {
            const actual = st.history.find(h => h.id === st.lastPred.id);
            if (actual) {
                const correct = actual.result === st.lastPred.pred;
                if (!st.ruleStats[st.lastPred.rule]) st.ruleStats[st.lastPred.rule] = { hit: 0, total: 0 };
                st.ruleStats[st.lastPred.rule].total++;
                if (correct) st.ruleStats[st.lastPred.rule].hit++;
                st.lastPred = null;
            }
        }

        // Tạo dự đoán mới
        if (st.history.length > 0) {
            const lastId = st.history[st.history.length - 1].id;
            if (!st.lastPred || st.lastPred.id !== lastId + 1) {
                const p = predictExpert(st.history, st.ruleStats);
                st.lastPred = { id: lastId + 1, pred: p.pred, conf: p.conf, rule: p.rule };
            }
        }
        st.lastError = null;
    } catch (e) {
        st.lastError = e.message;
        console.error(`[${gameKey.toUpperCase()}]`, e.message);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SERVER
// ═══════════════════════════════════════════════════════════════════════════════
const app = fastify({ logger: false });
await app.register(cors, { origin: "*" });

const checkKey = q => q.key === VALID_KEY ? { valid: true } : { valid: false, error: `Sai key! Ib ${ADMIN}` };

function buildResp(gameKey) {
    const st = state[gameKey];
    if (!st.lastPred) return null;
    const last = st.history[st.history.length - 1];
    
    return {
        Id: ADMIN,
        Phien_nay: st.lastPred.id,
        Du_doan: st.lastPred.pred,
        Ty_le: `${st.lastPred.conf}%`,
        Phien_truoc: last.id,
        Xuc_xac: last.dices.join("-"),
        Ket_qua: last.result,
        Nguon: st.lastPred.rule
    };
}

app.get("/api/taixiu/lc79", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const r = buildResp("hu");
    return r || rep.status(503).send({ error: "Đang tải dữ liệu Hũ..." });
});

app.get("/api/taixiumd5/lc79", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const r = buildResp("md5");
    return r || rep.status(503).send({ error: "Đang tải dữ liệu MD5..." });
});

app.get("/check-key", async req => {
    const k = checkKey(req.query);
    if (k.valid) return { status: "success", message: "KEY HỢP LỆ", admin: ADMIN };
    return { status: "error", message: k.error };
});

// Debug endpoint
app.get("/api/debug/:game", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const game = req.params.game === "md5" ? "md5" : "hu";
    const st = state[game];
    return {
        loaded: st.history.length,
        last_pred: st.lastPred,
        rule_stats: st.ruleStats,
        last_error: st.lastError,
        recent: st.history.slice(-10)
    };
});

// ═══════════════════════════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════════════════════════
app.listen({ port: PORT, host: "0.0.0.0" }).then(() => {
    console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  🎲 TÀI XỈU LC79 — EXPERT SYSTEM API                                 ║
╠══════════════════════════════════════════════════════════════════════╣
║  🚀 Port: ${PORT}  🔑 ${VALID_KEY}  👤 ${ADMIN}
║
║  📌 HŨ : /api/taixiu/lc79?key=${VALID_KEY}
║  📌 MD5: /api/taixiumd5/lc79?key=${VALID_KEY}
║  🐞 Debug: /api/debug/hu?key=${VALID_KEY}
║  🔑 Check key: /check-key?key=${VALID_KEY}
║
║  🧠 Bảng điểm 16 mức + 8 mẹo cầu + Self-learning
╚══════════════════════════════════════════════════════════════════════╝
    `);

    // Fetch ngay + định kỳ
    fetchAndUpdate("hu", API_HU);
    fetchAndUpdate("md5", API_MD5);
    setInterval(() => fetchAndUpdate("hu", API_HU), 5000);
    setInterval(() => fetchAndUpdate("md5", API_MD5), 5000);
});