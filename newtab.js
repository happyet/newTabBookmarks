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
          ${link.icon ? `<img class="link-logo" src="${link.icon}" alt="${link.name}">` : `<span class="link-logo" style="background-color: ${randomColor};">${firstChar}</span>`}
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
    const rgbColor = `${settings.backgroundColor.slice(1).match(/.{1,2}/g).map(x => parseInt(x, 16)).join(', ')}`;
    const rgbaColor = `rgba(${rgbColor}, ${settings.backgroundOpacity})`;
    document.querySelector('.wrapper-left').style.backgroundColor = rgbaColor;
    document.querySelectorAll('.link-name').forEach(element => { element.style.color = settings.backgroundColor; });
    document.querySelectorAll('.link-desc').forEach(element => { element.style.color = `rgba(${rgbColor}, 0.6)`; });
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
  const existingImg = document.querySelector('.background-img');
  if (existingImg) {
    document.body.removeChild(existingImg);
  }

  const bgImg = document.createElement('img');
  bgImg.src = imageUrl;
  bgImg.alt = '背景图片';
  bgImg.className = 'background-img';

  document.body.insertBefore(bgImg, document.body.firstChild);
}

function clearBackgroundStyle() {
  const bgImg = document.querySelector('.background-img');
  if (bgImg) {
    document.body.removeChild(bgImg);
  }
}

// 添加拖拽事件
function addDragEvents(container, type) {
  container.addEventListener('dragstart', handleDragStart);
  container.addEventListener('dragover', handleDragOver);
  container.addEventListener('drop', handleDrop);
}

// 拖拽开始
function handleDragStart(e) {
  // 找到最近的 .link 或 .category 祖先元素
  draggedItem = e.target.closest('.link, .category');
  if (draggedItem) {
    draggedItem.classList.add('dragging');
    e.dataTransfer.setData('text/plain', ''); // 必须设置数据才能拖拽
  }
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
  const updatedOrder = Array.from(navListDiv.children)
    .map(div => div.querySelector('h2'))
    .filter(h2 => h2 !== null)
    .map(h2 => h2.innerText);
  data.categoryOrder = updatedOrder;

  // 更新链接顺序
  navListDiv.querySelectorAll('.category').forEach(categoryDiv => {
    const category = categoryDiv.querySelector('h2').innerText;
    const links = Array.from(categoryDiv.querySelectorAll('.link')).map(linkDiv => ({
      name: linkDiv.querySelector('.link-name').innerText,
      url: linkDiv.querySelector('a').href,
      icon: linkDiv.querySelector('a img') ? linkDiv.querySelector('a img').src : '',
      desc: linkDiv.querySelector('.link-desc') ? linkDiv.querySelector('.link-desc').innerText : ''
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
const importJsonButton = document.getElementById('import-json');
if (importJsonButton) {
  importJsonButton.addEventListener('click', () => {
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
}

// 导出 JSON
const exportJsonButton = document.getElementById('export-json');
if (exportJsonButton) {
  exportJsonButton.addEventListener('click', async () => {
    const data = await chrome.storage.sync.get({ navigation: {}, categoryOrder: [] });

    // 定义属性顺序
    const propertyOrder = ['name', 'url', 'icon', 'desc'];

    // 使用 JSON.stringify 的第二个参数来确保属性顺序
    const jsonString = JSON.stringify(data, (key, value) => {
      if (Array.isArray(value)) {
        return value.map(item => {
          if (typeof item === 'object' && item !== null) {
            // 创建一个新的对象并按指定顺序添加属性
            const orderedItem = {};
            propertyOrder.forEach(prop => {
              if (item.hasOwnProperty(prop)) {
                orderedItem[prop] = item[prop];
              }
            });
            return orderedItem;
          }
          return item;
        });
      }
      return value;
    }, 2);

    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'links.json';
    a.click();
  });
}


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

  if (window.location.pathname.endsWith('newtab.html')) {
    setInterval(todayTime, 1000);
    fetchPoetry();
  }
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
function todayTime(){
  var date = new Date();
  var y = date.getFullYear();	//获取年份
  var M = date.getMonth()+1;	//获取月份 getMonth返回0、1、2、...、11，分别代表1~12月
  var d = date.getDate();	//获取日期
  var w = date.getDay();	//获取星期 getDay返回0、1、2、...、6，分别代表周日、周一、...、周六
  switch(w){
    case 1:
      w = '一';
      break;
    case 2:
      w = '二';
      break;
    case 3:
      w = '三';
      break;
    case 4:
      w = '四';
      break;
    case 5:
      w = '五';
      break;
    case 6:
      w = '六';
      break;
    default:
      w = '日';
  }
  var h = date.getHours();	//获取小时
  if(h>=0 && h<=9) h = '0'+h;
  var m = date.getMinutes();	//获取分钟
  if(m>=0 && m<=9) m = '0'+m;
  var s = date.getSeconds();
  if(s>=0 && s<=9) s = '0'+s;
  const currentDate = document.getElementById('current-date');
  const currentTime = document.getElementById('current-time');
  if (currentDate && currentTime){
    currentDate.innerHTML = y+'年'+M+'月'+d+'日';
    currentTime.innerHTML = '星期'+w+'  '+h+':'+m+':'+s;
  }
}

async function fetchPoetry() {
  try {
    const response = await fetch('https://v2.jinrishici.com/one.json?client=browser-sdk/1.2');
    if (!response.ok) {
      throw new Error('网络响应失败');
    }
    const data = await response.json();
    document.getElementById('poem_sentence').textContent = data.data.content;
    document.getElementById('poem_info').textContent = '【' + data.data.origin.dynasty +'】 '+ data.data.origin.author + ' 《' + data.data.origin.title + '》';
  } catch (error) {
    console.error('获取诗词数据失败:', error);
  }
}