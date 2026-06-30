window.LeHu = window.LeHu || {};

(function() {
  'use strict';

  const LeHu = window.LeHu;

  // ===================== Modal System =====================
  class Modal {
    constructor() {
      this._initialized = false;
    }

    _ensureInit() {
      if (this._initialized) return;
      this._initialized = true;
      if (document.getElementById('leh-modal-overlay')) return;

      const overlay = document.createElement('div');
      overlay.id = 'leh-modal-overlay';
      overlay.className = 'leh-modal-overlay hidden';

      const dialog = document.createElement('div');
      dialog.id = 'leh-modal';
      dialog.className = 'leh-modal hidden';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');

      overlay.addEventListener('click', () => {
        if (this._currentResolver) {
          this._currentResolver(null);
          this._close();
        }
      });

      document.body.appendChild(overlay);
      document.body.appendChild(dialog);
    }

    _close() {
      const overlay = document.getElementById('leh-modal-overlay');
      const dialog = document.getElementById('leh-modal');
      if (overlay) overlay.classList.add('hidden');
      if (dialog) {
        dialog.classList.add('hidden');
        dialog.innerHTML = '';
      }
      this._currentResolver = null;
    }

    alert(message) {
      return this._show(message, { type: 'alert' });
    }

    confirm(message) {
      return this._show(message, { type: 'confirm' });
    }

    prompt(message, defaultValue) {
      return this._show(message, { type: 'prompt', defaultValue });
    }

    _show(message, options) {
      this._ensureInit();
      return new Promise((resolve) => {
        this._currentResolver = resolve;
        const overlay = document.getElementById('leh-modal-overlay');
        const dialog = document.getElementById('leh-modal');
        overlay.classList.remove('hidden');
        dialog.classList.remove('hidden');

        const msg = document.createElement('p');
        msg.className = 'leh-modal-message';
        msg.textContent = message;
        dialog.appendChild(msg);

        let inputEl = null;
        if (options.type === 'prompt') {
          inputEl = document.createElement('input');
          inputEl.type = 'text';
          inputEl.className = 'leh-modal-input';
          inputEl.value = options.defaultValue || '';
          dialog.appendChild(inputEl);
          setTimeout(() => inputEl.focus(), 50);
        }

        const btns = document.createElement('div');
        btns.className = 'leh-modal-buttons';

        const close = (result) => {
          this._close();
          resolve(result);
        };

        if (options.type === 'alert') {
          const ok = document.createElement('button');
          ok.textContent = chrome.i18n.getMessage('modal_ok') || 'OK';
          ok.className = 'leh-modal-btn leh-modal-btn-primary';
          ok.addEventListener('click', () => close(true));
          btns.appendChild(ok);
        } else if (options.type === 'confirm') {
          const cancel = document.createElement('button');
          cancel.textContent = chrome.i18n.getMessage('modal_cancel') || 'Cancel';
          cancel.className = 'leh-modal-btn';
          cancel.addEventListener('click', () => close(false));
          btns.appendChild(cancel);

          const ok = document.createElement('button');
          ok.textContent = chrome.i18n.getMessage('modal_ok') || 'OK';
          ok.className = 'leh-modal-btn leh-modal-btn-primary';
          ok.addEventListener('click', () => close(true));
          btns.appendChild(ok);
        } else if (options.type === 'prompt') {
          const cancel = document.createElement('button');
          cancel.textContent = chrome.i18n.getMessage('modal_cancel') || 'Cancel';
          cancel.className = 'leh-modal-btn';
          cancel.addEventListener('click', () => close(null));
          btns.appendChild(cancel);

          const ok = document.createElement('button');
          ok.textContent = chrome.i18n.getMessage('modal_ok') || 'OK';
          ok.className = 'leh-modal-btn leh-modal-btn-primary';
          ok.addEventListener('click', () => close(inputEl ? inputEl.value : null));
          btns.appendChild(ok);

          if (inputEl) {
            inputEl.addEventListener('keydown', (e) => {
              if (e.key === 'Enter') close(inputEl.value);
              if (e.key === 'Escape') close(null);
            });
          }
        }

        dialog.appendChild(btns);
      });
    }
  }

  LeHu.Modal = new Modal();

  // ===================== I18n =====================
  LeHu.getMessageSync = function(key) {
    return chrome.i18n.getMessage(key) || key;
  };

  LeHu.applyI18n = function() {
    document.querySelectorAll('[data-i18n],[data-i18n-placeholder],[data-i18n-aria-label],[data-i18n-title]').forEach(function(el) {
      let key = el.getAttribute('data-i18n');
      let msg;
      if (key) { msg = chrome.i18n.getMessage(key); if (msg) el.textContent = msg; }
      key = el.getAttribute('data-i18n-placeholder');
      if (key) { msg = chrome.i18n.getMessage(key); if (msg) el.placeholder = msg; }
      key = el.getAttribute('data-i18n-aria-label');
      if (key) { msg = chrome.i18n.getMessage(key); if (msg) el.setAttribute('aria-label', msg); }
      key = el.getAttribute('data-i18n-title');
      if (key) { msg = chrome.i18n.getMessage(key); if (msg) el.title = msg; }
    });
  };

  // ===================== Storage =====================
  const LIMITS = {
    SYNC_MAX_ITEMS: 100,
    LOCAL_MAX_ITEMS: 500,
    SYNC_CATEGORY_SIZE: 80
  };
  LeHu.LIMITS = LIMITS;

  let _bookmarkTreeCache = null;
  let _bookmarkTreeCacheTime = 0;

  LeHu.bookmarksToNavigation = async function() {
    const now = Date.now();
    let roots;
    if (_bookmarkTreeCache && now - _bookmarkTreeCacheTime < 2000) {
      roots = _bookmarkTreeCache;
    } else {
      roots = await chrome.bookmarks.getTree();
      _bookmarkTreeCache = roots;
      _bookmarkTreeCacheTime = now;
    }
    const navigation = {};
    const categoryOrder = [];

    function addLink(url, title, bid, category) {
      if (!url) return;
      if (!navigation[category]) {
        navigation[category] = [];
        if (categoryOrder.indexOf(category) === -1) categoryOrder.push(category);
      }
      const exists = navigation[category].some(function(l) { return l.url === url; });
      if (!exists) {
        navigation[category].push({ name: title || '', url: url, icon: '', desc: '', _bid: bid });
      }
    }

    function flattenChildren(children, target) {
      if (!children) return;
      children.forEach(function(n) {
        if (n.url) { addLink(n.url, n.title, n.id, target); }
        else if (n.children) { flattenChildren(n.children, target); }
      });
    }

    function processChildren(children, defaultCategory) {
      if (!children) return;
      children.forEach(function(n) {
        if (n.url) {
          addLink(n.url, n.title, n.id, defaultCategory);
        } else if (n.children) {
          const name = n.title || chrome.i18n.getMessage('uncategorized') || '未分类';
          n.children.forEach(function(c) {
            if (c.url) { addLink(c.url, c.title, c.id, name); }
            else if (c.children) { flattenChildren(c.children, name); }
          });
        }
      });
    }

    if (roots && roots[0] && roots[0].children) {
      roots[0].children.forEach(function(root) {
        if (root.id !== '1' && root.id !== '2') return;
        processChildren(root.children, root.title || '');
      });
    }

    return { navigation: navigation, categoryOrder: categoryOrder };
  };

  LeHu.getStorageAPI = function(storageType) {
    return storageType === 'local' ? chrome.storage.local : chrome.storage.sync;
  };

  LeHu.getStorageType = async function() {
    const result = await chrome.storage.local.get({ storageType: 'sync' });
    return result.storageType || 'sync';
  };


  LeHu.loadData = async function() {
    return await LeHu.loadDataFrom(await LeHu.getStorageType());
  };

  function ensureConsistency(data) {
    if (!data.navigation) return;
    if (!data.categoryOrder) data.categoryOrder = [];
    let fixed = false;
    Object.keys(data.navigation).forEach(function(c) {
      if (data.categoryOrder.indexOf(c) === -1) {
        data.categoryOrder.push(c);
        fixed = true;
      }
    });
    return fixed;
  }

  LeHu.loadDataFrom = async function(storageType) {
    let data;
    if (storageType === 'sync') {
      const [syncData, navData] = await Promise.all([
        chrome.storage.sync.get({ setting: {}, clickCounts: {}, categoryMeta: {} }),
        LeHu.bookmarksToNavigation()
      ]);
      data = {
        navigation: navData.navigation,
        categoryOrder: navData.categoryOrder,
        setting: syncData.setting || {},
        categoryMeta: syncData.categoryMeta || {},
        clickCounts: syncData.clickCounts || {}
      };
      return data;
    }
    const storage = LeHu.getStorageAPI(storageType);
    data = await storage.get({
      navigation: {},
      categoryOrder: [],
      setting: {},
      categoryMeta: {},
      clickCounts: {}
    });
    ensureConsistency(data);
    return data;
  };

  LeHu.saveData = async function(data, storageType) {
    ensureConsistency(data);

    const st = storageType || await LeHu.getStorageType();

    if (st === 'sync') {
      const syncData = {};
      if (data.setting) syncData.setting = data.setting;
      if (data.categoryMeta) syncData.categoryMeta = data.categoryMeta;
      if (data.clickCounts) syncData.clickCounts = data.clickCounts;
      await chrome.storage.sync.set(syncData);

      const allKeys = Object.keys(await chrome.storage.sync.get(null));
      const staleKeys = allKeys.filter(function(k) {
        return k.startsWith('nav_') || k === 'navigation' || k === 'categoryOrder' || k === '_chunkInfo';
      });
      if (staleKeys.length > 0) {
        await chrome.storage.sync.remove(staleKeys);
      }
    } else {
      await chrome.storage.local.set({
        navigation: data.navigation || {},
        categoryOrder: data.categoryOrder || [],
        setting: data.setting || {},
        categoryMeta: data.categoryMeta || {},
        clickCounts: data.clickCounts || {}
      });
    }
  };

  LeHu.clearAllData = async function(storageType) {
    const st = storageType || await LeHu.getStorageType();

    if (st === 'sync') {
      await chrome.storage.sync.remove(['setting', 'clickCounts', 'categoryMeta', 'navigation', 'categoryOrder', '_chunkInfo']);
      try {
        const [root] = await chrome.bookmarks.getSubTree('1');
        if (root && root.children) {
          for (const child of root.children) {
            await chrome.bookmarks.removeTree(child.id);
          }
        }
      } catch (e) {
        console.warn('Failed to clear bookmarks tree:', e.message);
      }
    } else {
      await chrome.storage.local.remove(['navigation', 'categoryOrder', 'setting', 'categoryMeta', 'clickCounts']);
    }
  };

  // ===================== Utilities =====================
  LeHu.escapeHtml = function(str) {
    if (typeof str !== 'string' && typeof str !== 'number') return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  };

  LeHu.hexToRgb = function(hex) {
    if (!hex) return null;
    hex = hex.replace('#', '');
    if (hex.length === 3) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    const result = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  };

  const colorCache = new Map();
  LeHu.getConsistentColor = function(str) {
    if (colorCache.has(str)) return colorCache.get(str);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h = Math.abs(hash % 360);
    const s = 60 + (Math.abs(hash) % 20);
    const l = 45 + (Math.abs(hash) % 20);
    const color = 'hsl(' + h + ', ' + s + '%, ' + l + '%)';
    colorCache.set(str, color);
    return color;
  };

  LeHu.isValidUrl = function(url) {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  };
})();
