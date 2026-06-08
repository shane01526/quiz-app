// ===================== STATE =====================
const state = {
    questions: [],
    filteredQuestions: [],
    currentIndex: 0,
    userAnswers: {},   // { qid: [selected letters] }
    bookmarks: new Set(),
    notes: {},         // { qid: { memo: "..." } }
    stats: { answered: 0, correct: 0 },
    chatHistory: [],
    llmSettings: {
        provider: 'openai',
        apiKey: '',
        model: 'gpt-4o-mini',
        ollamaUrl: 'http://localhost:11434'
    }
};

// 各 provider 的常用 model 清單（最後一項固定為自訂）
const MODEL_OPTIONS = {
    openai: ['gpt-5.5', 'gpt-5', 'gpt-4o-mini', 'gpt-4o', 'gpt-4.1', 'gpt-4.1-mini', 'o4-mini'],
    anthropic: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest'],
    gemini: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
    ollama: ['llama3', 'llama3.1', 'qwen2.5', 'mistral']
};
const CUSTOM_MODEL = '自訂…';

// 依 provider 重建 model 下拉選單，並選回目前的 model
function populateModelOptions() {
    const provider = document.getElementById('llm-provider').value;
    const select = document.getElementById('llm-model');
    const current = state.llmSettings.model;
    const list = MODEL_OPTIONS[provider] || [];
    select.innerHTML = '';
    list.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        select.appendChild(opt);
    });
    const customOpt = document.createElement('option');
    customOpt.value = CUSTOM_MODEL;
    customOpt.textContent = CUSTOM_MODEL;
    select.appendChild(customOpt);

    if (current && list.includes(current)) {
        select.value = current;
    } else if (current) {
        select.value = CUSTOM_MODEL;
        document.getElementById('llm-model-custom').value = current;
    } else {
        select.value = list[0] || CUSTOM_MODEL;
    }
    toggleCustomModel();
}

// 選「自訂…」時才顯示文字輸入框
function toggleCustomModel() {
    const isCustom = document.getElementById('llm-model').value === CUSTOM_MODEL;
    document.getElementById('llm-model-custom-label').style.display = isCustom ? '' : 'none';
}

// 取得目前實際選定的 model 字串
function getSelectedModel() {
    const select = document.getElementById('llm-model');
    if (select.value === CUSTOM_MODEL) {
        return document.getElementById('llm-model-custom').value.trim();
    }
    return select.value;
}

// ===================== INIT =====================
document.addEventListener('DOMContentLoaded', async () => {
    await loadState();
    loadQuestions();
    setupEventListeners();
});

function loadQuestions() {
    if (typeof QUESTIONS_DATA !== 'undefined') {
        state.questions = QUESTIONS_DATA;
    } else {
        state.questions = [];
    }
    applyFilter();
    buildTopicFilter();
    renderGrid();
    renderQuestion();
    updateStats();
}

async function loadState() {
    // 1. Load from localStorage as fast cache
    try {
        const saved = localStorage.getItem('aws-saa-quiz-state');
        if (saved) {
            const data = JSON.parse(saved);
            state.userAnswers = data.userAnswers || {};
            state.bookmarks = new Set(data.bookmarks || []);
            state.currentIndex = data.currentIndex || 0;
            state.stats = data.stats || { answered: 0, correct: 0 };
        }
        const settings = localStorage.getItem('aws-saa-llm-settings');
        if (settings) {
            Object.assign(state.llmSettings, JSON.parse(settings));
            document.getElementById('llm-provider').value = state.llmSettings.provider;
            document.getElementById('llm-api-key').value = state.llmSettings.apiKey;
            document.getElementById('ollama-url').value = state.llmSettings.ollamaUrl;
            toggleOllamaUrl();
        }
        populateModelOptions();
    } catch (e) {
        console.warn('Failed to load localStorage:', e);
    }

    // 2. Load from server (authoritative for notes & state)
    try {
        const [notesRes, stateRes] = await Promise.all([
            fetch('/api/notes').then(r => r.ok ? r.json() : null).catch(() => null),
            fetch('/api/state').then(r => r.ok ? r.json() : null).catch(() => null)
        ]);
        if (notesRes && Object.keys(notesRes).length) {
            state.notes = notesRes;
        }
        if (stateRes && Object.keys(stateRes).length) {
            state.userAnswers = stateRes.userAnswers || state.userAnswers;
            state.bookmarks = new Set(stateRes.bookmarks || [...state.bookmarks]);
            state.currentIndex = stateRes.currentIndex ?? state.currentIndex;
            state.stats = stateRes.stats || state.stats;
        }
    } catch (e) {
        console.warn('Server not available, using localStorage only:', e);
    }

    recalcStats();
}

let _saveTimer = null;

function saveState() {
    const stateData = {
        userAnswers: state.userAnswers,
        bookmarks: [...state.bookmarks],
        currentIndex: state.currentIndex,
        stats: state.stats
    };

    // Always write to localStorage immediately
    try {
        localStorage.setItem('aws-saa-quiz-state', JSON.stringify(stateData));
    } catch (e) {
        console.warn('Failed to save localStorage:', e);
    }

    // Debounce server writes (300ms)
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
        fetch('/api/state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(stateData)
        }).catch(() => {});

        fetch('/api/notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state.notes)
        }).catch(() => {});
    }, 300);
}

function recalcStats() {
    let answered = 0, correct = 0;
    for (const [qid, ans] of Object.entries(state.userAnswers)) {
        answered++;
        const q = state.questions.find(q => q.id === parseInt(qid));
        if (q && arraysEqual(ans.sort(), q.answer.sort())) {
            correct++;
        }
    }
    state.stats = { answered, correct };
}

// ===================== FILTER =====================
function applyFilter() {
    const status = document.getElementById('filter-status').value;
    const topic = document.getElementById('filter-topic').value;

    state.filteredQuestions = state.questions.filter(q => {
        if (topic !== 'all' && q.topic !== topic) return false;
        const ans = state.userAnswers[q.id];
        switch (status) {
            case 'unanswered': return !ans;
            case 'correct': return ans && arraysEqual(ans.sort(), q.answer.sort());
            case 'wrong': return ans && !arraysEqual(ans.sort(), q.answer.sort());
            case 'bookmarked': return state.bookmarks.has(q.id);
            default: return true;
        }
    });

    document.getElementById('total-questions').textContent = state.filteredQuestions.length;

    if (state.currentIndex >= state.filteredQuestions.length) {
        state.currentIndex = 0;
    }
}

function buildTopicFilter() {
    const topics = [...new Set(state.questions.map(q => q.topic).filter(Boolean))];
    const sel = document.getElementById('filter-topic');
    sel.innerHTML = '<option value="all">全部 Topic</option>';
    topics.sort().forEach(t => {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t;
        sel.appendChild(opt);
    });
}

// ===================== RENDER =====================
function renderQuestion() {
    const q = state.filteredQuestions[state.currentIndex];
    if (!q) {
        document.getElementById('question-text').textContent = '沒有符合篩選條件的題目。';
        document.getElementById('options').innerHTML = '';
        document.getElementById('question-number').textContent = '--';
        document.getElementById('question-topic').textContent = '';
        return;
    }

    document.getElementById('question-number').textContent = `Question #${q.id}`;
    document.getElementById('question-topic').textContent = q.topic || '';
    document.getElementById('question-text').textContent = q.question;
    document.getElementById('question-jump').value = state.currentIndex + 1;

    const isMulti = q.answer.length > 1;
    const answered = state.userAnswers[q.id];
    const optionsEl = document.getElementById('options');
    optionsEl.innerHTML = '';

    q.options.forEach(opt => {
        const div = document.createElement('div');
        div.className = 'option' + (isMulti ? ' multi-mode' : '');

        if (answered) {
            if (answered.includes(opt.letter)) div.classList.add('selected');
            if (q.answer.includes(opt.letter)) div.classList.add('correct');
            if (answered.includes(opt.letter) && !q.answer.includes(opt.letter)) {
                div.classList.add('wrong');
            }
        }

        div.innerHTML = `<span class="option-letter">${opt.letter}.</span><span class="option-text">${escapeHtml(opt.text)}</span>`;

        if (!answered) {
            div.addEventListener('click', () => toggleOption(q, opt.letter, isMulti));
        }

        optionsEl.appendChild(div);
    });

    // Bookmark
    const bmBtn = document.getElementById('bookmark-btn');
    bmBtn.textContent = state.bookmarks.has(q.id) ? '★' : '☆';
    bmBtn.className = 'bookmark-btn' + (state.bookmarks.has(q.id) ? ' active' : '');

    // Result area
    const resultArea = document.getElementById('result-area');
    const btnSubmit = document.getElementById('btn-submit');
    const btnExplain = document.getElementById('btn-explain');

    if (answered) {
        const isCorrect = arraysEqual(answered.sort(), q.answer.sort());
        resultArea.style.display = 'block';
        resultArea.className = 'result-area ' + (isCorrect ? 'correct' : 'wrong');
        document.getElementById('result-text').innerHTML = isCorrect
            ? `✅ 正確！答案是 <strong>${q.answer.join(', ')}</strong>`
            : `❌ 錯誤。你的答案: <strong>${answered.join(', ')}</strong>，正確答案: <strong>${q.answer.join(', ')}</strong>`;
        btnSubmit.style.display = 'none';
        btnExplain.style.display = 'inline-block';
    } else {
        resultArea.style.display = 'none';
        btnSubmit.style.display = 'inline-block';
        btnSubmit.disabled = true;
        btnExplain.style.display = 'none';
    }

    // Multi-select hint
    if (isMulti && !answered) {
        const hint = document.createElement('div');
        hint.style.cssText = 'font-size:0.85rem;color:#666;margin-bottom:8px;';
        hint.textContent = `（此題需選擇 ${q.answer.length} 個答案）`;
        optionsEl.prepend(hint);
    }

    // Note button state
    const noteBtn = document.getElementById('btn-add-note');
    if (state.notes[q.id]) {
        noteBtn.textContent = '✅ 已加入筆記';
        noteBtn.classList.add('in-notes');
    } else {
        noteBtn.textContent = '📝 加入筆記';
        noteBtn.classList.remove('in-notes');
    }

    // Chat context hint
    const contextHint = document.getElementById('chat-context-hint');
    contextHint.textContent = `📌 目前在 Question #${q.id}`;
    contextHint.classList.add('visible');

    renderGrid();
}

let tempSelections = [];

function toggleOption(q, letter, isMulti) {
    if (isMulti) {
        const idx = tempSelections.indexOf(letter);
        if (idx > -1) tempSelections.splice(idx, 1);
        else tempSelections.push(letter);
    } else {
        tempSelections = [letter];
    }

    // Update visual
    document.querySelectorAll('.option').forEach(el => {
        const optLetter = el.querySelector('.option-letter').textContent.replace('.', '');
        el.classList.toggle('selected', tempSelections.includes(optLetter));
    });

    document.getElementById('btn-submit').disabled = tempSelections.length === 0;
}

function submitAnswer() {
    const q = state.filteredQuestions[state.currentIndex];
    if (!q || tempSelections.length === 0) return;

    state.userAnswers[q.id] = [...tempSelections];
    tempSelections = [];
    recalcStats();
    saveState();
    updateStats();
    renderQuestion();
}

// ===================== CLEAR ANSWER ON LEAVE =====================
function clearCurrentAnswer() {
    const q = state.filteredQuestions[state.currentIndex];
    if (q && state.userAnswers[q.id]) {
        delete state.userAnswers[q.id];
        recalcStats();
        updateStats();
        saveState();
    }
}

// ===================== GRID =====================
function renderGrid() {
    const grid = document.getElementById('question-grid');
    grid.innerHTML = '';

    state.filteredQuestions.forEach((q, i) => {
        const cell = document.createElement('div');
        cell.className = 'grid-cell';
        cell.textContent = q.id;

        if (i === state.currentIndex) cell.classList.add('current');

        const ans = state.userAnswers[q.id];
        if (ans) {
            const isCorrect = arraysEqual(ans.sort(), q.answer.sort());
            cell.classList.add(isCorrect ? 'answered-correct' : 'answered-wrong');
        }

        cell.addEventListener('click', () => {
            clearCurrentAnswer();
            state.currentIndex = i;
            tempSelections = [];
            renderQuestion();
            saveState();
        });

        grid.appendChild(cell);
    });
}

// ===================== STATS =====================
function updateStats() {
    document.getElementById('stat-answered').textContent = `已答: ${state.stats.answered}`;
    document.getElementById('stat-correct').textContent = `正確: ${state.stats.correct}`;
    const rate = state.stats.answered > 0
        ? Math.round(state.stats.correct / state.stats.answered * 100) + '%'
        : '--';
    document.getElementById('stat-accuracy').textContent = `正確率: ${rate}`;
}

// ===================== CHAT / LLM =====================
async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const msg = input.value.trim();
    if (!msg) return;

    const q = state.filteredQuestions[state.currentIndex];
    addChatMessage('user', msg);
    input.value = '';

    // Build context
    let context = '';
    if (q) {
        context = `目前的題目：\nQuestion #${q.id}: ${q.question}\n`;
        q.options.forEach(o => { context += `${o.letter}. ${o.text}\n`; });
        context += `正確答案: ${q.answer.join(', ')}\n`;
        const ans = state.userAnswers[q.id];
        if (ans) context += `使用者作答: ${ans.join(', ')}\n`;
    }

    const systemPrompt = `你是一位 AWS Solutions Architect Associate (SAA-C03) 考試的專業助教。
請用繁體中文回答，但保留 AWS 服務名稱的英文。
回答時請：
1. 解釋為什麼正確答案是對的
2. 解釋為什麼其他選項是錯的
3. 提供相關的 AWS 概念補充
4. 如果適當，舉出實際應用場景

${context}`;

    const thinking = showThinkingBubble();
    try {
        const response = await callLLM(systemPrompt, msg);
        thinking.remove();
        addChatMessage('assistant', response);
    } catch (e) {
        thinking.remove();
        addChatMessage('assistant', `⚠️ 無法連接 LLM：${e.message}\n\n請在下方「API 設定」中設定你的 API Key 和模型。\n\n支援：OpenAI / Anthropic / Gemini / Ollama (本機)`);
    }
}

async function callLLM(systemPrompt, userMsg) {
    const { provider, apiKey, model, ollamaUrl } = state.llmSettings;

    const messages = [
        { role: 'system', content: systemPrompt },
        ...state.chatHistory.slice(-10).map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: userMsg }
    ];

    if (provider === 'ollama') {
        const res = await fetch(`${ollamaUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: model || 'llama3',
                messages,
                stream: false
            })
        });
        if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
        const data = await res.json();
        return data.message.content;
    }

    if (provider === 'gemini') {
        const geminiModel = model || 'gemini-2.0-flash';
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: systemPrompt }] },
                contents: [
                    ...state.chatHistory.slice(-10).map(m => ({
                        role: m.role === 'assistant' ? 'model' : 'user',
                        parts: [{ text: m.content }]
                    })),
                    { role: 'user', parts: [{ text: userMsg }] }
                ],
                generationConfig: { maxOutputTokens: 8192 }
            })
        });
        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Gemini error: ${res.status} - ${errText}`);
        }
        const data = await res.json();
        return data.candidates[0].content.parts[0].text;
    }

    if (provider === 'anthropic') {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
                model: model || 'claude-sonnet-4-20250514',
                max_tokens: 8192,
                system: systemPrompt,
                messages: [
                    ...state.chatHistory.slice(-10).map(m => ({
                        role: m.role,
                        content: m.content
                    })),
                    { role: 'user', content: userMsg }
                ]
            })
        });
        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Anthropic error: ${res.status} - ${errText}`);
        }
        const data = await res.json();
        return data.content[0].text;
    }

    // Default: OpenAI
    const openaiModel = model || 'gpt-4o-mini';
    // o 系列 (o1/o3/o4...) 與 gpt-5 系列不支援 max_tokens，需改用 max_completion_tokens
    const isReasoning = /^o\d/.test(openaiModel) || /^gpt-5/.test(openaiModel);
    const body = { model: openaiModel, messages };
    if (isReasoning) {
        body.max_completion_tokens = 8192;
    } else {
        body.max_tokens = 8192;
    }
    if (!apiKey) {
        throw new Error('尚未設定 OpenAI API Key，請到「API 設定」貼上 sk-... 並按儲存');
    }
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
    });
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`OpenAI error: ${res.status} - ${errText}`);
    }
    const data = await res.json();
    return data.choices[0].message.content;
}

function showThinkingBubble() {
    const container = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = 'chat-msg assistant thinking-bubble';
    div.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
}

function addChatMessage(role, content) {
    state.chatHistory.push({ role, content });

    const container = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = `chat-msg ${role}`;
    div.innerHTML = `<p>${formatChatContent(content)}</p>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function formatChatContent(text) {
    // Basic markdown-ish rendering
    return escapeHtml(text)
        .replace(/```([\s\S]*?)```/g, '<pre>$1</pre>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');
}

function requestExplanation() {
    const q = state.filteredQuestions[state.currentIndex];
    if (!q) return;

    // Open chat panel
    document.getElementById('app').classList.remove('no-chat');

    const userAns = state.userAnswers[q.id];
    const isCorrect = userAns && arraysEqual(userAns.sort(), q.answer.sort());

    let prompt = `請詳細解釋 Question #${q.id}`;
    if (isCorrect) {
        prompt += `\n我答對了 (${userAns.join(', ')})，但想更深入了解為什麼其他選項不對。`;
    } else {
        prompt += `\n我答錯了（我選了 ${userAns ? userAns.join(', ') : '未作答'}，正確答案是 ${q.answer.join(', ')}）。請解釋為什麼我的選擇是錯的，以及正確答案的原因。`;
    }

    document.getElementById('chat-input').value = prompt;
    sendChatMessage();
}

// ===================== EVENT LISTENERS =====================
function setupEventListeners() {
    document.getElementById('btn-prev').addEventListener('click', () => {
        if (state.currentIndex > 0) {
            clearCurrentAnswer();
            state.currentIndex--;
            tempSelections = [];
            renderQuestion();
            saveState();
        }
    });

    document.getElementById('btn-next').addEventListener('click', () => {
        if (state.currentIndex < state.filteredQuestions.length - 1) {
            clearCurrentAnswer();
            state.currentIndex++;
            tempSelections = [];
            renderQuestion();
            saveState();
        }
    });

    document.getElementById('btn-random').addEventListener('click', () => {
        if (state.filteredQuestions.length > 0) {
            clearCurrentAnswer();
            state.currentIndex = Math.floor(Math.random() * state.filteredQuestions.length);
            tempSelections = [];
            renderQuestion();
            saveState();
        }
    });

    document.getElementById('question-jump').addEventListener('change', (e) => {
        const val = parseInt(e.target.value);
        if (val >= 1 && val <= state.filteredQuestions.length) {
            clearCurrentAnswer();
            state.currentIndex = val - 1;
            tempSelections = [];
            renderQuestion();
            saveState();
        }
    });

    document.getElementById('btn-submit').addEventListener('click', submitAnswer);
    document.getElementById('btn-explain').addEventListener('click', requestExplanation);
    document.getElementById('btn-add-note').addEventListener('click', toggleNoteForCurrentQuestion);
    document.getElementById('btn-notes-page').addEventListener('click', showNotesPage);
    document.getElementById('btn-notes-back').addEventListener('click', hideNotesPage);

    document.getElementById('bookmark-btn').addEventListener('click', () => {
        const q = state.filteredQuestions[state.currentIndex];
        if (!q) return;
        if (state.bookmarks.has(q.id)) state.bookmarks.delete(q.id);
        else state.bookmarks.add(q.id);
        saveState();
        renderQuestion();
    });

    // Filters
    document.getElementById('filter-status').addEventListener('change', () => {
        applyFilter();
        state.currentIndex = 0;
        renderQuestion();
        renderGrid();
    });

    document.getElementById('filter-topic').addEventListener('change', () => {
        applyFilter();
        state.currentIndex = 0;
        renderQuestion();
        renderGrid();
    });

    // Chat toggle — show/hide the right panel
    const appEl = document.getElementById('app');
    // Start with chat hidden
    appEl.classList.add('no-chat');

    document.getElementById('chat-toggle').addEventListener('click', () => {
        appEl.classList.toggle('no-chat');
    });

    document.getElementById('chat-toggle-close').addEventListener('click', () => {
        appEl.classList.add('no-chat');
    });

    document.getElementById('chat-send').addEventListener('click', sendChatMessage);

    document.getElementById('chat-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendChatMessage();
        }
    });

    // LLM Settings
    document.getElementById('llm-provider').addEventListener('change', () => {
        toggleOllamaUrl();
        state.llmSettings.model = '';   // 切換 provider 時清掉舊 model，改用新 provider 的預設
        populateModelOptions();
    });
    document.getElementById('llm-model').addEventListener('change', toggleCustomModel);

    document.getElementById('save-settings').addEventListener('click', () => {
        state.llmSettings.provider = document.getElementById('llm-provider').value;
        state.llmSettings.apiKey = document.getElementById('llm-api-key').value;
        state.llmSettings.model = getSelectedModel();
        state.llmSettings.ollamaUrl = document.getElementById('ollama-url').value;
        localStorage.setItem('aws-saa-llm-settings', JSON.stringify(state.llmSettings));
        alert('設定已儲存！');
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        switch (e.key) {
            case 'ArrowLeft':
                document.getElementById('btn-prev').click();
                break;
            case 'ArrowRight':
                document.getElementById('btn-next').click();
                break;
            case 'Enter':
                if (!document.getElementById('btn-submit').disabled) {
                    submitAnswer();
                }
                break;
            case 'b':
                document.getElementById('bookmark-btn').click();
                break;
        }
    });
}

function toggleOllamaUrl() {
    const provider = document.getElementById('llm-provider').value;
    document.getElementById('ollama-url-label').style.display = provider === 'ollama' ? '' : 'none';
}

// ===================== NOTES =====================
function toggleNoteForCurrentQuestion() {
    const q = state.filteredQuestions[state.currentIndex];
    if (!q) return;

    if (state.notes[q.id]) {
        delete state.notes[q.id];
    } else {
        state.notes[q.id] = { memo: '' };
    }
    saveState();
    renderQuestion();
}

function showNotesPage() {
    // Hide quiz views, show notes page
    document.getElementById('question-area').style.display = 'none';
    document.querySelector('.controls').style.display = 'none';
    document.querySelector('.question-grid-wrapper').style.display = 'none';
    document.getElementById('notes-page').style.display = '';
    renderNotesPage();
}

function hideNotesPage() {
    document.getElementById('question-area').style.display = '';
    document.querySelector('.controls').style.display = '';
    document.querySelector('.question-grid-wrapper').style.display = '';
    document.getElementById('notes-page').style.display = 'none';
}

function renderNotesPage() {
    const noteIds = Object.keys(state.notes).map(Number).sort((a, b) => a - b);
    const list = document.getElementById('notes-list');
    const empty = document.getElementById('notes-empty');
    document.getElementById('notes-count').textContent = `${noteIds.length} 題`;

    if (noteIds.length === 0) {
        list.innerHTML = '';
        empty.style.display = '';
        return;
    }
    empty.style.display = 'none';

    list.innerHTML = noteIds.map(qid => {
        const q = state.questions.find(q => q.id === qid);
        if (!q) return '';
        const hasMemo = (state.notes[qid]?.memo || '').trim().length > 0;
        return `
        <div class="note-card-mini" data-qid="${qid}">
            <span class="note-mini-qid">#${qid}</span>
            <span class="note-mini-topic">${escapeHtml(q.topic || '—')}</span>
            ${hasMemo ? '<span class="note-mini-has-memo">✏️ 有筆記</span>' : ''}
        </div>`;
    }).join('');

    list.querySelectorAll('.note-card-mini').forEach(card => {
        card.addEventListener('click', () => {
            openNoteModal(parseInt(card.dataset.qid));
        });
    });
}

// ===================== NOTE MODAL =====================
function openNoteModal(qid) {
    const q = state.questions.find(q => q.id === qid);
    if (!q) return;

    const overlay = document.getElementById('note-modal-overlay');
    document.getElementById('note-modal-qid').textContent = `Question #${qid}`;
    document.getElementById('note-modal-topic').textContent = q.topic || '';
    document.getElementById('note-modal-question').textContent = q.question;

    // Options with correct answer highlighted
    const optsEl = document.getElementById('note-modal-options');
    optsEl.innerHTML = q.options.map(opt => {
        const isAns = q.answer.includes(opt.letter);
        return `<div class="modal-opt${isAns ? ' is-answer' : ''}">${opt.letter}. ${escapeHtml(opt.text)}</div>`;
    }).join('');

    document.getElementById('note-modal-answer').textContent = `正確答案：${q.answer.join(', ')}`;

    const textarea = document.getElementById('note-modal-textarea');
    textarea.value = state.notes[qid]?.memo || '';

    const saveBtn = document.getElementById('note-modal-save');
    const savedHint = document.getElementById('note-modal-saved-hint');
    savedHint.classList.remove('visible');
    savedHint.textContent = '';

    saveBtn.onclick = () => {
        if (state.notes[qid]) {
            state.notes[qid].memo = textarea.value;
            saveState();
            renderNotesPage();
            savedHint.textContent = '✅ 已儲存';
            savedHint.classList.add('visible');
            setTimeout(() => savedHint.classList.remove('visible'), 2000);
        }
    };

    // Footer buttons
    document.getElementById('note-modal-goto').onclick = () => {
        const idx = state.filteredQuestions.findIndex(q => q.id === qid);
        if (idx >= 0) {
            state.currentIndex = idx;
            tempSelections = [];
        }
        closeNoteModal();
        hideNotesPage();
        renderQuestion();
        saveState();
    };

    document.getElementById('note-modal-remove').onclick = () => {
        delete state.notes[qid];
        saveState();
        closeNoteModal();
        renderNotesPage();
        const currentQ = state.filteredQuestions[state.currentIndex];
        if (currentQ && currentQ.id === qid) renderQuestion();
    };

    overlay.style.display = 'flex';
}

function closeNoteModal() {
    document.getElementById('note-modal-overlay').style.display = 'none';
}

// Close modal on overlay click or close button
document.addEventListener('click', (e) => {
    if (e.target.id === 'note-modal-overlay') closeNoteModal();
});
document.addEventListener('DOMContentLoaded', () => {
    const closeBtn = document.getElementById('note-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', closeNoteModal);
});

// ===================== UTILS =====================
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function arraysEqual(a, b) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => v === b[i]);
}

// ===================== SPLIT PANE RESIZE =====================
(function initSplitResize() {
    const app = document.getElementById('app');
    const handle = document.getElementById('split-handle');
    const panel = document.getElementById('chat-panel');
    if (!handle || !panel) return;

    let isDragging = false;

    handle.addEventListener('mousedown', (e) => {
        isDragging = true;
        app.classList.add('dragging');
        handle.classList.add('dragging');
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const appRect = app.getBoundingClientRect();
        const chatWidth = Math.max(280, Math.min(appRect.width - 360, appRect.right - e.clientX));
        panel.style.flexBasis = chatWidth + 'px';
        localStorage.setItem('aws-saa-chat-width', chatWidth);
    });

    document.addEventListener('mouseup', () => {
        if (!isDragging) return;
        isDragging = false;
        app.classList.remove('dragging');
        handle.classList.remove('dragging');
    });

    // Restore saved width
    const saved = localStorage.getItem('aws-saa-chat-width');
    if (saved) {
        panel.style.flexBasis = saved + 'px';
    }
})();
