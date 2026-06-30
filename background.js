// background.js - 后台服务脚本

// 监听消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 获取所有书签 - 根据存储类型限制数量
  if (request.action === 'getBookmarks') {
    if (!chrome.bookmarks) {
      sendResponse({ error: chrome.i18n.getMessage('bookmark_api_unavailable') || 'Bookmarks API not available' });
      return true;
    }
    
    // 检查存储类型
    chrome.storage.local.get({ storageType: 'sync' }, (result) => {
      const isLocal = result.storageType === 'local';
      const limit = isLocal ? 500 : 100;
      
      // 递归获取所有书签
      const collectBookmarks = (nodes, parentTitle = '') => {
        const res = [];
        const traverse = (items, folderTitle) => {
          for (const item of items) {
            if (res.length >= limit) break;
            if (item.url) {
              res.push({
                id: item.id,
                title: item.title,
                url: item.url,
                dateAdded: item.dateAdded,
                folder: folderTitle || chrome.i18n.getMessage('uncategorized') || 'Uncategorized'
              });
            }
            if (item.children) {
              traverse(item.children, item.title || folderTitle);
              if (res.length >= limit) break;
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
          sendResponse({ error: chrome.i18n.getMessage('no_bookmarks') });
          return;
        }
        
        sendResponse({ bookmarks: allBookmarks });
      });
    });
    
    return true;
  }
  
});

// 监听书签变化，通知 newtab 页面刷新
['onChanged', 'onCreated', 'onRemoved', 'onMoved'].forEach(function(event) {
  chrome.bookmarks[event].addListener(function() {
    chrome.tabs.query({ url: chrome.runtime.getURL('newtab.html') }, function(tabList) {
      tabList.forEach(function(tab) {
        chrome.tabs.sendMessage(tab.id, { action: 'refresh' }).catch(function() {});
      });
    });
  });
});
