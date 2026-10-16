import fastify from "fastify";
import cors from "@fastify/cors";

// ═══════════════════════════════════════════════════════════════════
//  TÀI XỈU LC79 — CẦU ENGINE v3 (72 PATTERN DETECTORS)
// ═══════════════════════════════════════════════════════════════════
const PORT      = process.env.PORT || 3000;
const VALID_KEY = "Thiên456";
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
//  PRIMITIVES
// ═══════════════════════════════════════════════════════════════════
const norm = v => {
    const s = String(v || "").toUpperCase();
    return s.includes("TAI") || s.includes("TÀI") ? "T" : s.includes("XIU") || s.includes("XỈU") ? "X" : null;
};

function parseRows(json) {
    const a = Array.isArray(json) ? json : (json?.list || json?.data || json?.sessions || []);
    return a.map(x => ({
        id: String(x.id ?? x._id ?? x.sessionId ?? ""),
        r: norm(x.resultTruyenThong ?? x.result ?? x.resultName ?? x.type) ||
           (Number(x.point) >= 11 ? "T" : Number(x.point) > 0 ? "X" : null),
        dices: x.dices || x.dice || [],
        point: x.point,
    })).filter(x => x.id && x.r);
}

function sortRows(a) {
    return [...a].sort((a, b) => {
        const na = Number(a.id), nb = Number(b.id);
        if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
        return a.id.localeCompare(b.id, undefined, { numeric: true });
    });
}

const opp = x => x === "T" ? "X" : "T";
const runs = a => { const out = []; for (const x of a) { if (!out.length || out.at(-1).v !== x) out.push({ v: x, n: 1 }); else out.at(-1).n++; } return out; };
const suffix = a => runs(a).at(-1);
const entropy = a => { if (!a.length) return 1; const t = a.filter(x => x === "T").length / a.length; if (t <= 0 || t >= 1) return 0; return -(t * Math.log2(t) + (1 - t) * Math.log2(1 - t)); };
const freq = (a, w = 20) => { a = a.slice(-w); return a.length ? a.filter(x => x === "T").length / a.length : 0.5; };
const trans = a => { let tt = 0, tx = 0, xt = 0, xx = 0; for (let i = 1; i < a.length; i++) { if (a[i-1] === "T" && a[i] === "T") tt++; else if (a[i-1] === "T") tx++; else if (a[i] === "T") xt++; else xx++; } return { tt, tx, xt, xx }; };
const predictTrans = a => { const q = trans(a), last = a.at(-1); if (last === "T") { const n = q.tt + q.tx; return n ? (q.tt/n - 0.5) * 2 : 0; } const n = q.xt + q.xx; return n ? (q.xt/n - 0.5) * 2 : 0; };
const patternAt = (a, pat) => { if (a.length < pat.length) return null; const z = a.slice(-pat.length); return z.every((v, i) => v === pat[i]) ? pat.at(-1) : null; };
const alternating = a => a.length > 1 && a.slice(1).every((x, i) => x !== a[i]);
const runLens = a => runs(a).map(x => x.n);
const scoreFromNext = (a, next) => next === "T" ? 1 : -1;

// ═══════════════════════════════════════════════════════════════════
//  72 PATTERN DETECTORS
// ═══════════════════════════════════════════════════════════════════
const defs = [];
const add = (name, group, fn, min = 8) => defs.push({ name, group, fn, min });

// 1-10: Bệt / cầu cơ bản
for (let n = 2; n <= 8; n++) add(`Cầu bệt ${n}`, "Bệt", a => { const r = suffix(a); return r && r.n >= n ? (r.v === "T" ? 1 : -1) * (0.55 + Math.min(0.25, (r.n - n) * 0.03)) : 0; }, n + 5);
add("Cầu bệt tăng tiếp diễn", "Bệt", a => { const r = suffix(a); return r && r.n >= 3 ? (r.v === "T" ? 1 : -1) * 0.72 : 0; }, 10);
add("Cầu bệt chuẩn bị gãy",   "Bệt", a => { const r = suffix(a); return r && r.n >= 4 ? (r.v === "T" ? -1 : 1) * 0.68 : 0; }, 12);

add("Cầu 1-1", "Cầu 1-1", a => alternating(a) ? (a.at(-1) === "T" ? -1 : 1) * 0.86 : 0, 8);
add("Cầu 2-2", "Cầu nhịp", a => { const r = runs(a); if (r.length < 4) return 0; const p = r.slice(-4).map(x => x.n); return p.join(",") === "2,2,2,2" ? (r.at(-1).v === "T" ? 1 : -1) * 0.82 : 0; }, 12);
add("Cầu 3-3", "Cầu nhịp", a => { const r = runs(a); return r.slice(-4).every(x => x.n === 3) ? (r.at(-1).v === "T" ? 1 : -1) * 0.82 : 0; }, 15);
add("Cầu 4-4", "Cầu nhịp", a => { const r = runs(a); return r.slice(-4).every(x => x.n === 4) ? (r.at(-1).v === "T" ? 1 : -1) * 0.82 : 0; }, 18);
add("Cầu 1-2", "Cầu nhịp", a => { const r = runs(a).slice(-6).map(x => x.n); return r.length >= 4 && r.slice(-4).join(",") === "1,2,1,2" ? (r.at(-1).v === "T" ? 1 : -1) * 0.8 : 0; }, 12);
add("Cầu 2-1", "Cầu nhịp", a => { const r = runs(a).slice(-6).map(x => x.n); return r.length >= 4 && r.slice(-4).join(",") === "2,1,2,1" ? (r.at(-1).v === "T" ? 1 : -1) * 0.8 : 0; }, 12);

// 11-25: Nhịp run-length
for (const [name, pat] of [
    ["Cầu 1-2-1", "1,2,1"], ["Cầu 2-1-2", "2,1,2"], ["Cầu 1-3-1", "1,3,1"], ["Cầu 2-3-2", "2,3,2"],
    ["Cầu 1-2-3", "1,2,3"], ["Cầu 3-2-1", "3,2,1"], ["Cầu 2-3-4", "2,3,4"], ["Cầu 4-3-2", "4,3,2"],
    ["Cầu 1-3-2", "1,3,2"], ["Cầu 2-1-3", "2,1,3"], ["Cầu 3-1-2", "3,1,2"], ["Cầu 2-4-2", "2,4,2"],
    ["Cầu 3-1-3", "3,1,3"], ["Cầu 1-4-1", "1,4,1"], ["Cầu 4-1-4", "4,1,4"],
]) {
    add(name, "Cầu nhịp", a => { const r = runs(a).slice(-pat.split(",").length); return r.map(x => x.n).join(",") === pat ? ((r.at(-1).v === "T" ? 1 : -1) * 0.78) : 0; }, 15);
}

// 26-35: Chu kỳ
add("Cầu tăng dần độ bệt", "Chu kỳ", a => { const l = runLens(a).slice(-5); return l.length === 5 && l.every((v, i) => i === 0 || v > l[i-1]) ? (suffix(a).v === "T" ? 1 : -1) * 0.76 : 0; }, 20);
add("Cầu giảm dần độ bệt", "Chu kỳ", a => { const l = runLens(a).slice(-5); return l.length === 5 && l.every((v, i) => i === 0 || v < l[i-1]) ? (suffix(a).v === "T" ? 1 : -1) * 0.76 : 0; }, 20);
add("Cầu lặp độ dài", "Chu kỳ", a => { const l = runLens(a).slice(-6); return l.length === 6 && l[0] === l[2] && l[2] === l[4] && l[1] === l[3] && l[3] === l[5] ? (suffix(a).v === "T" ? 1 : -1) * 0.7 : 0; }, 24);
add("Cầu gương độ dài", "Chu kỳ", a => { const l = runLens(a).slice(-5); return l.length === 5 && l[0] === l[4] && l[1] === l[3] ? (suffix(a).v === "T" ? 1 : -1) * 0.7 : 0; }, 20);
add("Cầu đổi nhịp sau bệt", "Chuyển trạng thái", a => { const r = runs(a); if (r.length < 3) return 0; const q = r.at(-2), z = r.at(-1); return q.n >= 3 && z.n <= 2 ? (z.v === "T" ? 1 : -1) * 0.65 : 0; }, 12);
add("Cầu phá bệt ngắn", "Chuyển trạng thái", a => { const r = runs(a); if (r.length < 3) return 0; const z = r.at(-1); return z.n === 1 ? (z.v === "T" ? 1 : -1) * 0.62 : 0; }, 10);
add("Cầu sau chuỗi 2", "Chuyển trạng thái", a => { const r = runs(a); return r.at(-1)?.n === 2 ? (r.at(-1).v === "T" ? 1 : -1) * 0.58 : 0; }, 10);
add("Cầu sau chuỗi 3", "Chuyển trạng thái", a => { const r = runs(a); return r.at(-1)?.n === 3 ? (r.at(-1).v === "T" ? 1 : -1) * 0.62 : 0; }, 12);
add("Cầu sau chuỗi 4+", "Chuyển trạng thái", a => { const r = runs(a); return r.at(-1)?.n >= 4 ? (r.at(-1).v === "T" ? -1 : 1) * 0.62 : 0; }, 14);
add("Cầu biên đổi trạng thái", "Chuyển trạng thái", a => { const r = runs(a); return r.length >= 2 && r.at(-1).n === 1 && r.at(-2).n >= 2 ? (r.at(-1).v === "T" ? 1 : -1) * 0.65 : 0; }, 10);

// 36-45: Markov / suffix
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
add("Cầu chuyển tiếp T->T/X", "Markov", a => predictTrans(a), 12);
add("Cầu chuyển tiếp theo bệt", "Markov", a => { const r = suffix(a); if (!r || a.length < 10) return 0; let t = 0, x = 0; for (let i = r.n; i < a.length; i++) if (a[i - r.n] === r.v) { a[i] === "T" ? t++ : x++; } return t + x >= 3 ? (t - x) / (t + x) : 0; }, 14);
add("Cầu Markov bậc 2", "Markov", a => { if (a.length < 12) return 0; const c = a.slice(-2).join(""); let t = 0, x = 0; for (let i = 2; i < a.length; i++) if (a.slice(i - 2, i).join("") === c) a[i] === "T" ? t++ : x++; return t + x >= 3 ? (t - x) / (t + x) : 0; }, 12);
add("Cầu Markov bậc 3", "Markov", a => { if (a.length < 15) return 0; const c = a.slice(-3).join(""); let t = 0, x = 0; for (let i = 3; i < a.length; i++) if (a.slice(i - 3, i).join("") === c) a[i] === "T" ? t++ : x++; return t + x >= 2 ? (t - x) / (t + x) : 0; }, 15);
add("Cầu Markov bậc 4", "Markov", a => { if (a.length < 18) return 0; const c = a.slice(-4).join(""); let t = 0, x = 0; for (let i = 4; i < a.length; i++) if (a.slice(i - 4, i).join("") === c) a[i] === "T" ? t++ : x++; return t + x >= 2 ? (t - x) / (t + x) : 0; }, 18);
add("Cầu suffix tái diễn", "Lặp mẫu", a => { if (a.length < 12) return 0; const s = a.slice(-3).join(""); let t = 0, x = 0; for (let i = 3; i < a.length - 1; i++) if (a.slice(i - 3, i).join("") === s) a[i] === "T" ? t++ : x++; return t + x >= 2 ? (t - x) / (t + x) : 0; }, 12);

// 46-55: Periodic / lag
for (let lag = 2; lag <= 9; lag++) add(`Cầu chu kỳ lag ${lag}`, "Chu kỳ", a => { if (a.length < lag * 3) return 0; let t = 0, x = 0; for (let i = lag; i < a.length; i++) if (a[i] === a[i - lag]) t++; else x++; return t + x >= 8 ? (t - x) / (t + x) * 0.72 : 0; }, lag * 2 + 4);
add("Cầu lặp block 3", "Lặp block", a => { if (a.length < 9) return 0; const z = a.slice(-6), p = z.slice(0, 3); return z.slice(3).join("") === p.join("") ? (p.at(-1) === "T" ? 1 : -1) * 0.72 : 0; }, 12);
add("Cầu lặp block 4", "Lặp block", a => { if (a.length < 12) return 0; const z = a.slice(-8), p = z.slice(0, 4); return z.slice(4).join("") === p.join("") ? (p.at(-1) === "T" ? 1 : -1) * 0.72 : 0; }, 15);
add("Cầu đảo block", "Lặp block", a => { if (a.length < 10) return 0; const z = a.slice(-6), p = z.slice(0, 3).map(opp).join(""); return z.slice(3).join("") === p ? (z.at(-1) === "T" ? 1 : -1) * 0.7 : 0; }, 12);
add("Cầu gương chuỗi", "Lặp block", a => { if (a.length < 8) return 0; const z = a.slice(-6), p = z.slice(0, 3).reverse().join(""); return z.slice(3).join("") === p ? (z.at(-1) === "T" ? 1 : -1) * 0.68 : 0; }, 12);

// 56-65: Thống kê / chế độ
add("Cầu lệch tần suất 10", "Thống kê", a => { const p = freq(a, 10); return Math.abs(p - 0.5) >= 0.25 ? (p > 0.5 ? 1 : -1) * 0.62 : 0; }, 12);
add("Cầu lệch tần suất 20", "Thống kê", a => { const p = freq(a, 20); return Math.abs(p - 0.5) >= 0.18 ? (p > 0.5 ? 1 : -1) * 0.6 : 0; }, 20);
add("Cầu lệch tần suất 50", "Thống kê", a => { const p = freq(a, 50); return Math.abs(p - 0.5) >= 0.12 ? (p > 0.5 ? 1 : -1) * 0.56 : 0; }, 50);
add("Cầu hồi quy trung bình", "Thống kê", a => { const p = freq(a, 10); return p > 0.75 ? -0.58 : p < 0.25 ? 0.58 : 0; }, 12);
add("Cầu momentum", "Thống kê", a => { const p = freq(a, 8), q = freq(a, 24); return (p - q) * 1.5; }, 24);
add("Cầu anti-momentum", "Thống kê", a => { const p = freq(a, 8), q = freq(a, 24); return -(p - q) * 1.25; }, 24);
add("Cầu entropy thấp", "Chế độ", a => entropy(a.slice(-12)) < 0.75 ? (suffix(a).v === "T" ? 1 : -1) * 0.58 : 0, 15);
add("Cầu entropy cao", "Chế độ", a => entropy(a.slice(-12)) > 0.98 ? (suffix(a).v === "T" ? -1 : 1) * 0.42 : 0, 15);
add("Cầu đổi chế độ", "Chế độ", a => { if (a.length < 30) return 0; const e1 = entropy(a.slice(-10)), e2 = entropy(a.slice(-30, -10)); return Math.abs(e1 - e2) > 0.18 ? (freq(a, 10) > 0.5 ? 1 : -1) * 0.55 : 0; }, 30);
add("Cầu lệch cửa sổ", "Chế độ", a => { const p = freq(a, 5), q = freq(a, 30); return Math.abs(p - q) > 0.3 ? (p > 0.5 ? 1 : -1) * 0.5 : 0; }, 30);

// 66-72: Meta
add("Cầu đồng thuận 5-10", "Meta", a => { const p = freq(a, 5), q = freq(a, 10); return Math.sign(p - 0.5) === Math.sign(q - 0.5) && Math.abs(p - 0.5) > 0.1 ? (p > 0.5 ? 1 : -1) * 0.68 : 0; }, 10);
add("Cầu đồng thuận 10-20-50", "Meta", a => { const ps = [5, 10, 20].map(w => freq(a, w)); const sg = ps.map(p => Math.sign(p - 0.5)); return sg.every(x => x === sg[0]) && sg[0] ? (sg[0]) * 0.7 : 0; }, 20);
add("Cầu xung đột cửa sổ", "Meta", a => { const p = freq(a, 5), q = freq(a, 30); return Math.sign(p - 0.5) !== Math.sign(q - 0.5) ? (p > 0.5 ? 1 : -1) * 0.28 : 0; }, 30);
add("Cầu ổn định hướng", "Meta", a => { const w = [5, 8, 13, 21].map(n => freq(a, n) > 0.5 ? 1 : -1); return w.filter(x => x === w[0]).length >= 3 ? w[0] * 0.62 : 0; }, 21);
add("Cầu bền hướng", "Meta", a => { const z = a.slice(-8); return z.length === 8 && z.filter(x => x === z[0]).length >= 6 ? (z[0] === "T" ? 1 : -1) * 0.64 : 0; }, 12);
add("Cầu đảo có xác nhận", "Meta", a => { if (!alternating(a.slice(-8))) return 0; return a.at(-1) === "T" ? -0.7 : 0.7; }, 12);
add("Cầu tổng hợp cầu đang sống", "Meta", a => { const p = [freq(a, 5), freq(a, 10), freq(a, 20)]; const s = p.reduce((u, v) => u + (v - 0.5), 0) / p.length; return Math.abs(s) > 0.08 ? s * 1.3 : 0; }, 20);

if (defs.length < 72) throw new Error("Pattern registry < 72");
defs.splice(72);
defs.forEach((d, i) => { d.patternLabel = d.name; d.name = "Cầu " + (i + 1); });

// ═══════════════════════════════════════════════════════════════════
//  CẦU ENGINE
// ═══════════════════════════════════════════════════════════════════
class CauEngine {
    constructor() {
        this.stats = new Map(defs.map(d => [d.name, { n: 0, w: 0, loss: 0, active: 0 }]));
        this.active = null;
        this.lastTarget = null;
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
                reliability,
            });
        }
        out.sort((x, y) => (y.confidence - Math.abs(y.raw) * 0.1) - (x.confidence - Math.abs(x.raw) * 0.1));
        return out;
    }
    choose(a) {
        const ds = this.detect(a);
        if (!ds.length) { this.active = null; return { ready: false, patterns: [], reason: "CHƯA NHẬN DIỆN ĐƯỢC CẦU" }; }
        const grouped = new Map();
        for (const d of ds) { if (!grouped.has(d.group)) grouped.set(d.group, []); grouped.get(d.group).push(d); }
        const candidates = [];
        for (const [group, arr] of grouped) {
            const s = arr.reduce((u, x) => u + x.signal * x.confidence, 0) / arr.reduce((u, x) => u + x.confidence, 0);
            if (Math.abs(s) >= 0.22) candidates.push({ group, score: s, top: arr[0] });
        }
        candidates.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
        if (!candidates.length) { this.active = null; return { ready: false, patterns: ds.slice(0, 5), reason: "CẦU YẾU / XUNG ĐỘT" }; }
        const best = candidates[0];
        const corroboration = candidates.filter(x => Math.sign(x.score) === Math.sign(best.score)).length;
        const opposite = candidates.filter(x => Math.sign(x.score) !== Math.sign(best.score)).length;
        const conf = Math.min(0.86, Math.max(0.5, 0.52 + Math.abs(best.score) * 0.22 + Math.min(0.12, corroboration * 0.025) - Math.min(0.1, opposite * 0.02)));
        this.active = { name: best.top.name, group: best.group, side: best.score > 0 ? "T" : "X", confidence: conf, corroboration, opposite };
        return { ready: true, patterns: ds.slice(0, 8), active: this.active, side: this.active.side, confidence: conf };
    }
    predict(a) {
        const r = this.choose(a);
        if (!r.ready) return { ready: false, result: null, confidence: 0, info: r };
        return { ready: true, result: r.side === "T" ? "TAI" : "XIU", confidence: Math.round(r.confidence * 100), info: r };
    }
    learn(target, result) {
        if (!this.lastTarget || !result) return;
        const hit = this.lastTarget.result === result;
        for (const p of this.lastTarget.patterns) {
            const st = this.stats.get(p.name);
            if (!st) continue;
            st.n++;
            if ((p.signal > 0 ? "TAI" : "XIU") === result && hit) st.w++;
            else if ((p.signal > 0 ? "TAI" : "XIU") !== result) st.loss++;
        }
        this.lastTarget = null;
    }
    setTarget(pred) { if (pred.ready) this.lastTarget = { result: pred.result, patterns: pred.info.patterns }; }
}

// ═══════════════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════════════
const state = {
    md5: { engine: new CauEngine(), seen: new Set(), pending: null, lastId: null, pred: null, latest: null },
    hu:  { engine: new CauEngine(), seen: new Set(), pending: null, lastId: null, pred: null, latest: null },
};

const nextId = id => { const n = Number(id); return Number.isFinite(n) ? String(n + 1) : id + "+"; };
const resultNorm = x => x === "T" ? "TAI" : "XIU";

function settleAndPredict(key, arr) {
    const st = state[key];
    const sorted = sortRows(arr);

    for (const row of sorted) {
        if (st.seen.has(row.id)) continue;
        st.seen.add(row.id);
        if (st.pending && row.id === st.pending.targetId) {
            st.engine.learn(resultNorm(row.r));
            st.pending = null;
        }
    }

    const recent = sorted.slice(-MAX);
    const latest = recent.at(-1);
    if (!latest) return;

    const pred = st.engine.predict(recent.map(x => x.r));
    const targetId = pred.ready ? nextId(latest.id) : null;

    st.latest = latest;
    st.lastId = latest.id;
    st.pred = { ...pred, targetId };

    if (pred.ready) {
        if (!st.pending || st.pending.targetId !== targetId) {
            st.pending = { targetId, pred };
            st.engine.setTarget(pred);
        }
    }
}

async function poll(key) {
    try {
        const json = await fetchJSON(API[key]);
        const arr = sortRows(parseRows(json));
        settleAndPredict(key, arr);
    } catch (e) {
        console.error(`❌ [${key.toUpperCase()}]`, e.message);
    }
}

// ═══════════════════════════════════════════════════════════════════
//  RESPONSE
// ═══════════════════════════════════════════════════════════════════
function buildResp(st, game) {
    if (!st.latest) return null;
    const last = st.latest;
    const pred = st.pred;

    const duDoan = pred?.ready ? (pred.result === "TAI" ? "TÀI" : "XỈU") : "CHỜ";
    const tyLe = pred?.ready ? `${pred.confidence}%` : "--";

    return {
        Id:          ADMIN,
        Phien_nay:   pred?.ready ? pred.targetId : nextId(last.id),
        Du_doan:     duDoan,
        Ty_le:       tyLe,
        Phien_truoc: last.id,
        Xuc_xac:     `${last.dices[0] ?? 0}-${last.dices[1] ?? 0}-${last.dices[2] ?? 0}`,
        Ket_qua:     last.r === "T" ? "TÀI" : "XỈU",
    };
}

// ═══════════════════════════════════════════════════════════════════
//  CHECK KEY
// ═══════════════════════════════════════════════════════════════════
const checkKey = q => q.key === VALID_KEY ? { valid: true } : { valid: false, error: `Sai key! Ib ${ADMIN}` };

// ═══════════════════════════════════════════════════════════════════
//  SERVER
// ═══════════════════════════════════════════════════════════════════
const app = fastify({ logger: false, disableRequestLogging: true });
app.register(cors, { origin: "*" });

app.get("/", async () => ({
    status: "ok",
    admin: ADMIN,
    engine: `CẦU ENGINE v3 — ${defs.length} pattern detectors`,
    hu:  { loaded: state.hu.seen.size,  last_id: state.hu.lastId,  ready: state.hu.pred?.ready  || false },
    md5: { loaded: state.md5.seen.size, last_id: state.md5.lastId, ready: state.md5.pred?.ready || false },
}));

app.get("/api/taixiu/lc79", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const r = buildResp(state.hu, "HŨ");
    return r || rep.status(503).send({ error: "Đang tải dữ liệu HŨ..." });
});

app.get("/api/taixiumd5/lc79", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const r = buildResp(state.md5, "MD5");
    return r || rep.status(503).send({ error: "Đang tải dữ liệu MD5..." });
});

app.get("/api/debug/:loai", async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const st = req.params.loai === "md5" ? state.md5 : state.hu;
    if (!st.latest) return rep.status(503).send({ error: "Chưa đủ dữ liệu" });
    return {
        last: st.latest,
        pred: st.pred,
        active_pattern: st.pred?.info?.active || null,
        top_patterns: st.pred?.info?.patterns?.slice(0, 8) || [],
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
║  🎲 TÀI XỈU LC79 — CẦU ENGINE v3                                 ║
╠══════════════════════════════════════════════════════════════════╣
║  🚀 Port: ${PORT}
║  🔑 Key : ${VALID_KEY}
║  👤 Admin: ${ADMIN}
║  🧠 Engine: ${defs.length} pattern detectors
║  📌 API:
║     HŨ : /api/taixiu/lc79?key=${VALID_KEY}
║     MD5: /api/taixiumd5/lc79?key=${VALID_KEY}
╚══════════════════════════════════════════════════════════════════╝
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