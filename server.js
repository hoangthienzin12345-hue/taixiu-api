// ═══════════════════════════════════════════════════════════════════════════════
//  TÀI XỈU LC79 — CẦU CƠ BẢN + 37 THUẬT TOÁN (FIXED)
//  Mỗi thuật toán thực sự dự đoán NEXT bit, không copy last
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

// ─── FETCH & PARSE ──────────────────────────────────────────────────────────
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
        return { id: String(x.id ?? x._id ?? x.sessionId ?? ""), id_num: idNum, r, dices: x.dices || x.dice || [], point };
    }).filter(x => x.id && x.r && x.id_num > 0).sort((a, b) => a.id_num - b.id_num);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  🔧 HELPER: Pattern-matching dự đoán next bit
// ═══════════════════════════════════════════════════════════════════════════════
function ctxNext(bits, ctxLen) {
    const n = bits.length;
    if (n < ctxLen + 3) return null;
    const ctx = bits.slice(-ctxLen);
    let t = 0, x = 0;
    for (let i = ctxLen; i < n - 1; i++) {
        let match = true;
        for (let j = 0; j < ctxLen; j++) {
            if (bits[i - ctxLen + j] !== ctx[j]) { match = false; break; }
        }
        if (match) {
            if (bits[i] === 1) t++;
            else x++;
        }
    }
    if (t + x < 3) return null;
    return { pT: t / (t + x), n: t + x };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CẦU CƠ BẢN (7)
// ═══════════════════════════════════════════════════════════════════════════════
function cau11(bits) {
    if (bits.length < 4) return null;
    const r = bits.slice(-4);
    if (r[0] !== r[1] && r[1] !== r[2] && r[2] !== r[3])
        return { pT: 1 - r[3], weight: 3.5, name: "Cầu 1-1" };
    return null;
}
function cau12(bits) {
    if (bits.length < 6) return null;
    const r = bits.slice(-6);
    if (r[0] !== r[1] && r[1] === r[2] && r[3] !== r[4] && r[4] === r[5] && r[0] === r[3])
        return { pT: r[0], weight: 3, name: "Cầu 1-2" };
    return null;
}
function cau21(bits) {
    if (bits.length < 6) return null;
    const r = bits.slice(-6);
    if (r[0] === r[1] && r[1] !== r[2] && r[3] === r[4] && r[4] !== r[5] && r[0] === r[3])
        return { pT: r[0], weight: 3, name: "Cầu 2-1" };
    return null;
}
function cau22(bits) {
    if (bits.length < 4) return null;
    const r = bits.slice(-4);
    if (r[0] === r[1] && r[2] === r[3] && r[0] !== r[2])
        return { pT: r[0], weight: 3.5, name: "Cầu 2-2" };
    return null;
}
function cau33(bits) {
    if (bits.length < 6) return null;
    const r = bits.slice(-6);
    if (r[0] === r[1] && r[1] === r[2] && r[3] === r[4] && r[4] === r[5] && r[0] !== r[3])
        return { pT: r[0], weight: 4, name: "Cầu 3-3" };
    return null;
}
function cau44(bits) {
    if (bits.length < 8) return null;
    const r = bits.slice(-8);
    if (r[0] === r[1] && r[1] === r[2] && r[2] === r[3] &&
        r[4] === r[5] && r[5] === r[6] && r[6] === r[7] && r[0] !== r[4])
        return { pT: r[0], weight: 4, name: "Cầu 4-4" };
    return null;
}
function cauBet(bits) {
    const n = bits.length;
    if (n < 2) return null;
    let run = 1;
    for (let i = n - 2; i >= 0; i--) {
        if (bits[i] === bits[n - 1]) run++;
        else break;
    }
    if (run >= 2 && run <= 5)
        return { pT: bits[n - 1], weight: 1.5 + run * 0.3, name: `Bệt ${run} follow` };
    if (run >= 6)
        return { pT: 1 - bits[n - 1], weight: 2.5 + (run - 6) * 0.4, name: `Bệt ${run} break` };
    return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  FOURIER (6)
// ═══════════════════════════════════════════════════════════════════════════════
function algoFFT(bits) {
    const n = bits.length;
    if (n < 8) return null;
    let best = { k: 0, mag: 0 };
    for (let k = 1; k <= Math.min(15, Math.floor(n / 2)); k++) {
        let re = 0, im = 0;
        for (let t = 0; t < n; t++) {
            const th = -2 * Math.PI * k * t / n;
            re += bits[t] * Math.cos(th);
            im += bits[t] * Math.sin(th);
        }
        const mag = Math.hypot(re, im) / n;
        if (mag > best.mag) best = { k, mag };
    }
    if (best.mag < 0.1) return null;
    return { pT: bits[n - best.k], weight: Math.min(best.mag * 4, 3), name: `FFT k=${best.k}` };
}

function algoACF1(bits) {
    const n = bits.length;
    if (n < 10) return null;
    let match = 0;
    for (let i = 0; i < n - 1; i++) if (bits[i] === bits[i + 1]) match++;
    const c = match / (n - 1);
    const w = Math.abs(c - 0.5) * 5;
    if (w < 0.3) return null;
    return { pT: c > 0.5 ? bits[n - 1] : 1 - bits[n - 1], weight: Math.min(w, 2.5), name: `ACF L1 (${c.toFixed(2)})` };
}

function algoACF2(bits) {
    const n = bits.length;
    if (n < 12) return null;
    let match = 0;
    for (let i = 0; i < n - 2; i++) if (bits[i] === bits[i + 2]) match++;
    const c = match / (n - 2);
    const w = Math.abs(c - 0.5) * 5;
    if (w < 0.3) return null;
    return { pT: c > 0.5 ? bits[n - 2] : 1 - bits[n - 2], weight: Math.min(w, 2.5), name: `ACF L2 (${c.toFixed(2)})` };
}

// 🔧 FIXED: Dùng FFT dominant period thực sự
function algoSpecFlat(bits) {
    const n = bits.length;
    if (n < 8) return null;
    const psd = [];
    let domK = 0, maxMag = 0;
    for (let k = 1; k <= Math.floor(n / 2); k++) {
        let re = 0, im = 0;
        for (let t = 0; t < n; t++) {
            const th = -2 * Math.PI * k * t / n;
            re += bits[t] * Math.cos(th);
            im += bits[t] * Math.sin(th);
        }
        const mag = Math.hypot(re, im) / n;
        psd.push(mag * mag);
        if (mag > maxMag) { maxMag = mag; domK = k; }
    }
    const logSum = psd.reduce((a, x) => a + Math.log(x + 1e-9), 0) / psd.length;
    const arith = psd.reduce((a, x) => a + x, 0) / psd.length;
    const flat = Math.exp(logSum) / (arith + 1e-9);
    // Low flatness + strong FFT → predict via period
    if (flat < 0.55 && domK > 0 && domK < n && maxMag > 0.12) {
        return { pT: bits[n - domK], weight: Math.min((1 - flat) * 2.5, 2.5), name: `SpecFlat f=${flat.toFixed(2)} k=${domK}` };
    }
    return null;
}

function algoZCR(bits) {
    const n = bits.length;
    if (n < 8) return null;
    let zc = 0;
    for (let i = 1; i < n; i++) if (bits[i] !== bits[i - 1]) zc++;
    const rate = zc / (n - 1);
    const last = bits[n - 1];
    if (rate > 0.7) return { pT: 1 - last, weight: Math.min((rate - 0.5) * 4, 2.5), name: `ZCR↑ (${rate.toFixed(2)})` };
    if (rate < 0.3) return { pT: last, weight: Math.min((0.5 - rate) * 4, 2.5), name: `ZCR↓ (${rate.toFixed(2)})` };
    return null;
}

function algoSpecCent(bits) {
    const n = bits.length;
    if (n < 8) return null;
    let num = 0, den = 0;
    for (let k = 1; k <= Math.floor(n / 2); k++) {
        let re = 0, im = 0;
        for (let t = 0; t < n; t++) {
            const th = -2 * Math.PI * k * t / n;
            re += bits[t] * Math.cos(th);
            im += bits[t] * Math.sin(th);
        }
        const mag = Math.hypot(re, im);
        num += k * mag;
        den += mag;
    }
    if (den === 0) return null;
    const norm = (num / den) / (n / 2);
    const last = bits[n - 1];
    if (norm < 0.3) return { pT: last, weight: 1.5, name: `SpecCent↓ (${norm.toFixed(2)})` };
    if (norm > 0.7) return { pT: 1 - last, weight: 1.5, name: `SpecCent↑ (${norm.toFixed(2)})` };
    return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  WAVELET (1)
// ═══════════════════════════════════════════════════════════════════════════════
function algoHaar(bits) {
    const n = bits.length;
    if (n < 16) return null;
    let lowE = 0, highE = 0;
    for (let i = 0; i < n - 1; i += 2) {
        const a = bits[i], b = bits[i + 1];
        lowE += ((a + b) / 2) ** 2;
        highE += ((a - b) / 2) ** 2;
    }
    const tot = lowE + highE;
    if (tot === 0) return null;
    const highRatio = highE / tot;
    const last = bits[n - 1];
    if (highRatio > 0.5) return { pT: 1 - last, weight: Math.min(highRatio * 3, 2.5), name: `Haar↑ (${highRatio.toFixed(2)})` };
    return { pT: last, weight: Math.min((1 - highRatio) * 3, 2.5), name: `Haar↓ (${(1 - highRatio).toFixed(2)})` };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  BAYES / INFO (9)
// ═══════════════════════════════════════════════════════════════════════════════
function algoBayes(bits) {
    const n = bits.length;
    if (n < 10) return null;
    let a = 1, b = 1;
    for (let i = 0; i < n; i++) {
        const w = Math.pow(0.95, n - 1 - i);
        if (bits[i] === 1) a += w; else b += w;
    }
    const pT = a / (a + b);
    const w = Math.abs(pT - 0.5) * 4;
    if (w < 0.3) return null;
    return { pT, weight: Math.min(w, 3), name: `Bayes (${pT.toFixed(2)})` };
}

function algoWeighted(bits) {
    const n = bits.length;
    if (n < 15) return null;
    const w = Math.min(n, 20);
    const s = bits.slice(-w);
    let num = 0, den = 0;
    for (let i = 0; i < s.length; i++) { const wt = i + 1; num += s[i] * wt; den += wt; }
    const pT = num / den;
    return { pT, weight: Math.min(Math.abs(pT - 0.5) * 3.5, 2.5), name: `Weighted20` };
}

function algoTransEnt(bits) {
    const n = bits.length;
    if (n < 12) return null;
    let tt = 0, tx = 0, xt = 0, xx = 0;
    for (let i = 1; i < n; i++) {
        if (bits[i - 1] === 1 && bits[i] === 1) tt++;
        else if (bits[i - 1] === 1) tx++;
        else if (bits[i] === 1) xt++;
        else xx++;
    }
    const last = bits[n - 1];
    const t = last === 1 ? tt : xt;
    const x = last === 1 ? tx : xx;
    const tot = t + x;
    if (tot < 3) return null;
    const pT = t / tot;
    return { pT, weight: Math.min(Math.abs(pT - 0.5) * 4, 2.5), name: `TransEnt` };
}

// 🔧 FIXED: RLE thực sự dùng run-length stats để quyết định break/continue
function algoRLEEnt(bits) {
    const n = bits.length;
    if (n < 12) return null;
    const runs = [];
    let cur = bits[0], len = 1;
    for (let i = 1; i < n; i++) {
        if (bits[i] === cur) len++;
        else { runs.push(len); cur = bits[i]; len = 1; }
    }
    runs.push(len);
    const currentLen = runs[runs.length - 1];
    const hist = runs.slice(0, -1);
    if (hist.length < 3) return null;
    const avgLen = hist.reduce((a, b) => a + b, 0) / hist.length;
    const freq = {};
    for (const r of hist) freq[r] = (freq[r] || 0) + 1;
    let H = 0;
    for (const c of Object.values(freq)) { const p = c / hist.length; H -= p * Math.log2(p); }
    const norm = H / Math.log2(hist.length + 1);
    if (norm >= 0.7) return null;
    const last = bits[n - 1];
    if (currentLen >= avgLen + 1) {
        // Đã dài hơn trung bình → dự đoán bẻ
        return { pT: 1 - last, weight: Math.min((currentLen / avgLen - 1) * 2 + 1.2, 2.8), name: `RLE break (${currentLen}>${avgLen.toFixed(1)})` };
    }
    if (currentLen < avgLen - 1) {
        // Ngắn hơn trung bình → dự đoán tiếp
        return { pT: last, weight: Math.min((1 - currentLen / avgLen) * 2, 2), name: `RLE cont (${currentLen}<${avgLen.toFixed(1)})` };
    }
    return null;
}

function algoMI(bits) {
    const n = bits.length;
    if (n < 15) return null;
    let c00 = 0, c01 = 0, c10 = 0, c11 = 0;
    for (let i = 0; i < n - 1; i++) {
        if (bits[i] === 0 && bits[i + 1] === 0) c00++;
        else if (bits[i] === 0 && bits[i + 1] === 1) c01++;
        else if (bits[i] === 1 && bits[i + 1] === 0) c10++;
        else c11++;
    }
    const tot = n - 1;
    const p1 = (c10 + c11) / tot;
    const p0 = 1 - p1;
    let mi = 0;
    for (const [c, a, b] of [[c00, 0, 0], [c01, 0, 1], [c10, 1, 0], [c11, 1, 1]]) {
        if (c === 0) continue;
        const pj = c / tot, pa = a === 1 ? p1 : p0, pb = b === 1 ? p1 : p0;
        mi += pj * Math.log2(pj / (pa * pb + 1e-9));
    }
    if (mi < 0.03) return null;
    const last = bits[n - 1];
    const t = last === 1 ? c11 : c01;
    const x = last === 1 ? c10 : c00;
    if (t + x < 2) return null;
    return { pT: t / (t + x), weight: Math.min(mi * 3, 2), name: `MI (${mi.toFixed(2)})` };
}

function algoMirror(bits) {
    const n = bits.length;
    if (n < 8) return null;
    const k = Math.min(4, Math.floor(n / 2));
    const first = bits.slice(-2 * k, -k);
    const second = bits.slice(-k);
    const rev = [...first].reverse();
    if (rev.every((v, i) => v === second[i]))
        return { pT: 1 - first[0], weight: 1.8, name: "Mirror" };
    return null;
}

// 🔧 FIXED: dùng pattern matching
function algoCompress(bits) {
    const r = ctxNext(bits, 2) || ctxNext(bits, 3);
    if (!r || r.n < 3) return null;
    return { pT: r.pT, weight: Math.min(r.n / 3, 2.2), name: `Compress n=${r.n}` };
}

// 🔧 FIXED: dùng pattern matching (proxy for KC)
function algoKC(bits) {
    const r = ctxNext(bits, 2);
    if (!r || r.n < 3) return null;
    return { pT: r.pT, weight: Math.min(r.n / 4, 2), name: `KC n=${r.n}` };
}

// 🔧 FIXED: majority + streak logic, không copy last
function algoShannon(bits) {
    const n = bits.length;
    if (n < 10) return null;
    const p1 = bits.reduce((a, b) => a + b, 0) / n;
    const H = (p1 <= 0 || p1 >= 1) ? 0 : -(p1 * Math.log2(p1) + (1 - p1) * Math.log2(1 - p1));
    if (H >= 0.75) return null;
    const domBit = p1 > 0.5 ? 1 : 0;
    const last = bits[n - 1];
    let streak = 1;
    for (let i = n - 2; i >= 0; i--) {
        if (bits[i] === last) streak++;
        else break;
    }
    if (last !== domBit && streak >= 3) {
        return { pT: domBit, weight: Math.min((1 - H) * 2.5, 2.5), name: `Shannon flip H=${H.toFixed(2)}` };
    }
    if (last === domBit && streak <= 2) {
        return { pT: domBit, weight: Math.min((1 - H) * 1.8, 2), name: `Shannon cont H=${H.toFixed(2)}` };
    }
    return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  REGRESSION (8)
// ═══════════════════════════════════════════════════════════════════════════════
function algoLinTrend(bits) {
    const n = bits.length;
    if (n < 10) return null;
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { sx += i; sy += bits[i]; sxy += i * bits[i]; sxx += i * i; }
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx + 1e-9);
    const w = Math.min(Math.abs(slope) * 25, 3);
    if (w < 0.2) return null;
    const pred = Math.max(0, Math.min(1, 0.5 + slope * 10));
    return { pT: pred, weight: w, name: `LinTrend (${slope.toFixed(3)})` };
}

function algoQuad(bits) {
    const n = bits.length;
    if (n < 15) return null;
    const half = Math.floor(n / 2);
    const m1 = bits.slice(0, half).reduce((a, b) => a + b, 0) / half;
    const m2 = bits.slice(half).reduce((a, b) => a + b, 0) / (n - half);
    const trend = m2 - m1;
    if (Math.abs(trend) < 0.1) return null;
    return { pT: trend > 0 ? 0.65 : 0.35, weight: Math.min(Math.abs(trend) * 4, 2), name: `Quad (${trend.toFixed(2)})` };
}

function algoMedRev(bits) {
    const n = bits.length;
    if (n < 10) return null;
    const w = Math.min(n, 10);
    const mean = bits.slice(-w).reduce((a, b) => a + b, 0) / w;
    if (mean > 0.7) return { pT: 0.3, weight: Math.min((mean - 0.5) * 5, 2.5), name: `MedRev↓` };
    if (mean < 0.3) return { pT: 0.7, weight: Math.min((0.5 - mean) * 5, 2.5), name: `MedRev↑` };
    return null;
}

function algoLinExtrap(bits) {
    const n = bits.length;
    if (n < 8) return null;
    const k = Math.min(6, n);
    const s = bits.slice(-k);
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (let i = 0; i < k; i++) { sx += i; sy += s[i]; sxy += i * s[i]; sxx += i * i; }
    const slope = (k * sxy - sx * sy) / (k * sxx - sx * sx + 1e-9);
    const intercept = (sy - slope * sx) / k;
    const pred = Math.max(0, Math.min(1, slope * k + intercept));
    return { pT: pred, weight: Math.min(Math.abs(slope) * 12, 2), name: `LinExtra` };
}

function algoPolyExtrap(bits) {
    const n = bits.length;
    if (n < 10) return null;
    const k = Math.min(8, n);
    const s = bits.slice(-k);
    const d1 = s[k - 1] - s[k - 2];
    const d2 = (s[k - 1] - s[k - 2]) - (s[k - 2] - s[k - 3]);
    const pred = Math.max(0, Math.min(1, s[k - 1] + d1 + d2 * 0.5));
    return { pT: pred, weight: Math.min(Math.abs(d1 + d2) * 2, 2), name: `PolyExtra` };
}

function algoEMA(bits) {
    const n = bits.length;
    if (n < 10) return null;
    let ema = bits[0];
    for (let i = 1; i < n; i++) ema = 0.3 * bits[i] + 0.7 * ema;
    return { pT: ema, weight: Math.min(Math.abs(ema - 0.5) * 4, 2.5), name: `EMA (${ema.toFixed(2)})` };
}

function algoTheilSen(bits) {
    const n = bits.length;
    if (n < 8) return null;
    const slopes = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) slopes.push((bits[j] - bits[i]) / (j - i));
    slopes.sort((a, b) => a - b);
    const mid = Math.floor(slopes.length / 2);
    const slope = slopes.length % 2 ? slopes[mid] : (slopes[mid - 1] + slopes[mid]) / 2;
    const pred = Math.max(0, Math.min(1, bits[n - 1] + slope * 2));
    return { pT: pred, weight: Math.min(Math.abs(slope) * 20, 2.5), name: `TheilSen (${slope.toFixed(3)})` };
}

function algoRANSAC(bits) {
    const n = bits.length;
    if (n < 10) return null;
    let bestInliers = 0, bestSlope = 0;
    for (let it = 0; it < 20; it++) {
        const i1 = Math.floor(Math.random() * n);
        const i2 = Math.floor(Math.random() * n);
        if (i1 === i2) continue;
        const slope = (bits[i2] - bits[i1]) / (i2 - i1);
        const intercept = bits[i1] - slope * i1;
        let inliers = 0;
        for (let k = 0; k < n; k++) if (Math.abs(slope * k + intercept - bits[k]) < 0.3) inliers++;
        if (inliers > bestInliers) { bestInliers = inliers; bestSlope = slope; }
    }
    if (bestInliers < n * 0.4) return null;
    const pred = Math.max(0, Math.min(1, bits[n - 1] + bestSlope * 2));
    return { pT: pred, weight: (bestInliers / n) * 2.5, name: `RANSAC (${bestInliers}/${n})` };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ADVANCED (12)
// ═══════════════════════════════════════════════════════════════════════════════
function algoCUSUM(bits) {
    const n = bits.length;
    if (n < 15) return null;
    let sPos = 0, sNeg = 0;
    for (const b of bits) {
        sPos = Math.max(0, sPos + (b - 0.5));
        sNeg = Math.min(0, sNeg + (b - 0.5));
        if (sPos > 3) return { pT: 0, weight: 2, name: "CUSUM↑" };
        if (sNeg < -3) return { pT: 1, weight: 2, name: "CUSUM↓" };
    }
    return null;
}

function algoVR(bits) {
    const n = bits.length;
    if (n < 15) return null;
    const diffs = [];
    for (let i = 1; i < n; i++) diffs.push(bits[i] - bits[i - 1]);
    const var1 = diffs.reduce((a, b) => a + b * b, 0) / diffs.length;
    const q = 4;
    const diffsQ = [];
    for (let i = q; i < n; i++) diffsQ.push(bits[i] - bits[i - q]);
    const varQ = diffsQ.reduce((a, b) => a + b * b, 0) / diffsQ.length;
    const vr = varQ / (q * var1 + 1e-9);
    const last = bits[n - 1];
    if (vr > 1.3) return { pT: last, weight: Math.min((vr - 1) * 2, 2.5), name: `VR trend (${vr.toFixed(2)})` };
    if (vr < 0.7) return { pT: 1 - last, weight: Math.min((1 - vr) * 2, 2.5), name: `VR revert (${vr.toFixed(2)})` };
    return null;
}

function algoHurst(bits) {
    const n = bits.length;
    if (n < 16) return null;
    const lags = [4, 8, 16].filter(l => l <= n);
    if (lags.length < 2) return null;
    const rs = [];
    for (const l of lags) {
        const seg = bits.slice(-l);
        const m = seg.reduce((a, b) => a + b, 0) / l;
        let cum = 0, mx = -Infinity, mn = Infinity;
        for (const v of seg) { cum += v - m; mx = Math.max(mx, cum); mn = Math.min(mn, cum); }
        const R = mx - mn;
        const sd = Math.sqrt(seg.reduce((a, b) => a + (b - m) ** 2, 0) / l);
        rs.push(sd > 0 ? R / sd : 1);
    }
    const logs = lags.map((l, i) => [Math.log(l), Math.log(rs[i] + 1e-9)]);
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (const [x, y] of logs) { sx += x; sy += y; sxy += x * y; sxx += x * x; }
    const k = logs.length;
    const H = (k * sxy - sx * sy) / (k * sxx - sx * sx + 1e-9);
    const last = bits[n - 1];
    if (H > 0.6) return { pT: last, weight: Math.min((H - 0.5) * 4, 2.5), name: `Hurst (${H.toFixed(2)}) trend` };
    if (H < 0.4) return { pT: 1 - last, weight: Math.min((0.5 - H) * 4, 2.5), name: `Hurst (${H.toFixed(2)}) rev` };
    return null;
}

function algoXCorr(bits) {
    const n = bits.length;
    if (n < 15) return null;
    const lag = 2;
    const a = bits.slice(0, -lag), b = bits.slice(lag);
    let ma = 0, mb = 0;
    for (let i = 0; i < a.length; i++) { ma += a[i]; mb += b[i]; }
    ma /= a.length; mb /= b.length;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < a.length; i++) {
        num += (a[i] - ma) * (b[i] - mb);
        da += (a[i] - ma) ** 2;
        db += (b[i] - mb) ** 2;
    }
    const corr = num / (Math.sqrt(da * db) + 1e-9);
    const last = bits[n - 1];
    if (corr > 0.3) return { pT: last, weight: Math.min(corr * 2.5, 2), name: `XCorr (${corr.toFixed(2)})` };
    if (corr < -0.3) return { pT: 1 - last, weight: Math.min(-corr * 2.5, 2), name: `XCorr (${corr.toFixed(2)})` };
    return null;
}

function algoEntRate(bits) {
    const n = bits.length;
    if (n < 12) return null;
    let tt = 0, tx = 0, xt = 0, xx = 0;
    for (let i = 1; i < n; i++) {
        if (bits[i - 1] === 1 && bits[i] === 1) tt++;
        else if (bits[i - 1] === 1) tx++;
        else if (bits[i] === 1) xt++;
        else xx++;
    }
    const tot = n - 1;
    const pT = (tt + xt) / tot;
    const pPrev1 = (tt + tx) / tot;
    const pPrev0 = 1 - pPrev1;
    let H = 0;
    for (const [c, prev, next] of [[tt, 1, 1], [tx, 1, 0], [xt, 0, 1], [xx, 0, 0]]) {
        if (c === 0) continue;
        const pj = c / tot;
        const pp = prev === 1 ? pPrev1 : pPrev0;
        const pn = next === 1 ? pT : 1 - pT;
        H += pj * Math.log2(pj / (pp * pn + 1e-9));
    }
    if (H < 0.4) {
        const last = bits[n - 1];
        const t = last === 1 ? tt : xt;
        const x = last === 1 ? tx : xx;
        if (t + x < 2) return null;
        return { pT: t / (t + x), weight: (1 - H) * 2.5, name: `EntRate (${H.toFixed(2)})` };
    }
    return null;
}

// 🔧 FIXED: dùng pattern matching
function algoLZ(bits) {
    const r = ctxNext(bits, 3);
    if (!r || r.n < 2) return null;
    return { pT: r.pT, weight: Math.min(r.n / 2.5, 2), name: `LZ n=${r.n}` };
}

// 🔧 FIXED: dùng pattern matching khi PE thấp
function algoPE(bits) {
    const n = bits.length;
    if (n < 12) return null;
    const m = 3;
    const counts = {};
    for (let i = 0; i <= n - m; i++) {
        const w = bits.slice(i, i + m);
        const perm = w.map((v, idx) => ({ v, idx })).sort((a, b) => a.v - b.v).map(x => x.idx).join("");
        counts[perm] = (counts[perm] || 0) + 1;
    }
    const tot = n - m + 1;
    let H = 0;
    for (const c of Object.values(counts)) { const p = c / tot; H -= p * Math.log2(p); }
    const norm = H / Math.log2(6);
    if (norm >= 0.75) return null;
    const r = ctxNext(bits, 3);
    if (!r) return null;
    return { pT: r.pT, weight: Math.min((1 - norm) * 2.5, 2.2), name: `PE (${norm.toFixed(2)}) n=${r.n}` };
}

// 🔧 FIXED: nearest-neighbor prediction thực sự
function algoRQA(bits) {
    const n = bits.length;
    if (n < 12) return null;
    const dim = 3;
    const m = n - dim;
    if (m < 3) return null;
    const vec = [];
    for (let i = 0; i < m; i++) vec.push(bits.slice(i, i + dim));
    const cur = bits.slice(-dim);
    let bestDist = Infinity, bestIdx = -1;
    for (let i = 0; i < m - 1; i++) {
        let d = 0;
        for (let k = 0; k < dim; k++) d += (vec[i][k] - cur[k]) ** 2;
        d = Math.sqrt(d);
        if (d < bestDist && d > 0) { bestDist = d; bestIdx = i; }
    }
    if (bestIdx < 0 || bestDist > 1.0) return null;
    const nextIdx = bestIdx + dim;
    if (nextIdx >= n) return null;
    return { pT: bits[nextIdx], weight: Math.min((1.5 - bestDist) * 2, 2.2), name: `RQA nn d=${bestDist.toFixed(2)}` };
}

// 🔧 FIXED: dùng pattern matching
function algoApEn(bits) {
    const r = ctxNext(bits, 2);
    if (!r || r.n < 2) return null;
    return { pT: r.pT, weight: Math.min(r.n / 3, 1.8), name: `ApEn n=${r.n}` };
}

// 🔧 FIXED: dùng pattern matching
function algoSampEn(bits) {
    const r = ctxNext(bits, 2);
    if (!r || r.n < 2) return null;
    return { pT: r.pT, weight: Math.min(r.n / 3, 1.8), name: `SampEn n=${r.n}` };
}

function algoDFA(bits) {
    const n = bits.length;
    if (n < 16) return null;
    const scales = [4, 8, 16].filter(s => s < n / 2);
    if (scales.length < 2) return null;
    const fluct = [];
    for (const s of scales) {
        const F = [];
        for (let i = 0; i + s <= n; i += s) {
            const seg = bits.slice(i, i + s);
            const m = seg.reduce((a, b) => a + b, 0) / s;
            const trend = seg.reduce((a, v, idx) => a + (v - m) * (idx - s / 2), 0) /
                          (seg.reduce((a, _, idx) => a + (idx - s / 2) ** 2, 0) + 1e-9);
            let f = 0;
            for (let idx = 0; idx < s; idx++) {
                const pred = m + trend * (idx - s / 2);
                f += (seg[idx] - pred) ** 2;
            }
            F.push(Math.sqrt(f / s));
        }
        fluct.push([s, F.reduce((a, b) => a + b, 0) / F.length]);
    }
    const logs = fluct.map(([s, f]) => [Math.log(s), Math.log(f + 1e-9)]);
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (const [x, y] of logs) { sx += x; sy += y; sxy += x * y; sxx += x * x; }
    const k = logs.length;
    const H = (k * sxy - sx * sy) / (k * sxx - sx * sx + 1e-9);
    const last = bits[n - 1];
    if (H > 0.6) return { pT: last, weight: Math.min((H - 0.5) * 3, 2.5), name: `DFA (${H.toFixed(2)}) trend` };
    if (H < 0.4) return { pT: 1 - last, weight: Math.min((0.5 - H) * 3, 2.5), name: `DFA (${H.toFixed(2)}) rev` };
    return null;
}

function algoConsensus(bits) {
    let t = 0, x = 0;
    for (const fn of [algoACF1, algoACF2, algoBayes, algoWeighted, algoEMA, algoLinTrend]) {
        try {
            const s = fn(bits);
            if (s) { if (s.pT > 0.5) t++; else x++; }
        } catch (e) {}
    }
    if (t + x < 3) return null;
    return { pT: t / (t + x), weight: 1.5, name: `Consensus ${t}:${x}` };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PREDICT — Kết hợp + chống "copy last"
// ═══════════════════════════════════════════════════════════════════════════════
const ALL_CAU = [cau11, cau12, cau21, cau22, cau33, cau44, cauBet];
const ALL_ALGOS = [
    algoFFT, algoACF1, algoACF2, algoSpecFlat, algoZCR, algoSpecCent,
    algoHaar,
    algoBayes, algoWeighted, algoTransEnt, algoRLEEnt, algoMI, algoMirror,
    algoCompress, algoKC, algoShannon,
    algoLinTrend, algoQuad, algoMedRev, algoLinExtrap, algoPolyExtrap,
    algoEMA, algoTheilSen, algoRANSAC,
    algoCUSUM, algoVR, algoHurst, algoXCorr, algoEntRate, algoLZ, algoPE,
    algoRQA, algoApEn, algoSampEn, algoDFA, algoConsensus,
];

function predict(seq) {
    const bits = seq.map(x => x === "T" ? 1 : 0);
    if (bits.length < 20) return null;

    const signals = [];
    for (const fn of ALL_CAU) {
        try { const s = fn(bits); if (s) signals.push({ ...s, source: "cau" }); } catch (e) {}
    }
    for (const fn of ALL_ALGOS) {
        try { const s = fn(bits); if (s) signals.push({ ...s, source: "algo" }); } catch (e) {}
    }

    if (!signals.length) return { prediction: "CHỜ", confidence: 0, method: "Không có tín hiệu", signals: [] };

    // Weighted vote với prior 50/50
    let tScore = 1.0, xScore = 1.0;
    for (const s of signals) {
        const w = s.weight;
        tScore += w * s.pT;
        xScore += w * (1 - s.pT);
    }
    const total = tScore + xScore;
    const pT = tScore / total;
    const prediction = pT >= 0.5 ? "TAI" : "XIU";
    let confidence = Math.round(50 + Math.abs(pT - 0.5) * 90);

    // 🔧 DIAGNOSTIC: Đếm continue vs reversal
    const lastBit = bits[bits.length - 1];
    let continueW = 0, reversalW = 0;
    let cauContinue = 0, cauReversal = 0, algoContinue = 0, algoReversal = 0;
    for (const s of signals) {
        const predBit = s.pT >= 0.5 ? 1 : 0;
        const isCont = predBit === lastBit;
        if (isCont) continueW += s.weight;
        else reversalW += s.weight;
        if (s.source === "cau") { if (isCont) cauContinue++; else cauReversal++; }
        else { if (isCont) algoContinue++; else algoReversal++; }
    }
    const continueRatio = continueW / (continueW + reversalW + 1e-9);
    const predIsContinue = (prediction === "TAI" && lastBit === 1) || (prediction === "XIU" && lastBit === 0);

    // 🔧 CHỐNG COPY LAST: giảm conf nếu quá "continue-heavy"
    if (reversalW === 0) {
        // Không có tín hiệu nào đảo chiều → chỉ copy last → cap 52%
        confidence = Math.min(confidence, 52);
    } else if (predIsContinue && continueRatio > 0.92) {
        confidence = Math.min(confidence, 56);
    } else if (predIsContinue && continueRatio > 0.82) {
        confidence = Math.min(confidence, 63);
    }
    if (!predIsContinue && continueRatio > 0.75) {
        confidence = Math.min(confidence, 60);
    }

    return {
        prediction,
        confidence: Math.min(95, Math.max(50, confidence)),
        pT,
        continueRatio,
        cauContinue, cauReversal, algoContinue, algoReversal,
        method: `${signals.length} tín hiệu (${cauContinue + cauReversal}c + ${algoContinue + algoReversal}a) · continue ${(continueRatio * 100).toFixed(0)}%`,
        signals: signals.sort((a, b) => b.weight - a.weight),
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════════════════════════
const state = {
    md5: { sessions: [], lastId: null, pred: null, latest: null },
    hu:  { sessions: [], lastId: null, pred: null, latest: null },
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

    const recent = st.sessions.slice(-MAX);
    st.latest = recent[recent.length - 1];
    st.pred = predict(recent.map(s => s.r));
}

async function poll(key) {
    try {
        const json = await fetchJSON(API[key]);
        update(key, parseRows(json));
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
    const last = st.latest, p = st.pred;

    let duDoan = "CHỜ", tyLe = "--";
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

const checkKey = q => q.key === VALID_KEY ? { valid: true } : { valid: false, error: `Sai key! Ib ${ADMIN}` };

// ═══════════════════════════════════════════════════════════════════════════════
//  SERVER
// ═══════════════════════════════════════════════════════════════════════════════
const app = fastify({ logger: false, disableRequestLogging: true });
await app.register(cors, { origin: "*" });

app.get("/", async () => ({
    status: "ok",
    admin: ADMIN,
    engine: `${ALL_CAU.length} cầu + ${ALL_ALGOS.length} thuật toán (FIXED)`,
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
    if (!st.latest || !st.pred) return rep.status(503).send({ error: "Chưa đủ dữ liệu" });

    const lastBit = st.latest.r === "T" ? 1 : 0;
    return {
        last: {
            id: st.latest.id_num,
            result: st.latest.r,
            dices: st.latest.dices,
            point: st.latest.point,
        },
        prediction: {
            pred: st.pred.prediction,
            confidence: st.pred.confidence,
            pT: +(st.pred.pT * 100).toFixed(2),
            is_continue: st.pred.prediction === (lastBit ? "TAI" : "XIU"),
            method: st.pred.method,
        },
        // 🔍 DIAGNOSTIC
        continue_ratio: +(st.pred.continueRatio * 100).toFixed(0) + "%",
        cau: { continue: st.pred.cauContinue, reversal: st.pred.cauReversal },
        algo: { continue: st.pred.algoContinue, reversal: st.pred.algoReversal },
        cau_signals: st.pred.signals.filter(s => s.source === "cau"),
        algo_signals: st.pred.signals.filter(s => s.source === "algo").slice(0, 20),
    };
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
║  🎲 TÀI XỈU LC79 — CẦU + 37 THUẬT TOÁN (FIXED)                       ║
╠══════════════════════════════════════════════════════════════════════╣
║  🚀 Port: ${PORT}
║  🔑 Key : ${VALID_KEY}
║  👤 Admin: ${ADMIN}
║  🔧 Đã fix: 10 algo không còn copy last bit
║  🎯 Cầu: ${ALL_CAU.length} (1-1, 1-2, 2-1, 2-2, 3-3, 4-4, Bệt)
║  🧠 Algorithms: ${ALL_ALGOS.length}
║     Fourier(6) · Wavelet(1) · Bayes/Info(9) · Regression(8)
║     Advanced(12) · Consensus(1)
║  📌 HŨ : /api/taixiu/lc79?key=${VALID_KEY}
║  📌 MD5: /api/taixiumd5/lc79?key=${VALID_KEY}
║  🐞 Debug (xem continue/rev ratio): /api/debug/hu?key=${VALID_KEY}
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