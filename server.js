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

// ==================== BẢNG ĐIỂM (RULES THEO NGỮ CẢNH) ====================
// configs: khớp dice cụ thể (ưu tiên cao nhất)
// rules:   khớp theo context cầu (cau_1_1, cau_xau, cau_bet_tai, cau_bet_xiu...)
// khi:     "default" là fallback cuối
const BANG_DIEM = {
    3:  { ten: "XỈU 3", rules: [{ khi:"default", pred:"Xỉu", conf:90, note:"Điểm Xỉu thấp nhất, hiếm khi bẻ ngay." }] },
    4:  { ten: "XỈU 4", rules: [{ khi:"default", pred:"Xỉu", conf:70, note:"Phần lớn tiếp tục Xỉu, nhỏ xác suất chuyển Tài." }] },
    5:  { ten: "XỈU 5", rules: [{ khi:"default", pred:"Xỉu", conf:90, note:"Điểm Xỉu cực mạnh, duy trì bệt Xỉu." }] },
    6:  { ten: "XỈU 6", rules: [{ khi:"default", pred:"Xỉu", conf:55, note:"Cân bằng 55/45, nên nghỉ 1 tay hoặc cược nhỏ." }] },
    7:  {
        ten: "XỈU 7",
        configs: {
            "1-2-4": { pred:"Xỉu", conf:80, note:"Giữ nhịp Xỉu ổn định." },
            "2-2-3": { pred:"Xỉu", conf:80, note:"Giữ nhịp Xỉu ổn định." },
            "1-3-3": { pred:"Xỉu", conf:80, note:"Giữ nhịp Xỉu ổn định." }
        },
        rules: [{ khi:"default", pred:"Tài", conf:60, note:"Cấu hình còn lại đẩy cầu sang Tài (60%)." }]
    },
    8:  {
        ten: "XỈU 8",
        configs: { "1-3-4": { pred:"Xỉu", conf:85, note:"Điểm Xỉu mạnh, kéo theo Xỉu khác." } },
        rules: [{ khi:"default", pred:"Tài", conf:65, note:"Cấu hình khác → dấu hiệu chuyển Tài." }]
    },
    9:  {
        ten: "XỈU 9",
        configs: { "2-3-4": { pred:"Xỉu", conf:60, note:"Duy trì Xỉu nhưng không mạnh." } },
        rules: [{ khi:"default", pred:null, conf:50, note:"50/50, khó đoán, nên bỏ qua ván này." }]
    },
    10: {
        ten: "XỈU 10",
        rules: [
            { khi:["cau_1_1"], pred:null, conf:50, note:"Đang có dấu hiệu cầu 1-1 → 50/50, cân nhắc kỹ." },
            { khi:["cau_xau"], pred:"Tài", conf:70, note:"Cầu đen/xấu → 70% ra Tài (12-13), sau đó có thể về 11." },
            { khi:"default", pred:"Xỉu", conf:85, note:"Bình thường → tiếp tục Xỉu, tạo cầu Xỉu dài hoặc bệt." }
        ]
    },
    11: { ten: "TÀI 11", rules: [{ khi:"default", pred:"Tài", conf:50, note:"Cầu nát nhà, 50/50, nên nghỉ 1 tay." }] },
    12: {
        ten: "TÀI 12",
        configs: {
            "2-4-6": { pred:"Xỉu", conf:85, note:"Điểm kết cầu Tài → Xỉu." },
            "1-5-6": { pred:"Xỉu", conf:85, note:"Điểm kết cầu Tài → Xỉu." },
            "3-3-6": { pred:"Xỉu", conf:85, note:"Điểm kết cầu Tài → Xỉu." },
            "2-5-5": { pred:"Xỉu", conf:85, note:"Điểm kết cầu Tài → Xỉu." }
        },
        rules: [{ khi:"default", pred:"Tài", conf:60, note:"Cấu hình khác giữ nhịp Tài, kéo dài bệt Tài." }]
    },
    13: {
        ten: "TÀI 13",
        configs: {
            "5-5-3": { pred:"Xỉu", conf:80, note:"Bẻ cầu mạnh về Xỉu (5-3-1)." },
            "6-6-1": { pred:"Xỉu", conf:80, note:"Bẻ cầu mạnh về Xỉu (6-3-1)." }
        },
        rules: [{ khi:"default", pred:"Tài", conf:65, note:"Cấu hình khác duy trì Tài." }]
    },
    14: { ten: "TÀI 14", rules: [{ khi:"default", pred:"Tài", conf:50, note:"Điểm trung tính 50/50, nên quan sát thêm." }] },
    15: { ten: "TÀI 15", rules: [{ khi:"default", pred:"Tài", conf:85, note:"Cầu Tài mạnh, thường tạo chuỗi Tài dài." }] },
    16: { ten: "TÀI 16", rules: [{ khi:"default", pred:"Xỉu", conf:80, note:"Điểm cuối cầu Tài, chuyển Xỉu rõ rệt." }] },
    17: { ten: "TÀI 17", rules: [{ khi:"default", pred:"Xỉu", conf:90, note:"CỰC KỲ CẨN THẬN! Bẻ cầu mạnh về Xỉu, thường bay xuống 10." }] },
    18: { ten: "TÀI 18 (6-6-6)", rules: [{ khi:"default", pred:"Tài", conf:95, note:"Điểm Tài cao nhất, gần như chắc chắn tiếp tục Tài." }] }
};

// ==================== BẢNG CẦU ====================
const BANG_CAU = {
    "1-1":   { mo_ta: "T-X-T-X-T-X  ⟷  X-T-X-T-X-T",         conf: 80 },
    "1-2":   { mo_ta: "T-XX-T-XX  ⟷  X-TT-X-TT",              conf: 75 },
    "2-1":   { mo_ta: "TT-X-TT-X  ⟷  XX-T-XX-T",              conf: 75 },
    "2-2":   { mo_ta: "TT-XX-TT-XX  ⟷  XX-TT-XX-TT",          conf: 80 },
    "3-1":   { mo_ta: "TTT-X-TTT-X  ⟷  XXX-T-XXX-T",          conf: 73 },
    "1-3":   { mo_ta: "T-XXX-T-XXX  ⟷  X-TTT-X-TTT",          conf: 73 },
    "4-1":   { mo_ta: "TTTT-X-TTTT-X  ⟷  XXXX-T-XXXX-T",      conf: 70 },
    "1-4":   { mo_ta: "T-XXXX-T-XXXX  ⟷  X-TTTT-X-TTTT",      conf: 70 },
    "3-3":   { mo_ta: "TTT-XXX-TTT-XXX  ⟷  XXX-TTT-XXX-TTT",  conf: 75 },
    "1-2-3": { mo_ta: "T-XX-TTT-T-XX  ⟷  X-TT-XXX-X-TT",      conf: 72 },
    "1-3-1": { mo_ta: "T-XXX-T-T-XXX  ⟷  X-TTT-X-X-TTT",      conf: 70 },
    "bệt":   { mo_ta: "Bệt 5-7 tay (theo) | ≥8 tay (BẺ)",     conf: 65 }
};

// ==================== CHUẨN HOÁ & HELPERS ====================
function norm(val, point) {
    if (val !== undefined && val !== null) {
        const s = String(val).toLowerCase().trim();
        if (s === "tài" || s === "tai" || s === "t" || s === "big") return "Tài";
        if (s === "xỉu" || s === "xiu" || s === "x" || s === "small") return "Xỉu";
    }
    return Number(point) >= 11 ? "Tài" : "Xỉu";
}
function streaks(hist) {
    if (!hist?.length) return [];
    const out = []; let t = hist[0].result, l = 1;
    for (let i = 1; i < hist.length; i++) {
        if (hist[i].result === t) l++;
        else { out.push({ type: t, len: l }); t = hist[i].result; l = 1; }
    }
    out.push({ type: t, len: l }); return out;
}
function chart(hist) {
    return hist?.length ? hist.slice(0, N).reverse().map(h => h.result === "Tài" ? "T" : "X").join("") : "";
}
function bao(dice) { return dice?.[0] === dice?.[1] && dice?.[1] === dice?.[2]; }

// ==================== NGỮ CẢNH CẦU ====================
// Phân loại cầu hiện tại để match với rules trong bảng điểm
function detectContext(hist) {
    const st = streaks(hist);
    if (st.length < 4) return "default";

    // Cầu đối xứng rõ ràng
    if (st[1].len === 1 && st[2].len === 1 && st[3].len === 1) return "cau_1_1";
    if (st[1].len === 2 && st[2].len === 2 && st[3].len === 2) return "cau_2_2";
    if (st[1].len === 3 && st[2].len === 3 && st[3].len === 3) return "cau_3_3";
    if (st[1].len === 2 && st[2].len === 1 && st[3].len === 2) return "cau_1_2";
    if (st[1].len === 1 && st[2].len === 2 && st[3].len === 1) return "cau_2_1";

    // Bệt
    if (st[0].len >= 3) return st[0].type === "Tài" ? "cau_bet_tai" : "cau_bet_xiu";

    // Cầu xấu / đen: 3 streak gần nhất đều ngắn (≤2) và không theo pattern nào
    if (st[0].len <= 2 && st[1].len <= 2 && st[2].len <= 2) return "cau_xau";

    return "default";
}

// ==================== DETECTORS CẦU ====================
function dUniform(st, len, name, conf, minCf) {
    if (st.length < minCf + 1) return null;
    for (let i = 1; i <= minCf; i++) if (st[i]?.len !== len) return null;
    const cf = st[minCf + 1]?.len === len ? conf : conf - 6;
    const cur = st[0], opp = cur.type === "Tài" ? "Xỉu" : "Tài";
    if (cur.len < len) return { pred: cur.type, conf: cf - 5, cau: name, src: `cầu ${name} (${cur.len}/${len})` };
    if (cur.len === len) return { pred: opp, conf: cf, cau: name, src: `cầu ${name} (đảo)` };
    return null;
}
function dAlt(st, A, B, name, conf) {
    if (st.length < 5) return null;
    let tgt = null;
    if (st[1].len === A && st[2].len === B && st[3].len === A) tgt = B;
    else if (st[1].len === B && st[2].len === A && st[3].len === B) tgt = A;
    else return null;
    const cur = st[0], opp = cur.type === "Tài" ? "Xỉu" : "Tài";
    if (cur.len < tgt) return { pred: cur.type, conf: conf - 4, cau: name, src: `cầu ${name} (${cur.len}/${tgt})` };
    if (cur.len === tgt) return { pred: opp, conf, cau: name, src: `cầu ${name} (đảo)` };
    return null;
}
function dRising(st) {
    if (st.length < 6) return null;
    const l = st.slice(0, 6).map(s => s.len);
    let seq = null;
    if (l[1] === 1 && l[2] === 2 && l[3] === 3 && l[4] === 1 && l[5] === 2) seq = [1, 2, 3];
    else if (l[1] === 3 && l[2] === 2 && l[3] === 1 && l[4] === 3 && l[5] === 2) seq = [3, 2, 1];
    else return null;
    const idx = seq.indexOf(st[1].len); if (idx === -1) return null;
    const tgt = seq[(idx + 1) % seq.length];
    const cur = st[0], opp = cur.type === "Tài" ? "Xỉu" : "Tài";
    if (cur.len < tgt) return { pred: cur.type, conf: 70, cau: "1-2-3", src: `nhịp 1-2-3 (${cur.len}/${tgt})` };
    if (cur.len === tgt) return { pred: opp, conf: 72, cau: "1-2-3", src: "nhịp 1-2-3 (đảo)" };
    return null;
}
function d131(st) {
    if (st.length < 5) return null;
    const l = st.slice(0, 5).map(s => s.len);
    const a = (l[1] === 1 && l[2] === 3 && l[3] === 1 && l[4] === 3);
    const b = (l[1] === 3 && l[2] === 1 && l[3] === 3 && l[4] === 1);
    if (!a && !b) return null;
    const cur = st[0], opp = cur.type === "Tài" ? "Xỉu" : "Tài";
    const tgt = st[1].len === 1 ? 3 : (st[1].len === 3 ? 1 : null);
    if (tgt === null) return null;
    const name = a ? "1-3-1" : "3-1-3";
    if (cur.len < tgt) return { pred: cur.type, conf: 68, cau: name, src: `cầu ${name} (${cur.len}/${tgt})` };
    if (cur.len === tgt) return { pred: opp, conf: 70, cau: name, src: `cầu ${name} (đảo)` };
    return null;
}
function dPeriod(hist) {
    if (hist.length < 8) return null;
    const r = hist.map(h => h.result);
    for (let P = 2; P <= 7; P++) {
        if (r.length < P * 2) continue;
        const len = Math.min(r.length - P, P * 3);
        let m = 0; for (let i = 0; i < len; i++) if (r[i] === r[i + P]) m++;
        if (m / len >= 0.9) return { pred: r[P - 1], conf: 70, cau: `P${P}`, src: `tuần hoàn P=${P} (${Math.round(m/len*100)}%)` };
    }
    return null;
}

// ==================== DỰ ĐOÁN THEO CẦU ====================
function byCau(hist) {
    if (hist.length < 4) return null;
    const st = streaks(hist); if (st.length < 3) return null;
    const cur = st[0], opp = cur.type === "Tài" ? "Xỉu" : "Tài";

    if (cur.len >= 8) return { pred: opp, conf: 70, cau: "bẻ bệt", src: `bệt ${cur.len} tay (BẺ)` };
    if (cur.len >= 5) return { pred: cur.type, conf: 62, cau: "bệt", src: `bệt ${cur.len} tay (theo)` };

    let r;
    r = dUniform(st, 1, "1-1", 80, 3); if (r) return r;
    r = dUniform(st, 2, "2-2", 80, 2); if (r) return r;
    r = dUniform(st, 3, "3-3", 75, 2); if (r) return r;
    r = dAlt(st, 1, 2, "1-2", 75); if (r) return r;
    r = dAlt(st, 2, 1, "2-1", 75); if (r) return r;
    r = dAlt(st, 3, 1, "3-1", 73); if (r) return r;
    r = dAlt(st, 1, 3, "1-3", 73); if (r) return r;
    r = dAlt(st, 4, 1, "4-1", 70); if (r) return r;
    r = dAlt(st, 1, 4, "1-4", 70); if (r) return r;
    r = dRising(st); if (r) return r;
    r = d131(st); if (r) return r;
    r = dPeriod(hist); if (r) return r;
    return null;
}

// ==================== DỰ ĐOÁN THEO BẢNG ĐIỂM ====================
function byDiem(total, dice, hist) {
    const e = BANG_DIEM[total];
    if (!e) return null;

    // 1. Khớp xúc xắc đặc biệt
    const key = dice ? [...dice].sort((a, b) => a - b).join("-") : null;
    if (key && e.configs?.[key]) {
        const c = e.configs[key];
        return { pred: c.pred, conf: c.conf, cau: `${e.ten} [${key}]`, src: `📊 ${e.ten} [${key}] - ${c.note}` };
    }

    // 2. Match rule theo ngữ cảnh cầu
    const ctx = detectContext(hist);
    let fallback = null;
    for (const r of e.rules || []) {
        if (r.khi === "default") { fallback = r; continue; }
        const khi = Array.isArray(r.khi) ? r.khi : [r.khi];
        if (khi.includes(ctx)) {
            return { pred: r.pred, conf: r.conf, cau: `${e.ten} [${ctx}]`, src: `📊 ${e.ten} [${ctx}] - ${r.note}` };
        }
    }

    // 3. Fallback default
    if (fallback) return { pred: fallback.pred, conf: fallback.conf, cau: e.ten, src: `📊 ${e.ten} - ${fallback.note}` };
    return null;
}

// ==================== DỰ ĐOÁN TỔNG HỢP ====================
function predict(hist) {
    const last = hist[0];
    if (bao(last.dice)) return { pred: "BÃO", conf: 0, cau: "bão", src: "bão" };

    // 1. CẦU (ưu tiên tuyệt đối)
    const c = byCau(hist.slice(0, N));
    if (c) return c;

    // 2. BẢNG ĐIỂM (theo rules + context)
    const d = byDiem(Number(last.total), last.dice, hist.slice(0, N));
    if (d) return d;

    // 3. ĐẢO
    return { pred: last.result === "Tài" ? "Xỉu" : "Tài", conf: 52, cau: "-", src: "đảo" };
}

// ==================== PARSE & FETCH ====================
function parse(data, isMd5) {
    if (!data?.list || !Array.isArray(data.list)) return [];
    return data.list.map(it => {
        const point = Number(it.point);
        const result = isMd5 ? norm(it.resultTruyenThong, point) : (point >= 11 ? "Tài" : "Xỉu");
        return { session: it.id, dice: it.dices, total: point, result };
    }).sort((a, b) => b.session - a.session);
}

let hu = [], md5 = [], idHu = null, idMd5 = null;

async function tick(url, isMd5) {
    try {
        const data = await (await fetch(url)).json();
        const arr = parse(data, isMd5);
        if (!arr.length) return;
        const latest = arr[0].session, cur = isMd5 ? idMd5 : idHu;
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
        cau_phat_hien: p.cau || "-",
        ghi_chu: p.src
    };
}

// ==================== SERVER ====================
const app = fastify({ logger: false });
await app.register(cors, { origin: "*" });
const keyOK = q => q.key === VALID_KEY;

app.get("/", async () => ({
    status: "active", admin: ADMIN,
    uu_tien: "BÃO → CẦU → BẢNG ĐIỂM (theo ngữ cảnh) → ĐẢO",
    phan_tich: `${N} phiên`,
    endpoints: {
        hu: `/api/taixiu/lc79?key=${VALID_KEY}`,
        md5: `/api/taixiumd5/lc79?key=${VALID_KEY}`,
        bang_diem: `/api/bang-diem?key=${VALID_KEY}`,
        bang_cau: `/api/bang-cau?key=${VALID_KEY}`,
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

app.get("/api/bang-diem", async (req, rep) => {
    if (!keyOK(req.query)) return rep.status(401).send({ error: "Sai key" });
    return { title: "📊 BẢNG MẸO TỔNG ĐIỂM (theo ngữ cảnh)", admin: ADMIN, bang: BANG_DIEM };
});

app.get("/api/bang-cau", async (req, rep) => {
    if (!keyOK(req.query)) return rep.status(401).send({ error: "Sai key" });
    return { title: "📊 BẢNG MẸO CẦU", admin: ADMIN, bang: BANG_CAU };
});

app.get("/api/debug/:loai", async (req, rep) => {
    if (!keyOK(req.query)) return rep.status(401).send({ error: "Sai key" });
    const h = req.params.loai === "md5" ? md5 : hu;
    if (!h.length) return rep.status(503).send({ error: "Chưa đủ dữ liệu" });
    const recent = h.slice(0, N);
    const ctx = detectContext(recent);
    const c = byCau(recent);
    const d = byDiem(Number(h[0].total), h[0].dice, recent);
    const p = predict(h);
    return {
        bieu_do_cau: chart(h),
        streak: streaks(recent).map(s => `${s.type === "Tài" ? "T" : "X"}${s.len}`).join("-"),
        ngu_canh: ctx,
        cau_tra: c ? { pred: c.pred, conf: c.conf, cau: c.cau } : null,
        diem_tra: d ? { pred: d.pred, conf: d.conf, cau: d.cau, ghi_chu: d.src } : null,
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

try { await app.listen({ port: PORT, host: "0.0.0.0" }); }
catch (err) { console.error("❌ Lỗi khởi động:", err.message); process.exit(1); }

console.log(`
╔══════════════════════════════════════════════════════════╗
║   TÀI XỈU - CẦU + BẢNG ĐIỂM (RULES THEO NGỮ CẢNH)       ║
╠══════════════════════════════════════════════════════════╣
║  🚀 http://localhost:${PORT}                                 ║
║  🔑 KEY: ${VALID_KEY}                                       ║
║  👤 ADMIN: ${ADMIN}                                    ║
║  📊 PHÂN TÍCH: ${N} phiên                                  ║
║  ⚡ THỨ TỰ: BÃO → CẦU → BẢNG ĐIỂM → ĐẢO                   ║
║                                                          ║
║  📌 API:                                                 ║
║     HŨ : /api/taixiu/lc79?key=${VALID_KEY}              ║
║     MD5: /api/taixiumd5/lc79?key=${VALID_KEY}           ║
║     BẢNG ĐIỂM: /api/bang-diem?key=${VALID_KEY}          ║
║     BẢNG CẦU: /api/bang-cau?key=${VALID_KEY}            ║
║     DEBUG: /api/debug/hu?key=${VALID_KEY}               ║
╚══════════════════════════════════════════════════════════╝
`);
