// One-off seed: build & publish a complete SSC CGL Tier-1 mock set paper.
//
// Structure (matches the real exam):
//   1 section "SSC CGL Tier 1" · 60 min · +2 / -0.5
//   4 subjects × 25 questions = 100 questions, single timer, free navigation.
//
// Reuses 25 existing English questions; authors 75 new bilingual questions
// (25 Reasoning, 25 Quantitative Aptitude, 25 General Studies).
//
// Idempotent guard: aborts if a set with the same title already exists.
//
// Usage:  node src/scripts/seedSscCgl.js

require("dotenv").config({ quiet: true });

const mongoose = require("mongoose");

const Subject = require("../models/Subject");
const Topic = require("../models/Topic");
const Question = require("../models/Question");
const QuestionCounter = require("../models/QuestionCounter");
const SetPaper = require("../models/SetPaper");

const SET_TITLE = "SSC CGL Tier-1 Mock Test 01";

// Each item: [ q_en, q_hi, [[a_en,a_hi],[b..],[c..],[d..]], ans, exp_en, exp_hi ]
const REASONING = [
  ["Find the next number: 2, 6, 12, 20, 30, ?", "अगली संख्या ज्ञात करें: 2, 6, 12, 20, 30, ?", [["40","40"],["42","42"],["44","44"],["46","46"]], "b", "Differences are 4,6,8,10,12 → 30+12 = 42.", "अंतर 4,6,8,10,12 हैं → 30+12 = 42।"],
  ["Find the next number: 3, 6, 11, 18, 27, ?", "अगली संख्या: 3, 6, 11, 18, 27, ?", [["36","36"],["38","38"],["40","40"],["42","42"]], "b", "Differences are 3,5,7,9,11 → 27+11 = 38.", "अंतर 3,5,7,9,11 → 27+11 = 38।"],
  ["Cat : Kitten :: Dog : ?", "बिल्ली : बिल्ली का बच्चा :: कुत्ता : ?", [["Puppy","पिल्ला"],["Calf","बछड़ा"],["Cub","शावक"],["Foal","बछेड़ा"]], "a", "A young dog is called a puppy.", "कुत्ते के बच्चे को पिल्ला कहते हैं।"],
  ["Hand : Glove :: Foot : ?", "हाथ : दस्ताना :: पैर : ?", [["Sock","मोज़ा"],["Cap","टोपी"],["Ring","अंगूठी"],["Belt","बेल्ट"]], "a", "A glove is worn on the hand; a sock on the foot.", "दस्ताना हाथ में, मोज़ा पैर में पहना जाता है।"],
  ["In a code FACE is written as GBDF. How is DEAR written?", "एक कोड में FACE को GBDF लिखा जाता है। DEAR कैसे लिखेंगे?", [["EFBS","EFBS"],["CDZQ","CDZQ"],["EFBT","EFBT"],["EGBS","EGBS"]], "a", "Each letter is shifted +1: D→E, E→F, A→B, R→S.", "प्रत्येक अक्षर +1 स्थानांतरित: D→E, E→F, A→B, R→S।"],
  ["Find the odd one out: Apple, Banana, Mango, Carrot", "विषम चुनें: सेब, केला, आम, गाजर", [["Apple","सेब"],["Banana","केला"],["Mango","आम"],["Carrot","गाजर"]], "d", "Carrot is a vegetable; the rest are fruits.", "गाजर एक सब्ज़ी है; बाकी फल हैं।"],
  ["Find the odd one out: Square, Circle, Triangle, Cube", "विषम चुनें: वर्ग, वृत्त, त्रिभुज, घन", [["Square","वर्ग"],["Circle","वृत्त"],["Triangle","त्रिभुज"],["Cube","घन"]], "d", "Cube is a 3D solid; the rest are 2D shapes.", "घन त्रिविमीय है; बाकी द्विविमीय आकृतियाँ हैं।"],
  ["A is B's brother. B is C's mother. How is A related to C?", "A, B का भाई है। B, C की माँ है। A का C से क्या संबंध है?", [["Father","पिता"],["Maternal uncle","मामा"],["Brother","भाई"],["Son","पुत्र"]], "b", "Mother's brother is the maternal uncle.", "माँ का भाई मामा होता है।"],
  ["A man walks 5 km North, turns right 3 km, turns right 5 km. How far is he from start?", "एक व्यक्ति 5 किमी उत्तर, दाएँ मुड़कर 3 किमी, फिर दाएँ 5 किमी चलता है। प्रारंभ से कितनी दूर है?", [["3 km","3 किमी"],["5 km","5 किमी"],["8 km","8 किमी"],["13 km","13 किमी"]], "a", "He ends up 3 km East of the start (the two 5 km legs cancel).", "वह प्रारंभ से 3 किमी पूर्व में है (दोनों 5 किमी रद्द हो जाते हैं)।"],
  ["Find the next letter: A, C, E, G, ?", "अगला अक्षर: A, C, E, G, ?", [["H","H"],["I","I"],["J","J"],["K","K"]], "b", "Letters skip one each time → I.", "हर बार एक अक्षर छोड़ा जाता है → I।"],
  ["Find the next letter: B, D, G, K, ?", "अगला अक्षर: B, D, G, K, ?", [["O","O"],["P","P"],["Q","Q"],["N","N"]], "b", "Gaps grow by 2,3,4,5: K(11)+5 → P(16).", "अंतराल 2,3,4,5 बढ़ते हैं: K(11)+5 → P(16)।"],
  ["5 : 25 :: 8 : ?", "5 : 25 :: 8 : ?", [["40","40"],["56","56"],["64","64"],["72","72"]], "c", "Each number is squared: 8² = 64.", "प्रत्येक संख्या का वर्ग: 8² = 64।"],
  ["7 : 49 :: 9 : ?", "7 : 49 :: 9 : ?", [["63","63"],["72","72"],["81","81"],["99","99"]], "c", "9² = 81.", "9² = 81।"],
  ["Find the odd number: 3, 5, 7, 9, 11", "विषम संख्या चुनें: 3, 5, 7, 9, 11", [["5","5"],["7","7"],["9","9"],["11","11"]], "c", "9 is not a prime number; the rest are primes.", "9 अभाज्य नहीं है; बाकी अभाज्य हैं।"],
  ["If A=1, B=2 ... then 'CAB' = ?", "यदि A=1, B=2 ... तो 'CAB' = ?", [["3,1,2","3,1,2"],["1,2,3","1,2,3"],["2,1,3","2,1,3"],["3,2,1","3,2,1"]], "a", "C=3, A=1, B=2.", "C=3, A=1, B=2।"],
  ["What is the angle between the hands of a clock at 3:00?", "3:00 बजे घड़ी की सुइयों के बीच कोण क्या है?", [["30°","30°"],["60°","60°"],["90°","90°"],["120°","120°"]], "c", "Each hour = 30°; 3 hours apart = 90°.", "प्रत्येक घंटा = 30°; 3 घंटे = 90°।"],
  ["If today is Monday, what day will it be after 61 days?", "यदि आज सोमवार है, 61 दिन बाद कौन सा दिन होगा?", [["Friday","शुक्रवार"],["Saturday","शनिवार"],["Sunday","रविवार"],["Monday","सोमवार"]], "b", "61 ÷ 7 leaves remainder 5 → Monday + 5 = Saturday.", "61 ÷ 7 शेष 5 → सोमवार + 5 = शनिवार।"],
  ["All roses are flowers. All flowers fade. Conclusion: All roses fade.", "सभी गुलाब फूल हैं। सभी फूल मुरझाते हैं। निष्कर्ष: सभी गुलाब मुरझाते हैं।", [["Valid","सही"],["Invalid","गलत"],["Cannot say","नहीं कह सकते"],["Partially","आंशिक"]], "a", "Roses ⊆ flowers ⊆ things that fade, so the conclusion follows.", "गुलाब ⊆ फूल ⊆ मुरझाने वाले, इसलिए निष्कर्ष सही है।"],
  ["Find the next number: 1, 4, 9, 16, 25, ?", "अगली संख्या: 1, 4, 9, 16, 25, ?", [["30","30"],["35","35"],["36","36"],["49","49"]], "c", "Perfect squares: 6² = 36.", "पूर्ण वर्ग: 6² = 36।"],
  ["Find the next number: 1, 8, 27, 64, ?", "अगली संख्या: 1, 8, 27, 64, ?", [["100","100"],["121","121"],["125","125"],["216","216"]], "c", "Perfect cubes: 5³ = 125.", "पूर्ण घन: 5³ = 125।"],
  ["Pen : Write :: Knife : ?", "कलम : लिखना :: चाकू : ?", [["Cut","काटना"],["Cook","पकाना"],["Sharp","तेज़"],["Steel","इस्पात"]], "a", "A pen is used to write; a knife to cut.", "कलम लिखने, चाकू काटने के लिए।"],
  ["Find the odd one out: Dog, Cow, Lion, Horse", "विषम चुनें: कुत्ता, गाय, शेर, घोड़ा", [["Dog","कुत्ता"],["Cow","गाय"],["Lion","शेर"],["Horse","घोड़ा"]], "c", "Lion is a wild animal; the rest are domestic.", "शेर जंगली है; बाकी पालतू हैं।"],
  ["Find the next number: 12, 24, 36, 48, ?", "अगली संख्या: 12, 24, 36, 48, ?", [["54","54"],["60","60"],["66","66"],["72","72"]], "b", "Multiples of 12: 48+12 = 60.", "12 के गुणज: 48+12 = 60।"],
  ["If 'TIME' is reversed, what do we get?", "यदि 'TIME' को उल्टा करें, तो क्या मिलेगा?", [["EMIT","EMIT"],["MITE","MITE"],["ITEM","ITEM"],["MEIT","MEIT"]], "a", "TIME reversed letter-by-letter is EMIT.", "TIME को उल्टा करने पर EMIT मिलता है।"],
  ["Find the next letter: Z, X, V, T, ?", "अगला अक्षर: Z, X, V, T, ?", [["P","P"],["Q","Q"],["R","R"],["S","S"]], "c", "Letters decrease by 2: T → R.", "अक्षर 2 घटते हैं: T → R।"],
];

const QUANT = [
  ["What is 15% of 200?", "200 का 15% क्या है?", [["20","20"],["25","25"],["30","30"],["35","35"]], "c", "15/100 × 200 = 30.", "15/100 × 200 = 30।"],
  ["What is 25% of 480?", "480 का 25% क्या है?", [["110","110"],["120","120"],["130","130"],["140","140"]], "b", "480 ÷ 4 = 120.", "480 ÷ 4 = 120।"],
  ["Find the average of 10, 20, 30, 40, 50.", "10, 20, 30, 40, 50 का औसत ज्ञात करें।", [["25","25"],["30","30"],["35","35"],["40","40"]], "b", "Sum 150 ÷ 5 = 30.", "योग 150 ÷ 5 = 30।"],
  ["Simplify: 12 × 8 ÷ 4 + 6", "हल करें: 12 × 8 ÷ 4 + 6", [["24","24"],["28","28"],["30","30"],["36","36"]], "c", "12×8=96, ÷4=24, +6=30.", "12×8=96, ÷4=24, +6=30।"],
  ["Simple interest on ₹1000 at 5% per annum for 2 years?", "₹1000 पर 5% वार्षिक दर से 2 वर्ष का साधारण ब्याज?", [["₹50","₹50"],["₹100","₹100"],["₹150","₹150"],["₹200","₹200"]], "b", "SI = 1000×5×2/100 = 100.", "ब्याज = 1000×5×2/100 = 100।"],
  ["Compound interest on ₹1000 at 10% p.a. for 2 years?", "₹1000 पर 10% वार्षिक दर से 2 वर्ष का चक्रवृद्धि ब्याज?", [["₹200","₹200"],["₹210","₹210"],["₹220","₹220"],["₹100","₹100"]], "b", "1000×1.1² − 1000 = 1210 − 1000 = 210.", "1000×1.1² − 1000 = 210।"],
  ["Divide ₹600 in the ratio 1 : 2. What is the larger part?", "₹600 को 1 : 2 के अनुपात में बाँटें। बड़ा भाग?", [["200","200"],["300","300"],["400","400"],["450","450"]], "c", "Parts 200 and 400; larger = 400.", "भाग 200 और 400; बड़ा = 400।"],
  ["A car covers 120 km in 2 hours. Its speed is?", "एक कार 2 घंटे में 120 किमी चलती है। उसकी गति?", [["50 km/h","50 किमी/घं"],["60 km/h","60 किमी/घं"],["70 km/h","70 किमी/घं"],["80 km/h","80 किमी/घं"]], "b", "Speed = 120 ÷ 2 = 60 km/h.", "गति = 120 ÷ 2 = 60 किमी/घं।"],
  ["CP = ₹200, SP = ₹250. Find profit %.", "क्रय मूल्य = ₹200, विक्रय = ₹250। लाभ %?", [["20%","20%"],["25%","25%"],["30%","30%"],["50%","50%"]], "b", "Profit 50/200 × 100 = 25%.", "लाभ 50/200 × 100 = 25%।"],
  ["CP = ₹500, SP = ₹400. Find loss %.", "क्रय = ₹500, विक्रय = ₹400। हानि %?", [["10%","10%"],["15%","15%"],["20%","20%"],["25%","25%"]], "c", "Loss 100/500 × 100 = 20%.", "हानि 100/500 × 100 = 20%।"],
  ["Area of a rectangle with length 8 and width 5?", "8 लंबाई और 5 चौड़ाई वाले आयत का क्षेत्रफल?", [["13","13"],["26","26"],["40","40"],["45","45"]], "c", "Area = 8 × 5 = 40.", "क्षेत्रफल = 8 × 5 = 40।"],
  ["Perimeter of a square of side 7?", "7 भुजा वाले वर्ग का परिमाप?", [["14","14"],["21","21"],["28","28"],["49","49"]], "c", "Perimeter = 4 × 7 = 28.", "परिमाप = 4 × 7 = 28।"],
  ["Area of a circle of radius 7 (π = 22/7)?", "त्रिज्या 7 वाले वृत्त का क्षेत्रफल (π = 22/7)?", [["144","144"],["154","154"],["164","164"],["176","176"]], "b", "πr² = 22/7 × 49 = 154.", "πr² = 22/7 × 49 = 154।"],
  ["Volume of a cube of side 4?", "4 भुजा वाले घन का आयतन?", [["16","16"],["48","48"],["64","64"],["256","256"]], "c", "4³ = 64.", "4³ = 64।"],
  ["LCM of 4 and 6?", "4 और 6 का ल.स.?", [["6","6"],["12","12"],["18","18"],["24","24"]], "b", "LCM(4,6) = 12.", "ल.स.(4,6) = 12।"],
  ["HCF of 12 and 18?", "12 और 18 का म.स.?", [["3","3"],["6","6"],["9","9"],["12","12"]], "b", "HCF(12,18) = 6.", "म.स.(12,18) = 6।"],
  ["What is the square root of 144?", "144 का वर्गमूल क्या है?", [["11","11"],["12","12"],["13","13"],["14","14"]], "b", "12 × 12 = 144.", "12 × 12 = 144।"],
  ["What is 3/4 of 80?", "80 का 3/4 क्या है?", [["40","40"],["50","50"],["60","60"],["70","70"]], "c", "80 × 3/4 = 60.", "80 × 3/4 = 60।"],
  ["2/5 + 1/5 = ?", "2/5 + 1/5 = ?", [["1/5","1/5"],["2/5","2/5"],["3/5","3/5"],["4/5","4/5"]], "c", "(2+1)/5 = 3/5.", "(2+1)/5 = 3/5।"],
  ["If x + 5 = 12, then x = ?", "यदि x + 5 = 12, तो x = ?", [["5","5"],["6","6"],["7","7"],["8","8"]], "c", "x = 12 − 5 = 7.", "x = 12 − 5 = 7।"],
  ["What is 20% of 20% of 500?", "500 के 20% का 20% क्या है?", [["10","10"],["20","20"],["50","50"],["100","100"]], "b", "0.2 × 0.2 × 500 = 20.", "0.2 × 0.2 × 500 = 20।"],
  ["A 100 m long train at 36 km/h crosses a pole in?", "36 किमी/घं की 100 मीटर लंबी रेलगाड़ी एक खंभे को कितनी देर में पार करती है?", [["5 s","5 से"],["10 s","10 से"],["12 s","12 से"],["18 s","18 से"]], "b", "36 km/h = 10 m/s; 100/10 = 10 s.", "36 किमी/घं = 10 मी/से; 100/10 = 10 से।"],
  ["Average speed for equal distances at 40 and 60 km/h?", "40 और 60 किमी/घं पर समान दूरी की औसत गति?", [["45 km/h","45 किमी/घं"],["48 km/h","48 किमी/घं"],["50 km/h","50 किमी/घं"],["52 km/h","52 किमी/घं"]], "b", "2ab/(a+b) = 2×40×60/100 = 48.", "2ab/(a+b) = 2×40×60/100 = 48।"],
  ["Compound interest on ₹8000 at 5% p.a. for 1 year?", "₹8000 पर 5% वार्षिक दर से 1 वर्ष का चक्रवृद्धि ब्याज?", [["₹300","₹300"],["₹400","₹400"],["₹420","₹420"],["₹500","₹500"]], "b", "For 1 year CI = SI = 8000×5/100 = 400.", "1 वर्ष के लिए चक्रवृद्धि = साधारण = 400।"],
  ["What is the value of 5! (5 factorial)?", "5! (5 क्रमगुणित) का मान क्या है?", [["60","60"],["100","100"],["120","120"],["125","125"]], "c", "5×4×3×2×1 = 120.", "5×4×3×2×1 = 120।"],
];

const GS = [
  ["What is the capital of India?", "भारत की राजधानी क्या है?", [["Mumbai","मुंबई"],["New Delhi","नई दिल्ली"],["Kolkata","कोलकाता"],["Chennai","चेन्नई"]], "b", "New Delhi is the capital of India.", "नई दिल्ली भारत की राजधानी है।"],
  ["What is the national animal of India?", "भारत का राष्ट्रीय पशु क्या है?", [["Lion","शेर"],["Elephant","हाथी"],["Tiger","बाघ"],["Leopard","तेंदुआ"]], "c", "The Bengal Tiger is India's national animal.", "बंगाल टाइगर भारत का राष्ट्रीय पशु है।"],
  ["Who is known as the Father of the Nation in India?", "भारत में राष्ट्रपिता किसे कहा जाता है?", [["Nehru","नेहरू"],["Mahatma Gandhi","महात्मा गांधी"],["Patel","पटेल"],["Bose","बोस"]], "b", "Mahatma Gandhi is called the Father of the Nation.", "महात्मा गांधी को राष्ट्रपिता कहा जाता है।"],
  ["Who was the first Prime Minister of India?", "भारत के प्रथम प्रधानमंत्री कौन थे?", [["Patel","पटेल"],["Nehru","नेहरू"],["Rajendra Prasad","राजेंद्र प्रसाद"],["Shastri","शास्त्री"]], "b", "Jawaharlal Nehru was the first PM.", "जवाहरलाल नेहरू प्रथम प्रधानमंत्री थे।"],
  ["When did the Constitution of India come into force?", "भारत का संविधान कब लागू हुआ?", [["15 Aug 1947","15 अग 1947"],["26 Nov 1949","26 नव 1949"],["26 Jan 1950","26 जन 1950"],["2 Oct 1950","2 अक्ट 1950"]], "c", "It came into force on 26 January 1950.", "यह 26 जनवरी 1950 को लागू हुआ।"],
  ["How many fundamental rights are there in the Indian Constitution now?", "भारतीय संविधान में अब कितने मौलिक अधिकार हैं?", [["5","5"],["6","6"],["7","7"],["8","8"]], "b", "There are 6 fundamental rights currently.", "वर्तमान में 6 मौलिक अधिकार हैं।"],
  ["Which is the largest state of India by area?", "क्षेत्रफल की दृष्टि से भारत का सबसे बड़ा राज्य?", [["Madhya Pradesh","मध्य प्रदेश"],["Maharashtra","महाराष्ट्र"],["Rajasthan","राजस्थान"],["Uttar Pradesh","उत्तर प्रदेश"]], "c", "Rajasthan is the largest state by area.", "राजस्थान क्षेत्रफल में सबसे बड़ा राज्य है।"],
  ["Which is the longest river in India?", "भारत की सबसे लंबी नदी कौन सी है?", [["Yamuna","यमुना"],["Ganga","गंगा"],["Godavari","गोदावरी"],["Narmada","नर्मदा"]], "b", "The Ganga is the longest river in India.", "गंगा भारत की सबसे लंबी नदी है।"],
  ["What is the national bird of India?", "भारत का राष्ट्रीय पक्षी क्या है?", [["Peacock","मोर"],["Parrot","तोता"],["Eagle","चील"],["Swan","हंस"]], "a", "The Indian Peacock is the national bird.", "भारतीय मोर राष्ट्रीय पक्षी है।"],
  ["Who wrote the national anthem of India?", "भारत का राष्ट्रगान किसने लिखा?", [["Bankim Chandra","बंकिम चंद्र"],["Rabindranath Tagore","रवींद्रनाथ टैगोर"],["Sarojini Naidu","सरोजिनी नायडू"],["Iqbal","इकबाल"]], "b", "Rabindranath Tagore wrote 'Jana Gana Mana'.", "रवींद्रनाथ टैगोर ने 'जन गण मन' लिखा।"],
  ["What is the chemical symbol of Gold?", "सोने का रासायनिक प्रतीक क्या है?", [["Go","Go"],["Gd","Gd"],["Au","Au"],["Ag","Ag"]], "c", "Gold's symbol is Au (from Latin 'aurum').", "सोने का प्रतीक Au है (लैटिन 'aurum')।"],
  ["What is the chemical formula of water?", "पानी का रासायनिक सूत्र क्या है?", [["CO2","CO2"],["H2O","H2O"],["O2","O2"],["NaCl","NaCl"]], "b", "Water is H2O.", "पानी H2O है।"],
  ["Which gas do plants absorb during photosynthesis?", "प्रकाश संश्लेषण में पौधे कौन सी गैस अवशोषित करते हैं?", [["Oxygen","ऑक्सीजन"],["Nitrogen","नाइट्रोजन"],["Carbon dioxide","कार्बन डाइऑक्साइड"],["Hydrogen","हाइड्रोजन"]], "c", "Plants absorb carbon dioxide.", "पौधे कार्बन डाइऑक्साइड अवशोषित करते हैं।"],
  ["What is known as the powerhouse of the cell?", "कोशिका का ऊर्जा गृह किसे कहते हैं?", [["Nucleus","केंद्रक"],["Ribosome","राइबोसोम"],["Mitochondria","माइटोकॉन्ड्रिया"],["Vacuole","रसधानी"]], "c", "Mitochondria is the powerhouse of the cell.", "माइटोकॉन्ड्रिया कोशिका का ऊर्जा गृह है।"],
  ["Which planet is known as the Red Planet?", "किस ग्रह को लाल ग्रह कहा जाता है?", [["Venus","शुक्र"],["Mars","मंगल"],["Jupiter","बृहस्पति"],["Saturn","शनि"]], "b", "Mars is called the Red Planet.", "मंगल को लाल ग्रह कहा जाता है।"],
  ["Which is the largest planet in the solar system?", "सौर मंडल का सबसे बड़ा ग्रह कौन सा है?", [["Earth","पृथ्वी"],["Saturn","शनि"],["Jupiter","बृहस्पति"],["Neptune","वरुण"]], "c", "Jupiter is the largest planet.", "बृहस्पति सबसे बड़ा ग्रह है।"],
  ["The speed of light is approximately?", "प्रकाश की गति लगभग कितनी है?", [["3×10⁶ m/s","3×10⁶ मी/से"],["3×10⁸ m/s","3×10⁸ मी/से"],["3×10⁵ m/s","3×10⁵ मी/से"],["3×10¹⁰ m/s","3×10¹⁰ मी/से"]], "b", "Light travels at about 3×10⁸ m/s.", "प्रकाश की गति लगभग 3×10⁸ मी/से है।"],
  ["What is the SI unit of electric current?", "विद्युत धारा का SI मात्रक क्या है?", [["Volt","वोल्ट"],["Ampere","एम्पियर"],["Ohm","ओम"],["Watt","वाट"]], "b", "The ampere is the SI unit of current.", "एम्पियर धारा का SI मात्रक है।"],
  ["Which vitamin is produced when skin is exposed to sunlight?", "सूर्य के प्रकाश से त्वचा में कौन सा विटामिन बनता है?", [["Vitamin A","विटामिन A"],["Vitamin B","विटामिन B"],["Vitamin C","विटामिन C"],["Vitamin D","विटामिन D"]], "d", "Sunlight helps the body make Vitamin D.", "सूर्य के प्रकाश से विटामिन D बनता है।"],
  ["In which year was the Reserve Bank of India established?", "भारतीय रिज़र्व बैंक की स्थापना किस वर्ष हुई?", [["1925","1925"],["1935","1935"],["1947","1947"],["1950","1950"]], "b", "The RBI was established in 1935.", "RBI की स्थापना 1935 में हुई।"],
  ["Who was the first President of India?", "भारत के प्रथम राष्ट्रपति कौन थे?", [["Nehru","नेहरू"],["Dr. Rajendra Prasad","डॉ. राजेंद्र प्रसाद"],["Radhakrishnan","राधाकृष्णन"],["Patel","पटेल"]], "b", "Dr. Rajendra Prasad was the first President.", "डॉ. राजेंद्र प्रसाद प्रथम राष्ट्रपति थे।"],
  ["In which year did India gain independence?", "भारत को स्वतंत्रता किस वर्ष मिली?", [["1945","1945"],["1946","1946"],["1947","1947"],["1948","1948"]], "c", "India became independent in 1947.", "भारत 1947 में स्वतंत्र हुआ।"],
  ["In which year did the Jallianwala Bagh massacre take place?", "जलियांवाला बाग हत्याकांड किस वर्ष हुआ?", [["1909","1909"],["1919","1919"],["1929","1929"],["1942","1942"]], "b", "It occurred in 1919.", "यह 1919 में हुआ।"],
  ["Who built the Taj Mahal?", "ताजमहल किसने बनवाया?", [["Akbar","अकबर"],["Shah Jahan","शाहजहाँ"],["Aurangzeb","औरंगज़ेब"],["Babur","बाबर"]], "b", "Shah Jahan built the Taj Mahal.", "शाहजहाँ ने ताजमहल बनवाया।"],
  ["In which year was the Quit India Movement launched?", "भारत छोड़ो आंदोलन किस वर्ष शुरू हुआ?", [["1930","1930"],["1942","1942"],["1945","1945"],["1947","1947"]], "b", "The Quit India Movement began in 1942.", "भारत छोड़ो आंदोलन 1942 में शुरू हुआ।"],
];

async function createQuestions(subject, topics, items) {
  const ids = [];

  for (let i = 0; i < items.length; i++) {
    const [q_en, q_hi, opts, ans, exp_en, exp_hi] = items[i];

    // spread questions across the subject's topics (round-robin)
    const topic = topics[i % topics.length];

    const counter = await QuestionCounter.findOneAndUpdate(
      { subjectId: subject._id, topicId: topic._id },
      { $inc: { count: 1 } },
      { new: true, upsert: true }
    );

    const number = String(counter.count).padStart(4, "0");
    const questionCode = `${subject.slug}_${topic.slug}_${number}`;

    const doc = await Question.create({
      subjectId: subject._id,
      topicId: topic._id,
      questionCode,
      question: { en: q_en, hi: q_hi },
      options: opts.map((o, idx) => ({
        key: ["a", "b", "c", "d"][idx],
        text: { en: o[0], hi: o[1] }
      })),
      correctAnswer: ans,
      explanation: { en: exp_en, hi: exp_hi }
    });

    ids.push(doc._id);
  }

  return ids;
}

async function run() {
  if (!process.env.MONGO_URI) {
    console.error("✖ MONGO_URI is not set (check your .env).");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("MongoDB connected");

  // idempotency guard
  const existing = await SetPaper.findOne({ title: SET_TITLE });
  if (existing) {
    console.error(
      `✖ A set titled "${SET_TITLE}" already exists. ` +
      `Delete it (and its questions) before re-seeding.`
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  // load subjects by slug
  const bySlug = {};
  for (const slug of [
    "reasoning",
    "general-studies",
    "quantitative-aptitude",
    "english"
  ]) {
    const s = await Subject.findOne({ slug });
    if (!s) {
      console.error(`✖ Subject with slug "${slug}" not found.`);
      await mongoose.disconnect();
      process.exit(1);
    }
    bySlug[slug] = s;
  }

  // topics per authored subject
  const reasoningTopics = await Topic.find({
    subjectId: bySlug["reasoning"]._id, isActive: true
  });
  const gsTopics = await Topic.find({
    subjectId: bySlug["general-studies"]._id, isActive: true
  });
  const quantTopics = await Topic.find({
    subjectId: bySlug["quantitative-aptitude"]._id, isActive: true
  });

  if (!reasoningTopics.length || !gsTopics.length || !quantTopics.length) {
    console.error("✖ Each authored subject needs at least one active topic.");
    await mongoose.disconnect();
    process.exit(1);
  }

  // reuse 25 existing English questions
  const englishDocs = await Question.find({
    subjectId: bySlug["english"]._id, isActive: true
  }).limit(25).select("_id");

  if (englishDocs.length < 25) {
    console.error(
      `✖ Need 25 active English questions, found ${englishDocs.length}.`
    );
    await mongoose.disconnect();
    process.exit(1);
  }
  const englishIds = englishDocs.map((d) => d._id);

  console.log("Authoring questions...");
  const reasoningIds = await createQuestions(
    bySlug["reasoning"], reasoningTopics, REASONING
  );
  const gsIds = await createQuestions(
    bySlug["general-studies"], gsTopics, GS
  );
  const quantIds = await createQuestions(
    bySlug["quantitative-aptitude"], quantTopics, QUANT
  );

  console.log(
    `Created — Reasoning: ${reasoningIds.length}, GS: ${gsIds.length}, ` +
    `Quant: ${quantIds.length} | Reused English: ${englishIds.length}`
  );

  // assemble a single 60-min section with all 4 subjects (SSC CGL order)
  const toRefs = (ids) => ids.map((id) => ({ questionId: id }));

  const set = await SetPaper.create({
    title: SET_TITLE,
    isPublished: true,
    isActive: true,
    sections: [
      {
        name: "SSC CGL Tier 1",
        duration: 60,
        positiveMarks: 2,
        negativeMarks: 0.5,
        subjects: [
          { subjectId: bySlug["reasoning"]._id, maxQuestions: 25, questions: toRefs(reasoningIds) },
          { subjectId: bySlug["general-studies"]._id, maxQuestions: 25, questions: toRefs(gsIds) },
          { subjectId: bySlug["quantitative-aptitude"]._id, maxQuestions: 25, questions: toRefs(quantIds) },
          { subjectId: bySlug["english"]._id, maxQuestions: 25, questions: toRefs(englishIds) }
        ]
      }
    ]
  });

  console.log("");
  console.log(`✔ Published set: "${set.title}"`);
  console.log(`  _id: ${set._id}`);
  console.log(`  100 questions · 60 min · +2 / -0.5 · 1 section, 4 subjects`);

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (err) => {
  console.error("✖ Seed failed:", err.message);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
