// ═══════════════════════════════════════════════════════════════════════════════
//  TÀI XỈU LC79 — CẦU + ĐIỂM + 20 THUẬT TOÁN (ANTI-BIAS PRO)
//  72 cầu · 16 mức bảng điểm · 20 algos · Cân bằng · Wilson accuracy
// ═══════════════════════════════════════════════════════════════════════════════
import fastify from "fastify";
import cors from "@fastify/cors";

const PORT      = process.env.PORT || 3000;
const VALID_KEY = "Thien456";
const ADMIN     = "@ADMNLc79";

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
//  FETCH & PARSE
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
        try { return { url, json: await fetchJSON(url) }; }
        catch (e) { errors.push(`${url} → ${e.message}`); }
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
const alternating = a => a.length > 1 && a.slice(1).every((x, i) => x !== a[i]);
const runLens = a => runs(a).map(x => x.n);

function wilsonLower(wins, total, z = 1.96) {
    if (total === 0) return 0;
    const pHat = wins / total;
    const denom = 1 + z * z / total;
    const center = (pHat + z * z / (2 * total)) / denom;
    const margin = z * Math.sqrt(pHat * (1 - pHat) / total + z * z / (4 * total * total)) / denom;
    return Math.max(0, center - margin);
}

function bitsToNibbles(bits) {
    const pad = (4 - bits.length % 4) % 4;
    const padded = [...Array(pad).fill(0), ...bits];
    const nibbles = [];
    for (let i = 0; i < padded.length; i += 4) {
        nibbles.push(padded[i]*8 + padded[i+1]*4 + padded[i+2]*2 + padded[i+3]);
    }
    return nibbles;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  72 CẦU
// ═══════════════════════════════════════════════════════════════════════════════
const defs = [];
const add = (name, group, fn, min = 8) => defs.push({ name, group, fn, min });

// Bệt 2→8 + tăng + chuẩn bị gãy (9)
for (let n = 2; n <= 8; n++) add(`Cầu bệt ${n}`, "Bệt", a => { const r = suffix(a); return r && r.n >= n ? (r.v === "T" ? 1 : -1) * (0.55 + Math.min(0.25, (r.n - n) * 0.03)) : 0; }, n + 5);
add("Cầu bệt tăng tiếp diễn", "Bệt", a => { const r = suffix(a); return r && r.n >= 3 ? (r.v === "T" ? 1 : -1) * 0.72 : 0; }, 10);
add("Cầu bệt chuẩn bị gãy",   "Bệt", a => { const r = suffix(a); return r && r.n >= 4 ? (r.v === "T" ? -1 : 1) * 0.68 : 0; }, 12);

// Cơ bản (6)
add("Cầu 1-1", "Cầu 1-1", a => alternating(a) ? (a.at(-1) === "T" ? -1 : 1) * 0.86 : 0, 8);
add("Cầu 2-2", "Cầu nhịp", a => { const r = runs(a); if (r.length < 4) return 0; return r.slice(-4).map(x => x.n).join(",") === "2,2,2,2" ? (r.at(-1).v === "T" ? 1 : -1) * 0.82 : 0; }, 12);
add("Cầu 3-3", "Cầu nhịp", a => { const r = runs(a); return r.slice(-4).every(x => x.n === 3) ? (r.at(-1).v === "T" ? 1 : -1) * 0.82 : 0; }, 15);
add("Cầu 4-4", "Cầu nhịp", a => { const r = runs(a); return r.slice(-4).every(x => x.n === 4) ? (r.at(-1).v === "T" ? 1 : -1) * 0.82 : 0; }, 18);
add("Cầu 1-2", "Cầu nhịp", a => { const r = runs(a).slice(-6).map(x => x.n); return r.length >= 4 && r.slice(-4).join(",") === "1,2,1,2" ? (r.at(-1).v === "T" ? 1 : -1) * 0.8 : 0; }, 12);
add("Cầu 2-1", "Cầu nhịp", a => { const r = runs(a).slice(-6).map(x => x.n); return r.length >= 4 && r.slice(-4).join(",") === "2,1,2,1" ? (r.at(-1).v === "T" ? 1 : -1) * 0.8 : 0; }, 12);

// 15 cầu nhịp run-length
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

// Chu kỳ độ dài (4)
add("Cầu tăng dần độ bệt", "Chu kỳ", a => { const l = runLens(a).slice(-5); return l.length === 5 && l.every((v, i) => i === 0 || v > l[i-1]) ? (suffix(a).v === "T" ? 1 : -1) * 0.76 : 0; }, 20);
add("Cầu giảm dần độ bệt", "Chu kỳ", a => { const l = runLens(a).slice(-5); return l.length === 5 && l.every((v, i) => i === 0 || v < l[i-1]) ? (suffix(a).v === "T" ? 1 : -1) * 0.76 : 0; }, 20);
add("Cầu lặp độ dài", "Chu kỳ", a => { const l = runLens(a).slice(-6); return l.length === 6 && l[0] === l[2] && l[2] === l[4] && l[1] === l[3] && l[3] === l[5] ? (suffix(a).v === "T" ? 1 : -1) * 0.7 : 0; }, 24);
add("Cầu gương độ dài", "Chu kỳ", a => { const l = runLens(a).slice(-5); return l.length === 5 && l[0] === l[4] && l[1] === l[3] ? (suffix(a).v === "T" ? 1 : -1) * 0.7 : 0; }, 20);

// Chuyển trạng thái (6)
add("Cầu đổi nhịp sau bệt", "Chuyển trạng thái", a => { const r = runs(a); if (r.length < 3) return 0; const q = r.at(-2), z = r.at(-1); return q.n >= 3 && z.n <= 2 ? (z.v === "T" ? 1 : -1) * 0.65 : 0; }, 12);
add("Cầu phá bệt ngắn", "Chuyển trạng thái", a => { const r = runs(a); if (r.length < 3) return 0; const z = r.at(-1); return z.n === 1 ? (z.v === "T" ? 1 : -1) * 0.62 : 0; }, 10);
add("Cầu sau chuỗi 2", "Chuyển trạng thái", a => { const r = runs(a); return r.at(-1)?.n === 2 ? (r.at(-1).v === "T" ? 1 : -1) * 0.58 : 0; }, 10);
add("Cầu sau chuỗi 3", "Chuyển trạng thái", a => { const r = runs(a); return r.at(-1)?.n === 3 ? (r.at(-1).v === "T" ? 1 : -1) * 0.62 : 0; }, 12);
add("Cầu sau chuỗi 4+", "Chuyển trạng thái", a => { const r = runs(a); return r.at(-1)?.n >= 4 ? (r.at(-1).v === "T" ? -1 : 1) * 0.62 : 0; }, 14);
add("Cầu biến đổi trạng thái", "Chuyển trạng thái", a => { const r = runs(a); return r.length >= 2 && r.at(-1).n === 1 && r.at(-2).n >= 2 ? (r.at(-1).v === "T" ? 1 : -1) * 0.65 : 0; }, 10);

// Markov (10)
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

// Chu kỳ lag 2→9 (8)
for (let lag = 2; lag <= 9; lag++) add(`Cầu chu kỳ lag ${lag}`, "Chu kỳ", a => { if (a.length < lag * 3) return 0; let t = 0, x = 0; for (let i = lag; i < a.length; i++) if (a[i] === a[i - lag]) t++; else x++; return t + x >= 8 ? (t - x) / (t + x) * 0.72 : 0; }, lag * 2 + 4);

// Lặp block (4)
add("Cầu lặp block 3", "Lặp block", a => { if (a.length < 9) return 0; const z = a.slice(-6), p = z.slice(0, 3); return z.slice(3).join("") === p.join("") ? (p.at(-1) === "T" ? 1 : -1) * 0.72 : 0; }, 12);
add("Cầu lặp block 4", "Lặp block", a => { if (a.length < 12) return 0; const z = a.slice(-8), p = z.slice(0, 4); return z.slice(4).join("") === p.join("") ? (p.at(-1) === "T" ? 1 : -1) * 0.72 : 0; }, 15);
add("Cầu đảo block", "Lặp block", a => { if (a.length < 10) return 0; const z = a.slice(-6), p = z.slice(0, 3).map(opp).join(""); return z.slice(3).join("") === p ? (z.at(-1) === "T" ? 1 : -1) * 0.7 : 0; }, 12);
add("Cầu gương chuỗi", "Lặp block", a => { if (a.length < 8) return 0; const z = a.slice(-6), p = z.slice(0, 3).reverse().join(""); return z.slice(3).join("") === p ? (z.at(-1) === "T" ? 1 : -1) * 0.68 : 0; }, 12);

// Thống kê (6)
add("Cầu lệch tần suất 10", "Thống kê", a => { const p = freq(a, 10); return Math.abs(p - 0.5) >= 0.25 ? (p > 0.5 ? 1 : -1) * 0.62 : 0; }, 12);
add("Cầu lệch tần suất 20", "Thống kê", a => { const p = freq(a, 20); return Math.abs(p - 0.5) >= 0.18 ? (p > 0.5 ? 1 : -1) * 0.6 : 0; }, 20);
add("Cầu lệch tần suất 50", "Thống kê", a => { const p = freq(a, 50); return Math.abs(p - 0.5) >= 0.12 ? (p > 0.5 ? 1 : -1) * 0.56 : 0; }, 50);
add("Cầu hồi quy trung bình", "Thống kê", a => { const p = freq(a, 10); return p > 0.75 ? -0.58 : p < 0.25 ? 0.58 : 0; }, 12);
add("Cầu momentum", "Thống kê", a => { const p = freq(a, 8), q = freq(a, 24); return (p - q) * 1.5; }, 24);
add("Cầu anti-momentum", "Thống kê", a => { const p = freq(a, 8), q = freq(a, 24); return -(p - q) * 1.25; }, 24);

// Chế độ (4)
add("Cầu entropy thấp", "Chế độ", a => entropy(a.slice(-12)) < 0.75 ? (suffix(a).v === "T" ? 1 : -1) * 0.58 : 0, 15);
add("Cầu entropy cao", "Chế độ", a => entropy(a.slice(-12)) > 0.98 ? (suffix(a).v === "T" ? -1 : 1) * 0.42 : 0, 15);
add("Cầu đổi chế độ", "Chế độ", a => { if (a.length < 30) return 0; const e1 = entropy(a.slice(-10)), e2 = entropy(a.slice(-30, -10)); return Math.abs(e1 - e2) > 0.18 ? (freq(a, 10) > 0.5 ? 1 : -1) * 0.55 : 0; }, 30);
add("Cầu lệch cửa sổ", "Chế độ", a => { const p = freq(a, 5), q = freq(a, 30); return Math.abs(p - q) > 0.3 ? (p > 0.5 ? 1 : -1) * 0.5 : 0; }, 30);

// Meta (7)
add("Cầu đồng thuận 5-10", "Meta", a => { const p = freq(a, 5), q = freq(a, 10); return Math.sign(p - 0.5) === Math.sign(q - 0.5) && Math.abs(p - 0.5) > 0.1 ? (p > 0.5 ? 1 : -1) * 0.68 : 0; }, 10);
add("Cầu đồng thuận 10-20-50", "Meta", a => { const ps = [5, 10, 20].map(w => freq(a, w)); const sg = ps.map(p => Math.sign(p - 0.5)); return sg.every(x => x === sg[0]) && sg[0] ? (sg[0]) * 0.7 : 0; }, 20);
add("Cầu xung đột cửa sổ", "Meta", a => { const p = freq(a, 5), q = freq(a, 30); return Math.sign(p - 0.5) !== Math.sign(q - 0.5) ? (p > 0.5 ? 1 : -1) * 0.28 : 0; }, 30);
add("Cầu ổn định hướng", "Meta", a => { const w = [5, 8, 13, 21].map(n => freq(a, n) > 0.5 ? 1 : -1); return w.filter(x => x === w[0]).length >= 3 ? w[0] * 0.62 : 0; }, 21);
add("Cầu bền hướng", "Meta", a => { const z = a.slice(-8); return z.length === 8 && z.filter(x => x === z[0]).length >= 6 ? (z[0] === "T" ? 1 : -1) * 0.64 : 0; }, 12);
add("Cầu đảo có xác nhận", "Meta", a => { if (!alternating(a.slice(-8))) return 0; return a.at(-1) === "T" ? -0.7 : 0.7; }, 12);
add("Cầu tổng hợp cầu đang sống", "Meta", a => { const p = [freq(a, 5), freq(a, 10), freq(a, 20)]; const s = p.reduce((u, v) => u + (v - 0.5), 0) / p.length; return Math.abs(s) > 0.08 ? s * 1.3 : 0; }, 20);

if (defs.length < 72) throw new Error(`Registry chỉ có ${defs.length} cầu`);
defs.splice(72);
defs.forEach((d, i) => { d.patternLabel = d.name; d.name = "Cầu " + (i + 1); });

console.log(`[Engine] Đã nạp ${defs.length} cầu`);

// ═══════════════════════════════════════════════════════════════════════════════
//  CẦU ENGINE
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
        return out;
    }
    weightedVote(a) {
        const detected = this.detect(a);
        if (!detected.length) return { tScore: 0, xScore: 0, detected: [], groups: {} };

        const groups = new Map();
        for (const d of detected) {
            if (!groups.has(d.group)) groups.set(d.group, { t: 0, x: 0, n: 0, top: d });
            const g = groups.get(d.group);
            const w = d.confidence;
            if (d.signal > 0) g.t += w; else g.x += w;
            g.n++;
            if (d.confidence > g.top.confidence) g.top = d;
        }

        let tScore = 0, xScore = 0;
        const groupInfo = {};
        for (const [name, g] of groups) {
            const sum = g.t + g.x;
            if (sum === 0) continue;
            const capWeight = Math.min(2.5, Math.sqrt(g.n));
            const pT = g.t / sum;
            tScore += pT * capWeight;
            xScore += (1 - pT) * capWeight;
            groupInfo[name] = { pT: +pT.toFixed(2), weight: +capWeight.toFixed(2), count: g.n, top: g.top.name };
        }
        return { tScore, xScore, detected, groups: groupInfo };
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
//  20 THUẬT TOÁN PHÂN TÍCH (mỗi cái dự đoán NEXT bit thực sự)
// ═══════════════════════════════════════════════════════════════════════════════

// ── 1-4: Markov Order N ──
function markovN(bits, order) {
    const n = bits.length;
    if (n < order + 8) return null;
    const ctx = bits.slice(-order);
    let t = 0, x = 0;
    for (let i = order; i < n; i++) {
        let m = true;
        for (let j = 0; j < order; j++) if (bits[i - order + j] !== ctx[j]) { m = false; break; }
        if (m) { if (bits[i] === 1) t++; else x++; }
    }
    if (t + x < 3) return null;
    const pT = t / (t + x);
    return { pT, weight: Math.min(1.5 + (t+x) * 0.1, 3), name: `M${order}[${ctx.join("")}] n=${t+x}` };
}

// ── 5: Entropy ──
function algoEntropy(bits) {
    const n = bits.length;
    if (n < 20) return null;
    const w = Math.min(n, 20);
    const s = bits.slice(-w);
    const pT = s.reduce((a,b) => a+b, 0) / w;
    const H = (pT <= 0 || pT >= 1) ? 0 : -(pT * Math.log2(pT) + (1-pT) * Math.log2(1-pT));
    if (H > 0.85) return { pT: 1 - bits[n-1], weight: 1.2, name: `Entropy-H ${H.toFixed(2)} flip` };
    if (H < 0.7) {
        const majority = pT > 0.5 ? 1 : 0;
        return { pT: majority, weight: 2.5, name: `Entropy-L ${H.toFixed(2)} trend` };
    }
    return null;
}

// ── 6: Hex Context (8-bit as 2 hex digits) ──
function algoHexContext(bits) {
    const n = bits.length;
    if (n < 12) return null;
    const ctx = bits.slice(-8);
    let t = 0, x = 0;
    for (let i = 8; i < n; i++) {
        let m = true;
        for (let j = 0; j < 8; j++) if (bits[i - 8 + j] !== ctx[j]) { m = false; break; }
        if (m) { if (bits[i] === 1) t++; else x++; }
    }
    if (t + x < 2) return null;
    const nibbles = bitsToNibbles(ctx);
    const hexKey = nibbles.map(x => x.toString(16).toUpperCase()).join("");
    return { pT: t / (t + x), weight: Math.min(1.5 + (t+x) * 0.3, 3), name: `Hex${hexKey} n=${t+x}` };
}

// ── 7: Even/Odd position parity ──
function algoEvenOdd(bits) {
    const n = bits.length;
    if (n < 10) return null;
    const isNextEven = n % 2 === 0;
    let tEven = 0, nEven = 0, tOdd = 0, nOdd = 0;
    for (let i = 0; i < n; i++) {
        if (i % 2 === 0) { nEven++; if (bits[i] === 1) tEven++; }
        else { nOdd++; if (bits[i] === 1) tOdd++; }
    }
    const evenRate = nEven ? tEven / nEven : 0.5;
    const oddRate = nOdd ? tOdd / nOdd : 0.5;
    const predRate = isNextEven ? evenRate : oddRate;
    if (Math.abs(predRate - 0.5) < 0.08) return null;
    return { pT: predRate, weight: Math.min(Math.abs(predRate - 0.5) * 6, 2.5), name: `EvenOdd ${isNextEven?'E':'O'} ${(predRate*100).toFixed(0)}%` };
}

// ── 8: Bit Density contrarian ──
function algoBitDensity(bits) {
    const n = bits.length;
    if (n < 12) return null;
    const w = Math.min(n, 12);
    const p = bits.slice(-w).reduce((a,b) => a+b, 0) / w;
    if (p > 0.7) return { pT: 0.3, weight: Math.min((p - 0.5) * 5, 2.5), name: `BitDen ${(p*100).toFixed(0)}% flip` };
    if (p < 0.3) return { pT: 0.7, weight: Math.min((0.5 - p) * 5, 2.5), name: `BitDen ${(p*100).toFixed(0)}% flip` };
    return null;
}

// ── 9: Wave Trend ──
function algoWaveTrend(bits) {
    const n = bits.length;
    if (n < 8) return null;
    const k = Math.min(n, 8);
    const s = bits.slice(-k);
    let up = 0, down = 0;
    for (let i = 1; i < s.length; i++) {
        if (s[i] > s[i-1]) up++;
        else if (s[i] < s[i-1]) down++;
    }
    const diff = up - down;
    if (Math.abs(diff) < 1) return null;
    return { pT: diff > 0 ? 0.65 : 0.35, weight: Math.min(Math.abs(diff) * 0.6, 2), name: `Wave ${diff > 0 ? '↑' : '↓'}${Math.abs(diff)}` };
}

// ── 10: Last Block ──
function algoLastBlock(bits) {
    const n = bits.length;
    if (n < 8) return null;
    const k = Math.min(n, 8);
    const p = bits.slice(-k).reduce((a,b) => a+b, 0) / k;
    if (Math.abs(p - 0.5) < 0.15) return null;
    return { pT: p, weight: Math.min(Math.abs(p - 0.5) * 4, 2), name: `LastBlk ${(p*100).toFixed(0)}%` };
}

// ── 11: First Block ──
function algoFirstBlock(bits) {
    const n = bits.length;
    if (n < 16) return null;
    const k = Math.min(Math.floor(n/2), 8);
    const p = bits.slice(0, k).reduce((a,b) => a+b, 0) / k;
    if (Math.abs(p - 0.5) < 0.15) return null;
    return { pT: 1 - p, weight: Math.min(Math.abs(p - 0.5) * 3, 1.5), name: `FirstBlk ${(p*100).toFixed(0)}% flip` };
}

// ── 12: Segment Entropy ──
function algoSegmentEntropy(bits) {
    const n = bits.length;
    if (n < 12) return null;
    const half = Math.floor(n / 2);
    const seg1 = bits.slice(half, n);
    const seg2 = bits.slice(0, half);
    const p1 = seg1.reduce((a,b) => a+b, 0) / seg1.length;
    const p2 = seg2.reduce((a,b) => a+b, 0) / seg2.length;
    const trend = p1 - p2;
    if (Math.abs(trend) < 0.15) return null;
    return { pT: trend > 0 ? 0.6 : 0.4, weight: Math.min(Math.abs(trend) * 4, 2), name: `SegEnt ${trend > 0 ? '↑' : '↓'}` };
}

// ── 13: Rolling Score (sum parity) ──
function algoRollingScore(bits) {
    const n = bits.length;
    if (n < 8) return null;
    let sum = 0;
    for (const b of bits) sum += b;
    return { pT: sum % 2 === 0 ? 0.4 : 0.6, weight: 1.0, name: `Rolling ${sum}%2=${sum%2}` };
}

// ── 14: High Nibble ──
function algoHighNibble(bits) {
    const n = bits.length;
    if (n < 12) return null;
    const nibbles = bitsToNibbles(bits);
    if (nibbles.length < 3) return null;
    const recent = nibbles.slice(-5);
    const highCount = recent.filter(x => x >= 8).length;
    const ratio = highCount / recent.length;
    if (ratio >= 0.7) return { pT: 0.35, weight: 1.5, name: `HighNib ${highCount}/${recent.length} flip` };
    if (ratio <= 0.3) return { pT: 0.65, weight: 1.5, name: `HighNib ${highCount}/${recent.length} flip` };
    return null;
}

// ── 15: Hybrid Fusion ──
function algoHybridFusion(bits) {
    const n = bits.length;
    if (n < 10) return null;
    const w = Math.min(n, 10);
    const s = bits.slice(-w);
    const avg = s.reduce((a,b) => a+b, 0) / w;
    let wave = 0;
    for (let i = 1; i < s.length; i++) {
        if (s[i] > s[i-1]) wave++;
        else if (s[i] < s[i-1]) wave--;
    }
    const score = avg + wave * 0.1;
    if (Math.abs(score - 0.5) < 0.1) return null;
    return { pT: score > 0.5 ? 0.65 : 0.35, weight: Math.min(Math.abs(score - 0.5) * 4, 2.2), name: `Hybrid ${score.toFixed(2)}` };
}

// ── 16: Streak Follow ──
function algoStreakFollow(bits) {
    const n = bits.length;
    if (n < 6) return null;
    let run = 1;
    for (let i = n - 2; i >= 0; i--) {
        if (bits[i] === bits[n-1]) run++;
        else break;
    }
    if (run < 2 || run > 4) return null;
    return { pT: bits[n-1], weight: 1.0 + run * 0.2, name: `StFollow ${run}` };
}

// ── 17: Streak Break ──
function algoStreakBreak(bits) {
    const n = bits.length;
    if (n < 8) return null;
    let run = 1;
    for (let i = n - 2; i >= 0; i--) {
        if (bits[i] === bits[n-1]) run++;
        else break;
    }
    if (run < 4) return null;
    return { pT: 1 - bits[n-1], weight: Math.min(1.8 + (run - 4) * 0.4, 3.5), name: `StBreak ${run}` };
}

// ── 18: Transition Matrix ──
function algoTransition(bits) {
    const n = bits.length;
    if (n < 10) return null;
    let tt = 0, tx = 0, xt = 0, xx = 0;
    for (let i = 1; i < n; i++) {
        if (bits[i-1] === 1 && bits[i] === 1) tt++;
        else if (bits[i-1] === 1) tx++;
        else if (bits[i] === 1) xt++;
        else xx++;
    }
    const last = bits[n-1];
    const stay = last === 1 ? tt : xx;
    const flip = last === 1 ? tx : xt;
    const tot = stay + flip;
    if (tot < 5) return null;
    const pStay = stay / tot;
    const pred = pStay >= 0.5 ? last : (1 - last);
    return { pT: pred === 1 ? pStay : (1 - pStay), weight: Math.min(Math.abs(pStay - 0.5) * 5, 2.5), name: `Trans ${(pStay*100).toFixed(0)}% stay` };
}

// ── 19: Momentum ──
function algoMomentum(bits) {
    const n = bits.length;
    if (n < 20) return null;
    const shortP = bits.slice(-5).reduce((a,b) => a+b, 0) / 5;
    const longP = bits.slice(-20).reduce((a,b) => a+b, 0) / 20;
    const diff = shortP - longP;
    if (Math.abs(diff) < 0.15) return null;
    return { pT: diff > 0 ? 1 : 0, weight: Math.min(Math.abs(diff) * 5, 2.5), name: `Mom ${diff > 0 ? '↑' : '↓'}${(Math.abs(diff)*100).toFixed(0)}%` };
}

// ── 20: Anti-Momentum ──
function algoAntiMomentum(bits) {
    const n = bits.length;
    if (n < 20) return null;
    const shortP = bits.slice(-5).reduce((a,b) => a+b, 0) / 5;
    const longP = bits.slice(-20).reduce((a,b) => a+b, 0) / 20;
    const diff = shortP - longP;
    if (Math.abs(diff) < 0.15) return null;
    return { pT: diff > 0 ? 0 : 1, weight: Math.min(Math.abs(diff) * 4, 2), name: `AntiMom ${diff > 0 ? '↓' : '↑'}` };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  20 ALGO REGISTRY
// ═══════════════════════════════════════════════════════════════════════════════
const ALGOS = [
    { name: "Markov1", fn: b => markovN(b, 1) },
    { name: "Markov2", fn: b => markovN(b, 2) },
    { name: "Markov3", fn: b => markovN(b, 3) },
    { name: "Markov4", fn: b => markovN(b, 4) },
    { name: "Entropy",  fn: algoEntropy },
    { name: "HexCtx",   fn: algoHexContext },
    { name: "EvenOdd",  fn: algoEvenOdd },
    { name: "BitDen",   fn: algoBitDensity },
    { name: "Wave",     fn: algoWaveTrend },
    { name: "LastBlk",  fn: algoLastBlock },
    { name: "FirstBlk", fn: algoFirstBlock },
    { name: "SegEnt",   fn: algoSegmentEntropy },
    { name: "Rolling",  fn: algoRollingScore },
    { name: "HighNib",  fn: algoHighNibble },
    { name: "Hybrid",   fn: algoHybridFusion },
    { name: "StFollow", fn: algoStreakFollow },
    { name: "StBreak",  fn: algoStreakBreak },
    { name: "Trans",    fn: algoTransition },
    { name: "Mom",      fn: algoMomentum },
    { name: "AntiMom",  fn: algoAntiMomentum },
];

// ═══════════════════════════════════════════════════════════════════════════════
//  PREDICT — Cầu + Algo + Điểm + Anti-bias
// ═══════════════════════════════════════════════════════════════════════════════
function predict(engine, sessions, predictions) {
    const seq = sessions.map(s => s.r);
    const last = sessions[sessions.length - 1];
    const bits = seq.map(x => x === "T" ? 1 : 0);
    const diem = BANG_DIEM[last.point] || null;

    // ── 1. Cầu vote (group-capped) ──
    const cauVote = engine.weightedVote(seq);
    let cauT = cauVote.tScore;
    let cauX = cauVote.xScore;
    // Cap cầu total contribution
    const cauSum = cauT + cauX;
    if (cauSum > 6.0) {
        const scale = 6.0 / cauSum;
        cauT *= scale;
        cauX *= scale;
    }

    // ── 2. Algo votes ──
    const algoSignals = [];
    for (const algo of ALGOS) {
        try {
            const r = algo.fn(bits);
            if (r && r.pT !== undefined) algoSignals.push({ ...r, algo: algo.name });
        } catch (e) {}
    }
    let algoT = 0, algoX = 0;
    for (const s of algoSignals) {
        algoT += s.pT * s.weight;
        algoX += (1 - s.pT) * s.weight;
    }
    // Cap algo total contribution
    const algoSum = algoT + algoX;
    if (algoSum > 8.0) {
        const scale = 8.0 / algoSum;
        algoT *= scale;
        algoX *= scale;
    }

    // ── 3. Combine với prior 2.5 ──
    let tScore = 2.5 + cauT + algoT;
    let xScore = 2.5 + cauX + algoX;

    // ── 4. Điểm (weighted by conf) ──
    if (diem) {
        const dw = diem.conf / 40;
        if (diem.pred === "T") tScore += dw;
        else xScore += dw;
    }

    let pT = tScore / (tScore + xScore);

    // ══════════════════════════════════════════════════════════════════════
    //  ANTI-BIAS (chống toàn tài / toàn xỉu)
    // ══════════════════════════════════════════════════════════════════════
    const recentPreds = predictions.slice(-20).map(p => p.prediction);

    // (a) Nếu 4+/5 gần nhất cùng hướng → nudge đảo
    const last5 = recentPreds.slice(-5);
    const t5 = last5.filter(p => p === "TAI").length;
    const x5 = last5.length - t5;
    if (t5 >= 4) pT -= 0.10;
    else if (x5 >= 4) pT += 0.10;

    // (b) Nếu 8+/10 cùng hướng → nudge mạnh
    const last10 = recentPreds.slice(-10);
    const t10 = last10.filter(p => p === "TAI").length;
    const x10 = last10.length - t10;
    if (t10 >= 8) pT -= 0.08;
    else if (x10 >= 8) pT += 0.08;

    // (c) Consecutive streak penalty
    let consecutive = 0;
    if (recentPreds.length > 0) {
        const lastDir = recentPreds[recentPreds.length - 1];
        for (let i = recentPreds.length - 1; i >= 0; i--) {
            if (recentPreds[i] === lastDir) consecutive++;
            else break;
        }
        if (consecutive >= 3 && lastDir === "TAI") pT -= 0.06;
        if (consecutive >= 3 && lastDir === "XIU") pT += 0.06;
    }

    // (d) Clamp
    pT = Math.max(0.15, Math.min(0.85, pT));

    const prediction = pT >= 0.5 ? "TAI" : "XIU";
    let confidence = Math.round(50 + Math.abs(pT - 0.5) * 90);

    // (e) Confidence decay khi same prediction lặp lại
    let sameStreak = 0;
    for (let i = recentPreds.length - 1; i >= 0; i--) {
        if (recentPreds[i] === prediction) sameStreak++;
        else break;
    }
    if (sameStreak >= 2) confidence -= (sameStreak - 1) * 4;

    // (f) Calibration từ accuracy thực
    const scored = predictions.filter(p => p.correct !== undefined);
    if (scored.length >= 20) {
        const recent = scored.slice(-50);
        const wins = recent.filter(p => p.correct).length;
        const acc = wins / recent.length;
        if (acc < 0.45) confidence = Math.round(confidence * 0.6);
        else if (acc < 0.5) confidence = Math.round(confidence * 0.85);
        else if (acc > 0.6) confidence = Math.min(95, Math.round(confidence * 1.05));
    }

    // ── Bias note ──
    let biasNote = "";
    if (t10 >= 8) biasNote = ` ⚠️ Bias TÀI ${t10}/10`;
    else if (x10 >= 8) biasNote = ` ⚠️ Bias XỈU ${x10}/10`;
    else if (consecutive >= 3) biasNote = ` ⚠️ Chuỗi ${consecutive}`;

    return {
        prediction,
        confidence: Math.max(50, Math.min(92, confidence)),
        pT,
        cauT, cauX, groups: cauVote.groups,
        algoT, algoX, algoSignals,
        diem,
        detectedCount: cauVote.detected.length,
        algoCount: algoSignals.length,
        biasNote,
        method: `${cauVote.detected.length} cầu + ${algoSignals.length} algo` +
                (diem ? ` + điểm ${last.point}(${diem.conf}%)` : "") +
                biasNote,
        topPatterns: cauVote.detected.sort((a, b) => b.confidence - a.confidence).slice(0, 8),
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════════════════════════
function makeState() {
    return {
        sessions: [], lastId: null, engine: new CauEngine(),
        pred: null, latest: null, pending: null, seen: new Set(),
        predictions: [],
        activeUrl: null, lastError: null,
    };
}

const state = { md5: makeState(), hu: makeState() };
const nextId = id => { const n = Number(id); return Number.isFinite(n) ? String(n + 1) : id + "+"; };

function update(key, arr, activeUrl) {
    const st = state[key];
    st.activeUrl = activeUrl;
    if (!arr.length) return;
    const latest = arr[arr.length - 1];

    // Score pending
    if (st.pending) {
        const match = st.sessions.find(s => s.id_num === st.pending.targetId);
        if (match && !st.predictions.some(p => p.targetId === match.id_num)) {
            const actual = match.r === "T" ? "TAI" : "XIU";
            const correct = st.pending.prediction === actual;
            st.predictions.push({
                targetId: match.id_num,
                prediction: st.pending.prediction,
                confidence: st.pending.confidence,
                actual, correct, method: st.pending.method,
            });
            if (st.predictions.length > 500) st.predictions.shift();
            if (st.pending.cau) st.engine.learn(st.pending.cau, actual);
            console.log(`[${key.toUpperCase()}] Score #${match.id_num}: ${actual} ${correct ? "✅" : "❌"}`);
            st.pending = null;
        } else if (!match && latest.id_num > st.pending.targetId) {
            st.pending = null;
        }
    }

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
            if (st.pending && r.id_num === st.pending.targetId) {
                const actual = r.r === "T" ? "TAI" : "XIU";
                const correct = st.pending.prediction === actual;
                st.predictions.push({
                    targetId: r.id_num, prediction: st.pending.prediction,
                    confidence: st.pending.confidence, actual, correct, method: st.pending.method,
                });
                if (st.predictions.length > 500) st.predictions.shift();
                if (st.pending.cau) st.engine.learn(st.pending.cau, actual);
                st.pending = null;
                console.log(`[${key.toUpperCase()}] #${r.id_num}: ${actual} ${correct ? "✅" : "❌"}`);
            } else if (st.pending && r.id_num > st.pending.targetId) {
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
    const pred = predict(st.engine, recent, st.predictions);
    const targetId = nextId(st.latest.id);
    st.pred = { ...pred, targetId };

    st.pending = {
        targetId,
        prediction: pred.prediction,
        confidence: pred.confidence,
        method: pred.method,
        cau: { result: pred.prediction, patterns: pred.topPatterns },
    };
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
//  RESPONSE
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
        Phien_nay:   p.targetId,
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
    engine: `${defs.length} cầu + ${ALGOS.length} algo + bảng điểm + anti-bias`,
    hu:  { loaded: state.hu.sessions.length, last_id: state.hu.lastId, predictions: state.hu.predictions.length, url: state.hu.activeUrl, error: state.hu.lastError },
    md5: { loaded: state.md5.sessions.length, last_id: state.md5.lastId, predictions: state.md5.predictions.length, url: state.md5.activeUrl, error: state.md5.lastError },
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
    return rep.status(503).send({ error: "Đang tải dữ liệu HŨ...", debug: { loaded: state.hu.sessions.length, last_error: state.hu.lastError } });
});

app.get("/api/taixiumd5/lc79", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const r = buildResp("md5");
    if (r) return r;
    return rep.status(503).send({ error: "Đang tải dữ liệu MD5...", debug: { loaded: state.md5.sessions.length, last_error: state.md5.lastError } });
});

app.get("/api/debug/:loai", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const st = req.params.loai === "md5" ? state.md5 : state.hu;
    if (!st.latest || !st.pred) return rep.status(503).send({ error: "Chưa đủ dữ liệu", loaded: st.sessions.length });

    const scored = st.predictions.filter(p => p.correct !== undefined);
    const wins = scored.filter(p => p.correct).length;
    const recent20 = scored.slice(-20);
    const wins20 = recent20.filter(p => p.correct).length;

    return {
        last: { id: st.latest.id_num, result: st.latest.r, dices: st.latest.dices, point: st.latest.point },
        prediction: {
            pred: st.pred.prediction,
            confidence: st.pred.confidence,
            pT: +(st.pred.pT * 100).toFixed(2),
            method: st.pred.method,
            bias_note: st.pred.biasNote || null,
        },
        cau_groups: st.pred.groups,
        cau_score: { t: +st.pred.cauT.toFixed(2), x: +st.pred.cauX.toFixed(2) },
        algo_score: { t: +st.pred.algoT.toFixed(2), x: +st.pred.algoX.toFixed(2) },
        algo_signals: st.pred.algoSignals.map(s => ({
            name: s.algo, pT: +(s.pT * 100).toFixed(1), weight: +s.weight.toFixed(2), label: s.name,
        })),
        diem_used: st.pred.diem,
        top_patterns: st.pred.topPatterns?.slice(0, 8),
        accuracy: {
            total: scored.length, wins, losses: scored.length - wins,
            rate: scored.length ? (wins / scored.length * 100).toFixed(1) + "%" : "—",
            wilson_lb: scored.length ? (wilsonLower(wins, scored.length) * 100).toFixed(1) + "%" : "—",
            recent20: recent20.length ? (wins20 / recent20.length * 100).toFixed(0) + "%" : "—",
        },
        recent_predictions: st.predictions.slice(-15).map(p => ({
            id: p.targetId, pred: p.prediction, actual: p.actual, correct: p.correct, conf: p.confidence,
        })),
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
║  🎲 TÀI XỈU LC79 — 72 CẦU + 20 ALGO + BẢNG ĐIỂM + ANTI-BIAS          ║
╠══════════════════════════════════════════════════════════════════════╣
║  🚀 Port: ${PORT}  🔑 ${VALID_KEY}  👤 ${ADMIN}
║
║  🧠 72 CẦU · 20 ALGO · 16 MỨC ĐIỂM
║
║  20 ALGO:
║     1. Markov1    6. HexContext  11. FirstBlock  16. StreakFollow
║     2. Markov2    7. EvenOdd     12. SegmentEnt  17. StreakBreak
║     3. Markov3    8. BitDensity  13. Rolling     18. Transition
║     4. Markov4    9. WaveTrend   14. HighNibble  19. Momentum
║     5. Entropy   10. LastBlock   15. Hybrid      20. AntiMomentum
║
║  🛡  ANTI-BIAS (chống toàn tài/xỉu):
║     • Prior 2.5 mỗi bên
║     • Cap cầu ≤ 6, algo ≤ 8
║     • Nudge đảo 10% khi 4+/5 lặp
║     • Nudge đảo 8% khi 8+/10 lặp
║     • Penalty chuỗi ≥ 3 (-6%)
║     • Confidence decay khi same pred
║     • Calibration từ accuracy thực
║
║  📌 HŨ : /api/taixiu/lc79?key=${VALID_KEY}
║  📌 MD5: /api/taixiumd5/lc79?key=${VALID_KEY}
║  🐞 Debug: /api/debug/hu?key=${VALID_KEY}
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