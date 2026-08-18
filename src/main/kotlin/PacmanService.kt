package cn.enaium.aurui

import cn.enaium.webview.Webview
import common.getResource
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

@Serializable
data class PkgEntry(
    val repo: String,
    val name: String,
    val version: String,
    val installed: Boolean,
    val description: String,
)

@Serializable
data class InstalledPkg(
    val name: String,
    val version: String,
)

// ---------------------------------------------------------------------------
// PacmanService
// ---------------------------------------------------------------------------

class PacmanService(private val webview: Webview) {

    private val json = Json { ignoreUnknownKeys = true }
    private var paruAvailable: Boolean = false

    init {
        paruAvailable = detectParu()
    }

    // ---- helpers ----------------------------------------------------------

    private fun detectParu(): Boolean {
        val (_, code) = CommandRunner.runCaptureSync(listOf("which", "paru"))
        return code == 0
    }

    private fun jsonEscape(s: String): String =
        json.encodeToString(s)

    private fun pushEval(js: String) {
        webview.dispatch { webview.eval(js) }
    }

    private fun pushLine(line: String) {
        val escaped = jsonEscape(line)
        pushEval("window.onCommandOutput($escaped)")
    }

    private fun pushDone(code: Int) {
        pushEval("window.onCommandDone($code)")
    }

    private fun pushStart(cmd: String) {
        val escaped = jsonEscape(cmd)
        pushEval("window.onCommandStart($escaped)")
    }

    private fun pushInstalledChunk(requestId: String, chunk: String, done: Boolean) {
        val escapedId = jsonEscape(requestId)
        val escapedChunk = jsonEscape(chunk)
        pushEval("window.onInstalledPackagesChunk($escapedId, $escapedChunk, $done)")
    }

    private fun pushInstalledError(requestId: String, message: String) {
        val escapedId = jsonEscape(requestId)
        val escapedMessage = jsonEscape(message)
        pushEval("window.onInstalledPackagesChunk($escapedId, \"\", true, $escapedMessage)")
    }

    /**
     * Runs [cmd], streams every line via onCommandOutput, and signals
     * completion via onCommandDone.  The return-result for the originating
     * bind call is returned immediately.
     */
    private fun runStreaming(id: String, cmd: List<String>, env: Map<String, String> = emptyMap()) {
        pushStart(cmd.joinToString(" "))
        CommandRunner.runCommand(
            cmd = cmd,
            onLine = { pushLine(it) },
            onDone = { code ->
                pushDone(code)
                webview.returnResult(id, 0, code.toString())
            },
            interactive = true,
            env = env,
        )
    }

    /**
     * Runs [cmd] silently, collects all output, and parses it via [parser].
     * The [parser] must return a JSON-encoded string; it is returned to the
     * originating bind call as-is.
     */
    private fun runQuery(id: String, cmd: List<String>, parser: (String) -> String) {
        CommandRunner.runCapture(
            cmd = cmd,
            onResult = { output, _ ->
                val jsonResult = try {
                    parser(output)
                } catch (e: Exception) {
                    "[]"
                }
                webview.returnResult(id, 0, jsonResult)
            },
        )
    }

    // ---- bind callbacks ---------------------------------------------------

    fun bindSearch(id: String, req: String) {
        val args = parseJsonArgs(req)
        val query = args.getOrElse(0) { "" }
        val source = args.getOrElse(1) { "official" }
        if (query.isBlank()) {
            webview.returnResult(id, 0, "[]")
            return
        }
        val cmd = if (source == "aur" && paruAvailable) {
            listOf("paru", "-Ss", "--aur", query)
        } else {
            listOf("pacman", "-Ss", query)
        }
        runQuery(id, cmd, ::parseSearchOutput)
    }

    fun bindListInstalled(id: String, req: String) {
        val requestId = parseJsonArgs(req).firstOrNull().orEmpty()

        if (requestId.isBlank()) {
            runQuery(id, listOf("pacman", "-Q")) { parseInstalledOutput(it) }
            return
        }

        webview.returnResult(id, 0, "true")

        CommandRunner.runCapture(
            cmd = listOf("pacman", "-Q"),
            onResult = { output, code ->
                if (code != 0) {
                    pushInstalledError(requestId, output.ifBlank { "pacman -Q failed with exit $code" })
                    return@runCapture
                }

                val jsonResult = try {
                    parseInstalledOutput(output)
                } catch (e: Exception) {
                    pushInstalledError(requestId, e.message ?: "Failed to parse installed package list")
                    return@runCapture
                }

                jsonResult.chunked(2048).forEach { chunk ->
                    pushInstalledChunk(requestId, chunk, false)
                }
                pushInstalledChunk(requestId, "", true)
            },
        )
    }

    fun bindInstall(id: String, req: String) {
        val args = parseJsonArgs(req)
        val name = args.getOrElse(0) { return }
        val source = args.getOrElse(1) { "official" }
        val cmd = if (source == "aur" && paruAvailable) {
            listOf("paru", "--sudo", "pkexec", "-S", "--noconfirm", name)
        } else {
            listOf("pkexec", "pacman", "-S", "--noconfirm", name)
        }
        runStreaming(id, cmd)
    }

    fun bindRemove(id: String, req: String) {
        val args = parseJsonArgs(req)
        val name = args.getOrElse(0) { return }
        runStreaming(id, listOf("pkexec", "pacman", "-Rns", "--noconfirm", name))
    }

    fun bindSync(id: String, @Suppress("UNUSED_PARAMETER") req: String) {
        runStreaming(id, listOf("pkexec", "pacman", "-Sy"))
    }

    fun bindUpgrade(id: String, @Suppress("UNUSED_PARAMETER") req: String) {
        val cmd = if (paruAvailable) {
            listOf("paru", "--sudo", "pkexec", "-Syu", "--noconfirm")
        } else {
            listOf("pkexec", "pacman", "-Syu", "--noconfirm")
        }
        runStreaming(id, cmd)
    }

    fun bindCleanCache(id: String, @Suppress("UNUSED_PARAMETER") req: String) {
        runStreaming(id, listOf("pkexec", "pacman", "-Sc", "--noconfirm"))
    }

    fun bindCommandInput(id: String, req: String) {
        val input = parseJsonArgs(req).firstOrNull().orEmpty()
        webview.returnResult(id, 0, CommandRunner.sendInput(input).toString())
    }

    fun bindGetEmbeddedHtml(id: String, @Suppress("UNUSED_PARAMETER") req: String) {
        // Reads the resource that was compiled into the binary by KEmbeddableResources.
        @Suppress("UNCHECKED_CAST")
        val html = common.getResource("www/index.html").asString()
        webview.returnResult(id, 0, jsonEscape(html))
    }

    fun bindCheckParu(id: String, @Suppress("UNUSED_PARAMETER") req: String) {
        webview.returnResult(id, 0, "\"$paruAvailable\"")
    }

    // ---- JSON helpers -----------------------------------------------------

    /**
     * Parses a JSON array string returned by webview's bind call into a
     * `List<String>`.  The raw req is like `[\"firefox\", \"aur\"]`.
     */
    private fun parseJsonArgs(req: String): List<String> {
        try {
            return json.decodeFromString(req)
        } catch (_: Exception) {
            // Fall through to the legacy parser for older/broken webview payloads.
        }

        val trimmed = req.trim()
            .removePrefix("[")
            .removeSuffix("]")
        if (trimmed.isBlank()) return emptyList()
        return trimmed.split(",").map { s ->
            s.trim()
                .removeSurrounding("\"")
                .replace("\\\"", "\"")
                .replace("\\\\", "\\")
        }
    }

    // ---- output parsers ---------------------------------------------------

    private fun parseSearchOutput(output: String): String {
        val entries = mutableListOf<PkgEntry>()
        val lines = output.lines()
        var i = 0
        while (i < lines.size) {
            val line = lines[i]
            val trimmed = line.trim()
            if (trimmed.isEmpty()) { i++; continue }

            // Package header: "repo/name version [installed]" (no leading space)
            if (!line.startsWith(" ") && trimmed.contains("/")) {
                val parts = trimmed.split("\\s+".toRegex())
                val repoName = parts[0]
                val slashIdx = repoName.indexOf('/')
                val repo = repoName.substring(0, slashIdx).trim()
                val name = repoName.substring(slashIdx + 1).trim()
                val version = parts.getOrElse(1) { "" }.trim()
                val installed = trimmed.contains("[installed]")

                // Next non-empty line is the description.
                var desc = ""
                var j = i + 1
                while (j < lines.size) {
                    val next = lines[j].trim()
                    if (next.isEmpty()) { j++; continue }
                    if (lines[j].startsWith(" ")) {
                        desc = next
                        j++
                    }
                    break
                }

                entries.add(PkgEntry(repo, name, version, installed, desc))
                i = j
            } else {
                i++
            }
        }
        return json.encodeToString(entries)
    }

    private fun parseInstalledOutput(output: String): String {
        val pkgs = output.lines().filter { it.isNotBlank() }.mapNotNull { line ->
            val parts = line.split("\\s+".toRegex(), limit = 2)
            if (parts.size >= 2) InstalledPkg(parts[0], parts[1]) else null
        }
        return json.encodeToString(pkgs)
    }
}
