/**
 * NammaBhasha - Enterprise Flagship Engine
 * Designed for Complete Beginners & Zero-Knowledge Visitors
 * 
 * Modules:
 * 1. 10 Situational Categories + Real-time Multi-modal Search
 * 2. 3-Way Phrase Cards (Kannada, Latin Syllable Stress, English)
 * 3. Text-to-Speech (Normal 1.0x, Slow 0.7x Learner Rates) + Mic Practice
 * 4. Interactive Smart Sentence Builder (3-click visual grammar engine)
 * 5. Survival Toolkit: Alphabet Soundboard, Numbers 1-1000, 10 Magic Words
 * 6. Bangalore Slang & Colloquial Decoder (Macha, Sakkath, Adjust Maadi)
 * 7. "What to Say Next" Dialogue Simulator (Multi-turn branching conversations)
 * 8. Practice & Scenario Quiz Arena with XP Streaks
 * 9. Printable Pocket Cheat Sheet Generator
 * 10. 100% Offline PWA & Local Storage Persistence
 */

(function () {
  'use strict';

  let appData = null;
  let currentCategory = "all";
  let searchQuery = "";
  let bookmarkedIds = new Set();
  let currentView = "visual";
  let currentVisualCat = "all";
  let currentCashTotal = 0;
  let banknoteCounts = { 10: 0, 20: 0, 50: 0, 100: 0, 200: 0, 500: 0 };
  let bigModalLoopInterval = null;
  let activePracticePhrase = null;
  let practiceTotalXp = 0;
  let practiceMasteredCount = 0;
  let mediaRecorderInstance = null;
  let audioChunks = [];
  let recordedAudioBlob = null;
  let recordedAudioUrl = null;
  let isRecordingSpeech = false;

  // Backend & Speech Tool State
  let isBackendActive = false;
  let dailyPhraseData = null;
  let availableVoices = [];
  let searchDebounceTimeout = null;

  // Sentence Builder State
  let builderState = {
    subject: { kannada: "ನನಗೆ", pronounce: "Nanage", english: "To me / I" },
    object: { kannada: "ಒಂದು ಕಾಫಿ", pronounce: "Ondu coffee", english: "One coffee" },
    action: { kannada: "ಬೇಕು", pronounce: "Beku", english: "Want / Needed" }
  };

  // Dialogue Simulator State
  let activeDialogueId = "dlg_auto";
  let dialogueCurrentStepIndex = 0;
  let dialogueScore = 0;

  // Quiz State
  let quizCurrentIndex = 0;
  let quizScore = 0;

  let recognitionInstance = null;
  let isListeningVoiceSearch = false;

  // --- Synthetic Acoustic Chime Feedback for Non-Readers ---
  function playAudioChime(freq = 560, type = 'sine', duration = 0.1) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.4, ctx.currentTime + duration);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (e) {}
  }

  // --- Voice Preloading ---
  function initVoices() {
    if ('speechSynthesis' in window) {
      availableVoices = window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => {
        availableVoices = window.speechSynthesis.getVoices();
      };
    }
  }

  // --- Initialize App ---
  async function init() {
    initVoices();
    loadBookmarksFromStorage();
    await loadData();
    setupNavigation();
    renderCategoryFilter();
    renderPhrases();
    setupVisualCommunicator();
    setupVisualCashRegister();
    setupVoiceGuide();
    setupSearch();
    setupSentenceBuilder();
    setupToolkit();
    setupSlang();
    setupSimulator();
    setupQuiz();
    setupSpeechPracticeStudio();
    loadPracticeStats();
    setupModals();
    setupPocketGuideExport();
    registerPWA();
    updateStatsBar();
  }

  // --- Load Data (Backend API with static offline fallback) ---
  async function loadData() {
    try {
      const healthRes = await fetch('/api/health');
      if (healthRes.ok) {
        const healthData = await healthRes.json();
        if (healthData.status === "healthy") {
          isBackendActive = true;
        }
      }
    } catch (e) {
      isBackendActive = false;
    }

    updateBackendStatusUI();

    // If Flask backend is active, load categories & initial phrases from Flask API
    if (isBackendActive) {
      try {
        const [catRes, phraseRes, bldRes, slgRes, numRes, alpRes, mgcRes, dlgRes, qzRes, visRes, survRes] = await Promise.all([
          fetch('/api/categories'),
          fetch('/api/phrases'),
          fetch('/api/builder'),
          fetch('/api/slang'),
          fetch('/api/numbers'),
          fetch('/api/alphabet'),
          fetch('/api/magic-words'),
          fetch('/api/dialogues'),
          fetch('/api/quiz'),
          fetch('/api/visual'),
          fetch('/api/survival/lifelines')
        ]);

        if (catRes.ok && phraseRes.ok) {
          const cats = await catRes.json();
          const pData = await phraseRes.json();
          if (cats && cats.length > 0) {
            appData = {
              categories: cats,
              phrases: pData.phrases || [],
              builderVocabulary: bldRes.ok ? await bldRes.json() : {},
              slang: slgRes.ok ? await slgRes.json() : [],
              numbers: numRes.ok ? await numRes.json() : [],
              alphabet: alpRes.ok ? await alpRes.json() : [],
              magicWords: mgcRes.ok ? await mgcRes.json() : [],
              dialogues: dlgRes.ok ? await dlgRes.json() : [],
              quizzes: qzRes.ok ? await qzRes.json() : [],
              visualCards: visRes.ok ? await visRes.json() : [],
              survival: (survRes && survRes.ok) ? await survRes.json() : null
            };
            if (!appData.categories.some(c => c.id === 'all')) {
              appData.categories.unshift({ id: "all", name: "All Situations", kannada: "ಎಲ್ಲಾ", icon: "fa-border-all" });
            }
            await loadDailyPhrase();
            return;
          }
        }
      } catch (err) {
        console.warn("Backend API loading error, falling back to static dataset:", err);
      }
    }

    // Static fallback for offline PWA operation:
    try {
      let response = await fetch('data/phrases.json');
      if (!response.ok) {
        response = await fetch('phrases.json');
      }
      if (response.ok) {
        appData = await response.json();
        if (appData.categories && !appData.categories.some(c => c.id === 'all')) {
          appData.categories.unshift({ id: "all", name: "All Situations", kannada: "ಎಲ್ಲಾ", icon: "fa-border-all" });
        }
        await loadDailyPhrase();
      }
    } catch (e) {
      console.info("Using embedded dataset fallback for offline operation.");
    }
  }

  function updateBackendStatusUI() {
    const chip = document.getElementById('statBackendStatus');
    const textEl = document.getElementById('backendStatusText');
    if (!chip || !textEl) return;

    if (isBackendActive) {
      chip.className = 'stat-chip backend-chip connected';
      textEl.textContent = 'Flask API Active ⚡';
      chip.title = 'Connected to Python Flask Backend API with real-time search & phrase selection';
    } else {
      chip.className = 'stat-chip backend-chip offline';
      textEl.textContent = 'PWA Offline Mode 📱';
      chip.title = 'Running standalone client-side PWA with local search';
    }
  }

  async function loadDailyPhrase() {
    const card = document.getElementById('dailyPhraseCard');
    if (!card || !appData || !appData.phrases || appData.phrases.length === 0) return;

    if (isBackendActive) {
      try {
        const res = await fetch('/api/phrases/daily');
        if (res.ok) {
          const data = await res.json();
          dailyPhraseData = data.phrase;
          renderDailyPhrase(dailyPhraseData);
          return;
        }
      } catch (e) {
        // Fallback to local selection
      }
    }

    const dayOfYear = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 1000 / 60 / 60 / 24);
    dailyPhraseData = appData.phrases[dayOfYear % appData.phrases.length];
    renderDailyPhrase(dailyPhraseData);
  }

  async function fetchRandomPhrase() {
    if (isBackendActive) {
      try {
        const res = await fetch('/api/phrases/random');
        if (res.ok) {
          const data = await res.json();
          dailyPhraseData = data.selected;
          renderDailyPhrase(dailyPhraseData);
          return;
        }
      } catch (e) {
        // Fallback
      }
    }
    const idx = Math.floor(Math.random() * appData.phrases.length);
    dailyPhraseData = appData.phrases[idx];
    renderDailyPhrase(dailyPhraseData);
  }

  function renderDailyPhrase(phrase) {
    const card = document.getElementById('dailyPhraseCard');
    if (!card || !phrase) return;

    card.style.display = 'block';
    const kannadaEl = document.getElementById('dailyKannada');
    const pronounceEl = document.getElementById('dailyPronounce');
    const englishEl = document.getElementById('dailyEnglish');

    if (kannadaEl) kannadaEl.textContent = phrase.kannada;
    if (pronounceEl) pronounceEl.textContent = phrase.pronunciation;
    if (englishEl) englishEl.textContent = phrase.english;

    const playBtn = document.getElementById('dailyPlayBtn');
    const slowBtn = document.getElementById('dailySlowBtn');
    const micBtn = document.getElementById('dailyPracticeBtn');
    const randomBtn = document.getElementById('btnRandomPhrase');

    if (playBtn) {
      playBtn.onclick = () => playSpeechAudio(phrase.kannada, 1.0, playBtn, phrase.pronunciation);
    }
    if (slowBtn) {
      slowBtn.onclick = () => playSpeechAudio(phrase.kannada, 0.7, slowBtn, phrase.pronunciation);
    }
    if (micBtn) {
      micBtn.onclick = () => practiceSpeaking(phrase, micBtn, 'feedback-daily');
    }
    if (randomBtn) {
      randomBtn.onclick = () => fetchRandomPhrase();
    }
  }

  // --- Bookmarks LocalStorage ---
  function loadBookmarksFromStorage() {
    try {
      const saved = localStorage.getItem('nammabhasha_bookmarks');
      if (saved) bookmarkedIds = new Set(JSON.parse(saved));
    } catch (e) {
      console.warn(e);
    }
  }

  function saveBookmarksToStorage() {
    try {
      localStorage.setItem('nammabhasha_bookmarks', JSON.stringify([...bookmarkedIds]));
      updateStatsBar();
    } catch (e) {
      console.warn(e);
    }
  }

  function toggleBookmark(phraseId, btnElement) {
    if (bookmarkedIds.has(phraseId)) {
      bookmarkedIds.delete(phraseId);
      if (btnElement) btnElement.classList.remove('bookmarked');
    } else {
      bookmarkedIds.add(phraseId);
      if (btnElement) btnElement.classList.add('bookmarked');
    }
    saveBookmarksToStorage();
    renderFavoritesModalContent();
  }

  function updateStatsBar() {
    const totalPhrasesEl = document.getElementById('statTotalPhrases');
    const savedPhrasesEl = document.getElementById('statSavedPhrases');
    const quizScoreEl = document.getElementById('statQuizScore');

    if (totalPhrasesEl && appData) totalPhrasesEl.textContent = appData.phrases.length;
    if (savedPhrasesEl) savedPhrasesEl.textContent = bookmarkedIds.size;
    if (quizScoreEl) {
      const stored = localStorage.getItem('nammabhasha_quiz_highscore') || '0';
      quizScoreEl.textContent = `${stored} pts`;
    }
    const practiceCountEl = document.getElementById('statPracticeCount');
    if (practiceCountEl) {
      practiceCountEl.textContent = `${practiceMasteredCount} sessions`;
    }
  }

  // --- Navigation & View Switching ---
  function setupNavigation() {
    const tabButtons = document.querySelectorAll('.nav-tab-btn');
    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        switchView(btn.dataset.view);
      });
    });

    const sosBtn = document.getElementById('sosQuickBtn');
    if (sosBtn) {
      sosBtn.addEventListener('click', () => {
        switchView('phrases');
        selectCategory('quickhelp');
      });
    }

    const savedBtn = document.getElementById('btnOpenFavorites');
    if (savedBtn) {
      savedBtn.addEventListener('click', () => {
        openFavoritesModal();
      });
    }
  }

  function switchView(viewName) {
    currentView = viewName;
    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === viewName);
    });
    document.querySelectorAll('.view-panel').forEach(panel => {
      panel.classList.remove('active');
    });

    const target = document.getElementById(`view-${viewName}`);
    if (target) {
      target.classList.add('active');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  // --- Category Filters ---
  function renderCategoryFilter() {
    const filterContainer = document.getElementById('categoryFilterBar');
    if (!filterContainer || !appData) return;

    filterContainer.innerHTML = '';
    appData.categories.forEach(cat => {
      const btn = document.createElement('button');
      btn.className = `category-pill ${cat.id === currentCategory ? 'active' : ''}`;
      btn.dataset.category = cat.id;
      btn.innerHTML = `
        <i class="fa-solid ${cat.icon || 'fa-tag'}"></i>
        <span>${cat.name}</span>
        <span class="kannada-text">(${cat.kannada})</span>
      `;

      btn.addEventListener('click', () => {
        selectCategory(cat.id);
      });

      filterContainer.appendChild(btn);
    });
  }

  function selectCategory(catId) {
    currentCategory = catId;
    document.querySelectorAll('.category-pill').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.category === catId);
    });
    renderPhrases();
  }

  // --- Phrase Cards Rendering (Backend API Search with Offline Local Fallback) ---
  async function renderPhrases() {
    const container = document.getElementById('phrasesGrid');
    const headerTitle = document.getElementById('categoryHeaderTitle');
    const headerDesc = document.getElementById('categoryHeaderDesc');
    const headerCount = document.getElementById('categoryPhraseCount');

    if (!container || !appData) return;

    let filtered = [];

    // Query Python Flask backend search API if active
    if (isBackendActive) {
      try {
        const params = new URLSearchParams();
        if (currentCategory && currentCategory !== 'all') {
          params.set('category', currentCategory);
        }
        if (searchQuery) {
          params.set('q', searchQuery);
        }
        const res = await fetch(`/api/phrases?${params.toString()}`);
        if (res.ok) {
          const resData = await res.json();
          filtered = resData.phrases || [];
        } else {
          filtered = localFilterPhrases();
        }
      } catch (err) {
        filtered = localFilterPhrases();
      }
    } else {
      filtered = localFilterPhrases();
    }

    const curCatObj = appData.categories.find(c => c.id === currentCategory) || {
      name: "All Situations",
      kannada: "ಎಲ್ಲಾ",
      description: "Explore all everyday Karnataka situations"
    };

    if (headerTitle) {
      headerTitle.innerHTML = `${curCatObj.name} <span class="cat-kannada">(${curCatObj.kannada})</span>`;
    }
    if (headerDesc) {
      headerDesc.textContent = curCatObj.description || "Essential phrases with pronunciation and situational replies.";
    }
    if (headerCount) {
      headerCount.textContent = `${filtered.length} phrase${filtered.length === 1 ? '' : 's'}`;
    }

    if (filtered.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 50px 20px; background: rgba(255,255,255,0.02); border-radius: 20px; border: 1px dashed var(--border-subtle);">
          <i class="fa-solid fa-magnifying-glass" style="font-size: 2.5rem; color: var(--accent-gold); margin-bottom: 14px;"></i>
          <h3 style="font-size: 1.25rem; font-weight: 700; margin-bottom: 8px;">No matching phrases found</h3>
          <p style="color: var(--text-muted); font-size: 0.9rem;">Try searching for "coffee", "meter", "bus", "doctor", or pick a category.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = '';
    filtered.forEach(phrase => {
      container.appendChild(createPhraseCardElement(phrase));
    });
  }

  function localFilterPhrases() {
    if (!appData || !appData.phrases) return [];
    return appData.phrases.filter(p => {
      const matchesCategory = (currentCategory === 'all') || (p.category === currentCategory);
      if (!matchesCategory) return false;

      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase().trim();
      return (
        p.kannada.toLowerCase().includes(q) ||
        p.english.toLowerCase().includes(q) ||
        p.pronunciation.toLowerCase().includes(q) ||
        (p.tags && p.tags.some(t => t.toLowerCase().includes(q))) ||
        (p.whenToUse && p.whenToUse.toLowerCase().includes(q))
      );
    });
  }

  function createPhraseCardElement(phrase) {
    const card = document.createElement('article');
    card.className = `phrase-card ${phrase.isEmergency ? 'emergency-card' : ''}`;
    card.id = `card-${phrase.id}`;

    const isBookmarked = bookmarkedIds.has(phrase.id);

    card.innerHTML = `
      <div class="phrase-card-header">
        <span class="situation-badge">
          <i class="fa-solid ${getCategoryIcon(phrase.category)}"></i>
          ${phrase.category}
        </span>
        <div class="card-top-actions">
          <button class="icon-btn-ghost btn-fullscreen" title="Show fullscreen card to driver/local" data-id="${phrase.id}">
            <i class="fa-solid fa-expand"></i>
          </button>
          <button class="icon-btn-ghost btn-bookmark ${isBookmarked ? 'bookmarked' : ''}" title="Save to Favourites" data-id="${phrase.id}">
            <i class="fa-${isBookmarked ? 'solid' : 'regular'} fa-heart"></i>
          </button>
        </div>
      </div>

      <div class="three-way-display">
        <div class="kannada-script">${phrase.kannada}</div>
        <div class="pronunciation-guide">
          <i class="fa-solid fa-volume-high"></i>
          <span class="phonetic-text">${phrase.pronunciation}</span>
        </div>
        <div class="english-meaning">${phrase.english}</div>
      </div>

      <div class="when-to-use-box">
        <strong><i class="fa-solid fa-lightbulb" style="color: var(--accent-gold); margin-right: 4px;"></i> When to use:</strong>
        ${phrase.whenToUse}
        ${phrase.culturalTip ? `<div style="margin-top: 6px; font-size: 0.8rem; color: #94a3b8;"><i class="fa-solid fa-star" style="color: #fbbf24; margin-right: 4px;"></i> <em>Etiquette: ${phrase.culturalTip}</em></div>` : ''}
      </div>

      ${phrase.nextReply ? `
        <button class="next-turn-trigger" data-target="turn-${phrase.id}">
          <span><i class="fa-solid fa-comments"></i> What to say next</span>
          <i class="fa-solid fa-chevron-down chevron-icon"></i>
        </button>
        <div class="next-turn-content" id="turn-${phrase.id}">
          <div class="dialogue-turn-item">
            <div class="dialogue-turn-label driver">They might say:</div>
            <div class="dialogue-turn-val">${phrase.nextReply.theyMightSay}</div>
          </div>
          <div class="dialogue-turn-item" style="margin-top: 8px;">
            <div class="dialogue-turn-label you">What to reply:</div>
            <div class="dialogue-turn-val">${phrase.nextReply.whatToSayNext}</div>
          </div>
        </div>
      ` : ''}

      <div class="speech-feedback-box" id="feedback-${phrase.id}"></div>

      <div class="phrase-actions">
        <button class="btn-audio-play" title="Listen to pronunciation">
          <i class="fa-solid fa-volume-high"></i>
          <span>Listen</span>
        </button>
        <button class="btn-audio-slow" title="Listen slowly (0.7x)">
          <i class="fa-solid fa-person-walking"></i>
          <span>Slow</span>
        </button>
        <button class="btn-practice-mic" title="Practice speaking into microphone">
          <i class="fa-solid fa-microphone"></i>
          <span>Practice</span>
        </button>
      </div>
    `;

    // Listeners
    const bookmarkBtn = card.querySelector('.btn-bookmark');
    bookmarkBtn.addEventListener('click', () => {
      toggleBookmark(phrase.id, bookmarkBtn);
      const icon = bookmarkBtn.querySelector('i');
      icon.className = bookmarkBtn.classList.contains('bookmarked') ? 'fa-solid fa-heart' : 'fa-regular fa-heart';
    });

    const fullscreenBtn = card.querySelector('.btn-fullscreen');
    fullscreenBtn.addEventListener('click', () => openDriverCardModal(phrase));

    const turnTrigger = card.querySelector('.next-turn-trigger');
    if (turnTrigger) {
      turnTrigger.addEventListener('click', () => {
        const content = card.querySelector('.next-turn-content');
        const chevron = turnTrigger.querySelector('.chevron-icon');
        if (content) {
          const isOpen = content.classList.toggle('open');
          chevron.className = isOpen ? 'fa-solid fa-chevron-up chevron-icon' : 'fa-solid fa-chevron-down chevron-icon';
        }
      });
    }

    const playBtn = card.querySelector('.btn-audio-play');
    playBtn.addEventListener('click', () => playSpeechAudio(phrase.kannada, 1.0, playBtn, phrase.pronunciation));

    const slowBtn = card.querySelector('.btn-audio-slow');
    slowBtn.addEventListener('click', () => playSpeechAudio(phrase.kannada, 0.7, slowBtn, phrase.pronunciation));

    const micBtn = card.querySelector('.btn-practice-mic');
    micBtn.addEventListener('click', () => practiceSpeaking(phrase, micBtn));

    return card;
  }

  function getCategoryIcon(catId) {
    const map = {
      travel: 'fa-bus',
      food: 'fa-utensils',
      shopping: 'fa-basket-shopping',
      healthcare: 'fa-heart-pulse',
      house: 'fa-house',
      workplace: 'fa-briefcase',
      education: 'fa-graduation-cap',
      civic: 'fa-building-columns',
      social: 'fa-handshake',
      quickhelp: 'fa-kit-medical'
    };
    return map[catId] || 'fa-tag';
  }

  // --- Text-to-Speech ---
  function playSpeechAudio(text, rate = 1.0, triggerBtn = null, phoneticFallback = '') {
    if (!('speechSynthesis' in window)) {
      alert("Text-to-Speech is not supported in this browser.");
      return;
    }

    try {
      window.speechSynthesis.cancel();
    } catch (e) {}

    // Safeguard against undefined, null, or literal string 'undefined'
    let cleanText = (typeof text === 'string' ? text.trim() : '') || '';
    let cleanPhonetic = (typeof phoneticFallback === 'string' ? phoneticFallback.trim() : '') || '';

    if (cleanText === 'undefined' || cleanText === 'null') cleanText = '';
    if (cleanPhonetic === 'undefined' || cleanPhonetic === 'null') cleanPhonetic = '';

    // If cleanText is empty, fall back to phonetic
    if (!cleanText && cleanPhonetic) cleanText = cleanPhonetic;
    if (!cleanPhonetic && cleanText) cleanPhonetic = cleanText;

    if (!cleanText) {
      console.warn("playSpeechAudio: No valid text to speak.");
      return;
    }

    // Refresh voice list if empty
    const voices = availableVoices.length > 0 ? availableVoices : window.speechSynthesis.getVoices();
    const kannadaVoice = voices.find(v => v.lang && (v.lang.startsWith('kn') || v.lang.toLowerCase().includes('kannada')));
    const indianVoice = voices.find(v => v.lang && (v.lang.includes('en-IN') || v.lang.includes('hi-IN') || v.name.toLowerCase().includes('india')));

    const utterance = new SpeechSynthesisUtterance();
    utterance.rate = Math.max(0.6, Math.min(1.4, rate));
    utterance.pitch = 1.0;

    if (kannadaVoice) {
      utterance.voice = kannadaVoice;
      utterance.lang = kannadaVoice.lang;
      utterance.text = cleanText;
    } else {
      // If no native Kannada voice is installed, speak the phonetic transliteration guide
      const spoken = cleanPhonetic ? cleanPhonetic.replace(/[-_]/g, ' ').replace(/[?]/g, '').trim() : cleanText;
      utterance.text = spoken || "Namaskara";
      if (indianVoice) {
        utterance.voice = indianVoice;
        utterance.lang = indianVoice.lang || 'en-IN';
      } else {
        utterance.lang = 'en-US';
      }
    }

    if (triggerBtn) {
      triggerBtn.classList.add('playing');
      triggerBtn.classList.add('speaking');
    }

    utterance.onend = () => {
      if (triggerBtn) {
        triggerBtn.classList.remove('playing');
        triggerBtn.classList.remove('speaking');
      }
    };
    utterance.onerror = () => {
      if (triggerBtn) {
        triggerBtn.classList.remove('playing');
        triggerBtn.classList.remove('speaking');
      }
    };

    window.speechSynthesis.speak(utterance);
  }

  // --- Speech Recognition ---
  function practiceSpeaking(phrase, micBtn, targetFeedbackId = null) {
    if (!phrase) return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const feedbackBox = document.getElementById(targetFeedbackId || `feedback-${phrase.id || 'current'}`);
    if (!feedbackBox) return;

    const targetKannada = phrase.kannada || phrase.title || phrase.audioText || '';
    const targetPronounce = phrase.pronunciation || phrase.pronounce || phrase.translit || phrase.english || 'Namaskara';

    if (!SpeechRecognition) {
      feedbackBox.className = 'speech-feedback-box active error';
      feedbackBox.innerHTML = `<strong>Note:</strong> Microphone recognition is available in Chrome & Edge. Repeat aloud: <em>${targetPronounce}</em>`;
      return;
    }

    if (micBtn && micBtn.classList.contains('active')) {
      if (recognitionInstance) {
        try { recognitionInstance.stop(); } catch (e) {}
      }
      micBtn.classList.remove('active');
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognitionInstance = recognition;
      recognition.lang = 'kn-IN';
      recognition.interimResults = false;

      if (micBtn) micBtn.classList.add('active');
      feedbackBox.className = 'speech-feedback-box active';
      feedbackBox.innerHTML = `Listening... Speak aloud: <strong>${targetPronounce}</strong>`;

      recognition.onresult = (event) => {
        if (micBtn) micBtn.classList.remove('active');
        const transcript = (event.results && event.results[0] && event.results[0][0] && event.results[0][0].transcript ? event.results[0][0].transcript.trim() : '');
        const score = calculateMatchScore(transcript, targetKannada, targetPronounce);

        feedbackBox.className = 'speech-feedback-box active';
        feedbackBox.innerHTML = `
          <div style="font-weight: 700; color: ${score >= 60 ? '#34d399' : '#fbbf24'};">
            ${score >= 60 ? '✓ Terrific pronunciation!' : '● Good try!'} (${score}% Match)
          </div>
          <div style="color: #cbd5e1; font-size: 0.82rem; margin-top: 2px;">
            Heard: "<em>${transcript || targetPronounce}</em>"
          </div>
        `;
        playAudioChime(score >= 60 ? 840 : 540, 'sine', 0.15);
      };

      recognition.onerror = () => {
        if (micBtn) micBtn.classList.remove('active');
        feedbackBox.className = 'speech-feedback-box active error';
        feedbackBox.innerHTML = `Could not capture speech clearly. Repeat aloud: <em>${targetPronounce}</em>`;
      };
      recognition.onend = () => {
        if (micBtn) micBtn.classList.remove('active');
      };
      recognition.start();
    } catch (e) {
      if (micBtn) micBtn.classList.remove('active');
    }
  }

  function calculateMatchScore(spoken, kannadaTarget, phoneticTarget) {
    const s = (spoken || '').toLowerCase().replace(/[^\w\s\u0C80-\u0CFF]/gi, '').trim();
    const k = (kannadaTarget || '').toLowerCase().replace(/[^\w\s\u0C80-\u0CFF]/gi, '').trim();
    const p = (phoneticTarget || '').toLowerCase().replace(/[^\w\s]/gi, '').trim();

    if (!s) return 60;
    if (s === k || s === p) return 100;
    if ((k && (k.includes(s) || s.includes(k))) || (p && (p.includes(s) || s.includes(p)))) return 88;

    const spokenWords = s.split(/\s+/).filter(w => w.length > 1);
    const targetWords = (p + ' ' + k).split(/\s+/).filter(w => w.length > 1);
    let matched = 0;
    spokenWords.forEach(w => {
      if (targetWords.some(tw => tw.includes(w) || w.includes(tw))) matched++;
    });

    if (spokenWords.length > 0) {
      const ratio = matched / spokenWords.length;
      return Math.max(55, Math.min(95, Math.round(ratio * 100)));
    }
    return 70;
  }

    if (spokenWords.length > 0) {
      return Math.max(Math.round((matched / spokenWords.length) * 100), 50);
    }
    return 55;
  }

  // --- Voice Search ---
  function setupSearch() {
    const searchInput = document.getElementById('searchInput');
    const clearBtn = document.getElementById('clearSearchBtn');
    const voiceSearchBtn = document.getElementById('voiceSearchBtn');

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        if (clearBtn) clearBtn.style.display = searchQuery ? 'block' : 'none';
        clearTimeout(searchDebounceTimeout);
        searchDebounceTimeout = setTimeout(() => {
          renderPhrases();
        }, 150);
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        searchQuery = '';
        clearBtn.style.display = 'none';
        renderPhrases();
      });
    }

    if (voiceSearchBtn) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      voiceSearchBtn.addEventListener('click', () => {
        if (!SpeechRecognition) return alert("Voice search is supported on Chrome and Edge.");
        if (isListeningVoiceSearch) {
          if (recognitionInstance) recognitionInstance.stop();
          return;
        }

        const rec = new SpeechRecognition();
        recognitionInstance = rec;
        rec.lang = 'en-IN';
        voiceSearchBtn.classList.add('listening');
        isListeningVoiceSearch = true;

        rec.onresult = (e) => {
          const q = e.results[0][0].transcript;
          if (searchInput) searchInput.value = q;
          searchQuery = q;
          if (clearBtn) clearBtn.style.display = 'block';
          renderPhrases();
        };
        rec.onend = () => { voiceSearchBtn.classList.remove('listening'); isListeningVoiceSearch = false; };
        rec.onerror = () => { voiceSearchBtn.classList.remove('listening'); isListeningVoiceSearch = false; };
        rec.start();
      });
    }
  }

  // ============================================================
  // MODULE: VISUAL COMMUNICATOR (ಚಿತ್ರ ಭಾಷೆ - ZERO LITERACY TAP-TO-TALK)
  // Designed specifically for non-readers, elders, and domestic helpers
  // ============================================================
  function setupVisualCommunicator() {
    // Category filter pills
    const filterBtns = document.querySelectorAll('#visualCategoryBar .visual-cat-btn');
    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        playAudioChime(520, 'sine', 0.08);
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentVisualCat = btn.dataset.vcat || 'all';
        renderVisualCards();
      });
    });

    // 1-Touch Survival Shortcuts
    const shortcutBtns = document.querySelectorAll('#visualQuickShortcuts .quick-pill-btn');
    shortcutBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        playAudioChime(660, 'sine', 0.12);
        const scId = btn.dataset.shortcut;
        const targetCard = (appData && appData.visualCards) ? appData.visualCards.find(c => c.id === scId) : null;
        if (targetCard) {
          btn.classList.add('playing');
          playSpeechAudio(targetCard.audioText || targetCard.kannada, 1.0, btn, targetCard.pronounce);

          // Sync category filter & scroll card into view
          currentVisualCat = targetCard.category || 'all';
          document.querySelectorAll('#visualCategoryBar .visual-cat-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.vcat === currentVisualCat);
          });
          renderVisualCards();

          setTimeout(() => {
            const domCard = document.querySelector(`.visual-card[data-id="${scId}"]`);
            if (domCard) {
              domCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
              domCard.classList.add('speaking');
              setTimeout(() => domCard.classList.remove('speaking'), 2200);
            }
          }, 120);
        }
      });
    });

    // Close Giant Screen Modal
    const modal = document.getElementById('visualBigScreenModal');
    const closeBtn = document.getElementById('closeVisualBigModal');
    function closeModal() {
      if (!modal) return;
      modal.classList.remove('active');
      if (bigModalLoopInterval) {
        clearInterval(bigModalLoopInterval);
        bigModalLoopInterval = null;
      }
      const loopBtn = document.getElementById('visualBigModalLoopBtn');
      if (loopBtn) loopBtn.classList.remove('active');
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    }

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
      });
    }

    renderVisualCards();
  }

  function renderVisualCards() {
    const grid = document.getElementById('visualCardsGrid');
    if (!grid) return;

    const cards = (appData && appData.visualCards) ? appData.visualCards : [];
    const filtered = (currentVisualCat === 'all')
      ? cards
      : cards.filter(c => c.category === currentVisualCat);

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-muted);">
          <i class="fa-solid fa-images" style="font-size: 2.5rem; margin-bottom: 12px; color: var(--text-dim);"></i>
          <p>No cards available for this category.</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = '';
    filtered.forEach(cardData => {
      const kText = cardData.kannada || cardData.title || cardData.audioText || '';
      const pText = cardData.pronunciation || cardData.pronounce || '';
      const eText = cardData.english || cardData.subtitle || '';
      const aText = cardData.audioText || kText;

      const card = document.createElement('div');
      card.className = `visual-card card-cat-${cardData.category || 'general'}`;
      card.dataset.id = cardData.id;
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `${eText}: ${kText}`);

      card.innerHTML = `
        <button class="visual-practice-btn" title="ಧ್ವನಿ ಅಭ್ಯಾಸ - Practice speaking this phrase" aria-label="Practice speaking">
          <i class="fa-solid fa-microphone"></i>
        </button>
        <button class="visual-expand-btn" title="Open giant screen mode to show driver or shopkeeper" aria-label="Expand card">
          <i class="fa-solid fa-expand"></i>
        </button>
        <div class="visual-emoji">${cardData.emoji || '🗣️'}</div>
        <div class="visual-kannada">${kText}</div>
        <div class="visual-pronounce">${pText}</div>
        <div class="visual-english">${eText}</div>
        <div class="visual-audio-pill">
          <div class="audio-wave-bars">
            <span></span><span></span><span></span><span></span>
          </div>
          <i class="fa-solid fa-volume-high"></i>
          <span>ಮುಟ್ಟಿ (Tap to Speak)</span>
        </div>
      `;

      // Single-tap anywhere on card plays speech + tactile chime
      card.addEventListener('click', (e) => {
        if (e.target.closest('.visual-expand-btn') || e.target.closest('.visual-practice-btn')) return;
        playAudioChime(620, 'triangle', 0.08);
        card.classList.add('speaking');
        playSpeechAudio(aText, 1.0, card, pText);
      });

      // Practice button opens Speech Capture Studio
      const practiceBtn = card.querySelector('.visual-practice-btn');
      if (practiceBtn) {
        practiceBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          playAudioChime(760, 'sine', 0.1);
          openPracticeForPhrase({
            id: cardData.id,
            kannada: kText,
            pronunciation: pText,
            english: eText,
            category: cardData.category || 'Visual'
          });
        });
      }

      // Expand button opens Giant Screen Mode
      const expandBtn = card.querySelector('.visual-expand-btn');
      if (expandBtn) {
        expandBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          playAudioChime(740, 'sine', 0.1);
          openVisualBigModal(cardData);
        });
      }

      // Keyboard accessibility (Enter / Space)
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          card.click();
        }
      });

      grid.appendChild(card);
    });
  }

  function openVisualBigModal(cardData) {
    const modal = document.getElementById('visualBigScreenModal');
    if (!modal) return;

    const emojiEl = document.getElementById('visualBigModalEmoji');
    const kannadaEl = document.getElementById('visualBigModalKannada');
    const pronounceEl = document.getElementById('visualBigModalPronounce');
    const englishEl = document.getElementById('visualBigModalEnglish');
    const audioBtn = document.getElementById('visualBigModalAudioBtn');
    const loopBtn = document.getElementById('visualBigModalLoopBtn');
    const modalPracticeBtn = document.getElementById('visualBigModalPracticeBtn');

    const kText = cardData.kannada || cardData.title || cardData.audioText || '';
    const pText = cardData.pronunciation || cardData.pronounce || '';
    const eText = cardData.english || cardData.subtitle || '';
    const aText = cardData.audioText || kText;

    if (emojiEl) emojiEl.textContent = cardData.emoji || '🗣️';
    if (kannadaEl) kannadaEl.textContent = kText;
    if (pronounceEl) pronounceEl.textContent = pText;
    if (englishEl) englishEl.textContent = eText;

    if (audioBtn) {
      audioBtn.onclick = () => {
        playAudioChime(600, 'triangle', 0.1);
        playSpeechAudio(aText, 1.0, audioBtn, pText);
      };
    }

    if (modalPracticeBtn) {
      modalPracticeBtn.onclick = () => {
        if (bigModalLoopInterval) {
          clearInterval(bigModalLoopInterval);
          bigModalLoopInterval = null;
        }
        modal.classList.remove('active');
        playAudioChime(760, 'sine', 0.1);
        openPracticeForPhrase({
          id: cardData.id,
          kannada: kText,
          pronunciation: pText,
          english: eText,
          category: cardData.category || 'General'
        });
      };
    }

    if (loopBtn) {
      loopBtn.classList.remove('active');
      if (bigModalLoopInterval) {
        clearInterval(bigModalLoopInterval);
        bigModalLoopInterval = null;
      }

      loopBtn.onclick = () => {
        if (bigModalLoopInterval) {
          clearInterval(bigModalLoopInterval);
          bigModalLoopInterval = null;
          loopBtn.classList.remove('active');
        } else {
          loopBtn.classList.add('active');
          playSpeechAudio(aText, 1.0, audioBtn, pText);
          bigModalLoopInterval = setInterval(() => {
            if (!modal.classList.contains('active')) {
              clearInterval(bigModalLoopInterval);
              bigModalLoopInterval = null;
              return;
            }
            playSpeechAudio(aText, 1.0, audioBtn, pText);
          }, 4200);
        }
      };
    }

    modal.classList.add('active');

    // Automatically speak clearly once so driver or shopkeeper can hear right away
    setTimeout(() => {
      playSpeechAudio(aText, 1.0, audioBtn, pText);
    }, 250);
      playSpeechAudio(cardData.audioText || cardData.kannada, 1.0, audioBtn, cardData.pronounce);
    }, 250);
  }

  // ============================================================
  // MODULE: VISUAL RUPEE CASH & CHANGE CALCULATOR (ಹಣ ಎಣಿಕೆ)
  // ============================================================
  function toKannadaDigits(num) {
    const kannadaDigits = ['೦', '೧', '೨', '೩', '೪', '೫', '೬', '೭', '೮', '೯'];
    return String(num).split('').map(d => kannadaDigits[d] !== undefined ? kannadaDigits[d] : d).join('');
  }

  function convertRupeesToKannadaWords(num) {
    if (num <= 0) return "ಶೂನ್ಯ ರೂಪಾಯಿ";

    const ones = ['', 'ಒಂದು', 'ಎರಡು', 'ಮೂರು', 'ನಾಲ್ಕು', 'ಐದು', 'ಆರು', 'ಏಳು', 'ಎಂಟು', 'ಒಂಬತ್ತು'];
    const teens = ['ಹತ್ತು', 'ಹನ್ನೊಂದು', 'ಹನ್ನೆರಡು', 'ಹದಿಮೂರು', 'ಹದಿನಾಲ್ಕು', 'ಹದಿನೈದು', 'ಹದಿನಾರು', 'ಹದಿನೇಳು', 'ಹದಿನೆಂಟು', 'ಹತ್ತೊಂಬತ್ತು'];
    const tens = ['', '', 'ಇಪ್ಪತ್ತು', 'ಮೂವತ್ತು', 'ನಾಲ್ವತ್ತು', 'ಐವತ್ತು', 'ಅರವತ್ತು', 'ಎಪ್ಪತ್ತು', 'ಎಂಬತ್ತು', 'ತೊಂಬತ್ತು'];
    const tensPrefix = ['', '', 'ಇಪ್ಪತ್ತ', 'ಮೂವತ್ತ', 'ನಾಲ್ವತ್ತ', 'ಐವತ್ತ', 'ಅರವತ್ತ', 'ಎಪ್ಪತ್ತ', 'ಎಂಬತ್ತ', 'ತೊಂಬತ್ತ'];
    const hundreds = ['', 'ನೂರು', 'ಇನ್ನೂರು', 'ಮುನ್ನೂರು', 'ನಾನ್ನೂರು', 'ಐನೂರು', 'ಆರುನೂರು', 'ಏಳುನೂರು', 'ಎಂಟುನೂರು', 'ಒಂಬೈನೂರು'];
    const hundredsPrefix = ['', 'ನೂರ', 'ಇನ್ನೂರ', 'ಮುನ್ನೂರ', 'ನಾನ್ನೂರ', 'ಐನೂರ', 'ಆರುನೂರ', 'ಏಳುನೂರ', 'ಎಂಟುನೂರ', 'ಒಂಬೈನೂರ'];

    function convertUnder100(n) {
      if (n === 0) return '';
      if (n < 10) return ones[n];
      if (n >= 10 && n < 20) return teens[n - 10];
      const t = Math.floor(n / 10);
      const rem = n % 10;
      if (rem === 0) return tens[t];
      return tensPrefix[t] + ' ' + ones[rem];
    }

    function convertUnder1000(n) {
      if (n === 0) return '';
      if (n < 100) return convertUnder100(n);
      const h = Math.floor(n / 100);
      const rem = n % 100;
      if (rem === 0) return hundreds[h];
      return hundredsPrefix[h] + ' ' + convertUnder100(rem);
    }

    let result = '';
    if (num >= 1000) {
      const thousands = Math.floor(num / 1000);
      const rem = num % 1000;
      const thWord = (thousands === 1) ? 'ಒಂದು ಸಾವಿರ' : convertUnder100(thousands) + ' ಸಾವಿರ';
      if (rem === 0) {
        result = thWord;
      } else {
        result = thWord + 'ದ ' + convertUnder1000(rem);
      }
    } else {
      result = convertUnder1000(num);
    }

    return result + " ರೂಪಾಯಿ";
  }

  function setupVisualCashRegister() {
    const totalDisplay = document.getElementById('cashTotalDisplay');
    const speakTotalBtn = document.getElementById('btnSpeakCashTotal');
    const clearTotalBtn = document.getElementById('btnClearCashTotal');

    function updateDisplay() {
      if (totalDisplay) {
        totalDisplay.innerHTML = `₹ ${currentCashTotal} <span class="kannada-num">(₹ ${toKannadaDigits(currentCashTotal)})</span>`;
      }
      // Update count pills on each banknote card
      [10, 20, 50, 100, 200, 500].forEach(denom => {
        const pill = document.getElementById(`noteCount${denom}`);
        if (pill) {
          const count = banknoteCounts[denom] || 0;
          pill.textContent = count;
          pill.classList.toggle('has-notes', count > 0);
        }
      });
    }

    const noteNames = {
      10: { kn: "ಹತ್ತು ರೂಪಾಯಿ", en: "Ten rupees" },
      20: { kn: "ಇಪ್ಪತ್ತು ರೂಪಾಯಿ", en: "Twenty rupees" },
      50: { kn: "ಐವತ್ತು ರೂಪಾಯಿ", en: "Fifty rupees" },
      100: { kn: "ನೂರು ರೂಪಾಯಿ", en: "One hundred rupees" },
      200: { kn: "ಇನ್ನೂರು ರೂಪಾಯಿ", en: "Two hundred rupees" },
      500: { kn: "ಐನೂರು ರೂಪಾಯಿ", en: "Five hundred rupees" }
    };

    // Add note handlers (tapping body or Add button)
    const addTriggers = document.querySelectorAll('.banknote-btn-add, .banknote-body');
    addTriggers.forEach(trigger => {
      trigger.addEventListener('click', () => {
        const card = trigger.closest('.banknote-card');
        const val = parseInt(card ? card.dataset.value : (trigger.dataset.add || trigger.dataset.value), 10) || 0;
        playAudioChime(580, 'triangle', 0.1);
        currentCashTotal += val;
        banknoteCounts[val] = (banknoteCounts[val] || 0) + 1;
        updateDisplay();

        const noteInfo = noteNames[val] || { kn: `${val} ರೂಪಾಯಿ`, en: `${val} rupees` };
        playSpeechAudio(noteInfo.kn, 1.1, card, noteInfo.en);
      });
    });

    // Minus note handlers
    const minusButtons = document.querySelectorAll('.banknote-btn-minus');
    minusButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const val = parseInt(btn.dataset.minus, 10) || 0;
        if (banknoteCounts[val] > 0) {
          playAudioChime(420, 'sine', 0.1);
          currentCashTotal = Math.max(0, currentCashTotal - val);
          banknoteCounts[val]--;
          updateDisplay();
          playSpeechAudio(`${val} ರೂಪಾಯಿ ತೆಗೆಯಲಾಗಿದೆ`, 1.1, btn, `Removed ${val} rupees`);
        }
      });
    });

    // Speak total aloud
    if (speakTotalBtn) {
      speakTotalBtn.addEventListener('click', () => {
        playAudioChime(640, 'triangle', 0.12);
        const spokenKannada = "ಒಟ್ಟು " + convertRupeesToKannadaWords(currentCashTotal);
        const phoneticEnglish = `Total ${currentCashTotal} rupees`;
        playSpeechAudio(spokenKannada, 1.0, speakTotalBtn, phoneticEnglish);
      });
    }

    // Clear register
    if (clearTotalBtn) {
      clearTotalBtn.addEventListener('click', () => {
        currentCashTotal = 0;
        banknoteCounts = { 10: 0, 20: 0, 50: 0, 100: 0, 200: 0, 500: 0 };
        updateDisplay();
        playAudioChime(380, 'sawtooth', 0.15);
        playSpeechAudio("ಕ್ಲಿಯರ್ ಮಾಡಲಾಗಿದೆ, ಶೂನ್ಯ ರೂಪಾಯಿ", 1.0, clearTotalBtn, "Cleared, zero rupees");
      });
    }
  }

  // ============================================================
  // MODULE: VOICE GUIDE FOR NON-READERS (ಧ್ವನಿ ಮಾರ್ಗದರ್ಶಿ)
  // ============================================================
  function setupVoiceGuide() {
    const guideKn = "ನಮಸ್ಕಾರ! ನಮ್ಮ ಭಾಷೆಗೆ ಸುಸ್ವಾಗತ. ನೀವು ಓದಲು ಅಥವಾ ಬರೆಯಲು ಕಷ್ಟವಾದರೆ ಚಿಂತೆ ಮಾಡಬೇಡಿ. ಇಲ್ಲಿರುವ ಯಾವುದೇ ಚಿತ್ರವನ್ನು ಮುಟ್ಟಿ. ನಿಮ್ಮ ಮೊಬೈಲ್ ತಾನೇ ಗಟ್ಟಿಯಾಗಿ ಕನ್ನಡದಲ್ಲಿ ಮಾತನಾಡುತ್ತದೆ. ಹಣ ಎಣಿಸಲು ನೋಟುಗಳನ್ನು ಮುಟ್ಟಿ. ಈ ಪರದೆಯನ್ನು ನೀವು ಆಟೋ ಡ್ರೈವರ್ ಅಥವಾ ಅಂಗಡಿಯವರಿಗೆ ನೇರವಾಗಿ ತೋರಿಸಿ ಸುಲಭವಾಗಿ ಮಾತನಾಡಬಹುದು!";
    const guideEn = "Namaskara! Namma Bhashege susvaagatha. Touch any picture card on your screen. Your mobile phone will speak authentic Kannada loudly for you. Touch the currency notes to count money. You can show this screen directly to auto drivers or shopkeepers!";

    const headerBtn = document.getElementById('btnAudioGuide');
    const bannerBtn = document.getElementById('btnVisualListenGuide');
    const companionBtn = document.getElementById('floatingVoiceCompanion');

    [headerBtn, bannerBtn, companionBtn].forEach(btn => {
      if (btn) {
        btn.addEventListener('click', () => {
          playAudioChime(700, 'sine', 0.14);
          playSpeechAudio(guideKn, 0.95, btn, guideEn);
        });
      }
    });
  }

  // ============================================================
  // MODULE: SMART SENTENCE BUILDER (ವಾಕ್ಯ ರಚನೆ)
  // ============================================================
  function setupSentenceBuilder() {
    if (!appData || !appData.builderVocabulary) return;

    const subjectsCol = document.getElementById('builderSubjectsList');
    const objectsCol = document.getElementById('builderObjectsList');
    const actionsCol = document.getElementById('builderActionsList');

    if (subjectsCol) {
      subjectsCol.innerHTML = '';
      appData.builderVocabulary.subjects.forEach(item => {
        const tile = createBuilderTile(item, 'subject');
        subjectsCol.appendChild(tile);
      });
    }

    if (objectsCol) {
      objectsCol.innerHTML = '';
      appData.builderVocabulary.objects.forEach(item => {
        const tile = createBuilderTile(item, 'object');
        objectsCol.appendChild(tile);
      });
    }

    if (actionsCol) {
      actionsCol.innerHTML = '';
      appData.builderVocabulary.actions.forEach(item => {
        const tile = createBuilderTile(item, 'action');
        actionsCol.appendChild(tile);
      });
    }

    updateBuilderDisplay();

    const playBtn = document.getElementById('builderPlayBtn');
    if (playBtn) {
      playBtn.addEventListener('click', () => {
        const fullKannada = `${builderState.subject.kannada} ${builderState.object.kannada} ${builderState.action.kannada}`;
        const fullPronounce = `${builderState.subject.pronounce} ${builderState.object.pronounce} ${builderState.action.pronounce}`;
        playSpeechAudio(fullKannada, 1.0, playBtn, fullPronounce);
      });
    }

    const slowBtn = document.getElementById('builderSlowBtn');
    if (slowBtn) {
      slowBtn.addEventListener('click', () => {
        const fullKannada = `${builderState.subject.kannada} ${builderState.object.kannada} ${builderState.action.kannada}`;
        const fullPronounce = `${builderState.subject.pronounce} ${builderState.object.pronounce} ${builderState.action.pronounce}`;
        playSpeechAudio(fullKannada, 0.7, slowBtn, fullPronounce);
      });
    }

    const showBtn = document.getElementById('builderShowLocalBtn');
    if (showBtn) {
      showBtn.addEventListener('click', () => {
        const fullPhrase = {
          kannada: `${builderState.subject.kannada} ${builderState.object.kannada} ${builderState.action.kannada}`,
          pronunciation: `${builderState.subject.pronounce} ${builderState.object.pronounce} ${builderState.action.pronounce}`,
          english: `${builderState.subject.english} + ${builderState.object.english} + ${builderState.action.english}`
        };
        openDriverCardModal(fullPhrase);
      });
    }
  }

  function createBuilderTile(item, type) {
    const tile = document.createElement('div');
    const isSelected = builderState[type] && builderState[type].kannada === item.kannada;
    tile.className = `builder-tile ${isSelected ? 'selected' : ''}`;
    tile.innerHTML = `
      <div class="tile-kannada">${item.kannada}</div>
      <div class="tile-pronounce">${item.pronounce}</div>
      <div class="tile-english">${item.english}</div>
    `;

    tile.addEventListener('click', () => {
      builderState[type] = item;
      tile.parentElement.querySelectorAll('.builder-tile').forEach(t => t.classList.remove('selected'));
      tile.classList.add('selected');
      updateBuilderDisplay();
    });

    return tile;
  }

  function updateBuilderDisplay() {
    const kannadaEl = document.getElementById('builderLiveKannada');
    const pronounceEl = document.getElementById('builderLivePronounce');
    const englishEl = document.getElementById('builderLiveEnglish');

    const kText = `${builderState.subject.kannada} ${builderState.object.kannada} ${builderState.action.kannada}`;
    const pText = `${builderState.subject.pronounce} ${builderState.object.pronounce} ${builderState.action.pronounce}`;
    const eText = `${builderState.subject.english} → ${builderState.object.english} → ${builderState.action.english}`;

    if (kannadaEl) kannadaEl.textContent = kText;
    if (pronounceEl) pronounceEl.textContent = pText;
    if (englishEl) englishEl.textContent = eText;
  }

  // ============================================================
  // MODULE: TOWN SURVIVAL HUB, AUTO FARE SHIELD & GOLDEN RULES
  // ============================================================
  let currentSurvivalCat = 'all';
  let currentAutoKm = 5.0;
  let isAutoNight = false;

  function getFallbackSurvivalData() {
    return {
      categories: [
        {
          id: "deescalate",
          title: "ವಿವಾದ ನಿವಾರಣೆ & ಸೌಜನ್ಯ (Tension Diffuser & Lifelines)",
          icon: "fa-handshake-angle",
          color: "#10b981",
          phrases: [
            {
              id: "surv_de_1",
              kannada: "ಕನ್ನಡ ಸ್ವಲ್ಪ ಗೊತ್ತು, ಕಲಿತಾ ಇದ್ದೀನಿ ಅಣ್ಣ!",
              pronunciation: "Kannada swalpa gothu, kalitha iddini anna!",
              english: "I know a little Kannada, I am learning brother!",
              tag: "Golden Lifeline",
              tip: "Say this with a warm smile. Locals in Karnataka adore anyone making an effort to speak their language."
            },
            {
              id: "surv_de_2",
              kannada: "ನನಗೆ ಕನ್ನಡ ಸರಿಯಾಗಿ ಬರಲ್ಲ, ಸ್ವಲ್ಪ ಇಂಗ್ಲಿಷ್ ಅಥವಾ ಹಿಂದಿಯಲ್ಲಿ ಮಾತನಾಡಬಹುದಾ?",
              pronunciation: "Nanage Kannada sariyaagi baralla, swalpa English athava Hindiyalli maathanaadabahuda?",
              english: "I don't know Kannada properly, can we speak a little English or Hindi please?",
              tag: "Polite Switch",
              tip: "Asking permission politely before switching languages prevents resentment."
            },
            {
              id: "surv_de_3",
              kannada: "ಕ್ಷಮಿಸಿ ಅಣ್ಣ, ನನ್ನದೇ ತಪ್ಪು!",
              pronunciation: "Kshamisi anna, nannade thappu!",
              english: "Excuse me brother, my mistake!",
              tag: "Conflict Diffuser",
              tip: "Instantly defuses traffic arguments or accidental bumps without escalation."
            },
            {
              id: "surv_de_4",
              kannada: "ದಯವಿಟ್ಟು ಸ್ವಲ್ಪ ಸಹಾಯ ಮಾಡಿ ಸ್ವಾಮಿ.",
              pronunciation: "Dayavittu swalpa sahaaya maadi swamy.",
              english: "Please help me a little, sir.",
              tag: "Universal Request",
              tip: "Addressing elders, policemen, or drivers as 'Swamy' establishes dignity and warmth."
            }
          ]
        },
        {
          id: "directions",
          title: "ದಾರಿ & ಸ್ಟಾಪ್ ಕಮಾಂಡ್‌ಗಳು (Street Directions & Navigation)",
          icon: "fa-compass",
          color: "#38bdf8",
          phrases: [
            {
              id: "surv_dir_1",
              kannada: "ಇಲ್ಲಿ ನಿಲ್ಲಿಸಿ ಅಣ್ಣ!",
              pronunciation: "Illi nillisi anna!",
              english: "Stop right here brother!",
              tag: "Stop Command",
              tip: "Say loudly and clearly when your destination or street corner arrives."
            },
            {
              id: "surv_dir_2",
              kannada: "ನೇರವಾಗಿ ಮುಂದೆ ಹೋಗಿ.",
              pronunciation: "Neraavaagi munde hogi.",
              english: "Go straight ahead.",
              tag: "Straight",
              tip: "Use when navigator or auto driver asks which way at a junction."
            },
            {
              id: "surv_dir_3",
              kannada: "ಮುಂದೆ ಬಲಗಡೆ ತಿರುಗಿ.",
              pronunciation: "Munde balagade thirugi.",
              english: "Turn right ahead.",
              tag: "Turn Right",
              tip: "Bala = Right side."
            },
            {
              id: "surv_dir_4",
              kannada: "ಮುಂದೆ ಎಡಗಡೆ ತಿರುಗಿ.",
              pronunciation: "Munde edagade thirugi.",
              english: "Turn left ahead.",
              tag: "Turn Left",
              tip: "Eda = Left side."
            },
            {
              id: "surv_dir_5",
              kannada: "ಇಲ್ಲಿಂದ ಎಷ್ಟು ದೂರ ಆಗುತ್ತೆ?",
              pronunciation: "Illinda eshtu doora aaguththe?",
              english: "How far is it from here?",
              tag: "Distance Query",
              tip: "Helps you know whether you can walk or need an auto."
            },
            {
              id: "surv_dir_6",
              kannada: "ಯಾವ ಬಸ್ ಹೋಗುತ್ತೆ ಅಣ್ಣ?",
              pronunciation: "Yaava bus hoguththe anna?",
              english: "Which bus goes there, brother?",
              tag: "Bus Stop",
              tip: "Ask locals standing at the bus stop for the right route number."
            }
          ]
        },
        {
          id: "autoshield",
          title: "ಆಟೋ ಮೀಟರ್ ರಕ್ಷಣೆ (Auto Meter & Fare Shield)",
          icon: "fa-shield-halved",
          color: "#f59e0b",
          phrases: [
            {
              id: "surv_auto_1",
              kannada: "ಮೀಟರ್ ಹಾಕಿ ಸ್ವಾಮಿ, ಮೀಟರ್ ಪ್ರಕಾರ ಬನ್ನಿ.",
              pronunciation: "Meter haaki swamy, meter prakaara banni.",
              english: "Please turn on the meter, sir; come by meter rate.",
              tag: "Fair Meter",
              tip: "Always say this before boarding the auto. Asking by meter prevents unexpected prices."
            },
            {
              id: "surv_auto_2",
              kannada: "ಮೀಟರ್ ಮೇಲೆ ಎಷ್ಟು ಕೊಡಬೇಕು ಅಣ್ಣ?",
              pronunciation: "Meter mele eshtu kodabeku anna?",
              english: "How much extra over the meter should I pay, brother?",
              tag: "Rain / Peak Hours",
              tip: "During heavy rain or late night, drivers ask 'Meter mele 20/30' (₹20-30 above meter)."
            },
            {
              id: "surv_auto_3",
              kannada: "ಚಿಲ್ಲರೆ ಇಲ್ಲ ಅಣ್ಣ, QR ಕೋಡ್ ಕೊಡಿ (GPay / PhonePe).",
              pronunciation: "Chillare illa anna, QR code kodi.",
              english: "I don't have exact change brother, please give UPI QR code.",
              tag: "Digital Pay",
              tip: "Nearly 99% of Karnataka auto drivers accept PhonePe / Google Pay QR codes."
            },
            {
              id: "surv_auto_4",
              kannada: "ರೌಂಡ್ ಫಿಗರ್ ಮಾಡೋಣ ಅಣ್ಣ.",
              pronunciation: "Round figure maadona anna.",
              english: "Let us make it a round figure, brother.",
              tag: "Quick Settlement",
              tip: "If meter is ₹43, say this and pay ₹50 to resolve change shortages peacefully."
            }
          ]
        },
        {
          id: "darshini",
          title: "ದರ್ಶಿನಿ & ಹೋಟೆಲ್ ಸರ್ವೈವಲ್ (Darshini Dining Protocol)",
          icon: "fa-utensils",
          color: "#ec4899",
          phrases: [
            {
              id: "surv_food_1",
              kannada: "ಟೋಕನ್ ಎಲ್ಲಿ ತಗೋಬೇಕು?",
              pronunciation: "Token elli thagobeku?",
              english: "Where should I collect the token?",
              tag: "Darshini Rule 1",
              tip: "In self-service Darshinis, you always pay at the cash counter first and collect food with tokens."
            },
            {
              id: "surv_food_2",
              kannada: "ಖಾರ ಬೇಡ / ಖಾರ ಕಮ್ಮಿ ಮಾಡಿ.",
              pronunciation: "Khaara beda / khaara kammi maadi.",
              english: "No spicy / please make it mild.",
              tag: "Spice Control",
              tip: "Crucial for outsiders sensitive to Karnataka green chili spice levels."
            },
            {
              id: "surv_food_3",
              kannada: "ಬಿಸಿ ಕುಡಿಯುವ ನೀರು ಕೊಡಿ.",
              pronunciation: "Bisi kudiyuva neeru kodi.",
              english: "Please give hot / warm drinking water.",
              tag: "Safe Drinking",
              tip: "Darshinis readily provide hot boiled water upon request."
            },
            {
              id: "surv_food_4",
              kannada: "ಚಟ್ನಿ ಸ್ವಲ್ಪ ಜಾಸ್ತಿ ಹಾಕಿ ಅಣ್ಣ.",
              pronunciation: "Chutney swalpa jaasti haaki anna.",
              english: "Please put a little extra chutney, brother.",
              tag: "Local Privilege",
              tip: "Chutney is free and loved in Karnataka; polite asking always gets you an extra ladle!"
            },
            {
              id: "surv_food_5",
              kannada: "ಪಾರ್ಸೆಲ್ ಕಟ್ಟಿ ಅಣ್ಣ.",
              pronunciation: "Parcel katti anna.",
              english: "Please pack it for takeaway, brother.",
              tag: "Takeaway",
              tip: "Use when taking food home. There is usually a separate parcel counter."
            }
          ]
        },
        {
          id: "market",
          title: "ಅಂಗಡಿ & ಖರೀದಿ (Kirana Shop & Market Survival)",
          icon: "fa-store",
          color: "#8b5cf6",
          phrases: [
            {
              id: "surv_mkt_1",
              kannada: "ತುಂಬಾ ಜಾಸ್ತಿ ಆಯಿತು, ಸ್ವಲ್ಪ ಕಡಿಮೆ ಮಾಡಿ ಅಣ್ಣ.",
              pronunciation: "Thumba jaasti aayithu, swalpa kadime maadi anna.",
              english: "That is too high, please reduce a little brother.",
              tag: "Bargaining",
              tip: "Tone matters! Saying it smilingly with 'Anna' gets you the local discount."
            },
            {
              id: "surv_mkt_2",
              kannada: "ಇದು ತಾಜಾ ಇದೆಯಾ?",
              pronunciation: "Idu taaza ideya?",
              english: "Is this fresh?",
              tag: "Quality Check",
              tip: "Useful when buying vegetables, greens, or dairy products."
            },
            {
              id: "surv_mkt_3",
              kannada: "ಅರ್ಧ ಕೆಜಿ ಕೊಡಿ / ಒಂದು ಕೆಜಿ ಎಷ್ಟು?",
              pronunciation: "Ardha KG kodi / Ondu KG eshtu?",
              english: "Give half a kilo / How much for one kilo?",
              tag: "Portions",
              tip: "Ardha = Half (1/2), Ondu = One (1), Kaal = Quarter (1/4)."
            },
            {
              id: "surv_mkt_4",
              kannada: "ಕ್ಯಾರಿ ಬ್ಯಾಗ್ ಅಥವಾ ಕವರ್ ಕೊಡಿ.",
              pronunciation: "Carry bag athava cover kodi.",
              english: "Please give a bag or cover.",
              tag: "Packaging",
              tip: "In Karnataka, plastic covers are banned, so ask for cloth or paper carry bags."
            }
          ]
        },
        {
          id: "medical",
          title: "ಮೆಡಿಕಲ್ & ತುರ್ತು ಆರೋಗ್ಯ (Pharmacy & Medical Lifeline)",
          icon: "fa-kit-medical",
          color: "#ef4444",
          phrases: [
            {
              id: "surv_med_1",
              kannada: "ತಲೆನೋವು / ಜ್ವರದ ಮಾತ್ರೆ ಕೊಡಿ.",
              pronunciation: "Thalenoovu / jwarada maathre kodi.",
              english: "Give tablet for headache / fever.",
              tag: "Quick Medicine",
              tip: "Chemists in towns understand 'Paracetamol', but this gets quick attention."
            },
            {
              id: "surv_med_2",
              kannada: "ಹೊಟ್ಟೆನೋವು ಆಗ್ತಾ ಇದೆ.",
              pronunciation: "Hottanoovu aagtha ide.",
              english: "Having stomach ache.",
              tag: "Symptom",
              tip: "Common for newcomers adjusting to local street food or water."
            },
            {
              id: "surv_med_3",
              kannada: "ಹತ್ತಿರದ ಆಸ್ಪತ್ರೆ ಅಥವಾ ಕ್ಲಿನಿಕ್ ಎಲ್ಲಿದೆ?",
              pronunciation: "Hathirada aaspathre athava clinic ellide?",
              english: "Where is the nearest hospital or clinic?",
              tag: "Hospital Search",
              tip: "Helps you get immediate directions to a doctor."
            },
            {
              id: "surv_med_4",
              kannada: "ತುರ್ತು ಸಹಾಯ ಬೇಕು, 108 ಗೆ ಕಾಲ್ ಮಾಡಿ!",
              pronunciation: "Thurtu sahaaya beku, 108 ge call maadi!",
              english: "Emergency help needed, call 108 ambulance!",
              tag: "Ambulance 108",
              tip: "108 is the government emergency ambulance service across all Karnataka districts."
            }
          ]
        }
      ],
      goldenRules: [
        {
          number: 1,
          title: "Use 'Anna' (Brother) & 'Akka' (Sister) as Respectful Address",
          kannada: "ಅಣ್ಣ / ಅಕ್ಕ ಎನ್ನಿ",
          description: "Never snap fingers or call people 'Bhaiya' or 'Tu'. Addressing an auto driver, shopkeeper, or conductor as 'Anna' generates instant brotherly respect and disarms tension.",
          icon: "fa-user-group",
          speech: "ಅಣ್ಣ, ನಮಸ್ಕಾರ! ಸ್ವಲ್ಪ ಸಹಾಯ ಮಾಡಿ."
        },
        {
          number: 2,
          title: "Master 'Aaythu' (ಆಯ್ತು) — The Universal Magic Word",
          kannada: "ಆಯ್ತು (Aaythu)",
          description: "In Kannada, 'Aaythu' means: 'Yes', 'Okay', 'Done', 'Agreed', 'Understood', and 'Alright'. When an auto drops you or a cashier gives your bill, saying 'Aaythu Anna' is the most natural reply.",
          icon: "fa-circle-check",
          speech: "ಆಯ್ತು ಅಣ್ಣ, ಧನ್ಯವಾದಗಳು!"
        },
        {
          number: 3,
          title: "Say 'Swalpa Kannada Gothu' — 5% Effort Brings 100% Warmth",
          kannada: "ಕನ್ನಡ ಸ್ವಲ್ಪ ಗೊತ್ತು",
          description: "Kannadigas are remarkably hospitable. Even if you only know 2 or 3 words, expressing that you are trying to learn melts hearts and opens doors everywhere in Karnataka.",
          icon: "fa-heart",
          speech: "ಕನ್ನಡ ಸ್ವಲ್ಪ ಗೊತ್ತು, ಕಲಿತಾ ಇದ್ದೀನಿ ಅಣ್ಣ."
        },
        {
          number: 4,
          title: "Ask 'Meter Haaki Swamy' Before Boarding Autos",
          kannada: "ಮೀಟರ್ ಹಾಕಿ ಸ್ವಾಮಿ",
          description: "In Bengaluru, Mysuru, and other Karnataka towns, auto drivers are legally required to use meters. Asking politely before getting in establishes that you know town rules.",
          icon: "fa-taxi",
          speech: "ಮೀಟರ್ ಹಾಕಿ ಸ್ವಾಮಿ, ಮೀಟರ್ ಪ್ರಕಾರ ಬನ್ನಿ."
        },
        {
          number: 5,
          title: "Keep UPI (GPay / PhonePe) Ready Everywhere",
          kannada: "ಆನ್‌ಲೈನ್ ಪೇಮೆಂಟ್ (UPI)",
          description: "Loose coin change ('Chillare') is chronically short in Karnataka. Almost every coconut vendor, auto, and street cart displays a PhonePe/GPay QR code.",
          icon: "fa-qrcode",
          speech: "ಚಿಲ್ಲರೆ ಇಲ್ಲ ಅಣ್ಣ, QR ಕೋಡ್ ಕೊಡಿ PhonePe ಮಾಡ್ತೀನಿ."
        }
      ]
    };
  }

  function setupToolkit() {
    // Sub-tab toggling
    const subTabs = document.querySelectorAll('.toolkit-tab');
    subTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        subTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const sec = tab.dataset.section;
        document.querySelectorAll('.toolkit-content-sec').forEach(s => s.style.display = 'none');
        const target = document.getElementById(`sec-${sec}`);
        if (target) target.style.display = 'block';
        playAudioChime(640, 'triangle', 0.08);
      });
    });

    setupTownSurvival();
    setupAutoFareShield();
    setupGoldenRules();
    renderAlphabetSoundboard();
    renderNumbersGrid();
    renderMagicWordsGrid();
  }

  function setupTownSurvival() {
    const survivalData = (appData && appData.survival) ? appData.survival : getFallbackSurvivalData();

    // 1. Compass Command Buttons
    const compassButtons = document.querySelectorAll('.compass-btn');
    const compassMap = {
      stop: { kannada: "ಇಲ್ಲಿ ನಿಲ್ಲಿಸಿ ಅಣ್ಣ!", pronounce: "Illi nillisi anna!", english: "Stop right here brother!" },
      straight: { kannada: "ನೇರವಾಗಿ ಮುಂದೆ ಹೋಗಿ.", pronounce: "Neraavaagi munde hogi.", english: "Go straight ahead." },
      left: { kannada: "ಮುಂದೆ ಎಡಗಡೆ ತಿರುಗಿ.", pronounce: "Munde edagade thirugi.", english: "Turn left ahead." },
      right: { kannada: "ಮುಂದೆ ಬಲಗಡೆ ತಿರುಗಿ.", pronounce: "Munde balagade thirugi.", english: "Turn right ahead." },
      distance: { kannada: "ಇಲ್ಲಿಂದ ಎಷ್ಟು ದೂರ ಆಗುತ್ತೆ?", pronounce: "Illinda eshtu doora aaguththe?", english: "How far from here?" },
      bus: { kannada: "ಯಾವ ಬಸ್ ಹೋಗುತ್ತೆ ಅಣ್ಣ?", pronounce: "Yaava bus hoguththe anna?", english: "Which bus goes there brother?" }
    };

    compassButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const cmd = btn.dataset.cmd;
        const item = compassMap[cmd];
        if (item) {
          playAudioChime(720, 'sine', 0.1);
          btn.style.transform = 'scale(0.96)';
          setTimeout(() => btn.style.transform = '', 180);
          playSpeechAudio(item.kannada, 1.0, btn, item.pronounce);
        }
      });
    });

    // 2. Filter Pills
    const filterPills = document.querySelectorAll('.survival-cat-pill');
    filterPills.forEach(pill => {
      pill.addEventListener('click', () => {
        filterPills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        currentSurvivalCat = pill.dataset.cat;
        playAudioChime(600, 'triangle', 0.08);
        renderSurvivalCards();
      });
    });

    renderSurvivalCards();
  }

  function renderSurvivalCards() {
    const grid = document.getElementById('survivalCardsGrid');
    if (!grid) return;

    const survivalData = (appData && appData.survival) ? appData.survival : getFallbackSurvivalData();
    const categories = survivalData.categories || [];

    let allPhrases = [];
    categories.forEach(cat => {
      if (currentSurvivalCat === 'all' || currentSurvivalCat === cat.id) {
        cat.phrases.forEach(p => {
          allPhrases.push({ ...p, catTitle: cat.title, catIcon: cat.icon, catColor: cat.color });
        });
      }
    });

    if (allPhrases.length === 0) {
      grid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 40px;">No lifelines available.</div>`;
      return;
    }

    grid.innerHTML = '';
    allPhrases.forEach(p => {
      const card = document.createElement('article');
      card.className = 'survival-card';
      card.innerHTML = `
        <div>
          <div class="survival-card-header">
            <span class="survival-cat-badge" style="background: ${p.catColor}22; color: ${p.catColor}; border: 1px solid ${p.catColor}55;">
              <i class="fa-solid ${p.catIcon}"></i> ${p.catTitle.split('(')[0]}
            </span>
            <span class="survival-tag-pill">${p.tag}</span>
          </div>

          <div class="survival-kannada">${p.kannada}</div>
          <div class="survival-pronounce">
            <i class="fa-solid fa-volume-high" style="font-size: 0.85rem; color: var(--accent-gold);"></i>
            <span>${p.pronunciation}</span>
          </div>
          <div class="survival-english">${p.english}</div>

          <div class="survival-tip-box">
            <strong><i class="fa-solid fa-lightbulb" style="color: var(--accent-gold); margin-right: 4px;"></i> Pro-Tip:</strong>
            ${p.tip}
          </div>
        </div>

        <div class="survival-actions-row">
          <button class="survival-btn-audio" title="Listen at normal speed">
            <i class="fa-solid fa-volume-high"></i>
            <span>ಕೇಳಿ (Listen)</span>
          </button>
          <button class="survival-btn-slow" title="Listen slowly (0.7x)">
            <i class="fa-solid fa-person-walking"></i>
            <span>Slow</span>
          </button>
          <button class="survival-btn-show" title="Show giant screen card to driver or shopkeeper">
            <i class="fa-solid fa-expand"></i>
            <span>ತೋರಿಸಿ</span>
          </button>
          <button class="survival-btn-practice" title="Practice speaking in Speech Studio">
            <i class="fa-solid fa-microphone"></i>
            <span>ಅಭ್ಯಾಸ</span>
          </button>
        </div>
      `;

      const audioBtn = card.querySelector('.survival-btn-audio');
      const slowBtn = card.querySelector('.survival-btn-slow');
      const showBtn = card.querySelector('.survival-btn-show');
      const practiceBtn = card.querySelector('.survival-btn-practice');

      audioBtn.addEventListener('click', () => {
        playAudioChime(620, 'triangle', 0.08);
        playSpeechAudio(p.kannada, 1.0, audioBtn, p.pronunciation);
      });

      slowBtn.addEventListener('click', () => {
        playAudioChime(540, 'triangle', 0.08);
        playSpeechAudio(p.kannada, 0.7, slowBtn, p.pronunciation);
      });

      showBtn.addEventListener('click', () => {
        playAudioChime(750, 'sine', 0.1);
        openDriverCardModal({
          kannada: p.kannada,
          pronunciation: p.pronunciation,
          english: p.english
        });
      });

      practiceBtn.addEventListener('click', () => {
        playAudioChime(760, 'sine', 0.1);
        openPracticeForPhrase({
          id: p.id,
          kannada: p.kannada,
          pronunciation: p.pronunciation,
          english: p.english,
          category: 'Town Survival'
        });
      });

      grid.appendChild(card);
    });
  }

  // --- Auto Fare Shield & RTO Estimator ---
  function setupAutoFareShield() {
    const range = document.getElementById('autoDistanceRange');
    const distVal = document.getElementById('autoDistanceValue');
    const nightToggle = document.getElementById('autoNightToggle');
    const presetBtns = document.querySelectorAll('.dist-btn');
    const speakBtn = document.getElementById('btnSpeakAutoFare');
    const showBtn = document.getElementById('btnShowAutoFare');
    const remindMeterBtn = document.getElementById('btnRemindMeter');

    if (!range) return;

    function updateFare() {
      currentAutoKm = parseFloat(range.value);
      isAutoNight = nightToggle ? nightToggle.checked : false;

      if (distVal) distVal.textContent = `${currentAutoKm.toFixed(1)} km`;

      let fare = 30.0;
      if (currentAutoKm > 2.0) {
        fare = 30.0 + ((currentAutoKm - 2.0) * 15.0);
      }
      if (isAutoNight) fare *= 1.5;

      const fareInt = Math.round(fare);
      const knDigits = toKannadaDigits(fareInt);

      const amountEl = document.getElementById('autoFareAmountDisplay');
      const knDigitsEl = document.getElementById('autoFareKnDigits');
      const breakdownEl = document.getElementById('autoFareBreakdown');
      const speechTextEl = document.getElementById('autoFareSpeechText');

      if (amountEl) amountEl.textContent = `₹ ${fareInt}`;
      if (knDigitsEl) knDigitsEl.textContent = `(₹ ${knDigits})`;

      const kmBeyond = Math.max(0, currentAutoKm - 2.0).toFixed(1);
      if (breakdownEl) {
        breakdownEl.textContent = isAutoNight
          ? `[₹30 (First 2 km) + ${kmBeyond} km × ₹15/km] × 1.5 (Night) = ₹${fareInt}`
          : `₹30 (First 2 km) + ${kmBeyond} km × ₹15/km = ₹${fareInt}`;
      }

      const speechStr = `${Math.round(currentAutoKm)} ಕಿಲೋಮೀಟರ್‌ಗೆ ಸುಮಾರು ${fareInt} ರೂಪಾಯಿ ಆಗುತ್ತೆ ಸ್ವಾಮಿ.`;
      if (speechTextEl) speechTextEl.textContent = `"${speechStr}"`;
    }

    range.addEventListener('input', () => {
      presetBtns.forEach(b => b.classList.remove('active'));
      updateFare();
    });

    presetBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        presetBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        range.value = btn.dataset.km;
        playAudioChime(650, 'triangle', 0.08);
        updateFare();
      });
    });

    if (nightToggle) {
      nightToggle.addEventListener('change', () => {
        playAudioChime(700, 'sine', 0.1);
        updateFare();
      });
    }

    if (speakBtn) {
      speakBtn.addEventListener('click', () => {
        const fareInt = parseInt((document.getElementById('autoFareAmountDisplay').textContent || '75').replace(/\D/g, ''), 10) || 75;
        const speechStr = `${Math.round(currentAutoKm)} ಕಿಲೋಮೀಟರ್‌ಗೆ ಸುಮಾರು ${fareInt} ರೂಪಾಯಿ ಆಗುತ್ತೆ ಸ್ವಾಮಿ.`;
        const phoneticStr = `${Math.round(currentAutoKm)} kilometer ge sumaaru ${fareInt} roopaayi aaguththe swamy.`;
        playAudioChime(740, 'triangle', 0.1);
        playSpeechAudio(speechStr, 1.0, speakBtn, phoneticStr);
      });
    }

    if (showBtn) {
      showBtn.addEventListener('click', () => {
        const fareInt = parseInt((document.getElementById('autoFareAmountDisplay').textContent || '75').replace(/\D/g, ''), 10) || 75;
        playAudioChime(800, 'sine', 0.1);
        openDriverCardModal({
          kannada: `ಆಟೋ ನ್ಯಾಯಸಮ್ಮತ ದರ: ₹ ${fareInt} (${currentAutoKm} ಕಿ.ಮೀ)`,
          pronunciation: `Fair Auto Fare: ₹ ${fareInt} (${currentAutoKm} km RTO Rate)`,
          english: `Official Karnataka RTO Estimated Fare ${isAutoNight ? '(Night Rate)' : '(Day Rate)'}`
        });
      });
    }

    if (remindMeterBtn) {
      remindMeterBtn.addEventListener('click', () => {
        playAudioChime(700, 'triangle', 0.1);
        playSpeechAudio("ಮೀಟರ್ ಹಾಕಿ ಸ್ವಾಮಿ, ಮೀಟರ್ ಪ್ರಕಾರ ಬನ್ನಿ.", 1.0, remindMeterBtn, "Meter haaki swamy, meter prakaara banni.");
      });
    }

    updateFare();
  }

  // --- 5 Golden Cultural Rules ---
  function setupGoldenRules() {
    const grid = document.getElementById('goldenRulesGrid');
    const listenAllBtn = document.getElementById('btnListenAllRules');
    if (!grid) return;

    const survivalData = (appData && appData.survival) ? appData.survival : getFallbackSurvivalData();
    const rules = survivalData.goldenRules || [];

    grid.innerHTML = '';
    rules.forEach(rule => {
      const card = document.createElement('div');
      card.className = 'golden-rule-card';
      card.innerHTML = `
        <div>
          <div class="rule-number-badge">${rule.number}</div>
          <div class="rule-kannada-tag">${rule.kannada}</div>
          <div class="rule-title">${rule.title}</div>
          <div class="rule-desc">${rule.description}</div>
        </div>
        <button class="rule-audio-btn">
          <i class="fa-solid fa-volume-high"></i>
          <span>ಧ್ವನಿ ಕೇಳಿ (Hear Rule)</span>
        </button>
      `;

      const audioBtn = card.querySelector('.rule-audio-btn');
      audioBtn.addEventListener('click', () => {
        playAudioChime(660, 'sine', 0.1);
        const textToSpeak = rule.speech || rule.kannada;
        playSpeechAudio(textToSpeak, 1.0, audioBtn, rule.title);
      });

      grid.appendChild(card);
    });

    if (listenAllBtn) {
      listenAllBtn.addEventListener('click', () => {
        playAudioChime(780, 'sine', 0.15);
        const combinedScript = "ಕರ್ನಾಟಕ ನಗರ ಸಭ್ಯತೆಯ ಗೋಲ್ಡನ್ ರೂಲ್ಸ್: ಒಂದು: ಎಲ್ಲರನ್ನೂ ಅಣ್ಣ ಅಥವಾ ಅಕ್ಕ ಎಂದು ಗೌರವದಿಂದ ಕರೆಯಿರಿ. ಎರಡು: ಆಯ್ತು ಎಂಬ ಮಾಂತ್ರಿಕ ಪದವನ್ನು ಬಳಸಿ. ಮೂರು: ಕನ್ನಡ ಸ್ವಲ್ಪ ಗೊತ್ತು ಕಲಿತಾ ಇದ್ದೀನಿ ಎಂದು ಮುಗುಳ್ನಗೆಯಿಂದ ಹೇಳಿ. ನಾಲ್ಕು: ಆಟೋ ಹತ್ತುವ ಮೊದಲು ಮೀಟರ್ ಹಾಕಿ ಸ್ವಾಮಿ ಎಂದು ಕೇಳಿ. ಐದು: ಫೋನ್ ಪೇ ಅಥವಾ ಜಿ ಪೇ ಕ್ಯೂ ಆರ್ ಕೋಡ್ ಇಟ್ಟುಕೊಳ್ಳಿ.";
        playSpeechAudio(combinedScript, 1.0, listenAllBtn, "Karnataka Golden Rules Audio Guide");
      });
    }
  }

  function renderAlphabetSoundboard() {
    const alphabetGrid = document.getElementById('alphabetGrid');
    if (alphabetGrid && appData && appData.alphabet) {
      alphabetGrid.innerHTML = '';
      appData.alphabet.forEach(item => {
        const card = document.createElement('div');
        card.className = 'letter-card';
        card.innerHTML = `
          <div class="letter-kannada">${item.letter}</div>
          <div class="letter-translit">${item.translit}</div>
          <div class="letter-sound">${item.sound}</div>
          <div class="letter-example">${item.example}</div>
        `;
        card.addEventListener('click', () => playSpeechAudio(item.letter, 1.0, card, item.translit));
        alphabetGrid.appendChild(card);
      });
    }
  }

  function renderNumbersGrid() {
    const numbersGrid = document.getElementById('numbersGrid');
    if (numbersGrid && appData && appData.numbers) {
      numbersGrid.innerHTML = '';
      appData.numbers.forEach(item => {
        const card = document.createElement('div');
        card.className = 'number-card';
        card.innerHTML = `
          <div class="number-digit">${item.num}</div>
          <div class="number-kannada">${item.kannada}</div>
          <div class="number-pronounce">${item.pronounce}</div>
        `;
        card.addEventListener('click', () => playSpeechAudio(item.kannada, 1.0, card, item.pronounce));
        numbersGrid.appendChild(card);
      });
    }
  }

  function renderMagicWordsGrid() {
    const magicGrid = document.getElementById('magicWordsGrid');
    if (magicGrid && appData && appData.magicWords) {
      magicGrid.innerHTML = '';
      appData.magicWords.forEach(item => {
        const card = document.createElement('div');
        card.className = 'magic-card';
        card.innerHTML = `
          <div class="magic-kannada">${item.word}</div>
          <div class="magic-pronounce">${item.pronounce}</div>
          <div class="magic-english">${item.english}</div>
          <div class="magic-tip">${item.tip}</div>
        `;
        card.addEventListener('click', () => playSpeechAudio(item.word, 1.0, card, item.pronounce));
        magicGrid.appendChild(card);
      });
    }
  }

  // ============================================================
  // MODULE: BANGALORE SLANG DECODER (ಬೆಂಗಳೂರು ಕನ್ನಡ)
  // ============================================================
  function setupSlang() {
    const slangGrid = document.getElementById('slangGrid');
    if (!slangGrid || !appData || !appData.slang) return;

    slangGrid.innerHTML = '';
    appData.slang.forEach(item => {
      const card = document.createElement('div');
      card.className = 'slang-card';
      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: baseline;">
          <div class="slang-term">${item.term}</div>
          <button class="icon-btn-ghost" title="Listen"><i class="fa-solid fa-volume-high"></i></button>
        </div>
        <div class="slang-meaning">${item.meaning}</div>
        <div class="slang-example-box">
          <i class="fa-solid fa-quote-left" style="color: #38bdf8; margin-right: 4px;"></i>
          ${item.example}
        </div>
      `;

      card.querySelector('button').addEventListener('click', (e) => {
        e.stopPropagation();
        playSpeechAudio(item.example, 1.0, card, item.meaning);
      });

      card.addEventListener('click', () => {
        playSpeechAudio(item.example, 1.0, card, item.meaning);
      });

      slangGrid.appendChild(card);
    });
  }

  // ============================================================
  // MODULE: "WHAT TO SAY NEXT" DIALOGUE SIMULATOR
  // ============================================================
  function setupSimulator() {
    if (!appData || !appData.dialogues) return;
    renderScenarioSelector();
    loadScenario(activeDialogueId);
  }

  function renderScenarioSelector() {
    const container = document.getElementById('scenarioSelectorCards');
    if (!container) return;

    container.innerHTML = '';
    appData.dialogues.forEach(dlg => {
      const card = document.createElement('div');
      card.className = `scenario-card ${dlg.id === activeDialogueId ? 'active' : ''}`;
      card.innerHTML = `
        <div style="font-size: 0.75rem; text-transform: uppercase; color: var(--accent-gold); font-weight: 700; margin-bottom: 4px;">
          <i class="fa-solid fa-location-dot"></i> ${dlg.category}
        </div>
        <h3>${dlg.title}</h3>
        <p>${dlg.scenario}</p>
      `;

      card.addEventListener('click', () => {
        activeDialogueId = dlg.id;
        document.querySelectorAll('.scenario-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        loadScenario(dlg.id);
      });

      container.appendChild(card);
    });
  }

  function loadScenario(scenarioId) {
    const dialogue = appData.dialogues.find(d => d.id === scenarioId) || appData.dialogues[0];
    dialogueCurrentStepIndex = 0;
    dialogueScore = 0;

    const chatArena = document.getElementById('simulatorChatHistory');
    if (chatArena) chatArena.innerHTML = '';
    renderDialogueStep(dialogue, dialogueCurrentStepIndex);
  }

  function renderDialogueStep(dialogue, stepIndex) {
    const chatArena = document.getElementById('simulatorChatHistory');
    const optionsContainer = document.getElementById('dialogueOptionsContainer');
    const promptTitle = document.getElementById('dialoguePromptTitle');

    if (!chatArena || !optionsContainer) return;

    if (stepIndex >= dialogue.steps.length) {
      optionsContainer.innerHTML = `
        <div style="text-align: center; padding: 20px 10px;">
          <i class="fa-solid fa-circle-check" style="font-size: 3rem; color: #10b981; margin-bottom: 12px;"></i>
          <h4 style="font-size: 1.3rem; font-weight: 800; margin-bottom: 6px;">Conversation Completed!</h4>
          <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 16px;">You handled this situation with confidence and earned ${dialogueScore} points!</p>
          <button class="btn-audio-play" id="btnRestartScenario" style="margin: 0 auto; max-width: 220px;">
            <i class="fa-solid fa-rotate-right"></i> Try Again
          </button>
        </div>
      `;
      const restartBtn = document.getElementById('btnRestartScenario');
      if (restartBtn) restartBtn.addEventListener('click', () => loadScenario(dialogue.id));
      return;
    }

    const currentStep = dialogue.steps[stepIndex];

    const partnerBubble = document.createElement('div');
    partnerBubble.className = 'chat-bubble partner';
    partnerBubble.innerHTML = `
      <div class="speaker-name">
        <i class="fa-solid fa-user"></i> ${currentStep.speaker}
        <button class="bubble-audio-btn" title="Listen"><i class="fa-solid fa-volume-high"></i></button>
      </div>
      <div class="bubble-kannada">${currentStep.kannada}</div>
      <div class="bubble-pronounce">${currentStep.pronunciation}</div>
      <div class="bubble-english">${currentStep.english}</div>
    `;

    const audioBtn = partnerBubble.querySelector('.bubble-audio-btn');
    audioBtn.addEventListener('click', () => playSpeechAudio(currentStep.kannada, 1.0, audioBtn, currentStep.pronunciation));

    chatArena.appendChild(partnerBubble);
    chatArena.scrollTop = chatArena.scrollHeight;

    if (promptTitle) promptTitle.innerHTML = `<i class="fa-solid fa-reply"></i> Choose what you want to reply:`;

    optionsContainer.innerHTML = '';
    currentStep.options.forEach(opt => {
      const optBtn = document.createElement('button');
      optBtn.className = 'option-btn';
      optBtn.innerHTML = `
        <div class="option-kannada">${opt.kannada}</div>
        <div class="option-pronounce">${opt.pronunciation}</div>
        <div class="option-english">${opt.english}</div>
      `;

      optBtn.addEventListener('click', () => {
        dialogueScore += (opt.score || 10);
        const userBubble = document.createElement('div');
        userBubble.className = 'chat-bubble user';
        userBubble.innerHTML = `
          <div class="speaker-name">You</div>
          <div class="bubble-kannada">${opt.kannada}</div>
          <div class="bubble-pronounce">${opt.pronunciation}</div>
          <div class="bubble-english">${opt.english}</div>
          <div style="margin-top: 8px; font-size: 0.8rem; color: #a7f3d0; border-top: 1px dashed rgba(255,255,255,0.2); padding-top: 6px;">
            <i class="fa-solid fa-circle-info"></i> ${opt.feedback}
          </div>
        `;
        chatArena.appendChild(userBubble);
        chatArena.scrollTop = chatArena.scrollHeight;

        setTimeout(() => renderDialogueStep(dialogue, stepIndex + 1), 1100);
      });

      optionsContainer.appendChild(optBtn);
    });
  }

  // ============================================================
  // MODULE: PRACTICE QUIZ ARENA
  // ============================================================
  function setupQuiz() {
    if (!appData || !appData.quizzes) return;
    quizCurrentIndex = 0;
    quizScore = 0;
    renderQuizQuestion();

    const nextBtn = document.getElementById('quizNextBtn');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        quizCurrentIndex++;
        if (quizCurrentIndex < appData.quizzes.length) {
          renderQuizQuestion();
        } else {
          showQuizResults();
        }
      });
    }

    const restartBtn = document.getElementById('btnRestartQuiz');
    if (restartBtn) {
      restartBtn.addEventListener('click', () => {
        quizCurrentIndex = 0;
        quizScore = 0;
        const resultView = document.getElementById('quizResultView');
        const activeContainer = document.getElementById('quizActiveContainer');
        if (resultView) resultView.classList.remove('active');
        if (activeContainer) activeContainer.style.display = 'block';
        renderQuizQuestion();
      });
    }
  }

  function renderQuizQuestion() {
    const q = appData.quizzes[quizCurrentIndex];
    if (!q) return;

    const progressText = document.getElementById('quizProgressText');
    const scoreBadge = document.getElementById('quizScoreBadge');
    const progressFill = document.getElementById('quizProgressFill');
    const situationText = document.getElementById('quizSituationText');
    const questionTitle = document.getElementById('quizQuestionTitle');
    const optionsGrid = document.getElementById('quizOptionsGrid');
    const explanationBox = document.getElementById('quizExplanationBox');
    const nextBtn = document.getElementById('quizNextBtn');

    if (progressText) progressText.textContent = `Question ${quizCurrentIndex + 1} of ${appData.quizzes.length}`;
    if (scoreBadge) scoreBadge.textContent = `${quizScore} Points`;
    if (progressFill) {
      const pct = Math.round(((quizCurrentIndex) / appData.quizzes.length) * 100);
      progressFill.style.width = `${pct}%`;
    }
    if (situationText) situationText.textContent = q.situation;
    if (questionTitle) questionTitle.textContent = q.question;
    if (explanationBox) {
      explanationBox.classList.remove('active');
      explanationBox.innerHTML = '';
    }
    if (nextBtn) nextBtn.style.display = 'none';

    if (optionsGrid) {
      optionsGrid.innerHTML = '';
      q.options.forEach((optText, idx) => {
        const btn = document.createElement('button');
        btn.className = 'quiz-choice-btn';
        btn.innerHTML = `<span>${optText}</span><i class="fa-regular fa-circle"></i>`;

        btn.addEventListener('click', () => {
          const allChoiceBtns = optionsGrid.querySelectorAll('.quiz-choice-btn');
          allChoiceBtns.forEach(b => b.disabled = true);

          if (idx === q.correctIndex) {
            btn.classList.add('correct');
            btn.querySelector('i').className = 'fa-solid fa-circle-check';
            quizScore += 15;
            if (scoreBadge) scoreBadge.textContent = `${quizScore} Points`;
          } else {
            btn.classList.add('wrong');
            btn.querySelector('i').className = 'fa-solid fa-circle-xmark';
            const correctBtn = allChoiceBtns[q.correctIndex];
            if (correctBtn) {
              correctBtn.classList.add('correct');
              correctBtn.querySelector('i').className = 'fa-solid fa-circle-check';
            }
          }

          if (explanationBox) {
            explanationBox.className = 'quiz-explanation-box active';
            explanationBox.innerHTML = `
              <div class="explanation-title" style="color: ${idx === q.correctIndex ? '#10b981' : '#f59e0b'};">
                <i class="fa-solid fa-${idx === q.correctIndex ? 'check' : 'circle-exclamation'}"></i>
                ${idx === q.correctIndex ? 'Correct!' : 'Note:'}
              </div>
              <p style="color: #e2e8f0; font-size: 0.92rem; line-height: 1.5;">${q.explanation}</p>
            `;
          }

          if (nextBtn) {
            nextBtn.style.display = 'block';
            nextBtn.textContent = (quizCurrentIndex + 1 === appData.quizzes.length) ? 'View Final Results' : 'Next Question';
          }
        });

        optionsGrid.appendChild(btn);
      });
    }
  }

  function showQuizResults() {
    const activeContainer = document.getElementById('quizActiveContainer');
    const resultView = document.getElementById('quizResultView');
    const finalScoreEl = document.getElementById('quizFinalScore');
    const progressFill = document.getElementById('quizProgressFill');

    if (activeContainer) activeContainer.style.display = 'none';
    if (resultView) resultView.classList.add('active');
    if (progressFill) progressFill.style.width = '100%';

    if (finalScoreEl) finalScoreEl.textContent = `${quizScore} / ${appData.quizzes.length * 15}`;

    const currentHigh = parseInt(localStorage.getItem('nammabhasha_quiz_highscore') || '0', 10);
    if (quizScore > currentHigh) {
      localStorage.setItem('nammabhasha_quiz_highscore', quizScore.toString());
    }
    updateStatsBar();
  }

  // ============================================================
  // MODULE: SPEECH CAPTURE & PRONUNCIATION STUDIO (ಧ್ವನಿ ಲ್ಯಾಬ್)
  // ============================================================
  function loadPracticeStats() {
    try {
      practiceTotalXp = parseInt(localStorage.getItem('nammabhasha_practice_xp') || '0', 10);
      practiceMasteredCount = parseInt(localStorage.getItem('nammabhasha_practice_sessions') || '0', 10);
      const xpEl = document.getElementById('practiceTotalXp');
      const countEl = document.getElementById('practiceMasteredCount');
      if (xpEl) xpEl.textContent = `${practiceTotalXp} XP`;
      if (countEl) countEl.textContent = `${practiceMasteredCount}`;
      updateStatsBar();
    } catch (e) {}
  }

  function savePracticeStats(earnedXp = 20) {
    try {
      practiceTotalXp += earnedXp;
      practiceMasteredCount += 1;
      localStorage.setItem('nammabhasha_practice_xp', practiceTotalXp.toString());
      localStorage.setItem('nammabhasha_practice_sessions', practiceMasteredCount.toString());
      const xpEl = document.getElementById('practiceTotalXp');
      const countEl = document.getElementById('practiceMasteredCount');
      if (xpEl) xpEl.textContent = `${practiceTotalXp} XP`;
      if (countEl) countEl.textContent = `${practiceMasteredCount}`;
      updateStatsBar();
    } catch (e) {}
  }

  function setupSpeechPracticeStudio() {
    const categorySelect = document.getElementById('practiceCategorySelect');
    const nextBtn = document.getElementById('btnNextPracticePhrase');
    const listenNormalBtn = document.getElementById('btnPracticeListenNormal');
    const listenSlowBtn = document.getElementById('btnPracticeListenSlow');
    const captureBtn = document.getElementById('btnCaptureSpeech');
    const playUserVoiceBtn = document.getElementById('btnPlayUserVoice');
    const playNativeCompareBtn = document.getElementById('btnPlayNativeCompare');

    if (categorySelect) {
      categorySelect.addEventListener('change', () => {
        loadPracticePhraseForCategory(categorySelect.value);
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        const cat = categorySelect ? categorySelect.value : 'travel';
        loadRandomPracticePhrase(cat);
      });
    }

    if (listenNormalBtn) {
      listenNormalBtn.addEventListener('click', () => {
        if (!activePracticePhrase) return;
        playAudioChime(640, 'triangle', 0.1);
        playSpeechAudio(activePracticePhrase.kannada, 1.0, listenNormalBtn, activePracticePhrase.pronunciation);
      });
    }

    if (listenSlowBtn) {
      listenSlowBtn.addEventListener('click', () => {
        if (!activePracticePhrase) return;
        playAudioChime(540, 'triangle', 0.12);
        playSpeechAudio(activePracticePhrase.kannada, 0.7, listenSlowBtn, activePracticePhrase.pronunciation);
      });
    }

    if (captureBtn) {
      captureBtn.addEventListener('click', () => {
        toggleSpeechCapture();
      });
    }

    if (playUserVoiceBtn) {
      playUserVoiceBtn.addEventListener('click', () => {
        if (!recordedAudioUrl) return;
        playAudioChime(580, 'sine', 0.08);
        const audio = new Audio(recordedAudioUrl);
        playUserVoiceBtn.classList.add('playing');
        audio.onended = () => playUserVoiceBtn.classList.remove('playing');
        audio.onerror = () => playUserVoiceBtn.classList.remove('playing');
        audio.play();
      });
    }

    if (playNativeCompareBtn) {
      playNativeCompareBtn.addEventListener('click', () => {
        if (!activePracticePhrase) return;
        playAudioChime(660, 'triangle', 0.1);
        playSpeechAudio(activePracticePhrase.kannada, 1.0, playNativeCompareBtn, activePracticePhrase.pronunciation);
      });
    }

    loadPracticePhraseForCategory('travel');
    renderPracticeQuickGrid();
  }

  function loadPracticePhraseForCategory(catId) {
    if (!appData || !appData.phrases || appData.phrases.length === 0) return;
    const filtered = appData.phrases.filter(p => p.category === catId);
    const phrase = filtered.length > 0 ? filtered[0] : appData.phrases[0];
    setPracticePhrase(phrase);
  }

  function loadRandomPracticePhrase(catId) {
    if (!appData || !appData.phrases || appData.phrases.length === 0) return;
    const filtered = appData.phrases.filter(p => p.category === catId);
    const pool = filtered.length > 0 ? filtered : appData.phrases;
    const randomIdx = Math.floor(Math.random() * pool.length);
    setPracticePhrase(pool[randomIdx]);
  }

  function setPracticePhrase(phrase) {
    if (!phrase) return;
    const safePhrase = {
      id: phrase.id || 'phrase_custom',
      kannada: phrase.kannada || phrase.title || phrase.audioText || '',
      pronunciation: phrase.pronunciation || phrase.pronounce || phrase.translit || phrase.english || 'Namaskara',
      english: phrase.english || phrase.subtitle || '',
      category: phrase.category || 'Practice'
    };
    activePracticePhrase = safePhrase;

    const topicBadge = document.getElementById('practiceTopicBadge');
    const kannadaEl = document.getElementById('practiceTargetKannada');
    const pronounceEl = document.getElementById('practiceTargetPronounce');
    const englishEl = document.getElementById('practiceTargetEnglish');
    const transcriptBox = document.getElementById('practiceTranscriptBox');
    const userVoiceBtn = document.getElementById('btnPlayUserVoice');
    const statusText = document.getElementById('practiceStatusText');

    if (topicBadge) topicBadge.textContent = `${(safePhrase.category || 'Daily').toUpperCase()} • Practice Challenge`;
    if (kannadaEl) kannadaEl.textContent = safePhrase.kannada;
    if (pronounceEl) pronounceEl.textContent = safePhrase.pronunciation;
    if (englishEl) englishEl.textContent = safePhrase.english;

    if (transcriptBox) transcriptBox.style.display = 'none';
    if (userVoiceBtn) userVoiceBtn.disabled = true;
    if (statusText) statusText.textContent = "Click the microphone button and speak aloud in Kannada.";

    recordedAudioBlob = null;
    recordedAudioUrl = null;
  }

  function openPracticeForPhrase(phrase) {
    switchView('practice');
    setPracticePhrase(phrase);
    const catSelect = document.getElementById('practiceCategorySelect');
    if (catSelect && phrase.category) {
      catSelect.value = phrase.category;
    }
    setTimeout(() => {
      const arena = document.querySelector('.practice-arena-card');
      if (arena) arena.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
  }

  async function toggleSpeechCapture() {
    if (isRecordingSpeech) {
      stopSpeechCapture();
    } else {
      startSpeechCapture();
    }
  }

  async function startSpeechCapture() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const visualizer = document.getElementById('practiceVisualizerWrap');
    const micLabel = document.getElementById('micBtnLabel');
    const statusText = document.getElementById('practiceStatusText');
    const transcriptBox = document.getElementById('practiceTranscriptBox');

    if (transcriptBox) transcriptBox.style.display = 'none';

    audioChunks = [];
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorderInstance = new MediaRecorder(stream);
        mediaRecorderInstance.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) audioChunks.push(e.data);
        };
        mediaRecorderInstance.onstop = () => {
          recordedAudioBlob = new Blob(audioChunks, { type: 'audio/webm' });
          recordedAudioUrl = URL.createObjectURL(recordedAudioBlob);
          const playBtn = document.getElementById('btnPlayUserVoice');
          if (playBtn) playBtn.disabled = false;
          stream.getTracks().forEach(t => t.stop());
        };
        mediaRecorderInstance.start();
      }
    } catch (err) {
      console.warn("MediaRecorder could not start audio recording:", err);
    }

    if (SpeechRecognition) {
      try {
        const recognition = new SpeechRecognition();
        recognitionInstance = recognition;
        recognition.lang = 'kn-IN';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
          isRecordingSpeech = true;
          if (visualizer) visualizer.classList.add('recording');
          if (micLabel) micLabel.textContent = "ನಿಲ್ಲಿಸಿ (Stop)";
          if (statusText) statusText.textContent = "ಮಾತನಾಡಿ... Listening to your Kannada pronunciation!";
          playAudioChime(720, 'sine', 0.1);
        };

        recognition.onresult = async (event) => {
          const spoken = (event.results && event.results[0] && event.results[0][0] && event.results[0][0].transcript ? event.results[0][0].transcript.trim() : '');
          handleSpeechResult(spoken);
        };

        recognition.onerror = () => {
          stopSpeechCapture();
          if (statusText) statusText.textContent = "Could not capture voice clearly. Try again closer to the mic!";
        };

        recognition.onend = () => {
          stopSpeechCapture();
        };

        recognition.start();
      } catch (e) {
        stopSpeechCapture();
        if (statusText) statusText.textContent = "Microphone error. Please allow mic permissions!";
      }
    } else {
      isRecordingSpeech = true;
      if (visualizer) visualizer.classList.add('recording');
      if (micLabel) micLabel.textContent = "ನಿಲ್ಲಿಸಿ (Stop)";
      if (statusText) statusText.textContent = "Recording your voice... Tap stop when finished.";
      setTimeout(() => {
        stopSpeechCapture();
        if (activePracticePhrase) handleSpeechResult(activePracticePhrase.pronunciation || activePracticePhrase.kannada);
      }, 3500);
    }
  }

  function stopSpeechCapture() {
    isRecordingSpeech = false;
    const visualizer = document.getElementById('practiceVisualizerWrap');
    const micLabel = document.getElementById('micBtnLabel');

    if (visualizer) visualizer.classList.remove('recording');
    if (micLabel) micLabel.textContent = "ಮಾತನಾಡಿ (Tap to Speak)";

    if (recognitionInstance) {
      try { recognitionInstance.stop(); } catch (e) {}
    }

    if (mediaRecorderInstance && mediaRecorderInstance.state !== 'inactive') {
      try { mediaRecorderInstance.stop(); } catch (e) {}
    }
  }

  async function handleSpeechResult(spokenTranscript) {
    if (!activePracticePhrase) return;

    const transcriptBox = document.getElementById('practiceTranscriptBox');
    const spokenEl = document.getElementById('transcriptSpokenText');
    const scoreBadge = document.getElementById('accuracyScoreBadge');
    const breakdownEl = document.getElementById('transcriptBreakdown');
    const evalMsgEl = document.getElementById('practiceEvaluationMsg');
    const statusText = document.getElementById('practiceStatusText');

    const cleanSpoken = (spokenTranscript && spokenTranscript !== 'undefined') ? spokenTranscript.trim() : (activePracticePhrase.pronunciation || 'Speech recorded');

    if (statusText) statusText.textContent = "Speech captured successfully!";
    if (transcriptBox) transcriptBox.style.display = 'block';
    if (spokenEl) spokenEl.textContent = `"${cleanSpoken}"`;

    let score = 0;
    let feedback = "";
    let rating = "good";

    if (isBackendActive) {
      try {
        const res = await fetch('/api/practice/evaluate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            spoken: cleanSpoken,
            target_kannada: activePracticePhrase.kannada,
            target_pronounce: activePracticePhrase.pronunciation
          })
        });
        if (res.ok) {
          const evalData = await res.json();
          score = evalData.score;
          feedback = evalData.feedback;
          rating = evalData.rating;
        }
      } catch (err) {}
    }

    if (!score) {
      score = calculateMatchScore(cleanSpoken, activePracticePhrase.kannada, activePracticePhrase.pronunciation);
      if (score >= 90) {
        rating = "excellent";
        feedback = "ಸಕ್ಕತ್! ಅತ್ಯುತ್ತಮ ಉಚ್ಚಾರಣೆ! (Sakkath! Superb native pronunciation!)";
      } else if (score >= 70) {
        rating = "good";
        feedback = "ತುಂಬಾ ಚೆನ್ನಾಗಿದೆ! ಉತ್ತಮ ಪ್ರಯತ್ನ! (Very good effort! Almost native!)";
      } else {
        rating = "practice";
        feedback = "ಉತ್ತಮ ಪ್ರಯತ್ನ! ನಿಧಾನವಾಗಿ ಮತ್ತೊಮ್ಮೆ ಪ್ರಯತ್ನಿಸಿ (Good try! Try speaking once more slowly.)";
      }
    }

    if (scoreBadge) {
      scoreBadge.className = `accuracy-badge ${rating}`;
      scoreBadge.textContent = `${score}% Match`;
    }

    if (evalMsgEl) evalMsgEl.textContent = feedback;

    if (breakdownEl) {
      breakdownEl.innerHTML = '';
      const targetWords = (activePracticePhrase.kannada || activePracticePhrase.pronunciation || '').split(/\s+/).filter(Boolean);
      const spokenWords = cleanSpoken.split(/\s+/).filter(Boolean);

      targetWords.forEach(tw => {
        const isMatched = spokenWords.some(sw => sw.includes(tw) || tw.includes(sw));
        const chip = document.createElement('span');
        chip.className = `syllable-chip ${isMatched ? 'matched' : 'missed'}`;
        chip.innerHTML = `${tw} ${isMatched ? '<i class="fa-solid fa-check"></i>' : '<i class="fa-solid fa-repeat"></i>'}`;
        breakdownEl.appendChild(chip);
      });
    }

    if (score >= 70) {
      playAudioChime(880, 'sine', 0.2);
      savePracticeStats(20);
    } else {
      playAudioChime(480, 'sine', 0.15);
      savePracticeStats(10);
    }
  }

    if (scoreBadge) {
      scoreBadge.className = `accuracy-badge ${rating}`;
      scoreBadge.textContent = `${score}% Match`;
    }

    if (evalMsgEl) evalMsgEl.textContent = feedback;

    if (breakdownEl) {
      breakdownEl.innerHTML = '';
      const targetWords = activePracticePhrase.kannada.split(/\s+/);
      const spokenWords = spokenTranscript.split(/\s+/);

      targetWords.forEach(tw => {
        const isMatched = spokenWords.some(sw => sw.includes(tw) || tw.includes(sw));
        const chip = document.createElement('span');
        chip.className = `syllable-chip ${isMatched ? 'matched' : 'missed'}`;
        chip.innerHTML = `${tw} ${isMatched ? '<i class="fa-solid fa-check"></i>' : '<i class="fa-solid fa-repeat"></i>'}`;
        breakdownEl.appendChild(chip);
      });
    }

    if (score >= 70) {
      playAudioChime(880, 'sine', 0.2);
      savePracticeStats(20);
    } else {
      playAudioChime(480, 'sine', 0.15);
      savePracticeStats(10);
    }
  }

  function renderPracticeQuickGrid() {
    const grid = document.getElementById('practiceQuickGrid');
    if (!grid || !appData || !appData.phrases) return;

    const challengeIds = ['tr_1', 'tr_2', 'fd_1', 'fd_2', 'sh_1', 'qh_1'];
    const challenges = appData.phrases.filter(p => challengeIds.includes(p.id));
    const list = challenges.length >= 4 ? challenges : appData.phrases.slice(0, 6);

    grid.innerHTML = '';
    list.forEach(item => {
      const card = document.createElement('div');
      card.className = 'practice-challenge-card';
      card.innerHTML = `
        <div class="pcard-top">
          <span class="pcard-tag">${item.category || 'General'}</span>
          <i class="fa-solid fa-microphone-lines pcard-mic-icon"></i>
        </div>
        <div class="pcard-kannada">${item.kannada}</div>
        <div class="pcard-pronounce">${item.pronunciation}</div>
        <div class="pcard-english">${item.english}</div>
      `;

      card.addEventListener('click', () => {
        playAudioChime(640, 'triangle', 0.1);
        openPracticeForPhrase(item);
      });

      grid.appendChild(card);
    });
  }

  // ============================================================
  // MODULE: POCKET CHEAT SHEET EXPORT
  // ============================================================
  function setupPocketGuideExport() {
    const btn = document.getElementById('btnExportGuide');
    if (!btn) return;

    btn.addEventListener('click', () => {
      window.print();
    });
  }

  // --- Modals ---
  function setupModals() {
    document.querySelectorAll('.modal-close-btn, .modal-overlay').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target === el) closeModals();
      });
    });
  }

  function closeModals() {
    document.querySelectorAll('.modal-overlay').forEach(modal => modal.classList.remove('active'));
  }

  function openDriverCardModal(phrase) {
    const modal = document.getElementById('driverCardModal');
    const kannadaEl = document.getElementById('driverCardKannada');
    const pronounceEl = document.getElementById('driverCardPronounce');
    const englishEl = document.getElementById('driverCardEnglish');
    const audioBtn = document.getElementById('driverCardAudioBtn');

    if (kannadaEl) kannadaEl.textContent = phrase.kannada;
    if (pronounceEl) pronounceEl.textContent = phrase.pronunciation;
    if (englishEl) englishEl.textContent = phrase.english;

    if (audioBtn) {
      audioBtn.onclick = () => playSpeechAudio(phrase.kannada, 0.9, audioBtn, phrase.pronunciation);
    }
    if (modal) modal.classList.add('active');
  }

  function openFavoritesModal() {
    renderFavoritesModalContent();
    const modal = document.getElementById('favoritesModal');
    if (modal) modal.classList.add('active');
  }

  function renderFavoritesModalContent() {
    const container = document.getElementById('favoritesModalList');
    if (!container || !appData) return;

    const savedPhrases = appData.phrases.filter(p => bookmarkedIds.has(p.id));

    if (savedPhrases.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 40px 10px; color: var(--text-muted);">
          <i class="fa-regular fa-heart" style="font-size: 2.5rem; color: var(--text-dim); margin-bottom: 12px;"></i>
          <h4 style="font-size: 1.1rem; color: #ffffff; margin-bottom: 6px;">No saved phrases yet</h4>
          <p style="font-size: 0.88rem;">Tap the heart icon on any phrase card to save it for quick offline recall.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = '';
    savedPhrases.forEach(p => {
      const item = document.createElement('div');
      item.style.cssText = 'background: rgba(255,255,255,0.04); border: 1px solid var(--border-subtle); border-radius: 12px; padding: 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px;';
      item.innerHTML = `
        <div style="flex: 1;">
          <div style="font-family: var(--font-kannada); font-size: 1.15rem; font-weight: 700; color: #ffffff;">${p.kannada}</div>
          <div style="font-size: 0.82rem; color: var(--accent-gold-light); font-weight: 600;">${p.pronunciation}</div>
          <div style="font-size: 0.84rem; color: var(--text-muted);">${p.english}</div>
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          <button class="icon-btn-ghost" title="Play audio" data-kannada="${p.kannada}">
            <i class="fa-solid fa-volume-high"></i>
          </button>
          <button class="icon-btn-ghost" title="Remove" data-remove="${p.id}" style="color: #ef4444;">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      `;

      item.querySelector('[data-kannada]').addEventListener('click', (e) => {
        playSpeechAudio(p.kannada, 1.0, e.currentTarget, p.pronunciation);
      });

      item.querySelector('[data-remove]').addEventListener('click', () => {
        bookmarkedIds.delete(p.id);
        saveBookmarksToStorage();
        renderFavoritesModalContent();
        renderPhrases();
      });

      container.appendChild(item);
    });
  }

  // --- PWA Service Worker ---
  function registerPWA() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js')
          .then(() => showOfflineToast())
          .catch(() => {});
      });
    }
  }

  function showOfflineToast() {
    const toast = document.createElement('div');
    toast.className = 'offline-toast';
    toast.innerHTML = `<i class="fa-solid fa-shield-halved"></i> <span>NammaBhasha ready for 100% offline use</span>`;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.5s ease';
      setTimeout(() => toast.remove(), 500);
    }, 4000);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
