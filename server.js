// ═══════════════════════════════════════════════════════════════════════════════
//  TÀI XỈU LC79 — BẢNG ĐIỂM MD5 + FULL CẦU
//  80 cầu pattern + 16 mức bảng điểm + voting
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
//  BẢNG ĐIỂM MD5 (16 mức, theo yêu cầu)
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
//  HELPERS
// ═══════════════════════════════════════════════════════════════════════════════
const opp = x => x === "T" ? "X" : "T";

function getRuns(seq) {
    const out = [];
    for (const x of seq) {
        if (!out.length || out[out.length - 1].v !== x) out.push({ v: x, n: 1 });
        else out[out.length - 1].n++;
    }
    return out;
}

function streakLen(seq) {
    if (!seq.length) return 0;
    const last = seq[seq.length - 1];
    let n = 1;
    for (let i = seq.length - 2; i >= 0; i--) {
        if (seq[i] === last) n++;
        else break;
    }
    return n;
}

function entropy(arr) {
    if (!arr.length) return 0;
    const p = arr.filter(x => x === "T").length / arr.length;
    if (p <= 0 || p >= 1) return 0;
    return -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
}

function freq(seq, w) {
    const s = seq.slice(-w);
    if (!s.length) return 0.5;
    return s.filter(x => x === "T").length / s.length;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  NHÓM 1: CẦU CƠ BẢN (6 cầu)
// ═══════════════════════════════════════════════════════════════════════════════
const cau11 = seq => {
    if (seq.length < 4) return null;
    const r = seq.slice(-4);
    if (r[0] !== r[1] && r[1] !== r[2] && r[2] !== r[3])
        return { pred: opp(r[3]), conf: 72, name: "Cầu 1-1" };
    return null;
};

const cau12 = seq => {
    if (seq.length < 3) return null;
    const r = seq.slice(-3);
    if (r[0] !== r[1] && r[1] === r[2])
        return { pred: r[0], conf: 68, name: "Cầu 1-2" };
    return null;
};

const cau21 = seq => {
    if (seq.length < 3) return null;
    const r = seq.slice(-3);
    if (r[0] === r[1] && r[1] !== r[2])
        return { pred: r[0], conf: 68, name: "Cầu 2-1" };
    return null;
};

const cau22 = seq => {
    if (seq.length < 4) return null;
    const r = seq.slice(-4);
    if (r[0] === r[1] && r[2] === r[3] && r[0] !== r[2])
        return { pred: r[0], conf: 74, name: "Cầu 2-2" };
    return null;
};

const cau33 = seq => {
    if (seq.length < 6) return null;
    const r = seq.slice(-6);
    if (r[0] === r[1] && r[1] === r[2] && r[3] === r[4] && r[4] === r[5] && r[0] !== r[3])
        return { pred: r[0], conf: 78, name: "Cầu 3-3" };
    return null;
};

const cau44 = seq => {
    if (seq.length < 8) return null;
    const r = seq.slice(-8);
    if (r[0] === r[1] && r[1] === r[2] && r[2] === r[3] &&
        r[4] === r[5] && r[5] === r[6] && r[6] === r[7] &&
        r[0] !== r[4])
        return { pred: r[0], conf: 80, name: "Cầu 4-4" };
    return null;
};

// ═══════════════════════════════════════════════════════════════════════════════
//  NHÓM 2: CẦU NHỊP (15 cầu)
// ═══════════════════════════════════════════════════════════════════════════════
const cau121 = seq => {
    if (seq.length < 4) return null;
    const r = seq.slice(-4);
    if (r[0] !== r[1] && r[1] === r[2] && r[0] === r[3])
        return { pred: opp(r[3]), conf: 72, name: "Cầu 1-2-1" };
    return null;
};

const cau212 = seq => {
    if (seq.length < 5) return null;
    const r = seq.slice(-5);
    if (r[0] === r[1] && r[3] === r[4] && r[0] === r[3] && r[0] !== r[2])
        return { pred: r[2], conf: 74, name: "Cầu 2-1-2" };
    return null;
};

const cau131 = seq => {
    if (seq.length < 5) return null;
    const r = seq.slice(-5);
    if (r[0] !== r[1] && r[1] === r[2] && r[2] === r[3] && r[0] === r[4])
        return { pred: opp(r[4]), conf: 72, name: "Cầu 1-3-1" };
    return null;
};

const cau232 = seq => {
    if (seq.length < 7) return null;
    const r = seq.slice(-7);
    if (r[0] === r[1] && r[5] === r[6] && r[0] === r[5] &&
        r[2] === r[3] && r[3] === r[4] && r[0] !== r[2])
        return { pred: opp(r[6]), conf: 74, name: "Cầu 2-3-2" };
    return null;
};

const cau123 = seq => {
    if (seq.length < 6) return null;
    const r = seq.slice(-6);
    if (r[0] !== r[1] && r[1] === r[2] && r[3] === r[4] && r[4] === r[5] && r[2] !== r[3])
        return { pred: opp(r[5]), conf: 72, name: "Cầu 1-2-3" };
    return null;
};

const cau321 = seq => {
    if (seq.length < 6) return null;
    const r = seq.slice(-6);
    if (r[0] === r[1] && r[1] === r[2] && r[3] === r[4] &&
        r[0] !== r[3] && r[4] !== r[5] && r[5] === r[0])
        return { pred: opp(r[5]), conf: 72, name: "Cầu 3-2-1" };
    return null;
};

const cau234 = seq => {
    if (seq.length < 9) return null;
    const r = seq.slice(-9);
    if (r[0] === r[1] && r[2] === r[3] && r[3] === r[4] &&
        r[5] === r[6] && r[6] === r[7] && r[7] === r[8] &&
        r[0] !== r[2] && r[0] === r[5])
        return { pred: opp(r[8]), conf: 74, name: "Cầu 2-3-4" };
    return null;
};

const cau432 = seq => {
    if (seq.length < 9) return null;
    const r = seq.slice(-9);
    if (r[0] === r[1] && r[1] === r[2] && r[2] === r[3] &&
        r[4] === r[5] && r[5] === r[6] &&
        r[7] === r[8] && r[0] === r[7] && r[0] !== r[4])
        return { pred: opp(r[8]), conf: 74, name: "Cầu 4-3-2" };
    return null;
};

const cau132 = seq => {
    if (seq.length < 6) return null;
    const r = seq.slice(-6);
    if (r[0] !== r[1] && r[1] === r[2] && r[2] === r[3] && r[3] !== r[4] && r[4] === r[5] && r[0] === r[4])
        return { pred: opp(r[5]), conf: 72, name: "Cầu 1-3-2" };
    return null;
};

const cau213 = seq => {
    if (seq.length < 6) return null;
    const r = seq.slice(-6);
    if (r[0] === r[1] && r[1] !== r[2] && r[2] !== r[3] &&
        r[3] === r[4] && r[4] === r[5] && r[0] === r[3])
        return { pred: opp(r[5]), conf: 72, name: "Cầu 2-1-3" };
    return null;
};

const cau312 = seq => {
    if (seq.length < 6) return null;
    const r = seq.slice(-6);
    if (r[0] === r[1] && r[1] === r[2] && r[2] !== r[3] &&
        r[3] !== r[4] && r[4] === r[5] && r[0] === r[4])
        return { pred: opp(r[5]), conf: 72, name: "Cầu 3-1-2" };
    return null;
};

const cau242 = seq => {
    if (seq.length < 8) return null;
    const r = seq.slice(-8);
    if (r[0] === r[1] && r[2] === r[3] && r[3] === r[4] && r[4] === r[5] &&
        r[6] === r[7] && r[0] === r[6] && r[0] !== r[2])
        return { pred: opp(r[7]), conf: 74, name: "Cầu 2-4-2" };
    return null;
};

const cau313 = seq => {
    if (seq.length < 7) return null;
    const r = seq.slice(-7);
    if (r[0] === r[1] && r[1] === r[2] && r[2] !== r[3] &&
        r[3] !== r[4] && r[4] === r[5] && r[5] === r[6] && r[0] === r[4])
        return { pred: opp(r[6]), conf: 74, name: "Cầu 3-1-3" };
    return null;
};

const cau141 = seq => {
    if (seq.length < 6) return null;
    const r = seq.slice(-6);
    if (r[0] !== r[1] && r[1] === r[2] && r[2] === r[3] && r[3] === r[4] && r[4] !== r[5] && r[0] === r[5])
        return { pred: opp(r[5]), conf: 72, name: "Cầu 1-4-1" };
    return null;
};

const cau414 = seq => {
    if (seq.length < 9) return null;
    const r = seq.slice(-9);
    if (r[0] === r[1] && r[1] === r[2] && r[2] === r[3] &&
        r[3] !== r[4] && r[4] !== r[5] &&
        r[5] === r[6] && r[6] === r[7] && r[7] === r[8] && r[0] === r[5])
        return { pred: opp(r[8]), conf: 76, name: "Cầu 4-1-4" };
    return null;
};

// ═══════════════════════════════════════════════════════════════════════════════
//  NHÓM 3: BỆT (2-8 + tăng + chuẩn bị gãy)
// ═══════════════════════════════════════════════════════════════════════════════
const cauBetExact = (seq, n) => {
    if (streakLen(seq) !== n) return null;
    const last = seq[seq.length - 1];
    return { pred: opp(last), conf: 60 + n * 2, name: `Cầu bệt ${n}` };
};

const cauBetTang = seq => {
    const r = getRuns(seq);
    if (r.length < 2) return null;
    const cur = r[r.length - 1], prev = r[r.length - 2];
    if (cur.n > prev.n && cur.n >= 3)
        return { pred: cur.v, conf: 65, name: "Bệt tăng tiếp diễn" };
    return null;
};

const cauBetChuanBiGay = seq => {
    const s = streakLen(seq);
    if (s >= 4) {
        const last = seq[seq.length - 1];
        return { pred: opp(last), conf: 68, name: "Bệt chuẩn bị gãy" };
    }
    return null;
};

// ═══════════════════════════════════════════════════════════════════════════════
//  NHÓM 4: RUN LENGTH (tăng/giảm/lặp/gương)
// ═══════════════════════════════════════════════════════════════════════════════
const cauTangDan = seq => {
    const r = getRuns(seq);
    if (r.length < 4) return null;
    const lens = r.slice(-4).map(x => x.n);
    if (lens[0] < lens[1] && lens[1] < lens[2] && lens[2] < lens[3])
        return { pred: seq[seq.length - 1], conf: 62, name: "Tăng dần độ bệt" };
    return null;
};

const cauGiamDan = seq => {
    const r = getRuns(seq);
    if (r.length < 4) return null;
    const lens = r.slice(-4).map(x => x.n);
    if (lens[0] > lens[1] && lens[1] > lens[2] && lens[2] > lens[3])
        return { pred: seq[seq.length - 1], conf: 62, name: "Giảm dần độ bệt" };
    return null;
};

const cauLapDoDai = seq => {
    const r = getRuns(seq);
    if (r.length < 3) return null;
    const lens = r.slice(-3).map(x => x.n);
    if (lens[0] === lens[1] && lens[1] === lens[2])
        return { pred: seq[seq.length - 1], conf: 62, name: "Lặp độ dài" };
    return null;
};

const cauGuongDoDai = seq => {
    const r = getRuns(seq);
    if (r.length < 5) return null;
    const lens = r.slice(-5).map(x => x.n);
    if (lens[0] === lens[4] && lens[1] === lens[3])
        return { pred: seq[seq.length - 1], conf: 62, name: "Gương độ dài" };
    return null;
};

// ═══════════════════════════════════════════════════════════════════════════════
//  NHÓM 5: STATE CHANGE (6 cầu)
// ═══════════════════════════════════════════════════════════════════════════════
const cauDoiNhipSauBet = seq => {
    const r = getRuns(seq);
    if (r.length < 3) return null;
    const lens = r.slice(-3).map(x => x.n);
    if (lens[0] > lens[1] && lens[1] > lens[2] && lens[0] >= 3)
        return { pred: seq[seq.length - 1], conf: 62, name: "Đổi nhịp sau bệt" };
    return null;
};

const cauPhaBetNgan = seq => {
    if (streakLen(seq) !== 2) return null;
    const last = seq[seq.length - 1];
    return { pred: opp(last), conf: 60, name: "Phá bệt ngắn" };
};

const cauSauChuoi2 = seq => {
    if (streakLen(seq) !== 2) return null;
    const last = seq[seq.length - 1];
    return { pred: opp(last), conf: 62, name: "Sau chuỗi 2" };
};

const cauSauChuoi3 = seq => {
    if (streakLen(seq) !== 3) return null;
    const last = seq[seq.length - 1];
    return { pred: opp(last), conf: 64, name: "Sau chuỗi 3" };
};

const cauSauChuoi4Plus = seq => {
    const s = streakLen(seq);
    if (s < 4) return null;
    const last = seq[seq.length - 1];
    return { pred: opp(last), conf: 68, name: "Sau chuỗi 4+" };
};

const cauBienDoiTrangThai = seq => {
    const r = getRuns(seq);
    if (r.length < 4) return null;
    const lens = r.slice(-4).map(x => x.n);
    if (lens[0] === lens[2] && lens[1] === lens[3] && lens[0] !== lens[1])
        return { pred: seq[seq.length - 1], conf: 62, name: "Biến đổi trạng thái" };
    return null;
};

// ═══════════════════════════════════════════════════════════════════════════════
//  NHÓM 6: MARKOV CONTEXT (1-5 + transition)
// ═══════════════════════════════════════════════════════════════════════════════
const cauNguCanh = (seq, k) => {
    if (seq.length < k + 5) return null;
    const ctx = seq.slice(-k).join("");
    let t = 0, x = 0;
    for (let i = k; i < seq.length; i++) {
        if (seq.slice(i - k, i).join("") === ctx) {
            if (seq[i] === "T") t++;
            else x++;
        }
    }
    if (t + x < 3) return null;
    const pT = t / (t + x);
    const conf = Math.round(50 + Math.abs(pT - 0.5) * 80);
    return { pred: pT >= 0.5 ? "T" : "X", conf, name: `Ngữ cảnh ${k} bước` };
};

const cauChuyenTiepTT = seq => {
    if (seq.length < 10) return null;
    if (seq[seq.length - 1] !== "T") return null;
    let tt = 0, tx = 0;
    for (let i = 1; i < seq.length; i++) {
        if (seq[i - 1] === "T") {
            if (seq[i] === "T") tt++;
            else tx++;
        }
    }
    if (tt + tx < 5) return null;
    const pT = tt / (tt + tx);
    const conf = Math.round(50 + Math.abs(pT - 0.5) * 80);
    return { pred: pT >= 0.5 ? "T" : "X", conf, name: "Chuyển tiếp T→T/X" };
};

const cauChuyenTiepBet = seq => {
    const s = streakLen(seq);
    if (s < 2) return null;
    const last = seq[seq.length - 1];
    let cont = 0, brk = 0;
    for (let i = s; i < seq.length - 1; i++) {
        let sameRun = true;
        for (let j = 1; j < s; j++) {
            if (seq[i - j] !== last) { sameRun = false; break; }
        }
        if (sameRun && seq[i - s] === last) {
            if (seq[i] === last) cont++;
            else brk++;
        }
    }
    if (cont + brk < 3) return null;
    const pCont = cont / (cont + brk);
    const conf = Math.round(55 + Math.abs(pCont - 0.5) * 70);
    return { pred: pCont >= 0.5 ? last : opp(last), conf, name: "Chuyển tiếp theo bệt" };
};

// ═══════════════════════════════════════════════════════════════════════════════
//  NHÓM 7: MARKOV BẬC 2/3/4
// ═══════════════════════════════════════════════════════════════════════════════
const cauMarkovBac = (seq, order) => {
    const r = cauNguCanh(seq, order);
    if (!r) return null;
    return { ...r, name: `Markov bậc ${order}` };
};

// ═══════════════════════════════════════════════════════════════════════════════
//  NHÓM 8: SUFFIX TÁI DIỄN
// ═══════════════════════════════════════════════════════════════════════════════
const cauSuffix = seq => {
    if (seq.length < 10) return null;
    for (let L = Math.min(5, seq.length - 2); L >= 2; L--) {
        const suffix = seq.slice(-L).join("");
        let t = 0, x = 0;
        for (let i = L; i < seq.length - 1; i++) {
            if (seq.slice(i - L, i).join("") === suffix) {
                if (seq[i] === "T") t++;
                else x++;
            }
        }
        if (t + x >= 3) {
            const pT = t / (t + x);
            const conf = Math.round(55 + Math.abs(pT - 0.5) * 80);
            return { pred: pT >= 0.5 ? "T" : "X", conf, name: "Suffix tái diễn" };
        }
    }
    return null;
};

// ═══════════════════════════════════════════════════════════════════════════════
//  NHÓM 9: CHU KỲ LAG 2-9
// ═══════════════════════════════════════════════════════════════════════════════
const cauChuKyLag = (seq, k) => {
    if (seq.length < k * 3) return null;
    let same = 0, total = 0;
    for (let i = k; i < seq.length; i++) {
        total++;
        if (seq[i] === seq[i - k]) same++;
    }
    if (total < 6) return null;
    const rate = same / total;
    if (rate < 0.6) return null;
    const pred = seq[seq.length - k];
    const conf = Math.round(55 + (rate - 0.5) * 100);
    return { pred, conf, name: `Chu kỳ lag ${k}` };
};

// ═══════════════════════════════════════════════════════════════════════════════
//  NHÓM 10: BLOCK PATTERNS
// ═══════════════════════════════════════════════════════════════════════════════
const cauLapBlock = (seq, L) => {
    if (seq.length < L * 2) return null;
    const block = seq.slice(-L);
    const prevBlock = seq.slice(-L * 2, -L);
    if (block.join("") === prevBlock.join(""))
        return { pred: block[0], conf: 72, name: `Lặp block ${L}` };
    return null;
};

const cauDaoBlock = seq => {
    if (seq.length < 6) return null;
    const block = seq.slice(-3);
    const prevBlock = seq.slice(-6, -3);
    const inv = prevBlock.map(opp);
    if (block.join("") === inv.join(""))
        return { pred: opp(block[0]), conf: 70, name: "Đảo block" };
    return null;
};

const cauGuongChuoi = seq => {
    if (seq.length < 6) return null;
    const half = seq.slice(-3);
    const firstHalf = seq.slice(-6, -3);
    const rev = [...firstHalf].reverse();
    if (half.join("") === rev.join(""))
        return { pred: opp(half[2]), conf: 65, name: "Gương chuỗi" };
    return null;
};

// ═══════════════════════════════════════════════════════════════════════════════
//  NHÓM 11: THỐNG KÊ
// ═══════════════════════════════════════════════════════════════════════════════
const cauLechTanSuat = (seq, w) => {
    if (seq.length < w) return null;
    const r = freq(seq, w);
    if (Math.abs(r - 0.5) < 0.12) return null;
    const pred = r > 0.5 ? "T" : "X";
    const conf = Math.round(55 + Math.abs(r - 0.5) * 80);
    return { pred, conf, name: `Lệch tần suất ${w}` };
};

const cauHoiQuyTB = seq => {
    if (seq.length < 10) return null;
    const r = freq(seq, 10);
    if (r > 0.7) return { pred: "X", conf: 62, name: "Hồi quy trung bình" };
    if (r < 0.3) return { pred: "T", conf: 62, name: "Hồi quy trung bình" };
    return null;
};

const cauMomentum = seq => {
    if (seq.length < 24) return null;
    const s = freq(seq, 8), l = freq(seq, 24);
    const diff = s - l;
    if (Math.abs(diff) < 0.1) return null;
    return { pred: diff > 0 ? "T" : "X", conf: Math.round(55 + Math.abs(diff) * 80), name: "Momentum" };
};

const cauAntiMomentum = seq => {
    if (seq.length < 24) return null;
    const s = freq(seq, 8), l = freq(seq, 24);
    const diff = s - l;
    if (Math.abs(diff) < 0.1) return null;
    return { pred: diff > 0 ? "X" : "T", conf: Math.round(55 + Math.abs(diff) * 80), name: "Anti-momentum" };
};

// ═══════════════════════════════════════════════════════════════════════════════
//  NHÓM 12: CHẾ ĐỘ
// ═══════════════════════════════════════════════════════════════════════════════
const cauEntropyThap = seq => {
    if (seq.length < 12) return null;
    const s = seq.slice(-12);
    if (entropy(s) >= 0.75) return null;
    const tCount = s.filter(x => x === "T").length;
    const pred = tCount > s.length / 2 ? "T" : "X";
    return { pred, conf: 60, name: "Entropy thấp" };
};

const cauEntropyCao = seq => {
    if (seq.length < 12) return null;
    const s = seq.slice(-12);
    if (entropy(s) <= 0.98) return null;
    const last = seq[seq.length - 1];
    return { pred: opp(last), conf: 55, name: "Entropy cao" };
};

const cauDoiCheDo = seq => {
    if (seq.length < 30) return null;
    const recent = seq.slice(-10);
    const older = seq.slice(-30, -10);
    if (Math.abs(entropy(recent) - entropy(older)) <= 0.15) return null;
    const pred = recent.filter(x => x === "T").length > 5 ? "T" : "X";
    return { pred, conf: 60, name: "Đổi chế độ" };
};

const cauLechCuaSo = seq => {
    if (seq.length < 30) return null;
    const r5 = freq(seq, 5), r30 = freq(seq, 30);
    if (Math.abs(r5 - r30) <= 0.3) return null;
    const pred = r30 > 0.5 ? "T" : "X";
    return { pred, conf: 58, name: "Lệch cửa sổ" };
};

// ═══════════════════════════════════════════════════════════════════════════════
//  NHÓM 13: META
// ═══════════════════════════════════════════════════════════════════════════════
const cauDongThuan510 = seq => {
    if (seq.length < 10) return null;
    const r5 = freq(seq, 5), r10 = freq(seq, 10);
    const d5 = r5 > 0.5 ? "T" : "X";
    const d10 = r10 > 0.5 ? "T" : "X";
    if (d5 === d10 && Math.abs(r5 - 0.5) > 0.1)
        return { pred: d5, conf: Math.round(60 + Math.abs(r5 - 0.5) * 40), name: "Đồng thuận 5-10" };
    return null;
};

const cauDongThuan102050 = seq => {
    if (seq.length < 20) return null;
    const w = Math.min(50, seq.length);
    const d10 = freq(seq, 10) > 0.5 ? "T" : "X";
    const d20 = freq(seq, 20) > 0.5 ? "T" : "X";
    const d50 = freq(seq, w) > 0.5 ? "T" : "X";
    if (d10 === d20 && d20 === d50)
        return { pred: d10, conf: 65, name: "Đồng thuận 10-20-50" };
    return null;
};

const cauXungDotCuaSo = seq => {
    if (seq.length < 30) return null;
    const d5 = freq(seq, 5) > 0.5 ? "T" : "X";
    const d30 = freq(seq, 30) > 0.5 ? "T" : "X";
    if (d5 !== d30)
        return { pred: d30, conf: 58, name: "Xung đột cửa sổ" };
    return null;
};

const cauOnDinhHuong = seq => {
    if (seq.length < 21) return null;
    const wins = [5, 8, 13, 21];
    const dirs = wins.map(w => freq(seq, w) > 0.5 ? "T" : "X");
    if (dirs.every(d => d === dirs[0]))
        return { pred: dirs[0], conf: 62, name: "Ổn định hướng" };
    return null;
};

const cauBenHuong = seq => {
    if (seq.length < 8) return null;
    const s = seq.slice(-8);
    const t = s.filter(x => x === "T").length;
    if (t >= 6) return { pred: "T", conf: 63, name: "Bền hướng" };
    if (t <= 2) return { pred: "X", conf: 63, name: "Bền hướng" };
    return null;
};

const cauDaoCoXacNhan = seq => {
    if (seq.length < 8) return null;
    const s = seq.slice(-8);
    for (let i = 1; i < s.length; i++)
        if (s[i] === s[i - 1]) return null;
    return { pred: opp(s[s.length - 1]), conf: 70, name: "Đảo có xác nhận" };
};

const cauTongHop = seq => {
    if (seq.length < 20) return null;
    const r5 = freq(seq, 5), r10 = freq(seq, 10), r20 = freq(seq, 20);
    const avg = ((r5 - 0.5) + (r10 - 0.5) + (r20 - 0.5)) / 3;
    if (Math.abs(avg) < 0.05) return null;
    return { pred: avg > 0 ? "T" : "X", conf: Math.round(55 + Math.abs(avg) * 100), name: "Tổng hợp cầu" };
};

// ═══════════════════════════════════════════════════════════════════════════════
//  CHẠY TẤT CẢ CẦU
// ═══════════════════════════════════════════════════════════════════════════════
function runAllCau(seq) {
    return [
        // Cơ bản
        cau11(seq), cau12(seq), cau21(seq), cau22(seq), cau33(seq), cau44(seq),
        // Nhịp
        cau121(seq), cau212(seq), cau131(seq), cau232(seq), cau123(seq), cau321(seq),
        cau234(seq), cau432(seq), cau132(seq), cau213(seq), cau312(seq), cau242(seq),
        cau313(seq), cau141(seq), cau414(seq),
        // Bệt
        cauBetExact(seq, 2), cauBetExact(seq, 3), cauBetExact(seq, 4),
        cauBetExact(seq, 5), cauBetExact(seq, 6), cauBetExact(seq, 7), cauBetExact(seq, 8),
        cauBetTang(seq), cauBetChuanBiGay(seq),
        // Run length
        cauTangDan(seq), cauGiamDan(seq), cauLapDoDai(seq), cauGuongDoDai(seq),
        // State change
        cauDoiNhipSauBet(seq), cauPhaBetNgan(seq), cauSauChuoi2(seq), cauSauChuoi3(seq),
        cauSauChuoi4Plus(seq), cauBienDoiTrangThai(seq),
        // Markov context
        cauNguCanh(seq, 1), cauNguCanh(seq, 2), cauNguCanh(seq, 3),
        cauNguCanh(seq, 4), cauNguCanh(seq, 5),
        cauChuyenTiepTT(seq), cauChuyenTiepBet(seq),
        cauMarkovBac(seq, 2), cauMarkovBac(seq, 3), cauMarkovBac(seq, 4),
        // Suffix
        cauSuffix(seq),
        // Chu kỳ
        cauChuKyLag(seq, 2), cauChuKyLag(seq, 3), cauChuKyLag(seq, 4), cauChuKyLag(seq, 5),
        cauChuKyLag(seq, 6), cauChuKyLag(seq, 7), cauChuKyLag(seq, 8), cauChuKyLag(seq, 9),
        // Block
        cauLapBlock(seq, 3), cauLapBlock(seq, 4), cauDaoBlock(seq), cauGuongChuoi(seq),
        // Thống kê
        cauLechTanSuat(seq, 10), cauLechTanSuat(seq, 20), cauLechTanSuat(seq, 50),
        cauHoiQuyTB(seq), cauMomentum(seq), cauAntiMomentum(seq),
        // Chế độ
        cauEntropyThap(seq), cauEntropyCao(seq), cauDoiCheDo(seq), cauLechCuaSo(seq),
        // Meta
        cauDongThuan510(seq), cauDongThuan102050(seq), cauXungDotCuaSo(seq),
        cauOnDinhHuong(seq), cauBenHuong(seq), cauDaoCoXacNhan(seq), cauTongHop(seq),
    ].filter(Boolean);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DỰ ĐOÁN TỔNG HỢP — Cầu + Điểm
// ═══════════════════════════════════════════════════════════════════════════════
function predict(seq, lastPoint) {
    if (seq.length < 8) return null;

    const cauList = runAllCau(seq);
    const diem = BANG_DIEM[lastPoint] || null;

    // Weighted vote từ cầu
    let tScore = 0, xScore = 0;
    for (const s of cauList) {
        const w = s.conf;
        if (s.pred === "T") tScore += w;
        else xScore += w;
    }

    const cauReady = cauList.length > 0 && (tScore + xScore) > 0;
    const cauPred = cauReady ? (tScore >= xScore ? "T" : "X") : null;
    const cauConf = cauReady
        ? Math.round(50 + Math.abs(tScore - xScore) / (tScore + xScore) * 45)
        : 0;

    // Kết hợp với điểm
    if (cauReady && diem) {
        if (cauPred === diem.pred) {
            const conf = Math.min(95, Math.round((cauConf + diem.conf) / 2) + 8);
            return {
                prediction: cauPred === "T" ? "TAI" : "XIU",
                confidence: conf,
                method: `✅ ĐỒNG THUẬN · ${cauList.length} cầu (${cauConf}%) + Điểm ${lastPoint} (${diem.conf}%)`,
                cauPred, cauConf, diem,
            };
        }
        if (cauConf >= diem.conf + 5) {
            return {
                prediction: cauPred === "T" ? "TAI" : "XIU",
                confidence: Math.max(55, cauConf - 8),
                method: `⚔️ CẦU thắng · ${cauConf}% vs ${diem.conf}%`,
                cauPred, cauConf, diem,
            };
        }
        if (diem.conf >= cauConf + 5) {
            return {
                prediction: diem.pred === "T" ? "TAI" : "XIU",
                confidence: Math.max(55, diem.conf - 5),
                method: `⚔️ ĐIỂM thắng · ${diem.conf}% vs ${cauConf}%`,
                cauPred, cauConf, diem,
            };
        }
        return {
            prediction: cauPred === "T" ? "TAI" : "XIU",
            confidence: Math.max(52, Math.round((cauConf + diem.conf) / 2) - 5),
            method: `⚖️ Cân bằng → ưu tiên cầu`,
            cauPred, cauConf, diem,
        };
    }

    if (cauReady) {
        return {
            prediction: cauPred === "T" ? "TAI" : "XIU",
            confidence: cauConf,
            method: `🎯 Chỉ cầu · ${cauList.length} cầu active (${cauConf}%)`,
            cauPred, cauConf, diem: null,
        };
    }

    if (diem) {
        return {
            prediction: diem.pred === "T" ? "TAI" : "XIU",
            confidence: diem.conf,
            method: `📊 Chỉ điểm · ${diem.note}`,
            cauPred: null, cauConf: 0, diem,
        };
    }

    return {
        prediction: "CHỜ", confidence: 0,
        method: "Không có tín hiệu",
        cauPred: null, cauConf: 0, diem: null,
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
    const seq = recent.map(s => s.r);
    st.pred = predict(seq, st.latest.point);
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
    engine: "Bảng điểm MD5 + 80 cầu (1-1 → Tổng hợp)",
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

    const seq = st.sessions.slice(-MAX).map(s => s.r);
    const cauList = runAllCau(seq);

    return {
        last: {
            id: st.latest.id_num,
            result: st.latest.r,
            dices: st.latest.dices,
            point: st.latest.point,
        },
        diem_lookup: BANG_DIEM[st.latest.point] || null,
        prediction: st.pred,
        active_cau: cauList.sort((a, b) => b.conf - a.conf),
        total_cau_fired: cauList.length,
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
║  🎲 TÀI XỈU LC79 — BẢNG ĐIỂM MD5 + FULL CẦU                          ║
╠══════════════════════════════════════════════════════════════════════╣
║  🚀 Port: ${PORT}
║  🔑 Key : ${VALID_KEY}
║  👤 Admin: ${ADMIN}
║  📊 16 mức bảng điểm MD5 + 80 cầu pattern
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