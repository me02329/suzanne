// Injecté dans l'app web par l'appli Android. Une WebView ne sait pas
// télécharger un blob: (exports CSV/JSON, sauvegardes) ni ouvrir un blob: dans
// un nouvel onglet (pièces jointes) : on les intercepte et on passe le contenu
// à Android (SuzanneAndroid.saveFile), qui l'enregistre dans Téléchargements.
(function () {
  if (window.__suzanneBridge || !window.SuzanneAndroid) return;
  window.__suzanneBridge = true;

  function send(url, filename, open) {
    fetch(url)
      .then(function (response) { return response.blob(); })
      .then(function (blob) {
        var reader = new FileReader();
        reader.onloadend = function () {
          var data = String(reader.result || '');
          var base64 = data.slice(data.indexOf(',') + 1);
          window.SuzanneAndroid.saveFile(base64, filename || '', blob.type || 'application/octet-stream', !!open);
        };
        reader.readAsDataURL(blob);
      })
      .catch(function (error) { window.SuzanneAndroid.log('bridge: ' + error); });
  }

  // Lien <a download href="blob:…"> (cliqué par le code, cf. lib/download.ts).
  document.addEventListener('click', function (event) {
    var link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!link) return;
    var href = link.href || '';
    if (href.indexOf('blob:') === 0 || href.indexOf('data:') === 0) {
      event.preventDefault();
      send(href, link.getAttribute('download') || '', !link.hasAttribute('download'));
    }
  }, true);

  // window.open(blob:…) : pièce jointe ouverte « dans un nouvel onglet ».
  var nativeOpen = window.open;
  window.open = function (url) {
    if (typeof url === 'string' && (url.indexOf('blob:') === 0 || url.indexOf('data:') === 0)) {
      send(url, '', true);
      return null;
    }
    return nativeOpen.apply(window, arguments);
  };
})();
