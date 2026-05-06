package main

import (
	"bytes"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"os"
	"sort"
	"strings"

	_ "modernc.org/sqlite"
)

// IsSQLiteFile inspects the magic header. SQLite databases start with the
// fixed 16-byte string "SQLite format 3\x00".
func IsSQLiteFile(data []byte) bool {
	const magic = "SQLite format 3\x00"
	return len(data) >= len(magic) && bytes.HasPrefix(data, []byte(magic))
}

func IsSQLitePath(path string) bool {
	p := strings.ToLower(path)
	return strings.HasSuffix(p, ".sqlite") ||
		strings.HasSuffix(p, ".sqlite3") ||
		strings.HasSuffix(p, ".db")
}

// DumpSQLiteFile opens the SQLite database at path read-only and writes a
// deterministic, human-readable SQL text dump to w. The output mirrors the
// classic `sqlite3 file.db .dump` format closely enough to be usable as a
// textual diff target.
func DumpSQLiteFile(path string, w io.Writer) error {
	dsn := fmt.Sprintf("file:%s?mode=ro&immutable=1", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return fmt.Errorf("open sqlite: %w", err)
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		return fmt.Errorf("ping sqlite: %w", err)
	}

	fmt.Fprintln(w, "PRAGMA foreign_keys=OFF;")
	fmt.Fprintln(w, "BEGIN TRANSACTION;")

	if err := dumpSchemaAndData(db, w); err != nil {
		return err
	}

	fmt.Fprintln(w, "COMMIT;")
	return nil
}

type schemaItem struct {
	Name    string
	Type    string
	TblName string
	SQL     sql.NullString
}

func dumpSchemaAndData(db *sql.DB, w io.Writer) error {
	rows, err := db.Query(`
		SELECT name, type, tbl_name, sql
		FROM sqlite_master
		WHERE name NOT LIKE 'sqlite_%'
		ORDER BY
			CASE type
				WHEN 'table' THEN 1
				WHEN 'index' THEN 2
				WHEN 'view'  THEN 3
				WHEN 'trigger' THEN 4
				ELSE 5
			END, name`)
	if err != nil {
		return fmt.Errorf("read schema: %w", err)
	}
	defer rows.Close()

	var items []schemaItem
	for rows.Next() {
		var it schemaItem
		if err := rows.Scan(&it.Name, &it.Type, &it.TblName, &it.SQL); err != nil {
			return err
		}
		items = append(items, it)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, it := range items {
		if !it.SQL.Valid {
			continue
		}
		fmt.Fprintf(w, "%s;\n", strings.TrimSpace(it.SQL.String))
	}

	for _, it := range items {
		if it.Type != "table" {
			continue
		}
		if err := dumpTableRows(db, it.Name, w); err != nil {
			return fmt.Errorf("dump table %s: %w", it.Name, err)
		}
	}
	return nil
}

func dumpTableRows(db *sql.DB, table string, w io.Writer) error {
	cols, err := tableColumns(db, table)
	if err != nil {
		return err
	}
	if len(cols) == 0 {
		return nil
	}

	colList := make([]string, len(cols))
	for i, c := range cols {
		colList[i] = quoteIdent(c)
	}

	orderBy := strings.Join(colList, ", ")
	q := fmt.Sprintf(
		"SELECT %s FROM %s ORDER BY %s",
		strings.Join(colList, ", "),
		quoteIdent(table),
		orderBy,
	)

	rows, err := db.Query(q)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		raw := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range raw {
			ptrs[i] = &raw[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return err
		}

		vals := make([]string, len(raw))
		for i, v := range raw {
			vals[i] = formatSQLValue(v)
		}
		fmt.Fprintf(w, "INSERT INTO %s VALUES(%s);\n",
			quoteIdent(table), strings.Join(vals, ","))
	}
	return rows.Err()
}

func tableColumns(db *sql.DB, table string) ([]string, error) {
	rows, err := db.Query(fmt.Sprintf("PRAGMA table_info(%s)", quoteIdent(table)))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type colInfo struct {
		cid  int
		name string
	}
	var cs []colInfo
	for rows.Next() {
		var (
			cid              int
			name, ctype      string
			notnull, pk      int
			dflt             sql.NullString
		)
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return nil, err
		}
		cs = append(cs, colInfo{cid, name})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.Slice(cs, func(i, j int) bool { return cs[i].cid < cs[j].cid })
	out := make([]string, len(cs))
	for i, c := range cs {
		out[i] = c.name
	}
	return out, nil
}

func quoteIdent(name string) string {
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}

func formatSQLValue(v any) string {
	switch x := v.(type) {
	case nil:
		return "NULL"
	case int64:
		return fmt.Sprintf("%d", x)
	case float64:
		return fmt.Sprintf("%g", x)
	case bool:
		if x {
			return "1"
		}
		return "0"
	case []byte:
		if isProbablyText(x) {
			return sqlQuote(string(x))
		}
		return "X'" + hexEncode(x) + "'"
	case string:
		return sqlQuote(x)
	default:
		return sqlQuote(fmt.Sprintf("%v", x))
	}
}

func sqlQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

func isProbablyText(b []byte) bool {
	for _, c := range b {
		if c == 0 || (c < 0x09) || (c > 0x7E && c < 0xA0) {
			return false
		}
	}
	return true
}

const hexChars = "0123456789ABCDEF"

func hexEncode(b []byte) string {
	out := make([]byte, len(b)*2)
	for i, c := range b {
		out[i*2] = hexChars[c>>4]
		out[i*2+1] = hexChars[c&0x0F]
	}
	return string(out)
}

// cmdSQLDump implements `my-git-tool sqldump <file>`. Useful as a standalone
// textconv driver, e.g. via `git config diff.sqlite.textconv "my-git-tool sqldump"`.
func cmdSQLDump(args []string) error {
	if len(args) != 1 {
		return errors.New("sqldump: expected exactly one path")
	}
	path := args[0]
	if _, err := os.Stat(path); err != nil {
		return err
	}
	return DumpSQLiteFile(path, os.Stdout)
}
