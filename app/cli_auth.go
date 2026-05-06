package main

import (
	"bufio"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/term"
)

// CLI session: same signed token format as the web cookie (SignSession / ParseSession),
// stored as a single line in the user config directory.

func cliSessionDir() (string, error) {
	cfg, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(cfg, "my-git-tool"), nil
}

func cliSessionPath() (string, error) {
	dir, err := cliSessionDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "cli-session"), nil
}

// readCLISession returns the raw token line, or ("", err) if missing/invalid file.
func readCLISession() (string, error) {
	path, err := cliSessionPath()
	if err != nil {
		return "", err
	}
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return "", errNotLoggedIn
		}
		return "", err
	}
	t := strings.TrimSpace(string(b))
	if t == "" {
		return "", errNotLoggedIn
	}
	return t, nil
}

var errNotLoggedIn = errors.New("not logged in: run `my-git-tool login -auth-dir <DIR>` (same folder as `serve -auth-dir`)")

func writeCLISession(token string) error {
	dir, err := cliSessionDir()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	path := filepath.Join(dir, "cli-session")
	return os.WriteFile(path, []byte(strings.TrimSpace(token)+"\n"), 0o600)
}

func clearCLISession() error {
	path, err := cliSessionPath()
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// requireCLIAuth returns an error if there is no valid CLI session (caller prints and exits).
func requireCLIAuth() error {
	raw, err := readCLISession()
	if err != nil {
		if errors.Is(err, errNotLoggedIn) {
			return errNotLoggedIn
		}
		return fmt.Errorf("read CLI session: %w", err)
	}
	if _, ok := ParseSession(raw); !ok {
		return errors.New("CLI session expired or invalid: run `my-git-tool login` again")
	}
	return nil
}

func cmdLogin(args []string) error {
	fs := flag.NewFlagSet("login", flag.ExitOnError)
	authDir := fs.String("auth-dir", "", "directory of *.ini credentials (required, same as serve -auth-dir)")
	username := fs.String("username", "", "account name (omit to prompt)")
	password := fs.String("password", "", "password (omit to prompt; avoid on shared machines)")
	sessionHours := fs.Int("session-hours", 72, "signed session lifetime in hours")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if strings.TrimSpace(*authDir) == "" {
		return errors.New("login: -auth-dir is required (folder of *.ini from gen_credentials.py)")
	}
	ad, err := filepath.Abs(*authDir)
	if err != nil {
		return err
	}
	users, err := LoadCredentialsDir(ad)
	if err != nil {
		return err
	}

	user := strings.TrimSpace(*username)
	if user == "" {
		fmt.Fprint(os.Stderr, "Username: ")
		line, err := bufio.NewReader(os.Stdin).ReadString('\n')
		if err != nil {
			return err
		}
		user = strings.TrimSpace(line)
	}
	if user == "" {
		return errors.New("empty username")
	}

	pass := *password
	if pass == "" {
		var err error
		if term.IsTerminal(int(os.Stdin.Fd())) {
			fmt.Fprint(os.Stderr, "Password: ")
			var b []byte
			b, err = term.ReadPassword(int(os.Stdin.Fd()))
			fmt.Fprintln(os.Stderr)
			if err != nil {
				return err
			}
			pass = string(b)
		} else {
			fmt.Fprint(os.Stderr, "Password (stdin): ")
			line, err2 := bufio.NewReader(os.Stdin).ReadString('\n')
			if err2 != nil {
				return err2
			}
			pass = strings.TrimSuffix(line, "\n")
			pass = strings.TrimSuffix(pass, "\r")
		}
	}
	if pass == "" {
		return errors.New("empty password")
	}

	creds, ok := users[user]
	if !ok || !creds.Verify(user, pass) {
		return errors.New("invalid username or password")
	}

	ttl := time.Duration(*sessionHours) * time.Hour
	token, err := SignSession(user, ttl)
	if err != nil {
		return err
	}
	if err := writeCLISession(token); err != nil {
		return err
	}
	path, _ := cliSessionPath()
	fmt.Printf("Logged in as %s (CLI session %v, file %s)\n", user, ttl, path)
	return nil
}

func cmdLogout(_ []string) error {
	if err := clearCLISession(); err != nil {
		return err
	}
	fmt.Println("Logged out.")
	return nil
}
