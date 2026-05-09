// popup.js - Popup script

/**
 * Apply i18n to the page
 */
async function applyI18n() {
  const messages = await chrome.runtime.sendMessage({ action: 'getTranslations' });
  
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (messages[key]) {
      el.textContent = messages[key];
    }
  });
  
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (messages[key]) {
      el.placeholder = messages[key];
    }
  });
  
  document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
    const key = el.getAttribute('data-i18n-aria-label');
    if (messages[key]) {
      el.setAttribute('aria-label', messages[key]);
    }
  });
}

/**
 * Get localized message
 * @param {string} key 
 * @returns {Promise<string>}
 */
async function getMessage(key) {
  const messages = await chrome.runtime.sendMessage({ action: 'getTranslations' });
  return messages[key] || key;
}

/**
 * Validate URL format
 * @param {string} url 
 * @returns {boolean}
 */
function isValidUrl(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Show error message
 * @param {string} message 
 */
function showError(message) {
  alert(message);
}

/**
 * Validate favicon URL availability
 * @param {string} url 
 * @param {number} timeout
 * @returns {Promise<boolean>}
 */
async function isFaviconValid(url, timeout = 3000) {
  // Strict check: must be string and cannot be undefined
  if (!url || typeof url !== 'string' || url === 'undefined') {
    return false;
  }
  
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.onabort = () => resolve(false);
    img.src = url;
    
    // Configurable timeout, default 3 seconds
    setTimeout(() => resolve(false), timeout);
  });
}

/**
 * Get valid favicon URL - using browser built-in method only
 * @param {string} pageUrl Page URL
 * @returns {Promise<string>}
 */
async function getValidFavicon(pageUrl) {
  // Skip invalid URLs
  if (!pageUrl || typeof pageUrl !== 'string' || !pageUrl.startsWith('http')) {
    return '';
  }
  
  try {
    // Method 1: Use Chrome tab's favIconUrl (fastest)
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.favIconUrl && typeof tab.favIconUrl === 'string' && 
        tab.favIconUrl.startsWith('http') && tab.favIconUrl !== 'undefined') {
      return tab.favIconUrl;
    }
    
    // Method 2: Extract link tags from current page
    if (tab?.id) {
      try {
        const result = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const icons = [];
            // Find various favicon link tags by priority
            const selectors = [
              'link[rel*="icon"]',
              'link[rel*="apple-touch-icon"]',
              'link[rel="shortcut icon"]'
            ];
            selectors.forEach(selector => {
              document.querySelectorAll(selector).forEach(link => {
                const href = link.getAttribute('href');
                if (href) icons.push(href);
              });
            });
            return icons;
          }
        });
        
        if (result[0]?.result && result[0].result.length > 0) {
          for (const icon of result[0].result) {
            if (!icon || typeof icon !== 'string') continue;
            let faviconUrl = icon;
            
            // Handle relative paths
            if (icon.startsWith('//')) {
              faviconUrl = 'https:' + icon;
            } else if (icon.startsWith('/')) {
              try {
                faviconUrl = new URL(pageUrl).origin + icon;
              } catch { continue; }
            } else if (!icon.startsWith('http')) {
              try {
                faviconUrl = new URL(pageUrl).origin + '/' + icon;
              } catch { continue; }
            }
            
            if (faviconUrl.startsWith('http')) {
              return faviconUrl;
            }
          }
        }
      } catch (e) {
      }
    }
    
    // Method 3: Try standard icon files at domain root
    const origin = new URL(pageUrl).origin;
    let hostname = '';
    try {
      hostname = new URL(pageUrl).hostname;
    } catch {}
    
    const standardPaths = [
      '/favicon.ico',
      '/apple-touch-icon.png',
      '/apple-touch-icon-precomposed.png'
    ];
    
    for (const path of standardPaths) {
      const testUrl = origin + path;
      const isValid = await isFaviconValid(testUrl, 1500);
      if (isValid) return testUrl;
    }
    
    // Fallback: Return standard favicon.ico path
    // if (hostname) {
    //   return `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
    // }
    
    return origin + '/favicon.ico';
    
  } catch (e) {
    return '';
  }
}

/**
 * Get current active tab info
 * @returns {Promise<{title: string, url: string, favicon: string, description: string}>
 */
async function getCurrentTabInfo() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (!tab) {
    throw new Error('Cannot get current tab');
  }
  
  // 使用新的方法获取 favicon
  const favicon = await getValidFavicon(tab.url || '');
  
  const result = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const metaDescription = document.querySelector('meta[name="description"]');
      const metaOgTitle = document.querySelector('meta[property="og:title"]');
      return {
        description: metaDescription ? metaDescription.content : (metaOgTitle ? metaOgTitle.content : '')
      };
    }
  });

  return {
    title: tab.title || '',
    url: tab.url || '',
    favicon: favicon,
    description: result[0]?.result?.description || ''
  };
}

/**
 * Fill form fields
 * @param {Object} info 
 */
function fillForm(info) {
  document.getElementById('link-name').value = info.title || '';
  document.getElementById('link-url').value = info.url || '';
  document.getElementById('link-icon').value = info.favicon || '';
  document.getElementById('link-desc').value = info.description || '';
}

/**
 * Get current storage API based on storage type setting
 * @returns {Promise<Object>}
 */
async function getStorage() {
  const storageSettings = await chrome.storage.sync.get({ storageType: 'sync' });
  const isLocal = storageSettings.storageType === 'local';
  return isLocal ? chrome.storage.local : chrome.storage.sync;
}

/**
 * 添加新链接
 * @returns {Promise<void>}
 */
async function addLink(event) {
  if (event) {
    event.preventDefault();
  }
  
  const categoryName = document.getElementById('category-name').value.trim();
  const linkName = document.getElementById('link-name').value.trim();
  const linkUrl = document.getElementById('link-url').value.trim();
  const linkIcon = document.getElementById('link-icon').value.trim();
  const linkDesc = document.getElementById('link-desc').value.trim();

  // Validate required fields
  if (!categoryName) {
    const msg = await getMessage('error_category_required');
    showError(msg);
    return;
  }

  if (!linkName) {
    const msg = await getMessage('error_link_name_required');
    showError(msg);
    return;
  }

  if (!linkUrl) {
    const msg = await getMessage('error_link_url_required');
    showError(msg);
    return;
  }

  // Validate URL format
  if (!isValidUrl(linkUrl)) {
    const msg = await getMessage('error_invalid_url');
    showError(msg);
    return;
  }

  try {
    const storage = await getStorage();
    const isLocal = storage === chrome.storage.local;
    
    let data;
    
    if (isLocal) {
      // Local mode: read directly
      data = await storage.get({ navigation: {}, categoryOrder: [] });
    } else {
      // Sync mode: read from chunked storage
      const allData = await storage.get(null);
      
      if (allData._chunkInfo) {
        const navigation = {};
        for (const key of Object.keys(allData)) {
          if (key.startsWith('nav_')) {
            const category = key.substring(4);
            navigation[category] = allData[key];
          }
        }
        data = {
          navigation: navigation,
          categoryOrder: allData.categoryOrder || []
        };
      } else {
        data = { navigation: allData.navigation || {}, categoryOrder: allData.categoryOrder || [] };
      }
    }
    
    // If category doesn't exist in navigation, create it
    if (!data.navigation[categoryName]) {
      data.navigation[categoryName] = [];
    }

    // Add to categoryOrder only if not already there
    if (!data.categoryOrder.includes(categoryName)) {
      data.categoryOrder.push(categoryName);
    }

    // Check for duplicate URL across all categories
    const existingUrls = new Set();
    Object.values(data.navigation).forEach(links => {
      links.forEach(link => {
        if (link.url) {
          existingUrls.add(link.url.trim());
        }
      });
    });

    if (existingUrls.has(linkUrl)) {
      const msg = await getMessage('error_link_exists');
      showError(msg);
      return;
    }

    // Add new link
    data.navigation[categoryName].push({
      name: linkName,
      url: linkUrl,
      icon: linkIcon,
      desc: linkDesc
    });

    // Save to storage based on mode
    if (isLocal) {
      await storage.set({
        navigation: data.navigation,
        categoryOrder: data.categoryOrder
      });
    } else {
      // Sync mode: split by category
      await storage.remove(Object.keys(await storage.get(null)).filter(key => 
        key.startsWith('nav_') || key === 'navigation' || key === 'categoryOrder' || key === '_chunkInfo'
      ));
      
      const storageData = {};
      for (const [category, links] of Object.entries(data.navigation)) {
        storageData[`nav_${category}`] = links;
      }
      storageData.categoryOrder = data.categoryOrder;
      storageData._chunkInfo = { version: 1, totalCategories: Object.keys(data.navigation).length };
      await storage.set(storageData);
    }

    // Notify newtab page to refresh
    await notifyNewtabRefresh();

    const msg = await getMessage('success_link_added');
    alert(msg);
    window.close();
    
  } catch (error) {
    const msg = await getMessage('error_add_failed');
    showError(msg);
  }
}

/**
 * Notify all newtab pages to refresh
 * @returns {Promise<void>}
 */
async function notifyNewtabRefresh() {
  const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL('newtab.html') });
  
  for (const tab of tabs) {
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'refresh' });
    } catch (error) {
      // Ignore connection errors, page may not be loaded
    }
  }
}

// ========== Category Selector Implementation ==========

/**
 * Category Selector - 提供分类选择功能
 * 支持下拉选择和手动输入两种模式
 */
class CategorySelector {
  constructor(config = {}) {
    this.categories = [];
    this.filteredCategories = [];
    this.isOpen = false;
    this.selectedIndex = -1;
    this.storageType = 'sync';
    this.inputElement = null;
    this.dropdownElement = null;
    this.debounceTimer = null;
    this.debounceDelay = config.debounceDelay || 150;
    this.maxDropdownHeight = config.maxDropdownHeight || 300;
  }

  /**
   * 初始化分类选择器
   */
  async init() {
    try {
      this.inputElement = document.getElementById('category-name');
      if (!this.inputElement) {
        console.warn('Category input element not found');
        return;
      }

      await this.loadCategories();
      this.createDropdown();
      this.bindEvents();
    } catch (error) {
      console.error('Category selector initialization failed:', error);
      // 降级：保持手动输入功能
    }
  }

  /**
   * 加载分类列表
   */
  async loadCategories() {
    try {
      const storage = await getStorage();
      const isLocal = storage === chrome.storage.local;
      this.storageType = isLocal ? 'local' : 'sync';

      let categoryList = [];

      if (isLocal) {
        // 本地模式：从 chrome.storage.local 读取
        const data = await storage.get({ navigation: {}, categoryOrder: [] });
        if (data.categoryOrder && data.categoryOrder.length > 0) {
          categoryList = data.categoryOrder;
        } else if (data.navigation) {
          categoryList = Object.keys(data.navigation);
        }
      } else {
        // 同步模式：从 chrome.storage.sync 读取
        const allData = await storage.get(null);
        
        if (allData._chunkInfo) {
          // 分块存储格式
          for (const key of Object.keys(allData)) {
            if (key.startsWith('nav_')) {
              categoryList.push(key.substring(4));
            }
          }
          if (allData.categoryOrder && allData.categoryOrder.length > 0) {
            // 按 categoryOrder 排序
            const order = allData.categoryOrder;
            categoryList = order.filter(cat => categoryList.includes(cat));
          }
        } else if (allData.navigation) {
          // 旧格式
          categoryList = Object.keys(allData.navigation);
          if (allData.categoryOrder && allData.categoryOrder.length > 0) {
            const order = allData.categoryOrder;
            categoryList = order.filter(cat => categoryList.includes(cat));
          }
        }
      }

      this.categories = categoryList.filter(cat => cat && typeof cat === 'string');
      this.filteredCategories = [...this.categories];
    } catch (error) {
      console.error('Failed to load categories:', error);
      this.categories = [];
      this.filteredCategories = [];
    }
  }

  /**
   * 创建下拉列表 DOM
   */
  createDropdown() {
    this.dropdownElement = document.createElement('div');
    this.dropdownElement.className = 'category-dropdown';
    this.dropdownElement.style.display = 'none';
    
    // 插入到输入框父容器后
    const parent = this.inputElement.parentElement;
    parent.style.position = 'relative';
    parent.appendChild(this.dropdownElement);
  }

  /**
   * 更新下拉列表内容
   */
  async updateDropdownList() {
    if (!this.dropdownElement) return;

    if (this.filteredCategories.length === 0) {
      const emptyText = await this.getEmptyText();
      this.dropdownElement.innerHTML = `<div class="category-dropdown-empty">${emptyText}</div>`;
      return;
    }

    const inputValue = this.inputElement.value.trim().toLowerCase();
    const items = this.filteredCategories.map((category, index) => {
      const displayText = this.highlightMatch(category, inputValue);
      const isSelected = index === this.selectedIndex;
      return `<div class="category-dropdown-item${isSelected ? ' selected' : ''}" data-index="${index}">${displayText}</div>`;
    }).join('');

    this.dropdownElement.innerHTML = items;
  }

  /**
   * 高亮匹配文本
   */
  highlightMatch(text, keyword) {
    if (!keyword) return this.escapeHtml(text);
    
    const escapedText = this.escapeHtml(text);
    const escapedKeyword = this.escapeHtml(keyword);
    
    const regex = new RegExp(`(${this.escapeRegExp(escapedKeyword)})`, 'gi');
    return escapedText.replace(regex, '<mark class="category-highlight">$1</mark>');
  }

  /**
   * 转义 HTML 特殊字符
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 转义正則表達式特殊字符
   */
  escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * 获取空分类提示文本
   */
  async getEmptyText() {
    try {
      const messages = await chrome.runtime.sendMessage({ action: 'getTranslations' });
      return messages['no_category_hint'] || '暂无分类，请手动输入';
    } catch {
      return '暂无分类，请手动输入';
    }
  }

  /**
   * 绑定事件
   */
  bindEvents() {
    if (!this.inputElement) return;

    // 输入框获得焦点时展开下拉列表
    this.inputElement.addEventListener('focus', async () => {
      await this.showDropdown();
    });

    // 输入框输入时触发自动补全
    this.inputElement.addEventListener('input', () => {
      this.handleInput();
    });

    // 键盘导航
    this.inputElement.addEventListener('keydown', async (e) => {
      await this.handleKeydown(e);
    });

    // 下拉列表点击事件（事件委托）
    this.dropdownElement.addEventListener('click', (e) => {
      const item = e.target.closest('.category-dropdown-item');
      if (item) {
        const index = parseInt(item.dataset.index);
        this.selectCategory(index);
      }
    });

    // 点击外部关闭下拉列表
    document.addEventListener('click', (e) => {
      if (!this.inputElement.contains(e.target) && !this.dropdownElement.contains(e.target)) {
        this.hideDropdown();
      }
    });
  }

  /**
   * 处理输入事件
   */
  handleInput() {
    // 防抖优化
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(async () => {
      const inputValue = this.inputElement.value.trim().toLowerCase();
      
      if (!inputValue) {
        this.filteredCategories = [...this.categories];
      } else {
        this.filteredCategories = this.categories.filter(cat => 
          cat.toLowerCase().includes(inputValue)
        );
      }

      this.selectedIndex = -1;
      await this.updateDropdownList();
      this.showDropdown();
    }, this.debounceDelay);
  }

  /**
   * 处理键盘事件
   */
  async handleKeydown(e) {
    if (!this.isOpen) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        await this.navigateDown();
        break;
      case 'ArrowUp':
        e.preventDefault();
        await this.navigateUp();
        break;
      case 'Enter':
        if (this.selectedIndex >= 0) {
          e.preventDefault();
          this.confirmSelection();
        }
        break;
      case 'Escape':
        e.preventDefault();
        this.hideDropdown();
        break;
    }
  }

  /**
   * 向下导航
   */
  async navigateDown() {
    if (this.filteredCategories.length === 0) return;
    this.selectedIndex = (this.selectedIndex + 1) % this.filteredCategories.length;
    await this.updateDropdownList();
    this.scrollToSelected();
  }

  /**
   * 向上导航
   */
  async navigateUp() {
    if (this.filteredCategories.length === 0) return;
    this.selectedIndex = this.selectedIndex <= 0 
      ? this.filteredCategories.length - 1 
      : this.selectedIndex - 1;
    await this.updateDropdownList();
    this.scrollToSelected();
  }

  /**
   * 确认选择
   */
  confirmSelection() {
    if (this.selectedIndex >= 0 && this.selectedIndex < this.filteredCategories.length) {
      const selected = this.filteredCategories[this.selectedIndex];
      this.inputElement.value = selected;
      this.hideDropdown();
      
      // 触发 input 事件，让现有验证逻辑生效
      this.inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  /**
   * 选择分类
   */
  selectCategory(index) {
    if (index >= 0 && index < this.filteredCategories.length) {
      const selected = this.filteredCategories[index];
      this.inputElement.value = selected;
      this.hideDropdown();
      
      // 触发 input 事件
      this.inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  /**
   * 滚动到选中项
   */
  scrollToSelected() {
    const selectedItem = this.dropdownElement.querySelector('.category-dropdown-item.selected');
    if (selectedItem) {
      selectedItem.scrollIntoView({ block: 'nearest' });
    }
  }

  /**
   * 显示下拉列表
   */
  async showDropdown() {
    if (!this.dropdownElement) return;
    this.isOpen = true;
    this.dropdownElement.style.display = 'block';
    await this.updateDropdownList();
  }

  /**
   * 隐藏下拉列表
   */
  hideDropdown() {
    if (!this.dropdownElement) return;
    this.isOpen = false;
    this.dropdownElement.style.display = 'none';
    this.selectedIndex = -1;
  }
}

// ========== End of Category Selector ==========

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await applyI18n();
  
  const submitBtn = document.getElementById('add-link');
  const form = document.getElementById('add-link-form');
  
  // Close button
  const closeBtn = document.getElementById('close-btn');
  closeBtn?.addEventListener('click', () => window.close());
  
  // Handle form submit
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await addLink();
    });
  } else {
    submitBtn?.addEventListener('click', addLink);
  }
  
  // Initialize category selector
  try {
    const categorySelector = new CategorySelector();
    await categorySelector.init();
  } catch (error) {
    console.error('Failed to initialize category selector:', error);
    // 降级：保持手动输入功能
  }
  
  // Auto-fill current page info
  try {
    
    // Get tab info first
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.url) {
      return;
    }
    
    if (!tab.url.startsWith('http')) {
      return;
    }
    
    // Get favicon
    const favicon = await getValidFavicon(tab.url);
    
    // Get description
    let description = '';
    try {
      if (tab.id) {
        const result = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const metaDescription = document.querySelector('meta[name="description"]');
            const metaOgTitle = document.querySelector('meta[property="og:title"]');
            return {
              description: metaDescription ? metaDescription.content : (metaOgTitle ? metaOgTitle.content : '')
            };
          }
        });
        description = result[0]?.result?.description || '';
      }
    } catch (e) {
    }
    
    const tabInfo = {
      title: tab.title || '',
      url: tab.url || '',
      favicon: favicon,
      description: description
    };
    
    fillForm(tabInfo);
  } catch (error) {
    // Ignore errors for non-http pages (like about:blank)
  }
});
