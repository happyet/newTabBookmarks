// newtab.js - New Tab Page Script

// Global state
let isEditMode = false;
let draggedItem = null;
let bookmarks = [];
let storageType = 'sync'; // Storage type: sync or local
let translations = {}; // Store translations

// Color cache - same name generates same color
const colorCache = new Map();

/**
 * Apply i18n to the page
 */
async function applyI18n() {
  translations = await chrome.runtime.sendMessage({ action: 'getTranslations' });
  
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (translations[key]) {
      el.textContent = translations[key];
    }
  });
  
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (translations[key]) {
      el.placeholder = translations[key];
    }
  });
  
  document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
    const key = el.getAttribute('data-i18n-aria-label');
    if (translations[key]) {
      el.setAttribute('aria-label', translations[key]);
    }
  });
  
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    if (translations[key]) {
      el.title = translations[key];
    }
  });
}

/**
 * Get localized message
 * @param {string} key 
 * @returns {string}
 */
function getMessage(key) {
  return translations[key] || key;
}

/**
 * Get current storage API
 * @returns {Object}
 */
function getStorage() {
  return storageType === 'local' ? chrome.storage.local : chrome.storage.sync;
}

/**
 * Load data from storage
 * @returns {Promise<Object>}
 */
async function loadData() {
  // Get storage type setting first
  const storageSettings = await chrome.storage.sync.get({ storageType: 'sync' });
  const savedStorageType = storageSettings.storageType || 'sync';
  storageType = savedStorageType;
  
  const storage = getStorage();
  
  if (savedStorageType === 'sync') {
    // Sync mode: check for chunked storage
    const allData = await storage.get(null);
    
    if (allData._chunkInfo) {
      // Rebuild navigation from chunks
      const navigation = {};
      for (const key of Object.keys(allData)) {
        if (key.startsWith('nav_')) {
          const category = key.substring(4);
          navigation[category] = allData[key];
        }
      }
      
      return {
        navigation: navigation,
        categoryOrder: allData.categoryOrder || [],
        setting: allData.setting || {}
      };
    }
  }
  
  // Local mode or old sync data: read directly
  return await storage.get({
    navigation: {},
    categoryOrder: [],
    setting: {}
  });
}

async function saveData(data) {
  const storage = getStorage();
  const isSync = storageType === 'sync';
  
  try {
    if (isSync) {
      // Sync mode: split navigation by category to avoid size limit
      await storage.remove(['navigation', 'categoryOrder', 'setting', '_chunkInfo']);
      
      const storageData = {};
      
      if (data.navigation) {
        for (const [category, links] of Object.entries(data.navigation)) {
          const key = `nav_${category}`;
          storageData[key] = links;
        }
      }
      
      if (data.categoryOrder) storageData.categoryOrder = data.categoryOrder;
      if (data.setting) storageData.setting = data.setting;
      storageData._chunkInfo = { version: 1, totalCategories: Object.keys(data.navigation || {}).length };
      
      await storage.set(storageData);
    } else {
      // Local mode: store directly
      await storage.set({
        navigation: data.navigation,
        categoryOrder: data.categoryOrder,
        setting: data.setting
      });
    }
  } catch (error) {
    throw error;
  }
}

/**
 * Generate consistent color from string
 * @param {string} str 
 * @returns {string}
 */
function getConsistentColor(str) {
  if (colorCache.has(str)) {
    return colorCache.get(str);
  }
  
  // Use simple hash algorithm to generate color
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  // Generate soft colors (avoid too dark or too bright)
  const h = Math.abs(hash % 360);
  const s = 60 + (Math.abs(hash) % 20); // 60-80%
  const l = 45 + (Math.abs(hash) % 20);  // 45-65%
  
  const color = `hsl(${h}, ${s}%, ${l}%)`;
  colorCache.set(str, color);
  return color;
}

/**
 * Get DOM element
 * @param {string} id 
 * @returns {HTMLElement}
 */
function $(id) {
  return document.getElementById(id);
}

/**
 * Render navigation lists
 */
async function renderNavLists() {
  const data = await loadData();
  const catsListDiv = $('categories');
  const navListDiv = $('nav-list');
  
  if (!catsListDiv || !navListDiv) return;
  
  navListDiv.innerHTML = '';
  catsListDiv.innerHTML = '<ul></ul>';

  data.categoryOrder.forEach(category => {
    const categoryDiv = document.createElement('div');
    categoryDiv.className = 'category';
    categoryDiv.draggable = isEditMode;
    categoryDiv.dataset.category = category;
    
    // Category title section
    const titleHtml = isEditMode
      ? `<input type="text" class="category-name-input" value="${escapeHtml(category)}" data-old-category="${escapeHtml(category)}">`
      : `<h2 id="${category}">${category}</h2>`;
    
    categoryDiv.innerHTML = `
      <div class="category-header">
        ${titleHtml}
        ${isEditMode ? `<button class="save-category-btn" data-old-category="${escapeHtml(category)}" data-i18n="save_button">Save</button>` : ''}
        ${isEditMode ? `<button class="delete-category-btn" data-category="${escapeHtml(category)}" data-i18n="delete_category">Delete Category</button>` : ''}
      </div>`;
      
    const linksDiv = document.createElement('div');
    linksDiv.className = 'links';

    const links = data.navigation[category] || [];
    links.forEach((link, index) => {
      const linkDiv = createLinkElement(link, category, index);
      linksDiv.appendChild(linkDiv);
    });

    categoryDiv.appendChild(linksDiv);
    navListDiv.appendChild(categoryDiv);
    
    catsListDiv.querySelector('ul').innerHTML += 
      `<li class="category-item" data-category="${category}"><span>${category}</span></li>`;
  });

  // Add drag events in edit mode
  if (isEditMode) {
    addDragEvents(navListDiv);
  }

  // Update button visibility
  updateButtonVisibility();
  
  // Apply settings
  if (data.setting) {
    applySettings(data.setting);
  }

  // Bind category click events
  bindCategoryClick();
  
  // Re-apply i18n for dynamic content
  setTimeout(() => applyI18n(), 0);
}

/**
 * Create link element
 * @param {Object} link 
 * @param {string} category 
 * @param {number} index 
 * @returns {HTMLElement}
 */
function createLinkElement(link, category, index) {
  const linkDiv = document.createElement('div');
  linkDiv.className = 'link';
  linkDiv.draggable = isEditMode;
  linkDiv.dataset.category = category;
  linkDiv.dataset.index = index;
  
  const firstChar = link.name.charAt(0);
  const color = getConsistentColor(link.name);
  
  linkDiv.innerHTML = `
    <a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">
      ${link.icon 
        ? `<img class="link-logo" src="${escapeHtml(link.icon)}" alt="${escapeHtml(link.name)}">` 
        : `<span class="link-logo" style="background-color: ${color};">${escapeHtml(firstChar)}</span>`}
      <div>
        <span class="link-name">${escapeHtml(link.name)}</span>
        ${link.desc ? `<span class="link-desc">${escapeHtml(link.desc)}</span>` : ''}
      </div>
    </a>
    ${isEditMode ? `
      <div class="link-edit">
        <button class="edit-link" data-category="${category}" data-index="${index}" data-i18n="edit_link">Edit</button>
        <button class="delete-link" data-category="${category}" data-index="${index}" data-i18n="delete_link">Delete</button>
      </div>
    ` : ''}
  `;
  
  return linkDiv;
}

/**
 * HTML escape to prevent XSS
 * @param {string} str 
 * @returns {string}
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Update button visibility
 */
function updateButtonVisibility() {
  const importButton = $('import-json');
  const exportButton = $('export-json');
  const settingButton = $('setting');
  const toggleButton = $('toggle-edit');
  
  if (importButton) importButton.classList.toggle('visible', isEditMode);
  if (exportButton) exportButton.classList.toggle('visible', isEditMode);
  if (settingButton) settingButton.classList.toggle('visible', isEditMode);
  if (toggleButton){
    toggleButton.textContent = isEditMode ? getMessage('done_button') : getMessage('edit_button');
    toggleButton.setAttribute('data-i18n', isEditMode ? 'done_button' : 'edit_button');
  }
}

/**
 * Apply settings
 * @param {Object} settings 
 */
function applySettings(settings) {
  if (!settings) return;

  // Set title
  if (settings.title) {
    document.title = settings.title;
    const titleEl = $('site-title');
    if (titleEl) titleEl.textContent = settings.title;
  }

  // Set background color
  const leftPanel = document.querySelector('.wrapper-left');
  const rightPanel = document.querySelector('.wrapper-right');
  const poemContent = document.querySelector('.poem_content');
  
  if (settings.backgroundColor && settings.backgroundOpacity !== undefined) {
    const rgbColor = hexToRgb(settings.backgroundColor);
    if (rgbColor) {
      const rgbaColor = `rgba(${rgbColor.r}, ${rgbColor.g}, ${rgbColor.b}, ${settings.backgroundOpacity})`;
      if (leftPanel) leftPanel.style.backgroundColor = rgbaColor;
      if (rightPanel) rightPanel.style.background = `linear-gradient(45deg, ${rgbaColor}, transparent 80%)`;
      if (poemContent) poemContent.style.color = 'rgba(255, 255, 255, 0.8)';
    }
  } else {
    if (leftPanel) leftPanel.style.backgroundColor = '';
    if (rightPanel) rightPanel.style.background = '';
    if (poemContent) poemContent.style.color = '';
  }

  // Set background image
  if (settings.useBingImage) {
    chrome.runtime.sendMessage({ action: 'fetchBingImageUrl' }, (response) => {
      if (response?.imageUrl) {
        setBackgroundStyle(response.imageUrl);
      } else {
        clearBackgroundStyle();
      }
    });
  } else if (settings.backgroundImage) {
    setBackgroundStyle(settings.backgroundImage);
  } else {
    clearBackgroundStyle();
  }
}

/**
 * HEX color to RGB
 * @param {string} hex 
 * @returns {Object|null}
 */
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

/**
 * Set background image
 * @param {string} imageUrl 
 */
function setBackgroundStyle(imageUrl) {
  let bgImg = document.querySelector('.background-img');
  
  if (!bgImg) {
    bgImg = document.createElement('img');
    bgImg.className = 'background-img';
    bgImg.alt = 'Background Image';
    document.body.insertBefore(bgImg, document.body.firstChild);
  }
  
  bgImg.src = imageUrl;
}

/**
 * Clear background image
 */
function clearBackgroundStyle() {
  const bgImg = document.querySelector('.background-img');
  if (bgImg) {
    bgImg.remove();
  }
}

// ============ Drag and Drop ============

/**
 * Add drag events
 * @param {HTMLElement} container 
 */
function addDragEvents(container) {
  container.addEventListener('dragstart', handleDragStart);
  container.addEventListener('dragover', handleDragOver);
  container.addEventListener('drop', handleDrop);
  container.addEventListener('dragend', handleDragEnd);
}

/**
 * Drag start
 * @param {DragEvent} e 
 */
function handleDragStart(e) {
  draggedItem = e.target.closest('.link, .category');
  if (draggedItem) {
    draggedItem.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', '');
  }
}

/**
 * Drag over
 * @param {DragEvent} e 
 */
function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  
  const target = e.target.closest('.category, .link');
  if (target && target !== draggedItem && draggedItem) {
    if (!draggedItem.contains(target)) {
      const rect = target.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      
      if (e.clientY < midpoint) {
        target.parentNode.insertBefore(draggedItem, target);
      } else {
        target.parentNode.insertBefore(draggedItem, target.nextSibling);
      }
    }
  }
}

/**
 * Drag drop
 * @param {DragEvent} e 
 */
async function handleDrop(e) {
  e.preventDefault();
  if (draggedItem) {
    draggedItem.classList.remove('dragging');
    await saveNavigationOrder();
    draggedItem = null;
  }
}

/**
 * Drag end
 */
function handleDragEnd() {
  if (draggedItem) {
    draggedItem.classList.remove('dragging');
    draggedItem = null;
  }
}

/**
 * Save navigation order
 */
async function saveNavigationOrder() {
  const navListDiv = $('nav-list');
  const data = await loadData();
  
  // Update category order - support edit mode and normal mode
  const updatedOrder = Array.from(navListDiv.children)
    .filter(div => div.classList.contains('category'))
    .map(div => {
      // Get category name from input first (edit mode)
      const input = div.querySelector('.category-name-input');
      if (input) return input.value;
      // Otherwise get from h2 (normal mode)
      return div.querySelector('h2')?.innerText;
    })
    .filter(Boolean);
  
  data.categoryOrder = updatedOrder;

  // Update link order
  navListDiv.querySelectorAll('.category').forEach(categoryDiv => {
    // Support getting category name in edit mode and normal mode
    const input = categoryDiv.querySelector('.category-name-input');
    const category = input ? input.value : categoryDiv.querySelector('h2')?.innerText;
    if (!category) return;
    
    const links = Array.from(categoryDiv.querySelectorAll('.link')).map(linkDiv => {
      const linkName = linkDiv.querySelector('.link-name')?.innerText;
      const linkUrl = linkDiv.querySelector('a')?.href;
      const linkIcon = linkDiv.querySelector('a img')?.src || '';
      const linkDesc = linkDiv.querySelector('.link-desc')?.innerText || '';
      
      return { name: linkName, url: linkUrl, icon: linkIcon, desc: linkDesc };
    });

    if (links.length === 0) {
      delete data.navigation[category];
    } else {
      data.navigation[category] = links;
    }
  });

  await saveData(data);
  await loadBookmarks();
}

// ============ Event Handling ============

/**
 * Bind edit mode toggle
 */
function bindToggleEdit() {
  const toggleButton = $('toggle-edit');
  if (toggleButton) {
    toggleButton.addEventListener('click', async () => {
      isEditMode = !isEditMode;
      await renderNavLists();
    });
  }
}

/**
 * Bind storage mode toggle
 */
function bindStorageToggle() {
  const storageButton = $('storage-toggle');
  if (!storageButton) return;
  
  // Initialize button text based on current storage type
  updateStorageButtonText(storageButton);
  
  storageButton.addEventListener('click', async () => {
    // Toggle storage mode
    const newStorageType = storageType === 'local' ? 'sync' : 'local';
    
    // Confirm switch
    const confirmMsg = newStorageType === 'local' 
      ? getMessage('switch_storage_confirm') 
      : getMessage('switch_storage_confirm2');
    if (!confirm(confirmMsg)) {
      return;
    }
    
    // Update local variable and button text immediately
    const oldStorageType = storageType;
    storageType = newStorageType;
    updateStorageButtonText(storageButton);
    
    // Try to save storage type
    try {
      await chrome.storage.sync.set({ storageType: newStorageType });
    } catch (error) {
      // If save fails, revert changes
      storageType = oldStorageType;
      updateStorageButtonText(storageButton);
      alert('保存存储模式失败：' + error.message);
      return;
    }
    
    // Small delay to show the updated text before reload
    await new Promise(resolve => setTimeout(resolve, 100));

    // Refresh page
    location.reload();
  });
}

/**
 * Update storage toggle button text
 * @param {HTMLElement} button 
 */
function updateStorageButtonText(button) {
  if (!button) return;
  const key = storageType === 'local' ? 'local_mode_button' : 'sync_mode_button';
  button.setAttribute('data-i18n', key);
  const text = translations[key] || key;
  button.textContent = text;
}

/**
 * Bind link operations (delete/edit)
 */
function bindLinkOperations() {
  const navListDiv = $('nav-list');
  if (!navListDiv) return;

  navListDiv.addEventListener('click', async (e) => {
    const target = e.target;
    
    // Save category name
    if (target.classList.contains('save-category-btn')) {
      const oldCategory = target.dataset.oldCategory;
      const categoryInput = target.parentElement.querySelector('.category-name-input');
      const newCategory = categoryInput.value.trim();
      
      if (!newCategory) {
        alert(getMessage('category_empty_error'));
        categoryInput.value = oldCategory;
        return;
      }
      
      if (newCategory === oldCategory) {
        return;
      }
      
      const data = await loadData();
      
      if (data.navigation[newCategory]) {
        alert(getMessage('category_exists_error'));
        categoryInput.value = oldCategory;
        return;
      }
      
      data.navigation[newCategory] = data.navigation[oldCategory];
      delete data.navigation[oldCategory];
      
      const oldIndex = data.categoryOrder.indexOf(oldCategory);
      if (oldIndex !== -1) {
        data.categoryOrder[oldIndex] = newCategory;
      }
      
      await saveData(data);
      await renderNavLists();
      alert(getMessage('category_updated'));
      return;
    }
    
    // Delete entire category
    if (target.classList.contains('delete-category-btn')) {
      const category = target.dataset.category;
      
      const confirmMsg = getMessage('delete_category_confirm').replace('{category}', category);
      if (!confirm(confirmMsg)) {
        return;
      }
      
      const data = await loadData();
      
      // Delete category and all bookmarks
      delete data.navigation[category];
      data.categoryOrder = data.categoryOrder.filter(cat => cat !== category);
      
      await saveData(data);
      await renderNavLists();
      await loadBookmarks();
      return;
    }
    
    // Delete link
    if (target.classList.contains('delete-link')) {
      const category = target.dataset.category;
      const index = parseInt(target.dataset.index);
      
      const data = await loadData();
      data.navigation[category].splice(index, 1);
      
      // If category is empty, delete category
      if (data.navigation[category].length === 0) {
        delete data.navigation[category];
        data.categoryOrder = data.categoryOrder.filter(cat => cat !== category);
      }
      
      await saveData(data);
      await renderNavLists();
      await loadBookmarks();
    }
    
    // Edit link
    if (target.classList.contains('edit-link')) {
      const category = target.dataset.category;
      const index = parseInt(target.dataset.index);
      
      const data = await loadData();
      const link = data.navigation[category][index];
      
      const newName = prompt(getMessage('edit_link_name'), link.name);
      if (newName === null) return;
      
      const newUrl = prompt(getMessage('edit_link_url'), link.url);
      if (newUrl === null) return;
      
      const newIcon = prompt(getMessage('edit_link_icon'), link.icon);
      const newDesc = prompt(getMessage('edit_link_desc'), link.desc);
      
      if (newName && newUrl) {
        data.navigation[category][index] = {
          name: newName || link.name,
          url: newUrl || link.url,
          icon: newIcon !== null ? newIcon : link.icon,
          desc: newDesc !== null ? newDesc : link.desc
        };
        
        await saveData(data);
        await renderNavLists();
        await loadBookmarks();
      }
    }
  });
}

/**
 * Bind import function
 */
function bindImport() {
  const importButton = $('import-json');
  if (!importButton) return;
  
  importButton.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      
      try {
        const text = await file.text();
        const jsonData = JSON.parse(text);
        
        if (jsonData.navigation && jsonData.categoryOrder) {
          await saveData(jsonData);
          await renderNavLists();
          await loadBookmarks();
          alert(getMessage('import_success'));
        } else {
          alert(getMessage('import_invalid_format'));
        }
      } catch (error) {
        alert(getMessage('import_failed') + error.message);
      }
    };
    
    input.click();
  });
}

/**
 * 绑定导出功能
 */
function bindExport() {
  const exportButton = $('export-json');
  if (!exportButton) return;
  
  exportButton.addEventListener('click', async () => {
    const data = await loadData();
    const jsonString = JSON.stringify(data, null, 2);
    
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = 'links.json';
    a.click();
    
    URL.revokeObjectURL(url);
  });
}

/**
 * Extract all bookmark links from bookmark tree
 * @param {Array} nodes Bookmark node array
 * @returns {Array} Bookmark link array
 */
function extractBookmarks(nodes) {
  const bookmarks = [];
  
  for (const node of nodes) {
    if (node.url) {
      bookmarks.push({
        name: node.title || 'Untitled',
        url: node.url,
        icon: '',
        desc: ''
      });
    }
    if (node.children) {
      bookmarks.push(...extractBookmarks(node.children));
    }
  }
  
  return bookmarks;
}

/**
 * Extract domain from URL as fallback title
 * @param {string} url 
 * @returns {string}
 */
function extractDomain(url) {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace('www.', '');
  } catch {
    return 'Untitled';
  }
}

/**
 * Import browser bookmarks
 */
async function importFromBookmarks() {
  // Make sure to get the latest storage type setting first
  await loadData();
  
  // Get bookmarks through background script
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getBookmarks' });
    
    if (response?.error) {
      throw new Error(response.error);
    }
    
    // search API returns array format
    const bookmarksArray = response?.bookmarks;
    
    if (!bookmarksArray || !Array.isArray(bookmarksArray) || bookmarksArray.length === 0) {
      throw new Error('No browser bookmarks found, please add some bookmarks in the browser bookmark bar first');
    }
    
    // Convert to unified format, preserve original fields
    const allBookmarks = bookmarksArray
      .filter(b => b.url) // Only keep bookmarks with URL
      .map(b => ({
        title: b.title || '',  // Preserve original title
        url: b.url,
        folder: b.folder || '',  // Preserve original category
        name: b.title || '',  // Name for display
        icon: '',
        desc: ''
      }));
    
    if (allBookmarks.length === 0) {
      return { imported: 0, data: null };
    }
    
    // Collect all existing URLs for global deduplication
    const data = await loadData();
    const existingUrls = new Set();
    for (const links of Object.values(data.navigation || {})) {
      for (const link of links) {
        existingUrls.add(link.url);
      }
    }
    
    // Group by browser original category, with global deduplication
    const grouped = {};
    let skippedCount = 0;
    
    for (const bookmark of allBookmarks) {
      const category = bookmark.folder || 'Uncategorized';
      
      // Process title and description: split if - or | exists
      let title = bookmark.title || '';
      let desc = '';
      
      if (title) {
        // Find separator - or |
        const dashIndex = title.indexOf(' - ');
        const pipeIndex = title.indexOf(' | ');
        const downIndex = title.indexOf(' _ ');
        
        if (dashIndex > 0) {
          title = title.substring(0, dashIndex).trim();
          desc = bookmark.title.substring(dashIndex + 3).trim();
        } else if (pipeIndex > 0) {
          title = title.substring(0, pipeIndex).trim();
          desc = bookmark.title.substring(pipeIndex + 3).trim();
        } else if (downIndex > 0) {
          title = title.substring(0, downIndex).trim();
          desc = bookmark.title.substring(downIndex + 3).trim();
        }
      }
      
      // If title is empty, use domain
      if (!title || title.trim() === '') {
        title = extractDomain(bookmark.url);
      }
      
      const url = bookmark.url;
      
      // Global deduplication check
      if (existingUrls.has(url)) {
        skippedCount++;
        continue;
      }
      
      existingUrls.add(url);
      
      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push({
        name: title,
        url: url,
        icon: '',
        desc: desc
      });
    }
    
    // Convert to plugin data format
    const navigation = {};
    const categoryOrder = [];
    
    // Import limit based on storage type setting
    const limit = storageType === 'local' ? 500 : 30; // local: unlimited, sync: limited
    
    for (const [category, links] of Object.entries(grouped)) {
      navigation[category] = links.slice(0, limit);
      categoryOrder.push(category);
    }
    
    return { imported: allBookmarks.length, skipped: skippedCount || 0, navigation, categoryOrder };
  } catch (error) {
    throw new Error('Failed to get bookmarks: ' + error.message);
  }
}

/**
 * Bind bookmark import function
 */
function bindImportBookmarks() {
  const importBookmarksButton = $('import-bookmarks');
  if (!importBookmarksButton) return;
  
  importBookmarksButton.addEventListener('click', async () => {
    try {
      const result = await importFromBookmarks();
      
      if (result.imported === 0) {
        alert(getMessage('no_bookmarks'));
        return;
      }
      
      const data = await loadData();
      const existingCategories = Object.keys(data.navigation);
      
      const choiceMsg = getMessage('import_method_title').replace('{count}', result.imported);
      const choice = confirm(choiceMsg);
      
      if (choice) {
        let targetCategory = '';
        
        if (existingCategories.length > 0) {
          const catMsg = getMessage('existing_categories').replace('{categories}', existingCategories.join(', '));
          targetCategory = prompt(catMsg) || '';
        } else {
          targetCategory = prompt(getMessage('enter_new_category')) || '';
        }
        
        if (!targetCategory) {
          alert(getMessage('import_cancelled'));
          return;
        }
        
        if (!data.navigation[targetCategory]) {
          data.navigation[targetCategory] = [];
          data.categoryOrder.push(targetCategory);
        }
        
        let addedCount = 0;
        for (const [category, links] of Object.entries(result.navigation)) {
          if (!data.navigation[targetCategory]) {
            data.navigation[targetCategory] = [];
            data.categoryOrder.push(targetCategory);
          }
          for (const link of links) {
            data.navigation[targetCategory].push(link);
            addedCount++;
          }
        }
        
        if (addedCount > 0) {
          await saveData(data);
          await renderNavLists();
          await loadBookmarks();
          const skippedMsg = result.skipped > 0 
            ? getMessage('skipped_duplicates').replace('{count}', result.skipped)
            : '';
          const successMsg = getMessage('imported_to_category').replace('{count}', addedCount).replace('{category}', targetCategory).replace('{skipped}', skippedMsg);
          alert(successMsg);
        } else {
          alert(getMessage('all_exists'));
        }
      } else {
        for (const [category, links] of Object.entries(result.navigation)) {
          if (!data.navigation[category]) {
            data.navigation[category] = [];
            data.categoryOrder.push(category);
          }
          for (const link of links) {
            data.navigation[category].push(link);
          }
        }
        
        await saveData(data);
        await renderNavLists();
        await loadBookmarks();
        const skippedMsg = result.skipped > 0 
          ? getMessage('skipped_duplicates').replace('{count}', result.skipped)
          : '';
        const successMsg = getMessage('import_by_category').replace('{skipped}', skippedMsg);
        alert(successMsg);
      }
      
    } catch (error) {
      console.error('Import failed details:', error);
      alert(getMessage('import_failed') + error.message);
    }
  });
}

/**
 * Bind search function
 */
function bindSearch() {
  const searchInput = $('search-input');
  if (!searchInput) return;
  
  searchInput.addEventListener('input', searchBookmarks);
  searchInput.addEventListener('focus', () => {
    if (searchInput.value) {
      searchBookmarks();
    }
  });
  searchInput.addEventListener('blur', () => {
    setTimeout(() => {
      const results = $('search-results');
      if (results) results.innerHTML = '';
    }, 200);
  });
}

/**
 * Search bookmarks
 */
function searchBookmarks() {
  const query = $('search-input')?.value.toLowerCase() || '';
  const resultsList = $('search-results');
  
  if (!resultsList) return;
  
  resultsList.innerHTML = '';

  if (!query) {
    resultsList.hidden = true;
    return;
  }

  const filteredBookmarks = bookmarks.filter(bookmark => 
    bookmark.name.toLowerCase().includes(query) ||
    (bookmark.url && bookmark.url.toLowerCase().includes(query)) ||
    (bookmark.desc && bookmark.desc.toLowerCase().includes(query))
  );

  if (filteredBookmarks.length === 0) {
    resultsList.hidden = true;
    return;
  }

  resultsList.hidden = false;

  filteredBookmarks.forEach(bookmark => {
    const li = document.createElement('li');
    li.innerHTML = `
      <a href="${escapeHtml(bookmark.url)}" target="_blank" rel="noopener noreferrer">
        ${escapeHtml(bookmark.name)}
        ${bookmark.desc ? `<span>${escapeHtml(bookmark.desc)}</span>` : ''}
      </a>
    `;
    resultsList.appendChild(li);
  });
}

/**
 * Load bookmark data
 */
async function loadBookmarks() {
  try {
    const data = await loadData();
    bookmarks = [];
    
    data.categoryOrder.forEach(categoryName => {
      const links = data.navigation[categoryName] || [];
      links.forEach(link => {
        bookmarks.push({ name: link.name, url: link.url, desc: link.desc });
      });
    });
  } catch (error) {
    console.error('Failed to load bookmarks:', error);
  }
}

/**
 * Bind category click
 */
function bindCategoryClick() {
  const categoriesList = $('categories');
  if (!categoriesList) return;
  
  categoriesList.addEventListener('click', (event) => {
    const target = event.target.closest('.category-item');
    if (!target) return;
    
    const category = target.dataset.category;
    const targetElement = $(category);
    
    if (!targetElement) return;
    
    if (window.innerWidth < 768) {
      const targetOffsetTop = targetElement.getBoundingClientRect().top + window.pageYOffset - 80;
      window.scrollTo({ top: targetOffsetTop, behavior: 'smooth' });
    } else {
      targetElement.scrollIntoView({ behavior: 'smooth' });
    }
  });
}

/**
 * Bind settings dialog
 */
function bindSettingsDialog() {
  const settingButton = $('setting');
  const settingsDialog = $('settings-dialog');
  const saveSettingsButton = $('save-settings');
  const cancelSettingsButton = $('cancel-settings');
  
  if (!settingButton || !settingsDialog) return;
  
  // Show settings dialog
  settingButton.addEventListener('click', async () => {
    const storage = getStorage();
    const data = await storage.get({ setting: {} });
    const settings = data.setting || {};
    
    $('title').value = settings.title || '';
    $('background-image').value = settings.backgroundImage || '';
    $('background-color').value = settings.backgroundColor || '#334455';
    $('background-opacity').value = settings.backgroundOpacity ?? 0.8;
    $('use-bing-image').checked = settings.useBingImage || false;
    
    settingsDialog.classList.remove('hidden');
    $('settings-dialog-overlay').classList.remove('hidden');
  });
  
  // Save settings
  saveSettingsButton?.addEventListener('click', async () => {
    const settings = {
      title: $('title').value,
      backgroundImage: $('background-image').value,
      backgroundColor: $('background-color').value,
      backgroundOpacity: parseFloat($('background-opacity').value) || 0.8,
      useBingImage: $('use-bing-image').checked
    };
    
    const storage = getStorage();
    await storage.set({ setting: settings });
    
    applySettings(settings);
    settingsDialog.classList.add('hidden');
    $('settings-dialog-overlay').classList.add('hidden');
    
    const storageLabel = storageType === 'local' ? getMessage('local_storage') : getMessage('sync_storage');
    const msg = getMessage('settings_saved').replace('{sync}', storageLabel);
    alert(msg);
  });
  
  // Cancel settings
  cancelSettingsButton?.addEventListener('click', () => {
    settingsDialog.classList.add('hidden');
    $('settings-dialog-overlay').classList.add('hidden');
  });
  
  // Clear all bookmarks
  const clearAllButton = $('clear-all');
  clearAllButton?.addEventListener('click', async () => {
    if (!confirm(getMessage('clear_confirm1'))) {
      return;
    }
    
    if (!confirm(getMessage('clear_confirm2'))) {
      return;
    }
    
    const storage = getStorage();
    
    try {
      if (storageType === 'sync') {
        // Sync mode: remove all chunked keys
        const allData = await storage.get(null);
        const keysToRemove = Object.keys(allData).filter(key => 
          key === 'navigation' || 
          key === 'categoryOrder' || 
          key === 'setting' ||
          key === '_chunkInfo' ||
          key.startsWith('nav_')
        );
        if (keysToRemove.length > 0) {
          await storage.remove(keysToRemove);
        }
      } else {
        // Local mode: remove directly
        await storage.remove(['navigation', 'categoryOrder', 'setting']);
      }
      
      await renderNavLists();
      await loadBookmarks();
      
      alert(getMessage('all_cleared'));
      settingsDialog.classList.add('hidden');
      $('settings-dialog-overlay').classList.add('hidden');
    } catch (error) {
      alert(getMessage('clear_failed') + error.message);
    }
  });
}

// ============ Time Display ============

/**
 * Update time display
 */
function updateTime() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const date = String(now.getDate()).padStart(2, '0');
  const weekdays = translations.time_format?.includes('星期') 
    ? ['日', '一', '二', '三', '四', '五', '六']
    : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const weekday = weekdays[now.getDay()];
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  
  const dateEl = $('current-date');
  const timeEl = $('current-time');
  
  if (dateEl) dateEl.textContent = `${year}-${month}-${date}`;
  if (timeEl) timeEl.textContent = `${weekday} ${hours}:${minutes}:${seconds}`;
}

// ============ Poetry Feature ============

/**
 * Get daily poetry
 */
async function fetchPoetry() {
  try {
    const response = await fetch('https://v2.jinrishici.com/one.json?client=browser-sdk/1.2');
    
    if (!response.ok) {
      throw new Error('Network response failed');
    }
    
    const data = await response.json();
    const sentenceEl = $('poem_sentence');
    const infoEl = $('poem_info');
    
    if (sentenceEl) sentenceEl.textContent = data.data.content;
    if (infoEl) infoEl.textContent = `[${data.data.origin.dynasty}] ${data.data.origin.author} "${data.data.origin.title}"`;
    
  } catch (error) {
    console.error('Failed to get poetry:', error);
    const sentenceEl = $('poem_sentence');
    if (sentenceEl) sentenceEl.textContent = getMessage('poem_no_data');
  }
}

// ============ Message Listener ============

/**
 * Listen for messages
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'refresh') {
    renderNavLists().then(() => sendResponse({ status: 'refreshed' }));
    return true;
  }
});

// ============ Initialization ============

document.addEventListener('DOMContentLoaded', async () => {
  // Load data first to get storage type
  const data = await loadData();
  
  // Apply i18n after storage type is loaded
  await applyI18n();
  
  // Bind storage toggle button after translations are ready
  bindStorageToggle();
  
  // Bind all events
  bindToggleEdit();
  bindLinkOperations();
  bindImport();
  bindExport();
  bindImportBookmarks();
  bindSearch();
  bindSettingsDialog();
  
  // Apply settings
  if (data.setting) {
    applySettings(data.setting);
  }
  
  // Load data
  loadBookmarks();
  renderNavLists();
  
  // Start timer
  if (window.location.pathname.endsWith('newtab.html')) {
    updateTime();
    setInterval(updateTime, 1000);
    fetchPoetry();
  }
});
