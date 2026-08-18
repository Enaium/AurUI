package cn.enaium.aurui

import cn.enaium.webview.createWebview
import cn.enaium.webview.WindowSizeHint

fun main() {
    createWebview(debug = true).use { webview ->
        webview.setTitle("AurUI")
        webview.setSize(1000, 700, WindowSizeHint.NONE)

        val pacman = PacmanService(webview)

        // JS <-> Kotlin bindings.
        webview.bind("getEmbeddedHtml", pacman::bindGetEmbeddedHtml)
        webview.bind("checkParu",       pacman::bindCheckParu)
        webview.bind("search",          pacman::bindSearch)
        webview.bind("listInstalled",   pacman::bindListInstalled)
        webview.bind("install",         pacman::bindInstall)
        webview.bind("remove",          pacman::bindRemove)
        webview.bind("sync",            pacman::bindSync)
        webview.bind("upgrade",         pacman::bindUpgrade)
        webview.bind("cleanCache",      pacman::bindCleanCache)
        webview.bind("commandInput",    pacman::bindCommandInput)

        // Show the lightweight loader.  Its inline script calls
        // getEmbeddedHtml, creates a blob URL, and navigates — so the
        // large React bundle never touches a data:text/html URL.
        webview.setHtml(LOADING_PAGE)
        webview.run()
    }
}
