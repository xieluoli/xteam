// Runs before React and styles render; storage is optional in private browsers.
(() => {
    let theme = 'japan-blues';
    try {
        if (localStorage.getItem('xteam-theme') === 'cyberpunk') theme = 'cyberpunk';
    } catch {}
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').content = theme === 'cyberpunk' ? '#bc13fe' : '#90a1b9';
})();
