import fastify from "fastify";
import cors from "@fastify/cors";

// ═══════════════════════════════════════════════════════════════════
//  TÀI XỈU LC79 — HYBRID ENGINE v4
//  Ensemble (Monte Carlo + Markov + Bayesian) + 72 Pattern Detectors
// ═══════════════════════════════════════════════════════════════════
const PORT      = process.env.PORT || 3000;
const VALID_KEY = "Thienvskhangs37";
const ADMIN     = "@ADMNLc79";

const API = {
    md5: "https://wtxmd52.tele68.com/v1/txmd5/sessions",
    hu:  "https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5",
};
const MAX  = 105;
const POLL = 4000;

// ═══════════════════════════════════════════════════════════════════
//  FETCH
// ═══════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════
//  PARSE
// ═══════════════════════════════════════════════════════════════════
const normStr = v => {
    const s = String(v || "").toUpperCase();
    if (s.includes("TAI") || s.includes("TÀI")) return "Tài";
    if (s.includes("XIU") || s.includes("XỈU")) return "Xỉu";
    return null;
};

function parseRows(json) {
    const a = Array.isArray(json) ? json : (json?.list || json?.data || json?.sessions || []);
    return a
        .map(x => {
            const point = Number(x.point) || 0;
            const r = normStr(x.resultTruyenThong ?? x.result ?? x.resultName ?? x.type)
                   || (point >= 11 ? "Tài" : point > 0 ? "Xỉu" : null);
            return {
                id: String(x.id ?? x._id ?? x.sessionId ?? ""),
                result: r,
                dices: x.dices || x.dice || [0, 0, 0],
                point,
            };
        })
        .filter(x => x.id && x.result)
        .sort((a, b) => {
            const na = Number(a.id), nb = Number(b.id);
            if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
            return a.id.localeCompare(b.id, undefined, { numeric: true });
        });
}

// ═══════════════════════════════════════════════════════════════════
//  PART A — 3 THUẬT TOÁN ENSEMBLE
// ═══════════════════════════════════════════════════════════════════

// ─── A1. Monte Carlo (5000 mô phỏng) ───
function monteCarloPrediction(history) {
    if (!history.length) return { taiProb: 0.5, confidence: 0 };
    const recent = history.slice(-50);
    const taiRatio = recent.filter(h => h.result === "Tài").length / recent.length;

    let simTai = 0;
    const SIMS = 5000;
    for (let i = 0; i < SIMS; i++) {
        if (Math.random() < 0.7) {
            if (Math.random() < taiRatio) simTai++;
        } else {
            const d1 = (Math.random() * 6 | 0) + 1;
            const d2 = (Math.random() * 6 | 0) + 1;
            const d3 = (Math.random() * 6 | 0) + 1;
            if (d1 + d2 + d3 >= 11) simTai++;
        }
    }
    const prob = simTai / SIMS;
    return { taiProb: prob, confidence: Math.abs(prob - 0.5) * 2 };
}

// ─── A2. Markov Chain bậc 2 ───
function markovChainPrediction(history) {
    if (history.length < 3) return { taiProb: 0.5, confidence: 0 };
    const matrix = {
        TT: { t: 0, total: 0 }, TX: { t: 0, total: 0 },
        XT: { t: 0, total: 0 }, XX: { t: 0, total: 0 },
    };
    for (let i = 2; i < history.length; i++) {
        const key = history[i-2].result[0] + history[i-1].result[0];
        if (matrix[key]) {
            if (history[i].result === "Tài") matrix[key].t++;
            matrix[key].total++;
        }
    }
    const currKey = history[history.length-2].result[0] + history[history.length-1].result[0];
    if (matrix[currKey]?.total > 0) {
        const prob = matrix[currKey].t / matrix[currKey].total;
        return { taiProb: prob, confidence: Math.abs(prob - 0.5) * 2 };
    }
    return { taiProb: 0.5, confidence: 0.1 };
}

// ─── A3. Bayesian Inference (decay 0.95) ───
function bayesianPrediction(history) {
    if (!history.length) return { taiProb: 0.5, confidence: 0 };
    let alpha = 1, beta = 1;
    for (let i = 0; i < history.length; i++) {
        const w = Math.pow(0.95, history.length - 1 - i);
        if (history[i].result === "Tài") alpha += w;
        else beta += w;
    }
    const prob = alpha / (alpha + beta);
    const variance = (alpha * beta) / (Math.pow(alpha + beta, 2) * (alpha + beta + 1));
    const confidence = Math.min(1 - Math.sqrt(variance) * 2, 0.95);
    return { taiProb: prob, confidence };
}

// ─── A4. Ensemble 3 thuật toán ───
function ensembleDecision(history) {
    if (!history.length) return { taiProb: 0.5, confidence: 0, side: null };
    const mc  = monteCarloPrediction(history);
    const mkv = markovChainPrediction(history);
    const bay = bayesianPrediction(history);
    const combined = mc.taiProb * 0.35 + mkv.taiProb * 0.35 + bay.taiProb * 0.30;
    return {
        taiProb: combined,
        confidence: Math.abs(combined - 0.5) * 2,
        side: combined >= 0.5 ? "T" : "X",
        details: { mc, mkv, bay },
    };
}

// ═══════════════════════════════════════════════════════════════════
//  PART B — 72 PATTERN DETECTORS
// ═══════════════════════════════════════════════════════════════════
const opp = x => x === "T" ? "X" : "T";
const toSeq = hist => hist.map(h => h.result === "Tài" ? "T" : "X");
const runs = a => { const o = []; for (const x of a) { if (!o.length || o.at(-1).v !== x) o.push({ v: x, n: 1 }); else o.at(-1).n++; } return o; };
const suffix = a => runs(a).at(-1);
const entropy = a => { if (!a.length) return 1; const t = a.filter(x => x === "T").length / a.length; if (t <= 0 || t >= 1) return 0; return -(t * Math.log2(t) + (1 - t) * Math.log2(1 - t)); };
const freq = (a, w = 20) => { a = a.slice(-w); return a.length ? a.filter(x => x === "T").length / a.length : 0.5; };
const trans = a => { let tt = 0, tx = 0, xt = 0, xx = 0; for (let i = 1; i < a.length; i++) { if (a[i-1]==="T" && a[i]==="T") tt++; else if (a[i-1]==="T") tx++; else if (a[i]==="T") xt++; else xx++; } return { tt, tx, xt, xx }; };
const predictTrans = a => { const q = trans(a), last = a.at(-1); if (last === "T") { const n = q.tt + q.tx; return n ? (q.tt/n - 0.5) * 2 : 0; } const n = q.xt + q.xx; return n ? (q.xt/n - 0.5) * 2 : 0; };
const patternAt = (a, pat) => { if (a.length < pat.length) return null; const z = a.slice(-pat.length); return z.every((v,i) => v === pat[i]) ? pat.at(-1) : null; };
const alternating = a => a.length > 1 && a.slice(1).every((x, i) => x !== a[i]);
const runLens = a => runs(a).map(x => x.n);

const defs = [];
const add = (name, group, fn, min = 8) => defs.push({ name, group, fn, min });

// ── 1-10: Bệt / cầu cơ bản ──
for (let n = 2; n <= 8; n++) add(`Bệt ${n}`, "Bệt", a => { const r = suffix(a); return r && r.n >= n ? (r.v === "T" ? 1 : -1) * (0.55 + Math.min(0.25, (r.n - n) * 0.03)) : 0; }, n + 5);
add("Bệt tăng tiếp diễn", "Bệt", a => { const r = suffix(a); return r && r.n >= 3 ? (r.v === "T" ? 1 : -1) * 0.72 : 0; }, 10);
add("Bệt chuẩn bị gãy",   "Bệt", a => { const r = suffix(a); return r && r.n >= 4 ? (r.v === "T" ? -1 : 1) * 0.68 : 0; }, 12);
add("Cầu 1-1", "Cầu 1-1", a => alternating(a) ? (a.at(-1) === "T" ? -1 : 1) * 0.86 : 0, 8);
add("Cầu 2-2", "Cầu nhịp", a => { const r = runs(a); if (r.length < 4) return 0; return r.slice(-4).map(x => x.n).join(",") === "2,2,2,2" ? (r.at(-1).v === "T" ? 1 : -1) * 0.82 : 0; }, 12);
add("Cầu 3-3", "Cầu nhịp", a => { const r = runs(a); return r.slice(-4).every(x => x.n === 3) ? (r.at(-1).v === "T" ? 1 : -1) * 0.82 : 0; }, 15);
add("Cầu 4-4", "Cầu nhịp", a => { const r = runs(a); return r.slice(-4).every(x => x.n === 4) ? (r.at(-1).v === "T" ? 1 : -1) * 0.82 : 0; }, 18);
add("Cầu 1-2", "Cầu nhịp", a => { const r = runs(a).slice(-6).map(x => x.n); return r.length >= 4 && r.slice(-4).join(",") === "1,2,1,2" ? (r.at(-1).v === "T" ? 1 : -1) * 0.8 : 0; }, 12);
add("Cầu 2-1", "Cầu nhịp", a => { const r = runs(a).slice(-6).map(x => x.n); return r.length >= 4 && r.slice(-4).join(",") === "2,1,2,1" ? (r.at(-1).v === "T" ? 1 : -1) * 0.8 : 0; }, 12);

// ── 11-25: Nhịp run-length ──
for (const [name, pat] of [
    ["1-2-1","1,2,1"],["2-1-2","2,1,2"],["1-3-1","1,3,1"],["2-3-2","2,3,2"],
    ["1-2-3","1,2,3"],["3-2-1","3,2,1"],["2-3-4","2,3,4"],["4-3-2","4,3,2"],
    ["1-3-2","1,3,2"],["2-1-3","2,1,3"],["3-1-2","3,1,2"],["2-4-2","2,4,2"],
    ["3-1-3","3,1,3"],["1-4-1","1,4,1"],["4-1-4","4,1,4"],
]) add(`Cầu ${name}`, "Cầu nhịp", a => { const r = runs(a).slice(-pat.split(",").length); return r.map(x => x.n).join(",") === pat ? ((r.at(-1).v === "T" ? 1 : -1) * 0.78) : 0; }, 15);

// ── 26-35: Chu kỳ ──
add("Tăng dần độ bệt", "Chu kỳ", a => { const l = runLens(a).slice(-5); return l.length === 5 && l.every((v, i) => i === 0 || v > l[i-1]) ? (suffix(a).v === "T" ? 1 : -1) * 0.76 : 0; }, 20);
add("Giảm dần độ bệt", "Chu kỳ", a => { const l = runLens(a).slice(-5); return l.length === 5 && l.every((v, i) => i === 0 || v < l[i-1]) ? (suffix(a).v === "T" ? 1 : -1) * 0.76 : 0; }, 20);
add("Lặp độ dài", "Chu kỳ", a => { const l = runLens(a).slice(-6); return l.length === 6 && l[0] === l[2] && l[2] === l[4] && l[1] === l[3] && l[3] === l[5] ? (suffix(a).v === "T" ? 1 : -1) * 0.7 : 0; }, 24);
add("Gương độ dài", "Chu kỳ", a => { const l = runLens(a).slice(-5); return l.length === 5 && l[0] === l[4] && l[1] === l[3] ? (suffix(a).v === "T" ? 1 : -1) * 0.7 : 0; }, 20);
add("Đổi nhịp sau bệt", "Chuyển trạng thái", a => { const r = runs(a); if (r.length < 3) return 0; const q = r.at(-2), z = r.at(-1); return q.n >= 3 && z.n <= 2 ? (z.v === "T" ? 1 : -1) * 0.65 : 0; }, 12);
add("Phá bệt ngắn", "Chuyển trạng thái", a => { const r = runs(a); if (r.length < 3) return 0; const z = r.at(-1); return z.n === 1 ? (z.v === "T" ? 1 : -1) * 0.62 : 0; }, 10);
add("Sau chuỗi 2", "Chuyển trạng thái", a => { const r = runs(a); return r.at(-1)?.n === 2 ? (r.at(-1).v === "T" ? 1 : -1) * 0.58 : 0; }, 10);
add("Sau chuỗi 3", "Chuyển trạng thái", a => { const r = runs(a); return r.at(-1)?.n === 3 ? (r.at(-1).v === "T" ? 1 : -1) * 0.62 : 0; }, 12);
add("Sau chuỗi 4+", "Chuyển trạng thái", a => { const r = runs(a); return r.at(-1)?.n >= 4 ? (r.at(-1).v === "T" ? -1 : 1) * 0.62 : 0; }, 14);
add("Biên đổi trạng thái", "Chuyển trạng thái", a => { const r = runs(a); return r.length >= 2 && r.at(-1).n === 1 && r.at(-2).n >= 2 ? (r.at(-1).v === "T" ? 1 : -1) * 0.65 : 0; }, 10);

// ── 36-45: Markov / suffix ──
for (let k = 1; k <= 5; k++) add(`Ngữ cảnh ${k} bước`, "Markov", a => {
    if (a.length < k + 5) return 0;
    const ctx = a.slice(-k).join("");
    let t = 0, x = 0;
    for (let i = k; i < a.length; i++) if (a.slice(i-k, i).join("") === ctx) { a[i] === "T" ? t++ : x++; }
    const n = t + x;
    return n >= 2 ? (t - x) / n : 0;
}, k + 8);
add("Chuyển tiếp T→T/X", "Markov", a => predictTrans(a), 12);
add("Chuyển tiếp theo bệt", "Markov", a => { const r = suffix(a); if (!r || a.length < 10) return 0; let t = 0, x = 0; for (let i = r.n; i < a.length; i++) if (a[i - r.n] === r.v) { a[i] === "T" ? t++ : x++; } return t + x >= 3 ? (t - x) / (t + x) : 0; }, 14);
add("Markov bậc 2", "Markov", a => { if (a.length < 12) return 0; const c = a.slice(-2).join(""); let t = 0, x = 0; for (let i = 2; i < a.length; i++) if (a.slice(i-2, i).join("") === c) a[i] === "T" ? t++ : x++; return t + x >= 3 ? (t - x) / (t + x) : 0; }, 12);
add("Markov bậc 3", "Markov", a => { if (a.length < 15) return 0; const c = a.slice(-3).join(""); let t = 0, x = 0; for (let i = 3; i < a.length; i++) if (a.slice(i-3, i).join("") === c) a[i] === "T" ? t++ : x++; return t + x >= 2 ? (t - x) / (t + x) : 0; }, 15);
add("Markov bậc 4", "Markov", a => { if (a.length < 18) return 0; const c = a.slice(-4).join(""); let t = 0, x = 0; for (let i = 4; i < a.length; i++) if (a.slice(i-4, i).join("") === c) a[i] === "T" ? t++ : x++; return t + x >= 2 ? (t - x) / (t + x) : 0; }, 18);
add("Suffix tái diễn", "Lặp mẫu", a => { if (a.length < 12) return 0; const s = a.slice(-3).join(""); let t = 0, x = 0; for (let i = 3; i < a.length - 1; i++) if (a.slice(i-3, i).join("") === s) a[i] === "T" ? t++ : x++; return t + x >= 2 ? (t - x) / (t + x) : 0; }, 12);

// ── 46-55: Periodic / lag ──
for (let lag = 2; lag <= 9; lag++) add(`Chu kỳ lag ${lag}`, "Chu kỳ", a => { if (a.length < lag * 3) return 0; let t = 0, x = 0; for (let i = lag; i < a.length; i++) if (a[i] === a[i - lag]) t++; else x++; return t + x >= 8 ? (t - x) / (t + x) * 0.72 : 0; }, lag * 2 + 4);
add("Lặp block 3", "Lặp block", a => { if (a.length < 9) return 0; const z = a.slice(-6), p = z.slice(0, 3); return z.slice(3).join("") === p.join("") ? (p.at(-1) === "T" ? 1 : -1) * 0.72 : 0; }, 12);
add("Lặp block 4", "Lặp block", a => { if (a.length < 12) return 0; const z = a.slice(-8), p = z.slice(0, 4); return z.slice(4).join("") === p.join("") ? (p.at(-1) === "T" ? 1 : -1) * 0.72 : 0; }, 15);
add("Đảo block", "Lặp block", a => { if (a.length < 10) return 0; const z = a.slice(-6), p = z.slice(0, 3).map(opp).join(""); return z.slice(3).join("") === p ? (z.at(-1) === "T" ? 1 : -1) * 0.7 : 0; }, 12);
add("Gương chuỗi", "Lặp block", a => { if (a.length < 8) return 0; const z = a.slice(-6), p = z.slice(0, 3).reverse().join(""); return z.slice(3).join("") === p ? (z.at(-1) === "T" ? 1 : -1) * 0.68 : 0; }, 12);

// ── 56-65: Thống kê / chế độ ──
add("Lệch tần suất 10", "Thống kê", a => { const p = freq(a, 10); return Math.abs(p - 0.5) >= 0.25 ? (p > 0.5 ? 1 : -1) * 0.62 : 0; }, 12);
add("Lệch tần suất 20", "Thống kê", a => { const p = freq(a, 20); return Math.abs(p - 0.5) >= 0.18 ? (p > 0.5 ? 1 : -1) * 0.6 : 0; }, 20);
add("Lệch tần suất 50", "Thống kê", a => { const p = freq(a, 50); return Math.abs(p - 0.5) >= 0.12 ? (p > 0.5 ? 1 : -1) * 0.56 : 0; }, 50);
add("Hồi quy trung bình", "Thống kê", a => { const p = freq(a, 10); return p > 0.75 ? -0.58 : p < 0.25 ? 0.58 : 0; }, 12);
add("Momentum", "Thống kê", a => { const p = freq(a, 8), q = freq(a, 24); return (p - q) * 1.5; }, 24);
add("Anti-momentum", "Thống kê", a => { const p = freq(a, 8), q = freq(a, 24); return -(p - q) * 1.25; }, 24);
add("Entropy thấp", "Chế độ", a => entropy(a.slice(-12)) < 0.75 ? (suffix(a).v === "T" ? 1 : -1) * 0.58 : 0, 15);
add("Entropy cao", "Chế độ", a => entropy(a.slice(-12)) > 0.98 ? (suffix(a).v === "T" ? -1 : 1) * 0.42 : 0, 15);
add("Đổi chế độ", "Chế độ", a => { if (a.length < 30) return 0; const e1 = entropy(a.slice(-10)), e2 = entropy(a.slice(-30, -10)); return Math.abs(e1 - e2) > 0.18 ? (freq(a, 10) > 0.5 ? 1 : -1) * 0.55 : 0; }, 30);
add("Lệch cửa sổ", "Chế độ", a => { const p = freq(a, 5), q = freq(a, 30); return Math.abs(p - q) > 0.3 ? (p > 0.5 ? 1 : -1) * 0.5 : 0; }, 30);

// ── 66-72: Meta ──
add("Đồng thuận 5-10", "Meta", a => { const p = freq(a, 5), q = freq(a, 10); return Math.sign(p - 0.5) === Math.sign(q - 0.5) && Math.abs(p - 0.5) > 0.1 ? (p > 0.5 ? 1 : -1) * 0.68 : 0; }, 10);
add("Đồng thuận 10-20-50", "Meta", a => { const ps = [5, 10, 20].map(w => freq(a, w)); const sg = ps.map(p => Math.sign(p - 0.5)); return sg.every(x => x === sg[0]) && sg[0] ? (sg[0]) * 0.7 : 0; }, 20);
add("Xung đột cửa sổ", "Meta", a => { const p = freq(a, 5), q = freq(a, 30); return Math.sign(p - 0.5) !== Math.sign(q - 0.5) ? (p > 0.5 ? 1 : -1) * 0.28 : 0; }, 30);
add("Ổn định hướng", "Meta", a => { const w = [5, 8, 13, 21].map(n => freq(a, n) > 0.5 ? 1 : -1); return w.filter(x => x === w[0]).length >= 3 ? w[0] * 0.62 : 0; }, 21);
add("Bền hướng", "Meta", a => { const z = a.slice(-8); return z.length === 8 && z.filter(x => x === z[0]).length >= 6 ? (z[0] === "T" ? 1 : -1) * 0.64 : 0; }, 12);
add("Đảo có xác nhận", "Meta", a => { if (!alternating(a.slice(-8))) return 0; return a.at(-1) === "T" ? -0.7 : 0.7; }, 12);
add("Tổng hợp cầu đang sống", "Meta", a => { const p = [freq(a, 5), freq(a, 10), freq(a, 20)]; const s = p.reduce((u, v) => u + (v - 0.5), 0) / p.length; return Math.abs(s) > 0.08 ? s * 1.3 : 0; }, 20);

if (defs.length < 72) throw new Error("Pattern registry < 72");
defs.splice(72);
defs.forEach((d, i) => { d.name = "Cầu " + (i + 1); });

// ═══════════════════════════════════════════════════════════════════
//  PATTERN ENGINE
// ═══════════════════════════════════════════════════════════════════
class PatternEngine {
    constructor() {
        this.stats = new Map(defs.map(d => [d.name, { n: 0, w: 0, loss: 0 }]));
        this.lastTarget = null;
    }
    detect(seq) {
        const out = [];
        for (const d of defs) {
            if (seq.length < d.min) continue;
            let v = 0;
            try { v = Number(d.fn(seq)) || 0; } catch {}
            if (Math.abs(v) < 0.18) continue;
            const st = this.stats.get(d.name);
            const reliability = st.n >= 8 ? Math.max(0.35, Math.min(1, (st.w + 3) / (st.n + 6))) : 0.5;
            const support = Math.min(1, seq.length / d.min);
            const strength = Math.min(1, Math.abs(v));
            out.push({
                name: d.name, group: d.group, signal: Math.sign(v), raw: v,
                confidence: 0.35 + 0.35 * strength + 0.2 * reliability + 0.1 * support,
            });
        }
        out.sort((a, b) => b.confidence - a.confidence);
        return out;
    }
    choose(seq) {
        const ds = this.detect(seq);
        if (!ds.length) return { ready: false, patterns: [], reason: "CHƯA NHẬN DIỆN ĐƯỢC CẦU" };

        const grouped = new Map();
        for (const d of ds) {
            if (!grouped.has(d.group)) grouped.set(d.group, []);
            grouped.get(d.group).push(d);
        }
        const candidates = [];
        for (const [group, arr] of grouped) {
            const s = arr.reduce((u, x) => u + x.signal * x.confidence, 0) / arr.reduce((u, x) => u + x.confidence, 0);
            if (Math.abs(s) >= 0.22) candidates.push({ group, score: s, top: arr[0] });
        }
        candidates.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
        if (!candidates.length) return { ready: false, patterns: ds.slice(0, 5), reason: "CẦU YẾU / XUNG ĐỘT" };

        const best = candidates[0];
        const corr = candidates.filter(x => Math.sign(x.score) === Math.sign(best.score)).length;
        const oppo = candidates.filter(x => Math.sign(x.score) !== Math.sign(best.score)).length;
        const conf = Math.min(0.86, Math.max(0.5, 0.52 + Math.abs(best.score) * 0.22 + Math.min(0.12, corr * 0.025) - Math.min(0.1, oppo * 0.02)));

        return {
            ready: true, patterns: ds.slice(0, 8),
            active: { name: best.top.name, group: best.group, side: best.score > 0 ? "T" : "X", confidence: conf },
            side: best.score > 0 ? "T" : "X", confidence: conf,
        };
    }
    learn(target, result) {
        if (!this.lastTarget || !result) return;
        for (const p of this.lastTarget.patterns) {
            const st = this.stats.get(p.name);
            if (!st) continue;
            st.n++;
            if ((p.signal > 0 ? "Tài" : "Xỉu") === result) st.w++;
            else st.loss++;
        }
        this.lastTarget = null;
    }
    setTarget(patterns) { this.lastTarget = { patterns }; }
}

// ═══════════════════════════════════════════════════════════════════
//  HYBRID ENGINE — kết hợp Ensemble + Pattern
// ═══════════════════════════════════════════════════════════════════
function hybridPredict(history, patternEngine) {
    if (history.length < 3) return null;

    // A. Ensemble 3 thuật toán
    const ens = ensembleDecision(history);

    // B. 72 pattern detectors
    const seq = toSeq(history);
    const pat = patternEngine.choose(seq);

    // C. Hợp nhất tín hiệu
    const ensSide = ens.side;                            // "T" | "X" | null
    const ensConf = ens.confidence;                      // 0..1
    const patSide = pat.ready ? pat.side : null;
    const patConf = pat.ready ? pat.confidence : 0;

    let finalSide, finalConf, source, agreement;

    if (ensSide && patSide) {
        if (ensSide === patSide) {
            // Đồng thuận → boost mạnh
            agreement = "AGREE";
            finalSide = ensSide;
            finalConf = Math.min(0.92, (ensConf * 0.4 + patConf * 0.6) + 0.12);
            source = "ENSEMBLE+72CẦU";
        } else {
            // Xung đột → chọn cái mạnh hơn
            agreement = "CONFLICT";
            if (patConf * 1.15 > ensConf) {
                finalSide = patSide;
                finalConf = Math.max(0.5, patConf * 0.75);
                source = "72CẦU thắng";
            } else {
                finalSide = ensSide;
                finalConf = Math.max(0.5, ensConf * 0.85);
                source = "ENSEMBLE thắng";
            }
        }
    } else if (ensSide) {
        finalSide = ensSide; finalConf = ensConf; agreement = "ENSEMBLE_ONLY"; source = "ENSEMBLE";
    } else if (patSide) {
        finalSide = patSide; finalConf = patConf; agreement = "PATTERN_ONLY"; source = "72CẦU";
    } else {
        // Fallback: đảo phiên cuối
        finalSide = history[history.length - 1].result === "Tài" ? "X" : "T";
        finalConf = 0.5; agreement = "FALLBACK"; source = "FALLBACK";
    }

    finalConf = Math.max(0.5, Math.min(0.95, finalConf));

    return {
        side: finalSide,
        prediction: finalSide === "T" ? "Tài" : "Xỉu",
        confidence: Math.round(finalConf * 100),
        source,
        agreement,
        ensemble: { side: ensSide, conf: Math.round(ensConf * 100), details: ens.details },
        pattern: { ready: pat.ready, side: patSide, conf: Math.round(patConf * 100), active: pat.active || null, top: pat.patterns.slice(0, 5).map(p => ({ name: p.name, group: p.group, sig: p.signal })) },
    };
}

// ═══════════════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════════════
const state = {
    md5: { sessions: [], lastId: null, seen: new Set(), pending: null, pred: null, engine: new PatternEngine() },
    hu:  { sessions: [], lastId: null, seen: new Set(), pending: null, pred: null, engine: new PatternEngine() },
};

function updateState(st, arr) {
    if (!arr.length) return;
    const latest = arr[arr.length - 1].id;

    if (!st.lastId) {
        st.sessions = arr;
        st.lastId = latest;
        for (const r of arr) st.seen.add(r.id);
        console.log(`✅ Loaded ${arr.length} sessions · last=${latest}`);
        return;
    }

    if (latest > st.lastId) {
        const news = arr.filter(r => r.id > st.lastId);
        for (const r of news) {
            if (st.pending && r.id === st.pending.targetId) {
                st.engine.learn(st.pending.patterns, r.result);
                st.pending = null;
            }
            st.sessions.push(r);
            st.seen.add(r.id);
        }
        if (st.sessions.length > 800) st.sessions = st.sessions.slice(-700);
        st.lastId = latest;
        st.pred = null;
        console.log(`🆕 +${news.length} → ${latest}`);
    }
}

function getPrediction(st) {
    if (st.sessions.length < 3) return null;
    const nextId = String(Number(st.lastId) + 1);
    if (st.pred && st.pred.targetId === nextId) return st.pred.data;

    const ai = hybridPredict(st.sessions, st.engine);
    if (!ai) return null;

    st.pred = { targetId: nextId, data: ai };
    if (ai.pattern.ready) {
        st.pending = { targetId: nextId, patterns: ai.pattern.top };
        st.engine.setTarget(ai.pattern.top);
    }
    return ai;
}

async function poll(key) {
    try {
        const json = await fetchJSON(API[key]);
        const arr = parseRows(json);
        updateState(state[key], arr);
    } catch (e) { console.error(`❌ [${key.toUpperCase()}]`, e.message); }
}

// ═══════════════════════════════════════════════════════════════════
//  RESPONSE
// ═══════════════════════════════════════════════════════════════════
function buildResp(st) {
    if (!st.sessions.length) return null;
    const last = st.sessions[st.sessions.length - 1];
    const ai = getPrediction(st);
    if (!ai) return null;

    return {
        Id:          ADMIN,
        Phien_nay:   String(Number(last.id) + 1),
        Du_doan:     ai.prediction === "Tài" ? "TÀI" : "XỈU",
        Ty_le:       `${ai.confidence}%`,
        Phien_truoc: last.id,
        Xuc_xac:     `${last.dices[0]}-${last.dices[1]}-${last.dices[2]}`,
        Ket_qua:     last.result === "Tài" ? "TÀI" : "XỈU",
    };
}

// ═══════════════════════════════════════════════════════════════════
//  CHECK KEY
// ═══════════════════════════════════════════════════════════════════
const checkKey = q =>
    q.key === VALID_KEY ? { valid: true } : { valid: false, error: `Sai key! Ib ${ADMIN}` };

// ═══════════════════════════════════════════════════════════════════
//  SERVER
// ═══════════════════════════════════════════════════════════════════
const app = fastify({ logger: false, disableRequestLogging: true });
app.register(cors, { origin: "*" });

app.get("/", async () => ({
    status: "ok",
    admin: ADMIN,
    engine: `HYBRID v4 — ENSEMBLE (MC+MKV+BAY) + ${defs.length} PATTERN DETECTORS`,
    hu:  { loaded: state.hu.sessions.length,  last_id: state.hu.lastId },
    md5: { loaded: state.md5.sessions.length, last_id: state.md5.lastId },
}));

app.get("/api/taixiu/lc79", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const r = buildResp(state.hu);
    return r || rep.status(503).send({ error: "Đang tải dữ liệu HŨ..." });
});

app.get("/api/taixiumd5/lc79", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const r = buildResp(state.md5);
    return r || rep.status(503).send({ error: "Đang tải dữ liệu MD5..." });
});

app.get("/api/debug/:loai", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const st = req.params.loai === "md5" ? state.md5 : state.hu;
    if (!st.sessions.length) return rep.status(503).send({ error: "Chưa có dữ liệu" });
    const ai = getPrediction(st);
    if (!ai) return rep.status(503).send({ error: "Đang tính toán" });
    return {
        sessions: st.sessions.length,
        last_id: st.lastId,
        final: { prediction: ai.prediction, confidence: ai.confidence, source: ai.source, agreement: ai.agreement },
        ensemble: ai.ensemble,
        pattern: ai.pattern,
    };
});

app.get("/check-key", async req =>
    req.query.key === VALID_KEY
        ? { status: "success", message: "KEY HỢP LỆ", admin: ADMIN }
        : { status: "error", message: `Sai key! Ib ${ADMIN}` });

// ═══════════════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════════════
app.listen({ port: PORT, host: "0.0.0.0" })
    .then(() => {
        console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  🎲 TÀI XỈU LC79 — HYBRID ENGINE v4                              ║
╠══════════════════════════════════════════════════════════════════╣
║  🚀 Port: ${PORT}
║  🔑 Key : ${VALID_KEY}
║  👤 Admin: ${ADMIN}
║
║  🧠 ENGINE A — ENSEMBLE 3 THUẬT TOÁN:
║     • Monte Carlo  (35%) — 5000 mô phỏng
║     • Markov Chain (35%) — bậc 2
║     • Bayesian     (30%) — decay 0.95
║
║  🎯 ENGINE B — ${defs.length} PATTERN DETECTORS:
║     • Bệt (8)         • Cầu nhịp (24)
║     • Chu kỳ (14)     • Markov (8)
║     • Lặp block (5)   • Thống kê (6)
║     • Chế độ (4)      • Meta (7)
║
║  ⚡ HỢP NHẤT: Đồng thuận → boost +12%
║              Xung đột  → chọn cái mạnh hơn
║
║  📌 API:
║     HŨ : /api/taixiu/lc79?key=${VALID_KEY}
║     MD5: /api/taixiumd5/lc79?key=${VALID_KEY}
║     DEBUG: /api/debug/hu?key=${VALID_KEY}
╚══════════════════════════════════════════════════════════════════╝
        `);

        setTimeout(() => { poll("hu").catch(() => {}); poll("md5").catch(() => {}); }, 100);
        setInterval(() => poll("hu").catch(() => {}),  POLL);
        setInterval(() => poll("md5").catch(() => {}), POLL);
    })
    .catch(err => {
        console.error("❌ Boot:", err.message);
        process.exit(1);
    });