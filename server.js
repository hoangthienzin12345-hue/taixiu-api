import fastify from "fastify";
import cors from "@fastify/cors";
import fetch from "node-fetch";

// ==================== CẤU HÌNH ====================
const PORT = process.env.PORT || 3000;
const VALID_KEY = "Thien456";
const ADMIN = "@ADMNLc79";
const N = 15;

const API_HU  = "https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5";
const API_MD5 = "https://wtxmd52.tele68.com/v1/txmd5/sessions";

// ==================== BẢNG BẮT ĐIỂM "HỐT BẠC" ====================
const BANG_DIEM = {
    3:  { pred: "Nghỉ", conf: 0,   note: "X3 Dữ liệu hiếm, nên nghỉ" },
    4:  { pred: "Tài",  conf: 90,  note: "X4 ALL TÀI (90% Bẻ cầu)" },
    5:  { pred: "Tài",  conf: 70,  note: "X5 70% TÀI" },
    6:  { pred: "Tài",  conf: 80,  note: "X6 ALL TÀI (Hay nhảy T12)" },
    7:  { pred: "Xỉu",  conf: 80,  note: "X7 BỆT XỈU (Hoặc về X8, X9)" },
    8:  { pred: "Tài",  conf: 85,  note: "X8 ALL TÀI (Tỉ lệ nổ Tài cực cao)" },
    9:  { pred: "Xỉu",  conf: 80,  note: "X9 ALL XỈU (Đứng Xỉu 10)" },
    10: { pred: "Tài",  conf: 90,  note: "X10 ALL TÀI (Điểm gãy sang T11, T12)" },
    11: { pred: "Xỉu",  conf: 85,  note: "T11 ALL XỈU (Hồi mã thương 80-85%)" },
    12: { pred: "Tài",  conf: 70,  note: "T12 BỆT TÀI (65-70% Đứng tiếp Tài)" },
    13: { pred: "Xỉu",  conf: 70,  note: "T13 60-70% XỈU (Cầu 1-1)" },
    14: { pred: "Xỉu",  conf: 95,  note: "T14 SIÊU XỈU (Điểm vàng để bẻ)" },
    15: { pred: "Tài",  conf: 70,  note: "T15 ALL TÀI (Nổ Tài 16, 17)" },
    16: { pred: "Xỉu",  conf: 85,  note: "T16 ALL XỈU (Tài lớn dễ gãy)" },
    17: { pred: "Xỉu",  conf: 90,  note: "T17 ALL XỈU (90% Về Xỉu ngay)" },
    18: { pred: "Xỉu",  conf: 100, note: "T18 BẺ XỈU 100%" }
};

// ==================== CẦU CHU KỲ ====================
// cycle: [độ dài streak theo thứ tự CŨ→MỚI]
const CAU_CYCLE = [
    { cycle: [1],     name: "1-1",   conf: 80, minCheck: 3 },
    { cycle: [2],     name: "2-2",   conf: 80, minCheck: 2 },
    { cycle: [3],     name: "3-3",   conf: 75, minCheck: 2 },
    { cycle: [4],     name: "4-4",   conf: 70, minCheck: 2 },
    { cycle: [1,2,1], name: "1-2-1", conf: 75, minCheck: 6 },
    { cycle: [1,2,2], name: "1-2-2", conf: 75, minCheck: 6 },
    { cycle: [2,2,1], name: "2-2-1", conf: 75, minCheck: 6 },
    { cycle: [1,2,3], name: "1-2-3", conf: 72, minCheck: 6 },
    { cycle: [3,1,2], name: "3-1-2", conf: 72, minCheck: 6 },
    { cycle: [1,3],   name: "1-3-1", conf: 73, minCheck: 4 },
    { cycle: [3,1],   name: "3-1-3", conf: 73, minCheck: 4 }
];

// ==================== CHUẨN HOÁ ====================
const norm = (v, p) => {
    if (v != null) {
        const s = String(v).toLowerCase().trim();
        if (["tài","tai","t","big"].includes(s)) return "Tài";
        if (["xỉu","xiu","x","small"].includes(s)) return "Xỉu";
    }
    return Number(p) >= 11 ? "Tài" : "Xỉu";
};
const opp = x => x === "Tài" ? "Xỉu" : "Tài";

// ==================== HELPERS ====================
function streaks(hist) {
    if (!hist?.length) return [];
    const out = []; let t = hist[0].result, l = 1;
    for (let i = 1; i < hist.length; i++) {
        if (hist[i].result === t) l++;
        else { out.push({ type: t, len: l }); t = hist[i].result; l = 1; }
    }
    out.push({ type: t, len: l });
    return out;
}
const chart = h => h?.length
    ? h.slice(0, N).reverse().map(x => x.result === "Tài" ? "T" : "X").join("")
    : "";
const bao = d => d?.[0] === d?.[1] && d?.[1] === d?.[2];

// ==================== CẦU THEO MẶT XÚC XẮC ====================
function cauMatXucXac(dice) {
    if (!dice || dice.length < 3) return null;
    const [a, b, c] = dice;

    // 1. Kép Bé (1-1, 2-2) → BỆT XỈU
    if ((a===1&&b===1)||(a===2&&b===2)||(b===1&&c===1)||(b===2&&c===2)) {
        return { pred: "Xỉu", conf: 80, note: "Kép Bé → BỆT XỈU" };
    }
    // 2. Kép Lớn (5-5, 6-6) → BỆT TÀI
    if ((a===5&&b===5)||(a===6&&b===6)||(b===5&&c===5)||(b===6&&c===6)) {
        return { pred: "Tài", conf: 80, note: "Kép Lớn → BỆT TÀI" };
    }
    // 3. Hai mặt 6 → XỈU
    if (dice.filter(x => x === 6).length === 2) {
        return { pred: "Xỉu", conf: 85, note: "2 mặt 6 → XỈU" };
    }
    // 4. Gánh [a-b-a] → ĐẢO CẦU
    if (a === c && a !== b) {
        return { pred: "Đảo", conf: 85, note: `Gánh [${a}-${b}-${a}] → ĐẢO` };
    }
    // 5. Tiến [a-(a+1)-(a+2)] → TÀI
    if (a+1 === b && b+1 === c) {
        return { pred: "Tài", conf: 80, note: `Tiến [${a}-${b}-${c}] → TÀI` };
    }
    // 6. Lùi [a-(a-1)-(a-2)] → XỈU
    if (a-1 === b && b-1 === c) {
        return { pred: "Xỉu", conf: 80, note: `Lùi [${a}-${b}-${c}] → XỈU` };
    }
    return null;
}

// ==================== CẦU BỆT ====================
function cauBet(history, lastResult) {
    let len = 1;
    for (let i = 1; i < Math.min(history.length, 20); i++) {
        if (history[i]?.result === lastResult) len++;
        else break;
    }
    if (len >= 4 && len <= 6) {
        return { pred: lastResult, conf: 70 + (len - 3) * 3, note: `Bệt ${len} tay → THEO`, doDaiBET: len };
    }
    if (len >= 7) {
        return { pred: opp(lastResult), conf: 80, note: `Bệt ${len} tay → BẺ`, doDaiBET: len };
    }
    return { pred: null, conf: 0, note: "", doDaiBET: len };
}

// ==================== CẦU CHU KỲ ====================
function matchCycle(st, cycle, name, conf, minCheck) {
    const P = cycle.length;
    if (st.length < minCheck + 1) return null;
    for (let i = 1; i <= minCheck; i++) {
        const expected = cycle[(P - (i % P)) % P];
        if (st[i]?.len !== expected) return null;
    }
    const tgt = cycle[0];
    const cur = st[0];
    if (cur.len < tgt) return { pred: cur.type, conf: conf - 3, cau: name, src: `cầu ${name} (${cur.len}/${tgt})` };
    if (cur.len === tgt) return { pred: opp(cur.type), conf, cau: name, src: `cầu ${name} (đảo)` };
    return null;
}

function byCycleCau(hist) {
    if (hist.length < 4) return null;
    const st = streaks(hist);
    if (st.length < 3) return null;
    for (const c of CAU_CYCLE) {
        const r = matchCycle(st, c.cycle, c.name, c.conf, c.minCheck);
        if (r) return r;
    }
    return null;
}

// ==================== BẢNG ĐIỂM ====================
function byDiem(total) {
    const e = BANG_DIEM[total];
    if (!e || e.pred === "Nghỉ") return null;
    return { pred: e.pred, conf: e.conf, cau: `điểm ${total}`, src: e.note };
}

// ==================== DỰ ĐOÁN TỔNG HỢP ====================
function predict(hist) {
    const last = hist[0];

    // 1. BÃO → NGHỈ
    if (bao(last.dice)) {
        return { pred: "NGHỈ", conf: 0, cau: "bão", src: "bão → nghỉ 3 phiên" };
    }

    const signals = [];

    // 1. Bảng điểm (ưu tiên cao nhất)
    const d = byDiem(Number(last.total));
    if (d) signals.push({ ...d, priority: 100 });

    // 2. Cầu mặt xúc xắc
    const cm = cauMatXucXac(last.dice);
    if (cm) {
        if (cm.pred === "Đảo") {
            signals.push({ pred: opp(last.result), conf: cm.conf, cau: "gánh", src: cm.note, priority: 95 });
        } else {
            signals.push({ pred: cm.pred, conf: cm.conf, cau: "mặt-xx", src: cm.note, priority: 95 });
        }
    }

    // 3. Bệt
    const bet = cauBet(hist, last.result);
    if (bet.pred) {
        signals.push({
            pred: bet.pred, conf: bet.conf,
            cau: bet.doDaiBET >= 7 ? "bệt-bẻ" : "bệt-theo",
            src: bet.note,
            priority: bet.doDaiBET >= 7 ? 90 : 80
        });
    }

    // 4. Cầu chu kỳ
    const cyc = byCycleCau(hist.slice(0, N));
    if (cyc) signals.push({ ...cyc, priority: 85 });

    // Không có tín hiệu → đảo mặc định
    if (!signals.length) {
        return { pred: opp(last.result), conf: 52, cau: "-", src: "đảo mặc định" };
    }

    // Sắp xếp theo priority rồi conf
    signals.sort((a, b) => b.priority - a.priority || b.conf - a.conf);

    // Đồng thuận top 2 cùng hướng → tăng conf
    if (signals.length >= 2 && signals[0].pred === signals[1].pred) {
        const conf = Math.min(97, Math.round((signals[0].conf + signals[1].conf) / 2) + 5);
        return {
            pred: signals[0].pred, conf,
            cau: signals[0].cau,
            src: `✅ ${signals[0].cau} + ${signals[1].cau} đồng thuận`
        };
    }

    return signals[0];
}

// ==================== PARSE ====================
function parse(data, isMd5) {
    if (!data?.list || !Array.isArray(data.list)) return [];
    return data.list.map(it => {
        const point = Number(it.point);
        const result = isMd5 ? norm(it.resultTruyenThong, point) : (point >= 11 ? "Tài" : "Xỉu");
        return { session: it.id, dice: it.dices, total: point, result };
    }).sort((a, b) => b.session - a.session);
}

// ==================== STATE & FETCH ====================
let hu = [], md5 = [], idHu = null, idMd5 = null;

async function tick(url, isMd5) {
    try {
        const res = await fetch(url);
        const arr = parse(await res.json(), isMd5);
        if (!arr.length) return;
        const latest = arr[0].session;
        const cur = isMd5 ? idMd5 : idHu;
        const tag = isMd5 ? "MD5" : "HŨ";

        if (!cur) {
            if (isMd5) { md5 = arr; idMd5 = latest; } else { hu = arr; idHu = latest; }
            console.log(`✅ [${tag}] ${arr.length} phiên | ${latest} (${arr[0].result})`);
        } else if (latest > cur) {
            const news = arr.filter(r => r.session > cur);
            const target = isMd5 ? md5 : hu;
            for (let i = news.length - 1; i >= 0; i--) target.unshift(news[i]);
            if (target.length > 500) target.length = 450;
            if (isMd5) idMd5 = latest; else idHu = latest;
            console.log(`🆕 [${tag}] +${news.length} | ${latest} (${arr[0].result})`);
        }
    } catch (e) { console.error(`❌ [${isMd5 ? "MD5" : "HŨ"}]:`, e.message); }
}

// ==================== RESPONSE ====================
function resp(hist) {
    const l = hist[0], p = predict(hist);
    return {
        "Id": ADMIN,
        "Phien_truoc": l.session,
        "Xuc_xac": `${l.dice[0]} - ${l.dice[1]} - ${l.dice[2]}`,
        "Ket_qua": l.result.toLowerCase(),
        "Phien_nay": l.session + 1,
        "Du_doan": p.pred === "Tài" ? "tài" : p.pred === "Xỉu" ? "xỉu" : "nghỉ",
        "Ty_le": `${p.conf}%`,
        "Cau": p.cau || "-"
    };
}

// ==================== SERVER ====================
const app = fastify({ logger: false });
await app.register(cors, { origin: "*" });
const keyOK = q => q.key === VALID_KEY;

app.get("/", async () => ({
    status: "active", admin: ADMIN,
    thuat_toan: "BÃO → BẢNG ĐIỂM → MẶT-XÚC-XẮC → BỆT → CẦU CHU KỲ",
    phan_tich: `${N} phiên`,
    cau_ho_tro: CAU_CYCLE.map(c => c.name),
    bang_diem: BANG_DIEM,
    endpoints: {
        hu: `/api/taixiu/lc79?key=${VALID_KEY}`,
        md5: `/api/taixiumd5/lc79?key=${VALID_KEY}`,
        debug_hu: `/api/debug/hu?key=${VALID_KEY}`,
        debug_md5: `/api/debug/md5?key=${VALID_KEY}`
    }
}));

const send = (h, rep) => h.length ? resp(h) : rep.status(503).send({ error: "Đang tải..." });

app.get("/api/taixiu/:g", async (req, rep) =>
    keyOK(req.query) ? send(hu, rep) : rep.status(401).send({ error: `Sai key! Ib ${ADMIN}` }));

app.get("/api/taixiumd5/:g", async (req, rep) =>
    keyOK(req.query) ? send(md5, rep) : rep.status(401).send({ error: `Sai key! Ib ${ADMIN}` }));

app.get("/api/taixiu/:g/history", async (req, rep) =>
    keyOK(req.query)
        ? hu.slice(0, N).map(i => ({ phien: i.session, xuc_xac: i.dice, tong: i.total, ket_qua: i.result.toLowerCase() }))
        : rep.status(401).send({ error: "Sai key" }));

app.get("/api/taixiumd5/:g/history", async (req, rep) =>
    keyOK(req.query)
        ? md5.slice(0, N).map(i => ({ phien: i.session, xuc_xac: i.dice, tong: i.total, ket_qua: i.result.toLowerCase() }))
        : rep.status(401).send({ error: "Sai key" }));

app.get("/api/debug/:loai", async (req, rep) => {
    if (!keyOK(req.query)) return rep.status(401).send({ error: "Sai key" });
    const h = req.params.loai === "md5" ? md5 : hu;
    if (!h.length) return rep.status(503).send({ error: "Chưa có dữ liệu" });

    const last = h[0];
    const d = byDiem(Number(last.total));
    const cm = cauMatXucXac(last.dice);
    const bet = cauBet(h, last.result);
    const cyc = byCycleCau(h.slice(0, N));
    const p = predict(h);

    return {
        bieu_do_cau: chart(h),
        streak: streaks(h.slice(0, N)).map(s => `${s.type === "Tài" ? "T" : "X"}${s.len}`).join("-"),
        tong_diem: last.total,
        bang_diem: d,
        mat_xuc_xac: cm,
        bet: bet.pred ? bet : null,
        cau_chu_ky: cyc,
        ket_qua: p
    };
});

app.get("/check-key", async req =>
    req.query.key === VALID_KEY
        ? { status: "success", message: "KEY HỢP LỆ", admin: ADMIN }
        : { status: "error", message: `Sai key! Ib ${ADMIN}` });

// ==================== START ====================
await Promise.all([tick(API_HU, false), tick(API_MD5, true)]);
setInterval(() => tick(API_HU, false), 5000);
setInterval(() => tick(API_MD5, true), 5000);

try {
    await app.listen({ port: PORT, host: "0.0.0.0" });
} catch (err) {
    console.error("❌ Lỗi khởi động:", err.message);
    process.exit(1);
}

console.log(`
╔══════════════════════════════════════════════════════════╗
║  🎯 TÀI XỈU LC79 - CẦU + BẢNG ĐIỂM + MẶT XÚC XẮC          ║
╠══════════════════════════════════════════════════════════╣
║  🚀 http://localhost:${PORT}                                 ║
║  🔑 KEY: ${VALID_KEY}                                       ║
║  👤 ADMIN: ${ADMIN}                                    ║
║                                                          ║
║  ⚡ THỨ TỰ: BÃO → BẢNG ĐIỂM → MẶT-XX → BỆT → CẦU CHU KỲ  ║
║                                                          ║
║  🎲 CẦU CHU KỲ HỖ TRỢ:                                   ║
║     1-1, 2-2, 3-3, 4-4                                   ║
║     1-2-1, 2-2-1, 1-2-2, 1-2-3, 3-1-2                    ║
║     1-3-1, 3-1-3                                         ║
║                                                          ║
║  🎲 CẦU MẶT XÚC XẮC:                                     ║
║     Kép Bé/Lớn, 2 mặt 6, Gánh, Tiến, Lùi                 ║
║                                                          ║
║  📊 BẢNG ĐIỂM: X4→Tài90%, X8→Tài85%, X10→Tài90%         ║
║                T14→Xỉu95%, T17→Xỉu90%, T18→Xỉu100%      ║
║                                                          ║
║  📌 API:                                                 ║
║     HŨ : /api/taixiu/lc79?key=${VALID_KEY}              ║
║     MD5: /api/taixiumd5/lc79?key=${VALID_KEY}           ║
║     DEBUG: /api/debug/hu?key=${VALID_KEY}               ║
╚══════════════════════════════════════════════════════════╝
`);
