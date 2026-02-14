/* ============================================
   Chat Log Viewer - Main Application
   ============================================ */

(function () {
  'use strict';

  // ---------- Constants ----------
  const DB_NAME = 'ChatLogViewerDB';
  const DB_VERSION = 1;
  const STORE_NAME = 'files';
  const SCROLL_POS_PREFIX = 'scrollPos_';

  // ---------- DOM Elements ----------
  const fileListScreen = document.getElementById('file-list-screen');
  const viewerScreen = document.getElementById('viewer-screen');
  const fileCardsContainer = document.getElementById('file-cards-container');
  const emptyState = document.getElementById('empty-state');
  const addFileBtn = document.getElementById('add-file-btn');
  const fileInput = document.getElementById('file-input');
  const searchInput = document.getElementById('search-input');
  const backBtn = document.getElementById('back-btn');
  const viewerTitle = document.getElementById('viewer-title');
  const conversationContainer = document.getElementById('conversation-container');
  const tocBtn = document.getElementById('toc-btn');
  const tocPanel = document.getElementById('toc-panel');
  const tocOverlay = document.getElementById('toc-overlay');
  const tocCloseBtn = document.getElementById('toc-close-btn');
  const tocList = document.getElementById('toc-list');
  const scrollTopBtn = document.getElementById('scroll-top-btn');
  const deleteDialogOverlay = document.getElementById('delete-dialog-overlay');
  const deleteCancelBtn = document.getElementById('delete-cancel-btn');
  const deleteConfirmBtn = document.getElementById('delete-confirm-btn');

  // ---------- State ----------
  let db = null;
  let allFiles = [];
  let currentFileId = null;
  let pendingDeleteId = null;

  // ---------- Initialize ----------
  async function init() {
    configureMerked();
    db = await openDB();
    await loadFileList();
    bindEvents();
    registerServiceWorker();
  }

  function configureMerked() {
    if (typeof marked !== 'undefined') {
      marked.setOptions({
        breaks: true,
        gfm: true,
      });
    }
  }

  // ---------- IndexedDB ----------
  function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('name', 'name', { unique: false });
          store.createIndex('addedAt', 'addedAt', { unique: false });
        }
      };
    });
  }

  function dbTransaction(mode) {
    const tx = db.transaction(STORE_NAME, mode);
    return tx.objectStore(STORE_NAME);
  }

  function dbGetAll() {
    return new Promise((resolve, reject) => {
      const request = dbTransaction('readonly').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function dbGet(id) {
    return new Promise((resolve, reject) => {
      const request = dbTransaction('readonly').get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function dbPut(item) {
    return new Promise((resolve, reject) => {
      const request = dbTransaction('readwrite').put(item);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function dbDelete(id) {
    return new Promise((resolve, reject) => {
      const request = dbTransaction('readwrite').delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // ---------- File Management ----------
  async function loadFileList() {
    allFiles = await dbGetAll();
    allFiles.sort((a, b) => b.addedAt - a.addedAt);
    renderFileList(allFiles);
  }

  function renderFileList(files) {
    fileCardsContainer.innerHTML = '';

    if (files.length === 0) {
      emptyState.classList.add('visible');
      fileCardsContainer.style.display = 'none';
      return;
    }

    emptyState.classList.remove('visible');
    fileCardsContainer.style.display = 'flex';

    files.forEach((file) => {
      const card = document.createElement('div');
      card.className = 'file-card';
      card.dataset.id = file.id;

      const date = new Date(file.addedAt);
      const dateStr = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
      const exchangeCount = countExchanges(file.content);
      const preview = getFirstQuestion(file.content);

      card.innerHTML = `
        <div class="file-card-top">
          <div class="file-card-info">
            <div class="file-card-title">${escapeHtml(file.name)}</div>
            <div class="file-card-meta">
              <span>📅 ${dateStr}</span>
              <span>💬 ${exchangeCount}件のやり取り</span>
            </div>
          </div>
          <button class="file-card-delete" data-id="${file.id}" aria-label="削除">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      `;

      // Click to open file
      card.addEventListener('click', (e) => {
        if (e.target.closest('.file-card-delete')) return;
        openFile(file.id);
      });

      // Delete button
      const deleteBtn = card.querySelector('.file-card-delete');
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showDeleteDialog(file.id);
      });

      fileCardsContainer.appendChild(card);
    });
  }

  function countExchanges(content) {
    const exchanges = parseConversation(content);
    return exchanges.length;
  }

  function getFirstQuestion(content) {
    const exchanges = parseConversation(content);
    if (exchanges.length > 0 && exchanges[0].question) {
      const text = exchanges[0].question.replace(/[#*_`]/g, '').trim();
      return text.substring(0, 50);
    }
    return '';
  }

  async function addFiles(fileList) {
    for (const file of fileList) {
      const content = await readFileContent(file);
      const name = file.name.replace(/\.(md|markdown|txt)$/i, '');
      const item = {
        id: generateId(),
        name: name,
        content: content,
        addedAt: Date.now(),
      };
      await dbPut(item);
    }
    await loadFileList();
  }

  function readFileContent(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  // ---------- Markdown Parser ----------
  function parseConversation(content) {
    // Split by --- (horizontal rule) that separates exchanges
    const rawExchanges = content.split(/\n---\n/);
    const exchanges = [];

    for (const raw of rawExchanges) {
      const trimmed = raw.trim();
      if (!trimmed) continue;

      const exchange = { question: '', answer: '' };

      // Try to split by "# gemini response" or "# assistant response" etc.
      // Pattern: starts with "# you asked" section, then "# ... response" section
      const responsePattern = /^(#\s+(?:gemini|assistant|ai|claude|gpt|chatgpt)\s+response)\s*$/im;
      const questionPattern = /^#\s+you\s+asked\s*$/im;

      const responseMatch = trimmed.match(responsePattern);

      if (responseMatch) {
        const responseSplitIndex = trimmed.indexOf(responseMatch[0]);
        let questionPart = trimmed.substring(0, responseSplitIndex).trim();
        let answerPart = trimmed.substring(responseSplitIndex + responseMatch[0].length).trim();

        // Remove "# you asked" header from question
        questionPart = questionPart.replace(questionPattern, '').trim();

        exchange.question = questionPart;
        exchange.answer = answerPart;
      } else if (questionPattern.test(trimmed)) {
        // Only question, no response
        let questionPart = trimmed.replace(questionPattern, '').trim();
        exchange.question = questionPart;
      } else {
        // Fallback: treat entire block as content
        exchange.answer = trimmed;
      }

      if (exchange.question || exchange.answer) {
        exchanges.push(exchange);
      }
    }

    return exchanges;
  }

  // ---------- Viewer ----------
  async function openFile(id) {
    const file = await dbGet(id);
    if (!file) return;

    currentFileId = id;
    viewerTitle.textContent = file.name;

    const exchanges = parseConversation(file.content);
    renderConversation(exchanges);
    buildTOC(exchanges);

    showScreen('viewer');

    // Restore scroll position
    const savedPos = localStorage.getItem(SCROLL_POS_PREFIX + id);
    if (savedPos) {
      requestAnimationFrame(() => {
        window.scrollTo(0, parseInt(savedPos, 10));
      });
    }
  }

  function renderConversation(exchanges) {
    conversationContainer.innerHTML = '';

    exchanges.forEach((exchange, index) => {
      const block = document.createElement('div');
      block.className = 'exchange-block';
      block.id = `exchange-${index}`;

      // Exchange number
      const numberDiv = document.createElement('div');
      numberDiv.className = 'exchange-number';
      numberDiv.innerHTML = `<span>${index + 1} / ${exchanges.length}</span>`;
      block.appendChild(numberDiv);

      // Question bubble
      if (exchange.question) {
        const questionBubble = document.createElement('div');
        questionBubble.className = 'question-bubble';

        const questionContent = document.createElement('div');
        questionContent.className = 'question-content';
        questionContent.innerHTML = renderMarkdown(exchange.question);

        questionBubble.appendChild(questionContent);
        block.appendChild(questionBubble);
      }

      // Answer bubble
      if (exchange.answer) {
        const answerBubble = document.createElement('div');
        answerBubble.className = 'answer-bubble';

        const answerWrapper = document.createElement('div');
        answerWrapper.className = 'answer-wrapper';

        // AI label
        const aiLabel = document.createElement('div');
        aiLabel.className = 'ai-label';
        aiLabel.textContent = '🤖 AI';
        answerWrapper.appendChild(aiLabel);

        const answerContent = document.createElement('div');
        answerContent.className = 'answer-content';
        answerContent.innerHTML = renderMarkdown(exchange.answer);

        answerWrapper.appendChild(answerContent);

        // Toggle button (for long answers)
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'toggle-btn';
        toggleBtn.textContent = '▼ 続きを読む';
        toggleBtn.addEventListener('click', () => {
          const isCollapsed = answerContent.classList.contains('collapsed');
          if (isCollapsed) {
            answerContent.classList.remove('collapsed');
            toggleBtn.textContent = '▲ 折りたたむ';
          } else {
            answerContent.classList.add('collapsed');
            toggleBtn.textContent = '▼ 続きを読む';
            // Scroll to the top of this exchange
            block.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        });
        answerWrapper.appendChild(toggleBtn);

        answerBubble.appendChild(answerWrapper);
        block.appendChild(answerBubble);

        // After render, check if content is tall enough to collapse
        requestAnimationFrame(() => {
          if (answerContent.scrollHeight > 250) {
            answerContent.classList.add('collapsed');
            toggleBtn.classList.add('visible');
          }
        });
      }

      conversationContainer.appendChild(block);
    });
  }

  function renderMarkdown(text) {
    if (typeof marked !== 'undefined') {
      return marked.parse(text);
    }
    // Fallback: basic rendering
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
  }

  // ---------- Table of Contents ----------
  function buildTOC(exchanges) {
    tocList.innerHTML = '';

    exchanges.forEach((exchange, index) => {
      const li = document.createElement('li');
      li.className = 'toc-item';

      const questionPreview = exchange.question
        ? exchange.question.replace(/[#*_`\[\]]/g, '').trim().substring(0, 60)
        : '(質問なし)';

      li.innerHTML = `
        <span class="toc-item-number">${index + 1}</span>
        <span class="toc-item-text">${escapeHtml(questionPreview)}${questionPreview.length >= 60 ? '...' : ''}</span>
      `;

      li.addEventListener('click', () => {
        closeTOC();
        const target = document.getElementById(`exchange-${index}`);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });

      tocList.appendChild(li);
    });
  }

  function openTOC() {
    tocPanel.classList.add('active');
    tocOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeTOC() {
    tocPanel.classList.remove('active');
    tocOverlay.classList.remove('active');
    document.body.style.overflow = '';
  }

  // ---------- Delete Dialog ----------
  function showDeleteDialog(id) {
    pendingDeleteId = id;
    deleteDialogOverlay.classList.add('active');
  }

  function hideDeleteDialog() {
    deleteDialogOverlay.classList.remove('active');
    pendingDeleteId = null;
  }

  async function confirmDelete() {
    if (pendingDeleteId) {
      await dbDelete(pendingDeleteId);
      localStorage.removeItem(SCROLL_POS_PREFIX + pendingDeleteId);
      await loadFileList();
    }
    hideDeleteDialog();
  }

  // ---------- Screen Navigation ----------
  function showScreen(name) {
    if (name === 'viewer') {
      fileListScreen.classList.remove('active');
      viewerScreen.classList.add('active');
      window.scrollTo(0, 0);
    } else {
      // Save scroll position before leaving viewer
      if (currentFileId) {
        localStorage.setItem(SCROLL_POS_PREFIX + currentFileId, window.scrollY.toString());
      }
      viewerScreen.classList.remove('active');
      fileListScreen.classList.add('active');
      currentFileId = null;
      window.scrollTo(0, 0);
    }
  }

  // ---------- Search ----------
  function filterFiles(query) {
    if (!query.trim()) {
      renderFileList(allFiles);
      return;
    }

    const q = query.toLowerCase();
    const filtered = allFiles.filter((file) => {
      return (
        file.name.toLowerCase().includes(q) ||
        file.content.toLowerCase().includes(q)
      );
    });
    renderFileList(filtered);
  }

  // ---------- Scroll Top Button ----------
  function handleScroll() {
    if (viewerScreen.classList.contains('active')) {
      if (window.scrollY > 400) {
        scrollTopBtn.classList.add('visible');
      } else {
        scrollTopBtn.classList.remove('visible');
      }
    }
  }

  // ---------- Utilities ----------
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ---------- Service Worker ----------
  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {
        // SW registration failed, app still works
      });
    }
  }

  // ---------- Event Bindings ----------
  function bindEvents() {
    // Add file
    addFileBtn.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async (e) => {
      if (e.target.files.length > 0) {
        await addFiles(e.target.files);
        fileInput.value = '';
      }
    });

    // Search
    searchInput.addEventListener('input', (e) => {
      filterFiles(e.target.value);
    });

    // Back button
    backBtn.addEventListener('click', () => showScreen('list'));

    // TOC
    tocBtn.addEventListener('click', openTOC);
    tocCloseBtn.addEventListener('click', closeTOC);
    tocOverlay.addEventListener('click', closeTOC);

    // Scroll top
    scrollTopBtn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    window.addEventListener('scroll', handleScroll, { passive: true });

    // Delete dialog
    deleteCancelBtn.addEventListener('click', hideDeleteDialog);
    deleteConfirmBtn.addEventListener('click', confirmDelete);
    deleteDialogOverlay.addEventListener('click', (e) => {
      if (e.target === deleteDialogOverlay) hideDeleteDialog();
    });

    // Handle back navigation (browser back button / swipe back)
    window.addEventListener('popstate', () => {
      if (viewerScreen.classList.contains('active')) {
        showScreen('list');
      }
    });

    // Push state when opening viewer
    const origOpenFile = openFile;
    // Override handled via pushState in openFile — already managed via showScreen
  }

  // Override openFile to handle history
  const originalOpenFile = openFile;

  // ---------- Init ----------
  document.addEventListener('DOMContentLoaded', init);
})();
