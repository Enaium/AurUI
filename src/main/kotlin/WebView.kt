package cn.enaium.aurui

/**
 * Minimal loading page shown by webview.setHtml.
 *
 * It calls the registered `getEmbeddedHtml` binding to retrieve the
 * single-file React app, wraps the result in a Blob, and navigates to
 * the resulting `blob:` URL — bypassing the data:text/html size limit of
 * raw setHtml.
 */
val LOADING_PAGE: String = """
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>AurUI</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #1e1e2e; color: #cdd6f4;
      display: flex; align-items: center; justify-content: center;
      height: 100vh; font-family: system-ui, sans-serif;
      flex-direction: column; gap: 18px;
    }
    .spinner {
      width: 40px; height: 40px; border: 4px solid #45475a;
      border-top-color: #89b4fa; border-radius: 50%;
      animation: spin .7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    p { color: #6c7086; font-size: 14px; }
    #err { color: #f38ba8; font-size: 13px; display: none; }
  </style>
</head>
<body>
  <div class="spinner"></div>
  <p>Loading AurUI&hellip;</p>
  <p id="err"></p>
  <script>
    (async function() {
      try {
        var html = await window.getEmbeddedHtml();
        var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        location.href = url;
      } catch (e) {
        document.getElementById('err').textContent = 'Failed to load: ' + e;
      }
    })();
  </script>
</body>
</html>
""".trimIndent()
