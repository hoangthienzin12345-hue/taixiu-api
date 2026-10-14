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

// ==================== BẢNG MẸO ĐIỂM ====================
const MEO_DIEM = {
    3:["Xỉu",70], 4:["Tài",60], 5:["Tài",70], 6:["Xỉu",60],
    7:["Tài",80], 8:["Xỉu",80], 9:["Xỉu",70], 10:["Tài",80],
    11:["Xỉu",60], 12:["Tài",80], 13:["Tài",80], 14:["Xỉu",60],
    15:["Xỉu",70], 16:["Tài",60], 17:["Xỉu",60], 18:["Xỉu",80]
};

// ==================== CHUẨN HOÁ ====================
const norm = (v, p) => {
    if (v != null) {
        const s = String(v).toLowerCase().trim();
        if (["tài","tai","t","big"].includes(s)) return "Tài";
        if (["xỉu","xiu","x","small"].includes(s)) return "Xỉu";
    }
    return Number(p) >= 11 ? "Tài" : "Xỉu";
};

// ==================== HELPERS ====================
function streaks(h) {
    if (!h?.length) return [];
    const o = []; let t = h[0].result, l = 1;
    for (let i = 1; i < h.length; i++) {
        if (h[i].result === t) l++;
        else { o.push({ type: t, len: l }); t = h[i].result; l = 1; }
    }
    o.push({ type: t, len: l });
    return o;
}

const chart = h => h?.length
    ? h.slice(0, N).reverse().map(x => x.result === "Tài" ? "T" : "X").join("")
    : "";

const bao = d => d?.[0] === d?.[1] && d?.[1] === d?.[2];
const opp = r => r === "Tài" ? "Xỉu" : "Tài";

// ==================== DETECTORS CẦU ====================
function dUniform(st, len, name, cf, minCf) {
    if (st.length < minCf + 1) return null;
    for (let i = 1; i <= minCf; i++) if (st[i]?.len !== len) return null;
    const c = st[minCf + 1]?.len === len ? cf : cf - 6;
    const cur = st[0];
    if (cur.len < len) return { pred: cur.type, conf: c - 5, cau: name };
    if (cur.len === len) return { pred: opp(cur.type), conf: c, cau: name };
    return null;
}

function dAlt(st, A, B, name, cf) {
    if (st.length < 5) return null;
    let tgt = null;
    if (st[1].len === A && st[2].len === B && st[3].len === A) tgt = B;
    else if (st[1].len === B && st[2].len === A && st[3].len === B) tgt = A;
    else return null;
    const cur = st[0];
    if (cur.len < tgt) return { pred: cur.type, conf: cf - 4, cau: name };
    if (cur.len === tgt) return { pred: opp(cur.type), conf: cf, cau: name };
    return null;
}

function dRising(st) {
    if (st.length < 6) return null;
    const l = st.slice(0, 6).map(s => s.len);
    let seq = null;
    if (l[1]===1 && l[2]===2 && l[3]===3 && l[4]===1 && l[5]===2) seq = [1,2,3];
    else if (l[1]===3 && l[2]===2 && l[3]===1 && l[4]===3 && l[5]===2) seq = [3,2,1];
    else return null;
    const idx = seq.indexOf(st[1].len); if (idx === -1) return null;
    const tgt = seq[(idx + 1) % seq.length];
    const cur = st[0];
    if (cur.len < tgt) return { pred: cur.type, conf: 70, cau: "1-2-3" };
    if (cur.len === tgt) return { pred: opp(cur.type), conf: 72, cau: "1-2-3" };
    return null;
}

function d131(st) {
    if (st.length < 5) return null;
    const l = st.slice(0, 5).map(s => s.len);
    const a = l[1]===1 && l[2]===3 && l[3]===1 && l[4]===3;
    const b = l[1]===3 && l[2]===1 && l[3]===3 && l[4]===1;
    if (!a && !b) return null;
    const tgt = st[1].len === 1 ? 3 : st[1].len === 3 ? 1 : null;
    if (tgt === null) return null;
    const cur = st[0], name = a ? "1-3-1" : "3-1-3";
    if (cur.len < tgt) return { pred: cur.type, conf: 68, cau: name };
    if (cur.len === tgt) return { pred: opp(cur.type), conf: 70, cau: name };
    return null;
}

function dPeriod(h) {
    if (h.length < 8) return null;
    const r = h.map(x => x.result);
    for (let P = 2; P <= 7; P++) {
        if (r.length < P * 2) continue;
        const len = Math.min(r.length - P, P * 3);
        let m = 0;
        for (let i = 0; i < len; i++) if (r[i] === r[i + P]) m++;
        if (m / len >= 0.9) return { pred: r[P - 1], conf: 70, cau: `P${P}` };
    }
    return null;
}

// ==================== DỰ ĐOÁN THEO CẦU ====================
function byCau(hist) {
    if (hist.length < 4) return null;
    const st = streaks(hist);
    if (st.length < 3) return null;
    const cur = st[0];

    if (cur.len >= 8) return { pred: opp(cur.type), conf: 70, cau: "bẻ bệt" };
    if (cur.len >= 5) return { pred: cur.type, conf: 62, cau: "bệt" };

    return dUniform(st, 1, "1-1", 80, 3)
        || dUniform(st, 2, "2-2", 80, 2)
        || dUniform(st, 3, "3-3", 75, 2)
        || dAlt(st, 1, 2, "1-2", 75)
        || dAlt(st, 2, 1, "2-1", 75)
        || dAlt(st, 3, 1, "3-1", 73)
        || dAlt(st, 1, 3, "1-3", 73)
        || dAlt(st, 4, 1, "4-1", 70)
        || dAlt(st, 1, 4, "1-4", 70)
        || dRising(st)
        || d131(st)
        || dPeriod(hist);
}

// ==================== DỰ ĐOÁN THEO ĐIỂM ====================
function byDiem(total) {
    const e = MEO_DIEM[total];
    return e ? { pred: e[0], conf: e[1], cau: `điểm ${total}` } : null;
}

// ==================== ESM (Exponential Smoothing) ====================
function esm(hist, alpha = 0.3) {
    if (hist.length < 5) return null;
    const series = hist.slice().reverse().map(h => h.result === "Tài" ? 1 : 0);
    let s = series[0];
    for (let i = 1; i < series.length; i++) s = alpha * series[i] + (1 - alpha) * s;
    const pred = s >= 0.5 ? "Tài" : "Xỉu";
    const conf = Math.min(85, Math.round(50 + Math.abs(s - 0.5) * 70));
    return { pred, conf, cau: "ESM" };
}

// ==================== DỰ ĐOÁN KẾT HỢP ====================
function predict(hist) {
    const last = hist[0];
    if (bao(last.dice)) return { pred: "NGHỈ", conf: 0, cau: "bão" };

    const signals = [];
    const c = byCau(hist.slice(0, N));
    if (c) signals.push({ ...c, w: 0.50 });
    const d = byDiem(last.total);
    if (d) signals.push({ ...d, w: 0.30 });
    const e = esm(hist.slice(0, 20));
    if (e) signals.push({ ...e, w: 0.20 });

    if (!signals.length) {
        return { pred: opp(last.result), conf: 52, cau: "-" };
    }

    const totalW = signals.reduce((s, x) => s + x.w, 0);
    const score = { "Tài": 0, "Xỉu": 0 };
    for (const s of signals) score[s.pred] += (s.w / totalW) * s.conf;

    const pred = score["Tài"] >= score["Xỉu"] ? "Tài" : "Xỉu";
    const conf = Math.min(88, Math.round(score[pred]));

    // Cầu chính để hiển thị: ưu tiên cầu, sau đó điểm, cuối là ESM
    const mainCau = c ? c.cau : d ? d.cau : "ESM";
    return { pred, conf, cau: mainCau };
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
        if (!cur) {
            if (isMd5) { md5 = arr; idMd5 = latest; } else { hu = arr; idHu = latest; }
            console.log(`✅ [${isMd5 ? "MD5" : "HŨ"}] ${arr.length} phiên | ${latest} (${arr[0].result})`);
        } else if (latest > cur) {
            const news = arr.filter(r => r.session > cur);
            const target = isMd5 ? md5 : hu;
            for (let i = news.length - 1; i >= 0; i--) target.unshift(news[i]);
            if (target.length > 500) target.length = 450;
            if (isMd5) idMd5 = latest; else idHu = latest;
            console.log(`🆕 [${isMd5 ? "MD5" : "HŨ"}] +${news.length} | ${latest} (${arr[0].result})`);
        }
    } catch (e) { console.error(`❌ ${isMd5 ? "MD5" : "HŨ"}:`, e.message); }
}

// ==================== RESPONSE ====================
function resp(hist) {
    const l = hist[0], p = predict(hist);
    return {
        id: ADMIN,
        phien_truoc: l.session,
        ket_qua: l.result.toLowerCase(),
        phien_hien_tai: l.session + 1,
        du_doan: p.pred === "Tài" ? "tài" : p.pred === "Xỉu" ? "xỉu" : "nghỉ",
        ty_le: `${p.conf}%`,
        cau: p.cau || "-"
    };
}

// ==================== SERVER ====================
const app = fastify({ logger: false });
await app.register(cors, { origin: "*" });
const keyOK = q => q.key === VALID_KEY;

app.get("/", async () => ({
    status: "active", admin: ADMIN,
    thuat_toan: "CẦU(50%) + MẸO ĐIỂM(30%) + ESM(20%)",
    endpoints: {
        hu: `/api/taixiu/lc79?key=${VALID_KEY}`,
        md5: `/api/taixiumd5/lc79?key=${VALID_KEY}`
    }
}));

const send = (h, rep) => h.length ? resp(h) : rep.status(503).send({ error: "Đang tải..." });

app.get("/api/taixiu/:g", async (req, rep) =>
    keyOK(req.query) ? send(hu, rep) : rep.status(401).send({ error: `Sai key! Ib ${ADMIN}` }));

app.get("/api/taixiumd5/:g", async (req, rep) =>
    keyOK(req.query) ? send(md5, rep) : rep.status(401).send({ error: `Sai key! Ib ${ADMIN}` }));

// ==================== START ====================
await Promise.all([tick(API_HU, false), tick(API_MD5, true)]);
setInterval(() => tick(API_HU, false), 5000);
setInterval(() => tick(API_MD5, true), 5000);

await app.listen({ port: PORT, host: "0.0.0.0" });
console.log(`
╔══════════════════════════════════════════════════════╗
║  🎯 TÀI XỈU - CẦU + MẸO ĐIỂM + ESM                    ║
║  🚀 http://localhost:${PORT}                             ║
║  🔑 ${VALID_KEY}   👤 ${ADMIN}              ║
║  ⚖️  CẦU 50% | ĐIỂM 30% | ESM 20%                    ║
╚══════════════════════════════════════════════════════╝
`);
