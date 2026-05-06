package gitops

import (
	"errors"
	"io"
	"os"
	"strings"

	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/object"
	"github.com/go-git/go-git/v5/utils/merkletrie"
)

// Log returns up to `limit` commits walking back from HEAD. limit<=0 means no cap.
func (r *Repo) Log(limit int) ([]CommitInfo, error) {
	head, err := r.repo.Head()
	if err != nil {
		if errors.Is(err, plumbing.ErrReferenceNotFound) {
			return []CommitInfo{}, nil
		}
		return nil, err
	}

	iter, err := r.repo.Log(&git.LogOptions{From: head.Hash()})
	if err != nil {
		return nil, err
	}
	defer iter.Close()

	var out []CommitInfo
	count := 0
	err = iter.ForEach(func(c *object.Commit) error {
		if limit > 0 && count >= limit {
			return errStopIter
		}
		out = append(out, makeCommitInfo(c))
		count++
		return nil
	})
	if err != nil && !errors.Is(err, errStopIter) {
		return nil, err
	}
	return out, nil
}

var errStopIter = errors.New("gitops: stop")

// CommitDetail returns the commit summary plus the list of changed paths.
// For root commits the entire tree is reported as `added`.
func (r *Repo) CommitDetail(hash string) (*CommitDetail, error) {
	commit, err := r.repo.CommitObject(plumbing.NewHash(hash))
	if err != nil {
		return nil, err
	}
	out := &CommitDetail{CommitInfo: makeCommitInfo(commit)}

	commitTree, err := commit.Tree()
	if err != nil {
		return nil, err
	}

	if commit.NumParents() == 0 {
		err = commitTree.Files().ForEach(func(f *object.File) error {
			out.Files = append(out.Files, ChangedFile{
				Path:   f.Name,
				Status: "added",
			})
			return nil
		})
		if err != nil {
			return nil, err
		}
		return out, nil
	}

	parent, err := commit.Parent(0)
	if err != nil {
		return nil, err
	}
	parentTree, err := parent.Tree()
	if err != nil {
		return nil, err
	}
	changes, err := parentTree.Diff(commitTree)
	if err != nil {
		return nil, err
	}
	for _, ch := range changes {
		cf, err := changeToFile(ch)
		if err != nil {
			return nil, err
		}
		out.Files = append(out.Files, cf)
	}
	return out, nil
}

// ResolveRef resolves a revision string ("HEAD", "abc123", "abc123^", branch
// name, …) to a full commit hash.
func (r *Repo) ResolveRef(ref string) (string, error) {
	if ref == "" || strings.EqualFold(ref, "HEAD") {
		head, err := r.repo.Head()
		if err != nil {
			return "", err
		}
		return head.Hash().String(), nil
	}
	h, err := r.repo.ResolveRevision(plumbing.Revision(ref))
	if err != nil {
		return "", err
	}
	return h.String(), nil
}

// ParentOf returns the first-parent commit hash of `rev`, or "" when rev is a
// root commit. Errors are returned for unresolvable revisions.
func (r *Repo) ParentOf(rev string) (string, error) {
	hash, err := r.ResolveRef(rev)
	if err != nil {
		return "", err
	}
	c, err := r.repo.CommitObject(plumbing.NewHash(hash))
	if err != nil {
		return "", err
	}
	if c.NumParents() == 0 {
		return "", nil
	}
	p, err := c.Parent(0)
	if err != nil {
		return "", err
	}
	return p.Hash.String(), nil
}

// ReadBlob returns the blob bytes for `path` at revision `rev`. When rev is
// the empty string the result is (nil, nil) — meaning "no content on this side".
// (object.ErrFileNotFound and friends are returned untouched so callers can
//  distinguish "added/removed" cases.)
func (r *Repo) ReadBlob(rev, path string) ([]byte, error) {
	if rev == "" {
		return nil, nil
	}
	hash, err := r.ResolveRef(rev)
	if err != nil {
		return nil, err
	}
	data, _, err := r.readBlobAt(hash, path)
	return data, err
}

// IsMissingBlob reports whether err is one of the "file/object not found"
// errors that ReadBlob may return. Useful for treating "file did not exist
// at this revision" as a non-fatal case in diff handlers.
func IsMissingBlob(err error) bool {
	return errors.Is(err, object.ErrFileNotFound) ||
		errors.Is(err, plumbing.ErrReferenceNotFound) ||
		errors.Is(err, plumbing.ErrObjectNotFound)
}

// ----------------------------- internals -------------------------

func (r *Repo) readBlobAt(hash, path string) ([]byte, os.FileMode, error) {
	commit, err := r.repo.CommitObject(plumbing.NewHash(hash))
	if err != nil {
		return nil, 0, err
	}
	tree, err := commit.Tree()
	if err != nil {
		return nil, 0, err
	}
	f, err := tree.File(path)
	if err != nil {
		return nil, 0, err
	}
	rc, err := f.Blob.Reader()
	if err != nil {
		return nil, 0, err
	}
	defer rc.Close()
	data, err := io.ReadAll(rc)
	if err != nil {
		return nil, 0, err
	}
	mode := os.FileMode(0o644)
	if perm, perr := f.Mode.ToOSFileMode(); perr == nil && perm.Perm() != 0 {
		mode = perm.Perm()
	}
	return data, mode, nil
}

func makeCommitInfo(c *object.Commit) CommitInfo {
	subject, body := splitMessage(c.Message)
	parent := ""
	if c.NumParents() > 0 {
		if p, err := c.Parent(0); err == nil {
			parent = p.Hash.String()
		}
	}
	return CommitInfo{
		Hash:        c.Hash.String(),
		Short:       c.Hash.String()[:7],
		Subject:     subject,
		Body:        body,
		AuthorName:  c.Author.Name,
		AuthorEmail: c.Author.Email,
		Time:        c.Author.When,
		HasParent:   parent != "",
		ParentHash:  parent,
	}
}

func splitMessage(msg string) (subject, body string) {
	msg = strings.TrimRight(msg, "\n")
	if i := strings.Index(msg, "\n"); i >= 0 {
		return msg[:i], strings.TrimSpace(msg[i+1:])
	}
	return msg, ""
}

func changeToFile(ch *object.Change) (ChangedFile, error) {
	action, err := ch.Action()
	if err != nil {
		return ChangedFile{}, err
	}
	cf := ChangedFile{}
	switch action {
	case merkletrie.Insert:
		cf.Path = ch.To.Name
		cf.Status = "added"
	case merkletrie.Delete:
		cf.Path = ch.From.Name
		cf.Status = "deleted"
	case merkletrie.Modify:
		cf.Path = ch.To.Name
		cf.Status = "modified"
		if ch.From.Name != ch.To.Name {
			cf.OldPath = ch.From.Name
			cf.Status = "renamed"
		}
	}
	return cf, nil
}

