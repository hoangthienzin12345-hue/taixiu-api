import fastify from "fastify";
import cors from "@fastify/cors";
import fetch from "node-fetch";

// ==================== CẤU HÌNH ====================
const PORT = process.env.PORT || 3000;
const VALID_KEY = "Thien456";
const ADMIN = "@ADMNLc79";
const N = 30; // số phiên phân tích

const API_HU  = "https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5";
const API_MD5 = "https://wtxmd52.tele68.com/v1/txmd5/sessions";

// ==================== CHUẨN HOÁ & HELPERS ====================
function norm(val, point) {
    if (val !== undefined && val !== null) {
        const s = String(val).toLowerCase().trim();
        if (["tài", "tai", "t", "big"].includes(s)) return "Tài";
        if (["xỉu", "xiu", "x", "small"].includes(s)) return "Xỉu";
    }
    return Number(point) >= 11 ? "Tài" : "Xỉu";
}
function opp(x) { return x === "Tài" ? "Xỉu" : "Tài"; }
function bao(dice) { return dice?.[0] === dice?.[1] && dice?.[1] === dice?.[2]; }

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

function chart(hist) {
    if (!hist?.length) return "";
    return hist.slice(0, N).reverse().map(h => h.result === "Tài" ? "T" : "X").join("");
}

// ==================== 72 DETECTORS ====================
const DETECTORS = [];
function addDetector(id, name, fn) { DETECTORS.push({ id, name, fn }); }

// ---------- BỆT (10) ----------
function dBet(hist, L, mode, conf) {
    const st = streaks(hist.slice(0, 40));
    if (!st.length) return null;
    const cur = st[0];
    if (cur.len < L) return null;
    const pred = mode === "brk" ? opp(cur.type) : cur.type;
    const extra = Math.min(12, (cur.len - L) * 2);
    return { pred, conf: Math.min(90, conf + extra), name: `bệt${L}`,
             src: `bệt ${cur.len} tay → ${mode === "brk" ? "BẺ" : "THEO"}` };
}
addDetector("bet2",  "bệt2",   h => dBet(h, 2,  "cont", 58));
addDetector("bet3",  "bệt3",   h => dBet(h, 3,  "cont", 60));
addDetector("bet4",  "bệt4",   h => dBet(h, 4,  "cont", 62));
addDetector("bet5",  "bệt5",   h => dBet(h, 5,  "cont", 64));
addDetector("bet6",  "bệt6",   h => dBet(h, 6,  "cont", 65));
addDetector("bet7",  "bệt7",   h => dBet(h, 7,  "cont", 65));
addDetector("bet8",  "bệt8",   h => dBet(h, 8,  "brk",  68));
addDetector("bet9",  "bệt9",   h => dBet(h, 9,  "brk",  70));
addDetector("bet10", "bệt10",  h => dBet(h, 10, "brk",  73));
addDetector("bet11", "bệt11+", h => dBet(h, 11, "brk",  76));

// ---------- UNIFORM (10) ----------
function dUniform(hist, L, reps, conf) {
    const st = streaks(hist.slice(0, 40));
    if (st.length < reps + 1) return null;
    for (let i = 1; i <= reps; i++) if (st[i].len !== L) return null;
    const cur = st[0];
    const name = `${L}-${L}`;
    if (cur.len < L)  return { pred: cur.type,     conf: conf - 5, name, src: `đồng nhất ${L} (${cur.len}/${L})` };
    if (cur.len === L) return { pred: opp(cur.type), conf,        name, src: `đồng nhất ${L} (đảo)` };
    return null;
}
addDetector("u11",   "1-1",   h => dUniform(h, 1,  3, 78));
addDetector("u22",   "2-2",   h => dUniform(h, 2,  3, 76));
addDetector("u33",   "3-3",   h => dUniform(h, 3,  2, 74));
addDetector("u44",   "4-4",   h => dUniform(h, 4,  2, 72));
addDetector("u55",   "5-5",   h => dUniform(h, 5,  2, 70));
addDetector("u66",   "6-6",   h => dUniform(h, 6,  2, 68));
addDetector("u77",   "7-7",   h => dUniform(h, 7,  2, 66));
addDetector("u88",   "8-8",   h => dUniform(h, 8,  2, 64));
addDetector("u99",   "9-9",   h => dUniform(h, 9,  2, 63));
addDetector("u1010", "10-10", h => dUniform(h, 10, 2, 62));

// ---------- ALT / XEN KẼ (12) ----------
function dAlt(hist, A, B, conf) {
    const st = streaks(hist.slice(0, 40));
    if (st.length < 6) return null;
    if (st[1].len !== A && st[1].len !== B) return null;
    const first = st[1].len;
    const second = first === A ? B : A;
    for (let i = 2; i <= 5; i++) {
        const expected = (i % 2 === 0) ? second : first;
        if (st[i].len !== expected) return null;
    }
    const tgt = second;
    const cur = st[0];
    const name = `${A}-${B}`;
    if (cur.len < tgt)  return { pred: cur.type,     conf: conf - 4, name, src: `xen kẽ ${name} (${cur.len}/${tgt})` };
    if (cur.len === tgt) return { pred: opp(cur.type), conf,        name, src: `xen kẽ ${name} (đảo)` };
    return null;
}
addDetector("a12", "1-2", h => dAlt(h, 1, 2, 76));
addDetector("a21", "2-1", h => dAlt(h, 2, 1, 76));
addDetector("a13", "1-3", h => dAlt(h, 1, 3, 74));
addDetector("a31", "3-1", h => dAlt(h, 3, 1, 74));
addDetector("a14", "1-4", h => dAlt(h, 1, 4, 72));
addDetector("a41", "4-1", h => dAlt(h, 4, 1, 72));
addDetector("a23", "2-3", h => dAlt(h, 2, 3, 73));
addDetector("a32", "3-2", h => dAlt(h, 3, 2, 73));
addDetector("a24", "2-4", h => dAlt(h, 2, 4, 71));
addDetector("a42", "4-2", h => dAlt(h, 4, 2, 71));
addDetector("a34", "3-4", h => dAlt(h, 3, 4, 70));
addDetector("a43", "4-3", h => dAlt(h, 4, 3, 70));

// ---------- CYCLE / CHU KỲ (16) ----------
function dCycle(hist, pattern, conf) {
    const k = pattern.length;
    const st = streaks(hist.slice(0, 40));
    if (st.length < k * 2 + 1) return null;
    for (let idx = 0; idx < k; idx++) {
        if (st[1].len !== pattern[idx]) continue;
        let ok = true;
        for (let i = 0; i < k * 2; i++) {
            const pos = (idx - i + k * 20) % k;
            if (st[1 + i].len !== pattern[pos]) { ok = false; break; }
        }
        if (!ok) continue;
        const tgt = pattern[(idx + 1) % k];
        const cur = st[0];
        const name = pattern.join("-");
        if (cur.len < tgt)  return { pred: cur.type,     conf: conf - 3, name, src: `chu kỳ ${name} (${cur.len}/${tgt})` };
        if (cur.len === tgt) return { pred: opp(cur.type), conf,        name, src: `chu kỳ ${name} (đảo)` };
        return null;
    }
    return null;
}
addDetector("c123", "1-2-3", h => dCycle(h, [1,2,3], 74));
addDetector("c321", "3-2-1", h => dCycle(h, [3,2,1], 74));
addDetector("c132", "1-3-2", h => dCycle(h, [1,3,2], 72));
addDetector("c231", "2-3-1", h => dCycle(h, [2,3,1], 72));
addDetector("c213", "2-1-3", h => dCycle(h, [2,1,3], 72));
addDetector("c312", "3-1-2", h => dCycle(h, [3,1,2], 72));
addDetector("c121", "1-2-1", h => dCycle(h, [1,2,1], 73));
addDetector("c212", "2-1-2", h => dCycle(h, [2,1,2], 73));
addDetector("c131", "1-3-1", h => dCycle(h, [1,3,1], 73));
addDetector("c313", "3-1-3", h => dCycle(h, [3,1,3], 73));
addDetector("c124", "1-2-4", h => dCycle(h, [1,2,4], 70));
addDetector("c421", "4-2-1", h => dCycle(h, [4,2,1], 70));
addDetector("c341", "3-4-1", h => dCycle(h, [3,4,1], 70));
addDetector("c143", "1-4-3", h => dCycle(h, [1,4,3], 70));
addDetector("c234", "2-3-4", h => dCycle(h, [2,3,4], 69));
addDetector("c432", "4-3-2", h => dCycle(h, [4,3,2], 69));

// ---------- MARKOV (6) ----------
function dMarkov(hist, order, conf) {
    if (hist.length < 30) return null;
    const r = hist.map(x => x.result);
    const chrono = [...r].reverse();
    const counts = {};
    for (let i = 0; i < chrono.length - order; i++) {
        const state = chrono.slice(i, i + order).map(x => x === "Tài" ? "T" : "X").join("");
        const next = chrono[i + order];
        if (!counts[state]) counts[state] = { Tài: 0, Xỉu: 0 };
        counts[state][next]++;
    }
    const curState = r.slice(0, order).reverse().map(x => x === "Tài" ? "T" : "X").join("");
    const c = counts[curState];
    if (!c) return null;
    const tot = c.Tài + c.Xỉu;
    if (tot < 3) return null;
    const pred = c.Tài > c.Xỉu ? "Tài" : "Xỉu";
    const prob = Math.max(c.Tài, c.Xỉu) / tot;
    const c2 = Math.round(conf * prob + 55 * (1 - prob));
    return { pred, conf: c2, name: `markov${order}`,
             src: `markov${order} [${curState}] → ${pred} (${Math.round(prob * 100)}%/${tot})` };
}
for (let k = 1; k <= 6; k++) {
    addDetector(`mk${k}`, `markov${k}`, h => dMarkov(h, k, 68 + k * 2));
}

// ---------- BLOCK / LẶP BLOCK (8) ----------
function dBlock(hist, B, conf) {
    if (hist.length < B * 3) return null;
    const r = hist.map(x => x.result);
    const block = r.slice(0, B);
    for (let rep = 1; rep <= 2; rep++) {
        for (let i = 0; i < B; i++) {
            if (r[rep * B + i] !== block[i]) return null;
        }
    }
    const next = block[B - 1];
    return { pred: next, conf, name: `block${B}`, src: `lặp block ${B}` };
}
addDetector("b2", "block2", h => dBlock(h, 2, 70));
addDetector("b3", "block3", h => dBlock(h, 3, 72));
addDetector("b4", "block4", h => dBlock(h, 4, 73));
addDetector("b5", "block5", h => dBlock(h, 5, 74));
addDetector("b6", "block6", h => dBlock(h, 6, 74));
addDetector("b7", "block7", h => dBlock(h, 7, 73));
addDetector("b8", "block8", h => dBlock(h, 8, 72));
addDetector("b9", "block9", h => dBlock(h, 9, 71));

// ---------- MODES / CHẾ ĐỘ (6) ----------
function dHot(hist, conf) {
    if (hist.length < 20) return null;
    const r = hist.slice(0, 20).map(x => x.result);
    const t = r.filter(x => x === "Tài").length;
    const x = 20 - t;
    if (t >= 15) return { pred: "Xỉu", conf: conf + 5, name: "mode-hotT", src: `Tài ${t}/20 → đảo` };
    if (x >= 15) return { pred: "Tài", conf: conf + 5, name: "mode-hotX", src: `Xỉu ${x}/20 → đảo` };
    if (t >= 13) return { pred: "Tài", conf, name: "mode-hotT", src: `Tài ${t}/20 → theo` };
    if (x >= 13) return { pred: "Xỉu", conf, name: "mode-hotX", src: `Xỉu ${x}/20 → theo` };
    return null;
}
addDetector("m-hot", "mode-hot", h => dHot(h, 68));

function dTrend(hist, conf) {
    if (hist.length < 10) return null;
    const r = hist.slice(0, 10).map(x => x.result);
    const t = r.filter(x => x === "Tài").length;
    if (t >= 7)  return { pred: "Xỉu", conf, name: "mode-trend", src: `trend Tài ${t}/10 → đảo` };
    if (t <= 3)  return { pred: "Tài", conf, name: "mode-trend", src: `trend Xỉu ${10 - t}/10 → đảo` };
    return null;
}
addDetector("m-trend", "mode-trend", h => dTrend(h, 66));

function dMomentum(hist, conf) {
    if (hist.length < 8) return null;
    const r = hist.slice(0, 3).map(x => x.result);
    const t = r.filter(x => x === "Tài").length;
    if (t === 3) return { pred: "Xỉu", conf, name: "mode-mom", src: `3T → đảo` };
    if (t === 0) return { pred: "Tài", conf, name: "mode-mom", src: `3X → đảo` };
    return null;
}
addDetector("m-mom", "mode-mom", h => dMomentum(h, 64));

function dTail(hist, conf) {
    if (hist.length < 20) return null;
    const t = [0, 5, 10, 15].map(i => hist[i]?.result).filter(Boolean);
    const tc = t.filter(x => x === "Tài").length;
    const xc = t.length - tc;
    if (tc > xc) return { pred: "Tài", conf, name: "mode-tail", src: `đuôi Tài ${tc}/${t.length}` };
    if (xc > tc) return { pred: "Xỉu", conf, name: "mode-tail", src: `đuôi Xỉu ${xc}/${t.length}` };
    return null;
}
addDetector("m-tail", "mode-tail", h => dTail(h, 60));

function dFlip(hist, conf) {
    if (hist.length < 5) return null;
    if (hist[0].result === hist[1].result && hist[1].result === hist[2].result) {
        return { pred: opp(hist[0].result), conf, name: "mode-flip", src: `3 giống → đảo` };
    }
    return null;
}
addDetector("m-flip", "mode-flip", h => dFlip(h, 58));

function dMaj(hist, conf) {
    if (hist.length < 15) return null;
    const r = hist.slice(0, 15).map(x => x.result);
    const t = r.filter(x => x === "Tài").length;
    if (t === 7 || t === 8) return null;
    const pred = t > 7 ? "Tài" : "Xỉu";
    return { pred, conf, name: "mode-maj", src: `đa số ${pred} ${Math.max(t, 15 - t)}/15` };
}
addDetector("m-maj", "mode-maj", h => dMaj(h, 60));

// ---------- META (4) ----------
function dMeta(hist, threshold, conf, name) {
    const preds = [];
    for (const d of DETECTORS) {
        if (d.id.startsWith("meta")) continue;
        try {
            const r = d.fn(hist);
            if (r && r.pred) preds.push(r);
        } catch (e) {}
    }
    if (preds.length < threshold) return null;
    const t = preds.filter(p => p.pred === "Tài").length;
    const x = preds.length - t;
    const ratio = Math.max(t, x) / preds.length;
    if (ratio < 0.6) return null;
    const pred = t > x ? "Tài" : "Xỉu";
    return { pred, conf: Math.round(conf * ratio), name,
             src: `${name}: ${t}T/${x}X trong ${preds.length} cầu` };
}
addDetector("meta-consensus", "meta-consensus", h => dMeta(h, 5,  82, "meta-consensus"));
addDetector("meta-strong",    "meta-strong",    h => dMeta(h, 8,  85, "meta-strong"));
addDetector("meta-vote",      "meta-vote",      h => dMeta(h, 3,  78, "meta-vote"));
addDetector("meta-hybrid",    "meta-hybrid",    h => dMeta(h, 10, 88, "meta-hybrid"));

console.log(`🧠 Đã nạp ${DETECTORS.length} cầu`);

// ==================== 🧠 LEARNER (TỰ HỌC) ====================
class Learner {
    constructor() { this.stats = {}; }
    record(id, correct) {
        if (!this.stats[id]) this.stats[id] = { hit: 0, miss: 0 };
        if (correct) this.stats[id].hit++;
        else         this.stats[id].miss++;
    }
    accuracy(id) {
        const s = this.stats[id];
        if (!s) return 0.5;
        const t = s.hit + s.miss;
        return t ? s.hit / t : 0.5;
    }
    weight(id) {
        const s = this.stats[id];
        const n = s ? s.hit + s.miss : 0;
        const acc = this.accuracy(id);
        const k = 10; // smoothing
        return (acc * n + 0.5 * k) / (n + k);
    }
    snapshot() {
        const out = {};
        for (const [id, s] of Object.entries(this.stats)) {
            const t = s.hit + s.miss;
            out[id] = {
                hit: s.hit, miss: s.miss, total: t,
                acc: t ? (s.hit / t * 100).toFixed(1) + "%" : "N/A"
            };
        }
        return out;
    }
}

// ==================== ENGINE ====================
class Engine {
    constructor() {
        this.learner = new Learner();
        this.lastPred = null; // {session, predictions:[{id,pred}], result}
        this.totalScored = 0;
        this.totalHit = 0;
    }

    onNewSessions(newSess) {
        if (!this.lastPred) return;
        for (const s of newSess) {
            if (this.lastPred.session === s.session) {
                for (const p of this.lastPred.predictions) {
                    const ok = p.pred === s.result;
                    this.learner.record(p.id, ok);
                    if (ok) this.totalHit++;
                    this.totalScored++;
                }
                this.lastPred = null;
                return;
            }
        }
    }

    computeAll(hist) {
        const out = [];
        for (const d of DETECTORS) {
            try {
                const r = d.fn(hist);
                if (r && r.pred) out.push({ id: d.id, name: d.name, ...r });
            } catch (e) {}
        }
        return out;
    }

    predict(hist) {
        if (!hist.length) {
            return { pred: "Xỉu", conf: 50, cau: "-", src: "chưa có dữ liệu", top: [] };
        }

        // BÃO
        if (bao(hist[0].dice)) {
            return { pred: "BÃO", conf: 0, cau: "bão", src: "bão (nghỉ)", top: [] };
        }

        const nextSession = hist[0].session + 1;

        // cache
        if (this.lastPred && this.lastPred.session === nextSession) {
            return this.lastPred.result;
        }

        const all = this.computeAll(hist);

        // áp trọng số từ learner
        const weighted = all.map(d => {
            const w = this.learner.weight(d.id);       // 0.25 .. 0.75
            const baseConf = d.conf || 60;
            const eff = baseConf * (0.5 + w);          // blend
            return { ...d, weight: w, eff };
        });

        let t = 0, x = 0;
        for (const d of weighted) {
            if (d.pred === "Tài") t += d.eff;
            else if (d.pred === "Xỉu") x += d.eff;
        }

        const total = t + x;
        let pred, conf;
        if (total === 0) {
            pred = opp(hist[0].result);
            conf = 50;
        } else {
            pred = t >= x ? "Tài" : "Xỉu";
            conf = Math.min(95, Math.round(Math.max(t, x) / total * 100));
        }

        weighted.sort((a, b) => b.eff - a.eff);
        const top = weighted.slice(0, 5).map(d => {
            const acc = (this.learner.accuracy(d.id) * 100).toFixed(0);
            return `${d.name}:${d.pred}(${d.conf}%|acc${acc}%|w${d.weight.toFixed(2)})`;
        });

        const result = {
            pred,
            conf,
            cau: weighted[0]?.name || "-",
            src: `🧠 ${all.length}/72 cầu | Vote T=${Math.round(t)} X=${Math.round(x)}`,
            top
        };

        this.lastPred = {
            session: nextSession,
            predictions: all.map(d => ({ id: d.id, pred: d.pred })),
            result
        };

        return result;
    }
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
const engHu  = new Engine();
const engMd5 = new Engine();

async function tick(url, isMd5) {
    try {
        const res = await fetch(url);
        const data = await res.json();
        const arr = parse(data, isMd5);
        if (!arr.length) return;
        const latest = arr[0].session;
        const cur  = isMd5 ? idMd5 : idHu;
        const eng  = isMd5 ? engMd5 : engHu;
        const tag  = isMd5 ? "MD5" : "HŨ";

        if (!cur) {
            if (isMd5) { md5 = arr; idMd5 = latest; } else { hu = arr; idHu = latest; }
            console.log(`✅ [${tag}] ${arr.length} phiên | Mới: ${latest} (${arr[0].result})`);
        } else if (latest > cur) {
            const news = arr
                .filter(r => r.session > cur)
                .sort((a, b) => a.session - b.session); // asc để chấm điểm
            const target = isMd5 ? md5 : hu;
            for (let i = news.length - 1; i >= 0; i--) target.unshift(news[i]);
            if (target.length > 500) target.length = 450;
            if (isMd5) idMd5 = latest; else idHu = latest;
            eng.onNewSessions(news);
            console.log(`🆕 [${tag}] +${news.length} | Mới: ${latest} (${arr[0].result})`);
        }
    } catch (e) {
        console.error(`❌ [${isMd5 ? "MD5" : "HŨ"}]:`, e.message);
    }
}

// ==================== RESPONSE ====================
function resp(hist, eng) {
    const l = hist[0];
    const p = eng.predict(hist);
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
        nguon: p.src || "-",
        top_cau: p.top || []
    };
}

// ==================== SERVER ====================
const app = fastify({ logger: false });
await app.register(cors, { origin: "*" });

const keyOK = q => q.key === VALID_KEY;

app.get("/", async () => ({
    status: "active",
    admin: ADMIN,
    engine: `🧠 ${DETECTORS.length} cầu + tự học (Learner theo dõi độ chính xác từng cầu)`,
    phan_tich: `${N} phiên`,
    endpoints: {
        hu:         `/api/taixiu/lc79?key=${VALID_KEY}`,
        md5:        `/api/taixiumd5/lc79?key=${VALID_KEY}`,
        debug_hu:   `/api/debug/hu?key=${VALID_KEY}`,
        debug_md5:  `/api/debug/md5?key=${VALID_KEY}`,
        stats_hu:   `/api/stats/hu?key=${VALID_KEY}`,
        stats_md5:  `/api/stats/md5?key=${VALID_KEY}`
    }
}));

const send = (hist, eng, reply) =>
    hist.length ? resp(hist, eng) : reply.status(503).send({ error: "Đang tải dữ liệu..." });

app.get("/api/taixiu/:g", async (req, rep) =>
    keyOK(req.query) ? send(hu, engHu, rep)
                     : rep.status(401).send({ error: `Sai key! Ib ${ADMIN}` }));

app.get("/api/taixiumd5/:g", async (req, rep) =>
    keyOK(req.query) ? send(md5, engMd5, rep)
                     : rep.status(401).send({ error: `Sai key! Ib ${ADMIN}` }));

app.get("/api/stats/:loai", async (req, rep) => {
    if (!keyOK(req.query)) return rep.status(401).send({ error: "Sai key" });
    const eng = req.params.loai === "md5" ? engMd5 : engHu;
    return {
        accuracy_overall: eng.totalScored
            ? (eng.totalHit / eng.totalScored * 100).toFixed(2) + "%"
            : "N/A",
        total_scored: eng.totalScored,
        per_bridge: eng.learner.snapshot()
    };
});

app.get("/api/debug/:loai", async (req, rep) => {
    if (!keyOK(req.query)) return rep.status(401).send({ error: "Sai key" });
    const h   = req.params.loai === "md5" ? md5  : hu;
    const eng = req.params.loai === "md5" ? engMd5 : engHu;
    if (!h.length) return rep.status(503).send({ error: "Chưa đủ dữ liệu" });

    const all = eng.computeAll(h);
    const p   = eng.predict(h);

    return {
        bieu_do_cau: chart(h),
        streak: streaks(h.slice(0, N))
            .map(s => `${s.type === "Tài" ? "T" : "X"}${s.len}`).join("-"),
        so_cau_hoat_dong: all.length,
        chi_tiet: all.map(d => ({
            id: d.id, name: d.name, pred: d.pred, conf: d.conf, src: d.src,
            weight: Number(eng.learner.weight(d.id).toFixed(3)),
            acc: (eng.learner.accuracy(d.id) * 100).toFixed(1) + "%"
        })),
        ket_qua: { du_doan: p.pred, tin_cay: `${p.conf}%`, top: p.top }
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
╔══════════════════════════════════════════════════════════════╗
║   TÀI XỈU LC79 - 72 CẦU + 🧠 ENGINE TỰ HỌC                  ║
╠══════════════════════════════════════════════════════════════╣
║  🚀 http://localhost:${PORT}                                 ║
║  🔑 KEY: ${VALID_KEY}                                       ║
║  👤 ADMIN: ${ADMIN}                                    ║
║  📊 PHÂN TÍCH: ${N} phiên gần nhất                          ║
║                                                              ║
║  🎯 72 CẦU:                                                  ║
║     • Bệt (10)  | 1-1..10-10 (10) | Xen kẽ (12)              ║
║     • Chu kỳ (16)| Markov 1..6 (6) | Block 2..9 (8)          ║
║     • Mode (6)  | Meta vote/consensus/hybrid/strong (4)      ║
║                                                              ║
║  🧠 TỰ HỌC:                                                   ║
║     • Chấm điểm từng cầu sau mỗi phiên                       ║
║     • Weight theo độ chính xác (smoothing)                   ║
║     • Vote có trọng số → dự đoán cuối                        ║
║                                                              ║
║  📌 API:                                                     ║
║     HŨ   : /api/taixiu/lc79?key=${VALID_KEY}                ║
║     MD5  : /api/taixiumd5/lc79?key=${VALID_KEY}             ║
║     DEBUG: /api/debug/hu?key=${VALID_KEY}                   ║
║     STATS: /api/stats/hu?key=${VALID_KEY}                   ║
╚══════════════════════════════════════════════════════════════╝
`);