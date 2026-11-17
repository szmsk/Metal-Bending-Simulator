package main

import (
    "encoding/json"
    "net/http"
    "net/http/httptest"
    "os"
    "path/filepath"
    "strings"
    "testing"
)

func makeFakeProject(t *testing.T) *appServer {
    t.Helper()
    dir := t.TempDir()
    for _, folder := range []string{"src", "public", "dist"} {
        if err := os.Mkdir(filepath.Join(dir, folder), 0755); err != nil { t.Fatal(err) }
    }
    for name, data := range map[string]string{
        "package.json": "{}", "index.html": "<html></html>",
        "vite.config.ts": "export default {}", "tsconfig.json": "{}",
        "src/main.tsx": "hello", "dist/index.html": "<!doctype html><h1>offline works</h1>",
    } {
        if err := os.WriteFile(filepath.Join(dir, name), []byte(data), 0644); err != nil { t.Fatal(err) }
    }
    return &appServer{baseDir: dir, distDir: filepath.Join(dir, "dist"), port: firstPort}
}
func TestBuildDigestDetectsSourceUpdate(t *testing.T) {
    app := makeFakeProject(t)
    digest, err := projectDigest(app.baseDir)
    if err != nil { t.Fatal(err) }
    if err := os.WriteFile(filepath.Join(app.distDir, manifest), []byte(digest), 0644); err != nil { t.Fatal(err) }
    if !app.isBuilt() { t.Fatal("expected built distribution") }
    if err := os.WriteFile(filepath.Join(app.baseDir, "src/main.tsx"), []byte("changed"), 0644); err != nil { t.Fatal(err) }
    if app.isBuilt() { t.Fatal("should rebuild after source update") }
}
func TestServerRendersOfflineDist(t *testing.T) {
    app := makeFakeProject(t)
    app.state.Ready = true
    app.state.Stage = "Aplikacja gotowa"
    req := httptest.NewRequest("GET", "http://127.0.0.1:45971/", nil)
    w := httptest.NewRecorder()
    app.ServeHTTP(w, req)
    if w.Code != 200 || !strings.Contains(w.Body.String(), "offline works") { t.Fatalf("code %d body %s", w.Code, w.Body.String()) }
}
func TestPreparingScreenAndState(t *testing.T) {
    app := makeFakeProject(t)
    app.state.Stage = "Przygotowanie"
    w := httptest.NewRecorder()
    app.ServeHTTP(w, httptest.NewRequest("GET", "http://127.0.0.1:45971/", nil))
    if w.Code != 200 || !strings.Contains(w.Body.String(), "FalconBEND") { t.Fatal("missing setup screen") }
    w = httptest.NewRecorder()
    app.ServeHTTP(w, httptest.NewRequest("GET", "http://127.0.0.1:45971/__falcon_status", nil))
    var status appStatus
    if err := json.Unmarshal(w.Body.Bytes(), &status); err != nil || status.Stage != "Przygotowanie" { t.Fatalf("bad status: %s %v", w.Body.String(), err) }
}
func TestRejectForeignHostsAndUnauthorizedStop(t *testing.T) {
    app := makeFakeProject(t)
    app.state.Ready = true
    w := httptest.NewRecorder()
    app.ServeHTTP(w, httptest.NewRequest("GET", "http://evil.example/", nil))
    if w.Code != http.StatusForbidden { t.Fatalf("host must be rejected, got %d", w.Code) }
    w = httptest.NewRecorder()
    app.ServeHTTP(w, httptest.NewRequest("POST", "http://127.0.0.1:45971/__falcon_stop", nil))
    if w.Code != http.StatusForbidden { t.Fatalf("POST without action header must be rejected, got %d", w.Code) }
}
