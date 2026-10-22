// ═══════════════════════════════════════════════════════════════════════════════
//  TÀI XỈU LC79 — FULL 72 CẦU + BẢNG ĐIỂM (PRODUCTION)
//  Cầu (72 pattern) + Bảng điểm (16 mức) → Dự đoán tổng hợp
// ═══════════════════════════════════════════════════════════════════════════════
import fastify from "fastify";
import cors from "@fastify/cors";

const PORT      = process.env.PORT || 3000;
const VALID_KEY = "Thien456";
const ADMIN     = "@ADMNLc79";

// 🔧 Multi-URL fallback
const HU_URLS = [
    "https://wtx.tele68.com/v1/tx/sessions?cp=R&cl=R&pf=web",
    "https://wtx.tele68.com/v1/tx/sessions",
    "https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5",
    "https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web",
];
const MD5_URLS = [
    "https://wtxmd52.tele68.com/v1/txmd5/sessions",
    "https://wtxmd52.tele68.com/v1/txmd5/sessions?cp=R&cl=R&pf=web",
];

const MAX  = 105;
const POLL = 4000;

// ═══════════════════════════════════════════════════════════════════════════════
//  BẢNG ĐIỂM MD5 (16 mức)
// ═══════════════════════════════════════════════════════════════════════════════
const BANG_DIEM = {
    3:  { pred: "X", conf: 70, note: "X3  → XỈU 70%" },
    4:  { pred: "T", conf: 60, note: "X4  → TÀI 60%" },
    5:  { pred: "T", conf: 70, note: "X5  → TÀI 70%" },
    6:  { pred: "X", conf: 60, note: "X6  → XỈU 60%" },
    7:  { pred: "T", conf: 80, note: "X7  → TÀI 80%" },
    8:  { pred: "X", conf: 80, note: "X8  → XỈU 80%" },
    9:  { pred: "X", conf: 70, note: "X9  → XỈU 70%" },
    10: { pred: "T", conf: 80, note: "X10 → TÀI 80%" },
    11: { pred: "X", conf: 60, note: "T11 → XỈU 60%" },
    12: { pred: "T", conf: 80, note: "T12 → TÀI 80%" },
    13: { pred: "T", conf: 80, note: "T13 → TÀI 80%" },
    14: { pred: "X", conf: 60, note: "T14 → XỈU 60%" },
    15: { pred: "X", conf: 70, note: "T15 → XỈU 70%" },
    16: { pred: "T", conf: 60, note: "T16 → TÀI 60%" },
    17: { pred: "X", conf: 60, note: "T17 → XỈU 60%" },
    18: { pred: "X", conf: 80, note: "T18 → XỈU 80%" },
};

// ═══════════════════════════════════════════════════════════════════════════════
//  FETCH & DEFENSIVE PARSE
// ═══════════════════════════════════════════════════════════════════════════════
async function fetchJSON(url, timeoutMs = 6000, retries = 1) {
    for (let a = 0; a <= retries; a++) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 LC79" } });
            clearTimeout(t);
            if (!r.ok) throw new Error("HTTP " + r.status);
            return await r.json();
        } catch (e) {
            clearTimeout(t);
            if (a === retries) throw e;
            await new Promise(r => setTimeout(r, 500));
        }
    }
}

async function fetchFirstSuccess(urls) {
    const errors = [];
    for (const url of urls) {
        try {
            const json = await fetchJSON(url);
            return { url, json };
        } catch (e) {
            errors.push(`${url} → ${e.message}`);
        }
    }
    throw new Error("All URLs failed:\n" + errors.join("\n"));
}

function extractList(json) {
    if (Array.isArray(json)) return json;
    if (!json || typeof json !== "object") return [];
    for (const k of ["list", "data", "sessions", "result", "items", "history", "records", "dice_results"]) {
        if (Array.isArray(json[k])) return json[k];
    }
    for (const k of Object.keys(json)) {
        if (json[k] && typeof json[k] === "object") {
            const nested = extractList(json[k]);
            if (nested.length) return nested;
        }
    }
    return [];
}

function pickNumber(obj, keys) {
    for (const k of keys) {
        const v = obj?.[k];
        if (v !== undefined && v !== null) {
            const n = Number(v);
            if (!isNaN(n) && n > 0) return n;
        }
    }
    return 0;
}

function pickResult(obj) {
    for (const k of ["resultTruyenThong", "result", "resultName", "type", "ket_qua", "taiXiu", "outcome", "status"]) {
        const v = String(obj?.[k] || "").toUpperCase();
        if (v.includes("TAI") || v.includes("TÀI")) return "T";
        if (v.includes("XIU") || v.includes("XỈU")) return "X";
    }
    return null;
}

function pickDices(obj) {
    for (const k of ["dices", "dice", "xuc_xac", "xucXac", "dice_value", "values"]) {
        const v = obj?.[k];
        if (Array.isArray(v) && v.length === 3 && v.every(x => Number(x) >= 1 && Number(x) <= 6)) return v.map(Number);
        if (typeof v === "string") {
            const parts = v.split(/[-_,\s]+/).map(Number).filter(x => !isNaN(x));
            if (parts.length === 3 && parts.every(x => x >= 1 && x <= 6)) return parts;
        }
    }
    if (obj?.dice1 && obj?.dice2 && obj?.dice3) {
        const d = [Number(obj.dice1), Number(obj.dice2), Number(obj.dice3)];
        if (d.every(x => x >= 1 && x <= 6)) return d;
    }
    return [];
}

function parseRows(json) {
    const list = extractList(json);
    const parsed = [];
    for (const x of list) {
        try {
            const idNum = pickNumber(x, ["id", "_id", "sessionId", "session", "phien", "session_id", "id_num", "round"]);
            if (!idNum) continue;
            let r = pickResult(x);
            const point = pickNumber(x, ["point", "total", "tong", "diceSum", "sum", "score"]);
            if (!r && point > 0) r = point >= 11 ? "T" : "X";
            if (!r) continue;
            const dices = pickDices(x);
            parsed.push({ id: String(idNum), id_num: idNum, r, dices, point });
        } catch (e) {}
    }
    return parsed.sort((a, b) => a.id_num - b.id_num);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════════════════
const opp = x => x === "T" ? "X" : "T";
const runs = a => { const out = []; for (const x of a) { if (!out.length || out[out.length - 1].v !== x) out.push({ v: x, n: 1 }); else out[out.length - 1].n++; } return out; };
const suffix = a => runs(a).at(-1);
const entropy = a => { if (!a.length) return 1; const t = a.filter(x => x === "T").length / a.length; if (t <= 0 || t >= 1) return 0; return -(t * Math.log2(t) + (1 - t) * Math.log2(1 - t)); };
const freq = (a, w = 20) => { a = a.slice(-w); return a.length ? a.filter(x => x === "T").length / a.length : 0.5; };
const trans = a => { let tt = 0, tx = 0, xt = 0, xx = 0; for (let i = 1; i < a.length; i++) { if (a[i-1] === "T" && a[i] === "T") tt++; else if (a[i-1] === "T") tx++; else if (a[i] === "T") xt++; else xx++; } return { tt, tx, xt, xx }; };
const predictTrans = a => { const q = trans(a), last = a.at(-1); if (last === "T") { const n = q.tt + q.tx; return n ? (q.tt/n - 0.5) * 2 : 0; } const n = q.xt + q.xx; return n ? (q.xt/n - 0.5) * 2 : 0; };
const patternAt = (a, pat) => { if (a.length < pat.length) return null; const z = a.slice(-pat.length); return z.every((v, i) => v === pat[i]) ? pat.at(-1) : null; };
const alternating = a => a.length > 1 && a.slice(1).every((x, i) => x !== a[i]);
const runLens = a => runs(a).map(x => x.n);
const scoreFromNext = (a, next) => next === "T" ? 1 : -1;

// ═══════════════════════════════════════════════════════════════════════════════
//  72 CẦU (từ logic 1.txt)
// ═══════════════════════════════════════════════════════════════════════════════
const defs = [];
const add  = (name, group, fn, min = 8) => defs.push({ name, group, fn, min });

// ── Bệt (2→8) ──
for (let n = 2; n <= 8; n++) add(`Cầu bệt ${n}`, "Bệt", a => { const r = suffix(a); return r && r.n >= n ? (r.v === "T" ? 1 : -1) * (0.55 + Math.min(0.25, (r.n - n) * 0.03)) : 0; }, n + 5);
add("Cầu bệt tăng tiếp diễn", "Bệt", a => { const r = suffix(a); return r && r.n >= 3 ? (r.v === "T" ? 1 : -1) * 0.72 : 0; }, 10);
add("Cầu bệt chuẩn bị gãy",   "Bệt", a => { const r = suffix(a); return r && r.n >= 4 ? (r.v === "T" ? -1 : 1) * 0.68 : 0; }, 12);

// ── Cơ bản ──
add("Cầu 1-1", "Cầu 1-1", a => alternating(a) ? (a.at(-1) === "T" ? -1 : 1) * 0.86 : 0, 8);
add("Cầu 2-2", "Cầu nhịp", a => { const r = runs(a); if (r.length < 4) return 0; return r.slice(-4).map(x => x.n).join(",") === "2,2,2,2" ? (r.at(-1).v === "T" ? 1 : -1) * 0.82 : 0; }, 12);
add("Cầu 3-3", "Cầu nhịp", a => { const r = runs(a); return r.slice(-4).every(x => x.n === 3) ? (r.at(-1).v === "T" ? 1 : -1) * 0.82 : 0; }, 15);
add("Cầu 4-4", "Cầu nhịp", a => { const r = runs(a); return r.slice(-4).every(x => x.n === 4) ? (r.at(-1).v === "T" ? 1 : -1) * 0.82 : 0; }, 18);
add("Cầu 1-2", "Cầu nhịp", a => { const r = runs(a).slice(-6).map(x => x.n); return r.length >= 4 && r.slice(-4).join(",") === "1,2,1,2" ? (r.at(-1).v === "T" ? 1 : -1) * 0.8 : 0; }, 12);
add("Cầu 2-1", "Cầu nhịp", a => { const r = runs(a).slice(-6).map(x => x.n); return r.length >= 4 && r.slice(-4).join(",") === "2,1,2,1" ? (r.at(-1).v === "T" ? 1 : -1) * 0.8 : 0; }, 12);

// ── 15 cầu nhịp run-length ──
for (const [name, pat] of [
    ["1-2-1", "1,2,1"], ["2-1-2", "2,1,2"], ["1-3-1", "1,3,1"], ["2-3-2", "2,3,2"],
    ["1-2-3", "1,2,3"], ["3-2-1", "3,2,1"], ["2-3-4", "2,3,4"], ["4-3-2", "4,3,2"],
    ["1-3-2", "1,3,2"], ["2-1-3", "2,1,3"], ["3-1-2", "3,1,2"], ["2-4-2", "2,4,2"],
    ["3-1-3", "3,1,3"], ["1-4-1", "1,4,1"], ["4-1-4", "4,1,4"],
]) {
    add(`Cầu ${name}`, "Cầu nhịp", a => {
        const r = runs(a).slice(-pat.split(",").length);
        return r.map(x => x.n).join(",") === pat ? ((r.at(-1).v === "T" ? 1 : -1) * 0.78) : 0;
    }, 15);
}

// ── Chu kỳ độ dài ──
add("Cầu tăng dần độ bệt", "Chu kỳ", a => { const l = runLens(a).slice(-5); return l.length === 5 && l.every((v, i) => i === 0 || v > l[i-1]) ? (suffix(a).v === "T" ? 1 : -1) * 0.76 : 0; }, 20);
add("Cầu giảm dần độ bệt", "Chu kỳ", a => { const l = runLens(a).slice(-5); return l.length === 5 && l.every((v, i) => i === 0 || v < l[i-1]) ? (suffix(a).v === "T" ? 1 : -1) * 0.76 : 0; }, 20);
add("Cầu lặp độ dài", "Chu kỳ", a => { const l = runLens(a).slice(-6); return l.length === 6 && l[0] === l[2] && l[2] === l[4] && l[1] === l[3] && l[3] === l[5] ? (suffix(a).v === "T" ? 1 : -1) * 0.7 : 0; }, 24);
add("Cầu gương độ dài", "Chu kỳ", a => { const l = runLens(a).slice(-5); return l.length === 5 && l[0] === l[4] && l[1] === l[3] ? (suffix(a).v === "T" ? 1 : -1) * 0.7 : 0; }, 20);

// ── Chuyển trạng thái (6) ──
add("Cầu đổi nhịp sau bệt", "Chuyển trạng thái", a => { const r = runs(a); if (r.length < 3) return 0; const q = r.at(-2), z = r.at(-1); return q.n >= 3 && z.n <= 2 ? (z.v === "T" ? 1 : -1) * 0.65 : 0; }, 12);
add("Cầu phá bệt ngắn", "Chuyển trạng thái", a => { const r = runs(a); if (r.length < 3) return 0; const z = r.at(-1); return z.n === 1 ? (z.v === "T" ? 1 : -1) * 0.62 : 0; }, 10);
add("Cầu sau chuỗi 2", "Chuyển trạng thái", a => { const r = runs(a); return r.at(-1)?.n === 2 ? (r.at(-1).v === "T" ? 1 : -1) * 0.58 : 0; }, 10);
add("Cầu sau chuỗi 3", "Chuyển trạng thái", a => { const r = runs(a); return r.at(-1)?.n === 3 ? (r.at(-1).v === "T" ? 1 : -1) * 0.62 : 0; }, 12);
add("Cầu sau chuỗi 4+", "Chuyển trạng thái", a => { const r = runs(a); return r.at(-1)?.n >= 4 ? (r.at(-1).v === "T" ? -1 : 1) * 0.62 : 0; }, 14);
add("Cầu biến đổi trạng thái", "Chuyển trạng thái", a => { const r = runs(a); return r.length >= 2 && r.at(-1).n === 1 && r.at(-2).n >= 2 ? (r.at(-1).v === "T" ? 1 : -1) * 0.65 : 0; }, 10);

// ── Markov ngữ cảnh 1-5 ──
for (let k = 1; k <= 5; k++) {
    add(`Cầu ngữ cảnh ${k} bước`, "Markov", a => {
        if (a.length < k + 5) return 0;
        const ctx = a.slice(-k).join("");
        let t = 0, x = 0;
        for (let i = k; i < a.length; i++) if (a.slice(i - k, i).join("") === ctx) { a[i] === "T" ? t++ : x++; }
        const n = t + x;
        return n >= 2 ? (t - x) / n : 0;
    }, k + 8);
}
add("Cầu chuyển tiếp T→T/X", "Markov", a => predictTrans(a), 12);
add("Cầu chuyển tiếp theo bệt", "Markov", a => { const r = suffix(a); if (!r || a.length < 10) return 0; let t = 0, x = 0; for (let i = r.n; i < a.length; i++) if (a[i - r.n] === r.v) { a[i] === "T" ? t++ : x++; } return t + x >= 3 ? (t - x) / (t + x) : 0; }, 14);
add("Cầu Markov bậc 2", "Markov", a => { if (a.length < 12) return 0; const c = a.slice(-2).join(""); let t = 0, x = 0; for (let i = 2; i < a.length; i++) if (a.slice(i - 2, i).join("") === c) a[i] === "T" ? t++ : x++; return t + x >= 3 ? (t - x) / (t + x) : 0; }, 12);
add("Cầu Markov bậc 3", "Markov", a => { if (a.length < 15) return 0; const c = a.slice(-3).join(""); let t = 0, x = 0; for (let i = 3; i < a.length; i++) if (a.slice(i - 3, i).join("") === c) a[i] === "T" ? t++ : x++; return t + x >= 2 ? (t - x) / (t + x) : 0; }, 15);
add("Cầu Markov bậc 4", "Markov", a => { if (a.length < 18) return 0; const c = a.slice(-4).join(""); let t = 0, x = 0; for (let i = 4; i < a.length; i++) if (a.slice(i - 4, i).join("") === c) a[i] === "T" ? t++ : x++; return t + x >= 2 ? (t - x) / (t + x) : 0; }, 18);
add("Cầu suffix tái diễn", "Lặp mẫu", a => { if (a.length < 12) return 0; const s = a.slice(-3).join(""); let t = 0, x = 0; for (let i = 3; i < a.length - 1; i++) if (a.slice(i - 3, i).join("") === s) a[i] === "T" ? t++ : x++; return t + x >= 2 ? (t - x) / (t + x) : 0; }, 12);

// ── Chu kỳ lag 2→9 ──
for (let lag = 2; lag <= 9; lag++) add(`Cầu chu kỳ lag ${lag}`, "Chu kỳ", a => { if (a.length < lag * 3) return 0; let t = 0, x = 0; for (let i = lag; i < a.length; i++) if (a[i] === a[i - lag]) t++; else x++; return t + x >= 8 ? (t - x) / (t + x) * 0.72 : 0; }, lag * 2 + 4);

// ── Lặp block ──
add("Cầu lặp block 3", "Lặp block", a => { if (a.length < 9) return 0; const z = a.slice(-6), p = z.slice(0, 3); return z.slice(3).join("") === p.join("") ? (p.at(-1) === "T" ? 1 : -1) * 0.72 : 0; }, 12);
add("Cầu lặp block 4", "Lặp block", a => { if (a.length < 12) return 0; const z = a.slice(-8), p = z.slice(0, 4); return z.slice(4).join("") === p.join("") ? (p.at(-1) === "T" ? 1 : -1) * 0.72 : 0; }, 15);
add("Cầu đảo block", "Lặp block", a => { if (a.length < 10) return 0; const z = a.slice(-6), p = z.slice(0, 3).map(opp).join(""); return z.slice(3).join("") === p ? (z.at(-1) === "T" ? 1 : -1) * 0.7 : 0; }, 12);
add("Cầu gương chuỗi", "Lặp block", a => { if (a.length < 8) return 0; const z = a.slice(-6), p = z.slice(0, 3).reverse().join(""); return z.slice(3).join("") === p ? (z.at(-1) === "T" ? 1 : -1) * 0.68 : 0; }, 12);

// ── Thống kê ──
add("Cầu lệch tần suất 10", "Thống kê", a => { const p = freq(a, 10); return Math.abs(p - 0.5) >= 0.25 ? (p > 0.5 ? 1 : -1) * 0.62 : 0; }, 12);
add("Cầu lệch tần suất 20", "Thống kê", a => { const p = freq(a, 20); return Math.abs(p - 0.5) >= 0.18 ? (p > 0.5 ? 1 : -1) * 0.6 : 0; }, 20);
add("Cầu lệch tần suất 50", "Thống kê", a => { const p = freq(a, 50); return Math.abs(p - 0.5) >= 0.12 ? (p > 0.5 ? 1 : -1) * 0.56 : 0; }, 50);
add("Cầu hồi quy trung bình", "Thống kê", a => { const p = freq(a, 10); return p > 0.75 ? -0.58 : p < 0.25 ? 0.58 : 0; }, 12);
add("Cầu momentum", "Thống kê", a => { const p = freq(a, 8), q = freq(a, 24); return (p - q) * 1.5; }, 24);
add("Cầu anti-momentum", "Thống kê", a => { const p = freq(a, 8), q = freq(a, 24); return -(p - q) * 1.25; }, 24);

// ── Chế độ ──
add("Cầu entropy thấp", "Chế độ", a => entropy(a.slice(-12)) < 0.75 ? (suffix(a).v === "T" ? 1 : -1) * 0.58 : 0, 15);
add("Cầu entropy cao", "Chế độ", a => entropy(a.slice(-12)) > 0.98 ? (suffix(a).v === "T" ? -1 : 1) * 0.42 : 0, 15);
add("Cầu đổi chế độ", "Chế độ", a => { if (a.length < 30) return 0; const e1 = entropy(a.slice(-10)), e2 = entropy(a.slice(-30, -10)); return Math.abs(e1 - e2) > 0.18 ? (freq(a, 10) > 0.5 ? 1 : -1) * 0.55 : 0; }, 30);
add("Cầu lệch cửa sổ", "Chế độ", a => { const p = freq(a, 5), q = freq(a, 30); return Math.abs(p - q) > 0.3 ? (p > 0.5 ? 1 : -1) * 0.5 : 0; }, 30);

// ── Meta ──
add("Cầu đồng thuận 5-10", "Meta", a => { const p = freq(a, 5), q = freq(a, 10); return Math.sign(p - 0.5) === Math.sign(q - 0.5) && Math.abs(p - 0.5) > 0.1 ? (p > 0.5 ? 1 : -1) * 0.68 : 0; }, 10);
add("Cầu đồng thuận 10-20-50", "Meta", a => { const ps = [5, 10, 20].map(w => freq(a, w)); const sg = ps.map(p => Math.sign(p - 0.5)); return sg.every(x => x === sg[0]) && sg[0] ? (sg[0]) * 0.7 : 0; }, 20);
add("Cầu xung đột cửa sổ", "Meta", a => { const p = freq(a, 5), q = freq(a, 30); return Math.sign(p - 0.5) !== Math.sign(q - 0.5) ? (p > 0.5 ? 1 : -1) * 0.28 : 0; }, 30);
add("Cầu ổn định hướng", "Meta", a => { const w = [5, 8, 13, 21].map(n => freq(a, n) > 0.5 ? 1 : -1); return w.filter(x => x === w[0]).length >= 3 ? w[0] * 0.62 : 0; }, 21);
add("Cầu bền hướng", "Meta", a => { const z = a.slice(-8); return z.length === 8 && z.filter(x => x === z[0]).length >= 6 ? (z[0] === "T" ? 1 : -1) * 0.64 : 0; }, 12);
add("Cầu đảo có xác nhận", "Meta", a => { if (!alternating(a.slice(-8))) return 0; return a.at(-1) === "T" ? -0.7 : 0.7; }, 12);
add("Cầu tổng hợp cầu đang sống", "Meta", a => { const p = [freq(a, 5), freq(a, 10), freq(a, 20)]; const s = p.reduce((u, v) => u + (v - 0.5), 0) / p.length; return Math.abs(s) > 0.08 ? s * 1.3 : 0; }, 20);

if (defs.length < 72) throw new Error(`Registry chỉ có ${defs.length} cầu (cần ≥72)`);
defs.splice(72);
defs.forEach((d, i) => { d.patternLabel = d.name; d.name = "Cầu " + (i + 1); });

console.log(`[Engine] Đã nạp ${defs.length} cầu`);

// ═══════════════════════════════════════════════════════════════════════════════
//  CẦU ENGINE (port từ logic 1.txt)
// ═══════════════════════════════════════════════════════════════════════════════
class CauEngine {
    constructor() {
        this.stats = new Map(defs.map(d => [d.name, { n: 0, w: 0, loss: 0 }]));
    }
    detect(a) {
        const out = [];
        for (const d of defs) {
            if (a.length < d.min) continue;
            let v = 0;
            try { v = Number(d.fn(a)) || 0; } catch {}
            if (Math.abs(v) < 0.18) continue;
            const st = this.stats.get(d.name);
            const reliability = st.n >= 8 ? Math.max(0.35, Math.min(1, (st.w + 3) / (st.n + 6))) : 0.5;
            const support = Math.min(1, a.length / d.min);
            const strength = Math.min(1, Math.abs(v));
            out.push({
                name: d.name, group: d.group, signal: Math.sign(v), raw: v,
                confidence: 0.35 + 0.35 * strength + 0.2 * reliability + 0.1 * support,
            });
        }
        out.sort((x, y) => (y.confidence - Math.abs(y.raw) * 0.1) - (x.confidence - Math.abs(x.raw) * 0.1));
        return out;
    }
    choose(a) {
        const ds = this.detect(a);
        if (!ds.length) return { ready: false, patterns: [], reason: "CHƯA NHẬN DIỆN ĐƯỢC CẦU" };
        const grouped = new Map();
        for (const d of ds) { if (!grouped.has(d.group)) grouped.set(d.group, []); grouped.get(d.group).push(d); }
        const candidates = [];
        for (const [group, arr] of grouped) {
            const s = arr.reduce((u, x) => u + x.signal * x.confidence, 0) / arr.reduce((u, x) => u + x.confidence, 0);
            if (Math.abs(s) >= 0.22) candidates.push({ group, score: s, top: arr[0] });
        }
        candidates.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
        if (!candidates.length) return { ready: false, patterns: ds.slice(0, 5), reason: "CẦU YẾU / XUNG ĐỘT" };
        const best = candidates[0];
        const corroboration = candidates.filter(x => Math.sign(x.score) === Math.sign(best.score)).length;
        const opposite = candidates.filter(x => Math.sign(x.score) !== Math.sign(best.score)).length;
        const conf = Math.min(0.86, Math.max(0.5, 0.52 + Math.abs(best.score) * 0.22 + Math.min(0.12, corroboration * 0.025) - Math.min(0.10, opposite * 0.02)));
        const active = { name: best.top.name, group: best.group, side: best.score > 0 ? "T" : "X", confidence: conf, corroboration, opposite };
        return { ready: true, patterns: ds.slice(0, 8), active, side: active.side, confidence: conf };
    }
    learn(target, result) {
        if (!target || !result) return;
        const hit = target.result === result;
        for (const p of target.patterns) {
            const st = this.stats.get(p.name);
            if (!st) continue;
            st.n++;
            if ((p.signal > 0 ? "TAI" : "XIU") === result && hit) st.w++;
            else if ((p.signal > 0 ? "TAI" : "XIU") !== result) st.loss++;
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  COMBINE — Cầu + Bảng điểm
// ═══════════════════════════════════════════════════════════════════════════════
function combinedPredict(engine, sessions) {
    const seq = sessions.map(s => s.r);
    const cau = engine.choose(seq);
    const last = sessions[sessions.length - 1];
    const diem = BANG_DIEM[last.point] || null;

    // Cả 2 đều có
    if (cau.ready && diem) {
        if (cau.side === diem.pred) {
            const conf = Math.min(95, Math.round((cau.confidence * 100 + diem.conf) / 2) + 8);
            return {
                prediction: cau.side === "T" ? "TAI" : "XIU",
                confidence: conf,
                method: `✅ ĐỒNG THUẬN · Cầu ${cau.active.name} (${Math.round(cau.confidence * 100)}%) + Điểm ${last.point} (${diem.conf}%)`,
                cau, diem,
            };
        }
        const cauConf = Math.round(cau.confidence * 100);
        if (cauConf >= diem.conf + 5) {
            return {
                prediction: cau.side === "T" ? "TAI" : "XIU",
                confidence: Math.max(55, cauConf - 8),
                method: `⚔️ CẦU thắng · ${cauConf}% vs ${diem.conf}%`,
                cau, diem,
            };
        }
        if (diem.conf >= cauConf + 5) {
            return {
                prediction: diem.pred === "T" ? "TAI" : "XIU",
                confidence: Math.max(55, diem.conf - 5),
                method: `⚔️ ĐIỂM thắng · ${diem.conf}% vs ${cauConf}%`,
                cau, diem,
            };
        }
        return {
            prediction: cau.side === "T" ? "TAI" : "XIU",
            confidence: Math.max(52, Math.round((cauConf + diem.conf) / 2) - 5),
            method: `⚖️ Cân bằng → ưu tiên cầu`,
            cau, diem,
        };
    }

    if (cau.ready) {
        return {
            prediction: cau.side === "T" ? "TAI" : "XIU",
            confidence: Math.round(cau.confidence * 100),
            method: `🎯 Chỉ cầu · ${cau.active.name} (${Math.round(cau.confidence * 100)}%)`,
            cau, diem: null,
        };
    }

    if (diem) {
        return {
            prediction: diem.pred === "T" ? "TAI" : "XIU",
            confidence: diem.conf,
            method: `📊 Chỉ điểm · ${diem.note}`,
            cau: null, diem,
        };
    }

    return {
        prediction: "CHỜ", confidence: 0,
        method: "Không có tín hiệu",
        cau: null, diem: null,
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════════════════════════
const state = {
    md5: { sessions: [], lastId: null, engine: new CauEngine(), pred: null, latest: null, pending: null, seen: new Set(), activeUrl: null, lastError: null },
    hu:  { sessions: [], lastId: null, engine: new CauEngine(), pred: null, latest: null, pending: null, seen: new Set(), activeUrl: null, lastError: null },
};

const nextId = id => { const n = Number(id); return Number.isFinite(n) ? String(n + 1) : id + "+"; };

function update(key, arr, activeUrl) {
    const st = state[key];
    st.activeUrl = activeUrl;
    if (!arr.length) return;
    const latest = arr[arr.length - 1];

    if (!st.lastId) {
        st.sessions = arr;
        st.lastId = latest.id;
        for (const r of arr) st.seen.add(r.id);
        console.log(`✅ [${key.toUpperCase()}] ${arr.length} phiên via ${activeUrl}`);
    } else if (latest.id_num > st.lastId) {
        const news = arr.filter(r => r.id_num > st.lastId);
        for (const r of news) {
            if (st.seen.has(r.id)) continue;
            st.seen.add(r.id);
            if (st.pending && r.id === st.pending.targetId) {
                st.engine.learn(st.pending.target, r.r === "T" ? "TAI" : "XIU");
                st.pending = null;
            }
            st.sessions.push(r);
        }
        if (st.sessions.length > 1000) st.sessions = st.sessions.slice(-800);
        st.lastId = latest.id;
        console.log(`🆕 [${key.toUpperCase()}] +${news.length}`);
    }

    const recent = st.sessions.slice(-MAX);
    st.latest = recent[recent.length - 1];
    const pred = combinedPredict(st.engine, recent);
    const targetId = pred.prediction !== "CHỜ" ? nextId(st.latest.id) : null;
    st.pred = { ...pred, targetId };

    if (targetId && (!st.pending || st.pending.targetId !== targetId)) {
        st.pending = { targetId, target: pred.cau ? { result: pred.prediction, patterns: pred.cau.patterns } : null };
    }
}

async function poll(key) {
    const st = state[key];
    const urls = key === "hu" ? HU_URLS : MD5_URLS;
    try {
        const { url, json } = await fetchFirstSuccess(urls);
        const arr = parseRows(json);
        st.lastError = arr.length === 0 ? "Parse 0 rows: " + JSON.stringify(json).slice(0, 200) : null;
        update(key, arr, url);
    } catch (e) {
        st.lastError = e.message;
        console.error(`❌ [${key.toUpperCase()}]`, e.message);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  RESPONSE (gọn 7 field)
// ═══════════════════════════════════════════════════════════════════════════════
function buildResp(key) {
    const st = state[key];
    if (!st.latest || !st.pred) return null;
    const last = st.latest, p = st.pred;

    let duDoan = "CHỜ", tyLe = "--";
    if (p.prediction === "TAI") { duDoan = "TÀI"; tyLe = `${p.confidence}%`; }
    else if (p.prediction === "XIU") { duDoan = "XỈU"; tyLe = `${p.confidence}%`; }

    return {
        Id:          ADMIN,
        Phien_nay:   p.targetId || nextId(last.id),
        Du_doan:     duDoan,
        Ty_le:       tyLe,
        Phien_truoc: last.id_num,
        Xuc_xac:     last.dices?.length === 3 ? last.dices.join("-") : "—",
        Ket_qua:     last.r === "T" ? "TÀI" : "XỈU",
    };
}

const checkKey = q => q.key === VALID_KEY ? { valid: true } : { valid: false, error: `Sai key! Ib ${ADMIN}` };

// ═══════════════════════════════════════════════════════════════════════════════
//  SERVER
// ═══════════════════════════════════════════════════════════════════════════════
const app = fastify({ logger: false, disableRequestLogging: true });
await app.register(cors, { origin: "*" });

app.get("/", async () => ({
    status: "ok",
    admin: ADMIN,
    engine: `${defs.length} cầu + 16 mức bảng điểm`,
    hu:  { loaded: state.hu.sessions.length,  last_id: state.hu.lastId,  url: state.hu.activeUrl,  error: state.hu.lastError },
    md5: { loaded: state.md5.sessions.length, last_id: state.md5.lastId, url: state.md5.activeUrl, error: state.md5.lastError },
}));

app.get("/api/raw/:game", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const game = req.params.game === "md5" ? "md5" : "hu";
    const urls = game === "hu" ? HU_URLS : MD5_URLS;
    const results = [];
    for (const url of urls) {
        try {
            const json = await fetchJSON(url);
            const parsed = parseRows(json);
            results.push({
                url, status: "ok",
                raw_keys: Array.isArray(json) ? ["[array]"] : Object.keys(json || {}),
                raw_sample: JSON.stringify(json).slice(0, 500),
                parsed_count: parsed.length,
                parsed_sample: parsed[0] || null,
            });
        } catch (e) {
            results.push({ url, status: "error", error: e.message });
        }
    }
    return { game, results };
});

app.get("/api/taixiu/lc79", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const r = buildResp("hu");
    if (r) return r;
    return rep.status(503).send({
        error: "Đang tải dữ liệu HŨ...",
        debug: { loaded: state.hu.sessions.length, last_error: state.hu.lastError, hint: "Chạy /api/raw/hu để debug" },
    });
});

app.get("/api/taixiumd5/lc79", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const r = buildResp("md5");
    if (r) return r;
    return rep.status(503).send({
        error: "Đang tải dữ liệu MD5...",
        debug: { loaded: state.md5.sessions.length, last_error: state.md5.lastError, hint: "Chạy /api/raw/md5 để debug" },
    });
});

app.get("/api/debug/:loai", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const st = req.params.loai === "md5" ? state.md5 : state.hu;
    if (!st.latest || !st.pred) return rep.status(503).send({
        error: "Chưa đủ dữ liệu", loaded: st.sessions.length, url: st.activeUrl, last_error: st.lastError,
    });
    return {
        last: { id: st.latest.id_num, result: st.latest.r, dices: st.latest.dices, point: st.latest.point },
        prediction: {
            pred: st.pred.prediction,
            confidence: st.pred.confidence,
            method: st.pred.method,
        },
        cau_used: st.pred.cau?.active || null,
        diem_used: st.pred.diem,
        top_patterns: st.pred.cau?.patterns?.slice(0, 8) || [],
        url: st.activeUrl,
    };
});

app.get("/api/bang-diem", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    return BANG_DIEM;
});

app.get("/check-key", async req =>
    req.query.key === VALID_KEY
        ? { status: "success", message: "KEY HỢP LỆ", admin: ADMIN }
        : { status: "error", message: `Sai key! Ib ${ADMIN}` });

// ═══════════════════════════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════════════════════════
app.listen({ port: PORT, host: "0.0.0.0" })
    .then(() => {
        console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  🎲 TÀI XỈU LC79 — FULL ${defs.length} CẦU + BẢNG ĐIỂM                    ║
╠══════════════════════════════════════════════════════════════════════╣
║  🚀 Port: ${PORT}  🔑 ${VALID_KEY}  👤 ${ADMIN}
║
║  🧠 ${defs.length} cầu:
║     • Bệt 2-8 + tăng + chuẩn bị gãy (9)
║     • Cơ bản 1-1, 1-2, 2-1, 2-2, 3-3, 4-4 (6)
║     • Nhịp run-length 1-2-1 → 4-1-4 (15)
║     • Chu kỳ độ dài (4)
║     • Chuyển trạng thái (6)
║     • Markov ngữ cảnh 1-5 (5) + chuyển tiếp (2) + bậc 2-4 (3)
║     • Suffix tái diễn (1)
║     • Chu kỳ lag 2-9 (8)
║     • Lặp block 3-4, đảo, gương (4)
║     • Thống kê lệch TS, hồi quy, momentum (6)
║     • Chế độ entropy thấp/cao, đổi chế độ (4)
║     • Meta đồng thuận, xung đột, ổn định (7)
║
║  📊 Bảng điểm MD5 16 mức (X3 → T18)
║
║  🎯 Kết hợp: Đồng thuận +8%, Xung đột chọn bên mạnh
║
║  📌 HŨ : /api/taixiu/lc79?key=${VALID_KEY}
║  📌 MD5: /api/taixiumd5/lc79?key=${VALID_KEY}
║  🐞 Debug: /api/debug/hu?key=${VALID_KEY}
║  🔍 Raw: /api/raw/hu?key=${VALID_KEY}
║  📋 Bảng điểm: /api/bang-diem?key=${VALID_KEY}
╚══════════════════════════════════════════════════════════════════════╝
        `);

        setTimeout(() => {
            poll("hu").catch(() => {});
            poll("md5").catch(() => {});
        }, 100);

        setInterval(() => poll("hu").catch(() => {}),  POLL);
        setInterval(() => poll("md5").catch(() => {}), POLL);
    })
    .catch(err => {
        console.error("❌ Boot:", err.message);
        process.exit(1);
    });