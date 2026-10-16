// ═══════════════════════════════════════════════════════════════════════════════
//  TÀI XỈU LC79 — NEURAL + MARKOV ENGINE v1.0
//  Multi-layer Neural Network + Markov bậc cao + Logistic + Bayesian + KNN
//  Self-learning · Ensemble voting · Balanced
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
const MAX  = 80;
const POLL = 5000;

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
const sigmoid = x => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, x))));
const clamp   = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const tanh    = Math.tanh;

// ═══════════════════════════════════════════════════════════════════════════════
//  FEATURE EXTRACTION — 24 features từ chuỗi T/X
// ═══════════════════════════════════════════════════════════════════════════════
function extractFeatures(seq) {
    if (seq.length < 20) return null;
    const f = [];
    const bits = seq.map(x => x === "T" ? 1 : 0);
    const last = bits.length - 1;
    const N = bits.length;

    // 1-5: Last 5 bits
    for (let i = 1; i <= 5; i++) f.push(bits[last - i + 1]);

    // 6-10: Frequency windows
    for (const w of [5, 10, 15, 20, 30]) {
        const s = bits.slice(-w);
        f.push(s.reduce((a, b) => a + b, 0) / w);
    }

    // 11: Streak length (normalized 0-1)
    let st = 1;
    for (let i = N - 2; i >= 0; i--) { if (bits[i] === bits[N - 1]) st++; else break; }
    f.push(Math.min(1, st / 10));

    // 12: Streak side
    f.push(bits[N - 1]);

    // 13-14: Transition rates
    let tt = 0, tx = 0, xt = 0, xx = 0;
    for (let i = 1; i < N; i++) {
        if (bits[i-1] === 1 && bits[i] === 1) tt++;
        else if (bits[i-1] === 1) tx++;
        else if (bits[i] === 1) xt++;
        else xx++;
    }
    const tot = N - 1;
    f.push(tt / Math.max(1, tt + tx));
    f.push(xt / Math.max(1, xt + xx));

    // 15: Entropy 20
    const s20 = bits.slice(-20);
    const p20 = s20.reduce((a, b) => a + b, 0) / 20;
    f.push(p20 > 0 && p20 < 1 ? -(p20 * Math.log2(p20) + (1 - p20) * Math.log2(1 - p20)) : 0);

    // 16: Alternation rate 10
    let alt = 0;
    const s10 = bits.slice(-10);
    for (let i = 1; i < s10.length; i++) if (s10[i] !== s10[i-1]) alt++;
    f.push(alt / 9);

    // 17-18: Markov bậc 1
    const mk1 = markovProb(bits, 1);
    f.push(mk1);

    // 19-20: Markov bậc 2
    const mk2 = markovProb(bits, 2);
    f.push(mk2);

    // 21: Markov bậc 3
    f.push(markovProb(bits, 3));

    // 22: Momentum
    const r5  = bits.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const r20 = bits.slice(-20).reduce((a, b) => a + b, 0) / 20;
    f.push(r5 - r20 + 0.5);

    // 23: Mean reversion signal
    f.push(p20 > 0.7 ? 0 : p20 < 0.3 ? 1 : 0.5);

    // 24: Bias (constant)
    f.push(1);

    return f;
}

// Markov probability P(next=T | last k chars)
function markovProb(bits, k) {
    if (bits.length < k + 5) return 0.5;
    const N = bits.length;
    const ctx = bits.slice(N - k).join("");
    let t = 0, x = 0;
    for (let i = k; i < N; i++) {
        if (bits.slice(i - k, i).join("") === ctx) {
            if (bits[i] === 1) t++; else x++;
        }
    }
    const tot = t + x;
    return tot < 2 ? 0.5 : t / tot;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  NEURAL NETWORK — MLP 24 → 16 → 8 → 1 (sigmoid)
// ═══════════════════════════════════════════════════════════════════════════════
class NeuralNet {
    constructor() {
        this.layers = [24, 16, 8, 1];
        this.weights = [];
        this.biases = [];
        this.lr = 0.05;

        for (let i = 1; i < this.layers.length; i++) {
            const nin = this.layers[i - 1];
            const nout = this.layers[i];
            const W = [];
            const b = [];
            for (let o = 0; o < nout; o++) {
                const row = [];
                for (let n = 0; n < nin; n++) {
                    // Xavier init
                    row.push((Math.random() * 2 - 1) * Math.sqrt(2 / nin));
                }
                W.push(row);
                b.push(0);
            }
            this.weights.push(W);
            this.biases.push(b);
        }
    }

    forward(x) {
        let a = x;
        this.activations = [a];
        this.zs = [];
        for (let i = 0; i < this.weights.length; i++) {
            const W = this.weights[i];
            const b = this.biases[i];
            const z = W.map((row, o) => row.reduce((s, w, n) => s + w * a[n], 0) + b[o]);
            this.zs.push(z);
            const isOut = i === this.weights.length - 1;
            a = isOut ? z.map(sigmoid) : z.map(v => Math.max(0, v)); // ReLU for hidden
            this.activations.push(a);
        }
        return a[0];
    }

    train(x, y) {
        // Forward
        const out = this.forward(x);
        // Backward
        let delta = [(out - y) * out * (1 - out)]; // sigmoid derivative

        const grads_w = [];
        const grads_b = [];

        for (let i = this.weights.length - 1; i >= 0; i--) {
            const a = this.activations[i];
            const W = this.weights[i];

            // Gradients
            const gw = [];
            const gb = [];
            for (let o = 0; o < W.length; o++) {
                const row = [];
                for (let n = 0; n < W[o].length; n++) {
                    row.push(delta[o] * a[n]);
                }
                gw.push(row);
                gb.push(delta[o]);
            }
            grads_w.unshift(gw);
            grads_b.unshift(gb);

            // Propagate
            if (i > 0) {
                const newDelta = [];
                for (let n = 0; n < W[0].length; n++) {
                    let d = 0;
                    for (let o = 0; o < W.length; o++) d += W[o][n] * delta[o];
                    // ReLU derivative
                    const z = this.zs[i - 1][n];
                    newDelta.push(z > 0 ? d : 0);
                }
                delta = newDelta;
            }
        }

        // Update
        for (let i = 0; i < this.weights.length; i++) {
            for (let o = 0; o < this.weights[i].length; o++) {
                for (let n = 0; n < this.weights[i][o].length; n++) {
                    this.weights[i][o][n] -= this.lr * grads_w[i][o][n];
                }
                this.biases[i][o] -= this.lr * grads_b[i][o];
            }
        }

        return (out - y) ** 2; // MSE
    }

    predict(x) {
        return this.forward(x);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LOGISTIC REGRESSION — online SGD
// ═══════════════════════════════════════════════════════════════════════════════
class Logistic {
    constructor(nFeatures) {
        this.w = new Array(nFeatures).fill(0);
        this.b = 0;
        this.lr = 0.1;
    }
    predict(x) {
        let z = this.b;
        for (let i = 0; i < x.length; i++) z += this.w[i] * x[i];
        return sigmoid(z);
    }
    train(x, y) {
        const p = this.predict(x);
        const err = p - y;
        for (let i = 0; i < x.length; i++) this.w[i] -= this.lr * err * x[i];
        this.b -= this.lr * err;
        return err * err;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  BAYESIAN — Beta(α, β) với decay
// ═══════════════════════════════════════════════════════════════════════════════
class Bayesian {
    constructor() {
        this.alpha = 1;
        this.beta = 1;
        this.decay = 0.98;
    }
    update(bit) {
        this.alpha *= this.decay;
        this.beta  *= this.decay;
        if (bit === 1) this.alpha += 1;
        else this.beta += 1;
    }
    predict() {
        return this.alpha / (this.alpha + this.beta);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  KNN — lưu tất cả patterns
// ═══════════════════════════════════════════════════════════════════════════════
class KNN {
    constructor(k = 10, window = 5) {
        this.k = k;
        this.window = window;
        this.patterns = [];
    }
    add(seq, nextBit) {
        if (seq.length < this.window) return;
        const pat = seq.slice(-this.window);
        this.patterns.push({ pat, next: nextBit });
        if (this.patterns.length > 2000) this.patterns.shift();
    }
    predict(seq) {
        if (seq.length < this.window) return 0.5;
        const cur = seq.slice(-this.window);
        const sims = [];
        for (const p of this.patterns) {
            let d = 0;
            for (let i = 0; i < this.window; i++) if (p.pat[i] !== cur[i]) d++;
            sims.push({ d, next: p.next });
        }
        sims.sort((a, b) => a.d - b.d);
        const top = sims.slice(0, this.k);
        if (!top.length) return 0.5;
        let t = 0, x = 0;
        for (const s of top) {
            const w = 1 / (1 + s.d);
            if (s.next === 1) t += w; else x += w;
        }
        return t / (t + x + 1e-9);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ENSEMBLE — Weighted voting với self-learning weights
// ═══════════════════════════════════════════════════════════════════════════════
class Ensemble {
    constructor() {
        this.weights = {
            nn: 1.0,
            logistic: 1.0,
            bayes: 0.8,
            knn: 0.9,
            markov1: 0.7,
            markov2: 0.8,
            markov3: 0.9,
            markov4: 0.8,
            markov5: 0.7,
        };
        this.recent = {
            nn: [], logistic: [], bayes: [], knn: [],
            markov1: [], markov2: [], markov3: [], markov4: [], markov5: [],
        };
    }

    updateWeights(predictions, actual) {
        for (const [name, pred] of Object.entries(predictions)) {
            const correct = (pred >= 0.5 && actual === 1) || (pred < 0.5 && actual === 0);
            this.recent[name].push(correct);
            if (this.recent[name].length > 30) this.recent[name].shift();

            if (this.recent[name].length >= 5) {
                const acc = this.recent[name].filter(Boolean).length / this.recent[name].length;
                // weight tỷ lệ với accuracy, sàn 0.3, trần 3.0
                this.weights[name] = clamp(0.3 + acc * 2.7, 0.3, 3.0);
            }
        }
    }

    predict(predictions) {
        let t = 0, x = 0;
        for (const [name, p] of Object.entries(predictions)) {
            if (p == null) continue;
            const w = this.weights[name] || 1;
            if (p > 0.5) t += (p) * w;
            else x += (1 - p) * w;
        }
        const tot = t + x;
        if (tot === 0) return 0.5;
        return t / tot;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  COMBINED ENGINE
// ═══════════════════════════════════════════════════════════════════════════════
class Engine {
    constructor() {
        this.nn = new NeuralNet();
        this.logistic = new Logistic(24);
        this.bayes = new Bayesian();
        this.knn = new KNN(10, 5);
        this.ensemble = new Ensemble();
        this.history = [];    // các bits đã train
        this.lastPred = null;
    }

    // Học 1 sample
    learn(seq, nextBit) {
        const f = extractFeatures(seq);
        if (!f) return;
        const y = nextBit;

        // NN
        this.nn.train(f, y);

        // Logistic
        this.logistic.train(f, y);

        // Bayes
        this.bayes.update(y);

        // KNN
        this.knn.add(seq, y);

        this.history.push({ seq: seq.slice(-30), y });
        if (this.history.length > 500) this.history.shift();
    }

    // Dự đoán
    predict(seq) {
        const f = extractFeatures(seq);
        if (!f) return null;

        const predictions = {
            nn:       this.nn.predict(f),
            logistic: this.logistic.predict(f),
            bayes:    this.bayes.predict(),
            knn:      this.knn.predict(seq),
            markov1:  markovProb(seq.map(x => x === "T" ? 1 : 0), 1),
            markov2:  markovProb(seq.map(x => x === "T" ? 1 : 0), 2),
            markov3:  markovProb(seq.map(x => x === "T" ? 1 : 0), 3),
            markov4:  markovProb(seq.map(x => x === "T" ? 1 : 0), 4),
            markov5:  markovProb(seq.map(x => x === "T" ? 1 : 0), 5),
        };

        const pT = this.ensemble.predict(predictions);

        // Confidence: độ xa từ 0.5, nhưng cân bằng lại
        const distance = Math.abs(pT - 0.5);
        const confidence = clamp(50 + distance * 90, 50, 92);

        const prediction = pT >= 0.5 ? "TAI" : "XIU";

        return {
            prediction,
            pT,
            confidence: Math.round(confidence),
            predictions,
            weights: { ...this.ensemble.weights },
        };
    }

    // Cập nhật weights sau khi biết kết quả
    updateFromResult(actualBit) {
        if (!this.lastPred) return;
        this.ensemble.updateWeights(this.lastPred.predictions, actualBit);
        this.lastPred = null;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════════════════════════
const state = {
    md5: { sessions: [], lastId: null, engine: new Engine(), pred: null, latest: null, trained: 0 },
    hu:  { sessions: [], lastId: null, engine: new Engine(), pred: null, latest: null, trained: 0 },
};

function update(key, arr) {
    const st = state[key];
    if (!arr.length) return;
    const latest = arr[arr.length - 1];

    if (!st.lastId) {
        st.sessions = arr;
        st.lastId = latest.id;
        console.log(`✅ [${key.toUpperCase()}] ${arr.length} phiên`);
        trainAll(st);
    } else if (latest.id_num > st.lastId) {
        const news = arr.filter(r => r.id_num > st.lastId);
        for (const r of news) st.sessions.push(r);
        if (st.sessions.length > 1000) st.sessions = st.sessions.slice(-800);
        st.lastId = latest.id;
        console.log(`🆕 [${key.toUpperCase()}] +${news.length}`);

        // Học từ các phiên mới
        for (const r of news) {
            const idx = st.sessions.findIndex(s => s.id === r.id);
            if (idx >= 20) {
                const seqBefore = st.sessions.slice(0, idx).map(s => s.r);
                st.engine.learn(seqBefore, r.r === "T" ? 1 : 0);
                st.trained++;
            }
        }

        // Cập nhật weight dựa trên kết quả vừa rồi
        if (st.pred && st.pred.targetId === latest.id_num) {
            st.engine.lastPred = st.pred.engineData;
            st.engine.updateFromResult(latest.r === "T" ? 1 : 0);
            st.pred = null;
        }
    }

    // Dự đoán
    const recent = st.sessions.slice(-MAX);
    st.latest = recent[recent.length - 1];
    const seq = recent.map(s => s.r);
    const p = st.engine.predict(seq);

    if (p) {
        st.pred = {
            targetId: st.latest.id_num + 1,
            prediction: p.prediction,
            confidence: p.confidence,
            engineData: p,
        };
    } else {
        st.pred = null;
    }
}

function trainAll(st) {
    // Train NN + Logistic + KNN + Bayes trên toàn bộ history
    const seq = st.sessions.map(s => s.r);
    for (let i = 20; i < seq.length; i++) {
        st.engine.learn(seq.slice(0, i), seq[i] === "T" ? 1 : 0);
        st.trained++;
    }
    console.log(`🧠 [${st.sessions.length} phiên] trained ${st.trained} samples`);
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

    return {
        Id:          ADMIN,
        Phien_nay:   last.id_num + 1,
        Du_doan:     p.prediction === "TAI" ? "TÀI" : "XỈU",
        Ty_le:       `${p.confidence}%`,
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
    engine: "Neural + Markov v1.0 — MLP 24-16-8-1 + Logistic + Bayes + KNN + Markov 1-5",
    hu:  { loaded: state.hu.sessions.length,  last_id: state.hu.lastId,  trained: state.hu.trained },
    md5: { loaded: state.md5.sessions.length, last_id: state.md5.lastId, trained: state.md5.trained },
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

    const p = st.pred.engineData;
    return {
        last: {
            id: st.latest.id_num,
            result: st.latest.r,
            dice: st.latest.dices,
            point: st.latest.point,
        },
        trained: st.trained,
        prediction: {
            pred: p.prediction,
            pT: p.pT.toFixed(4),
            confidence: p.confidence,
        },
        module_predictions: Object.fromEntries(
            Object.entries(p.predictions).map(([k, v]) => [k, v.toFixed(4)])
        ),
        module_weights: Object.fromEntries(
            Object.entries(p.weights).map(([k, v]) => [k, v.toFixed(2)])
        ),
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
║  🧠 TÀI XỈU LC79 — NEURAL + MARKOV ENGINE v1.0                       ║
╠══════════════════════════════════════════════════════════════════════╣
║  🚀 Port: ${PORT}
║  🔑 Key : ${VALID_KEY}
║  👤 Admin: ${ADMIN}
║
║  🧠 Modules:
║     • Neural Network MLP [24-16-8-1] (backprop)
║     • Logistic Regression (online SGD)
║     • Bayesian Beta(α,β) decay
║     • KNN k=10 window=5
║     • Markov bậc 1-5
║     • Weighted Ensemble (self-learning)
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