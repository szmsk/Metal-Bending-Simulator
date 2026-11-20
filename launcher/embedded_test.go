package main

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestBundledSourceContainsRealProject(t *testing.T) {
	data, err := archiveBytes()
	if err != nil || len(data) < 100000 {
		t.Fatalf("empty source bundle: %v", err)
	}
	digest, err := archiveDigest()
	if err != nil || len(digest) != 64 {
		t.Fatalf("digest: %q %v", digest, err)
	}
	target := filepath.Join(t.TempDir(), "cache", "FalconBEND", digest[:16])
	if err := ensureBundledProject(target); err != nil {
		t.Fatal(err)
	}
	for _, file := range []string{"package.json", "index.html", "vite.config.ts", "tsconfig.json", "src/main.tsx", "src/engine/collisionEngine.ts", "public/assets/aistudio/image_91565746.png"} {
		if !fileExists(filepath.Join(target, file)) {
			t.Errorf("missing: %s", file)
		}
	}
	if _, err := projectDigest(target); err != nil {
		t.Fatal(err)
	}
	// Repeating startup does not overwrite generated files like dist/.
	if err := os.MkdirAll(filepath.Join(target, "dist"), 0700); err != nil {
		t.Fatal(err)
	}
	keep := filepath.Join(target, "dist", "index.html")
	if err := os.WriteFile(keep, []byte("built"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := ensureBundledProject(target); err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(keep); err != nil || string(data) != "built" {
		t.Fatal("bundle unpack repeated on restart")
	}
}
func TestIncompleteCachedSourceIsRestored(t *testing.T) {
	target := filepath.Join(t.TempDir(), "versions", "fixed")
	if err := ensureBundledProject(target); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(target, "package.json")); err != nil {
		t.Fatal(err)
	}
	if err := ensureBundledProject(target); err != nil {
		t.Fatal(err)
	}
	if !fileExists(filepath.Join(target, "package.json")) {
		t.Fatal("missing source not repaired")
	}
}
func TestProjectResolutionWhenExecutableMoved(t *testing.T) {
	dir := t.TempDir()
	dst, bundled, err := resolveProjectDirectory(dir)
	if err != nil {
		t.Fatal(err)
	}
	if !bundled || !strings.Contains(dst, "FalconBEND") || dst == dir {
		t.Fatalf("expected built-in project fallback: %s %v", dst, bundled)
	}
	if err := os.WriteFile(filepath.Join(dir, "package.json"), []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "src"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "src", "main.tsx"), []byte("ok"), 0600); err != nil {
		t.Fatal(err)
	}
	dst, bundled, err = resolveProjectDirectory(dir)
	if err != nil || bundled || dst != dir {
		t.Fatalf("source folder should be used: %s %v %v", dst, bundled, err)
	}
}

// Simulates a Windows first run without downloading npm packages. The fake
// package manager writes a built index.html so we can verify the Go logic.
func TestFirstStartWithOnlyExecutableAndSecondStartOffline(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX fake npm; Windows startup logic is compiled separately")
	}
	root := t.TempDir()
	bin := filepath.Join(root, "bin")
	if err := os.MkdirAll(bin, 0700); err != nil {
		t.Fatal(err)
	}
	script := "#!/bin/sh\nif [ \"$1\" = 'run' ] && [ \"$2\" = 'build' ]; then\n mkdir -p dist; echo '<html>Bundled app ready</html>' >dist/index.html\nfi\nexit 0\n"
	if err := os.WriteFile(filepath.Join(bin, "npm"), []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	appPath := filepath.Join(root, "FalconBEND", "versions", "test")
	app := &appServer{baseDir: appPath, distDir: filepath.Join(appPath, "dist"), bundled: true, port: firstPort}
	if err := app.build(); err != nil {
		t.Fatal(err)
	}
	if !app.isBuilt() {
		t.Fatal("first build is not ready")
	}
	// User moved EXE, but cache remains intact and must NOT require npm again.
	if err := os.Remove(filepath.Join(bin, "npm")); err != nil {
		t.Fatal(err)
	}
	if !app.isBuilt() {
		t.Fatal("offline second launch should reuse app")
	}
}
