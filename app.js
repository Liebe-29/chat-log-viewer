/* ============================================
   Chat Log Viewer - Main Application (v2)
   フォルダ機能 + テーマ切り替え
   ============================================ */

(function () {
  'use strict';

  // ---------- Constants ----------
  const DB_NAME = 'ChatLogViewerDB';
  const DB_VERSION = 2;
  const STORE_NAME = 'files';
  const SCROLL_POS_PREFIX = 'scrollPos_';
  const THEME_KEY = 'chatlog_theme';
  const FOLDERS_KEY = 'chatlog_folders';

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

  // Settings
  const settingsBtn = document.getElementById('settings-btn');
  const settingsPanel = document.getElementById('settings-panel');
  const settingsOverlay = document.getElementById('settings-overlay');
  const settingsCloseBtn = document.getElementById('settings-close-btn');

  // Folder tabs
  const folderTabsContainer = document.getElementById('folder-tabs');

  // Folder management in settings
  const folderManageList = document.getElementById('folder-manage-list');
  const folderAddInput = document.getElementById('folder-add-input');
  const folderAddBtn = document.getElementById('folder-add-btn');

  // Folder assign dialog
  const folderAssignOverlay = document.getElementById('folder-assign-overlay');
  const folderAssignList = document.getElementById('folder-assign-list');
  const folderAssignCancel = document.getElementById('folder-assign-cancel');

  // ---------- State ----------
  let db = null;
  let allFiles = [];
  let currentFileId = null;
  let pendingDeleteId = null;
  let currentFolder = '__all__';
  let folders = [];
  let pendingAssignFileId = null;

  // ---------- Initialize ----------
  async function init() {
    configureMarked();
    loadTheme();
    loadFolders();
    db = await openDB();
    await loadFileList();
    renderFolderTabs();
    bindEvents();
    registerServiceWorker();
  }

  function configureMarked() {
    if (typeof marked !== 'undefined') {
      marked.setOptions({
        breaks: true,
        gfm: true,
      });
    }
  }

  // ---------- Theme ----------
  function loadTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    const theme = saved || 'lavender';
    applyTheme(theme);
  }

  function applyTheme(theme) {
    if (theme === 'lavender') {
      document.body.removeAttribute('data-theme');
    } else {
      document.body.setAttribute('data-theme', theme);
    }
    localStorage.setItem(THEME_KEY, theme);

    // Update active state in theme grid
    document.querySelectorAll('.theme-card').forEach((card) => {
      card.classList.toggle('active', card.dataset.theme === theme);
    });
  }

  // ---------- Folders ----------
  function loadFolders() {
    const saved = localStorage.getItem(FOLDERS_KEY);
    folders = saved ? JSON.parse(saved) : [];
  }

  function saveFolders() {
    localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
  }

  function addFolder(name) {
    const trimmed = name.trim();
    if (!trimmed) return false;
    if (folders.includes(trimmed)) return false;
    folders.push(trimmed);
    saveFolders();
    return true;
  }

  function removeFolder(name) {
    folders = folders.filter((f) => f !== name);
    saveFolders();
    // Remove folder assignment from all files with this folder
    allFiles.forEach(async (file) => {
      if (file.folder === name) {
        file.folder = '';
        await dbPut(file);
      }
    });
  }

  function renderFolderTabs() {
    folderTabsContainer.innerHTML = '';

    const allTab = createFolderTab('すべて', '__all__');
    const uncatTab = createFolderTab('未分類', '__uncategorized__');
    folderTabsContainer.appendChild(allTab);
    folderTabsContainer.appendChild(uncatTab);

    folders.forEach((name) => {
      folderTabsContainer.appendChild(createFolderTab(name, name));
    });
  }

  function createFolderTab(label, value) {
    const btn = document.createElement('button');
    btn.className = 'folder-tab' + (currentFolder === value ? ' active' : '');
    btn.dataset.folder = value;
    btn.textContent = label;
    btn.addEventListener('click', () => {
      currentFolder = value;
      document.querySelectorAll('.folder-tab').forEach((t) => t.classList.remove('active'));
      btn.classList.add('active');
      applyFilters();
    });
    return btn;
  }

  function renderFolderManageList() {
    folderManageList.innerHTML = '';

    if (folders.length === 0) {
      folderManageList.innerHTML = '<div class="folder-empty-msg">フォルダがまだありません</div>';
      return;
    }

    folders.forEach((name) => {
      const item = document.createElement('div');
      item.className = 'folder-manage-item';
      item.innerHTML = `
        <span class="folder-manage-item-name">📁 ${escapeHtml(name)}</span>
        <button class="folder-manage-delete" data-folder="${escapeHtml(name)}">削除</button>
      `;
      item.querySelector('.folder-manage-delete').addEventListener('click', () => {
        removeFolder(name);
        renderFolderManageList();
        renderFolderTabs();
        applyFilters();
      });
      folderManageList.appendChild(item);
    });
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
          store.createIndex('folder', 'folder', { unique: false });
        } else {
          // Migration: add folder index if not exists
          const tx = e.target.transaction;
          const store = tx.objectStore(STORE_NAME);
          if (!store.indexNames.contains('folder')) {
            store.createIndex('folder', 'folder', { unique: false });
          }
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
    // Ensure all files have a folder field
    allFiles.forEach((f) => {
      if (typeof f.folder === 'undefined') f.folder = '';
    });
    allFiles.sort((a, b) => b.addedAt - a.addedAt);
    applyFilters();
  }

  function applyFilters() {
    let filtered = allFiles;
    const query = searchInput.value.trim().toLowerCase();

    // Folder filter
    if (currentFolder === '__uncategorized__') {
      filtered = filtered.filter((f) => !f.folder);
    } else if (currentFolder !== '__all__') {
      filtered = filtered.filter((f) => f.folder === currentFolder);
    }

    // Search filter
    if (query) {
      filtered = filtered.filter((f) =>
        f.name.toLowerCase().includes(query) ||
        f.content.toLowerCase().includes(query)
      );
    }

    renderFileList(filtered);
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

      let folderLabel = '';
      if (file.folder) {
        folderLabel = `<div class="file-card-folder-label">📁 ${escapeHtml(file.folder)}</div>`;
      }

      card.innerHTML = `
        <div class="file-card-top">
          <div class="file-card-info">
            <div class="file-card-title">${escapeHtml(file.name)}</div>
            <div class="file-card-meta">
              <span>📅 ${dateStr}</span>
              <span>💬 ${exchangeCount}件のやり取り</span>
            </div>
            ${folderLabel}
          </div>
          <div class="file-card-actions">
            <button class="file-card-btn file-card-folder-btn" data-id="${file.id}" aria-label="フォルダ">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              </svg>
            </button>
            <button class="file-card-btn file-card-delete" data-id="${file.id}" aria-label="削除">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </div>
      `;

      // Click to open file
      card.addEventListener('click', (e) => {
        if (e.target.closest('.file-card-btn')) return;
        openFile(file.id);
      });

      // Folder button
      const folderBtn = card.querySelector('.file-card-folder-btn');
      folderBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showFolderAssignDialog(file.id);
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
        folder: '',
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

  // ---------- Folder Assign Dialog ----------
  function showFolderAssignDialog(fileId) {
    pendingAssignFileId = fileId;
    const file = allFiles.find((f) => f.id === fileId);
    if (!file) return;

    folderAssignList.innerHTML = '';

    // "Uncategorized" option
    const uncatItem = document.createElement('button');
    uncatItem.className = 'folder-assign-item' + (!file.folder ? ' active' : '');
    uncatItem.textContent = '未分類';
    uncatItem.addEventListener('click', () => assignFolder(fileId, ''));
    folderAssignList.appendChild(uncatItem);

    // Folder options
    folders.forEach((name) => {
      const item = document.createElement('button');
      item.className = 'folder-assign-item' + (file.folder === name ? ' active' : '');
      item.textContent = '📁 ' + name;
      item.addEventListener('click', () => assignFolder(fileId, name));
      folderAssignList.appendChild(item);
    });

    if (folders.length === 0) {
      const msg = document.createElement('div');
      msg.className = 'folder-empty-msg';
      msg.textContent = '設定からフォルダを作成してください';
      folderAssignList.appendChild(msg);
    }

    folderAssignOverlay.classList.add('active');
  }

  function hideFolderAssignDialog() {
    folderAssignOverlay.classList.remove('active');
    pendingAssignFileId = null;
  }

  async function assignFolder(fileId, folderName) {
    const file = allFiles.find((f) => f.id === fileId);
    if (file) {
      file.folder = folderName;
      await dbPut(file);
      applyFilters();
    }
    hideFolderAssignDialog();
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

  // ---------- Settings Panel ----------
  function openSettings() {
    renderFolderManageList();
    settingsPanel.classList.add('active');
    settingsOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeSettings() {
    settingsPanel.classList.remove('active');
    settingsOverlay.classList.remove('active');
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
      allFiles = allFiles.filter((f) => f.id !== pendingDeleteId);
      applyFilters();
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
    searchInput.addEventListener('input', () => {
      applyFilters();
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

    // Settings
    settingsBtn.addEventListener('click', openSettings);
    settingsCloseBtn.addEventListener('click', closeSettings);
    settingsOverlay.addEventListener('click', closeSettings);

    // Theme cards
    document.querySelectorAll('.theme-card').forEach((card) => {
      card.addEventListener('click', () => {
        applyTheme(card.dataset.theme);
      });
    });

    // Folder add
    folderAddBtn.addEventListener('click', () => {
      if (addFolder(folderAddInput.value)) {
        folderAddInput.value = '';
        renderFolderManageList();
        renderFolderTabs();
      }
    });

    folderAddInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        if (addFolder(folderAddInput.value)) {
          folderAddInput.value = '';
          renderFolderManageList();
          renderFolderTabs();
        }
      }
    });

    // Folder assign dialog
    folderAssignCancel.addEventListener('click', hideFolderAssignDialog);
    folderAssignOverlay.addEventListener('click', (e) => {
      if (e.target === folderAssignOverlay) hideFolderAssignDialog();
    });

    // Handle back navigation (browser back button / swipe back)
    window.addEventListener('popstate', () => {
      if (viewerScreen.classList.contains('active')) {
        showScreen('list');
      }
    });
  }

  // ---------- Init ----------
  document.addEventListener('DOMContentLoaded', init);
})();
