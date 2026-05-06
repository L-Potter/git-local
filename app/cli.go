package main

import (
	"errors"
	"flag"
	"fmt"
	"sort"

	"local.dev/gitops"
)

func openCLI() (*gitops.Repo, error) {
	return gitops.Open(".")
}

func cmdAdd(args []string) error {
	if len(args) == 0 {
		return errors.New("add: missing path (use -A to stage all)")
	}
	repo, err := openCLI()
	if err != nil {
		return err
	}

	if args[0] == "-A" || args[0] == "--all" || args[0] == "." {
		if err := repo.AddAll(); err != nil {
			return err
		}
		fmt.Println("Staged all changes.")
		return nil
	}
	if err := repo.Add(args); err != nil {
		return err
	}
	for _, p := range args {
		fmt.Println("Staged:", p)
	}
	return nil
}

func cmdCommit(args []string) error {
	fs := flag.NewFlagSet("commit", flag.ContinueOnError)
	msg := fs.String("m", "", "commit message")
	all := fs.Bool("a", false, "automatically stage modified/deleted tracked files")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *msg == "" {
		return errors.New("commit: -m <message> is required")
	}

	repo, err := openCLI()
	if err != nil {
		return err
	}
	hash, err := repo.Commit(*msg, gitops.CommitOptions{AutoStage: *all})
	if err != nil {
		return err
	}
	fmt.Printf("[commit %s] %s\n", hash[:7], *msg)
	return nil
}

func cmdStatus(_ []string) error {
	repo, err := openCLI()
	if err != nil {
		return err
	}
	st, err := repo.Status()
	if err != nil {
		return err
	}

	if st.Detached {
		fmt.Printf("HEAD detached at %s\n", st.Head[:7])
	} else {
		fmt.Printf("On branch %s\n", st.Branch)
	}
	if st.Clean {
		fmt.Println("nothing to commit, working tree clean")
		return nil
	}

	var staged, unstaged, untracked []string
	for _, f := range st.Files {
		switch f.Section {
		case "staged":
			staged = append(staged, fmt.Sprintf("  %-9s %s", f.Status+":", f.Path))
		case "unstaged":
			unstaged = append(unstaged, fmt.Sprintf("  %-9s %s", f.Status+":", f.Path))
		case "untracked":
			untracked = append(untracked, f.Path)
		}
	}
	printSection("Changes to be committed:", staged)
	printSection("Changes not staged for commit:", unstaged)
	if len(untracked) > 0 {
		fmt.Println("Untracked files:")
		sort.Strings(untracked)
		for _, p := range untracked {
			fmt.Println("  " + p)
		}
	}
	return nil
}

func printSection(title string, lines []string) {
	if len(lines) == 0 {
		return
	}
	fmt.Println(title)
	sort.Strings(lines)
	for _, l := range lines {
		fmt.Println(l)
	}
}

func cmdCheckout(args []string) error {
	if len(args) == 0 {
		return errors.New("checkout: missing branch or path")
	}
	repo, err := openCLI()
	if err != nil {
		return err
	}

	switch args[0] {
	case "-b":
		if len(args) < 2 {
			return errors.New("checkout -b: missing branch name")
		}
		name := args[1]
		if err := repo.Checkout(name, true); err != nil {
			return err
		}
		fmt.Printf("Switched to a new branch '%s'\n", name)
		return nil

	case "--":
		paths := args[1:]
		if len(paths) == 0 {
			return errors.New("checkout --: missing paths")
		}
		if err := repo.RestorePaths(paths, true, true); err != nil {
			return fmt.Errorf("restore: %w", err)
		}
		for _, p := range paths {
			fmt.Println("Restored:", p)
		}
		return nil
	}

	name := args[0]
	if err := repo.Checkout(name, false); err != nil {
		return fmt.Errorf("checkout %s: %w", name, err)
	}
	fmt.Printf("Switched to branch '%s'\n", name)
	return nil
}
