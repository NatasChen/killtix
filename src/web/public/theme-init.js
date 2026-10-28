(function () {
  try {
    // light unless dark was chosen (there is no "follow the system" theme)
    document.documentElement.dataset.theme = localStorage.getItem('td-theme') === 'dark' ? 'dark' : 'light';
  } catch (e) {
    document.documentElement.dataset.theme = 'light';
  }
})();
