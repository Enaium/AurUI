package cn.enaium.aurui

import kotlinx.cinterop.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.launch
import platform.posix.*

/**
 * Runs a POSIX command by forking a child, capturing combined stdout+stderr
 * via a pipe, and streaming each line/status update to [onLine].
 * [onDone] is called with the exit code on the parent side.
 */
object CommandRunner {

    fun runCommand(
        cmd: List<String>,
        onLine: (String) -> Unit,
        onDone: (Int) -> Unit,
        interactive: Boolean = false,
        env: Map<String, String> = emptyMap(),
    ) {
        GlobalScope.launch(Dispatchers.Default) {
            try {
                val exitCode = execCapture(cmd, interactive, onLine, env)
                onDone(exitCode)
            } catch (e: Exception) {
                onLine("Error: ${e.message}")
                onDone(-1)
            }
        }
    }

    fun runCapture(
        cmd: List<String>,
        onResult: (String, Int) -> Unit,
    ) {
        val buf = StringBuilder()
        runCommand(
            cmd = cmd,
            onLine = { buf.appendLine(it) },
            onDone = { code -> onResult(buf.toString().trimEnd('\n'), code) },
        )
    }

    /**
     * Synchronous version — blocks until the command finishes.
     */
    fun runCaptureSync(cmd: List<String>): Pair<String, Int> {
        val buf = StringBuilder()
        val exitCode = execCapture(cmd, interactive = false, onLine = { buf.appendLine(it) })
        return Pair(buf.toString().trimEnd('\n'), exitCode)
    }

    private var activePid: Int = -1
    private var activeInputFd: Int = -1

    @OptIn(ExperimentalForeignApi::class)
    fun sendInput(input: String): Boolean {
        val fd = activeInputFd
        if (fd < 0) return false

        val bytes = input.encodeToByteArray()
        if (bytes.isEmpty()) return true

        var offset = 0
        bytes.usePinned { pinned ->
            while (offset < bytes.size) {
                val n = write(
                    fd,
                    pinned.addressOf(offset),
                    (bytes.size - offset).toULong(),
                )
                if (n <= 0L) return false
                offset += n.toInt()
            }
        }
        return true
    }

    // -----------------------------------------------------------------------
    // POSIX fork + pipe + exec  (memScoped)
    // -----------------------------------------------------------------------

    @OptIn(ExperimentalForeignApi::class)
    private fun execCapture(
        cmd: List<String>,
        interactive: Boolean,
        onLine: (String) -> Unit,
        env: Map<String, String> = emptyMap(),
    ): Int = memScoped {
        val pipeFd = allocArray<IntVar>(2)
        check(pipe(pipeFd.reinterpret()) == 0) { "pipe() failed" }

        val inputFd = allocArray<IntVar>(2)
        if (interactive) {
            check(pipe(inputFd.reinterpret()) == 0) { "stdin pipe() failed" }
        }

        val pid: Int = fork()

        if (pid == 0) {
            // ---- child ----
            close(pipeFd[0])
            dup2(pipeFd[1], STDOUT_FILENO)
            dup2(pipeFd[1], STDERR_FILENO)
            close(pipeFd[1])

            if (interactive) {
                close(inputFd[1])
                dup2(inputFd[0], STDIN_FILENO)
                close(inputFd[0])
            }

            // Set extra environment variables before exec.
            for ((key, value) in env) {
                setenv(key, value, 1)
            }

            // execvp requires a null-terminated array of C strings.
            val cArgv = allocArray<CPointerVarOf<CPointer<ByteVar>>>(cmd.size + 1)
            cmd.forEachIndexed { i, s -> cArgv[i] = s.cstr.ptr }
            cArgv[cmd.size] = null

            execvp(cmd[0], cArgv.reinterpret())
            _exit(127)
        }

        // ---- parent ----
        close(pipeFd[1])
        if (interactive) {
            close(inputFd[0])
            activePid = pid
            activeInputFd = inputFd[1]
        }

        val chunkSize = 8192
        val chunk = ByteArray(chunkSize)
        val lineBuf = StringBuilder()

        while (true) {
            val n: Long = chunk.usePinned { pinned ->
                read(pipeFd[0], pinned.addressOf(0), chunkSize.toULong())
            }
            if (n <= 0L) break
            emitLines(chunk.decodeToString(0, n.toInt()), lineBuf, onLine)
            if (interactive) {
                emitBufferedLine(lineBuf, onLine)
            }
        }

        emitBufferedLine(lineBuf, onLine)

        close(pipeFd[0])
        if (interactive) {
            val fd = inputFd[1]
            if (activePid == pid && activeInputFd == fd) {
                activePid = -1
                activeInputFd = -1
            }
            close(fd)
        }

        // Reap child and extract exit code.
        val status = alloc<IntVar>()
        waitpid(pid, status.ptr.reinterpret(), 0)
        status.value shr 8
    }

    private fun emitLines(
        text: String,
        lineBuf: StringBuilder,
        onLine: (String) -> Unit,
    ) {
        var i = 0
        while (i < text.length) {
            when (val ch = text[i]) {
                '\n', '\r' -> {
                    emitBufferedLine(lineBuf, onLine)
                    if (ch == '\r' && i + 1 < text.length && text[i + 1] == '\n') {
                        i++
                    }
                }
                else -> lineBuf.append(ch)
            }
            i++
        }
    }

    private fun emitBufferedLine(
        lineBuf: StringBuilder,
        onLine: (String) -> Unit,
    ) {
        if (lineBuf.isEmpty()) return
        onLine(lineBuf.toString())
        lineBuf.clear()
    }
}
