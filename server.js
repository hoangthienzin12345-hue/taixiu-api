// ═══════════════════════════════════════════════════════════════════════════════
//  TÀI XỈU LC79 — BẢNG ĐIỂM + 72 CẦU
// ═══════════════════════════════════════════════════════════════════════════════
import fastify from "fastify";
import cors from "@fastify/cors";

const PORT      = process.env.PORT || 3000;
const VALID_KEY = "Thien456";
const ADMIN     = "@ADMNLc79";

const API = {
    md5: "https://wtxmd52.tele68.com/v1/txmd5/sessions",
    hu:  "https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5",
};
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
//  FETCH
// ═══════════════════════════════════════════════════════════════════════════════
async function fetchJSON(url, timeoutMs = 8000, retries = 2) {
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
            await new Promise(r => setTimeout(r, 700 * (a + 1)));
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PARSE
// ═══════════════════════════════════════════════════════════════════════════════
function parseRows(json) {
    const a = Array.isArray(json) ? json : (json?.list || json?.data || json?.sessions || []);
    return a.map(x => {
        const idNum = parseInt(String(x.id ?? x._id ?? x.sessionId ?? "").replace(/\D/g, ""));
        const point = Number(x.point ?? x.total ?? 0);
        const raw = String(x.resultTruyenThong ?? x.result ?? x.resultName ?? x.type ?? "").toUpperCase();
        let r = null;
        if (raw.includes("TAI") || raw.includes("TÀI")) r = "T";
        else if (raw.includes("XIU") || raw.includes("XỈU")) r = "X";
        else if (point > 0) r = point >= 11 ? "T" : "X";
        return {
            id: String(x.id ?? x._id ?? x.sessionId ?? ""),
            id_num: idNum,
            r,
            dices: x.dices || x.dice || [],
            point,
        };
    }).filter(x => x.id && x.r && x.id_num > 0)
      .sort((a, b) => a.id_num - b.id_num);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PRIMITIVES
// ═══════════════════════════════════════════════════════════════════════════════
const opp = x => x === "T" ? "X" : "T";
const runs = a => { const out = []; for (const x of a) { if (!out.length || out.at(-1).v !== x) out.push({ v: x, n: 1 }); else out.at(-1).n++; } return out; };
const suffix = a => runs(a).at(-1);
const entropy = a => { if (!a.length) return 1; const t = a.filter(x => x === "T").length / a.length; if (t <= 0 || t >= 1) return 0; return -(t * Math.log2(t) + (1 - t) * Math.log2(1 - t)); };
const freq = (a, w = 20) => { a = a.slice(-w); return a.length ? a.filter(x => x === "T").length / a.length : 0.5; };
const trans = a => { let tt = 0, tx = 0, xt = 0, xx = 0; for (let i = 1; i < a.length; i++) { if (a[i-1] === "T" && a[i] === "T") tt++; else if (a[i-1] === "T") tx++; else if (a[i] === "T") xt++; else xx++; } return { tt, tx, xt, xx }; };
const predictTrans = a => { const q = trans(a), last = a.at(-1); if (last === "T") { const n = q.tt + q.tx; return n ? (q.tt/n - 0.5) * 2 : 0; } const n = q.xt + q.xx; return n ? (q.xt/n - 0.5) * 2 : 0; };
const alternating = a => a.length > 1 && a.slice(1).every((x, i) => x !== a[i]);
const runLens = a => runs(a).map(x => x.n);

// ═══════════════════════════════════════════════════════════════════════════════
//  72 CẦU
// ═══════════════════════════════════════════════════════════════════════════════
const defs = [];
const add  = (name, group, fn, min = 8) => defs.push({ name, group, fn, min });

// ── Bệt ──
for (let n = 2; n <= 8; n++) add(`Cầu bệt ${n}`, "Bệt", a => {
    const r = suffix(a);
    return r && r.n >= n ? (r.v === "T" ? 1 : -1) * (0.55 + Math.min(0.25, (r.n - n) * 0.03)) : 0;
}, n + 5);
add("Cầu bệt tăng tiếp diễn", "Bệt", a => { const r = suffix(a); return r && r.n >= 3 ? (r.v === "T" ? 1 : -1) * 0.72 : 0; }, 10);
add("Cầu bệt chuẩn bị gãy",   "Bệt", a => { const r = suffix(a); return r && r.n >= 4 ? (r.v === "T" ? -1 : 1) * 0.68 : 0; }, 12);

// ── Cầu cơ bản ──
add("Cầu 1-1", "Cầu 1-1", a => alternating(a) ? (a.at(-1) === "T" ? -1 : 1) * 0.86 : 0, 8);
add("Cầu 2-2", "Cầu nhịp", a => { const r = runs(a); if (r.length < 4) return 0; return r.slice(-4).map(x => x.n).join(",") === "2,2,2,2" ? (r.at(-1).v === "T" ? 1 : -1) * 0.82 : 0; }, 12);
add("Cầu 3-3", "Cầu nhịp", a => { const r = runs(a); return r.slice(-4).every(x => x.n === 3) ? (r.at(-1).v === "T" ? 1 : -1) * 0.82 : 0; }, 15);
add("Cầu 4-4", "Cầu nhịp", a => { const r = runs(a); return r.slice(-4).every(x => x.n === 4) ? (r.at(-1).v === "T" ? 1 : -1) * 0.82 : 0; }, 18);
add("Cầu 1-2", "Cầu nhịp", a => { const r = runs(a).slice(-6).map(x => x.n); return r.length >= 4 && r.slice(-4).join(",") === "1,2,1,2" ? (r.at(-1).v === "T" ? 1 : -1) * 0.8 : 0; }, 12);
add("Cầu 2-1", "Cầu nhịp", a => { const r = runs(a).slice(-6).map(x => x.n); return r.length >= 4 && r.slice(-4).join(",") === "2,1,2,1" ? (r.at(-1).v === "T" ? 1 : -1) * 0.8 : 0; }, 12);

// ── Nhịp run-length ──
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

// ── Chuyển trạng thái ──
add("Cầu đổi nhịp sau bệt", "Chuyển trạng thái", a => { const r = runs(a); if (r.length < 3) return 0; const q = r.at(-2), z = r.at(-1); return q.n >= 3 && z.n <= 2 ? (z.v === "T" ? 1 : -1) * 0.65 : 0; }, 12);
add("Cầu phá bệt ngắn", "Chuyển trạng thái", a => { const r = runs(a); if (r.length < 3) return 0; const z = r.at(-1); return z.n === 1 ? (z.v === "T" ? 1 : -1) * 0.62 : 0; }, 10);
add("Cầu sau chuỗi 2", "Chuyển trạng thái", a => { const r = runs(a); return r.at(-1)?.n === 2 ? (r.at(-1).v === "T" ? 1 : -1) * 0.58 : 0; }, 10);
add("Cầu sau chuỗi 3", "Chuyển trạng thái", a => { const r = runs(a); return r.at(-1)?.n === 3 ? (r.at(-1).v === "T" ? 1 : -1) * 0.62 : 0; }, 12);
add("Cầu sau chuỗi 4+", "Chuyển trạng thái", a => { const r = runs(a); return r.at(-1)?.n >= 4 ? (r.at(-1).v === "T" ? -1 : 1) * 0.62 : 0; }, 14);
add("Cầu biến đổi trạng thái", "Chuyển trạng thái", a => { const r = runs(a); return r.length >= 2 && r.at(-1).n === 1 && r.at(-2).n >= 2 ? (r.at(-1).v === "T" ? 1 : -1) * 0.65 : 0; }, 10);

// ── Markov ngữ cảnh ──
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

// ── Chu kỳ lag ──
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
console.log(`[Engine] Đã nạp ${defs.length} cầu`);

// ═══════════════════════════════════════════════════════════════════════════════
//  CẦU ENGINE — detect + group + vote
// ═══════════════════════════════════════════════════════════════════════════════
class CauEngine {
    constructor() {
        this.stats = new Map(defs.map(d => [d.name, { n: 0, w: 0 }]));
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
    choose(a) {
        const ds = this.detect(a);
        if (!ds.length) return { ready: false };
        const grouped = new Map();
        for (const d of ds) { if (!grouped.has(d.group)) grouped.set(d.group, []); grouped.get(d.group).push(d); }
        const candidates = [];
        for (const [group, arr] of grouped) {
            const s = arr.reduce((u, x) => u + x.signal * x.confidence, 0) / arr.reduce((u, x) => u + x.confidence, 0);
            if (Math.abs(s) >= 0.20) candidates.push({ group, score: s, top: arr[0] });
        }
        candidates.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
        if (!candidates.length) return { ready: false };
        const best = candidates[0];
        const corr = candidates.filter(x => Math.sign(x.score) === Math.sign(best.score)).length;
        const opp  = candidates.filter(x => Math.sign(x.score) !== Math.sign(best.score)).length;
        const conf = Math.min(0.86, Math.max(0.5, 0.52 + Math.abs(best.score) * 0.22 + Math.min(0.12, corr * 0.025) - Math.min(0.10, opp * 0.02)));
        const side = best.score > 0 ? "T" : "X";
        return {
            ready: true,
            result: side === "T" ? "TAI" : "XIU",
            confidence: Math.round(conf * 100),
            active: best.top.name,
            side,
        };
    }
    learn(target, result) {
        if (!target || !result) return;
        const hit = target.result === result;
        for (const p of target.patterns) {
            const st = this.stats.get(p.name);
            if (!st) continue;
            st.n++;
            const pred = p.signal > 0 ? "TAI" : "XIU";
            if (pred === result && hit) st.w++;
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  COMBINED — Cầu + Bảng điểm
// ═══════════════════════════════════════════════════════════════════════════════
function combinedPredict(engine, sessions) {
    const seq = sessions.map(s => s.r);
    const cau = engine.choose(seq);
    const last = sessions[sessions.length - 1];
    const diem = BANG_DIEM[last.point] || null;

    // Cả 2 cùng hướng → tăng conf
    if (cau.ready && diem) {
        if (cau.side === diem.pred) {
            const conf = Math.min(95, Math.round((cau.confidence + diem.conf) / 2) + 8);
            return {
                prediction: cau.result,
                confidence: conf,
                method: `✅ ĐỒNG THUẬN · Cầu ${cau.active} (${cau.confidence}%) + Điểm ${last.point} (${diem.conf}%)`,
                cau, diem,
            };
        }
        // Xung đột → chọn bên conf cao hơn
        if (cau.confidence >= diem.conf + 5) {
            return {
                prediction: cau.result,
                confidence: Math.max(55, cau.confidence - 8),
                method: `⚔️ CẦU thắng · ${cau.confidence}% vs ${diem.conf}%`,
                cau, diem,
            };
        }
        if (diem.conf >= cau.confidence + 5) {
            return {
                prediction: diem.pred === "T" ? "TAI" : "XIU",
                confidence: Math.max(55, diem.conf - 5),
                method: `⚔️ ĐIỂM thắng · ${diem.conf}% vs ${cau.confidence}%`,
                cau, diem,
            };
        }
        // Cân bằng → ưu tiên cầu
        return {
            prediction: cau.result,
            confidence: Math.max(52, Math.round((cau.confidence + diem.conf) / 2) - 5),
            method: `⚖️ Cân bằng → ưu tiên cầu (${cau.active})`,
            cau, diem,
        };
    }

    // Chỉ có cầu
    if (cau.ready) {
        return {
            prediction: cau.result,
            confidence: cau.confidence,
            method: `🎯 Chỉ cầu · ${cau.active} (${cau.confidence}%)`,
            cau, diem: null,
        };
    }

    // Chỉ có điểm
    if (diem) {
        return {
            prediction: diem.pred === "T" ? "TAI" : "XIU",
            confidence: diem.conf,
            method: `📊 Chỉ điểm · ${diem.note}`,
            cau: null, diem,
        };
    }

    // Không có tín hiệu
    return {
        prediction: "CHỜ",
        confidence: 0,
        method: "Không có tín hiệu",
        cau: null, diem: null,
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════════════════════════
const state = {
    md5: { sessions: [], lastId: null, engine: new CauEngine(), pred: null, latest: null, pending: null },
    hu:  { sessions: [], lastId: null, engine: new CauEngine(), pred: null, latest: null, pending: null },
};

function update(key, arr) {
    const st = state[key];
    if (!arr.length) return;
    const latest = arr[arr.length - 1];

    if (!st.lastId) {
        st.sessions = arr;
        st.lastId = latest.id;
        console.log(`✅ [${key.toUpperCase()}] ${arr.length} phiên`);
    } else if (latest.id_num > st.lastId) {
        const news = arr.filter(r => r.id_num > st.lastId);
        for (const r of news) st.sessions.push(r);
        if (st.sessions.length > 1000) st.sessions = st.sessions.slice(-800);
        st.lastId = latest.id;
        console.log(`🆕 [${key.toUpperCase()}] +${news.length}`);
    }

    // Learn nếu có pending prediction và đã có kết quả
    if (st.pending && latest.id_num === st.pending.targetId) {
        st.engine.learn(st.pending.target, latest.r === "T" ? "TAI" : "XIU");
        st.pending = null;
    }

    // Dự đoán
    const recent = st.sessions.slice(-MAX);
    st.latest = recent[recent.length - 1];
    const p = combinedPredict(st.engine, recent);
    if (p && p.prediction !== "CHỜ") {
        st.pred = p;
        st.pending = {
            targetId: st.latest.id_num + 1,
            result: p.prediction,
            target: { result: p.prediction, patterns: p.cau ? st.engine.detect(recent.map(s => s.r)) : [] },
        };
    } else {
        st.pred = p;
    }
}

async function poll(key) {
    try {
        const json = await fetchJSON(API[key]);
        const arr = parseRows(json);
        update(key, arr);
    } catch (e) {
        console.error(`❌ [${key.toUpperCase()}]`, e.message);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  RESPONSE
// ═══════════════════════════════════════════════════════════════════════════════
function buildResp(key) {
    const st = state[key];
    if (!st.latest || !st.pred) return null;
    const last = st.latest;
    const p = st.pred;

    let duDoan = "CHỜ";
    let tyLe = "--";
    if (p.prediction === "TAI") { duDoan = "TÀI"; tyLe = `${p.confidence}%`; }
    else if (p.prediction === "XIU") { duDoan = "XỈU"; tyLe = `${p.confidence}%`; }

    return {
        Id:          ADMIN,
        Phien_nay:   last.id_num + 1,
        Du_doan:     duDoan,
        Ty_le:       tyLe,
        Phien_truoc: last.id_num,
        Xuc_xac:     last.dices?.length === 3 ? last.dices.join("-") : "—",
        Ket_qua:     last.r === "T" ? "TÀI" : "XỈU",
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CHECK KEY
// ═══════════════════════════════════════════════════════════════════════════════
const checkKey = q => q.key === VALID_KEY ? { valid: true } : { valid: false, error: `Sai key! Ib ${ADMIN}` };

// ═══════════════════════════════════════════════════════════════════════════════
//  SERVER
// ═══════════════════════════════════════════════════════════════════════════════
const app = fastify({ logger: false, disableRequestLogging: true });
await app.register(cors, { origin: "*" });

app.get("/", async () => ({
    status: "ok",
    admin: ADMIN,
    engine: `Cầu Engine — 72 cầu + Bảng điểm MD5 (16 mức)`,
    hu:  { loaded: state.hu.sessions.length,  last_id: state.hu.lastId },
    md5: { loaded: state.md5.sessions.length, last_id: state.md5.lastId },
}));

app.get("/api/taixiu/lc79", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const r = buildResp("hu");
    return r || rep.status(503).send({ error: "Đang tải dữ liệu HŨ..." });
});

app.get("/api/taixiumd5/lc79", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const r = buildResp("md5");
    return r || rep.status(503).send({ error: "Đang tải dữ liệu MD5..." });
});

app.get("/api/debug/:loai", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const st = req.params.loai === "md5" ? state.md5 : state.hu;
    if (!st.latest) return rep.status(503).send({ error: "Chưa đủ dữ liệu" });
    return {
        last: {
            id: st.latest.id_num,
            result: st.latest.r,
            dice: st.latest.dices,
            point: st.latest.point,
        },
        diem_lookup: BANG_DIEM[st.latest.point] || null,
        prediction: st.pred,
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
║  🎲 TÀI XỈU LC79 — CẦU ENGINE + BẢNG ĐIỂM                            ║
╠══════════════════════════════════════════════════════════════════════╣
║  🚀 Port: ${PORT}
║  🔑 Key : ${VALID_KEY}
║  👤 Admin: ${ADMIN}
║  🧠 Engine: ${defs.length} cầu + 16 mức bảng điểm MD5
║  📌 HŨ : /api/taixiu/lc79?key=${VALID_KEY}
║  📌 MD5: /api/taixiumd5/lc79?key=${VALID_KEY}
║  📊 Bảng điểm: /api/bang-diem?key=${VALID_KEY}
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