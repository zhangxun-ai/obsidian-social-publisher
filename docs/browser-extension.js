async function showExtensionRelease() {
  const status=document.getElementById('release-status');
  const detail=document.getElementById('release-detail');
  try {
    const response=await fetch('browser-extension-release.json',{cache:'no-store'});
    if(!response.ok)throw new Error('unavailable');
    const release=await response.json();
    // Only an explicitly verified published item gets an install link.
    if(release.status==='published' && typeof release.itemId==='string' && /^[a-p]{32}$/.test(release.itemId)){
      const url=`https://chromewebstore.google.com/detail/${release.itemId}`;
      document.getElementById('add-browser').href=url;
      status.textContent='商店安装已开放';detail.textContent='打开官方商店页面，在当前浏览器中确认添加扩展。';
      document.getElementById('store-actions').hidden=false;document.getElementById('browser-help').hidden=false;
    }else if(release.status==='in_review'){
      status.textContent='正在等待商店审核';detail.textContent='审核通过并确认商店页面可安装后，这里会提供添加入口。当前不能通过商店安装。';
    }else if(release.status!=='not_submitted')throw new Error('invalid release');
  }catch{
    status.textContent='暂时无法确认商店安装状态';detail.textContent='请稍后刷新本页。当前不展示未经确认的安装链接。';
  }
}
void showExtensionRelease();
