(function() {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function t(key) { return LeHu.getMessageSync(key); }

  async function applyI18n() {
    var titleEl = document.getElementById('popup-title');
    if (titleEl) titleEl.textContent = t('add_link_title');
    await LeHu.applyI18n();
  }

  // ===================== Favicon =====================
  function getValidFavicon(pageUrl, tab) {
    if (!tab || !tab.favIconUrl || typeof tab.favIconUrl !== 'string' || !tab.favIconUrl.startsWith('http')) {
      try {
        return new URL(pageUrl).origin + '/favicon.ico';
      } catch (e) {
        return '';
      }
    }
    return tab.favIconUrl;
  }

  // ===================== Add Link =====================
  async function addLink(event) {
    if (event) event.preventDefault();

    var categoryName = $('category-name').value.trim();
    var linkName = $('link-name').value.trim();
    var linkUrl = $('link-url').value.trim();
    var linkIcon = $('link-icon').value.trim();
    var linkDesc = $('link-desc').value.trim();

    if (!categoryName) { LeHu.Modal.alert(t('error_category_required')); return; }
    if (!linkName) { LeHu.Modal.alert(t('error_link_name_required')); return; }
    if (!linkUrl) { LeHu.Modal.alert(t('error_link_url_required')); return; }
    if (!LeHu.isValidUrl(linkUrl)) { LeHu.Modal.alert(t('error_invalid_url')); return; }

    try {
      var storageType = await LeHu.getStorageType();

      if (storageType === 'sync') {
        var rootId = '1';
        var [rootNode] = await chrome.bookmarks.getSubTree(rootId);
        var folder = rootNode.children.find(function(f) { return f.title === categoryName; });
        if (!folder) folder = await chrome.bookmarks.create({ parentId: rootId, title: categoryName });

        var existingUrls = new Set();
        (folder.children || []).forEach(function(c) { if (c.url) existingUrls.add(c.url); });
        if (existingUrls.has(linkUrl)) { LeHu.Modal.alert(t('error_link_exists')); return; }

        await chrome.bookmarks.create({ parentId: folder.id, title: linkName, url: linkUrl });
        await notifyNewtabRefresh();
        LeHu.Modal.alert(t('success_link_added'));
        window.close();
        return;
      }

      var data = await LeHu.loadDataFrom(storageType);

      if (!data.navigation[categoryName]) data.navigation[categoryName] = [];
      if (!data.categoryOrder.includes(categoryName)) data.categoryOrder.push(categoryName);

      Object.keys(data.navigation).forEach(function(c) {
        if (data.categoryOrder.indexOf(c) === -1) {
          data.categoryOrder.push(c);
        }
      });

      var existingUrls = new Set();
      Object.values(data.navigation).forEach(function(links) {
        links.forEach(function(link) { if (link.url) existingUrls.add(link.url.trim()); });
      });

      if (existingUrls.has(linkUrl)) { LeHu.Modal.alert(t('error_link_exists')); return; }

      data.navigation[categoryName].push({ name: linkName, url: linkUrl, icon: linkIcon, desc: linkDesc });

      await LeHu.saveData(data, storageType);

      await notifyNewtabRefresh();
      LeHu.Modal.alert(t('success_link_added'));
      window.close();
    } catch (error) {
      LeHu.Modal.alert(t('error_add_failed'));
    }
  }

  async function notifyNewtabRefresh() {
    var tabs = await chrome.tabs.query({ url: chrome.runtime.getURL('newtab.html') });
    for (var i = 0; i < tabs.length; i++) {
      try {
        await chrome.tabs.sendMessage(tabs[i].id, { action: 'refresh' });
      } catch (error) {}
    }
  }

  // ===================== Category Selector =====================
  var CategorySelector = function(config) {
    config = config || {};
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
  };

  CategorySelector.prototype.init = async function() {
    try {
      this.inputElement = $('category-name');
      if (!this.inputElement) return;
      await this.loadCategories();
      this.createDropdown();
      this.bindEvents();
    } catch (error) {
      console.error('Category selector initialization failed:', error);
    }
  };

  CategorySelector.prototype.loadCategories = async function() {
    try {
      var storageType = await LeHu.getStorageType();
      this.storageType = storageType;
      var data = await LeHu.loadDataFrom(storageType);
      var categoryList = data.categoryOrder && data.categoryOrder.length > 0 ? data.categoryOrder : Object.keys(data.navigation);

      this.categories = categoryList.filter(function(c) { return c && typeof c === 'string'; });
      this.filteredCategories = [].concat(this.categories);
    } catch (error) {
      console.error('Failed to load categories:', error);
      this.categories = [];
      this.filteredCategories = [];
    }
  };

  CategorySelector.prototype.createDropdown = function() {
    this.dropdownElement = document.createElement('div');
    this.dropdownElement.className = 'category-dropdown';
    this.dropdownElement.style.display = 'none';
    var parent = this.inputElement.parentElement;
    parent.style.position = 'relative';
    parent.appendChild(this.dropdownElement);
  };

  CategorySelector.prototype.updateDropdownList = async function() {
    if (!this.dropdownElement) return;
    if (this.filteredCategories.length === 0) {
      this.dropdownElement.innerHTML = '<div class="category-dropdown-empty">' + t('no_category_hint') + '</div>';
      return;
    }

    var inputValue = (this.inputElement.value || '').trim().toLowerCase();
    var self = this;
    var items = this.filteredCategories.map(function(category, index) {
      var displayText = self.highlightMatch(category, inputValue);
      var isSelected = index === self.selectedIndex;
      return '<div class="category-dropdown-item' + (isSelected ? ' selected' : '') + '" data-index="' + index + '">' + displayText + '</div>';
    }).join('');
    this.dropdownElement.innerHTML = items;
  };

  CategorySelector.prototype.highlightMatch = function(text, keyword) {
    if (!keyword) return LeHu.escapeHtml(text);
    var escapedText = LeHu.escapeHtml(text);
    var escapedKeyword = LeHu.escapeHtml(keyword);
    var regex = new RegExp('(' + this.escapeRegExp(escapedKeyword) + ')', 'gi');
    return escapedText.replace(regex, '<mark class="category-highlight">$1</mark>');
  };

  CategorySelector.prototype.escapeRegExp = function(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };

  CategorySelector.prototype.bindEvents = function() {
    if (!this.inputElement) return;
    var self = this;

    this.inputElement.addEventListener('focus', async function() { await self.showDropdown(); });
    this.inputElement.addEventListener('input', function() { self.handleInput(); });
    this.inputElement.addEventListener('keydown', async function(e) { await self.handleKeydown(e); });

    this.dropdownElement.addEventListener('click', function(e) {
      var item = e.target.closest('.category-dropdown-item');
      if (item) {
        var index = parseInt(item.dataset.index, 10);
        self.selectCategory(index);
      }
    });

    document.addEventListener('click', function(e) {
      if (!self.inputElement.contains(e.target) && !self.dropdownElement.contains(e.target)) {
        self.hideDropdown();
      }
    });
  };

  CategorySelector.prototype.handleInput = function() {
    var self = this;
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(async function() {
      var inputValue = (self.inputElement.value || '').trim().toLowerCase();
      if (!inputValue) {
        self.filteredCategories = [].concat(self.categories);
      } else {
        self.filteredCategories = self.categories.filter(function(cat) {
          return cat.toLowerCase().includes(inputValue);
        });
      }
      self.selectedIndex = -1;
      await self.updateDropdownList();
      self.showDropdown();
    }, this.debounceDelay);
  };

  CategorySelector.prototype.handleKeydown = async function(e) {
    if (!this.isOpen) return;
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); await this.navigateDown(); break;
      case 'ArrowUp': e.preventDefault(); await this.navigateUp(); break;
      case 'Enter':
        if (this.selectedIndex >= 0) { e.preventDefault(); this.confirmSelection(); }
        break;
      case 'Escape': e.preventDefault(); this.hideDropdown(); break;
    }
  };

  CategorySelector.prototype.navigateDown = async function() {
    if (this.filteredCategories.length === 0) return;
    this.selectedIndex = (this.selectedIndex + 1) % this.filteredCategories.length;
    await this.updateDropdownList();
    this.scrollToSelected();
  };

  CategorySelector.prototype.navigateUp = async function() {
    if (this.filteredCategories.length === 0) return;
    this.selectedIndex = this.selectedIndex <= 0 ? this.filteredCategories.length - 1 : this.selectedIndex - 1;
    await this.updateDropdownList();
    this.scrollToSelected();
  };

  CategorySelector.prototype.confirmSelection = function() {
    if (this.selectedIndex >= 0 && this.selectedIndex < this.filteredCategories.length) {
      this.inputElement.value = this.filteredCategories[this.selectedIndex];
      this.hideDropdown();
      this.inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };

  CategorySelector.prototype.selectCategory = function(index) {
    if (index >= 0 && index < this.filteredCategories.length) {
      this.inputElement.value = this.filteredCategories[index];
      this.hideDropdown();
      this.inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };

  CategorySelector.prototype.scrollToSelected = function() {
    var selectedItem = this.dropdownElement.querySelector('.category-dropdown-item.selected');
    if (selectedItem) selectedItem.scrollIntoView({ block: 'nearest' });
  };

  CategorySelector.prototype.showDropdown = async function() {
    if (!this.dropdownElement) return;
    this.isOpen = true;
    this.dropdownElement.style.display = 'block';
    await this.updateDropdownList();
  };

  CategorySelector.prototype.hideDropdown = function() {
    if (!this.dropdownElement) return;
    this.isOpen = false;
    this.dropdownElement.style.display = 'none';
    this.selectedIndex = -1;
  };

  function fillForm(info) {
    if ($('link-name')) $('link-name').value = info.title || '';
    if ($('link-url')) $('link-url').value = info.url || '';
    if ($('link-icon')) $('link-icon').value = info.favicon || '';
    if ($('link-desc')) $('link-desc').value = info.description || '';
  }

  // ===================== Initialization =====================
  document.addEventListener('DOMContentLoaded', async function() {
    await applyI18n();

    var form = $('add-link-form');
    var closeBtn = $('close-btn');

    if (closeBtn) closeBtn.addEventListener('click', function() { window.close(); });

    if (form) {
      form.addEventListener('submit', async function(e) {
        e.preventDefault();
        await addLink();
      });
    } else {
      var submitBtn = $('add-link');
      if (submitBtn) submitBtn.addEventListener('click', addLink);
    }

    try {
      var categorySelector = new CategorySelector();
      await categorySelector.init();
    } catch (error) {
      console.error('Failed to initialize category selector:', error);
    }

    try {
      var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      var tab = tabs[0];
      if (tab && tab.url && tab.url.startsWith('http')) {
        var favicon = getValidFavicon(tab.url, tab);
        var description = '';
        try {
          if (tab.id) {
            var result = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: function() {
                var metaDesc = document.querySelector('meta[name="description"]');
                var metaOg = document.querySelector('meta[property="og:title"]');
                return { description: metaDesc ? metaDesc.content : (metaOg ? metaOg.content : '') };
              }
            });
            description = result && result[0] && result[0].result ? result[0].result.description || '' : '';
          }
        } catch (e) {}

        fillForm({ title: tab.title || '', url: tab.url || '', favicon: favicon, description: description });
      }
    } catch (error) {}
  });

})();