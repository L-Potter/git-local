package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"local.dev/gitops"
)

// ----------------------------- types -----------------------------

type fileChangeDTO struct {
	gitops.FileChange
	IsSQL bool `json:"isSql"`
}

type statusResp struct {
	Branch   string          `json:"branch"`
	Detached bool            `json:"detached"`
	Head     string          `json:"head"`
	Clean    bool            `json:"clean"`
	Files    []fileChangeDTO `json:"files"`
}

type changedFileDTO struct {
	gitops.ChangedFile
	IsSQL bool `json:"isSql"`
}

type commitInfoDTO struct {
	gitops.CommitInfo
	TimeRFC   string `json:"time"`      // override time formatting
	TimeLocal string `json:"timeLocal"` // human local timestamp
}

type commitDetailDTO struct {
	commitInfoDTO
	Files []changedFileDTO `json:"files"`
}

type diffResp struct {
	Path     string `json:"path"`
	OldText  string `json:"oldText"`
	NewText  string `json:"newText"`
	IsSQL    bool   `json:"isSql"`
	Binary   bool   `json:"binary"`
	Renderer string `json:"renderer"` // text | sql | binary
}

type apiError struct {
	Error string `json:"error"`
}

func toCommitInfoDTO(c gitops.CommitInfo) commitInfoDTO {
	return commitInfoDTO{
		CommitInfo: c,
		TimeRFC:    c.Time.Format(time.RFC3339),
		TimeLocal:  c.Time.Local().Format("2006-01-02 15:04:05 -07:00"),
	}
}

// ----------------------------- server ----------------------------

type server struct {
	mu           sync.Mutex
	repoDir      string
	authUsers    map[string]*Credentials // nil → web API 不需登入
	sessionTTL   time.Duration
	secureCookie bool // true 時 Set-Cookie 加 Secure（HTTPS）
}

func cmdServe(args []string) error {
	fs := flag.NewFlagSet("serve", flag.ContinueOnError)
	addr := fs.String("addr", ":7891", "listen address")
	repo := fs.String("repo", ".", "path to git repository")
	authDir := fs.String("auth-dir", "", "directory of *.ini credentials (one user per file); empty = no login")
	sessionHours := fs.Int("session-hours", 72, "signed session cookie lifetime when -auth-dir is set")
	secureCookie := fs.Bool("secure-cookie", false, "set Secure flag on session cookie (use behind HTTPS)")
	if err := fs.Parse(args); err != nil {
		return err
	}

	abs, err := filepath.Abs(*repo)
	if err != nil {
		return err
	}
	if _, err := gitops.Open(abs); err != nil {
		return fmt.Errorf("open repo at %s: %w", abs, err)
	}

	s := &server{
		repoDir:      abs,
		sessionTTL:   time.Duration(*sessionHours) * time.Hour,
		secureCookie: *secureCookie,
	}
	if strings.TrimSpace(*authDir) != "" {
		ad, err := filepath.Abs(*authDir)
		if err != nil {
			return err
		}
		users, err := LoadCredentialsDir(ad)
		if err != nil {
			return fmt.Errorf("load credentials from %s: %w", ad, err)
		}
		s.authUsers = users
		log.Printf("web auth enabled: %d user(s) from %s (session TTL %v)", len(users), ad, s.sessionTTL)
	}

	mux := http.NewServeMux()
	s.routes(mux)

	srv := &http.Server{
		Addr:              *addr,
		Handler:           logMiddleware(mux),
		ReadHeaderTimeout: 10 * time.Second,
	}

	log.Printf("my-git-tool web UI listening on http://localhost%s (repo: %s)", *addr, abs)
	return srv.ListenAndServe()
}

func (s *server) routes(mux *http.ServeMux) {
	mux.HandleFunc("/api/me", s.handleMe)
	if s.authUsers != nil {
		mux.HandleFunc("/api/login", s.handleLogin)
		mux.HandleFunc("/api/logout", s.handleLogout)
	}

	mux.HandleFunc("/api/status", s.withAuth(s.handleStatus))
	mux.HandleFunc("/api/stage", s.withAuth(s.handleStage))
	mux.HandleFunc("/api/unstage", s.withAuth(s.handleUnstage))
	mux.HandleFunc("/api/commit", s.withAuth(s.handleCommit))
	mux.HandleFunc("/api/diff", s.withAuth(s.handleDiff))
	mux.HandleFunc("/api/discard", s.withAuth(s.handleDiscard))

	mux.HandleFunc("/api/history", s.withAuth(s.handleHistory))
	mux.HandleFunc("/api/commit/detail", s.withAuth(s.handleCommitDetail))
	mux.HandleFunc("/api/restore", s.withAuth(s.handleRestoreFromRef))

	mux.Handle("/", staticHandler())
}

func (s *server) withAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.authUsers == nil {
			next(w, r)
			return
		}
		if _, ok := s.readSession(r); !ok {
			writeJSON(w, http.StatusUnauthorized, apiError{Error: "unauthorized"})
			return
		}
		next(w, r)
	}
}

func (s *server) readSession(r *http.Request) (username string, ok bool) {
	c, err := r.Cookie(sessionCookieName)
	if err != nil {
		return "", false
	}
	u, ok := ParseSession(c.Value)
	if !ok {
		return "", false
	}
	if _, exists := s.authUsers[u]; !exists {
		return "", false
	}
	return u, true
}

type loginReq struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (s *server) handleMe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, errors.New("GET only"))
		return
	}
	if s.authUsers == nil {
		writeJSON(w, 200, map[string]any{"authRequired": false})
		return
	}
	u, ok := s.readSession(r)
	if !ok {
		writeJSON(w, 200, map[string]any{"authRequired": true, "username": nil})
		return
	}
	writeJSON(w, 200, map[string]any{"authRequired": true, "username": u})
}

func (s *server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, errors.New("POST only"))
		return
	}
	if s.authUsers == nil {
		writeErr(w, http.StatusBadRequest, errors.New("login disabled (server started without -auth-dir)"))
		return
	}
	var req loginReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	if req.Username == "" || req.Password == "" {
		writeErr(w, http.StatusBadRequest, errors.New("username and password required"))
		return
	}
	creds, ok := s.authUsers[req.Username]
	if !ok || !creds.Verify(req.Username, req.Password) {
		// 固定訊息，避免帳號枚舉（username 不存在 vs 密碼錯）
		writeErr(w, http.StatusUnauthorized, errors.New("invalid username or password"))
		return
	}
	token, err := SignSession(req.Username, s.sessionTTL)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   int(s.sessionTTL.Seconds()),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   s.secureCookie,
	})
	writeJSON(w, 200, map[string]any{"ok": true, "username": req.Username})
}

func (s *server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, errors.New("POST only"))
		return
	}
	if s.authUsers == nil {
		writeErr(w, http.StatusBadRequest, errors.New("logout: auth not enabled"))
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   s.secureCookie,
	})
	writeJSON(w, 200, map[string]any{"ok": true})
}

func logMiddleware(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		h.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start))
	})
}

func (s *server) repo() (*gitops.Repo, error) {
	return gitops.Open(s.repoDir)
}

// ----------------------------- write helpers ---------------------

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, err error) {
	writeJSON(w, code, apiError{Error: err.Error()})
}

func decodeJSON(r *http.Request, v any) error {
	defer r.Body.Close()
	return json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(v)
}

// ----------------------------- handlers --------------------------

func (s *server) handleStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, errors.New("GET only"))
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	repo, err := s.repo()
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	st, err := repo.Status()
	if err != nil {
		writeErr(w, 500, err)
		return
	}

	resp := statusResp{
		Branch:   st.Branch,
		Detached: st.Detached,
		Head:     st.Head,
		Clean:    st.Clean,
	}
	for _, f := range st.Files {
		resp.Files = append(resp.Files, fileChangeDTO{
			FileChange: f,
			IsSQL:      isSQLPath(filepath.Join(s.repoDir, f.Path)),
		})
	}
	writeJSON(w, 200, resp)
}

type pathsReq struct {
	Paths []string `json:"paths"`
}

func (s *server) handleStage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, errors.New("POST only"))
		return
	}
	var req pathsReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, 400, err)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	repo, err := s.repo()
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	if err := repo.Add(req.Paths); err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "staged": req.Paths})
}

func (s *server) handleUnstage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, errors.New("POST only"))
		return
	}
	var req pathsReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, 400, err)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	repo, err := s.repo()
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	if err := repo.RestorePaths(req.Paths, true, false); err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *server) handleDiscard(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, errors.New("POST only"))
		return
	}
	var req pathsReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, 400, err)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	repo, err := s.repo()
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	if err := repo.RestorePaths(req.Paths, true, true); err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

type commitReq struct {
	Message  string   `json:"message"`
	Paths    []string `json:"paths"`
	StageAll bool     `json:"stageAll"`
}

func (s *server) handleCommit(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, errors.New("POST only"))
		return
	}
	var req commitReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, 400, err)
		return
	}
	if strings.TrimSpace(req.Message) == "" {
		writeErr(w, 400, errors.New("commit message is required"))
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	repo, err := s.repo()
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	if req.StageAll {
		if err := repo.AddAll(); err != nil {
			writeErr(w, 500, err)
			return
		}
	} else if len(req.Paths) > 0 {
		if err := repo.Add(req.Paths); err != nil {
			writeErr(w, 500, err)
			return
		}
	}

	hash, err := repo.Commit(req.Message, gitops.CommitOptions{})
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, map[string]any{
		"ok":    true,
		"hash":  hash,
		"short": hash[:7],
	})
}

// ----------------------------- diff ------------------------------

func (s *server) handleDiff(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, errors.New("GET only"))
		return
	}
	q := r.URL.Query()
	path := q.Get("path")
	if path == "" {
		writeErr(w, 400, errors.New("missing ?path"))
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	repo, err := s.repo()
	if err != nil {
		writeErr(w, 500, err)
		return
	}

	// Resolve old/new sources:
	//   ?commit=X    -> old = parent(X) ("" if root), new = X
	//   ?from=A&to=B -> old = A,                      new = B
	//   default      -> old = HEAD,                   new = worktree
	var oldRev, newRev string
	var newFromWT bool

	switch {
	case q.Get("commit") != "":
		commit := q.Get("commit")
		newRev = commit
		parent, err := repo.ParentOf(commit)
		if err != nil {
			writeErr(w, 400, fmt.Errorf("resolve %s: %w", commit, err))
			return
		}
		oldRev = parent // "" when root commit
	case q.Get("from") != "" || q.Get("to") != "":
		oldRev = q.Get("from")
		newRev = q.Get("to")
		if newRev == "" {
			newFromWT = true
		}
	default:
		oldRev = "HEAD"
		newFromWT = true
	}

	oldBlob, oldErr := repo.ReadBlob(oldRev, path)
	var newBlob []byte
	var newErr error
	if newFromWT {
		newBlob, newErr = readWorktreeFile(s.repoDir, path)
	} else {
		newBlob, newErr = repo.ReadBlob(newRev, path)
	}

	if oldErr != nil && !gitops.IsMissingBlob(oldErr) {
		writeErr(w, 500, fmt.Errorf("read old: %w", oldErr))
		return
	}
	if newErr != nil && !gitops.IsMissingBlob(newErr) {
		writeErr(w, 500, fmt.Errorf("read new: %w", newErr))
		return
	}

	out := diffResp{Path: path}

	sqlOld := IsSQLiteFile(oldBlob)
	sqlNew := IsSQLiteFile(newBlob) || (newBlob == nil && newFromWT && IsSQLitePath(path))

	switch {
	case sqlOld || sqlNew:
		out.IsSQL = true
		out.Renderer = "sql"
		out.OldText = sqliteDumpToText(oldBlob, "old")
		out.NewText = sqliteDumpToText(newBlob, "new")

	case gitops.IsBinary(oldBlob) || gitops.IsBinary(newBlob):
		out.Binary = true
		out.Renderer = "binary"
		out.OldText = fmt.Sprintf("(binary, %d bytes)", len(oldBlob))
		out.NewText = fmt.Sprintf("(binary, %d bytes)", len(newBlob))

	default:
		out.Renderer = "text"
		out.OldText = string(oldBlob)
		out.NewText = string(newBlob)
	}

	writeJSON(w, 200, out)
}

func readWorktreeFile(repoDir, path string) ([]byte, error) {
	data, err := os.ReadFile(filepath.Join(repoDir, path))
	if err != nil && os.IsNotExist(err) {
		return nil, nil
	}
	return data, err
}

func sqliteDumpToText(blob []byte, side string) string {
	if blob == nil {
		return ""
	}
	tmp, err := writeTempCopy(blob)
	if err != nil {
		return fmt.Sprintf("(failed to write temp %s: %v)\n", side, err)
	}
	defer os.Remove(tmp)
	var buf bytes.Buffer
	if err := DumpSQLiteFile(tmp, &buf); err != nil {
		return fmt.Sprintf("(failed to dump %s SQLite: %v)\n", side, err)
	}
	return buf.String()
}

func writeTempCopy(data []byte) (string, error) {
	f, err := os.CreateTemp("", "mygit-blob-*.sqlite")
	if err != nil {
		return "", err
	}
	defer f.Close()
	if _, err := f.Write(data); err != nil {
		os.Remove(f.Name())
		return "", err
	}
	return f.Name(), nil
}

// ----------------------------- helpers ---------------------------

func isSQLPath(absPath string) bool {
	if IsSQLitePath(absPath) {
		return true
	}
	f, err := os.Open(absPath)
	if err != nil {
		return false
	}
	defer f.Close()
	buf := make([]byte, 16)
	n, _ := io.ReadFull(f, buf)
	return IsSQLiteFile(buf[:n])
}

// ----------------------------- query parsing helper -------------

// Helper used by handleHistory only; declared here to avoid pulling in strconv elsewhere.
func parseLimit(q string, def, max int) int {
	if q == "" {
		return def
	}
	n, err := strconv.Atoi(q)
	if err != nil || n <= 0 {
		return def
	}
	if n > max {
		return max
	}
	return n
}

// ----------------------------- static ----------------------------

func staticHandler() http.Handler {
	sub, err := fs.Sub(webAssets, "web/dist")
	if err != nil || !hasIndex(sub) {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "Web UI not built. Run `cd web && npm install && npm run build`, then rebuild the binary.", http.StatusServiceUnavailable)
		})
	}
	return http.FileServer(http.FS(spaFS{sub}))
}

type spaFS struct{ inner fs.FS }

func (s spaFS) Open(name string) (fs.File, error) {
	f, err := s.inner.Open(name)
	if err == nil {
		return f, nil
	}
	if errors.Is(err, fs.ErrNotExist) {
		return s.inner.Open("index.html")
	}
	return nil, err
}

func hasIndex(sub fs.FS) bool {
	if sub == nil {
		return false
	}
	_, err := fs.Stat(sub, "index.html")
	return err == nil
}
