// background.js - 后台服务脚本

const BING_API_URL = 'https://www.bing.com/HPImageArchive.aspx';
const BING_API_PARAMS = '?format=js&idx=0&n=1&mkt=zh-CN';

// 缓存 Bing 图片 URL，避免频繁请求
let cachedBingImageUrl = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 60 * 60 * 1000; // 缓存1小时

/**
 * 获取翻译消息
 * @param {string} locale locale code
 * @returns {Object}
 */
function getTranslations(locale) {
  const translations = {};
  
  // Support both zh-CN and zh_CN formats
  if (locale.startsWith('zh')) {
    translations.extension_name = '不亦乐乎网页收藏插件';
    translations.extension_short_name = '不亦乐乎';
    translations.extension_description = '允许用户自定义添加、删除和分类导航链接。作者: LMS.im';
    translations.popup_title = '自定义网页导航';
    translations.add_link_title = '添加链接';
    translations.category_name_label = '分类名称 *';
    translations.category_name_placeholder = '链接分类';
    translations.link_name_label = '链接名称 *';
    translations.link_name_placeholder = '链接名称';
    translations.link_url_label = '链接地址 *';
    translations.link_url_placeholder = 'https://example.com';
    translations.link_icon_label = '网站图标';
    translations.link_icon_placeholder = 'https://example.com/favicon.ico';
    translations.link_desc_label = '链接描述';
    translations.link_desc_placeholder = '简短描述（可选）';
    translations.add_link_button = '添加链接';
    translations.error_cannot_get_tab = '无法获取当前标签页';
    translations.error_category_required = '请填写分类名称！';
    translations.error_link_name_required = '请填写链接名称！';
    translations.error_link_url_required = '请填写链接地址！';
    translations.error_invalid_url = '请输入有效的链接地址！';
    translations.error_link_exists = '该链接已存在！';
    translations.success_link_added = '链接已添加！';
    translations.error_add_failed = '添加链接失败，请重试。';
    translations.newtab_title = '乐乎书签';
    translations.date_format = '0000年00月00日';
    translations.time_format = '星期一  00:00:00';
    translations.edit_button = '编辑';
    translations.done_button = '完成';
    translations.settings_button = '设置';
    translations.sync_mode_button = '同步模式';
    translations.local_mode_button = '本地模式';
    translations.import_bookmarks = '书签导入';
    translations.import_button = '导入';
    translations.export_button = '导出';
    translations.daily_poem = '每日诗词';
    translations.search_placeholder = 'Bing搜索';
    translations.search_aria_label = '搜索书签或输入搜索内容';
    translations.footer_text = '© 自娱自乐，不亦乐乎!';
    translations.settings_dialog_title = '设置';
    translations.page_title_label = '页面标题:';
    translations.page_title_placeholder = '输入页面标题';
    translations.background_image_label = '背景图片URL:';
    translations.background_image_placeholder = '输入背景图片URL';
    translations.use_bing_image = '使用Bing每日一图';
    translations.background_color_label = '背景颜色:';
    translations.background_opacity_label = '背景颜色透明度:';
    translations.save_button = '保存';
    translations.clear_all_button = '清空全部书签';
    translations.cancel_button = '取消';
    translations.save_category = '保存';
    translations.delete_category = '删除';
    translations.edit_link = '编辑';
    translations.delete_link = '删除';
    translations.background_image_alt = '背景图片';
    translations.navigation_label = '分类导航';
    translations.bookmark_category_list = '书签分类列表';
    translations.edit_tools = '编辑工具';
    translations.search_label = '搜索';
    translations.bookmark_links = '书签链接列表';
    translations.search_results = '搜索结果';
    translations.current_date = '当前日期';
    translations.current_time = '当前时间';
    translations.switch_storage_confirm = '切换到本地存储？';
    translations.switch_storage_confirm2 = '切换到同步存储？';
    translations.category_empty_error = '分类名称不能为空！';
    translations.category_exists_error = '分类名称已存在！';
    translations.category_updated = '分类名称已更新';
    translations.delete_category_confirm = '确定要删除分类"{category}"及其所有书签吗？';
    translations.edit_link_name = '编辑链接名称:';
    translations.edit_link_url = '编辑链接地址:';
    translations.edit_link_icon = '编辑链接图标:';
    translations.edit_link_desc = '编辑链接描述:';
    translations.import_success = '导入成功！';
    translations.import_invalid_format = '导入失败：无效的JSON格式！';
    translations.import_failed = '导入失败：';
    translations.no_bookmarks = '未找到浏览器书签';
    translations.import_method_title = '找到 {count} 个书签，请选择导入方式：\n\n确定：合并到现有分类\n取消：按浏览器原分类导入';
    translations.existing_categories = '现有分类：{categories}\n\n输入名称以创建新分类或添加到现有分类';
    translations.enter_new_category = '请输入新分类名称：';
    translations.import_cancelled = '导入已取消';
    translations.all_exists = '所有书签已存在，无需导入';
    translations.imported_to_category = '成功导入 {count} 个书签到分类"{category}"{skipped}';
    translations.skipped_duplicates = '，跳过 {count} 个重复书签';
    translations.import_by_category = '按浏览器原书签分类导入成功{skipped}';
    translations.settings_saved = '设置已保存到{sync}存储';
    translations.sync_storage = '同步';
    translations.local_storage = '本地';
    translations.clear_confirm1 = '确定要清空所有书签吗？此操作无法撤销！';
    translations.clear_confirm2 = '再次确认：删除所有书签数据？';
    translations.all_cleared = '所有书签已清空';
    translations.clear_failed = '清空失败：';
    translations.poem_no_data = '今日无诗词';
  }
  
  return translations;
}

/**
 * 获取 Bing 每日图片 URL
 * @returns {Promise<string|null>}
 */
async function fetchBingImageUrl() {
  // 检查缓存
  const now = Date.now();
  if (cachedBingImageUrl && (now - cacheTimestamp) < CACHE_DURATION) {
    return cachedBingImageUrl;
  }

  try {
    const response = await fetch(`${BING_API_URL}${BING_API_PARAMS}`);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.images && data.images.length > 0) {
      cachedBingImageUrl = `https://www.bing.com${data.images[0].urlbase}_1920x1080.jpg`;
      cacheTimestamp = now;
      return cachedBingImageUrl;
    }
    
    console.warn('Bing API 返回数据中没有图片');
    return null;
    
  } catch (error) {
    console.error('获取 Bing 每日图片失败:', error);
    return null;
  }
}

// 监听消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 获取翻译消息
  if (request.action === 'getTranslations') {
    const locale = chrome.i18n.getUILanguage();
    const translations = getTranslations(locale);
    sendResponse(translations);
    return true;
  }
  
  if (request.action === 'fetchBingImageUrl') {
    fetchBingImageUrl()
      .then(imageUrl => {
        sendResponse({ imageUrl: imageUrl });
      })
      .catch(error => {
        console.error('Background script error:', error);
        sendResponse({ imageUrl: null, error: error.message });
      });
    return true;
  }
  
  // 获取所有书签 - 根据存储类型限制数量
  if (request.action === 'getBookmarks') {
    if (!chrome.bookmarks) {
      sendResponse({ error: '书签 API 不可用' });
      return true;
    }
    
    // 检查存储类型
    chrome.storage.sync.get({ storageType: 'sync' }, (result) => {
      const isLocal = result.storageType === 'local';
      const limit = isLocal ? 500 : 100;
      
      // 递归获取所有书签
      const collectBookmarks = (nodes, parentTitle = '') => {
        const res = [];
        const traverse = (items, folderTitle) => {
          for (const item of items) {
            if (res.length >= limit) return;
            if (item.url) {
              res.push({
                id: item.id,
                title: item.title,
                url: item.url,
                dateAdded: item.dateAdded,
                folder: folderTitle || '未分类'
              });
            }
            if (item.children) {
              traverse(item.children, item.title || folderTitle);
            }
          }
        };
        traverse(nodes, parentTitle);
        return res;
      };
      
      chrome.bookmarks.getTree((bookmarkTree) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
          return;
        }
        
        const allNodes = [];
        if (bookmarkTree[0]?.children) {
          for (const child of bookmarkTree[0].children) {
            if (child.children) {
              allNodes.push({ title: child.title, children: child.children });
            }
          }
        }
        
        const allBookmarks = collectBookmarks([{ children: allNodes }]);
        
        if (allBookmarks.length === 0) {
          sendResponse({ error: '未找到任何书签' });
          return;
        }
        
        sendResponse({ bookmarks: allBookmarks });
      });
    });
    
    return true;
  }
  
  // 清除缓存
  if (request.action === 'clearCache') {
    cachedBingImageUrl = null;
    cacheTimestamp = 0;
    sendResponse({ success: true });
    return true;
  }
});

// 插件安装时初始化
chrome.runtime.onInstalled.addListener((details) => {
});
