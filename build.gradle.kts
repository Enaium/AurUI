import java.io.File

plugins {
    kotlin("multiplatform") version "2.4.10"
    kotlin("plugin.serialization") version "2.4.10"
    id("cn.rtast.kembeddable") version "1.3.8"
}

group = "cn.enaium"
version = "1.0.1"

kotlin {
    linuxX64 {
        binaries {
            executable {
                entryPoint = "cn.enaium.aurui.main"
                // Arch keeps system libs in /usr/lib; ld.lld doesn't search it
                // by default, so point it there for the GTK/WebKit link.
                linkerOpts("-L/usr/lib")
            }
        }
    }

    sourceSets {
        commonMain {
            // The user-facing Kotlin source lives in src/main/kotlin.
            kotlin.srcDir("src/main/kotlin")
            dependencies {
                implementation("cn.enaium.webview:webview-kmp:1.0.1")
                implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.11.0")
                implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")
            }
        }
    }
}

// Embed the built React single-file HTML (under src/main/resources) into the
// final executable. The generated `common.getResource(...)` is compiled in.
kembeddable {
    resourcePath.add(File("src/main/resources"))
    compression = false
}

// Build the React frontend with bun into src/main/resources/www/index.html.
val reactBuild = tasks.register<Exec>("reactBuild") {
    group = "build"
    description = "Builds the React frontend into a single HTML file with bun."
    workingDir = File("src/main/react")
    commandLine("bash", "-lc", "bun install && bun run build")
}

// Embed resources only after the frontend has been built.
tasks.named("generateResources") {
    dependsOn(reactBuild)
}

// The executable embeds the generated resources at link time.
tasks.named("linkDebugExecutableLinuxX64") {
    dependsOn("generateResources")
}

// Run the linked debug executable.
tasks.register<Exec>("runLinuxX64") {
    group = "application"
    description = "Runs the linked Linux x64 debug executable."
    dependsOn("linkDebugExecutableLinuxX64")
    doFirst {
        // Resolve the output path at execution time — the KotlinNativeLink
        // task type isn't available at script compilation time.
        val kexe = project.layout.buildDirectory.file(
            "bin/linuxX64/debugExecutable/AurUI.kexe"
        ).get().asFile
        commandLine(kexe.absolutePath)
    }
}