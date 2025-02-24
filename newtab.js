// newtab.js

let isEditMode = false;
let draggedItem = null; // 当前拖拽的元素

// 渲染分类和链接
async function renderNavLists() {
  const data = await chrome.storage.sync.get({ navigation: {}, categoryOrder: [], setting: {} });
  const catsListDiv = document.getElementById('categories');
  const navListDiv = document.getElementById('nav-list');
  navListDiv.innerHTML = '';
  catsListDiv.innerHTML = '<ul></ul>';

  data.categoryOrder.forEach(category => {
    const categoryDiv = document.createElement('div');
    categoryDiv.className = 'category';
    categoryDiv.draggable = isEditMode; // 仅在编辑模式下可拖拽
    categoryDiv.innerHTML = `<h2 id="${category}">${category}</h2>`;
    const linksDiv = document.createElement('div');
    linksDiv.className = 'links';

    data.navigation[category].forEach((link, index) => {
      const linkDiv = document.createElement('div');
      linkDiv.className = 'link';
      linkDiv.draggable = isEditMode; // 仅在编辑模式下可拖拽
      // 提取链接名称的第一个字符
      const firstChar = link.name.charAt(0);
      const randomColor = getRandomColor();
      linkDiv.innerHTML = `
        <a href="${link.url}" target="_blank">
          ${link.icon ? `<img src="${link.icon}" alt="${link.name}">` : `<span class="link-logo" style="background-color: ${randomColor};">${firstChar}</span>`}
          <div>
            <span class="link-name">${link.name}</span>
            ${link.desc ? `<span class="link-desc">${link.desc}</span>` : ''}
          </div>
        </a>
        ${isEditMode ? `<div class="link-edit">
          <button class="edit-link" data-category="${category}" data-index="${index}">编辑</button>
          <button class="delete-link" data-category="${category}" data-index="${index}">X</button>
        </div>` : ''}
      `;
      linksDiv.appendChild(linkDiv);
    });

    categoryDiv.appendChild(linksDiv);
    navListDiv.appendChild(categoryDiv);
    catsListDiv.querySelector('ul').innerHTML += `<li class="category-item" data-category="${category}"><span>${category}</span></li>`;
  });

  if (isEditMode) {
    // 为分类和链接添加拖拽事件
    addDragEvents(navListDiv, 'category');
    document.querySelectorAll('.links').forEach(linksDiv => {
      addDragEvents(linksDiv, 'link');
    });
  }

  // 显示或隐藏导入和导出按钮
  const importButton = document.getElementById('import-json');
  const exportButton = document.getElementById('export-json');
  const settingButton = document.getElementById('setting');
  if (isEditMode) {
    importButton.classList.add('visible');
    exportButton.classList.add('visible');
    settingButton.classList.add('visible');
  } else {
    importButton.classList.remove('visible');
    exportButton.classList.remove('visible');
    settingButton.classList.remove('visible');
  }

  // 应用设置
  if (data.setting) {
    applySettings(data.setting);
  }

  categoryItemClick();
}

function applySettings(settings) {
  if (settings.title) {
    document.title = settings.title;
    document.getElementById('site-title').textContent = settings.title;
  }

  if (settings.backgroundColor && settings.backgroundOpacity !== undefined) {
    const rgbaColor = `rgba(${settings.backgroundColor.slice(1).match(/.{1,2}/g).map(x => parseInt(x, 16)).join(', ')}, ${settings.backgroundOpacity})`;
    document.querySelector('.wrapper-left').style.backgroundColor = rgbaColor;
  } else {
    document.querySelector('.wrapper-left').style.backgroundColor = ''; // 清除背景颜色
  }

  if (settings.useBingImage) {
    chrome.runtime.sendMessage({ action: 'fetchBingImageUrl' }, (response) => {
      if (response && response.imageUrl) {
        setBackgroundStyle(response.imageUrl);
      } else {
        console.error('Failed to fetch Bing image URL or response is undefined:', response);
        clearBackgroundStyle();
      }
    });
  } else if (settings.backgroundImage) {
    setBackgroundStyle(settings.backgroundImage);
  } else {
    clearBackgroundStyle();
  }
}

function setBackgroundStyle(imageUrl) {
  document.body.style.backgroundImage = `url(${imageUrl})`;
  document.body.style.backgroundSize = 'cover';
  document.body.style.backgroundPosition = 'center';
  document.body.style.backgroundRepeat = 'no-repeat';
}

function clearBackgroundStyle() {
  document.body.style.backgroundImage = ''; // 清除背景图片
  document.body.style.backgroundSize = '';
  document.body.style.backgroundPosition = '';
  document.body.style.backgroundRepeat = '';
}

// 添加拖拽事件
function addDragEvents(container, type) {
  container.addEventListener('dragstart', handleDragStart);
  container.addEventListener('dragover', handleDragOver);
  container.addEventListener('drop', handleDrop);
}

// 拖拽开始
function handleDragStart(e) {
  draggedItem = e.target;
  e.target.classList.add('dragging');
  e.dataTransfer.setData('text/plain', ''); // 必须设置数据才能拖拽
}

// 拖拽经过
function handleDragOver(e) {
  e.preventDefault(); // 允许放置
  const target = e.target.closest('.category, .link');
  if (target && target !== draggedItem) {
    // 确保 draggedItem 不是 target 的祖先节点
    if (!draggedItem.contains(target)) {
      const rect = target.getBoundingClientRect();
      const offset = e.clientY - rect.top;
      if (offset < rect.height / 2) {
        target.parentNode.insertBefore(draggedItem, target); // 插入到目标前面
      } else {
        target.parentNode.insertBefore(draggedItem, target.nextSibling); // 插入到目标后面
      }
    }
  }
}

// 拖拽放置
async function handleDrop(e) {
  e.preventDefault();
  draggedItem.classList.remove('dragging');
  await saveNavigationOrder(); // 保存新的顺序
}

// 保存分类和链接的顺序
async function saveNavigationOrder() {
  const navListDiv = document.getElementById('nav-list');
  const data = await chrome.storage.sync.get({ navigation: {}, categoryOrder: [] });

  // 更新分类顺序
  const updatedOrder = Array.from(navListDiv.children).map(div => div.querySelector('h2').innerText);
  data.categoryOrder = updatedOrder;

  // 更新链接顺序
  navListDiv.querySelectorAll('.category').forEach(categoryDiv => {
    const category = categoryDiv.querySelector('h2').innerText;
    const links = Array.from(categoryDiv.querySelectorAll('.link')).map(linkDiv => ({
      name: linkDiv.querySelector('.link-name').innerText,
      url: linkDiv.querySelector('a').href,
    }));
    data.navigation[category] = links;
  });

  await chrome.storage.sync.set(data);
}

// 切换编辑模式
const toggleEditButton = document.getElementById('toggle-edit');
if (toggleEditButton) {
  toggleEditButton.addEventListener('click', () => {
    isEditMode = !isEditMode;
    renderNavLists();
    toggleEditButton.textContent = isEditMode ? '完成' : '编辑';
    // 确保在切换编辑模式时应用设置
    chrome.storage.sync.get({ setting: {} }, (data) => {
      applySettings(data.setting);
    });
  });
}

// 删除链接
const navListButton = document.getElementById('nav-list');
if (navListButton) {
  navListButton.addEventListener('click', async (e) => {
    if (e.target.classList.contains('delete-link')) {
      const category = e.target.dataset.category;
      const index = e.target.dataset.index;
      const data = await chrome.storage.sync.get({ navigation: {} });

      // 删除链接
      data.navigation[category].splice(index, 1);

      // 检查分类是否为空
      if (data.navigation[category].length === 0) {
        delete data.navigation[category]; // 删除空分类
        const categoryOrder = (await chrome.storage.sync.get({ categoryOrder: [] })).categoryOrder;
        const updatedOrder = categoryOrder.filter(cat => cat !== category); // 从分类顺序中移除
        await chrome.storage.sync.set({ navigation: data.navigation, categoryOrder: updatedOrder });
      } else {
        await chrome.storage.sync.set({ navigation: data.navigation });
      }

      renderNavLists();
    }
  });
}

// 添加编辑链接事件监听器
if (navListButton) {
  navListButton.addEventListener('click', async (e) => {
    if (e.target.classList.contains('edit-link')) {
      const category = e.target.dataset.category;
      const index = e.target.dataset.index;
      const data = await chrome.storage.sync.get({ navigation: {} });

      // 获取当前链接的名称和 URL
      const link = data.navigation[category][index];
      const newName = prompt('编辑链接名称:', link.name);
      const newUrl = prompt('编辑链接 URL:', link.url);
      const newIcon = prompt('编辑链接图标地址:', link.icon);
      const newDesc = prompt('编辑链接描述:', link.desc);

      if (newName && newUrl) {
        // 更新链接的名称和 URL
        data.navigation[category][index] = { name: newName, url: newUrl, icon: newIcon, desc: newDesc };
        await chrome.storage.sync.set({ navigation: data.navigation });
        renderNavLists(); // 重新渲染分类和链接
      }
    }
  });
}

// 导入 JSON
document.getElementById('import-json').addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const jsonData = JSON.parse(e.target.result);
          // 验证 JSON 数据结构
          if (jsonData.navigation && jsonData.categoryOrder) {
            chrome.storage.sync.set(jsonData, () => {
              alert('导入成功！');
              renderNavLists(); // 重新加载导航数据
            });
          } else {
            alert('导入失败：JSON 数据格式不正确！');
          }
        } catch (error) {
          alert('导入失败：文件格式不正确！');
        }
      };
      reader.readAsText(file);
    }
  };
  input.click();
});

// 导出 JSON
document.getElementById('export-json').addEventListener('click', async () => {
  const data = await chrome.storage.sync.get({ navigation: {}, categoryOrder: [] });
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'links.json';
  a.click();
});

// 监听消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'refresh') {
    // 重新加载页面或更新内容
    renderNavLists();
    sendResponse({ status: 'refreshed' }); // 发送响应
  }
});

// 生成随机背景颜色且不包含白色
function getRandomColor() {
  let r, g, b;
  do {
    r = Math.floor(Math.random() * 256);
    g = Math.floor(Math.random() * 256);
    b = Math.floor(Math.random() * 256);
  } while (r === 255 && g === 255 && b === 255); // 确保不是白色
  return `rgb(${r}, ${g}, ${b})`;
}

function categoryItemClick() {
  const categoriesList = document.getElementById('categories');
  categoriesList.addEventListener('click', function(event) {
    const target = event.target.closest('.category-item');
    if (target) {
      // 获取目标元素的ID
      var targetId = target.getAttribute('data-category');

      // 获取目标元素
      var targetElement = document.getElementById(targetId);
      if (window.innerWidth < 768) {
        // 获取目标元素上部距离20px的位置
        var targetOffsetTop = targetElement.getBoundingClientRect().top + window.pageYOffset - 80;
        // 滚动到目标位置
        window.scrollTo({ top: targetOffsetTop, behavior: 'smooth' });
      } else {
        // 滚动到目标元素
        targetElement.scrollIntoView({ behavior: 'smooth' });
      }
    }
  });
}

// 初始化渲染
document.addEventListener('DOMContentLoaded', () => {

  // 绑定 searchBookmarks 函数到 input 的 onkeyup 事件
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('keyup', searchBookmarks);
  }

  // 初始化设置对话框
  setupSettingsDialog();

  // 加载书签数据
  loadBookmarks();

  // 渲染导航列表
  renderNavLists();

  // 获取设置并应用
  chrome.storage.sync.get({ setting: {} }, (data) => {
    applySettings(data.setting);
  });
});

let bookmarks = [];

async function loadBookmarks() {
  try {
    const data = await chrome.storage.sync.get({ navigation: {}, categoryOrder: [] });
    bookmarks = [];
    data.categoryOrder.forEach(categoryName => {
      data.navigation[categoryName].forEach(link => {
        bookmarks.push({ name: link.name, url: link.url, desc: link.desc });
      });
    });
  } catch (error) {
    console.error('Error loading bookmarks:', error);
  }
}

function searchBookmarks() {
  const query = document.getElementById('search-input').value.toLowerCase();
  const resultsList = document.getElementById('search-results');
  resultsList.innerHTML = ''; // 清空之前的搜索结果

  if (query) {
    const filteredBookmarks = bookmarks.filter(bookmark => bookmark.name.toLowerCase().includes(query));
    filteredBookmarks.forEach(bookmark => {
      const li = document.createElement('li');
      li.innerHTML = `<a href="${bookmark.url}" target="_blank">${bookmark.name}${bookmark.desc ? `<span>${bookmark.desc}</span>` : ``}</a>`;
      resultsList.appendChild(li);
    });
  }
}

// 设置对话框逻辑
function setupSettingsDialog() {
  const settingButton = document.getElementById('setting');
  const settingsDialog = document.getElementById('settings-dialog');
  const saveSettingsButton = document.getElementById('save-settings');
  const cancelSettingsButton = document.getElementById('cancel-settings');
  const titleInput = document.getElementById('title');
  const backgroundImageInput = document.getElementById('background-image');
  const backgroundColorInput = document.getElementById('background-color');
  const backgroundOpacityInput = document.getElementById('background-opacity');
  const useBingImageCheckbox = document.getElementById('use-bing-image');

  // 显示设置对话框
  settingButton.addEventListener('click', function() {
    // 加载当前设置
    chrome.storage.sync.get({ setting: {} }, (data) => {
      const settings = data.setting || {};
      titleInput.value = settings.title || '';
      backgroundImageInput.value = settings.backgroundImage || '';
      backgroundColorInput.value = settings.backgroundColor || '#334455';
      backgroundOpacityInput.value = settings.backgroundOpacity !== undefined ? settings.backgroundOpacity : 0.8;
      useBingImageCheckbox.checked = settings.useBingImage || false;
      settingsDialog.classList.remove('hidden');
    });
  });

  // 保存设置
  saveSettingsButton.addEventListener('click', function() {
    const settings = {
      title: titleInput.value,
      backgroundImage: backgroundImageInput.value,
      backgroundColor: backgroundColorInput.value,
      backgroundOpacity: parseFloat(backgroundOpacityInput.value),
      useBingImage: useBingImageCheckbox.checked
    };

    // 保存设置到chrome.storage
    chrome.storage.sync.set({ setting: settings }, () => {
      // 应用设置
      applySettings(settings);

      // 关闭设置对话框
      settingsDialog.classList.add('hidden');
    });
  });

  // 取消设置
  cancelSettingsButton.addEventListener('click', function() {
    settingsDialog.classList.add('hidden');
  });

  // 加载设置
  chrome.storage.sync.get({ setting: {} }, (data) => {
    applySettings(data.setting);
  });
}