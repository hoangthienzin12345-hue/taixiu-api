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

// ==================== BẢNG ĐIỂM ====================
const MEO_DIEM = {
    3:  { p: "Xỉu", c: 70 }, 4:  { p: "Tài", c: 60 }, 5:  { p: "Tài", c: 70 },
    6:  { p: "Xỉu", c: 60 }, 7:  { p: "Tài", c: 80 }, 8:  { p: "Xỉu", c: 80 },
    9:  { p: "Xỉu", c: 70 }, 10: { p: "Tài", c: 80 }, 11: { p: "Xỉu", c: 60 },
    12: { p: "Tài", c: 80 }, 13: { p: "Tài", c: 80 }, 14: { p: "Xỉu", c: 60 },
    15: { p: "Xỉu", c: 70 }, 16: { p: "Tài", c: 60 }, 17: { p: "Xỉu", c: 60 },
    18: { p: "Xỉu", c: 80 }
};

// ==================== DANH SÁCH CẦU CHU KỲ ====================
// cycle: chuỗi độ dài streak đi theo thứ tự CŨ → MỚI
// Ví dụ: [1,2,1] → streak 1 tay, 2 tay, 1 tay, 1 tay, 2 tay, 1 tay...
const CAU_LIST = [
    { cycle: [4],      name: "4-4",   conf: 70, minCheck: 2 },
    { cycle: [3],      name: "3-3",   conf: 75, minCheck: 2 },
    { cycle: [2],      name: "2-2",   conf: 80, minCheck: 2 },
    { cycle: [1,2,1],  name: "1-2-1", conf: 75, minCheck: 6 },
    { cycle: [1,2,2],  name: "1-2-2", conf: 75, minCheck: 6 },
    { cycle: [2,2,1],  name: "2-2-1", conf: 75, minCheck: 6 },
    { cycle: [1,2,3],  name: "1-2-3", conf: 72, minCheck: 6 },
    { cycle: [3,1,2],  name: "3-1-2", conf: 72, minCheck: 6 },
    { cycle: [1,3],    name: "1-3-1", conf: 73, minCheck: 4 },
    { cycle: [3,1],    name: "3-1-3", conf: 73, minCheck: 4 },
    { cycle: [1],      name: "1-1",   conf: 80, minCheck: 3 }
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

// ==================== MATCHER CẦU CHU KỲ ====================
function matchCycle(st, cycle, name, conf, minCheck) {
    const P = cycle.length;
    if (st.length < minCheck + 1) return null;

    // st[1] = streak vừa xong, st[2] trước đó...
    // cycle[a,b,c] nghĩa là streak-length CŨ→MỚI: a,b,c,a,b,c...
    // Nên: st[1]=cycle[P-1], st[2]=cycle[P-2], ...
    for (let i = 1; i <= minCheck; i++) {
        const expected = cycle[(P - (i % P)) % P];
        if (st[i].len !== expected) return null;
    }

    const tgt = cycle[0]; // sau cycle[P-1] quay lại cycle[0]
    const cur = st[0];

    if (cur.len < tgt) {
        return { pred: cur.type, conf: conf - 3, cau: name, src: `cầu ${name} (${cur.len}/${tgt})` };
    }
    if (cur.len === tgt) {
        return { pred: opp(cur.type), conf, cau: name, src: `cầu ${name} (đảo)` };
    }
    return null;
}

// ==================== DỰ ĐOÁN THEO CẦU ====================
function byCau(hist) {
    if (hist.length < 4) return null;
    const st = streaks(hist);
    if (st.length < 3) return null;
    const cur = st[0];

    // 1. Bệt
    if (cur.len >= 8) return { pred: opp(cur.type), conf: 70, cau: "bệt-bẻ", src: `bệt ${cur.len} tay (BẺ)` };
    if (cur.len >= 5) return { pred: cur.type,     conf: 62, cau: "bệt-theo", src: `bệt ${cur.len} tay (THEO)` };

    // 2. Các cầu chu kỳ
    for (const c of CAU_LIST) {
        const r = matchCycle(st, c.cycle, c.name, c.conf, c.minCheck);
        if (r) return r;
    }
    return null;
}

// ==================== DỰ ĐOÁN THEO ĐIỂM ====================
function byDiem(total) {
    const e = MEO_DIEM[total];
    return e ? { pred: e.p, conf: e.c, cau: `điểm ${total}`, src: `bảng điểm ${total}` } : null;
}

// ==================== KẾT HỢP CẦU + ĐIỂM ====================
function predict(hist) {
    const last = hist[0];
    if (bao(last.dice)) return { pred: "NGHỈ", conf: 0, cau: "bão", src: "bão → nghỉ" };

    const c = byCau(hist.slice(0, N));
    const d = byDiem(Number(last.total));

    // Cả 2 đồng thuận → tăng conf
    if (c && d && c.pred === d.pred) {
        const conf = Math.min(95, Math.round((c.conf + d.conf) / 2) + 8);
        return { pred: c.pred, conf, cau: c.cau, src: `✅ cầu + điểm đồng thuận` };
    }
    // Xung đột → chọn cái conf cao hơn
    if (c && d && c.pred !== d.pred) {
        if (c.conf >= d.conf) return { ...c, src: `⚔️ cầu thắng (${c.conf}% vs ${d.conf}%)` };
        return { ...d, src: `⚔️ điểm thắng (${d.conf}% vs ${c.conf}%)` };
    }
    if (c) return c;
    if (d) return d;

    return { pred: opp(last.result), conf: 52, cau: "-", src: "đảo mặc định" };
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
    thuat_toan: "CẦU CHU KỲ + BẢNG ĐIỂM",
    phan_tich: `${N} phiên`,
    cau_ho_tro: CAU_LIST.map(c => c.name),
    bang_diem: MEO_DIEM,
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

    const c = byCau(h.slice(0, N));
    const d = byDiem(Number(h[0].total));
    const p = predict(h);

    return {
        bieu_do_cau: chart(h),
        streak: streaks(h.slice(0, N)).map(s => `${s.type === "Tài" ? "T" : "X"}${s.len}`).join("-"),
        cau: c,
        diem: d,
        ket_hop: c && d ? (c.pred === d.pred ? "ĐỒNG THUẬN" : "XUNG ĐỘT") : (c ? "CHỈ CẦU" : d ? "CHỈ ĐIỂM" : "KHÔNG"),
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
║  🎯 TÀI XỈU LC79 - CẦU + BẢNG ĐIỂM                       ║
╠══════════════════════════════════════════════════════════╣
║  🚀 http://localhost:${PORT}                                 ║
║  🔑 KEY: ${VALID_KEY}                                       ║
║  👤 ADMIN: ${ADMIN}                                    ║
║                                                          ║
║  🎲 CẦU HỖ TRỢ:                                          ║
║     1-1, 2-2, 3-3, 4-4                                   ║
║     1-2-1, 2-2-1, 1-2-2, 1-2-3, 3-1-2                    ║
║     1-3-1, 3-1-3                                         ║
║     + Bệt (5-7 theo, ≥8 bẻ) + Bão (nghỉ)                 ║
║                                                          ║
║  📊 BẢNG ĐIỂM: 3→18 (X3-X18, T11-T18)                    ║
║                                                          ║
║  📌 API:                                                 ║
║     HŨ : /api/taixiu/lc79?key=${VALID_KEY}              ║
║     MD5: /api/taixiumd5/lc79?key=${VALID_KEY}           ║
║     DEBUG: /api/debug/hu?key=${VALID_KEY}               ║
╚══════════════════════════════════════════════════════════╝
`);
