// Seed & publish 10 SSC CGL Tier-1 (2026 SECTIONAL pattern) mock set papers.
//
// Pattern (per set):
//   4 sections, each ONE subject, 25 questions, 15-min sectional timer,
//   +2 / -0.5. Sections auto-close on timeout (handled by the attempt UI).
//
// Content strategy:
//   - Quant & Reasoning : generated programmatically (computed answer keys),
//                         UNIQUE per set.
//   - General Awareness : ~100-fact bilingual bank, 25 sampled per set.
//   - English           : reused from existing question pool, 25 sampled.
//
// Writes a manifest (sscCglSeed.manifest.json) listing every created
// question + set id, so undoSscCglSectionalSets.js can remove them cleanly.
//
// Usage:  node src/scripts/seedSscCglSectionalSets.js

require("dotenv").config({ quiet: true });

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const Subject = require("../models/Subject");
const Topic = require("../models/Topic");
const Question = require("../models/Question");
const QuestionCounter = require("../models/QuestionCounter");
const SetPaper = require("../models/SetPaper");

const NUM_SETS = 10;
const QPS = 25; // questions per subject per set
const SECTION_MIN = 15;
const POS = 2;
const NEG = 0.5;
const MANIFEST = path.join(__dirname, "sscCglSeed.manifest.json");

// =========================
// SMALL UTILS
// =========================

const rnd = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const distractors = (c) => {
  const out = [];
  const step = Math.max(1, Math.round(Math.abs(c) * 0.1)) || 1;
  const cand = [
    c + step, c - step, c + 2 * step, c - 2 * step,
    c + 1, c + 3, Math.round(c * 1.2), Math.round(c * 0.8)
  ];
  for (const x of cand) {
    if (x !== c && x > 0 && !out.includes(x)) out.push(x);
    if (out.length === 3) break;
  }
  let k = c + 4;
  while (out.length < 3) {
    if (k !== c && k > 0 && !out.includes(k)) out.push(k);
    k++;
  }
  return out.slice(0, 3);
};

const KEYS = ["a", "b", "c", "d"];

// numeric correct → 4 shuffled options
const numericOptions = (correct, fmtEn, fmtHi) => {
  const fe = fmtEn || ((v) => `${v}`);
  const fh = fmtHi || ((v) => `${v}`);
  const vals = shuffle([correct, ...distractors(correct)]);
  return {
    opts: vals.map((v, i) => ({ key: KEYS[i], text: { en: fe(v), hi: fh(v) } })),
    ans: KEYS[vals.indexOf(correct)]
  };
};

// =========================
// QUANT GENERATORS
// =========================

const QUANT_GENS = [
  () => { const X = pick([5,10,15,20,25,40,50]), Y = pick([100,200,300,400,500,600,800]); const c = X*Y/100; return { q_en:`What is ${X}% of ${Y}?`, q_hi:`${Y} का ${X}% क्या है?`, correct:c, exp_en:`${X}/100 × ${Y} = ${c}.`, exp_hi:`${X}/100 × ${Y} = ${c}।` }; },
  () => { const P = pick([1000,2000,3000,4000,5000]), R = rnd(2,12), T = rnd(1,4); const c = P*R*T/100; return { q_en:`Simple interest on ₹${P} at ${R}% p.a. for ${T} years?`, q_hi:`₹${P} पर ${R}% वार्षिक दर से ${T} वर्ष का साधारण ब्याज?`, correct:c, fmtEn:v=>`₹${v}`, fmtHi:v=>`₹${v}`, exp_en:`SI = ${P}×${R}×${T}/100 = ${c}.`, exp_hi:`ब्याज = ${P}×${R}×${T}/100 = ${c}।` }; },
  () => { const b = pick([10,20,30,40,50,60]), d = rnd(2,9); const list = [b-2*d,b-d,b,b+d,b+2*d]; const sum = list.reduce((a,x)=>a+x,0); return { q_en:`Find the average of ${list.join(", ")}.`, q_hi:`${list.join(", ")} का औसत ज्ञात करें।`, correct:b, exp_en:`Sum ${sum} ÷ 5 = ${b}.`, exp_hi:`योग ${sum} ÷ 5 = ${b}।` }; },
  () => { const l = rnd(4,20), w = rnd(3,15); const c = l*w; return { q_en:`Area of a rectangle ${l} × ${w}?`, q_hi:`${l} × ${w} आयत का क्षेत्रफल?`, correct:c, exp_en:`${l} × ${w} = ${c}.`, exp_hi:`${l} × ${w} = ${c}।` }; },
  () => { const s = rnd(4,25); const c = 4*s; return { q_en:`Perimeter of a square of side ${s}?`, q_hi:`${s} भुजा वाले वर्ग का परिमाप?`, correct:c, exp_en:`4 × ${s} = ${c}.`, exp_hi:`4 × ${s} = ${c}।` }; },
  () => { const a = rnd(1,3), b = rnd(2,4), u = pick([50,100,150,200]); const total = (a+b)*u; const c = Math.max(a,b)*u; return { q_en:`Divide ₹${total} in ratio ${a}:${b}. Larger part?`, q_hi:`₹${total} को ${a}:${b} में बाँटें। बड़ा भाग?`, correct:c, fmtEn:v=>`₹${v}`, fmtHi:v=>`₹${v}`, exp_en:`Larger = ${Math.max(a,b)}/${a+b} × ${total} = ${c}.`, exp_hi:`बड़ा = ${Math.max(a,b)}/${a+b} × ${total} = ${c}।` }; },
  () => { const sp = rnd(30,80), t = rnd(2,5); const d = sp*t; return { q_en:`A car covers ${d} km in ${t} hours. Speed?`, q_hi:`एक कार ${t} घंटे में ${d} किमी चलती है। गति?`, correct:sp, fmtEn:v=>`${v} km/h`, fmtHi:v=>`${v} किमी/घं`, exp_en:`${d} ÷ ${t} = ${sp} km/h.`, exp_hi:`${d} ÷ ${t} = ${sp} किमी/घं।` }; },
  () => { const cp = pick([100,200,300,400,500]), p = pick([10,20,25,50]); const sp = cp + cp*p/100; return { q_en:`CP = ₹${cp}, SP = ₹${sp}. Profit %?`, q_hi:`क्रय = ₹${cp}, विक्रय = ₹${sp}। लाभ %?`, correct:p, fmtEn:v=>`${v}%`, fmtHi:v=>`${v}%`, exp_en:`Profit ${sp-cp}/${cp} × 100 = ${p}%.`, exp_hi:`लाभ ${sp-cp}/${cp} × 100 = ${p}%।` }; },
  () => { const den = pick([2,4,5]), num = rnd(1,den-1), N = den*rnd(4,20); const c = N*num/den; return { q_en:`What is ${num}/${den} of ${N}?`, q_hi:`${N} का ${num}/${den} क्या है?`, correct:c, exp_en:`${N} × ${num}/${den} = ${c}.`, exp_hi:`${N} × ${num}/${den} = ${c}।` }; },
  () => { const n = rnd(4,20); const sq = n*n; return { q_en:`What is the square root of ${sq}?`, q_hi:`${sq} का वर्गमूल क्या है?`, correct:n, exp_en:`${n} × ${n} = ${sq}.`, exp_hi:`${n} × ${n} = ${sq}।` }; },
  () => { const a = rnd(3,12), b = rnd(2,9), d = rnd(1,20); const c = a*b+d; return { q_en:`Simplify: ${a} × ${b} + ${d}`, q_hi:`हल करें: ${a} × ${b} + ${d}`, correct:c, exp_en:`${a}×${b}=${a*b}, +${d} = ${c}.`, exp_hi:`${a}×${b}=${a*b}, +${d} = ${c}।` }; }
];

// =========================
// REASONING GENERATORS
// =========================

const REASON_GENS = [
  () => { const a = rnd(1,12), d = rnd(2,9); const t = [a,a+d,a+2*d,a+3*d,a+4*d]; const c = a+5*d; return { q_en:`Find the next number: ${t.join(", ")}, ?`, q_hi:`अगली संख्या: ${t.join(", ")}, ?`, correct:c, exp_en:`Common difference ${d}: ${t[4]}+${d} = ${c}.`, exp_hi:`सार्व अंतर ${d}: ${t[4]}+${d} = ${c}।` }; },
  () => { const a = rnd(1,6), d = rnd(2,4), s = 2; const diffs = [d,d+s,d+2*s,d+3*s,d+4*s]; const t = [a]; for (let i=0;i<4;i++) t.push(t[i]+diffs[i]); const c = t[4]+diffs[4]; return { q_en:`Find the next number: ${t.join(", ")}, ?`, q_hi:`अगली संख्या: ${t.join(", ")}, ?`, correct:c, exp_en:`Differences grow by ${s}; next diff ${diffs[4]} → ${c}.`, exp_hi:`अंतर ${s} से बढ़ते हैं; अगला अंतर ${diffs[4]} → ${c}।` }; },
  () => { const k = rnd(1,5); const t = [k*k,(k+1)**2,(k+2)**2,(k+3)**2,(k+4)**2]; const c = (k+5)**2; return { q_en:`Find the next number: ${t.join(", ")}, ?`, q_hi:`अगली संख्या: ${t.join(", ")}, ?`, correct:c, exp_en:`Perfect squares: ${k+5}² = ${c}.`, exp_hi:`पूर्ण वर्ग: ${k+5}² = ${c}।` }; },
  () => { const k = rnd(1,3); const t = [k**3,(k+1)**3,(k+2)**3,(k+3)**3]; const c = (k+4)**3; return { q_en:`Find the next number: ${t.join(", ")}, ?`, q_hi:`अगली संख्या: ${t.join(", ")}, ?`, correct:c, exp_en:`Perfect cubes: ${k+4}³ = ${c}.`, exp_hi:`पूर्ण घन: ${k+4}³ = ${c}।` }; },
  () => { const m = rnd(2,5); const t = [m,m*2,m*4,m*8,m*16]; const c = m*32; return { q_en:`Find the next number: ${t.join(", ")}, ?`, q_hi:`अगली संख्या: ${t.join(", ")}, ?`, correct:c, exp_en:`Each term doubles: ${t[4]}×2 = ${c}.`, exp_hi:`प्रत्येक पद दुगुना: ${t[4]}×2 = ${c}।` }; },
  () => { const n = rnd(3,9), m = rnd(3,12); const c = m*m; return { q_en:`${n} : ${n*n} :: ${m} : ?`, q_hi:`${n} : ${n*n} :: ${m} : ?`, correct:c, exp_en:`Each number squared: ${m}² = ${c}.`, exp_hi:`प्रत्येक संख्या का वर्ग: ${m}² = ${c}।` }; },
  () => { const k = pick([3,4,6,7]); const mset = shuffle([2,3,4,5,6,7,8,9]).slice(0,3).map(x=>x*k); let odd; do { odd = rnd(2,9)*k + rnd(1,k-1); } while (mset.includes(odd)); const vals = shuffle([...mset, odd]); return { q_en:`Find the number that does NOT belong: ${vals.join(", ")}`, q_hi:`वह संख्या चुनें जो समूह में नहीं आती: ${vals.join(", ")}`, opts: vals.map((v,i)=>({key:KEYS[i],text:{en:`${v}`,hi:`${v}`}})), ans: KEYS[vals.indexOf(odd)], exp_en:`All others are multiples of ${k}; ${odd} is not.`, exp_hi:`बाकी सभी ${k} के गुणज हैं; ${odd} नहीं।` }; }
];

// build a normalized {q_en,q_hi,opts,ans,exp_en,exp_hi} from a generator
const genQuestion = (gen) => {
  const g = gen();
  if (g.opts && g.ans) return g; // explicit options (e.g., odd-one-out)
  const { opts, ans } = numericOptions(g.correct, g.fmtEn, g.fmtHi);
  return { q_en: g.q_en, q_hi: g.q_hi, opts, ans, exp_en: g.exp_en, exp_hi: g.exp_hi };
};

// =========================
// GENERAL AWARENESS BANK  (~100 verified static-GK facts)
// tuple: [q_en, q_hi, [[a..],[b..],[c..],[d..]], ans, exp_en, exp_hi]
// =========================

const GA_BANK = require("./gaBank");

// =========================
// OFFLINE VALIDATION (--dry)
// =========================

function validate() {
  let errors = 0;
  const fail = (m) => { console.log("  ✖ " + m); errors++; };

  GA_BANK.forEach((it, i) => {
    if (!Array.isArray(it) || it.length !== 6) fail(`GA[${i}] not a 6-tuple`);
    else {
      if (!Array.isArray(it[2]) || it[2].length !== 4) fail(`GA[${i}] options != 4`);
      if (!KEYS.includes(it[3])) fail(`GA[${i}] bad answer key "${it[3]}"`);
      if (!it[0] || !it[1] || !it[4] || !it[5]) fail(`GA[${i}] missing text`);
    }
  });

  const checkGen = (gens, label, n) => {
    for (let i = 0; i < n; i++) {
      const q = genQuestion(gens[i % gens.length]);
      if (!q.opts || q.opts.length !== 4) { fail(`${label} opts != 4`); continue; }
      if (!KEYS.includes(q.ans)) fail(`${label} bad ans`);
      if (new Set(q.opts.map(o => o.key)).size !== 4) fail(`${label} duplicate keys`);
      if (new Set(q.opts.map(o => o.text.en)).size !== 4) fail(`${label} duplicate option text: ${q.opts.map(o => o.text.en).join("|")}`);
      if (!q.q_en || !q.q_hi || !q.exp_en || !q.exp_hi) fail(`${label} missing text`);
    }
  };

  checkGen(QUANT_GENS, "QUANT", 400);
  checkGen(REASON_GENS, "REASON", 400);

  console.log(
    errors === 0
      ? `✔ Validation passed — GA bank: ${GA_BANK.length} items, generators OK.`
      : `✖ ${errors} validation error(s).`
  );
  return errors === 0;
}

// =========================
// CORE
// =========================

async function run() {
  if (!process.env.MONGO_URI) {
    console.error("✖ MONGO_URI is not set (check your .env).");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("MongoDB connected");

  const titles = Array.from({ length: NUM_SETS }, (_, i) =>
    `SSC CGL Tier-1 Sectional Mock ${String(i + 1).padStart(2, "0")}`
  );

  const clash = await SetPaper.findOne({ title: { $in: titles } });
  if (clash) {
    console.error(`✖ "${clash.title}" already exists. Run the undo script first.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  // subjects
  const bySlug = {};
  for (const slug of ["reasoning", "general-studies", "quantitative-aptitude", "english"]) {
    const s = await Subject.findOne({ slug });
    if (!s) { console.error(`✖ Subject "${slug}" not found.`); await mongoose.disconnect(); process.exit(1); }
    bySlug[slug] = s;
  }

  // topics per authored subject
  const topicsOf = async (subj) => {
    const t = await Topic.find({ subjectId: subj._id, isActive: true });
    if (!t.length) { console.error(`✖ Subject "${subj.slug}" needs ≥1 active topic.`); process.exit(1); }
    return t;
  };
  const reasoningTopics = await topicsOf(bySlug["reasoning"]);
  const gsTopics = await topicsOf(bySlug["general-studies"]);
  const quantTopics = await topicsOf(bySlug["quantitative-aptitude"]);

  // english pool (reused)
  const englishPool = (await Question.find({
    subjectId: bySlug["english"]._id, isActive: true
  }).select("_id")).map(d => d._id);
  if (englishPool.length < QPS) {
    console.error(`✖ Need ≥${QPS} active English questions, found ${englishPool.length}.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  // in-memory question-code counters (continue from existing values)
  const counterMap = {};
  const existing = await QuestionCounter.find({
    subjectId: { $in: [bySlug["reasoning"]._id, bySlug["general-studies"]._id, bySlug["quantitative-aptitude"]._id] }
  });
  existing.forEach(c => { counterMap[`${c.subjectId}_${c.topicId}`] = c.count; });

  const nextCode = (subject, topic) => {
    const k = `${subject._id}_${topic._id}`;
    const n = (counterMap[k] || 0) + 1;
    counterMap[k] = n;
    return `${subject.slug}_${topic.slug}_${String(n).padStart(4, "0")}`;
  };

  const toDoc = (subject, topic, q) => ({
    subjectId: subject._id,
    topicId: topic._id,
    questionCode: nextCode(subject, topic),
    question: { en: q.q_en, hi: q.q_hi },
    options: q.opts,
    correctAnswer: q.ans,
    explanation: { en: q.exp_en, hi: q.exp_hi }
  });

  // ---- GA bank → docs (created once, sampled per set) ----
  const gaDocs = GA_BANK.map((it, i) => {
    const topic = gsTopics[i % gsTopics.length];
    return toDoc(bySlug["general-studies"], topic, {
      q_en: it[0], q_hi: it[1],
      opts: it[2].map((o, k) => ({ key: KEYS[k], text: { en: o[0], hi: o[1] } })),
      ans: it[3], exp_en: it[4], exp_hi: it[5]
    });
  });

  // ---- Quant & Reasoning → unique docs per set ----
  const quantDocs = [];
  const reasonDocs = [];
  const perSet = []; // { quantRange:[s,e], reasonRange:[s,e], gaIds, engIds }

  for (let s = 0; s < NUM_SETS; s++) {
    const qStart = quantDocs.length;
    for (let j = 0; j < QPS; j++) {
      const topic = quantTopics[(s * QPS + j) % quantTopics.length];
      quantDocs.push(toDoc(bySlug["quantitative-aptitude"], topic, genQuestion(QUANT_GENS[(s * QPS + j) % QUANT_GENS.length])));
    }
    const rStart = reasonDocs.length;
    for (let j = 0; j < QPS; j++) {
      const topic = reasoningTopics[(s * QPS + j) % reasoningTopics.length];
      reasonDocs.push(toDoc(bySlug["reasoning"], topic, genQuestion(REASON_GENS[(s * QPS + j) % REASON_GENS.length])));
    }
    perSet.push({
      quantRange: [qStart, quantDocs.length],
      reasonRange: [rStart, reasonDocs.length]
    });
  }

  console.log(`Inserting questions: ${gaDocs.length} GA, ${quantDocs.length} Quant, ${reasonDocs.length} Reasoning...`);

  const gaInserted = await Question.insertMany(gaDocs);
  const quantInserted = await Question.insertMany(quantDocs);
  const reasonInserted = await Question.insertMany(reasonDocs);

  const gaIds = gaInserted.map(d => d._id);
  const quantIds = quantInserted.map(d => d._id);
  const reasonIds = reasonInserted.map(d => d._id);

  // persist counters
  for (const k of Object.keys(counterMap)) {
    const [subjectId, topicId] = k.split("_");
    await QuestionCounter.findOneAndUpdate(
      { subjectId, topicId },
      { $set: { count: counterMap[k] } },
      { upsert: true }
    );
  }

  // ---- assemble & publish 10 sets ----
  const refs = (ids) => ids.map(id => ({ questionId: id }));
  const setIds = [];

  for (let s = 0; s < NUM_SETS; s++) {
    const meta = perSet[s];
    const quantSet = quantIds.slice(meta.quantRange[0], meta.quantRange[1]);
    const reasonSet = reasonIds.slice(meta.reasonRange[0], meta.reasonRange[1]);
    const gaSet = shuffle(gaIds).slice(0, QPS);
    const engSet = shuffle(englishPool).slice(0, QPS);

    const set = await SetPaper.create({
      title: titles[s],
      isPublished: true,
      isActive: true,
      sections: [
        { name: "General Intelligence & Reasoning", duration: SECTION_MIN, positiveMarks: POS, negativeMarks: NEG, subjects: [{ subjectId: bySlug["reasoning"]._id, maxQuestions: QPS, questions: refs(reasonSet) }] },
        { name: "General Awareness", duration: SECTION_MIN, positiveMarks: POS, negativeMarks: NEG, subjects: [{ subjectId: bySlug["general-studies"]._id, maxQuestions: QPS, questions: refs(gaSet) }] },
        { name: "Quantitative Aptitude", duration: SECTION_MIN, positiveMarks: POS, negativeMarks: NEG, subjects: [{ subjectId: bySlug["quantitative-aptitude"]._id, maxQuestions: QPS, questions: refs(quantSet) }] },
        { name: "English Comprehension", duration: SECTION_MIN, positiveMarks: POS, negativeMarks: NEG, subjects: [{ subjectId: bySlug["english"]._id, maxQuestions: QPS, questions: refs(engSet) }] }
      ]
    });
    setIds.push(set._id);
    console.log(`  ✔ ${titles[s]}`);
  }

  // ---- manifest (for undo) ----
  const manifest = {
    createdAt: new Date().toISOString(),
    questionIds: [...gaIds, ...quantIds, ...reasonIds].map(String),
    setIds: setIds.map(String)
  };
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));

  console.log("");
  console.log(`✔ Published ${setIds.length} sectional sets.`);
  console.log(`  New questions created: ${manifest.questionIds.length} (GA ${gaIds.length} + Quant ${quantIds.length} + Reasoning ${reasonIds.length})`);
  console.log(`  English reused from pool (not newly created).`);
  console.log(`  Manifest: ${MANIFEST}`);

  await mongoose.disconnect();
  process.exit(0);
}

if (process.argv.includes("--dry")) {
  // offline: validate generators + GA bank without touching the DB
  process.exit(validate() ? 0 : 1);
} else {
  run().catch(async (err) => {
    console.error("✖ Seed failed:", err.message);
    try { await mongoose.disconnect(); } catch (_) {}
    process.exit(1);
  });
}
