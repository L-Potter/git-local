package main

import (
	"bufio"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// SECRET_KEY is the shared pepper used by both the Go binary and the Python
// generator script. They MUST match byte-for-byte. Treat it as a build-time
// secret: changing it invalidates every previously generated INI file.
//
// To rotate: regenerate every credentials INI through gen_credentials.py
// after updating both this constant and the SECRET_KEY in the Python script.
const SECRET_KEY = "go-git-tool-shared-secret-2026-do-not-leak-this-32B"

// algoName is the wire identifier embedded in the INI file. Bump the version
// suffix if you ever change how ComputeHash mixes salt/username/password.
const algoName = "hmac-sha256-v1"

// Credentials is the in-memory view of an auth INI file.
type Credentials struct {
	Username  string
	Salt      string // hex
	Hash      string // hex
	Algorithm string
}

// ComputeHash returns hex(HMAC-SHA256(SECRET_KEY, salt || 0x00 || username || 0x00 || password)).
// The 0x00 separators prevent length-extension ambiguity between fields
// (e.g. user="ab", pwd="c" vs user="a", pwd="bc").
func ComputeHash(salt, username, password string) string {
	mac := hmac.New(sha256.New, []byte(SECRET_KEY))
	mac.Write([]byte(salt))
	mac.Write([]byte{0})
	mac.Write([]byte(username))
	mac.Write([]byte{0})
	mac.Write([]byte(password))
	return hex.EncodeToString(mac.Sum(nil))
}

// LoadCredentials parses a minimal INI file with a single [auth] section.
// Recognised keys: username, salt, password_hash, algorithm.
func LoadCredentials(path string) (*Credentials, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	c := &Credentials{}
	section := ""
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, ";") {
			continue
		}
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			section = strings.TrimSpace(line[1 : len(line)-1])
			continue
		}
		if section != "auth" {
			continue
		}
		eq := strings.IndexByte(line, '=')
		if eq < 0 {
			continue
		}
		k := strings.TrimSpace(line[:eq])
		v := strings.TrimSpace(line[eq+1:])
		switch k {
		case "username":
			c.Username = v
		case "salt":
			c.Salt = v
		case "password_hash":
			c.Hash = v
		case "algorithm":
			c.Algorithm = v
		}
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	if c.Username == "" || c.Salt == "" || c.Hash == "" {
		return nil, errors.New("invalid credentials file: missing username / salt / password_hash")
	}
	if c.Algorithm != "" && c.Algorithm != algoName {
		return nil, fmt.Errorf("unsupported algorithm %q (this build expects %q)", c.Algorithm, algoName)
	}
	if _, err := hex.DecodeString(c.Salt); err != nil {
		return nil, fmt.Errorf("salt must be hex: %w", err)
	}
	if _, err := hex.DecodeString(c.Hash); err != nil {
		return nil, fmt.Errorf("password_hash must be hex: %w", err)
	}
	return c, nil
}

// Verify checks the supplied plaintext against the loaded credentials.
// Constant-time comparison via hmac.Equal.
func (c *Credentials) Verify(username, password string) bool {
	if username != c.Username {
		return false
	}
	want, err := hex.DecodeString(c.Hash)
	if err != nil {
		return false
	}
	got, err := hex.DecodeString(ComputeHash(c.Salt, username, password))
	if err != nil {
		return false
	}
	return hmac.Equal(want, got)
}

// LoadCredentialsDir reads every *.ini in dir (non-recursive). Each file must
// contain one [auth] block (same format as gen_credentials.py). Usernames
// must be unique across files.
func LoadCredentialsDir(dir string) (map[string]*Credentials, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	out := make(map[string]*Credentials)
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !strings.HasSuffix(strings.ToLower(name), ".ini") {
			continue
		}
		path := filepath.Join(dir, name)
		c, err := LoadCredentials(path)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", path, err)
		}
		if _, dup := out[c.Username]; dup {
			return nil, fmt.Errorf("duplicate username %q (two INI files declare the same username)", c.Username)
		}
		out[c.Username] = c
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("no *.ini files with valid [auth] in %s", dir)
	}
	return out, nil
}

// ---- HTTP session (signed cookie, same SECRET_KEY family) ----

const sessionCookieName = "mgt_sess"

func sessionHMACKey() []byte {
	// Distinct from password HMAC: never reuse the raw SECRET_KEY as an HMAC
	// key for two different purposes without domain separation.
	return []byte(SECRET_KEY + "::http-session::v1")
}

// SignSession returns an opaque cookie value: b64url(user)|expUnix|hexSig.
func SignSession(username string, ttl time.Duration) (string, error) {
	exp := time.Now().Add(ttl).Unix()
	uenc := base64.RawURLEncoding.EncodeToString([]byte(username))
	payload := uenc + "|" + strconv.FormatInt(exp, 10)
	mac := hmac.New(sha256.New, sessionHMACKey())
	mac.Write([]byte(payload))
	sig := hex.EncodeToString(mac.Sum(nil))
	return payload + "|" + sig, nil
}

// ParseSession verifies the cookie value and returns the username if still valid.
func ParseSession(token string) (username string, ok bool) {
	i := strings.LastIndex(token, "|")
	if i < 0 {
		return "", false
	}
	payload := token[:i]
	sigHex := token[i+1:]
	sigWant, err := hex.DecodeString(sigHex)
	if err != nil {
		return "", false
	}
	mac := hmac.New(sha256.New, sessionHMACKey())
	mac.Write([]byte(payload))
	if !hmac.Equal(sigWant, mac.Sum(nil)) {
		return "", false
	}
	j := strings.IndexByte(payload, '|')
	if j < 0 {
		return "", false
	}
	uenc := payload[:j]
	expStr := payload[j+1:]
	exp, err := strconv.ParseInt(expStr, 10, 64)
	if err != nil {
		return "", false
	}
	if time.Now().Unix() > exp {
		return "", false
	}
	ub, err := base64.RawURLEncoding.DecodeString(uenc)
	if err != nil {
		return "", false
	}
	return string(ub), true
}

func cmdVerifyCred(args []string) error {
	fs := flag.NewFlagSet("verify-cred", flag.ExitOnError)
	file := fs.String("file", "auth.ini", "path to credentials INI")
	username := fs.String("username", "", "username to test")
	password := fs.String("password", "", "password to test")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *username == "" || *password == "" {
		return errors.New("usage: my-git-tool verify-cred -file auth.ini -username U -password P")
	}
	creds, err := LoadCredentials(*file)
	if err != nil {
		return err
	}
	if !creds.Verify(*username, *password) {
		return errors.New("FAIL: credentials do NOT match")
	}
	fmt.Println("OK: credentials match")
	return nil
}
