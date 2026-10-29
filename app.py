"""
NammaBhasha - Flask Backend & API Server
Serves the offline-ready Single Page App and provides REST API endpoints
for phrases, situational search, dialogues, and quizzes.
"""

import os
import json
from flask import Flask, jsonify, request, send_from_directory

app = Flask(__name__, static_folder=".", static_url_path="")

# Load phrases dataset
DATA_FILE = os.path.join(os.path.dirname(__file__), "data", "phrases.json")

def load_data():
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"categories": [], "phrases": [], "dialogues": [], "quizzes": []}

@app.route("/")
def serve_index():
    """Serves the offline-capable PWA frontend."""
    return send_from_directory(".", "index.html")

@app.after_request
def add_cors_headers(response):
    """Enable CORS for local development and cross-origin PWA testing."""
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    return response

@app.route("/api/health", methods=["GET"])
def health_check():
    """Health check endpoint for deployment monitoring."""
    data = load_data()
    return jsonify({
        "status": "healthy",
        "app": "NammaBhasha",
        "version": "1.1.0",
        "features": {
            "search": True,
            "phrase_selection": True,
            "tts_support": True,
            "speech_recognition": True,
            "offline_pwa": True
        },
        "stats": {
            "categories": len(data.get("categories", [])),
            "phrases": len(data.get("phrases", [])),
            "dialogues": len(data.get("dialogues", [])),
            "quizzes": len(data.get("quizzes", []))
        }
    })

@app.route("/api/categories", methods=["GET"])
def get_categories():
    """Returns all situational categories with real-time phrase counts."""
    data = load_data()
    categories = data.get("categories", [])
    phrases = data.get("phrases", [])
    
    # Calculate phrase count per category
    cat_counts = {}
    for p in phrases:
        c = p.get("category", "")
        cat_counts[c] = cat_counts.get(c, 0) + 1
        
    enriched = []
    for cat in categories:
        cat_copy = dict(cat)
        cat_copy["phraseCount"] = cat_counts.get(cat.get("id"), 0)
        enriched.append(cat_copy)
        
    return jsonify(enriched)

@app.route("/api/phrases", methods=["GET"])
def get_phrases():
    """
    Search and phrase selection endpoint:
    Returns verified Kannada phrases with query filters:
    - category: filter by situational category (travel, shopping, healthcare, etc.)
    - q: search query across Kannada script, English meaning, and Romanized phonetics
    - tag: filter by specific tag
    - is_emergency: filter urgent SOS phrases (true/false)
    - limit: maximum number of phrases to return (pagination)
    - offset: pagination offset
    """
    data = load_data()
    phrases = data.get("phrases", [])
    
    cat = request.args.get("category", "").strip().lower()
    q = request.args.get("q", "").strip().lower()
    tag = request.args.get("tag", "").strip().lower()
    is_emergency = request.args.get("is_emergency", "").strip().lower()

    if cat and cat != "all":
        phrases = [p for p in phrases if p.get("category", "").lower() == cat]

    if tag:
        phrases = [p for p in phrases if any(tag == t.lower() for t in p.get("tags", []))]

    if is_emergency in ("true", "1", "yes"):
        phrases = [p for p in phrases if p.get("isEmergency") is True or p.get("category") == "quickhelp"]

    if q:
        # Score and rank search results for maximum relevance
        scored = []
        for p in phrases:
            kannada = p.get("kannada", "").lower()
            english = p.get("english", "").lower()
            pronounce = p.get("pronunciation", "").lower()
            tags = [t.lower() for t in p.get("tags", [])]
            when = p.get("whenToUse", "").lower()
            tip = p.get("culturalTip", "").lower()

            score = 0
            if q == kannada or q == english:
                score += 100
            elif kannada.startswith(q) or english.startswith(q) or pronounce.startswith(q):
                score += 75
            elif q in kannada:
                score += 60
            elif q in english or q in pronounce:
                score += 50
            elif any(q in t for t in tags):
                score += 40
            elif q in when or q in tip:
                score += 20

            if score > 0:
                scored.append((score, p))

        scored.sort(key=lambda x: x[0], reverse=True)
        phrases = [item[1] for item in scored]

    total_count = len(phrases)

    # Optional pagination
    limit = request.args.get("limit", type=int)
    offset = request.args.get("offset", default=0, type=int)
    if limit is not None and limit > 0:
        phrases = phrases[offset:offset + limit]

    return jsonify({
        "count": len(phrases),
        "total": total_count,
        "category": cat or "all",
        "query": q,
        "phrases": phrases
    })

@app.route("/api/phrases/random", methods=["GET"])
def get_random_phrase():
    """
    Phrase selection endpoint:
    Returns random verified phrase(s) for quick practice or 'Phrase of the Day'.
    - count: number of random phrases (default 1)
    - category: optional category filter
    """
    import random
    data = load_data()
    phrases = data.get("phrases", [])
    cat = request.args.get("category", "").strip().lower()
    
    if cat and cat != "all":
        phrases = [p for p in phrases if p.get("category", "").lower() == cat]

    if not phrases:
        return jsonify({"error": "No phrases match the criteria"}), 404

    count = min(request.args.get("count", default=1, type=int), len(phrases))
    selected = random.sample(phrases, count)
    return jsonify({
        "count": len(selected),
        "selected": selected[0] if count == 1 else selected
    })

@app.route("/api/phrases/daily", methods=["GET"])
def get_daily_phrase():
    """
    Phrase selection endpoint:
    Deterministically returns a 'Phrase of the Day' based on current calendar day.
    """
    import datetime
    data = load_data()
    phrases = data.get("phrases", [])
    if not phrases:
        return jsonify({"error": "No phrases found"}), 404

    day_of_year = datetime.datetime.now().timetuple().tm_yday
    idx = day_of_year % len(phrases)
    daily_phrase = phrases[idx]
    
    return jsonify({
        "date": datetime.date.today().isoformat(),
        "dayOfYear": day_of_year,
        "phrase": daily_phrase
    })

@app.route("/api/phrases/selection", methods=["GET"])
def get_phrase_selection():
    """
    Phrase selection endpoint:
    Select phrases by explicit IDs (e.g. ?ids=tr_1,fd_1,hc_2) or by list of tags.
    """
    data = load_data()
    phrases = data.get("phrases", [])
    ids_param = request.args.get("ids", "").strip()
    
    if not ids_param:
        return jsonify({"error": "Please provide comma-separated 'ids' query parameter"}), 400

    target_ids = set([x.strip() for x in ids_param.split(",") if x.strip()])
    selected = [p for p in phrases if p.get("id") in target_ids]

    return jsonify({
        "requested": list(target_ids),
        "count": len(selected),
        "phrases": selected
    })

@app.route("/api/phrases/<phrase_id>", methods=["GET"])
def get_phrase_detail(phrase_id):
    """
    Phrase selection endpoint:
    Returns detailed phrase data including situational context, next reply,
    and related phrases in the same category.
    """
    data = load_data()
    phrases = data.get("phrases", [])
    
    matched = None
    for p in phrases:
        if p.get("id") == phrase_id:
            matched = p
            break

    if not matched:
        return jsonify({"error": f"Phrase '{phrase_id}' not found"}), 404

    # Fetch 3 related phrases in the same situational category
    related = [
        p for p in phrases
        if p.get("category") == matched.get("category") and p.get("id") != phrase_id
    ][:3]

    result = dict(matched)
    result["relatedPhrases"] = related
    return jsonify(result)

@app.route("/api/dialogues", methods=["GET"])
def get_dialogues():
    """Returns 'What to Say Next' simulated conversation scenarios."""
    data = load_data()
    return jsonify(data.get("dialogues", []))

@app.route("/api/quiz", methods=["GET"])
def get_quiz():
    """Returns interactive practice quiz scenarios."""
    data = load_data()
    return jsonify(data.get("quizzes", []))

@app.route("/api/alphabet", methods=["GET"])
def get_alphabet():
    """Returns Kannada alphabet soundboard primer."""
    data = load_data()
    return jsonify(data.get("alphabet", []))

@app.route("/api/numbers", methods=["GET"])
def get_numbers():
    """Returns Kannada numbers and currency counter."""
    data = load_data()
    return jsonify(data.get("numbers", []))

@app.route("/api/slang", methods=["GET"])
def get_slang():
    """Returns Bangalore slang and colloquial expressions."""
    data = load_data()
    return jsonify(data.get("slang", []))

@app.route("/api/magic-words", methods=["GET"])
def get_magic_words():
    """Returns 10 essential magic words for daily interactions."""
    data = load_data()
    return jsonify(data.get("magicWords", []))

@app.route("/api/builder", methods=["GET"])
def get_builder_vocabulary():
    """Returns vocabulary components for the Smart Sentence Builder."""
    data = load_data()
    return jsonify(data.get("builderVocabulary", {}))

@app.route("/api/visual", methods=["GET"])
def get_visual_cards():
    """Returns visual pictogram cards for zero-literacy and non-reading accessibility."""
    data = load_data()
    return jsonify(data.get("visualCards", []))

@app.route("/api/practice/prompts", methods=["GET"])
def get_practice_prompts():
    """Returns curated speech practice prompt sets categorized by daily life scenarios."""
    data = load_data()
    phrases = data.get("phrases", [])
    cat = request.args.get("category", "").strip().lower()
    
    if cat and cat != "all":
        filtered = [p for p in phrases if p.get("category", "").lower() == cat]
    else:
        filtered = phrases

    prompts = [
        {
            "id": p.get("id"),
            "kannada": p.get("kannada"),
            "pronunciation": p.get("pronunciation"),
            "english": p.get("english"),
            "category": p.get("category"),
            "difficulty": p.get("difficulty", "beginner"),
            "audioText": p.get("kannada"),
            "tags": p.get("tags", [])
        }
        for p in filtered[:15]
    ]
    return jsonify({
        "count": len(prompts),
        "prompts": prompts
    })

@app.route("/api/practice/evaluate", methods=["POST"])
def evaluate_speech():
    """
    Evaluates speech capture transcript against target Kannada and pronunciation.
    Calculates accuracy score, word matches, and returns cultural praise feedback.
    """
    body = request.get_json() or {}
    spoken = body.get("spoken", "").strip().lower()
    kannada_target = body.get("target_kannada", "").strip().lower()
    phonetic_target = (body.get("target_pronounce") or body.get("target_phonetic") or "").strip().lower()

    if not spoken:
        return jsonify({
            "score": 0,
            "status": "no_speech",
            "message": "ಧ್ವನಿ ಕೇಳಿಸಲಿಲ್ಲ (No speech captured). Please speak closer to microphone."
        }), 400

    import re
    s_clean = re.sub(r'[^\w\s\u0C80-\u0CFF]', '', spoken)
    k_clean = re.sub(r'[^\w\s\u0C80-\u0CFF]', '', kannada_target)
    p_clean = re.sub(r'[^\w\s]', '', phonetic_target)

    if s_clean == k_clean or s_clean == p_clean:
        score = 100
    elif k_clean in s_clean or s_clean in k_clean or p_clean in s_clean or s_clean in p_clean:
        score = 88
    else:
        spoken_words = s_clean.split()
        target_words = (p_clean + " " + k_clean).split()
        matched = sum(1 for w in spoken_words if any(w in tw or tw in w for tw in target_words if len(tw) >= 2))
        if spoken_words:
            ratio = matched / len(spoken_words)
            score = max(50, min(95, int(ratio * 100)))
        else:
            score = 50

    if score >= 90:
        feedback = "ಸಕ್ಕತ್! ಅತ್ಯುತ್ತಮ ಉಚ್ಚಾರಣೆ! (Sakkath! Superb native pronunciation!)"
        rating = "excellent"
    elif score >= 70:
        feedback = "ತುಂಬಾ ಚೆನ್ನಾಗಿದೆ! ಉತ್ತಮ ಪ್ರಯತ್ನ! (Very good effort! Almost native!)"
        rating = "good"
    else:
        feedback = "ಉತ್ತಮ ಪ್ರಯತ್ನ! ನಿಧಾನವಾಗಿ ಮತ್ತೊಮ್ಮೆ ಪ್ರಯತ್ನಿಸಿ (Good try! Try speaking once more slowly.)"
        rating = "needs_practice"

    return jsonify({
        "score": score,
        "rating": rating,
        "feedback": feedback,
        "spoken": spoken,
        "xp_earned": 20 if score >= 60 else 10
    })

@app.route("/api/survival/lifelines", methods=["GET"])
def get_survival_lifelines():
    """
    Returns curated town survival lifelines, street direction commands,
    auto defense phrases, Darshini dining protocols, and golden cultural rules
    for outsiders/non-Kannadigas living or traveling in Karnataka towns.
    """
    data = {
        "categories": [
            {
                "id": "deescalate",
                "title": "ವಿವಾದ ನಿವಾರಣೆ & ಸೌಜನ್ಯ (Tension Diffuser & Lifelines)",
                "icon": "fa-handshake-angle",
                "color": "#10b981",
                "description": "The golden phrases that immediately disarm misunderstandings and win friendly local respect.",
                "phrases": [
                    {
                        "id": "surv_de_1",
                        "kannada": "ಕನ್ನಡ ಸ್ವಲ್ಪ ಗೊತ್ತು, ಕಲಿತಾ ಇದ್ದೀನಿ ಅಣ್ಣ!",
                        "pronunciation": "Kannada swalpa gothu, kalitha iddini anna!",
                        "english": "I know a little Kannada, I am learning brother!",
                        "tag": "Golden Lifeline",
                        "tip": "Say this with a warm smile. Locals in Karnataka adore anyone making an effort to speak their language."
                    },
                    {
                        "id": "surv_de_2",
                        "kannada": "ನನಗೆ ಕನ್ನಡ ಸರಿಯಾಗಿ ಬರಲ್ಲ, ಸ್ವಲ್ಪ ಇಂಗ್ಲಿಷ್ ಅಥವಾ ಹಿಂದಿಯಲ್ಲಿ ಮಾತನಾಡಬಹುದಾ?",
                        "pronunciation": "Nanage Kannada sariyaagi baralla, swalpa English athava Hindiyalli maathanaadabahuda?",
                        "english": "I don't know Kannada properly, can we speak a little English or Hindi please?",
                        "tag": "Polite Switch",
                        "tip": "Asking permission politely before switching to English/Hindi prevents resentment."
                    },
                    {
                        "id": "surv_de_3",
                        "kannada": "ಕ್ಷಮಿಸಿ ಅಣ್ಣ, ನನ್ನದೇ ತಪ್ಪು!",
                        "pronunciation": "Kshamisi anna, nannade thappu!",
                        "english": "Excuse me brother, my mistake!",
                        "tag": "Conflict Diffuser",
                        "tip": "Instantly defuses traffic arguments or accidental bumps without escalation."
                    },
                    {
                        "id": "surv_de_4",
                        "kannada": "ದಯವಿಟ್ಟು ಸ್ವಲ್ಪ ಸಹಾಯ ಮಾಡಿ ಸ್ವಾಮಿ.",
                        "pronunciation": "Dayavittu swalpa sahaaya maadi swamy.",
                        "english": "Please help me a little, sir.",
                        "tag": "Universal Request",
                        "tip": "Addressing elders, policemen, or drivers as 'Swamy' establishes dignity and warmth."
                    }
                ]
            },
            {
                "id": "directions",
                "title": "ದಾರಿ & ಸ್ಟಾಪ್ ಕಮಾಂಡ್‌ಗಳು (Street Directions & Navigation)",
                "icon": "fa-compass",
                "color": "#38bdf8",
                "description": "Essential voice commands to guide auto drivers, cabs, or find your way in any Karnataka town.",
                "phrases": [
                    {
                        "id": "surv_dir_1",
                        "kannada": "ಇಲ್ಲಿ ನಿಲ್ಲಿಸಿ ಅಣ್ಣ!",
                        "pronunciation": "Illi nillisi anna!",
                        "english": "Stop right here brother!",
                        "tag": "Stop Command",
                        "tip": "Say loudly and clearly when your destination or street corner arrives."
                    },
                    {
                        "id": "surv_dir_2",
                        "kannada": "ನೇರವಾಗಿ ಮುಂದೆ ಹೋಗಿ.",
                        "pronunciation": "Neraavaagi munde hogi.",
                        "english": "Go straight ahead.",
                        "tag": "Straight",
                        "tip": "Use when navigator or auto driver asks which way at a junction."
                    },
                    {
                        "id": "surv_dir_3",
                        "kannada": "ಮುಂದೆ ಬಲಗಡೆ ತಿರುಗಿ.",
                        "pronunciation": "Munde balagade thirugi.",
                        "english": "Turn right ahead.",
                        "tag": "Turn Right",
                        "tip": "Bala = Right side."
                    },
                    {
                        "id": "surv_dir_4",
                        "kannada": "ಮುಂದೆ ಎಡಗಡೆ ತಿರುಗಿ.",
                        "pronunciation": "Munde edagade thirugi.",
                        "english": "Turn left ahead.",
                        "tag": "Turn Left",
                        "tip": "Eda = Left side."
                    },
                    {
                        "id": "surv_dir_5",
                        "kannada": "ಇಲ್ಲಿಂದ ಎಷ್ಟು ದೂರ ಆಗುತ್ತೆ?",
                        "pronunciation": "Illinda eshtu doora aaguththe?",
                        "english": "How far is it from here?",
                        "tag": "Distance Query",
                        "tip": "Helps you know whether you can walk or need an auto."
                    },
                    {
                        "id": "surv_dir_6",
                        "kannada": "ಯಾವ ಬಸ್ ಹೋಗುತ್ತೆ ಅಣ್ಣ?",
                        "pronunciation": "Yaava bus hoguththe anna?",
                        "english": "Which bus goes there, brother?",
                        "tag": "Bus Stop",
                        "tip": "Ask locals standing at the bus stop for the right route number."
                    }
                ]
            },
            {
                "id": "autoshield",
                "title": "ಆಟೋ ಮೀಟರ್ ರಕ್ಷಣೆ (Auto Meter & Fare Shield)",
                "icon": "fa-shield-halved",
                "color": "#f59e0b",
                "description": "Safeguard yourself from being overcharged by auto drivers and avoid fare disputes.",
                "phrases": [
                    {
                        "id": "surv_auto_1",
                        "kannada": "ಮೀಟರ್ ಹಾಕಿ ಸ್ವಾಮಿ, ಮೀಟರ್ ಪ್ರಕಾರ ಬನ್ನಿ.",
                        "pronunciation": "Meter haaki swamy, meter prakaara banni.",
                        "english": "Please turn on the meter, sir; come by meter rate.",
                        "tag": "Fair Meter",
                        "tip": "Always say this before boarding the auto. Asking by meter prevents unexpected prices."
                    },
                    {
                        "id": "surv_auto_2",
                        "kannada": "ಮೀಟರ್ ಮೇಲೆ ಎಷ್ಟು ಕೊಡಬೇಕು ಅಣ್ಣ?",
                        "pronunciation": "Meter mele eshtu kodabeku anna?",
                        "english": "How much extra over the meter should I pay, brother?",
                        "tag": "Rain / Peak Hours",
                        "tip": "During heavy rain or late night, drivers ask 'Meter mele 20/30' (₹20-30 above meter)."
                    },
                    {
                        "id": "surv_auto_3",
                        "kannada": "ಚಿಲ್ಲರೆ ಇಲ್ಲ ಅಣ್ಣ, QR ಕೋಡ್ ಕೊಡಿ (GPay / PhonePe).",
                        "pronunciation": "Chillare illa anna, QR code kodi.",
                        "english": "I don't have exact change brother, please give UPI QR code.",
                        "tag": "Digital Pay",
                        "tip": "Nearly 99% of Karnataka auto drivers accept PhonePe / Google Pay QR codes."
                    },
                    {
                        "id": "surv_auto_4",
                        "kannada": "ರೌಂಡ್ ಫಿಗರ್ ಮಾಡೋಣ ಅಣ್ಣ.",
                        "pronunciation": "Round figure maadona anna.",
                        "english": "Let us make it a round figure, brother.",
                        "tag": "Quick Settlement",
                        "tip": "If meter is ₹43, say this and pay ₹50 to resolve change shortages peacefully."
                    }
                ]
            },
            {
                "id": "darshini",
                "title": "ದರ್ಶಿನಿ & ಹೋಟೆಲ್ ಸರ್ವೈವಲ್ (Darshini Dining Protocol)",
                "icon": "fa-utensils",
                "color": "#ec4899",
                "description": "Order fast, control spice levels, and navigate Bangalore/Karnataka quick-service Darshinis like a local.",
                "phrases": [
                    {
                        "id": "surv_food_1",
                        "kannada": "ಟೋಕನ್ ಎಲ್ಲಿ ತಗೋಬೇಕು?",
                        "pronunciation": "Token elli thagobeku?",
                        "english": "Where should I collect the token?",
                        "tag": "Darshini Rule 1",
                        "tip": "In self-service Darshinis, you always pay at the cash counter first and collect food with tokens."
                    },
                    {
                        "id": "surv_food_2",
                        "kannada": "ಖಾರ ಬೇಡ / ಖಾರ ಕಮ್ಮಿ ಮಾಡಿ.",
                        "pronunciation": "Khaara beda / khaara kammi maadi.",
                        "english": "No spicy / please make it mild.",
                        "tag": "Spice Control",
                        "tip": "Crucial for outsiders sensitive to Karnataka green chili spice levels."
                    },
                    {
                        "id": "surv_food_3",
                        "kannada": "ಬಿಸಿ ಕುಡಿಯುವ ನೀರು ಕೊಡಿ.",
                        "pronunciation": "Bisi kudiyuva neeru kodi.",
                        "english": "Please give hot / warm drinking water.",
                        "tag": "Safe Drinking",
                        "tip": "Darshinis readily provide hot boiled water upon request."
                    },
                    {
                        "id": "surv_food_4",
                        "kannada": "ಚಟ್ನಿ ಸ್ವಲ್ಪ ಜಾಸ್ತಿ ಹಾಕಿ ಅಣ್ಣ.",
                        "pronunciation": "Chutney swalpa jaasti haaki anna.",
                        "english": "Please put a little extra chutney, brother.",
                        "tag": "Local Privilege",
                        "tip": "Chutney is free and loved in Karnataka; polite asking always gets you an extra ladle!"
                    },
                    {
                        "id": "surv_food_5",
                        "kannada": "ಪಾರ್ಸೆಲ್ ಕಟ್ಟಿ ಅಣ್ಣ.",
                        "pronunciation": "Parcel katti anna.",
                        "english": "Please pack it for takeaway, brother.",
                        "tag": "Takeaway",
                        "tip": "Use when taking food home. There is usually a separate parcel counter."
                    }
                ]
            },
            {
                "id": "market",
                "title": "ಅಂಗಡಿ & ಖರೀದಿ (Kirana Shop & Market Survival)",
                "icon": "fa-store",
                "color": "#8b5cf6",
                "description": "Negotiate respectfully, check freshness, and buy everyday essentials at grocery stores and vegetable markets.",
                "phrases": [
                    {
                        "id": "surv_mkt_1",
                        "kannada": "ತುಂಬಾ ಜಾಸ್ತಿ ಆಯಿತು, ಸ್ವಲ್ಪ ಕಡಿಮೆ ಮಾಡಿ ಅಣ್ಣ.",
                        "pronunciation": "Thumba jaasti aayithu, swalpa kadime maadi anna.",
                        "english": "That is too high, please reduce a little brother.",
                        "tag": "Bargaining",
                        "tip": "Tone matters! Saying it smilingly with 'Anna' gets you the local discount."
                    },
                    {
                        "id": "surv_mkt_2",
                        "kannada": "ಇದು ತಾಜಾ ಇದೆಯಾ?",
                        "pronunciation": "Idu taaza ideya?",
                        "english": "Is this fresh?",
                        "tag": "Quality Check",
                        "tip": "Useful when buying vegetables, greens, or dairy products."
                    },
                    {
                        "id": "surv_mkt_3",
                        "kannada": "ಅರ್ಧ ಕೆಜಿ ಕೊಡಿ / ಒಂದು ಕೆಜಿ ಎಷ್ಟು?",
                        "pronunciation": "Ardha KG kodi / Ondu KG eshtu?",
                        "english": "Give half a kilo / How much for one kilo?",
                        "tag": "Portions",
                        "tip": "Ardha = Half (1/2), Ondu = One (1), Kaal = Quarter (1/4)."
                    },
                    {
                        "id": "surv_mkt_4",
                        "kannada": "ಕ್ಯಾರಿ ಬ್ಯಾಗ್ ಅಥವಾ ಕವರ್ ಕೊಡಿ.",
                        "pronunciation": "Carry bag athava cover kodi.",
                        "english": "Please give a bag or cover.",
                        "tag": "Packaging",
                        "tip": "In Karnataka, plastic covers are banned, so ask for cloth or paper carry bags."
                    }
                ]
            },
            {
                "id": "medical",
                "title": "ಮೆಡಿಕಲ್ & ತುರ್ತು ಆರೋಗ್ಯ (Pharmacy & Medical Lifeline)",
                "icon": "fa-kit-medical",
                "color": "#ef4444",
                "description": "Communicate medical needs at local pharmacies and find emergency healthcare without language barriers.",
                "phrases": [
                    {
                        "id": "surv_med_1",
                        "kannada": "ತಲೆನೋವು / ಜ್ವರದ ಮಾತ್ರೆ ಕೊಡಿ.",
                        "pronunciation": "Thalenoovu / jwarada maathre kodi.",
                        "english": "Give tablet for headache / fever.",
                        "tag": "Quick Medicine",
                        "tip": "Chemists in towns understand 'Paracetamol', but this gets quick attention."
                    },
                    {
                        "id": "surv_med_2",
                        "kannada": "ಹೊಟ್ಟೆನೋವು ಆಗ್ತಾ ಇದೆ.",
                        "pronunciation": "Hottanoovu aagtha ide.",
                        "english": "Having stomach ache.",
                        "tag": "Symptom",
                        "tip": "Common for newcomers adjusting to local street food or water."
                    },
                    {
                        "id": "surv_med_3",
                        "kannada": "ಹತ್ತಿರದ ಆಸ್ಪತ್ರೆ ಅಥವಾ ಕ್ಲಿನಿಕ್ ಎಲ್ಲಿದೆ?",
                        "pronunciation": "Hathirada aaspathre athava clinic ellide?",
                        "english": "Where is the nearest hospital or clinic?",
                        "tag": "Hospital Search",
                        "tip": "Helps you get immediate directions to a doctor."
                    },
                    {
                        "id": "surv_med_4",
                        "kannada": "ತುರ್ತು ಸಹಾಯ ಬೇಕು, 108 ಗೆ ಕಾಲ್ ಮಾಡಿ!",
                        "pronunciation": "Thurtu sahaaya beku, 108 ge call maadi!",
                        "english": "Emergency help needed, call 108 ambulance!",
                        "tag": "Ambulance 108",
                        "tip": "108 is the government emergency ambulance service across all Karnataka districts."
                    }
                ]
            }
        ],
        "goldenRules": [
            {
                "number": 1,
                "title": "Use 'Anna' (Brother) & 'Akka' (Sister) as Respectful Address",
                "kannada": "ಅಣ್ಣ / ಅಕ್ಕ ಎನ್ನಿ",
                "description": "Never snap fingers or call people 'Bhaiya' or 'Tu'. Addressing an auto driver, shopkeeper, or conductor as 'Anna' generates instant brotherly respect and disarms tension.",
                "icon": "fa-user-group"
            },
            {
                "number": 2,
                "title": "Master 'Aaythu' (ಆಯ್ತು) — The Universal Magic Word",
                "kannada": "ಆಯ್ತು (Aaythu)",
                "description": "In Kannada, 'Aaythu' means: 'Yes', 'Okay', 'Done', 'Agreed', 'Understood', and 'Alright'. When an auto drops you or a cashier gives your bill, saying 'Aaythu Anna' is the most natural reply.",
                "icon": "fa-circle-check"
            },
            {
                "number": 3,
                "title": "Say 'Swalpa Kannada Gothu' — 5% Effort Brings 100% Warmth",
                "kannada": "ಕನ್ನಡ ಸ್ವಲ್ಪ ಗೊತ್ತು",
                "description": "Kannadigas are remarkably hospitable. Even if you only know 2 or 3 words, expressing that you are trying to learn melts hearts and opens doors everywhere in Karnataka.",
                "icon": "fa-heart"
            },
            {
                "number": 4,
                "title": "Ask 'Meter Haaki Swamy' Before Boarding Autos",
                "kannada": "ಮೀಟರ್ ಹಾಕಿ ಸ್ವಾಮಿ",
                "description": "In Bengaluru, Mysuru, and other Karnataka towns, auto drivers are legally required to use meters. Asking politely before getting in establishes that you know town rules.",
                "icon": "fa-taxi"
            },
            {
                "number": 5,
                "title": "Keep UPI (GPay / PhonePe) Ready Everywhere",
                "kannada": "ಆನ್‌ಲೈನ್ ಪೇಮೆಂಟ್ (UPI)",
                "description": "Loose coin change ('Chillare') is chronically short in Karnataka. Almost every coconut vendor, auto, and street cart displays a PhonePe/GPay QR code.",
                "icon": "fa-qrcode"
            }
        ]
    }
    return jsonify(data)

@app.route("/api/survival/autofare", methods=["GET"])
def calculate_auto_fare():
    """
    Calculates estimated fair auto fare based on official Karnataka RTO guidelines:
    - Base fare: ₹30 for first 2.0 km
    - Subsequent rate: ₹15 per km
    - Night fare surcharge: 1.5x (from 10:00 PM to 05:00 AM)
    Returns exact fare, Kannada digits, and spoken Kannada sentence for fare defense.
    """
    try:
        km = float(request.args.get("km", 5.0))
    except (ValueError, TypeError):
        km = 5.0

    km = max(0.5, min(100.0, km))
    is_night = request.args.get("night", "false").lower() in ("true", "1", "yes")

    base_km = 2.0
    base_fare = 30.0
    rate_per_km = 15.0

    if km <= base_km:
        fare = base_fare
    else:
        fare = base_fare + ((km - base_km) * rate_per_km)

    if is_night:
        fare = fare * 1.5

    fare_int = int(round(fare))
    kannada_digits = ["೦", "೧", "೨", "೩", "೪", "೫", "೬", "೭", "೮", "೯"]
    fare_kn_digits = "".join(kannada_digits[int(d)] for d in str(fare_int))

    speech_kannada = f"{int(km)} ಕಿಲೋಮೀಟರ್‌ಗೆ ಸುಮಾರು {fare_int} ರೂಪಾಯಿ ಆಗುತ್ತೆ ಸ್ವಾಮಿ."
    speech_phonetic = f"{int(km)} kilometer ge sumaaru {fare_int} roopaayi aaguththe swamy."

    return jsonify({
        "distance_km": km,
        "is_night": is_night,
        "fare_inr": fare_int,
        "fare_kannada_digits": f"₹ {fare_kn_digits}",
        "speech_kannada": speech_kannada,
        "speech_phonetic": speech_phonetic,
        "rto_rule": "Karnataka RTO: ₹30 for first 2 km, ₹15/km thereafter. Night surcharge 1.5x (10 PM - 5 AM)."
    })

@app.route("/<path:path>")
def serve_static_assets(path):
    """Serves static files (styles.css, app.js, logo.jpg, manifest.json, etc.)."""
    return send_from_directory(".", path)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"[*] NammaBhasha Server starting on http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=False)
