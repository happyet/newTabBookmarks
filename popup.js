// 在页面加载时自动获取当前网页信息并填充到输入框
document.addEventListener('DOMContentLoaded', async () => {
    try {
      // 获取当前活动的标签页
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
      // 获取当前网页的标题、URL 和 favicon
      const title = tab.title;
      const url = tab.url;
      const favicon = tab.favIconUrl;
  
      // 获取当前网页的 description meta 标签内容
      const description = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const metaDescription = document.querySelector('meta[name="description"]');
          return metaDescription ? metaDescription.content : '';
        }
      });
  
      // 填充到对应的输入框中
      document.getElementById('link-name').value = title;
      document.getElementById('link-url').value = url;
      document.getElementById('link-icon').value = favicon;
      document.getElementById('link-desc').value = description[0].result;
  
    } catch (error) {
      console.error('Error fetching current page info:', error);
    }
  });
  
  document.getElementById('add-link').addEventListener('click', async () => {
    const categoryName = document.getElementById('category-name').value;
    const linkName = document.getElementById('link-name').value;
    const linkUrl = document.getElementById('link-url').value;
    const linkIcon = document.getElementById('link-icon').value;
    const linkDesc = document.getElementById('link-desc').value;
  
    if (!categoryName || !linkName || !linkUrl) {
      alert('请填写标*字段！');
      return;
    }
  
    try {
      const data = await chrome.storage.sync.get({ navigation: {}, categoryOrder: [] });
      if (!data.navigation[categoryName]) {
        data.navigation[categoryName] = [];
        data.categoryOrder.push(categoryName);
      }
      data.navigation[categoryName].push({ name: linkName, url: linkUrl, icon: linkIcon, desc: linkDesc });
      await chrome.storage.sync.set({
        navigation: data.navigation,
        categoryOrder: data.categoryOrder,
      });
      // 发送消息到 newtab 页面
      chrome.tabs.query({ url: chrome.runtime.getURL('newtab.html') }, (tabs) => {
        tabs.forEach((tab) => {
          chrome.tabs.sendMessage(tab.id, { action: 'refresh' }, (response) => {
            if (chrome.runtime.lastError) {
              console.error('Failed to send message:', chrome.runtime.lastError);
            } else {
              console.log('Message sent successfully:', response);
            }
          });
        });
      });
  
      alert('链接已添加！');
      window.close();
    } catch (error) {
      console.error('Error adding link:', error);
      alert('添加链接失败，请重试。');
    }
  });