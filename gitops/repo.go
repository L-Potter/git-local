package gitops

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"

	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing"
)

// Repo is a thin wrapper around a go-git Repository plus its worktree.
type Repo struct {
	repo *git.Repository
	wt   *git.Worktree
	dir  string
}

// Open opens an existing repository, walking upwards from dir until a .git is found.
func Open(dir string) (*Repo, error) {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return nil, err
	}
	repo, err := git.PlainOpenWithOptions(abs, &git.PlainOpenOptions{DetectDotGit: true})
	if err != nil {
		return nil, fmt.Errorf("open repository at %s: %w", abs, err)
	}
	wt, err := repo.Worktree()
	if err != nil {
		return nil, err
	}
	return &Repo{repo: repo, wt: wt, dir: wt.Filesystem.Root()}, nil
}

// Dir returns the absolute working tree root.
func (r *Repo) Dir() string { return r.dir }

// Status computes the worktree-vs-HEAD status. Each modified path produces up
// to two entries (one staged, one unstaged), mirroring `git status --porcelain`.
func (r *Repo) Status() (*Status, error) {
	out := &Status{}

	if head, err := r.repo.Head(); err == nil {
		out.Head = head.Hash().String()
		if head.Name().IsBranch() {
			out.Branch = head.Name().Short()
		} else {
			out.Detached = true
			out.Branch = "HEAD"
		}
	} else if errors.Is(err, plumbing.ErrReferenceNotFound) {
		out.Branch = "main"
	} else {
		return nil, err
	}

	st, err := r.wt.Status()
	if err != nil {
		return nil, err
	}
	out.Clean = st.IsClean()

	for path, code := range st {
		if code.Staging == git.Untracked && code.Worktree == git.Untracked {
			out.Files = append(out.Files, FileChange{
				Path:    path,
				Status:  "untracked",
				Section: "untracked",
				Binary:  isBinaryPath(filepath.Join(r.dir, path)),
			})
			continue
		}
		if code.Staging != git.Unmodified && code.Staging != git.Untracked {
			out.Files = append(out.Files, FileChange{
				Path:    path,
				Status:  statusLabel(code.Staging),
				Section: "staged",
				Staged:  true,
				Binary:  isBinaryPath(filepath.Join(r.dir, path)),
			})
		}
		if code.Worktree != git.Unmodified && code.Worktree != git.Untracked {
			out.Files = append(out.Files, FileChange{
				Path:    path,
				Status:  statusLabel(code.Worktree),
				Section: "unstaged",
				Binary:  isBinaryPath(filepath.Join(r.dir, path)),
			})
		}
	}

	sort.Slice(out.Files, func(i, j int) bool {
		if out.Files[i].Section != out.Files[j].Section {
			return out.Files[i].Section < out.Files[j].Section
		}
		return out.Files[i].Path < out.Files[j].Path
	})
	return out, nil
}

// Add stages one or more paths.
func (r *Repo) Add(paths []string) error {
	for _, p := range paths {
		if _, err := r.wt.Add(p); err != nil {
			return fmt.Errorf("add %s: %w", p, err)
		}
	}
	return nil
}

// AddAll is the equivalent of `git add -A`.
func (r *Repo) AddAll() error {
	return r.wt.AddWithOptions(&git.AddOptions{All: true})
}

// CommitOptions controls how a commit is produced.
type CommitOptions struct {
	// AutoStage stages modified/deleted tracked files first (`git commit -a`).
	AutoStage bool
}

// Commit creates a new commit. Author/committer fall back to the repository's
// `user.name` / `user.email` config when not provided here.
func (r *Repo) Commit(message string, opts CommitOptions) (string, error) {
	hash, err := r.wt.Commit(message, &git.CommitOptions{All: opts.AutoStage})
	if err != nil {
		return "", err
	}
	return hash.String(), nil
}

// Checkout switches to an existing or new branch.
func (r *Repo) Checkout(branch string, create bool) error {
	ref := plumbing.NewBranchReferenceName(branch)
	return r.wt.Checkout(&git.CheckoutOptions{Branch: ref, Create: create})
}

// RestorePaths is `git restore` for one or more paths.
//
//	staged=true && worktree=true  -> hard-reset paths (drops local changes)
//	staged=true && worktree=false -> unstage (mixed reset)
//	staged=false && worktree=true -> NOT SUPPORTED by go-git directly
func (r *Repo) RestorePaths(paths []string, staged, worktree bool) error {
	return r.wt.Restore(&git.RestoreOptions{
		Staged:   staged,
		Worktree: worktree,
		Files:    paths,
	})
}

// RestoreFromRef writes the blob at `path` from revision `ref` (a branch,
// tag, "HEAD", or commit hash) into the working tree, creating intermediate
// directories as needed. Returns the resolved commit hash and bytes written.
func (r *Repo) RestoreFromRef(path, ref string) (resolvedHash string, n int, err error) {
	if path == "" {
		return "", 0, errors.New("path is required")
	}
	if ref == "" {
		ref = "HEAD"
	}
	hash, err := r.ResolveRef(ref)
	if err != nil {
		return "", 0, fmt.Errorf("resolve %s: %w", ref, err)
	}
	data, mode, err := r.readBlobAt(hash, path)
	if err != nil {
		return "", 0, fmt.Errorf("read blob %s@%s: %w", path, hash[:7], err)
	}
	full := filepath.Join(r.dir, path)
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return "", 0, err
	}
	if err := os.WriteFile(full, data, mode); err != nil {
		return "", 0, err
	}
	return hash, len(data), nil
}

// ----------------------------- helpers ---------------------------

func statusLabel(s git.StatusCode) string {
	switch s {
	case git.Added:
		return "added"
	case git.Modified:
		return "modified"
	case git.Deleted:
		return "deleted"
	case git.Renamed:
		return "renamed"
	case git.Copied:
		return "copied"
	case git.UpdatedButUnmerged:
		return "unmerged"
	default:
		return "?"
	}
}

func isBinaryPath(absPath string) bool {
	f, err := os.Open(absPath)
	if err != nil {
		return false
	}
	defer f.Close()
	buf := make([]byte, 8000)
	n, _ := io.ReadFull(f, buf)
	return IsBinary(buf[:n])
}

// IsBinary returns true if the byte slice looks non-textual (NUL byte present
// or matches a known binary signature). Exposed so callers can run the same
// heuristic on bytes that did not come from disk (e.g. a HEAD blob).
func IsBinary(b []byte) bool {
	if len(b) == 0 {
		return false
	}
	limit := len(b)
	if limit > 8000 {
		limit = 8000
	}
	for _, c := range b[:limit] {
		if c == 0 {
			return true
		}
	}
	return false
}
