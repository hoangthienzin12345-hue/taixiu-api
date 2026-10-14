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
const BANG_DIEM = {
    3:{p:"Xỉu",c:70}, 4:{p:"Tài",c:60}, 5:{p:"Tài",c:70}, 6:{p:"Xỉu",c:60},
    7:{p:"Tài",c:80}, 8:{p:"Xỉu",c:80}, 9:{p:"Xỉu",c:70}, 10:{p:"Tài",c:80},
    11:{p:"Xỉu",c:60}, 12:{p:"Tài",c:80}, 13:{p:"Tài",c:80}, 14:{p:"Xỉu",c:60},
    15:{p:"Xỉu",c:70}, 16:{p:"Tài",c:60}, 17:{p:"Xỉu",c:60}, 18:{p:"Xỉu",c:80}
};

// ==================== CHUẨN HOÁ ====================
function norm(val, point) {
    if (val !== undefined && val !== null) {
        const s = String(val).toLowerCase().trim();
        if (s === "tài" || s === "tai" || s === "t" || s === "big") return "Tài";
        if (s === "xỉu" || s === "xiu" || s === "x" || s === "small") return "Xỉu";
    }
    return Number(point) >= 11 ? "Tài" : "Xỉu";
}

// ==================== HELPERS ====================
function streaks(hist) {
    if (!hist?.length) return [];
    const out = [];
    let t = hist[0].result, l = 1;
    for (let i = 1; i < hist.length; i++) {
        if (hist[i].result === t) l++;
        else { out.push({ type: t, len: l }); t = hist[i].result; l = 1; }
    }
    out.push({ type: t, len: l });
    return out;
}

// Biểu đồ cầu: 15 phiên mới nhất, CŨ → MỚI
function chart(hist) {
    if (!hist?.length) return "";
    return hist.slice(0, N).reverse()
        .map(h => h.result === "Tài" ? "T" : "X").join("");
}

function bao(dice) {
    return dice?.[0] === dice?.[1] && dice?.[1] === dice?.[2];
}

// ==================== DETECTORS CẦU ====================
// Nguyên tắc chung cho MỌI cầu:
//  - streak hiện tại (cur = st[0]) đại diện cho NHỊP ĐANG CHẠY
//  - st[1] là nhịp TRƯỚC ĐÓ → dùng để xác định TARGET LEN của nhịp hiện tại
//  - Nếu cur.len < targetLen → CÙNG CHIỀU (đang chạy giữa nhịp)
//  - Nếu cur.len === targetLen → ĐẢO CHIỀU (nhịp đã hoàn tất)

// Cầu đồng nhất 1-1, 2-2, 3-3
function dUniform(st, len, name, conf, minCf) {
    if (st.length < minCf + 1) return null;
    for (let i = 1; i <= minCf; i++) if (st[i]?.len !== len) return null;
    const cf = st[minCf + 1]?.len === len ? conf : conf - 6;
    const cur = st[0], opp = cur.type === "Tài" ? "Xỉu" : "Tài";
    if (cur.len < len) return { pred: cur.type, conf: cf - 5, cau: name, src: `cầu ${name} (${cur.len}/${len})` };
    if (cur.len === len) return { pred: opp, conf: cf, cau: name, src: `cầu ${name} (đảo)` };
    return null;
}

// Cầu xen kẽ 1-2, 2-1, 3-1, 1-3, 4-1, 1-4
// Xác định phase hiện tại của cur dựa vào st[1] để suy ra targetLen
function dAlt(st, A, B, name, conf) {
    if (st.length < 5) return null;
    const l = st.slice(0, 6).map(s => s.len);

    // Xác định chu kỳ đang chạy dựa vào st[1]
    let tgt = null;
    // nếu st[1]=A → cur là phase B; nếu st[1]=B → cur là phase A
    if (st[1].len === A && st[2].len === B && st[3].len === A) tgt = B;
    else if (st[1].len === B && st[2].len === A && st[3].len === B) tgt = A;
    else return null;

    const cur = st[0], opp = cur.type === "Tài" ? "Xỉu" : "Tài";
    if (cur.len < tgt) return { pred: cur.type, conf: conf - 4, cau: name, src: `cầu ${name} (${cur.len}/${tgt})` };
    if (cur.len === tgt) return { pred: opp, conf, cau: name, src: `cầu ${name} (đảo)` };
    return null;
}

// Nhịp tăng 1-2-3 / giảm 3-2-1
function dRising(st) {
    if (st.length < 6) return null;
    const l = st.slice(0, 6).map(s => s.len);

    let seq = null;
    if (l[1] === 1 && l[2] === 2 && l[3] === 3 && l[4] === 1 && l[5] === 2) seq = [1, 2, 3];
    else if (l[1] === 3 && l[2] === 2 && l[3] === 1 && l[4] === 3 && l[5] === 2) seq = [3, 2, 1];
    else return null;

    // Xác định target cho cur dựa vào st[1]
    const idx = seq.indexOf(st[1].len);
    if (idx === -1) return null;
    const tgt = seq[(idx + 1) % seq.length];

    const cur = st[0], opp = cur.type === "Tài" ? "Xỉu" : "Tài";
    if (cur.len < tgt) return { pred: cur.type, conf: 70, cau: "1-2-3", src: `nhịp 1-2-3 (${cur.len}/${tgt})` };
    if (cur.len === tgt) return { pred: opp, conf: 72, cau: "1-2-3", src: "nhịp 1-2-3 (đảo)" };
    return null;
}

// Chu kỳ 1-3-1 / 3-1-3
function d131(st) {
    if (st.length < 5) return null;
    const l = st.slice(0, 5).map(s => s.len);
    const a = (l[1] === 1 && l[2] === 3 && l[3] === 1 && l[4] === 3);
    const b = (l[1] === 3 && l[2] === 1 && l[3] === 3 && l[4] === 1);
    if (!a && !b) return null;

    const cur = st[0], opp = cur.type === "Tài" ? "Xỉu" : "Tài";

    // st[1] là nhịp trước → cur phải có độ dài NGƯỢC với st[1] để xen kẽ
    const tgt = st[1].len === 1 ? 3 : (st[1].len === 3 ? 1 : null);
    if (tgt === null) return null;

    const name = a ? "1-3-1" : "3-1-3";
    if (cur.len < tgt) return { pred: cur.type, conf: 68, cau: name, src: `cầu ${name} (${cur.len}/${tgt})` };
    if (cur.len === tgt) return { pred: opp, conf: 70, cau: name, src: `cầu ${name} (đảo)` };
    return null;
}

// Chu kỳ tuần hoàn P = 2..7
function dPeriod(hist) {
    if (hist.length < 8) return null;
    const r = hist.map(h => h.result);
    for (let P = 2; P <= 7; P++) {
        if (r.length < P * 2) continue;
        const len = Math.min(r.length - P, P * 3);
        let m = 0;
        for (let i = 0; i < len; i++) if (r[i] === r[i + P]) m++;
        if (m / len >= 0.9) {
            // Phiên tiếp theo = r[P-1] (vì phiên 0 mới nhất, phiên -1 = phiên P-1)
            return { pred: r[P - 1], conf: 70, cau: `P${P}`,
                     src: `tuần hoàn P=${P} (${Math.round(m / len * 100)}%)` };
        }
    }
    return null;
}

// ==================== DỰ ĐOÁN THEO CẦU ====================
function byCau(hist) {
    if (hist.length < 4) return null;
    const st = streaks(hist);
    if (st.length < 3) return null;
    const cur = st[0], opp = cur.type === "Tài" ? "Xỉu" : "Tài";

    // 1. Bệt: 5-7 theo, >=8 bẻ
    if (cur.len >= 8) return { pred: opp, conf: 70, cau: "bẻ bệt", src: `bệt ${cur.len} tay (BẺ)` };
    if (cur.len >= 5) return { pred: cur.type, conf: 62, cau: "bệt", src: `bệt ${cur.len} tay (theo)` };

    // 2. Đồng nhất
    let r;
    r = dUniform(st, 1, "1-1", 80, 3); if (r) return r;
    r = dUniform(st, 2, "2-2", 80, 2); if (r) return r;
    r = dUniform(st, 3, "3-3", 75, 2); if (r) return r;

    // 3. Xen kẽ
    r = dAlt(st, 1, 2, "1-2", 75); if (r) return r;
    r = dAlt(st, 2, 1, "2-1", 75); if (r) return r;
    r = dAlt(st, 3, 1, "3-1", 73); if (r) return r;
    r = dAlt(st, 1, 3, "1-3", 73); if (r) return r;
    r = dAlt(st, 4, 1, "4-1", 70); if (r) return r;
    r = dAlt(st, 1, 4, "1-4", 70); if (r) return r;

    // 4. Nhịp 1-2-3
    r = dRising(st); if (r) return r;

    // 5. Chu kỳ 1-3-1 / 3-1-3
    r = d131(st); if (r) return r;

    // 6. Tuần hoàn
    r = dPeriod(hist); if (r) return r;

    return null;
}

// ==================== DỰ ĐOÁN THEO ĐIỂM ====================
function byDiem(total) {
    const e = BANG_DIEM[total];
    return e ? { pred: e.p, conf: e.c, cau: `điểm ${total}`, src: `bảng điểm (tổng ${total})` } : null;
}

// ==================== DỰ ĐOÁN TỔNG HỢP ====================
function predict(hist) {
    const last = hist[0];
    if (bao(last.dice)) return { pred: "BÃO", conf: 0, cau: "bão", src: "bão" };

    const c = byCau(hist.slice(0, N));
    if (c) return c;

    const d = byDiem(Number(last.total));
    if (d) return d;

    return { pred: last.result === "Tài" ? "Xỉu" : "Tài", conf: 52, cau: "-", src: "đảo" };
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
        const data = await res.json();
        const arr = parse(data, isMd5);
        if (!arr.length) return;
        const latest = arr[0].session;
        const cur = isMd5 ? idMd5 : idHu;
        const tag = isMd5 ? "MD5" : "HŨ";

        if (!cur) {
            if (isMd5) { md5 = arr; idMd5 = latest; } else { hu = arr; idHu = latest; }
            console.log(`✅ [${tag}] ${arr.length} phiên | Mới: ${latest} (${arr[0].result})`);
        } else if (latest > cur) {
            const news = arr.filter(r => r.session > cur);
            const target = isMd5 ? md5 : hu;
            for (let i = news.length - 1; i >= 0; i--) target.unshift(news[i]);
            if (target.length > 500) target.length = 450;
            if (isMd5) idMd5 = latest; else idHu = latest;
            console.log(`🆕 [${tag}] +${news.length} | Mới: ${latest} (${arr[0].result})`);
        }
    } catch (e) { console.error(`❌ [${isMd5 ? "MD5" : "HŨ"}]:`, e.message); }
}

// ==================== RESPONSE ====================
function resp(hist) {
    const l = hist[0], p = predict(hist);
    const duDoan = p.pred === "Tài" ? "tài" : p.pred === "Xỉu" ? "xỉu" : "nghỉ";
    return {
        id: ADMIN,
        phien_truoc: l.session,
        xuc_xac: `${l.dice[0]} - ${l.dice[1]} - ${l.dice[2]}`,
        ket_qua: l.result.toLowerCase(),
        tong: l.total,
        phien_nay: l.session + 1,
        bieu_do_cau: chart(hist),
        du_doan: duDoan,
        do_tin_cay: `${p.conf}%`,
        cau_phat_hien: p.cau || "-"
    };
}

// ==================== SERVER ====================
const app = fastify({ logger: false });
await app.register(cors, { origin: "*" });

const keyOK = q => q.key === VALID_KEY;

app.get("/", async () => ({
    status: "active", admin: ADMIN,
    uu_tien: "BÃO → CẦU → BẢNG ĐIỂM → ĐẢO",
    phan_tich: `${N} phiên`,
    endpoints: {
        hu: `/api/taixiu/lc79?key=${VALID_KEY}`,
        md5: `/api/taixiumd5/lc79?key=${VALID_KEY}`,
        debug_hu: `/api/debug/hu?key=${VALID_KEY}`,
        debug_md5: `/api/debug/md5?key=${VALID_KEY}`
    }
}));

const send = (hist, reply) => hist.length ? resp(hist) : reply.status(503).send({ error: "Đang tải dữ liệu..." });

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
    if (!h.length) return rep.status(503).send({ error: "Chưa đủ dữ liệu" });
    const c = byCau(h.slice(0, N));
    const d = byDiem(Number(h[0].total));
    const p = predict(h);
    return {
        bieu_do_cau: chart(h),
        streak: streaks(h.slice(0, N)).map(s => `${s.type === "Tài" ? "T" : "X"}${s.len}`).join("-"),
        cau_tra: c ? { pred: c.pred, conf: c.conf, cau: c.cau } : null,
        diem_tra: d ? { pred: d.pred, conf: d.conf } : null,
        uu_tien: c ? "CẦU" : d ? "BẢNG ĐIỂM" : "ĐẢO",
        ket_qua: { du_doan: p.pred, tin_cay: `${p.conf}%`, cau: p.cau, nguon: p.src }
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
║   TÀI XỈU - ƯU TIÊN CẦU → FALLBACK BẢNG ĐIỂM            ║
╠══════════════════════════════════════════════════════════╣
║  🚀 http://localhost:${PORT}                                 ║
║  🔑 KEY: ${VALID_KEY}                                       ║
║  👤 ADMIN: ${ADMIN}                                    ║
║  📊 PHÂN TÍCH: ${N} phiên gần nhất                          ║
║                                                          ║
║  ⚡ THỨ TỰ: BÃO → CẦU → BẢNG ĐIỂM → ĐẢO                   ║
║  🎯 CẦU: 1-1, 2-2, 3-3, 1-2, 2-1, 3-1, 1-3, 4-1, 1-4    ║
║         Nhịp 1-2-3, chu kỳ 1-3-1/3-1-3, bệt (≥8 bẻ)     ║
║                                                          ║
║  📌 API:                                                 ║
║     HŨ : /api/taixiu/lc79?key=${VALID_KEY}              ║
║     MD5: /api/taixiumd5/lc79?key=${VALID_KEY}           ║
║     DEBUG: /api/debug/hu?key=${VALID_KEY}               ║
╚══════════════════════════════════════════════════════════╝
`);
