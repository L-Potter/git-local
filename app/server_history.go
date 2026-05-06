package main

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
)

func (s *server) handleHistory(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, errors.New("GET only"))
		return
	}
	limit := parseLimit(r.URL.Query().Get("limit"), 200, 5000)

	s.mu.Lock()
	defer s.mu.Unlock()

	repo, err := s.repo()
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	commits, err := repo.Log(limit)
	if err != nil {
		writeErr(w, 500, err)
		return
	}

	out := make([]commitInfoDTO, 0, len(commits))
	for _, c := range commits {
		out = append(out, toCommitInfoDTO(c))
	}
	writeJSON(w, 200, out)
}

func (s *server) handleCommitDetail(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, errors.New("GET only"))
		return
	}
	hash := r.URL.Query().Get("hash")
	if hash == "" {
		writeErr(w, 400, errors.New("missing ?hash"))
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	repo, err := s.repo()
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	d, err := repo.CommitDetail(hash)
	if err != nil {
		writeErr(w, 404, fmt.Errorf("commit %s: %w", hash, err))
		return
	}

	dto := commitDetailDTO{commitInfoDTO: toCommitInfoDTO(d.CommitInfo)}
	for _, f := range d.Files {
		dto.Files = append(dto.Files, changedFileDTO{
			ChangedFile: f,
			IsSQL:       IsSQLitePath(f.Path),
		})
	}
	writeJSON(w, 200, dto)
}

type restoreReq struct {
	Path string `json:"path"`
	Ref  string `json:"ref"`
}

func (s *server) handleRestoreFromRef(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, errors.New("POST only"))
		return
	}
	var req restoreReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, 400, err)
		return
	}
	req.Ref = strings.TrimSpace(req.Ref)
	req.Path = strings.TrimSpace(req.Path)
	if req.Path == "" {
		writeErr(w, 400, errors.New("path is required"))
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	repo, err := s.repo()
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	hash, n, err := repo.RestoreFromRef(req.Path, req.Ref)
	if err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, 200, map[string]any{
		"ok":    true,
		"path":  req.Path,
		"ref":   hash,
		"short": hash[:7],
		"bytes": n,
	})
}

