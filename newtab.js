(function() {
  'use strict';

  let isEditMode = false;
  let draggedItem = null;
  let bookmarks = [];
  let storageType = 'sync';
  let cachedData = null;
  let localImageTimer = null;
  let amapKey = '';
  let dutyApiUrl = '';
  let dutyApiKey = '';
  const WEATHER_CACHE_TTL = 1800000;

  // ===================== Bookmarks API (Sync Mode) =====================
  async function isBookmarkMode() {
    return storageType === 'sync';
  }

  async function getBookmarkFolderId(categoryName, rootId) {
    rootId = rootId || '1';
    const tree = await chrome.bookmarks.getSubTree(rootId);
    if (!tree || !tree[0]) return null;
    const queue = tree[0].children ? tree[0].children.slice() : [];
    while (queue.length) {
      const node = queue.shift();
      if (node.title === categoryName && !node.url) return node.id;
      if (node.children) queue = queue.concat(node.children);
    }
    return null;
  }

  async function rebookmark() {
    if (storageType === 'sync') {
      var navData = await LeHu.bookmarksToNavigation();
      if (cachedData) {
        cachedData.navigation = navData.navigation;
        cachedData.categoryOrder = navData.categoryOrder;
      }
      return navData;
    }
    return cachedData ? { navigation: cachedData.navigation, categoryOrder: cachedData.categoryOrder } : { navigation: {}, categoryOrder: [] };
  }

  function $(id) { return document.getElementById(id); }
  function t(key) { return LeHu.getMessageSync(key); }

  // ===================== IndexedDB for local images =====================
  const DB_NAME = 'WebNavigationExtension';
  const DB_STORE = 'images';
  function openDB() {
    return new Promise(function(resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function() { req.result.createObjectStore(DB_STORE); };
      req.onsuccess = function() { resolve(req.result); };
      req.onerror = function() { reject(req.error); };
    });
  }
  function dbPut(key, data) {
    return openDB().then(function(db) {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put(data, key);
        tx.oncomplete = function() { db.close(); resolve(); };
        tx.onerror = function() { db.close(); reject(tx.error); };
      });
    });
  }
  function dbGet(key) {
    return openDB().then(function(db) {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(DB_STORE, 'readonly');
        var req = tx.objectStore(DB_STORE).get(key);
        req.onsuccess = function() { db.close(); resolve(req.result); };
        req.onerror = function() { db.close(); reject(req.error); };
      });
    });
  }

  // ===================== Data Layer =====================
  async function loadData() {
    cachedData = await LeHu.loadData();
    storageType = await LeHu.getStorageType();
    return cachedData;
  }

  async function saveData(data) {
    await LeHu.saveData(data, storageType);
    cachedData = data;
  }

  async function loadBookmarks() {
    try {
      const data = cachedData || await loadData();
      bookmarks = [];
      data.categoryOrder.forEach(function(categoryName) {
        const links = data.navigation[categoryName] || [];
        links.forEach(function(link) {
          bookmarks.push({ name: link.name, url: link.url, desc: link.desc });
        });
      });
    } catch (error) {
      console.error('Failed to load bookmarks:', error);
    }
  }

  const EMOJIS = ['📁','📂','📚','🗂️','⭐','🔥','💡','🎯','🛠️','🎨','📝','💻','📱','🌐','🎮','📷','✈️','🏠','🛒','💰','🏥','🎓','📊','🎵','🏆','🚀','💎','🧩','📌','🔖','🏷️','💼','📋','🗄️','🎁','🏅','🧭','🗺️','🎪','🎫','🎬','📰','🎧','☕','⚡','🧠'];

  function getCategoryMeta(data, category) {
    if (!data.categoryMeta) data.categoryMeta = {};
    if (!data.categoryMeta[category]) data.categoryMeta[category] = { icon: '', collapsed: false };
    return data.categoryMeta[category];
  }

  // ===================== Poetry (with localStorage cache) =====================
  async function fetchPoetry() {
    try {
      var response = await fetch('https://v2.jinrishici.com/one.json?client=browser-sdk/1.2');
      if (!response.ok) throw new Error('HTTP ' + response.status);
      var data = await response.json();
      var sentenceEl = $('poem_sentence');
      var infoEl = $('poem_info');
      if (sentenceEl) sentenceEl.textContent = data.data.content;
      if (infoEl) infoEl.textContent = '[' + data.data.origin.dynasty + '] ' + data.data.origin.author + ' "' + data.data.origin.title + '"';
    } catch (error) {
      console.error('Failed to get poetry:', error);
      var sentenceEl = $('poem_sentence');
      if (sentenceEl) sentenceEl.textContent = t('poem_no_data');
    }
  }

  // ===================== Time Display =====================
  function updateTime() {
    var dateEl = $('current-date');
    var timeEl = $('current-time');
    if (!dateEl && !timeEl) return;
    if (dateEl && dateEl.offsetParent === null && timeEl && timeEl.offsetParent === null) return;

    var now = new Date();
    var year = now.getFullYear();
    var month = String(now.getMonth() + 1).padStart(2, '0');
    var date = String(now.getDate()).padStart(2, '0');
    var weekdays = t('time_format').includes('星期')
      ? ['\u661f\u671f\u65e5', '\u661f\u671f\u4e00', '\u661f\u671f\u4e8c', '\u661f\u671f\u4e09', '\u661f\u671f\u56db', '\u661f\u671f\u4e94', '\u661f\u671f\u516d']
      : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var weekday = weekdays[now.getDay()];
    var hours = String(now.getHours()).padStart(2, '0');
    var minutes = String(now.getMinutes()).padStart(2, '0');
    var seconds = String(now.getSeconds()).padStart(2, '0');

    if (dateEl) dateEl.textContent = year + '-' + month + '-' + date;
    if (timeEl) timeEl.textContent = weekday + ' ' + hours + ':' + minutes + ':' + seconds;
  }

  // ===================== Weather =====================
  let _weatherRefreshing = false;

  async function fetchWeather() {
    if (!amapKey || _weatherRefreshing) return;
    try {
      _weatherRefreshing = true;
      var cache = await chrome.storage.local.get('_weatherCache');
      if (cache._weatherCache && Date.now() - cache._weatherCache.time < WEATHER_CACHE_TTL) {
        setWeather(cache._weatherCache.data);
        return;
      }
      var loc = await getLocation();
      if (!loc) return;
      var resp = await fetch('https://restapi.amap.com/v3/weather/weatherInfo?key=' + amapKey + '&city=' + loc.adcode + '&extensions=all&output=JSON');
      var data = await resp.json();
      if (data.status === '1' && data.forecasts && data.forecasts.length > 0 && data.forecasts[0].casts) {
        var c = data.forecasts[0].casts[0];
        var weatherData = { temp: c.nighttemp + '/' + c.daytemp + '℃', weather: c.dayweather, city: loc.cityName, icon: weatherIcon(c.dayweather) };
        chrome.storage.local.set({ _weatherCache: { data: weatherData, time: Date.now() } });
        setWeather(weatherData);
      }
    } catch (e) {
      console.warn('Weather fetch failed:', e.message);
    } finally {
      _weatherRefreshing = false;
    }
  }

  function weatherIcon(weather) {
    return { '晴':'☀️','多云':'⛅','阴':'☁️','小雨':'🌦️','中雨':'🌧️','大雨':'🌧️','雷阵雨':'⛈️','小雪':'🌨️','中雪':'❄️','大雪':'❄️','雾':'🌫️','霾':'🌫️' }[weather] || '🌤️';
  }

  function setWeather(data) {
    var el = $('weather-info');
    if (!el) return;
    el.innerHTML = '<span class="weather-icon">' + data.icon + '</span> <span class="weather-temp">' + data.temp + '</span> <span class="weather-city">' + data.city + '</span>';
    el.classList.remove('hidden');
  }

  async function getLocation() {
    try {
      var pos = await new Promise(function(resolve, reject) {
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
      });
      var regeoResp = await fetch('https://restapi.amap.com/v3/geocode/regeo?key=' + amapKey + '&location=' + pos.coords.longitude + ',' + pos.coords.latitude + '&output=JSON');
      var regeoData = await regeoResp.json();
      if (regeoData.status === '1' && regeoData.regeocode) {
        var comp = regeoData.regeocode.addressComponent;
        return { adcode: comp.adcode, cityName: comp.city || comp.province };
      }
    } catch {}
    try {
      var ipResp = await fetch('https://restapi.amap.com/v3/ip?key=' + amapKey + '&output=JSON');
      var ipData = await ipResp.json();
      if (ipData.status === '1' && ipData.city) return { adcode: ipData.adcode, cityName: ipData.city };
    } catch {}
    return null;
  }

  function showToast(html, duration) {
    var container = $('toast-container');
    if (!container) return;
    var toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = html;
    var close = document.createElement('button');
    close.className = 'toast-close';
    close.textContent = '✕';
    close.addEventListener('click', function() { toast.remove(); });
    toast.appendChild(close);
    container.appendChild(toast);
    if (duration > 0) {
      setTimeout(function() { if (toast.parentNode) toast.remove(); }, duration);
    }
  }

  async function fetchDutyInfo() {
    if (!dutyApiUrl || !dutyApiKey) return;
    try {
      var url = dutyApiUrl + (dutyApiUrl.includes('?') ? '&' : '?') + 'api_key=' + encodeURIComponent(dutyApiKey);
      var resp = await fetch(url);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      var data = await resp.json();
      if (!data.success || !data.today || !data.tomorrow) return;
      var todayStr = data.date;
      var tomorrowStr = data.tomorrow_date;
      if (!todayStr || !tomorrowStr) return;
      var onDutyToday = data.personal && data.personal.duties &&
        data.personal.duties.some(function(d) { return d.date === todayStr; });
      var onDutyTomorrow = data.personal && data.personal.duties &&
        data.personal.duties.some(function(d) { return d.date === tomorrowStr; });
      var lines = [];
      if (onDutyToday && data.today.length) {
        lines.push('<div class="toast-duty-today">' + t('duty_today') + '</div>');
        if (data.tomorrow && data.tomorrow.length) {
          lines.push('<div class="toast-duty-tomorrow">' + t('duty_tomorrow') + '：' +
            data.tomorrow.map(function(d) { return LeHu.escapeHtml(d.user_name); }).join('、') + '</div>');
        }
      } else if (onDutyTomorrow) {
        lines.push('<div class="toast-duty-tomorrow">' + t('duty_tomorrow') + '</div>');
      }
      if (lines.length) showToast(lines.join(''), 0);
    } catch (e) {
      console.warn('Duty API fetch failed:', e.message);
    }
  }

  // ===================== Settings =====================
  async function applySettings(settings) {
    if (!settings) return;

    if ('title' in settings) {
      var titleValue = settings.title || t('extension_name') || 'Navigation';
      document.title = titleValue;
      var titleEl = $('site-title');
      if (titleEl) titleEl.textContent = titleValue;
    }

    var leftPanel = document.querySelector('.wrapper-left');
    var rightPanel = document.querySelector('.wrapper-right');
    var poemContent = document.querySelector('.poem_content');

    if (settings.backgroundColor && settings.backgroundOpacity !== undefined) {
      var rgbColor = LeHu.hexToRgb(settings.backgroundColor);
      if (rgbColor) {
        var rgbaColor = 'rgba(' + rgbColor.r + ', ' + rgbColor.g + ', ' + rgbColor.b + ', ' + settings.backgroundOpacity + ')';
        if (leftPanel) leftPanel.style.backgroundColor = rgbaColor;
        if (rightPanel) rightPanel.style.background = 'linear-gradient(45deg, ' + rgbaColor + ', transparent 80%)';
        if (poemContent) poemContent.style.color = 'rgba(255, 255, 255, 0.8)';
      }
    } else {
      if (leftPanel) leftPanel.style.backgroundColor = '';
      if (rightPanel) rightPanel.style.background = '';
      if (poemContent) poemContent.style.color = '';
    }

    if (settings.useBingImage) {
      try {
        var resp = await fetch('https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN');
        if (resp.ok) {
          var jsonData = await resp.json();
          if (jsonData.images && jsonData.images.length > 0) {
            setBackgroundStyle('https://www.bing.com' + jsonData.images[0].url);
          } else {
            clearBackgroundStyle();
          }
        } else {
          clearBackgroundStyle();
        }
      } catch {
        clearBackgroundStyle();
      }
    } else if ('backgroundImage' in settings) {
      if (settings.backgroundImage) {
        setBackgroundStyle(settings.backgroundImage);
      } else {
        clearBackgroundStyle();
      }
    } else {
      clearBackgroundStyle();
    }
  }

  function setBackgroundStyle(imageUrl) {
    if (!imageUrl) { clearBackgroundStyle(); return; }

    if (imageUrl === '__local__') {
      if (localImageTimer) { clearInterval(localImageTimer); localImageTimer = null; }
      dbGet('backgroundImages').then(function(images) {
        if (images && images.length) return images;
        return dbGet('backgroundImage').then(function(legacy) {
          return legacy ? [legacy] : [];
        });
      }).then(function(images) {
        if (!images || !images.length) { clearBackgroundStyle(); return; }
        var idx = 0;
        function applyLocalImage() {
          var blob = images[idx];
          if (!blob) { clearBackgroundStyle(); return; }
          var url = URL.createObjectURL(blob);
          var bgImg = document.querySelector('.background-img');
          if (!bgImg) {
            bgImg = document.createElement('img');
            bgImg.className = 'background-img';
            bgImg.alt = t('background_image_alt') || 'Background Image';
            document.body.insertBefore(bgImg, document.body.firstChild);
          }
          bgImg.src = url;
          bgImg.onload = function() { URL.revokeObjectURL(url); };
        }
        applyLocalImage();
        if (images.length > 1) {
          localImageTimer = setInterval(function() {
            idx = (idx + 1) % images.length;
            applyLocalImage();
          }, 30000);
        }
      }).catch(function() { clearBackgroundStyle(); });
      return;
    }

    if (imageUrl.startsWith('file://')) {
      console.warn('file:// URLs not allowed in extensions; skipping background image');
      clearBackgroundStyle();
      return;
    }

    var bgImg = document.querySelector('.background-img');
    if (!bgImg) {
      bgImg = document.createElement('img');
      bgImg.className = 'background-img';
      bgImg.alt = t('background_image_alt') || 'Background Image';
      document.body.insertBefore(bgImg, document.body.firstChild);
    }
    bgImg.src = imageUrl;
  }

  function clearBackgroundStyle() {
    if (localImageTimer) { clearInterval(localImageTimer); localImageTimer = null; }
    var bgImg = document.querySelector('.background-img');
    if (bgImg) bgImg.remove();
  }

  // ===================== Rendering =====================
  async function renderNavLists() {
    var data = cachedData || await loadData();
    var catsListDiv = $('categories');
    var navListDiv = $('nav-list');
    if (!catsListDiv || !navListDiv) return;

    navListDiv.innerHTML = '';
    catsListDiv.innerHTML = '<ul></ul>';

    data.categoryOrder.forEach(function(category) {
      var meta = getCategoryMeta(data, category);
      var categoryDiv = document.createElement('div');
      categoryDiv.className = 'category' + (meta.collapsed ? ' collapsed' : '');
      categoryDiv.draggable = isEditMode;
      categoryDiv.dataset.category = category;

      var header = document.createElement('div');
      header.className = 'category-header';

      if (isEditMode) {
        var emojiBtn = document.createElement('button');
        emojiBtn.className = 'emoji-picker-btn';
        emojiBtn.textContent = meta.icon || '😀';
        emojiBtn.dataset.category = category;
        header.appendChild(emojiBtn);

        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'category-name-input';
        input.value = category;
        input.dataset.oldCategory = category;
        header.appendChild(input);

        var saveBtn = document.createElement('button');
        saveBtn.className = 'save-category-btn';
        saveBtn.dataset.oldCategory = category;
        saveBtn.textContent = t('save_button') || 'Save';
        header.appendChild(saveBtn);

        var deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-category-btn';
        deleteBtn.dataset.category = category;
        deleteBtn.textContent = t('delete_category') || 'Delete';
        header.appendChild(deleteBtn);
      } else {
        if (meta.icon) {
          var iconSpan = document.createElement('span');
          iconSpan.className = 'category-icon';
          iconSpan.textContent = meta.icon;
          header.appendChild(iconSpan);
        }

        var h2 = document.createElement('h2');
        h2.id = category;
        h2.textContent = category;
        header.appendChild(h2);

        var countSpan = document.createElement('span');
        countSpan.className = 'category-count';
        var linkCount = (data.navigation[category] || []).length;
        countSpan.textContent = '(' + linkCount + ')';
        header.appendChild(countSpan);
      }

      categoryDiv.appendChild(header);

      var linksDiv = document.createElement('div');
      linksDiv.className = 'links';
      var links = data.navigation[category] || [];
      var fragment = document.createDocumentFragment();
      links.forEach(function(link, index) {
        fragment.appendChild(createLinkElement(link, category, index));
      });
      linksDiv.appendChild(fragment);

      categoryDiv.appendChild(linksDiv);
      navListDiv.appendChild(categoryDiv);

      var li = document.createElement('li');
      li.className = 'category-item';
      li.dataset.category = category;
      var span = document.createElement('span');
      span.textContent = (meta.icon || '') + ' ' + category;
      li.appendChild(span);
      catsListDiv.querySelector('ul').appendChild(li);
    });

    await renderTopSites(data);

    if (isEditMode && !dragEventsAttached) {
      addDragEvents(navListDiv);
      dragEventsAttached = true;
    }

    updateButtonVisibility();
    if (data.setting) await applySettings(data.setting);
    bindCategoryClick();
  }

  async function renderTopSites(data) {
    var container = $('top-sites');
    if (!container) return;

    container.innerHTML = '';

    var bookmarks = [];
    (data.categoryOrder || []).forEach(function(cat) {
      (data.navigation[cat] || []).forEach(function(link) {
        if (link.url) bookmarks.push(link);
      });
    });

    if (bookmarks.length === 0) return;

    var counts = data.clickCounts || {};
    var clicked = bookmarks.filter(function(link) { return (counts[link.url] || 0) > 0; });
    if (clicked.length === 0) return;

    clicked.sort(function(a, b) {
      var diff = (counts[b.url] || 0) - (counts[a.url] || 0);
      if (diff !== 0) return diff;
      return (a.name || '').localeCompare(b.name || '');
    });

    var top = clicked.slice(0, 8);

    top.forEach(function(link) {
      var card = document.createElement('a');
      card.className = 'top-site-card';
      card.href = link.url;
      card.target = '_blank';
      card.rel = 'noopener noreferrer';
      card.title = link.name;
      card.addEventListener('click', function() { trackClick(link.url); });

      var fallback = document.createElement('span');
      fallback.className = 'top-site-fallback';
      fallback.style.background = LeHu.getConsistentColor(link.name);
      fallback.textContent = getFirstChar(link.name).toUpperCase();

      var iconUrl = getFaviconUrl(link);

      if (iconUrl) {
        fallback.style.display = 'none';
        var img = document.createElement('img');
        img.className = 'top-site-favicon';
        img.src = iconUrl;
        img.loading = 'lazy';
        img.onload = function() { fallback.style.display = 'none'; };
        img.onerror = function() {
          img.style.display = 'none';
          fallback.style.display = 'flex';
        };
        card.appendChild(img);
      }

      card.appendChild(fallback);
      container.appendChild(card);
    });
  }

  // ===================== Emoji Picker =====================
  let emojiPickerOverlay = null;
  let emojiPickerPopup = null;
  let emojiPickerTarget = null;

  function createEmojiPicker() {
    if (emojiPickerOverlay) return;

    emojiPickerOverlay = document.createElement('div');
    emojiPickerOverlay.className = 'emoji-picker-overlay hidden';

    emojiPickerPopup = document.createElement('div');
    emojiPickerPopup.className = 'emoji-picker-popup';

    EMOJIS.forEach(function(emoji) {
      var btn = document.createElement('button');
      btn.className = 'emoji-option';
      btn.textContent = emoji;
      btn.dataset.emoji = emoji;
      emojiPickerPopup.appendChild(btn);
    });

    var clearBtn = document.createElement('button');
    clearBtn.className = 'emoji-option emoji-clear';
    clearBtn.textContent = chrome.i18n.getMessage('emoji_clear') || 'Clear';
    clearBtn.dataset.emoji = '';
    emojiPickerPopup.appendChild(clearBtn);

    emojiPickerOverlay.appendChild(emojiPickerPopup);
    document.body.appendChild(emojiPickerOverlay);

    emojiPickerOverlay.addEventListener('click', function(e) {
      if (e.target === emojiPickerOverlay) {
        hideEmojiPicker();
      }
    });

    emojiPickerPopup.addEventListener('click', function(e) {
      var btn = e.target.closest('.emoji-option');
      if (!btn) return;
      selectEmoji(btn.dataset.emoji);
    });
  }

  function showEmojiPicker(categoryName, btnElement) {
    createEmojiPicker();
    emojiPickerTarget = categoryName;
    emojiPickerOverlay.classList.remove('hidden');
    var rect = btnElement.getBoundingClientRect();
    emojiPickerPopup.style.top = (rect.bottom + 4) + 'px';
    emojiPickerPopup.style.left = Math.max(8, rect.left) + 'px';
  }

  function hideEmojiPicker() {
    if (emojiPickerOverlay) emojiPickerOverlay.classList.add('hidden');
    emojiPickerTarget = null;
  }

  function selectEmoji(emoji) {
    if (!emojiPickerTarget) return;
    var data = cachedData || {};
    if (!data.categoryMeta) data.categoryMeta = {};
    if (!data.categoryMeta[emojiPickerTarget]) data.categoryMeta[emojiPickerTarget] = {};
    data.categoryMeta[emojiPickerTarget].icon = emoji;
    saveData(data);
    renderNavLists();
    hideEmojiPicker();
  }

  function getFirstChar(name) {
    for (var i = 0; i < (name || '').length; i++) {
      if (/\p{L}|\p{N}/u.test(name.charAt(i))) return name.charAt(i);
    }
    return (name || '?').charAt(0) || '?';
  }

  function getFaviconUrl(link) {
    return link.icon || '';
  }

  function trackClick(url) {
    if (!url) return;
    var data = cachedData;
    if (!data) return;
    if (!data.clickCounts) data.clickCounts = {};
    data.clickCounts[url] = (data.clickCounts[url] || 0) + 1;
    saveData(data);
  }

  function createLinkElement(link, category, index) {
    var linkDiv = document.createElement('div');
    linkDiv.className = 'link';
    linkDiv.draggable = isEditMode;
    linkDiv.dataset.category = category;
    linkDiv.dataset.index = index;
    linkDiv.dataset.icon = link.icon || '';

    var a = document.createElement('a');
    a.href = LeHu.escapeHtml(link.url);
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.addEventListener('click', function() { trackClick(link.url); });

    var iconUrl = getFaviconUrl(link);

    if (iconUrl) {
      var img = document.createElement('img');
      img.className = 'link-logo';
      img.alt = LeHu.escapeHtml(link.name);
      img.src = LeHu.escapeHtml(iconUrl);
      img.loading = 'lazy';

      var fallbackSpan = document.createElement('span');
      fallbackSpan.className = 'link-logo';
      fallbackSpan.style.backgroundColor = LeHu.getConsistentColor(link.name);
      fallbackSpan.textContent = getFirstChar(link.name);
      fallbackSpan.style.display = 'none';

      img.onload = function() { fallbackSpan.style.display = 'none'; };
      img.onerror = function() {
        img.style.display = 'none';
        fallbackSpan.style.display = 'flex';
      };

      a.appendChild(img);
      a.appendChild(fallbackSpan);
    } else {
      var initialSpan = document.createElement('span');
      initialSpan.className = 'link-logo';
      initialSpan.style.backgroundColor = LeHu.getConsistentColor(link.name);
      initialSpan.textContent = getFirstChar(link.name);
      a.appendChild(initialSpan);
    }

    var textDiv = document.createElement('div');
    var nameSpan = document.createElement('span');
    nameSpan.className = 'link-name';
    nameSpan.textContent = link.name;
    textDiv.appendChild(nameSpan);

    if (link.desc) {
      var descSpan = document.createElement('span');
      descSpan.className = 'link-desc';
      descSpan.textContent = link.desc;
      textDiv.appendChild(descSpan);
    }

    a.appendChild(textDiv);
    linkDiv.appendChild(a);

    if (isEditMode) {
      var editDiv = document.createElement('div');
      editDiv.className = 'link-edit';

      var editBtn = document.createElement('button');
      editBtn.className = 'edit-link';
      editBtn.dataset.category = category;
      editBtn.dataset.index = index;
      editBtn.title = t('edit_link') || 'Edit';
      editBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
      editDiv.appendChild(editBtn);

      var deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-link';
      deleteBtn.dataset.category = category;
      deleteBtn.dataset.index = index;
      deleteBtn.title = t('delete_link') || 'Delete';
      deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
      editDiv.appendChild(deleteBtn);

      linkDiv.appendChild(editDiv);
    }

    return linkDiv;
  }

  function bindMenuToggle() {
    var toggleBtn = $('menu-toggle');
    var dropdown = $('menu-dropdown');
    if (!toggleBtn || !dropdown) return;

    toggleBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      dropdown.classList.toggle('hidden');
    });

    dropdown.addEventListener('click', function() {
      dropdown.classList.add('hidden');
    });

    document.addEventListener('click', function(e) {
      if (!dropdown.classList.contains('hidden') && !toggleBtn.contains(e.target)) {
        dropdown.classList.add('hidden');
      }
    });
  }

  function updateButtonVisibility() {
    var importButton = $('import-json');
    var exportButton = $('export-json');
    var clearAllButton = $('clear-all');
    var toggleButton = $('toggle-edit');

    if (importButton) importButton.classList.toggle('visible', isEditMode);
    if (exportButton) exportButton.classList.toggle('visible', isEditMode);
    if (clearAllButton) clearAllButton.classList.toggle('visible', isEditMode);
    if (toggleButton) {
      toggleButton.textContent = isEditMode ? t('done_button') : t('edit_button');
      toggleButton.dataset.i18n = isEditMode ? 'done_button' : 'edit_button';
    }
  }

  // ===================== Drag and Drop =====================
  function addDragEvents(container) {
    container.addEventListener('dragstart', handleDragStart);
    container.addEventListener('dragover', handleDragOver);
    container.addEventListener('drop', handleDrop);
    container.addEventListener('dragend', handleDragEnd);
  }

  let dragEventsAttached = false;

  function handleDragStart(e) {
    if (!isEditMode) return;
    draggedItem = e.target.closest('.link, .category');
    if (draggedItem) {
      draggedItem.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', '');
    }
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    var target = e.target.closest('.category, .link');
    if (!target || target === draggedItem || !draggedItem) return;
    if (draggedItem.contains(target)) return;

    if (draggedItem.classList.contains('category')) {
      var navList = $('nav-list');
      var categories = Array.from(navList.children).filter(function(c) {
        return c.classList.contains('category') && c !== draggedItem;
      });
      var closest = null;
      var minDist = Infinity;
      categories.forEach(function(cat) {
        var r = cat.getBoundingClientRect();
        var mid = r.top + r.height / 2;
        var dist = Math.abs(e.clientY - mid);
        if (dist < minDist) { minDist = dist; closest = cat; }
      });
      if (closest) {
        var cr = closest.getBoundingClientRect();
        if (e.clientY < cr.top + cr.height / 2) {
          navList.insertBefore(draggedItem, closest);
        } else {
          navList.insertBefore(draggedItem, closest.nextSibling);
        }
      } else {
        navList.appendChild(draggedItem);
      }
    } else if (draggedItem.classList.contains('link')) {
      if (target.classList.contains('link')) {
        var rect = target.getBoundingClientRect();
        var midpoint = rect.top + rect.height / 2;
        if (e.clientY < midpoint) {
          target.parentNode.insertBefore(draggedItem, target);
        } else {
          target.parentNode.insertBefore(draggedItem, target.nextSibling);
        }
      } else if (target.classList.contains('category')) {
        var linksContainer = target.querySelector('.links');
        if (linksContainer) {
          var linkElements = Array.from(linksContainer.children).filter(function(child) {
            return child.classList.contains('link');
          });
          if (linkElements.length === 0) {
            linksContainer.appendChild(draggedItem);
          } else {
            var closestLink = null;
            var minDistance = Infinity;
            linkElements.forEach(function(link) {
              var lr = link.getBoundingClientRect();
              var dist = Math.abs(e.clientY - (lr.top + lr.height / 2));
              if (dist < minDistance) { minDistance = dist; closestLink = link; }
            });
            if (closestLink) {
              var cr = closestLink.getBoundingClientRect();
              var cm = cr.top + cr.height / 2;
              if (e.clientY < cm) {
                linksContainer.insertBefore(draggedItem, closestLink);
              } else {
                linksContainer.insertBefore(draggedItem, closestLink.nextSibling);
              }
            } else {
              linksContainer.appendChild(draggedItem);
            }
          }
        }
      }
    }
  }

  async function handleDrop(e) {
    e.preventDefault();
    if (draggedItem) {
      draggedItem.classList.remove('dragging');
      await saveNavigationOrder();
      draggedItem = null;
    }
  }

  function handleDragEnd() {
    if (draggedItem) {
      draggedItem.classList.remove('dragging');
      draggedItem = null;
    }
  }

  async function saveNavigationOrder() {
    const navListDiv = $('nav-list');
    const data = cachedData || await loadData();
    const isSync = storageType === 'sync';

    const updatedOrder = Array.from(navListDiv.children)
      .filter(function(div) { return div.classList.contains('category'); })
      .map(function(div) {
        const inp = div.querySelector('.category-name-input');
        if (inp) return inp.value;
        const h = div.querySelector('h2');
        return h ? h.innerText : null;
      })
      .filter(Boolean);

    data.categoryOrder = updatedOrder;

    if (isSync) {
      const folderMap = {};
      const fTree = await chrome.bookmarks.getSubTree('1');
      if (fTree && fTree[0]) {
        const fQueue = fTree[0].children ? fTree[0].children.slice() : [];
        while (fQueue.length) {
          const fNode = fQueue.shift();
          if (!fNode.url && fNode.title) folderMap[fNode.title] = fNode.id;
          if (fNode.children) fQueue = fQueue.concat(fNode.children);
        }
      }

      for (let ci = 0; ci < navListDiv.querySelectorAll('.category').length; ci++) {
        const categoryDiv = navListDiv.querySelectorAll('.category')[ci];
        const inp = categoryDiv.querySelector('.category-name-input');
        const category = inp ? inp.value : (categoryDiv.querySelector('h2') ? categoryDiv.querySelector('h2').innerText : null);
        if (!category) continue;

        const links = Array.from(categoryDiv.querySelectorAll('.link')).map(function(linkDiv) {
          const nameEl = linkDiv.querySelector('.link-name');
          const linkA = linkDiv.querySelector('a');
          const descEl = linkDiv.querySelector('.link-desc');
          return { name: nameEl ? nameEl.textContent : '', url: linkA ? linkA.href : '', icon: linkDiv.dataset.icon || '', desc: descEl ? descEl.textContent : '' };
        });

        const folderId = folderMap[category];
        if (folderId) {
          const [folderNode] = await chrome.bookmarks.getSubTree(folderId);
          const bmChildren = (folderNode.children || []).filter(function(c) { return !!c.url; });
          for (let li = 0; li < links.length; li++) {
            const bm = bmChildren.find(function(c) { return c.url === links[li].url; });
            if (bm) {
              try { await chrome.bookmarks.move(bm.id, { parentId: folderId, index: li }); } catch (e) {}
            }
          }
        }

        if (links.length === 0) {
          delete data.navigation[category];
        } else {
          data.navigation[category] = links;
        }
      }
    } else {
      navListDiv.querySelectorAll('.category').forEach(function(categoryDiv) {
        const inp = categoryDiv.querySelector('.category-name-input');
        const category = inp ? inp.value : (categoryDiv.querySelector('h2') ? categoryDiv.querySelector('h2').innerText : null);
        if (!category) return;

        const links = Array.from(categoryDiv.querySelectorAll('.link')).map(function(linkDiv) {
          const nameEl = linkDiv.querySelector('.link-name');
          const linkA = linkDiv.querySelector('a');
          const descEl = linkDiv.querySelector('.link-desc');
          return { name: nameEl ? nameEl.textContent : '', url: linkA ? linkA.href : '', icon: linkDiv.dataset.icon || '', desc: descEl ? descEl.textContent : '' };
        });

        if (links.length === 0) {
          delete data.navigation[category];
        } else {
          data.navigation[category] = links;
        }
      });
    }

    await saveData(data);
    let bookmarks = [];
    data.categoryOrder.forEach(function(catName) {
      (data.navigation[catName] || []).forEach(function(link) {
        bookmarks.push({ name: link.name, url: link.url, desc: link.desc });
      });
    });
  }

  // ===================== Event Binding =====================
  function bindToggleEdit() {
    var toggleButton = $('toggle-edit');
    if (toggleButton) {
      toggleButton.addEventListener('click', async function() {
        isEditMode = !isEditMode;
        await renderNavLists();
      });
    }
  }

  function bindStorageToggle() {
    var storageButton = $('storage-toggle');
    if (!storageButton) return;
    updateStorageButtonText(storageButton);

    storageButton.addEventListener('click', async function() {
      var newStorageType = storageType === 'local' ? 'sync' : 'local';
      var confirmMsg = newStorageType === 'local'
        ? t('switch_storage_confirm')
        : t('switch_storage_confirm2');

      if (!await LeHu.Modal.confirm(confirmMsg)) return;

      var targetData = await LeHu.loadDataFrom(newStorageType);
      var targetHasData = Object.keys(targetData.navigation || {}).length > 0;

      if (!targetHasData) {
        var migrated = false;

        if (!migrated) {
          var sourceData = await LeHu.loadDataFrom(storageType);
          var sourceHasData = Object.keys(sourceData.navigation || {}).length > 0;
          if (sourceHasData) {
            if (await LeHu.Modal.confirm(t('migrate_storage_confirm'))) {
              if (newStorageType === 'sync') {
                var cats = sourceData.categoryOrder || Object.keys(sourceData.navigation || {});
                for (var ci = 0; ci < cats.length; ci++) {
                  var folder = await chrome.bookmarks.create({ parentId: '1', title: cats[ci] });
                  var links = sourceData.navigation[cats[ci]] || [];
                  for (var li = 0; li < links.length; li++) {
                    await chrome.bookmarks.create({ parentId: folder.id, title: links[li].name, url: links[li].url });
                  }
                }
              } else {
                await LeHu.saveData({
                  navigation: sourceData.navigation,
                  categoryOrder: sourceData.categoryOrder,
                  setting: sourceData.setting
                }, newStorageType);
              }
              migrated = true;
              LeHu.Modal.alert(t('migrate_success'));
            }
          }
        }

        // 无论哪种导入方式，都迁移设置/分类元数据/点击数
        if (migrated) {
          var sourceData = await LeHu.loadDataFrom(storageType);
          if (newStorageType === 'sync') {
            await chrome.storage.sync.set({
              setting: sourceData.setting || {},
              categoryMeta: sourceData.categoryMeta || {},
              clickCounts: sourceData.clickCounts || {}
            });
          }
        }
      }

      var oldStorageType = storageType;
      storageType = newStorageType;
      updateStorageButtonText(storageButton);

      try {
        await chrome.storage.local.set({ storageType: newStorageType });
      } catch (error) {
        storageType = oldStorageType;
        updateStorageButtonText(storageButton);
        LeHu.Modal.alert(t('save_failed') + error.message);
        return;
      }

      await new Promise(function(resolve) { setTimeout(resolve, 100); });
      location.reload();
    });
  }

  function updateStorageButtonText(button) {
    if (!button) return;
    var key = storageType === 'local' ? 'sync_mode_button' : 'local_mode_button';
    button.dataset.i18n = key;
    button.textContent = t(key);
  }

  function bindLinkOperations() {
    var navListDiv = $('nav-list');
    if (!navListDiv) return;

    navListDiv.addEventListener('click', async function(e) {
      var target = e.target;

      var header = target.closest('.category-header');
      if (header && !isEditMode) {
        var cat = header.parentElement.dataset.category;
        var data = cachedData || await loadData();
        if (!data.categoryMeta) data.categoryMeta = {};
        if (!data.categoryMeta[cat]) data.categoryMeta[cat] = {};
        data.categoryMeta[cat].collapsed = !data.categoryMeta[cat].collapsed;
        await saveData(data);
        await renderNavLists();
        return;
      }

      if (target.classList.contains('emoji-picker-btn')) {
        showEmojiPicker(target.dataset.category, target);
        return;
      }

      if (target.classList.contains('save-category-btn')) {
        var oldCategory = target.dataset.oldCategory;
        var categoryInput = target.parentElement.querySelector('.category-name-input');
        var newCategory = (categoryInput.value || '').trim();
        if (!newCategory) { LeHu.Modal.alert(t('category_empty_error')); categoryInput.value = oldCategory; return; }
        if (newCategory === oldCategory) return;

        var data = cachedData || await loadData();
        if (data.navigation[newCategory]) { LeHu.Modal.alert(t('category_exists_error')); categoryInput.value = oldCategory; return; }
        if (storageType === 'sync') {
          var fId = await getBookmarkFolderId(oldCategory);
          if (fId) await chrome.bookmarks.update(fId, { title: newCategory });
        }
        data.navigation[newCategory] = data.navigation[oldCategory];
        delete data.navigation[oldCategory];
        var idx = data.categoryOrder.indexOf(oldCategory);
        if (idx !== -1) data.categoryOrder[idx] = newCategory;
        if (!data.categoryMeta) data.categoryMeta = {};
        if (data.categoryMeta[oldCategory]) {
          data.categoryMeta[newCategory] = data.categoryMeta[oldCategory];
          delete data.categoryMeta[oldCategory];
        }
        await saveData(data);
        await renderNavLists();
        LeHu.Modal.alert(t('category_updated'));
        return;
      }

      if (target.classList.contains('delete-category-btn')) {
        if (!await LeHu.Modal.confirm(t('delete_category_confirm').replace('{category}', target.dataset.category))) return;
        var data = cachedData || await loadData();
        if (storageType === 'sync') {
          var fId = await getBookmarkFolderId(target.dataset.category);
          if (fId) await chrome.bookmarks.removeTree(fId);
        }
        delete data.navigation[target.dataset.category];
        data.categoryOrder = data.categoryOrder.filter(function(c) { return c !== target.dataset.category; });
        if (data.categoryMeta) delete data.categoryMeta[target.dataset.category];
        await saveData(data);
        await renderNavLists();
        return;
      }

      if (target.closest('.delete-link')) {
        var btn = target.closest('.delete-link');
        if (!await LeHu.Modal.confirm(t('delete_link_confirm') || '确认删除此链接？')) return;
        var data = cachedData || await loadData();
        var cat = btn.dataset.category;
        var idx = parseInt(btn.dataset.index, 10);
        if (storageType === 'sync') {
          var link = data.navigation[cat][idx];
          if (link && link._bid) {
            try { await chrome.bookmarks.remove(link._bid); } catch (e) {}
          }
        }
        data.navigation[cat].splice(idx, 1);
        if (data.navigation[cat].length === 0) {
          delete data.navigation[cat];
          data.categoryOrder = data.categoryOrder.filter(function(c) { return c !== cat; });
        }
        await saveData(data);
        await renderNavLists();
        return;
      }

      if (target.closest('.edit-link')) {
        var btn = target.closest('.edit-link');
        var data = cachedData || await loadData();
        var cat = btn.dataset.category;
        var idx = parseInt(btn.dataset.index, 10);
        var link = data.navigation[cat][idx];

        var newName = await LeHu.Modal.prompt(t('edit_link_name'), link.name);
        if (newName === null) return;
        var newUrl = await LeHu.Modal.prompt(t('edit_link_url'), link.url);
        if (newUrl === null) return;
        var newIcon = await LeHu.Modal.prompt(t('edit_link_icon'), link.icon || '');
        if (newIcon === null) return;
        var newDesc = storageType === 'sync' ? '' : await LeHu.Modal.prompt(t('edit_link_desc'), link.desc || '');
        if (newDesc === null) return;

        if (!newName || !newName.trim()) { LeHu.Modal.alert(t('error_link_name_required')); return; }
        if (!newUrl || !newUrl.trim()) { LeHu.Modal.alert(t('error_link_url_required')); return; }
        if (!LeHu.isValidUrl(newUrl)) { LeHu.Modal.alert(t('error_invalid_url')); return; }
        newUrl = newUrl.trim();
        if (newUrl !== link.url.trim()) {
          var dupFound = false;
          for (var c in data.navigation) {
            if (c === cat) {
              for (var i = 0; i < data.navigation[c].length; i++) {
                if (i !== idx && data.navigation[c][i].url && data.navigation[c][i].url.trim() === newUrl) { dupFound = true; break; }
              }
            } else {
              for (var i = 0; i < data.navigation[c].length; i++) {
                if (data.navigation[c][i].url && data.navigation[c][i].url.trim() === newUrl) { dupFound = true; break; }
              }
            }
            if (dupFound) break;
          }
          if (dupFound) { LeHu.Modal.alert(t('error_link_exists')); return; }
        }
        if (storageType === 'sync') {
          var link = data.navigation[cat][idx];
          if (link && link._bid) {
            try { await chrome.bookmarks.update(link._bid, { title: newName, url: newUrl }); } catch (e) {}
          }
        }
        data.navigation[cat][idx] = { name: newName, url: newUrl, icon: newIcon || '', desc: newDesc || '' };
        await saveData(data);
        await renderNavLists();
      }
    });
  }

  function bindImport() {
    var importButton = $('import-json');
    if (!importButton) return;
    importButton.addEventListener('click', function() {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = async function(event) {
        var file = event.target.files[0];
        if (!file) return;
        try {
          var text = await file.text();
          var jsonData = JSON.parse(text);
          if (jsonData.navigation && jsonData.categoryOrder) {
            if (storageType === 'sync') {
              var cats = jsonData.categoryOrder || Object.keys(jsonData.navigation || {});
              for (var ci = 0; ci < cats.length; ci++) {
                var folder = await chrome.bookmarks.create({ parentId: '1', title: cats[ci] });
                var links = jsonData.navigation[cats[ci]] || [];
                for (var li = 0; li < links.length; li++) {
                  await chrome.bookmarks.create({ parentId: folder.id, title: links[li].name, url: links[li].url });
                }
              }
              await chrome.storage.sync.set({
                setting: jsonData.setting || {},
                categoryMeta: jsonData.categoryMeta || {},
                clickCounts: jsonData.clickCounts || {}
              });
            } else {
              await saveData(jsonData);
            }
            if (jsonData.todos && Array.isArray(jsonData.todos)) {
              await saveTodos(jsonData.todos);
            }
            await renderNavLists();
            LeHu.Modal.alert(t('import_success'));
          } else {
            LeHu.Modal.alert(t('import_invalid_format'));
          }
        } catch (error) {
          LeHu.Modal.alert(t('import_failed') + error.message);
        }
      };
      input.click();
    });
  }

  function bindExport() {
    var exportButton = $('export-json');
    if (!exportButton) return;
    exportButton.addEventListener('click', async function() {
      var data = cachedData || await loadData();
      var todos = await loadTodos();
      var exportData = { version: 2, exportedAt: Date.now(), navigation: data.navigation, categoryOrder: data.categoryOrder, setting: data.setting, categoryMeta: data.categoryMeta, clickCounts: data.clickCounts, todos: todos };
      var jsonString = JSON.stringify(exportData, null, 2);
      var blob = new Blob([jsonString], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      var d = new Date();
      a.download = 'LeHu-backup-' + d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0') + '.json';
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  // ===================== Browser Bookmark Import =====================
  function extractDomain(url) {
    try { return new URL(url).hostname.replace('www.', ''); } catch { return t('untitled') || 'Untitled'; }
  }

  async function importFromBookmarks() {
    try {
      var response = await chrome.runtime.sendMessage({ action: 'getBookmarks' });
      if (response && response.error) throw new Error(response.error);
      var bookmarksArray = response && response.bookmarks;
      if (!bookmarksArray || !Array.isArray(bookmarksArray) || bookmarksArray.length === 0) {
        throw new Error('No browser bookmarks found');
      }

      var allBookmarks = bookmarksArray.filter(function(b) { return b.url; }).map(function(b) {
        return { title: b.title || '', url: b.url, folder: b.folder || '', name: b.title || '', icon: '', desc: '' };
      });
      if (allBookmarks.length === 0) return { imported: 0, data: null };

      var data = cachedData || await loadData();
      var existingUrls = new Set();
      for (var cat in data.navigation) {
        if (data.navigation.hasOwnProperty(cat)) {
          data.navigation[cat].forEach(function(link) { existingUrls.add(link.url); });
        }
      }

      var grouped = {};
      var skippedCount = 0;

      allBookmarks.forEach(function(bookmark) {
        var category = bookmark.folder || t('uncategorized');
        var title = bookmark.title || '';
        var desc = '';
        if (title) {
          var di = title.indexOf(' - ');
          var pi = title.indexOf(' | ');
          var ui = title.indexOf(' _ ');
          if (di > 0) { title = title.substring(0, di).trim(); desc = bookmark.title.substring(di + 3).trim(); }
          else if (pi > 0) { title = title.substring(0, pi).trim(); desc = bookmark.title.substring(pi + 3).trim(); }
          else if (ui > 0) { title = title.substring(0, ui).trim(); desc = bookmark.title.substring(ui + 3).trim(); }
        }
        if (!title || title.trim() === '') title = extractDomain(bookmark.url);
        if (existingUrls.has(bookmark.url)) { skippedCount++; return; }
        existingUrls.add(bookmark.url);
        if (!grouped[category]) grouped[category] = [];
        grouped[category].push({ name: title, url: bookmark.url, icon: '', desc: desc });
      });

      var navigation = {};
      var categoryOrder = [];
      var limit = storageType === 'local' ? LeHu.LIMITS.LOCAL_MAX_ITEMS : LeHu.LIMITS.SYNC_MAX_ITEMS;
      for (var cn in grouped) {
        if (grouped.hasOwnProperty(cn)) {
          navigation[cn] = grouped[cn].slice(0, limit);
          categoryOrder.push(cn);
        }
      }
      return { imported: allBookmarks.length, skipped: skippedCount, navigation: navigation, categoryOrder: categoryOrder };
    } catch (error) {
      throw new Error('Failed to get bookmarks: ' + error.message);
    }
  }

  function bindImportBookmarks() {
    var importBookmarksButton = $('import-bookmarks');
    if (!importBookmarksButton) return;

    importBookmarksButton.addEventListener('click', async function() {
      if (storageType === 'sync') {
        LeHu.Modal.alert(t('import_bookmarks_sync_mode') || '同步模式下书签已自动显示，无需导入');
        return;
      }
      try {
        var result = await importFromBookmarks();
        if (result.imported === 0) { LeHu.Modal.alert(t('no_bookmarks')); return; }

        var data = cachedData || await loadData();
        var existingCategories = Object.keys(data.navigation);

        if (await LeHu.Modal.confirm(t('import_method_title').replace('{count}', result.imported))) {
          var targetCategory = '';
          if (existingCategories.length > 0) {
            targetCategory = await LeHu.Modal.prompt(t('existing_categories').replace('{categories}', existingCategories.join(', '))) || '';
          } else {
            targetCategory = await LeHu.Modal.prompt(t('enter_new_category')) || '';
          }
          if (!targetCategory) { LeHu.Modal.alert(t('import_cancelled')); return; }

          if (!data.navigation[targetCategory]) { data.navigation[targetCategory] = []; data.categoryOrder.push(targetCategory); }
          var addedCount = 0;
          for (var cat in result.navigation) {
            if (result.navigation.hasOwnProperty(cat)) {
              if (!data.navigation[targetCategory]) { data.navigation[targetCategory] = []; data.categoryOrder.push(targetCategory); }
              result.navigation[cat].forEach(function(link) { data.navigation[targetCategory].push(link); addedCount++; });
            }
          }
          if (addedCount > 0) {
            await saveData(data); await renderNavLists();
            var sm = result.skipped > 0 ? t('skipped_duplicates').replace('{count}', result.skipped) : '';
            LeHu.Modal.alert(t('imported_to_category').replace('{count}', addedCount).replace('{category}', targetCategory).replace('{skipped}', sm));
          } else { LeHu.Modal.alert(t('all_exists')); }
        } else {
          for (var cat in result.navigation) {
            if (result.navigation.hasOwnProperty(cat)) {
              if (!data.navigation[cat]) { data.navigation[cat] = []; data.categoryOrder.push(cat); }
              result.navigation[cat].forEach(function(link) { data.navigation[cat].push(link); });
            }
          }
          await saveData(data); await renderNavLists(); await loadBookmarks();
          var sm = result.skipped > 0 ? t('skipped_duplicates').replace('{count}', result.skipped) : '';
          LeHu.Modal.alert(t('import_by_category').replace('{skipped}', sm));
        }
      } catch (error) {
        console.error('Import failed details:', error);
        LeHu.Modal.alert(t('import_failed') + error.message);
      }
    });
  }

  // ===================== Search =====================
  let searchIndex = -1;

  function bindSearch() {
    var searchInput = $('search-input');
    if (!searchInput) return;

    searchInput.addEventListener('input', function() {
      searchIndex = -1;
      searchBookmarks();
    });
    searchInput.addEventListener('focus', function() {
      if (searchInput.value) searchBookmarks();
    });

    searchInput.addEventListener('keydown', function(e) {
      var results = $('search-results');
      var items = results ? results.querySelectorAll('li') : [];
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (items.length === 0) return;
        searchIndex = (searchIndex + 1) % items.length;
        items.forEach(function(li, i) { li.classList.toggle('selected', i === searchIndex); });
        if (items[searchIndex]) items[searchIndex].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (items.length === 0) return;
        searchIndex = (searchIndex - 1 + items.length) % items.length;
        items.forEach(function(li, i) { li.classList.toggle('selected', i === searchIndex); });
        if (items[searchIndex]) items[searchIndex].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' && searchIndex >= 0 && items[searchIndex]) {
        e.preventDefault();
        var a = items[searchIndex].querySelector('a');
        if (a) { window.open(a.href, '_blank'); trackClick(a.href); }
      }
    });

    document.addEventListener('keydown', function(e) {
      if (e.ctrlKey && e.key === '/') {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      }
    });

    document.addEventListener('click', function(e) {
      var results = $('search-results');
      if (results && searchInput && !searchInput.contains(e.target) && !results.contains(e.target)) {
        results.innerHTML = '';
        results.hidden = true;
        searchIndex = -1;
      }
    });
  }

  function searchBookmarks() {
    var query = ($('search-input') && $('search-input').value.toLowerCase()) || '';
    var resultsList = $('search-results');
    if (!resultsList) return;
    resultsList.innerHTML = '';
    if (!query) { resultsList.hidden = true; return; }

    var filtered = bookmarks.filter(function(bm) {
      return (bm.name && bm.name.toLowerCase().includes(query)) ||
             (bm.url && bm.url.toLowerCase().includes(query)) ||
             (bm.desc && bm.desc.toLowerCase().includes(query));
    });
    if (filtered.length === 0) { resultsList.hidden = true; return; }
    resultsList.hidden = false;

    filtered.forEach(function(bm) {
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = LeHu.escapeHtml(bm.url);
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = bm.name;
      li.appendChild(a);
      resultsList.appendChild(li);
    });
  }

  // ===================== Category Click =====================
  function bindCategoryClick() {
    var categoriesList = $('categories');
    if (!categoriesList) return;
    categoriesList.addEventListener('click', function(event) {
      var target = event.target.closest('.category-item');
      if (!target) return;
      var targetElement = $(target.dataset.category);
      if (!targetElement) return;
      if (window.innerWidth < 768) {
        window.scrollTo({ top: targetElement.getBoundingClientRect().top + window.pageYOffset - 80, behavior: 'smooth' });
      } else {
        targetElement.scrollIntoView({ behavior: 'smooth' });
      }
    });
  }

  // ===================== Settings Dialog =====================
  function bindSettingsDialog() {
    var settingButton = $('setting');
    var settingsDialog = $('settings-dialog');
    var saveSettingsButton = $('save-settings');
    var cancelSettingsButton = $('cancel-settings');
    if (!settingButton || !settingsDialog) return;

    settingButton.addEventListener('click', async function() {
      var storageAPI = LeHu.getStorageAPI(storageType);
      var data = await storageAPI.get({ setting: {} });
      var settings = data.setting || {};
      if ($('title')) $('title').value = settings.title || '';
      if ($('background-image')) $('background-image').value = settings.backgroundImage === '__local__' ? '' : (settings.backgroundImage || '');
      if ($('background-image')) $('background-image').placeholder = settings.backgroundImage === '__local__' ? t('local_image_placeholder') : (t('background_image_placeholder') || 'Enter background image URL');
      if ($('background-color')) $('background-color').value = settings.backgroundColor || '#334455';
      if ($('background-opacity')) $('background-opacity').value = settings.backgroundOpacity != null ? settings.backgroundOpacity : 0.8;
      if ($('use-bing-image')) $('use-bing-image').checked = settings.useBingImage || false;
      if ($('amap-key')) $('amap-key').value = settings.amapKey || '';
      if ($('duty-api-url')) $('duty-api-url').value = settings.dutyApiUrl || '';
      if ($('duty-api-key')) $('duty-api-key').value = settings.dutyApiKey || '';
      settingsDialog.classList.remove('hidden');
      var overlay = $('settings-dialog-overlay');
      if (overlay) overlay.classList.remove('hidden');
    });

    if (saveSettingsButton) {
      saveSettingsButton.addEventListener('click', async function() {
        var bgImage = ($('background-image') && $('background-image').value) || '';
        if (bgImage.startsWith('file://')) {
          LeHu.Modal.alert(t('file_url_not_supported'));
          return;
        }
        var settings = {
          title: ($('title') && $('title').value) || '',
          backgroundImage: ($('background-image') && $('background-image').value) || '',
          backgroundColor: ($('background-color') && $('background-color').value) || '#334455',
          backgroundOpacity: parseFloat($('background-opacity') && $('background-opacity').value) || 0.8,
          useBingImage: ($('use-bing-image') && $('use-bing-image').checked) || false,
          amapKey: ($('amap-key') && $('amap-key').value) || ''
        };
        dutyApiUrl = ($('duty-api-url') && $('duty-api-url').value) || '';
        dutyApiKey = ($('duty-api-key') && $('duty-api-key').value) || '';
        settings.dutyApiUrl = dutyApiUrl;
        settings.dutyApiKey = dutyApiKey;
        var storageAPI = LeHu.getStorageAPI(storageType);
        await storageAPI.set({ setting: settings });
        if (cachedData) cachedData.setting = settings;
        amapKey = settings.amapKey;
        if (bgImage !== '__local__') {
          try { indexedDB.deleteDatabase(DB_NAME); } catch (e) {}
        }
        await applySettings(settings);
        fetchDutyInfo();
        settingsDialog.classList.add('hidden');
        var overlay = $('settings-dialog-overlay');
        if (overlay) overlay.classList.add('hidden');
        LeHu.Modal.alert(t('settings_saved').replace('{sync}', storageType === 'local' ? t('local_storage') : t('sync_storage')));
      });
    }

    if (cancelSettingsButton) {
      cancelSettingsButton.addEventListener('click', function() {
        settingsDialog.classList.add('hidden');
        var overlay = $('settings-dialog-overlay');
        if (overlay) overlay.classList.add('hidden');
      });
    }

    var pickBtn = $('pick-local-image');
    if (pickBtn) {
      var fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      fileInput.multiple = true;
      pickBtn.addEventListener('click', function() { fileInput.click(); });
      fileInput.addEventListener('change', function() {
        var files = fileInput.files;
        if (!files || !files.length) return;
        var blobs = Array.from(files);
        dbPut('backgroundImages', blobs).then(function() {
          if ($('background-image')) $('background-image').value = '__local__';
          LeHu.Modal.alert(blobs.length > 1 ? t('local_image_multi_selected').replace('{count}', blobs.length) : t('local_image_selected'));
        }).catch(function(err) {
          LeHu.Modal.alert(t('local_image_failed').replace('{message}', err.message));
        });
        fileInput.value = '';
      });
    }

    var clearAllButton = $('clear-all');
    if (clearAllButton) {
      clearAllButton.addEventListener('click', async function() {
        if (!await LeHu.Modal.confirm(t('clear_confirm1'))) return;
        if (!await LeHu.Modal.confirm(t('clear_confirm2'))) return;
        try {
          await LeHu.clearAllData(storageType);
          cachedData = null;
          currentTodos = [];
          await saveTodos([]);
          try { indexedDB.deleteDatabase(DB_NAME); } catch (e) {}
          await renderNavLists();
          LeHu.Modal.alert(t('all_cleared'));
        } catch (error) {
          LeHu.Modal.alert(t('clear_failed') + error.message);
        }
      });
    }
  }

  // ===================== Message Listener =====================
  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'refresh') {
      rebookmark().then(function() {
        return renderNavLists();
      }).then(function() { sendResponse({ status: 'refreshed' }); });
      return true;
    }
  });

  // ===================== Todo =====================
  const TODO_COLORS = {1: '#ef4444', 2: '#f59e0b', 3: '#10b981'};
  let TODO_EDITING = null;
  let currentTodos = [];

  function loadTodos() {
    return new Promise(function(resolve) {
      chrome.storage.local.get({ todos: [] }, function(result) {
        var todos = result.todos || [];
        todos.sort(function(a, b) {
          if (a.d !== b.d) return a.d - b.d;
          var pa = a.c || 99;
          var pb = b.c || 99;
          if (pa !== pb) return pa - pb;
          return a.t - b.t;
        });
        resolve(todos);
      });
    });
  }

  function saveTodos(todos) {
    return new Promise(function(resolve) {
      chrome.storage.local.set({ todos: todos }, resolve);
    });
  }

  function formatTime(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    var now = new Date();
    var pad = function(n) { return n < 10 ? '0' + n : n; };
    if (d.getFullYear() === now.getFullYear()) {
      return pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }
    return pad(d.getFullYear() % 100) + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function renderTodoDialog(todos) {
    if (TODO_EDITING !== null) {
      currentTodos = todos;
      return;
    }
    const list = $('todo-list');
    if (!list) return;

    if (todos.length === 0) {
      list.innerHTML = '<div class="todo-empty">' + t('todo_empty') + '</div>';
    } else {
      let html = '';
      todos.forEach(function(todo, idx) {
        const c = TODO_COLORS[todo.c];
        const color = c ? ' style="border-left:3px solid ' + c + ';background:' + c + '1a"' : '';
        html += '<div class="todo-item"' + color + ' data-index="' + idx + '">' +
          '<input type="checkbox"' + (todo.d ? ' checked' : '') + '>' +
          '<span class="todo-text' + (todo.d ? ' done' : '') + '">' + LeHu.escapeHtml(todo.v) + '</span>' +
          '<span class="todo-time">' + formatTime(todo.t) + '</span>' +
          '<button class="todo-del" title="Delete">' +
          '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>' +
          '</svg></button>' +
          '</div>';
      });
      list.innerHTML = html;
    }

    document.querySelectorAll('.todo-text').forEach(function(el) {
      el.addEventListener('dblclick', function(e) {
        if (TODO_EDITING) return;
        var item = e.target.closest('.todo-item');
        var idx = parseInt(item.dataset.index);
        var todo = todos[idx];
        if (todo.d) return;
        TODO_EDITING = idx;
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'todo-edit-input';
        input.value = todo.v;
        input.dataset.idx = idx;
        e.target.replaceWith(input);
        input.focus();
        input.select();
        input.addEventListener('blur', finishEdit);
        input.addEventListener('keydown', function(ev) {
          if (ev.key === 'Enter') { input.blur(); }
          if (ev.key === 'Escape') { cancelEdit(idx, todo.v); }
        });
      });
    });
  }

  function finishEdit() {
    const ei = document.querySelector('.todo-edit-input');
    if (!ei) return;
    const idx = parseInt(ei.dataset.idx);
    const text = ei.value.trim();
    if (text && currentTodos[idx]) {
      currentTodos[idx].v = text;
      saveTodos(currentTodos).then(function() { renderTodoDialog(currentTodos); });
    } else {
      renderTodoDialog(currentTodos);
    }
    TODO_EDITING = null;
  }

  function cancelEdit(idx, originalText) {
    if (currentTodos[idx]) currentTodos[idx].v = originalText;
    TODO_EDITING = null;
    renderTodoDialog(currentTodos);
  }

  function bindTodoEvents() {
    const todoBtn = $('todo-btn');
    const dialog = $('todo-dialog');
    const overlay = $('todo-dialog-overlay');
    const input = $('todo-input');
    const addBtn = $('todo-add');
    const list = $('todo-list');
    const clearBtn = $('todo-clear-done');
    const closeBtn = $('todo-close');
    const colorBtns = document.querySelectorAll('.todo-color-btn');
    const badge = $('todo-badge');

    const exportBtn = $('todo-export');

    if (!todoBtn || !dialog) return;

    let selectedColor = '';

    if (exportBtn) {
      exportBtn.addEventListener('click', function() {
        loadTodos().then(function(todos) {
          var lines = ['"Level","Content","CreatedTime","DoneTime"'];
          todos.forEach(function(t) {
            var level = t.c || '';
            var v = (t.v || '').replace(/"/g, '""');
            var ctime = t.t ? new Date(t.t).toLocaleString() : '';
            var dtime = t.d ? new Date(t.d).toLocaleString() : '';
            lines.push('"' + level + '","' + v + '","' + ctime + '","' + dtime + '"');
          });
          var bom = '\uFEFF';
          var blob = new Blob([bom + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          var d = new Date();
          a.download = 'todos-' + d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0') + '.csv';
          a.click();
          URL.revokeObjectURL(url);
        });
      });
    }

    function updateBadge() {
      if (!badge) return;
      loadTodos().then(function(todos) {
        const count = todos.filter(function(t) { return !t.d; }).length;
        if (count > 0) { badge.textContent = count > 99 ? '99+' : count; badge.classList.remove('hidden'); }
        else { badge.classList.add('hidden'); }
      });
    }

    colorBtns.forEach(function(btn) {
      btn.addEventListener('click', function() {
        colorBtns.forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        selectedColor = parseInt(btn.dataset.value) || '';
      });
    });

    async function openDialog() {
      currentTodos = await loadTodos();
      renderTodoDialog(currentTodos);
      dialog.classList.remove('hidden');
      if (overlay) overlay.classList.remove('hidden');
      if (input) { input.value = ''; input.focus(); }
      colorBtns.forEach(function(b) { b.classList.remove('active'); });
      selectedColor = '';
      updateBadge();
    }

    function closeDialog() {
      dialog.classList.add('hidden');
      if (overlay) overlay.classList.add('hidden');
    }

    todoBtn.addEventListener('click', openDialog);

    if (closeBtn) {
      closeBtn.addEventListener('click', closeDialog);
    }

    if (addBtn) {
      addBtn.addEventListener('click', async function() {
        var text = input && input.value.trim();
        if (!text) return;
        var todo = { v: text, d: '', t: Date.now() };
        if (selectedColor) todo.c = selectedColor;
        currentTodos.push(todo);
        currentTodos.sort(function(a, b) {
          if (a.d !== b.d) return a.d - b.d;
          var pa = a.c || 99;
          var pb = b.c || 99;
          if (pa !== pb) return pa - pb;
          return a.t - b.t;
        });
        input.value = '';
        colorBtns.forEach(function(b) { b.classList.remove('active'); });
        selectedColor = '';
        await saveTodos(currentTodos);
        renderTodoDialog(currentTodos);
        input.focus();
        updateBadge();
      });
    }

    if (input) {
      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { addBtn && addBtn.click(); }
      });
    }

    if (list) {
      list.addEventListener('change', async function(e) {
        if (e.target.type === 'checkbox') {
          var idx = parseInt(e.target.closest('.todo-item').dataset.index);
          if (isNaN(idx)) return;
          currentTodos[idx].d = e.target.checked ? Date.now() : '';
          currentTodos.sort(function(a, b) {
            if (a.d !== b.d) return a.d - b.d;
            var pa = a.c || 99;
            var pb = b.c || 99;
            if (pa !== pb) return pa - pb;
            return a.t - b.t;
          });
          await saveTodos(currentTodos);
          renderTodoDialog(currentTodos);
          updateBadge();
        }
      });

      list.addEventListener('click', async function(e) {
        if (e.target.closest('.todo-del')) {
          var idx = parseInt(e.target.closest('.todo-item').dataset.index);
          if (isNaN(idx)) return;
          currentTodos.splice(idx, 1);
          await saveTodos(currentTodos);
          renderTodoDialog(currentTodos);
          updateBadge();
        }
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', async function() {
        currentTodos = currentTodos.filter(function(t) { return !t.d; });
        await saveTodos(currentTodos);
        renderTodoDialog(currentTodos);
        updateBadge();
      });
    }
  }

  // ===================== Initialization =====================
  document.addEventListener('DOMContentLoaded', async function() {
    const data = await loadData();
    if (data.setting) {
      if (data.setting.amapKey) amapKey = data.setting.amapKey;
      if (data.setting.dutyApiUrl) dutyApiUrl = data.setting.dutyApiUrl;
      if (data.setting.dutyApiKey) dutyApiKey = data.setting.dutyApiKey;
    }

    // 先渲染关键 UI
    loadBookmarks();
    await renderNavLists();

    // 事件绑定（不影响渲染）
    LeHu.applyI18n();
    bindMenuToggle();
    bindStorageToggle();
    bindToggleEdit();
    bindLinkOperations();
    bindImport();
    bindExport();
    bindImportBookmarks();
    bindSearch();
    bindSettingsDialog();
    bindTodoEvents();

    // 初始角标
    loadTodos().then(function(todos) {
      const badge = $('todo-badge');
      if (!badge) return;
      const count = todos.filter(function(t) { return !t.d; }).length;
      if (count > 0) { badge.textContent = count > 99 ? '99+' : count; badge.classList.remove('hidden'); }
    });

    if (window.location.pathname.endsWith('newtab.html')) {
      updateTime();
      setInterval(updateTime, 1000);
    }

    // 网络 IO 不必阻塞 UI
    if (data.setting) applySettings(data.setting);
    if (window.location.pathname.endsWith('newtab.html')) {
      fetchPoetry();
      fetchWeather();
      fetchDutyInfo();
    }
  });

})();
