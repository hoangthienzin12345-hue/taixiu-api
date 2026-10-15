import fastify from "fastify";
import cors from "@fastify/cors";

const PORT      = process.env.PORT || 3000;
const VALID_KEY = "Thiên456";
const ADMIN     = "@ADMNLc79";
const BASE_RATE = 0.4861;

const API_URL_HU  = "https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5";
const API_URL_MD5 = "https://wtxmd52.tele68.com/v1/txmd5/sessions";

// ═══════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════
const clamp = (v, lo = 0.25, hi = 0.75) => Math.max(lo, Math.min(hi, v));
const sig   = x => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, x))));
const T2N   = s => (s === "T" ? 1 : 0);
const freq  = (a, v = "T") => a.length ? a.filter(x => x === v).length / a.length : 0.5;
const cnt   = (a, v) => a.filter(x => x === v).length;
const tail  = (a, n) => a.slice(-n);
const ent   = p => (p <= 0 || p >= 1) ? 0 : -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));

function streakLen(seq) {
    if (!seq.length) return [0, ""];
    const L = seq[seq.length - 1];
    let s = 1;
    for (let i = seq.length - 2; i >= 0; i--) { if (seq[i] === L) s++; else break; }
    return [s, L];
}
function countRuns(seq) {
    if (!seq.length) return 0;
    let r = 1;
    for (let i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1]) r++;
    return r;
}

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
            await new Promise(r => setTimeout(r, 800 * (a + 1)));
        }
    }
}

// ═══════════════════════════════════════════════════════════════════
//  NHÓM A — THỐNG KÊ NỀN TẢNG
// ═══════════════════════════════════════════════════════════════════
const A1 = c => { const w = tail(c.seq, 10); return [freq(w), w.length >= 6 ? 0.8 : 0, "f10"]; };
const A2 = c => { const w = tail(c.seq, 40); let a = 6, b = 6; for (const x of w) x === "T" ? a++ : b++; return [a / (a + b), 1.5, `β(${a},${b})`]; };
const A3 = c => { const w = tail(c.seq, 30); return [(cnt(w, "T") + 1) / (w.length + 2), 0.8, "Laplace"]; };
const A4 = c => { let p = 0.5; for (const x of tail(c.seq, 50)) p = 0.15 * T2N(x) + 0.85 * p; return [p, 1.2, "EWMA"]; };
const A5 = c => {
    const w = tail(c.seq, 40), n = w.length;
    if (n < 10) return [0.5, 0, "n/a"];
    const z = (cnt(w, "T") - n * 0.5) / Math.sqrt(n * 0.25);
    return [clamp(0.5 - Math.tanh(z * 0.4) * 0.4), Math.min(2, Math.abs(z)), `z=${z.toFixed(2)}`];
};
const A6 = c => {
    const w = tail(c.seq, 50), n1 = cnt(w, "T"), n2 = cnt(w, "X");
    if (n1 + n2 < 10) return [0.5, 0, "n/a"];
    const runs = countRuns(w), exp = 2 * n1 * n2 / (n1 + n2) + 1;
    const vr = 2 * n1 * n2 * (2 * n1 * n2 - n1 - n2) / ((n1 + n2) ** 2 * (n1 + n2 - 1));
    const z = (runs - exp) / Math.sqrt(Math.max(0.001, vr));
    return [clamp(0.5 - Math.tanh(z * 0.3) * 0.35), 1.0, `χ²=${z.toFixed(1)}`];
};
const A7 = c => {
    const w = tail(c.seq, 60);
    if (w.length < 15) return [0.5, 0, "n/a"];
    const runs = countRuns(w), n = w.length, exp = n / 2 + 1, sd = Math.sqrt((n - 1) / 4);
    const z = (runs - exp) / sd;
    const p = z < 0 ? 0.5 + Math.tanh(-z * 0.25) * 0.35 : 0.5 - Math.tanh(z * 0.25) * 0.35;
    return [clamp(p, 0.3, 0.7), Math.min(2, Math.abs(z)), `runs=${runs}`];
};
const A8 = c => {
    const w = tail(c.seq, 60);
    if (w.length < 15) return [0.5, 0, "n/a"];
    const x = w.map(T2N), m = x.reduce((a, b) => a + b, 0) / x.length;
    let num = 0, den = 0;
    for (let i = 0; i < x.length; i++) { den += (x[i] - m) ** 2; if (i) num += (x[i] - m) * (x[i - 1] - m); }
    const r = den ? num / den : 0, last = c.seq[c.seq.length - 1];
    let p = 0.5;
    if (r > 0.1) p = last === "T" ? 0.5 + r * 0.5 : 0.5 - r * 0.5;
    else if (r < -0.1) p = last === "T" ? 0.5 + r * 0.5 : 0.5 - r * 0.5;
    return [clamp(p), Math.min(2.5, Math.abs(r) * 4), `ac1=${r.toFixed(2)}`];
};

// ═══════════════════════════════════════════════════════════════════
//  NHÓM B — CẦU CƠ BẢN
// ═══════════════════════════════════════════════════════════════════
const B1 = c => {
    const [s, last] = streakLen(c.seq);
    if (s < 3) return [0.5, 0, `s=${s}`];
    const p = last === "T" ? 0.5 + Math.min(0.22, (s - 2) * 0.05) : 0.5 - Math.min(0.22, (s - 2) * 0.05);
    return [p, Math.min(2.5, (s - 2) * 0.6), `${last}×${s}`];
};
const B2 = c => {
    const w = tail(c.seq, 8);
    if (w.length < 6) return [0.5, 0, "n/a"];
    let alt = true;
    for (let i = 1; i < w.length; i++) if (w[i] === w[i - 1]) { alt = false; break; }
    if (!alt) return [0.5, 0, "no"];
    const last = w[w.length - 1];
    return [last === "T" ? 0.4 : 0.6, 1.5, "1-1"];
};
const B3 = c => {
    const w = tail(c.seq, 8), [s, last] = streakLen(w);
    if (s >= 3) return [0.5, 0, `x${s}`];
    if (s === 2) return [last === "T" ? 0.6 : 0.4, 1.2, "2-2"];
    return [0.5, 0, `s=${s}`];
};
const B4 = c => {
    const [s, last] = streakLen(c.seq);
    if (s >= 6) return [last === "T" ? 0.35 : 0.65, 1.5, `break3`];
    return [0.5, 0, `x${s}`];
};
const B5 = c => {
    const w = tail(c.seq, 6).join("");
    for (const pat of ["TXXT", "XTTX"]) {
        if (w.endsWith(pat)) return [pat[0] === "T" ? 0.6 : 0.4, 1.0, pat];
    }
    return [0.5, 0, "n/a"];
};
const B6 = c => {
    const w = tail(c.seq, 5).join("");
    const pats = ["TTXTX", "XXTXT", "TTXXT", "XXTTX"];
    for (const p of pats) if (w === p) return [p[0] === "T" ? 0.55 : 0.45, 0.9, p];
    return [0.5, 0, "n/a"];
};
const B7 = c => {
    const p = freq(tail(c.seq, 30)), d = p - 0.5;
    return [clamp(0.5 - Math.tanh(d * 2.5) * 0.28), Math.min(2, Math.abs(d) * 6), `p=${(p * 100).toFixed(0)}%`];
};
const B8 = c => {
    const [s, last] = streakLen(c.seq);
    if (s < 4) return [0.5, 0, "n/a"];
    return [last === "T" ? 0.35 : 0.65, Math.min(2.5, (s - 3) * 0.7), `break@${s}`];
};

// ═══════════════════════════════════════════════════════════════════
//  NHÓM C — CẦU NÂNG CAO
// ═══════════════════════════════════════════════════════════════════
const C1 = c => {
    const w = tail(c.seq, 20);
    if (w.length < 20) return [0.5, 0, "n/a"];
    let m = 0;
    for (let i = 0; i < 10; i++) if (w[i] === w[19 - i]) m++;
    if (m >= 8) return [w[10] === "T" ? 0.55 : 0.45, 0.6, `sym${m}/10`];
    return [0.5, 0, `m${m}`];
};
const C2 = c => {
    const w = tail(c.seq, 60);
    if (w.length < 30) return [0.5, 0, "n/a"];
    let bestP = 0, bestR = 0;
    for (let P = 2; P <= 12; P++) {
        let m = 0, t = 0;
        for (let i = P; i < w.length; i++) { t++; if (w[i] === w[i - P]) m++; }
        const r = t ? m / t : 0;
        if (r > bestR) { bestR = r; bestP = P; }
    }
    if (bestP < 2 || bestR < 0.62) return [0.5, 0, "cyc?"];
    const prev = c.seq[c.seq.length - bestP];
    return [prev === "T" ? bestR : 1 - bestR, Math.min(2.5, (bestR - 0.5) * 6), `P=${bestP}`];
};
const C3 = c => {
    const s = tail(c.seq, 5).join("");
    if (s === "TXTXT") return [0.4, 0.8, "peak"];
    if (s === "XTXTX") return [0.6, 0.8, "valley"];
    return [0.5, 0, "n/a"];
};
const C4 = c => {
    const w = tail(c.seq, 6);
    if (w.length < 6) return [0.5, 0, "n/a"];
    for (let i = 1; i < w.length; i++) if (w[i] === w[i - 1]) return [0.5, 0, "n/a"];
    const last = w[w.length - 1];
    return [last === "T" ? 0.42 : 0.58, 0.8, "ziczac"];
};
const C5 = c => {
    const w = tail(c.seq, 30);
    const segs = [];
    let cur = w[0], len = 1;
    for (let i = 1; i < w.length; i++) { if (w[i] === cur) len++; else { segs.push(len); cur = w[i]; len = 1; } }
    segs.push(len);
    if (segs.length < 4) return [0.5, 0, "n/a"];
    const l4 = segs.slice(-4);
    if (l4[0] < l4[1] && l4[1] < l4[2] && l4[2] < l4[3]) {
        const last = w[w.length - 1];
        return [last === "T" ? 0.35 : 0.65, 1.2, `stair ${l4.join("/")}`];
    }
    return [0.5, 0, "n/a"];
};
const C6 = c => {
    const w = tail(c.seq, 12);
    if (w.length < 12) return [0.5, 0, "n/a"];
    const b1 = w.slice(0, 4).join(""), b2 = w.slice(4, 8).join(""), b3 = w.slice(8, 12).join("");
    if (b1 === b2 && b2 === b3) return [b1[0] === "T" ? 0.55 : 0.45, 1.5, `diag ${b1}`];
    return [0.5, 0, "n/a"];
};
const C7 = c => {
    const w = tail(c.seq, 16).join("");
    if (w.length < 16) return [0.5, 0, "n/a"];
    if (w.slice(0, 8) === w.slice(8, 16)) return [w[0] === "T" ? 0.55 : 0.45, 1.3, `double`];
    return [0.5, 0, "n/a"];
};
const C8 = c => {
    const w = tail(c.seq, 40);
    const segs = [];
    let cur = w[0], len = 1;
    for (let i = 1; i < w.length; i++) { if (w[i] === cur) len++; else { segs.push(len); cur = w[i]; len = 1; } }
    segs.push(len);
    if (segs.length < 3) return [0.5, 0, "n/a"];
    const fibs = [1, 1, 2, 3, 5, 8, 13];
    const last = segs[segs.length - 1];
    if (!fibs.includes(last)) return [0.5, 0, "n/a"];
    const idx = fibs.lastIndexOf(last), nextLen = fibs[Math.min(idx + 1, fibs.length - 1)];
    const ref = w[w.length - 1];
    const p = last >= nextLen - 1 ? (ref === "T" ? 0.4 : 0.6) : (ref === "T" ? 0.55 : 0.45);
    return [p, 0.9, `fib ${last}`];
};

// ═══════════════════════════════════════════════════════════════════
//  NHÓM D — BAYES & XÁC SUẤT
// ═══════════════════════════════════════════════════════════════════
const D1 = c => {
    const p20 = freq(tail(c.seq, 20)), p50 = freq(tail(c.seq, 50));
    const lr = (p20 / 0.5) * (p50 / 0.5), post = (0.5 * lr) / (0.5 * lr + 0.5);
    return [clamp(post), 1.2, "NB"];
};
const D2 = c => {
    const w = tail(c.seq, 30), a = cnt(w, "T") + 1, b = cnt(w, "X") + 1;
    return [a / (a + b), 0.8, "Thomp"];
};
const D3 = c => {
    const w = tail(c.seq, 50), a = cnt(w, "T") + 2, b = cnt(w, "X") + 2;
    return [a / (a + b), 0.9, "DM"];
};
const D4 = c => {
    const w = tail(c.seq, 40), n = w.length;
    if (n < 10) return [0.5, 0, "n/a"];
    const mean = (cnt(w, "T") + 0.5) / (n + 1);
    const sd = Math.sqrt(mean * (1 - mean) / (n + 1));
    return [mean, Math.max(0, 1 - sd * 1.96 * 6) * 1.5, `ci±${(sd * 1.96 * 100).toFixed(1)}`];
};
const D5 = c => {
    const w = tail(c.seq, 40);
    if (w.length < 15) return [0.5, 0, "n/a"];
    let ch = 0;
    for (let i = 10; i < w.length; i++) {
        if (Math.abs(freq(w.slice(0, i)) - freq(w.slice(i))) > 0.35) ch++;
    }
    if (!ch) return [0.5, 0, "stable"];
    const p = freq(w.slice(-8));
    return [0.5 + (p - 0.5) * 0.5, 0.9, `cp=${ch}`];
};
const D6 = c => {
    const p10 = freq(tail(c.seq, 10)), p30 = freq(tail(c.seq, 30)), p100 = freq(tail(c.seq, 100));
    return [p10 * 0.5 + p30 * 0.3 + p100 * 0.2, 1.0, "hier"];
};
const D7 = c => {
    const w = tail(c.seq, 50), k = 10;
    return [(cnt(w, "T") + k * 0.5) / (w.length + k), 0.9, "BA"];
};
const D8 = c => {
    const p1 = freq(tail(c.seq, 10)), p2 = freq(tail(c.seq, 30)), p3 = freq(tail(c.seq, 60));
    const lo = Math.log(p1 / (1 - p1 + 1e-9)) + Math.log(p2 / (1 - p2 + 1e-9)) + Math.log(p3 / (1 - p3 + 1e-9));
    return [clamp(sig(lo / 3)), 1.1, "LO"];
};

// ═══════════════════════════════════════════════════════════════════
//  NHÓM E — CHUỖI THỜI GIAN
// ═══════════════════════════════════════════════════════════════════
const E1 = c => {
    const w = tail(c.seq, 60).map(T2N);
    if (w.length < 20) return [0.5, 0, "n/a"];
    const m = w.reduce((a, b) => a + b, 0) / w.length;
    let num = 0, den = 0;
    for (let i = 1; i < w.length; i++) { num += (w[i] - m) * (w[i - 1] - m); den += (w[i - 1] - m) ** 2; }
    const phi = den ? num / den : 0;
    const p = m + phi * (w[w.length - 1] - m);
    return [clamp(p), Math.min(2, Math.abs(phi) * 3), `φ=${phi.toFixed(2)}`];
};
const E2 = c => {
    const w = tail(c.seq, 30).map(T2N);
    if (w.length < 10) return [0.5, 0, "n/a"];
    const ma5 = w.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const ma20 = w.reduce((a, b) => a + b, 0) / w.length;
    return [clamp(0.5 + (ma5 - ma20)), 1.0, "MA5/20"];
};
const E3 = c => {
    const w = tail(c.seq, 30).map(T2N), n = w.length;
    if (n < 10) return [0.5, 0, "n/a"];
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { sx += i; sy += w[i]; sxy += i * w[i]; sxx += i * i; }
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    const inter = (sy - slope * sx) / n, nxt = inter + slope * n;
    return [clamp(0.5 + (nxt - 0.5) * 0.7), Math.min(1.5, Math.abs(slope) * 8), "trend"];
};
const E4 = c => {
    let x = 0.5, P = 1; const Q = 0.02, R = 0.15;
    for (const z of tail(c.seq, 40).map(T2N)) {
        const xp = x, Pp = P + Q, K = Pp / (Pp + R);
        x = xp + K * (z - xp); P = (1 - K) * Pp;
    }
    return [x, 1.2, "Kalman"];
};
const E5 = c => {
    const w = tail(c.seq, 40).map(T2N);
    if (w.length < 10) return [0.5, 0, "n/a"];
    let l = w[0], b = 0; const a = 0.3, be = 0.1;
    for (let i = 1; i < w.length; i++) { const lp = l; l = a * w[i] + (1 - a) * (l + b); b = be * (l - lp) + (1 - be) * b; }
    return [clamp(l + b), 1.0, "Holt"];
};
const E6 = c => {
    const w = tail(c.seq, 60).map(T2N);
    if (w.length < 20) return [0.5, 0, "n/a"];
    const P = 4, r = w.slice(-P * 2);
    const s1 = r.slice(0, P).reduce((a, b) => a + b, 0) / P;
    const s2 = r.slice(P).reduce((a, b) => a + b, 0) / P;
    return [clamp(0.5 + (s2 - s1) * 0.5), 0.8, "HW"];
};
const E7 = c => {
    const w = tail(c.seq, 40).map(T2N);
    if (w.length < 15) return [0.5, 0, "n/a"];
    const m = w.reduce((a, b) => a + b, 0) / w.length;
    const v = w.reduce((a, b) => a + (b - m) ** 2, 0) / w.length;
    const vol = Math.sqrt(v), last = w[w.length - 1];
    return [clamp(0.5 + (0.5 - last) * (0.5 - vol) * 0.6), Math.min(1.5, vol * 3), `vol=${vol.toFixed(2)}`];
};
const E8 = c => {
    const w = tail(c.seq, 32).map(T2N);
    if (w.length < 16) return [0.5, 0, "n/a"];
    const ap = [];
    for (let i = 0; i < w.length - 1; i += 2) ap.push((w[i] + w[i + 1]) / 2);
    const recent = ap.slice(-4).reduce((a, b) => a + b, 0) / 4;
    return [clamp(recent), 0.9, "Haar"];
};

// ═══════════════════════════════════════════════════════════════════
//  NHÓM F — MARKOV & ẨN
// ═══════════════════════════════════════════════════════════════════
function mkv(seq, o) {
    if (seq.length < o + 5) return [0.5, 0, "n/a"];
    const ctx = seq.slice(-o).join("");
    let t = 0, x = 0;
    for (let i = 0; i < seq.length - o; i++) {
        if (seq.slice(i, i + o).join("") === ctx) { if (seq[i + o] === "T") t++; else x++; }
    }
    if (t + x < 3) return [0.5, 0, `o${o} n/a`];
    return [(t + 0.5) / (t + x + 1), Math.min(2, (t + x) / 5), `o${o} n${t + x}`];
}
const F1 = c => mkv(c.seq, 1);
const F2 = c => mkv(c.seq, 2);
const F3 = c => mkv(c.seq, 3);
const F4 = c => { let b = [0.5, 0, ""], bn = 0; for (let o = 1; o <= 4; o++) { const r = mkv(c.seq, o); if (r[2].includes("n")) { const n = +r[2].match(/n(\d+)/)?.[1] || 0; if (n > bn) { bn = n; b = r; } } } return b; };
const F5 = c => {
    const w = tail(c.seq, 80), [s, last] = streakLen(w);
    let end = 0, cont = 0, cur = w[0], len = 1;
    for (let i = 1; i < w.length; i++) {
        if (w[i] === cur) len++;
        else { if (cur === last) { if (len >= s) end++; else cont++; } cur = w[i]; len = 1; }
    }
    if (cur === last && len >= s) cont++;
    const tot = end + cont;
    if (tot < 5) return [0.5, 0, "n/a"];
    return [cont / tot, 1.3, `semi s=${s}`];
};
const F6 = c => {
    const w = tail(c.seq, 60).map(T2N);
    if (w.length < 20) return [0.5, 0, "n/a"];
    let A = [[0.7, 0.3], [0.3, 0.7]], B = [[0.7, 0.3], [0.3, 0.7]], pi = [0.5, 0.5];
    for (let it = 0; it < 3; it++) {
        const a = Array.from({ length: w.length }, () => [0, 0]);
        for (let i = 0; i < 2; i++) a[0][i] = pi[i] * B[i][w[0]];
        for (let t = 1; t < w.length; t++) {
            for (let j = 0; j < 2; j++) {
                let s = 0; for (let i = 0; i < 2; i++) s += a[t - 1][i] * A[i][j];
                a[t][j] = s * B[j][w[t]];
            }
            const z = a[t][0] + a[t][1] || 1; a[t][0] /= z; a[t][1] /= z;
        }
        const nb = [[0.01, 0.01], [0.01, 0.01]];
        for (let i = 0; i < 2; i++) {
            let s0 = 0, s1 = 0;
            for (let t = 0; t < w.length; t++) { if (w[t] === 0) s0 += a[t][i]; else s1 += a[t][i]; }
            const tot = s0 + s1 + 0.02; nb[i][0] = s0 / tot; nb[i][1] = s1 / tot;
        }
        B = nb;
    }
    const a = Array.from({ length: w.length }, () => [0, 0]);
    for (let i = 0; i < 2; i++) a[0][i] = pi[i] * B[i][w[0]];
    for (let t = 1; t < w.length; t++) {
        for (let j = 0; j < 2; j++) {
            let s = 0; for (let i = 0; i < 2; i++) s += a[t - 1][i] * A[i][j];
            a[t][j] = s * B[j][w[t]];
        }
        const z = a[t][0] + a[t][1] || 1; a[t][0] /= z; a[t][1] /= z;
    }
    const last = a[a.length - 1];
    return [clamp(last[0] * B[0][1] + last[1] * B[1][1]), 1.5, "HMM2"];
};
const F7 = c => {
    let b = [0.5, 0, ""], bll = -Infinity;
    for (let o = 1; o <= 3; o++) {
        const ctx = c.seq.slice(-o).join("");
        let t = 0, x = 0;
        for (let i = 0; i < c.seq.length - o; i++) {
            if (c.seq.slice(i, i + o).join("") === ctx) { if (c.seq[i + o] === "T") t++; else x++; }
        }
        if (t + x < 4) continue;
        const p = (t + 0.5) / (t + x + 1), ll = t * Math.log(p) + x * Math.log(1 - p);
        if (ll > bll) { bll = ll; b = [p, 1.0, `vo${o} n${t + x}`]; }
    }
    return b;
};
const F8 = c => {
    if (c.seq.length < 20) return [0.5, 0, "n/a"];
    let sp = 0, cm = 0;
    for (let d = 1; d <= 4; d++) {
        const ctx = c.seq.slice(-d).join("");
        let t = 0, x = 0;
        for (let i = 0; i < c.seq.length - d; i++) {
            if (c.seq.slice(i, i + d).join("") === ctx) { if (c.seq[i + d] === "T") t++; else x++; }
        }
        if (t + x >= 3) { sp += (t + 0.5) / (t + x + 1); cm++; }
    }
    return cm ? [sp / cm, 1.4, "CTW-mini"] : [0.5, 0, "n/a"];
};

// ═══════════════════════════════════════════════════════════════════
//  NHÓM G — THÔNG TIN & ENTROPY
// ═══════════════════════════════════════════════════════════════════
const G1 = c => {
    const w = tail(c.seq, 50), H = ent(freq(w));
    return [clamp(0.5 + (freq(w) - 0.5) * (1 - H)), Math.max(0, (1 - H) * 2), `H=${H.toFixed(2)}`];
};
const G2 = c => {
    const w = tail(c.seq, 80);
    if (w.length < 20) return [0.5, 0, "n/a"];
    let t0 = 0, t1 = 0, c0 = 0, c1 = 0;
    for (let i = 1; i < w.length; i++) {
        if (w[i - 1] === "X") { c0++; if (w[i] === "T") t0++; }
        else { c1++; if (w[i] === "T") t1++; }
    }
    const last = w[w.length - 1], p = last === "T" ? (c1 ? t1 / c1 : 0.5) : (c0 ? t0 / c0 : 0.5);
    const n = last === "T" ? c1 : c0;
    return [p, n >= 10 ? 1.3 : 0.5, `H(X|p) n=${n}`];
};
const G3 = c => {
    const w = tail(c.seq, 80);
    if (w.length < 20) return [0.5, 0, "n/a"];
    let tt = 0, tx = 0, ct = 0, cx = 0;
    for (let i = 1; i < w.length; i++) {
        if (w[i - 1] === "T") { ct++; if (w[i] === "T") tt++; }
        else { cx++; if (w[i] === "T") tx++; }
    }
    const pT = ct ? tt / ct : 0.5, pX = cx ? tx / cx : 0.5;
    const mi = Math.abs(pT - pX), last = w[w.length - 1];
    return [last === "T" ? pT : pX, Math.min(2, mi * 6), `MI=${mi.toFixed(2)}`];
};
const G4 = c => {
    const ps = freq(tail(c.seq, 15)), pl = freq(tail(c.seq, 60));
    const kl = ps * Math.log(ps / pl + 1e-9) + (1 - ps) * Math.log((1 - ps) / (1 - pl) + 1e-9);
    return [clamp(0.5 + (ps - 0.5) * Math.min(1, 1 / (1 + Math.abs(kl)))), Math.min(1.5, Math.abs(kl)), `KL=${kl.toFixed(2)}`];
};
const G5 = c => {
    const p = freq(tail(c.seq, 15)), q = freq(tail(c.seq, 60)), m = (p + q) / 2;
    const js = 0.5 * p * Math.log(p / m + 1e-9) + 0.5 * q * Math.log(q / m + 1e-9)
             + 0.5 * (1 - p) * Math.log((1 - p) / (1 - m) + 1e-9) + 0.5 * (1 - q) * Math.log((1 - q) / (1 - m) + 1e-9);
    return [0.5 + (p - 0.5) * 0.7, Math.max(0, 1 - js * 2) * 1.3, `JS=${js.toFixed(2)}`];
};
const G6 = c => {
    const p = freq(tail(c.seq, 40)), b = BASE_RATE;
    const ce = -(p * Math.log(b) + (1 - p) * Math.log(1 - b));
    return [0.5 + (p - b) * 0.8, 0.7, `CE=${ce.toFixed(2)}`];
};
const G7 = c => {
    const p = freq(tail(c.seq, 30));
    const pp = Math.exp(-(p * Math.log(p + 1e-9) + (1 - p) * Math.log(1 - p + 1e-9)));
    return [0.5 + (p - 0.5) * 0.7, Math.max(0, 1 - pp / 2) * 1.2, `PPL=${pp.toFixed(2)}`];
};
const G8 = c => {
    const s = tail(c.seq, 40).join("");
    let cx = 1, cur = ""; const dict = new Set();
    for (const ch of s) { if (dict.has(cur + ch)) cur += ch; else { dict.add(cur + ch); cx++; cur = ch; } }
    return [0.5 + (freq(tail(c.seq, 20)) - 0.5) * 0.6, Math.min(1.3, cx / 20), `LZ=${cx}`];
};

// ═══════════════════════════════════════════════════════════════════
//  NHÓM H — ĐẶC TRƯNG META
// ═══════════════════════════════════════════════════════════════════
const H1 = c => {
    const w = tail(c.seq, 20), [s, last] = streakLen(w);
    if (s >= 3) return [last === "T" ? 0.58 : 0.42, 0.9, `s20=${s}`];
    return [0.5, 0, `s=${s}`];
};
const H2 = c => {
    const w = tail(c.seq, 30);
    if (w.length < 15) return [0.5, 0, "n/a"];
    let alt = 0;
    for (let i = 1; i < w.length; i++) if (w[i] !== w[i - 1]) alt++;
    const r = alt / (w.length - 1), last = w[w.length - 1];
    const p = r > 0.55 ? (last === "T" ? 0.42 : 0.58) : r < 0.45 ? (last === "T" ? 0.58 : 0.42) : 0.5;
    return [p, Math.min(1.5, Math.abs(r - 0.5) * 6), `alt=${(r * 100).toFixed(0)}%`];
};
const H3 = c => {
    const w = tail(c.seq, 50);
    let mx = 1, cur = 1;
    for (let i = 1; i < w.length; i++) { if (w[i] === w[i - 1]) cur++; else { if (cur > mx) mx = cur; cur = 1; } }
    if (cur > mx) mx = cur;
    const [, last] = streakLen(w);
    return [mx >= 4 ? (last === "T" ? 0.55 : 0.45) : 0.5, mx >= 4 ? 0.8 : 0, `max=${mx}`];
};
const H4 = c => {
    const w = tail(c.seq, 40);
    let mx = 1, cur = 1;
    for (let i = 1; i < w.length; i++) { if (w[i] !== w[i - 1]) cur++; else { if (cur > mx) mx = cur; cur = 1; } }
    if (cur > mx) mx = cur;
    if (mx >= 5) { const last = w[w.length - 1]; return [last === "T" ? 0.42 : 0.58, 1.0, `amax=${mx}`]; }
    return [0.5, 0, `amax=${mx}`];
};
const H5 = c => {
    const w = tail(c.seq, 50);
    let segs = [], cur = w[0], len = 1;
    for (let i = 1; i < w.length; i++) { if (w[i] === cur) len++; else { segs.push(len); cur = w[i]; len = 1; } }
    segs.push(len);
    if (segs.length < 3) return [0.5, 0, "n/a"];
    const avg = segs.reduce((a, b) => a + b, 0) / segs.length, [s, last] = streakLen(w);
    let p = 0.5;
    if (avg > 2 && s < avg) p = last === "T" ? 0.55 : 0.45;
    else if (avg < 1.8) p = last === "T" ? 0.45 : 0.55;
    return [p, Math.min(1.2, Math.abs(avg - 2) * 1.2), `avg=${avg.toFixed(2)}`];
};
const H6 = c => {
    const w = tail(c.seq, 100);
    if (w.length < 40) return [0.5, 0, "n/a"];
    const [s, last] = streakLen(w);
    if (s < 2) return [0.5, 0, `s=${s}`];
    const ctx = w.slice(-s).join("");
    let t = 0, x = 0;
    for (let i = 0; i < w.length - s; i++) {
        if (w.slice(i, i + s).join("") === ctx) { if (w[i + s] === "T") t++; else x++; }
    }
    if (t + x < 5) return [0.5, 0, "sparse"];
    return [(t + 0.5) / (t + x + 1), Math.min(2, (t + x) / 12), `pat n=${t + x}`];
};
const H7 = c => {
    const w = tail(c.seq, 60);
    let num = 0, den = 0;
    for (let i = 0; i < w.length; i++) { const wt = Math.pow(0.94, w.length - 1 - i); if (w[i] === "T") num += wt; den += wt; }
    return [den ? num / den : 0.5, 1.0, "recency"];
};
const H8 = c => {
    const n = c.seq.length;
    if (n < 30) return [BASE_RATE, 0, "base"];
    return [(cnt(c.seq, "T") + BASE_RATE * 50) / (n + 50), 0.5, "adapt"];
};

// ═══════════════════════════════════════════════════════════════════
//  NHÓM I — XÚC XẮC & VẬT LÝ
// ═══════════════════════════════════════════════════════════════════
const I1 = c => {
    const r = c.sessions.slice(-50);
    if (r.length < 15) return [0.5, 0, "n/a"];
    const avg = r.reduce((a, s) => a + s.point, 0) / r.length;
    return [sig((avg - 10.5) * 0.6), Math.min(1.5, Math.abs(avg - 10.5) * 0.3), `avg=${avg.toFixed(1)}`];
};
const I2 = c => {
    const r = c.sessions.slice(-30).filter(s => s.dices?.length === 3);
    if (r.length < 10) return [0.5, 0, "n/a"];
    const avg = r.reduce((a, s) => a + (s.dices[0] + s.dices[1] + s.dices[2]) / 3 - 3.5, 0) / r.length;
    return [sig(avg * 1.2), Math.min(1.5, Math.abs(avg) * 3), `davg=${avg.toFixed(2)}`];
};
const I3 = c => {
    const r = c.sessions.slice(-30).filter(s => s.dices?.length === 3);
    if (r.length < 10) return [0.5, 0, "n/a"];
    const tot = r.map(s => s.point), m = tot.reduce((a, b) => a + b, 0) / tot.length;
    const v = tot.reduce((a, b) => a + (b - m) ** 2, 0) / tot.length;
    return [clamp(0.5 + (sig((m - 10.5) * 0.5) - 0.5) * Math.min(1, v / 4)), 0.8, `v=${v.toFixed(2)}`];
};
const I4 = c => {
    const r = c.sessions.slice(-40).filter(s => s.dices?.length === 3);
    if (r.length < 10) return [0.5, 0, "n/a"];
    const fd = [[0,0,0,0,0,0],[0,0,0,0,0,0],[0,0,0,0,0,0]];
    for (const s of r) for (let i = 0; i < 3; i++) fd[i][s.dices[i] - 1]++;
    let H = 0;
    for (let i = 0; i < 3; i++) for (let f = 0; f < 6; f++) {
        const p = fd[i][f] / r.length; if (p > 0) H -= p * Math.log2(p);
    }
    H /= 3;
    return [0.5, Math.min(1.2, Math.abs(H - Math.log2(6)) * 2), `Hd=${H.toFixed(2)}`];
};
const I5 = c => {
    const r = c.sessions.slice(-80).filter(s => s.dices?.length === 3);
    if (r.length < 20) return [0.5, 0, "n/a"];
    let s = 0;
    for (const x of r) s += (x.dices[0] + x.dices[1] + x.dices[2]) / 3 - 3.5;
    const bias = s / r.length;
    return [sig(bias * 0.9), Math.min(2, Math.abs(bias)), `bias=${bias.toFixed(2)}`];
};
const I6 = c => {
    const r = c.sessions.slice(-60).filter(s => s.dices?.length === 3);
    if (r.length < 20) return [0.5, 0, "n/a"];
    const d1 = r.map(s => s.dices[0]), d2 = r.map(s => s.dices[1]);
    const m1 = d1.reduce((a, b) => a + b, 0) / d1.length, m2 = d2.reduce((a, b) => a + b, 0) / d2.length;
    let num = 0, x1 = 0, x2 = 0;
    for (let i = 0; i < d1.length; i++) { num += (d1[i] - m1) * (d2[i] - m2); x1 += (d1[i] - m1) ** 2; x2 += (d2[i] - m2) ** 2; }
    const rho = x1 * x2 ? num / Math.sqrt(x1 * x2) : 0;
    return [0.5, Math.min(1.2, Math.abs(rho) * 2), `ρ=${rho.toFixed(2)}`];
};
const I7 = c => {
    const r = c.sessions.slice(-20);
    if (r.length < 10) return [0.5, 0, "n/a"];
    const near = r.filter(s => s.point >= 9 && s.point <= 12).length;
    if (near / r.length > 0.5) {
        const last = c.seq[c.seq.length - 1];
        return [last === "T" ? 0.4 : 0.6, 0.8, `near=${near}`];
    }
    return [0.5, 0, "n/a"];
};
const I8 = c => {
    const h = c.state.history.slice(-60);
    if (h.length < 20) return [0.5, 0, "n/a"];
    const wins = h.filter(x => x.result === "WIN").length, n = h.length;
    const ph = wins / n, z = 1.96, den = 1 + z * z / n;
    const ctr = (ph + z * z / (2 * n)) / den;
    const mg = z * Math.sqrt(ph * (1 - ph) / n + z * z / (4 * n * n)) / den;
    const wl = Math.max(0, ctr - mg);
    return [0.5 + (wl - 0.5) * 0.5, 0.9, `WL=${(wl * 100).toFixed(1)}%`];
};

// ═══════════════════════════════════════════════════════════════════
//  72 MODULE REGISTRY
// ═══════════════════════════════════════════════════════════════════
const MODULES = [
    ["A1", A1], ["A2", A2], ["A3", A3], ["A4", A4], ["A5", A5], ["A6", A6], ["A7", A7], ["A8", A8],
    ["B1", B1], ["B2", B2], ["B3", B3], ["B4", B4], ["B5", B5], ["B6", B6], ["B7", B7], ["B8", B8],
    ["C1", C1], ["C2", C2], ["C3", C3], ["C4", C4], ["C5", C5], ["C6", C6], ["C7", C7], ["C8", C8],
    ["D1", D1], ["D2", D2], ["D3", D3], ["D4", D4], ["D5", D5], ["D6", D6], ["D7", D7], ["D8", D8],
    ["E1", E1], ["E2", E2], ["E3", E3], ["E4", E4], ["E5", E5], ["E6", E6], ["E7", E7], ["E8", E8],
    ["F1", F1], ["F2", F2], ["F3", F3], ["F4", F4], ["F5", F5], ["F6", F6], ["F7", F7], ["F8", F8],
    ["G1", G1], ["G2", G2], ["G3", G3], ["G4", G4], ["G5", G5], ["G6", G6], ["G7", G7], ["G8", G8],
    ["H1", H1], ["H2", H2], ["H3", H3], ["H4", H4], ["H5", H5], ["H6", H6], ["H7", H7], ["H8", H8],
    ["I1", I1], ["I2", I2], ["I3", I3], ["I4", I4], ["I5", I5], ["I6", I6], ["I7", I7], ["I8", I8],
];

// ═══════════════════════════════════════════════════════════════════
//  ANALYZE — chạy cả 72 module + ensemble
// ═══════════════════════════════════════════════════════════════════
function analyze(state) {
    const sessions = state.sessions;
    if (sessions.length < 30) return null;
    const seq = sessions.map(s => s.result === "TAI" ? "T" : "X");
    const ctx = { seq, sessions, state };

    const signals = [];
    for (const [id, fn] of MODULES) {
        try {
            const [p, w, note] = fn(ctx);
            const pSafe = clamp(p, 0.05, 0.95);
            signals.push({ id, p_tai: pSafe * 100, w, note });
        } catch (e) {
            signals.push({ id, p_tai: 50, w: 0, note: "err" });
        }
    }

    // Ensemble có trọng số
    let num = 0, den = 0;
    for (const s of signals) { num += s.p_tai * s.w; den += s.w; }
    let pTai = den ? num / den / 100 : 0.5;

    // Agreement + Tier
    const active = signals.filter(s => s.w > 0);
    const predict = pTai >= 0.5 ? "TAI" : "XIU";
    const agree = active.length
        ? active.filter(s => (s.p_tai >= 50) === (predict === "TAI")).length / active.length * 100
        : 50;
    const conf = Math.max(pTai, 1 - pTai) * 100;

    let tier = "WEAK";
    if (conf >= 57 && agree >= 65) tier = "STRONG";
    else if (conf >= 53 && agree >= 55) tier = "OK";
    else if (agree < 40) tier = "SPLIT";

    // Wilson
    const h = state.history.slice(-100);
    let wilson = 0;
    if (h.length >= 20) {
        const wins = h.filter(x => x.result === "WIN").length;
        const ph = wins / h.length, z = 1.96, d = 1 + z * z / h.length;
        const c = (ph + z * z / (2 * h.length)) / d;
        const m = z * Math.sqrt(ph * (1 - ph) / h.length + z * z / (4 * h.length * h.length)) / d;
        wilson = Math.max(0, c - m) * 100;
    }

    const [streak, last] = streakLen(seq);

    return {
        predict, confidence: conf, tier, agreement: agree, wilson,
        p_tai: pTai * 100, p_xiu: (1 - pTai) * 100,
        streak, last, signals,
    };
}

// ═══════════════════════════════════════════════════════════════════
//  PARSE
// ═══════════════════════════════════════════════════════════════════
function parseHu(data) {
    if (!data?.list || !Array.isArray(data.list)) return [];
    return data.list.sort((a, b) => b.id - a.id).map(it => ({
        id: it.id, dices: it.dices, point: it.point,
        result: it.point >= 11 ? "TAI" : "XIU",
        result_vn: it.point >= 11 ? "Tài" : "Xỉu",
    })).sort((a, b) => a.id - b.id);
}
function parseMd5(data) {
    if (!data?.list || !Array.isArray(data.list)) return [];
    return data.list.sort((a, b) => b.id - a.id).map(it => ({
        id: it.id, dices: it.dices, point: it.point,
        result: it.resultTruyenThong === "Tài" ? "TAI" : "XIU",
        result_vn: it.resultTruyenThong,
    })).sort((a, b) => a.id - b.id);
}

// ═══════════════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════════════
function mkState() {
    return { sessions: [], lastId: null, history: [], lastPred: null, lastFetchAt: 0 };
}
const stateHu = mkState(), stateMd5 = mkState();

function updateState(state, arr) {
    if (!arr.length) return;
    const latest = arr[arr.length - 1].id;
    if (!state.lastId) { state.sessions = arr; state.lastId = latest; console.log(`✅ Loaded ${arr.length}`); return; }
    if (latest > state.lastId) {
        const news = arr.filter(r => r.id > state.lastId);
        for (const r of news) {
            if (state.lastPred && state.lastPred.session === r.id) {
                const win = state.lastPred.predict === r.result;
                state.history.push({ sessionId: r.id, predict: state.lastPred.predict, actual: r.result, result: win ? "WIN" : "LOSE" });
                if (state.history.length > 500) state.history.shift();
                state.lastPred = null;
            }
            state.sessions.push(r);
        }
        if (state.sessions.length > 800) state.sessions = state.sessions.slice(-700);
        state.lastId = latest;
        console.log(`🆕 +${news.length} → ${latest}`);
    }
}

async function fetchHu() { try { updateState(stateHu, parseHu(await fetchJSON(API_URL_HU))); stateHu.lastFetchAt = Date.now(); } catch (e) { console.error("HU:", e.message); } }
async function fetchMd5() { try { updateState(stateMd5, parseMd5(await fetchJSON(API_URL_MD5))); stateMd5.lastFetchAt = Date.now(); } catch (e) { console.error("MD5:", e.message); } }

function getPrediction(state) {
    if (state.sessions.length < 30) return null;
    if (state.lastPred && state.lastPred.session === state.lastId + 1) return state.lastPred.ai_result;
    const ai = analyze(state);
    if (!ai) return null;
    state.lastPred = { session: state.lastId + 1, predict: ai.predict, ai_result: ai };
    return ai;
}

// ═══════════════════════════════════════════════════════════════════
//  BUILD RESPONSE
// ═══════════════════════════════════════════════════════════════════
function buildResp(state, game) {
    if (state.sessions.length < 30) return null;
    const ai = getPrediction(state);
    if (!ai) return null;
    const last = state.sessions[state.sessions.length - 1];
    const topSig = ai.signals.slice().sort((a, b) => b.w - a.w).slice(0, 10)
        .map(s => `${s.id}:${s.p_tai.toFixed(0)}%×${s.w.toFixed(1)}`).join(" | ");

    return {
        Id: ADMIN, Game: game,
        Phien_truoc: last.id,
        Xuc_xac: `${last.dices[0]} - ${last.dices[1]} - ${last.dices[2]}`,
        Ket_qua: last.result_vn.toLowerCase(),
        Tong: last.point,
        Phien_nay: last.id + 1,
        Du_doan: ai.predict === "TAI" ? "tài" : "xỉu",
        Do_tin_cay: `${ai.confidence.toFixed(1)}%`,
        Ly_do: `Tier ${ai.tier} · Agree ${ai.agreement.toFixed(0)}% · Wilson ${ai.wilson.toFixed(1)}%`,
        Biet_hien_tai: `${ai.streak} ${ai.last}`,
        Nguon_cau: `72 modules · top: ${topSig}`,
        AI: {
            tier: ai.tier,
            p_tai: +ai.p_tai.toFixed(2), p_xiu: +ai.p_xiu.toFixed(2),
            wilson: +ai.wilson.toFixed(2), agreement: +ai.agreement.toFixed(1),
            signals: ai.signals.map(s => ({ id: s.id, p_tai: +s.p_tai.toFixed(1), w: +s.w.toFixed(2), note: s.note })),
        },
        "5_van_gan_nhat": state.sessions.slice(-5).reverse().map((v, i) => ({
            stt: i + 1, result: v.result_vn, total: v.point, dice: `${v.dices[0]}-${v.dices[1]}-${v.dices[2]}`,
        })),
    };
}

// ═══════════════════════════════════════════════════════════════════
//  SERVER
// ═══════════════════════════════════════════════════════════════════
const checkKey = q => q.key === VALID_KEY ? { valid: true } : { valid: false, error: `Sai key! Ib ${ADMIN}` };
const app = fastify({ logger: false, disableRequestLogging: true });
app.register(cors, { origin: "*" });

app.get("/", async () => ({
    status: "ok", admin: ADMIN,
    engine: "LC79 v8 — 72 THUẬT TOÁN / 9 NHÓM",
    groups: {
        A: "Thống kê nền tảng (8)", B: "Cầu cơ bản (8)", C: "Cầu nâng cao (8)",
        D: "Bayes & Xác suất (8)", E: "Chuỗi thời gian (8)", F: "Markov & Ẩn (8)",
        G: "Thông tin & Entropy (8)", H: "Đặc trưng Meta (8)", I: "Xúc xắc & Vật lý (8)",
    },
    hu:  { loaded: stateHu.sessions.length,  last_id: stateHu.lastId },
    md5: { loaded: stateMd5.sessions.length, last_id: stateMd5.lastId },
}));

const route = (game, state) => async (req, rep) => {
    const k = checkKey(req.query);
    if (!k.valid) return rep.status(401).send({ error: k.error });
    const r = buildResp(state, game);
    return r || rep.status(503).send({ error: `Đang tải ${game}...` });
};
app.get("/api/taixiu/lc79",  route("HŨ",  stateHu));
app.get("/api/taixiumd5/lc79", route("MD5", stateMd5));

app.get("/api/taixiu/lc79/history",  async (req, rep) => {
    const k = checkKey(req.query); if (!k.valid) return rep.status(401).send({ error: k.error });
    return stateHu.sessions.slice(-30).reverse().map(i => ({ session: i.id, dice: i.dices, total: i.point, result: i.result_vn.toLowerCase() }));
});
app.get("/api/taixiumd5/lc79/history", async (req, rep) => {
    const k = checkKey(req.query); if (!k.valid) return rep.status(401).send({ error: k.error });
    return stateMd5.sessions.slice(-30).reverse().map(i => ({ session: i.id, dice: i.dices, total: i.point, result: i.result_vn.toLowerCase() }));
});

app.get("/api/taixiu/lc79/ai-history", async (req, rep) => {
    const k = checkKey(req.query); if (!k.valid) return rep.status(401).send({ error: k.error });
    const wins = stateHu.history.filter(x => x.result === "WIN").length, tot = stateHu.history.length;
    return { total: tot, wins, loses: tot - wins, winrate: tot ? (wins / tot * 100).toFixed(2) + "%" : "N/A", recent: stateHu.history.slice(-30).reverse() };
});

app.get("/check-key", async req => req.query.key === VALID_KEY
    ? { status: "success", message: "KEY HỢP LỆ", admin: ADMIN }
    : { status: "error", message: `Sai key! Ib ${ADMIN}` });

app.listen({ port: PORT, host: "0.0.0.0" }).then(() => {
    console.log(`🚀 [${PORT}] LC79 v8 · 72 modules online`);
    setTimeout(() => { fetchHu().catch(() => {}); fetchMd5().catch(() => {}); }, 100);
    setInterval(() => fetchHu().catch(() => {}), 6000);
    setInterval(() => fetchMd5().catch(() => {}), 6000);
}).catch(err => { console.error("Boot:", err.message); process.exit(1); });