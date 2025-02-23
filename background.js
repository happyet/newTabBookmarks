// background.js

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'fetchBingImageUrl') {
      fetch('https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN')
        .then(response => response.json())
        .then(data => {
          const imageUrl = `https://www.bing.com${data.images[0].url}`;
          sendResponse({ imageUrl: imageUrl }); // 确保发送的响应对象包含 imageUrl 属性
        })
        .catch(error => {
          console.error('Error fetching Bing image URL:', error);
          sendResponse({ imageUrl: null }); // 确保发送的响应对象包含 imageUrl 属性
        });
      return true; // 保持消息通道打开
    }
  });