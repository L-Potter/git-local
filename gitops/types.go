// Package gitops wraps github.com/go-git/go-git/v5 into a small,
// stable surface area used by my-git-tool. Vendoring this module
// captures all of go-git for offline builds.
package gitops

import "time"

// FileChange describes one row in a `status` listing.
type FileChange struct {
	Path    string `json:"path"`
	Status  string `json:"status"`  // added | modified | deleted | renamed | untracked | unmerged
	Section string `json:"section"` // staged | unstaged | untracked
	Staged  bool   `json:"staged"`
	Binary  bool   `json:"binary"`
}

// Status describes the working tree relative to HEAD.
type Status struct {
	Branch   string       `json:"branch"`
	Detached bool         `json:"detached"`
	Head     string       `json:"head"`
	Clean    bool         `json:"clean"`
	Files    []FileChange `json:"files"`
}

// CommitInfo summarises one commit (suitable for log views).
type CommitInfo struct {
	Hash        string    `json:"hash"`
	Short       string    `json:"short"`
	Subject     string    `json:"subject"`
	Body        string    `json:"body"`
	AuthorName  string    `json:"authorName"`
	AuthorEmail string    `json:"authorEmail"`
	Time        time.Time `json:"time"`
	HasParent   bool      `json:"hasParent"`
	ParentHash  string    `json:"parentHash,omitempty"`
}

// ChangedFile describes a path changed by a commit (relative to its parent).
type ChangedFile struct {
	Path    string `json:"path"`
	OldPath string `json:"oldPath,omitempty"`
	Status  string `json:"status"` // added | modified | deleted | renamed
}

// CommitDetail is CommitInfo plus the file list.
type CommitDetail struct {
	CommitInfo
	Files []ChangedFile `json:"files"`
}
