package main

// FalconBEND local launcher. No third-party Go dependencies.
// The executable always binds to loopback. A first-run production build
// is created automatically from the included source using Node/npm.

import (
    "crypto/sha256"
    "encoding/hex"
    "encoding/json"
    "errors"
    "fmt"
    "io"
    "log"
    "net"
    "net/http"
    "os"
    "os/exec"
    "path/filepath"
    "runtime"
    "sort"
    "strings"
    "sync"
    "time"
)

const (
    firstPort   = 45971
    lastPort    = 45979
    appMarker   = "FalconBEND-Local-1"
    manifest    = ".falcon-build-hash.txt"
)

type appStatus struct {
    Ready     bool     `json:"ready"`
    Busy      bool     `json:"busy"`
    Stage     string   `json:"stage"`
    Error     string   `json:"error"`
    Log       []string `json:"log"`
}

type appServer struct {
    mu       sync.RWMutex
    state    appStatus
    baseDir  string
    distDir  string
    httpSrv  *http.Server
    port     int
}

func (a *appServer) snapshot() appStatus {
    a.mu.RLock()
    defer a.mu.RUnlock()
    cp := a.state
    cp.Log = append([]string(nil), a.state.Log...)
    return cp
}

func (a *appServer) note(line string) {
    line = strings.TrimSpace(strings.ReplaceAll(line, "\r", ""))
    if line == "" { return }
    if len(line) > 500 { line = line[:500] + "…" }
    a.mu.Lock()
    a.state.Log = append(a.state.Log, line)
    if len(a.state.Log) > 100 { a.state.Log = a.state.Log[len(a.state.Log)-100:] }
    a.mu.Unlock()
}

func (a *appServer) setStage(stage string) {
    a.mu.Lock()
    a.state.Stage = stage
    a.mu.Unlock()
}

func (a *appServer) startBuild() {
    a.mu.Lock()
    if a.state.Busy { a.mu.Unlock(); return }
    a.state.Busy = true
    a.state.Ready = false
    a.state.Error = ""
    a.state.Stage = "Sprawdzanie konfiguracji…"
    a.state.Log = nil
    a.mu.Unlock()
    go func() {
        if err := a.build(); err != nil {
            a.note("Błąd: " + err.Error())
            a.mu.Lock()
            a.state.Busy = false
            a.state.Ready = false
            a.state.Error = err.Error()
            a.state.Stage = "Nie udało się przygotować aplikacji"
            a.mu.Unlock()
            return
        }
        a.mu.Lock()
        a.state.Busy = false
        a.state.Ready = true
        a.state.Stage = "Aplikacja gotowa"
        a.mu.Unlock()
    }()
}

func (a *appServer) runNpm(args ...string) error {
    name := "npm"
    if runtime.GOOS == "windows" { name = "npm.cmd" }
    if _, err := exec.LookPath(name); err != nil {
        return fmt.Errorf("nie znaleziono Node.js/npm. Zainstaluj aktualny Node.js LTS i uruchom FalconBEND ponownie: %w", err)
    }
    cmd := exec.Command(name, args...)
    cmd.Dir = a.baseDir
    hideChildWindow(cmd)
    cmd.Env = append(os.Environ(), "NPM_CONFIG_AUDIT=false", "NPM_CONFIG_FUND=false")
    w := &lineWriter{writeLine: a.note}
    cmd.Stdout, cmd.Stderr = w, w
    a.note("npm " + strings.Join(args, " "))
    err := cmd.Run()
    w.flush()
    if err != nil { return fmt.Errorf("polecenie npm %s zakończyło się błędem: %w", strings.Join(args, " "), err) }
    return nil
}

func (a *appServer) build() error {
    if _, err := os.Stat(filepath.Join(a.baseDir, "package.json")); err != nil {
        return errors.New("brak package.json: uruchom FalconBEND.exe z rozpakowanego folderu projektu")
    }
    a.setStage("Instalowanie zależności (tylko pierwszy raz lub po aktualizacji)…")
    lockfile := filepath.Join(a.baseDir, "package-lock.json")
    _, lockErr := os.Stat(lockfile)
    _, modsErr := os.Stat(filepath.Join(a.baseDir, "node_modules"))
    if modsErr != nil {
        if lockErr == nil {
            if err := a.runNpm("ci", "--no-audit", "--no-fund"); err != nil { return err }
        } else if err := a.runNpm("install", "--no-audit", "--no-fund"); err != nil { return err }
    } else {
        // Source/package update: npm install is idempotent and keeps deps in sync.
        if err := a.runNpm("install", "--no-audit", "--no-fund"); err != nil { return err }
    }
    a.setStage("Budowanie wersji offline…")
    if err := a.runNpm("run", "build"); err != nil { return err }
    if _, err := os.Stat(filepath.Join(a.distDir, "index.html")); err != nil { return fmt.Errorf("Vite nie utworzył dist/index.html: %w", err) }
    digest, err := projectDigest(a.baseDir)
    if err != nil { return err }
    if err := os.WriteFile(filepath.Join(a.distDir, manifest), []byte(digest+"\n"), 0644); err != nil { return err }
    a.note("Zbudowano aplikację. Kolejne uruchomienia nie wymagają npm ani internetu.")
    return nil
}

type lineWriter struct {
    mu sync.Mutex
    pending string
    writeLine func(string)
}
func (w *lineWriter) Write(p []byte) (int, error) {
    w.mu.Lock()
    defer w.mu.Unlock()
    w.pending += string(p)
    lines := strings.Split(w.pending, "\n")
    for _, l := range lines[:len(lines)-1] { w.writeLine(l) }
    w.pending = lines[len(lines)-1]
    if len(w.pending) > 10000 { w.writeLine(w.pending[:10000]); w.pending = "" }
    return len(p), nil
}
func (w *lineWriter) flush() {
    w.mu.Lock()
    defer w.mu.Unlock()
    if w.pending != "" { w.writeLine(w.pending); w.pending = "" }
}

func projectDigest(base string) (string, error) {
    files := []string{"package.json", "vite.config.ts", "index.html", "tsconfig.json"}
    if _, err := os.Stat(filepath.Join(base, "package-lock.json")); err == nil {
        files = append(files, "package-lock.json")
    }
    for _, dir := range []string{"src", "public"} {
        err := filepath.Walk(filepath.Join(base, dir), func(full string, info os.FileInfo, err error) error {
            if err != nil { return err }
            if info.IsDir() { return nil }
            rel, err := filepath.Rel(base, full)
            if err != nil { return err }
            files = append(files, rel)
            return nil
        })
        if err != nil { return "", err }
    }
    sort.Strings(files)
    h := sha256.New()
    h.Write([]byte("FalconBEND-launcher-v1\n"))
    for _, rel := range files {
        h.Write([]byte(filepath.ToSlash(rel) + "\x00"))
        file, err := os.Open(filepath.Join(base, rel))
        if err != nil { return "", err }
        _, readErr := io.Copy(h, file)
        closeErr := file.Close()
        if readErr != nil { return "", readErr }
        if closeErr != nil { return "", closeErr }
    }
    return hex.EncodeToString(h.Sum(nil)), nil
}

func (a *appServer) isBuilt() bool {
    if _, err := os.Stat(filepath.Join(a.distDir, "index.html")); err != nil { return false }
    saved, err := os.ReadFile(filepath.Join(a.distDir, manifest))
    if err != nil { return false }
    digest, err := projectDigest(a.baseDir)
    return err == nil && strings.TrimSpace(string(saved)) == digest
}

func isLocalHost(host string, port int) bool {
    return host == fmt.Sprintf("127.0.0.1:%d", port) || host == fmt.Sprintf("localhost:%d", port)
}
func (a *appServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    if !isLocalHost(r.Host, a.port) { http.Error(w, "Dostęp wyłącznie lokalny", http.StatusForbidden); return }
    w.Header().Set("X-Content-Type-Options", "nosniff")
    if strings.HasPrefix(r.URL.Path, "/__falcon_") { a.api(w, r); return }
    status := a.snapshot()
    if !status.Ready {
        w.Header().Set("Content-Type", "text/html; charset=utf-8")
        w.Header().Set("Cache-Control", "no-store")
        io.WriteString(w, setupPage)
        return
    }
    if r.URL.Path == "/" || r.URL.Path == "/index.html" {
        w.Header().Set("Cache-Control", "no-store")
    }
    fileServer := http.FileServer(http.Dir(a.distDir))
    localPath := filepath.Join(a.distDir, filepath.FromSlash(strings.TrimPrefix(filepath.Clean(r.URL.Path), string(filepath.Separator))))
    if info, err := os.Stat(localPath); err != nil || (info.IsDir() && r.URL.Path != "/") {
        // Browser-based navigation in a client-side SPA.
        if filepath.Ext(r.URL.Path) == "" {
            r2 := r.Clone(r.Context())
            r2.URL.Path = "/"
            fileServer.ServeHTTP(w, r2)
            return
        }
    }
    fileServer.ServeHTTP(w, r)
}
func (a *appServer) api(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Cache-Control", "no-store")
    switch r.URL.Path {
    case "/__falcon_health":
        w.Header().Set("Content-Type", "text/plain")
        io.WriteString(w, appMarker)
    case "/__falcon_status":
        w.Header().Set("Content-Type", "application/json; charset=utf-8")
        _ = json.NewEncoder(w).Encode(a.snapshot())
    case "/__falcon_retry":
        if r.Method != http.MethodPost || r.Header.Get("X-FalconBEND-Action") != "1" { http.Error(w, "Forbidden", 403); return }
        a.startBuild()
        w.WriteHeader(http.StatusNoContent)
    case "/__falcon_stop":
        if r.Method != http.MethodPost || r.Header.Get("X-FalconBEND-Action") != "1" { http.Error(w, "Forbidden", 403); return }
        w.WriteHeader(http.StatusNoContent)
        go func() { time.Sleep(200*time.Millisecond); _ = a.httpSrv.Close() }()
    default:
        http.NotFound(w, r)
    }
}

func aliveAt(port int) bool {
    client := http.Client{Timeout: 500*time.Millisecond}
    url := fmt.Sprintf("http://127.0.0.1:%d/__falcon_health", port)
    resp, err := client.Get(url)
    if err != nil { return false }
    defer resp.Body.Close()
    buf, _ := io.ReadAll(io.LimitReader(resp.Body, 64))
    return resp.StatusCode == 200 && string(buf) == appMarker
}
func stopInstance() {
    client := http.Client{Timeout: 650*time.Millisecond}
    for port := firstPort; port <= lastPort; port++ {
        if !aliveAt(port) { continue }
        req, _ := http.NewRequest(http.MethodPost, fmt.Sprintf("http://127.0.0.1:%d/__falcon_stop", port), nil)
        req.Header.Set("X-FalconBEND-Action", "1")
        resp, err := client.Do(req)
        if err == nil { resp.Body.Close() }
    }
}
func exeDirectory() string {
    path, err := os.Executable()
    if err != nil { return "." }
    abs, err := filepath.EvalSymlinks(path)
    if err == nil { path = abs }
    return filepath.Dir(path)
}
func main() {
    if len(os.Args) > 1 && os.Args[1] == "--stop" { stopInstance(); return }
    base := exeDirectory()
    for port := firstPort; port <= lastPort; port++ {
        if aliveAt(port) {
            _ = openBrowser(fmt.Sprintf("http://127.0.0.1:%d/", port))
            return
        }
    }
    a := &appServer{baseDir: base, distDir: filepath.Join(base, "dist")}
    if a.isBuilt() {
        a.state.Ready = true
        a.state.Stage = "Aplikacja gotowa"
    } else {
        a.state.Stage = "Uruchamianie pierwszej instalacji…"
    }
    var listener net.Listener
    for port := firstPort; port <= lastPort; port++ {
        l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
        if err == nil { listener, a.port = l, port; break }
        // Another launch may win the race; re-check the health endpoint.
        if aliveAt(port) { _ = openBrowser(fmt.Sprintf("http://127.0.0.1:%d/", port)); return }
    }
    if listener == nil {
        log.Print("FalconBEND cannot listen on loopback ports 45971-45979")
        return
    }
    a.httpSrv = &http.Server{Handler: a, ReadHeaderTimeout: 5*time.Second}
    if !a.state.Ready { a.startBuild() }
    _ = openBrowser(fmt.Sprintf("http://127.0.0.1:%d/", a.port))
    if err := a.httpSrv.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) { log.Print(err) }
}


const setupPage = `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FalconBEND | Przygotowanie</title><style>
*{box-sizing:border-box}body{margin:0;background:#0b1017;color:#e2e8f0;font:15px system-ui,Segoe UI,Arial,sans-serif}
main{max-width:780px;margin:8vh auto;padding:0 24px}h1{font-size:32px;margin:0 0 12px;color:#38bdf8}p{line-height:1.6;color:#a7b6c8}
.card{padding:24px;border:1px solid #27384f;border-radius:13px;background:#121b28}.bar{width:100%;height:5px;background:#202e40;overflow:hidden;border-radius:5px;margin:18px 0}
.bar:before{content:"";display:block;height:100%;width:35%;background:#0ea5e9;animation:m 1.5s infinite ease-in-out}@keyframes m{0%{margin-left:-35%}100%{margin-left:100%}}
pre{background:#080e17;border-radius:8px;padding:14px;color:#b3c3d4;font:12px/1.6 Consolas,monospace;max-height:300px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}
button{border:0;border-radius:8px;background:#0284c7;color:white;padding:12px 18px;cursor:pointer}button:disabled{opacity:.5;cursor:default}
small{color:#74869d} .err{color:#fda4af} .hidden{display:none}
</style></head><body><main><h1>FalconBEND</h1><p>Uruchamianie lokalnej wersji symulatora gięcia.</p>
<div class="card"><strong id="stage">Sprawdzam instalację…</strong><div id="bar" class="bar"></div>
<p class="err hidden" id="error"></p><button class="hidden" id="retry">Spróbuj ponownie</button>
<pre id="log">Oczekiwanie na uruchomienie…</pre>
<small>Instalacja zależności wymaga internetu tylko przy pierwszym uruchomieniu lub po aktualizacji kodu. Później symulator działa offline.</small>
</div></main><script>
const stage=document.getElementById('stage'),err=document.getElementById('error'),retry=document.getElementById('retry'),bar=document.getElementById('bar'),logs=document.getElementById('log');
async function poll(){try{const r=await fetch('/__falcon_status',{cache:'no-store'});const s=await r.json();if(s.ready){location.replace('/');return;}
stage.textContent=s.stage||'Przygotowanie…';logs.textContent=(s.log||[]).join('\n')||'Proszę czekać…';logs.scrollTop=logs.scrollHeight;
err.textContent=s.error||'';err.classList.toggle('hidden',!s.error);retry.classList.toggle('hidden',s.busy||!s.error);bar.classList.toggle('hidden',!s.busy);
}catch(e){stage.textContent='Brak połączenia z lokalnym serwerem';err.textContent=String(e);err.classList.remove('hidden');}}
retry.addEventListener('click',async()=>{retry.disabled=true;try{await fetch('/__falcon_retry',{method:'POST',headers:{'X-FalconBEND-Action':'1'}});}finally{retry.disabled=false;poll();}});
poll();setInterval(poll,1200);
</script></body></html>`
