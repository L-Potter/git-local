# my-git-tool

純 Go 實作的迷你 git 工具，外掛 React 前端做出 GitHub Desktop 風格的 GUI，並且能把 SQLite `.sqlite` 檔當成 SQL 文字 diff（不需要安裝系統的 `sqlite3`）。

## 功能一覽

- **CLI**：`add` / `commit` / `status` / `checkout`，行為跟 git 對齊
- **Web GUI**：左側 Changes 面板（勾選暫存 + 寫 commit message + Commit 到 main）、History 三欄（commits / files / diff）、右鍵選單（Checkout file from HEAD、Checkout file to *commit*）
- **SQLite SQL Dump Diff**：偵測 `.sqlite` / `.sqlite3` / `.db` 或 magic header `SQLite format 3\x00`，自動把 HEAD blob 與工作目錄各自 dump 成 SQL 文字後再做行級 diff，免外部 sqlite3 程式
- **跨平台**：純 Go + Vite/React，可交叉編譯出 Windows / Linux / macOS 二進位

## 架構

```
go-git/
├── go.work                    Go workspace（同時管 gitops + app）
├── go.work.sum
├── .gitignore
├── README.md
├── scripts/
│   └── gen_credentials.py     產帳密 INI（HMAC-SHA256 + SECRET_KEY，與 Go 互通）
├── credentials/               範例登入目錄（*.ini 已 gitignore，只追蹤 .gitkeep）
├── gitops/                    [Module #1] 對 go-git 的薄包裝
│   ├── go.mod                 module local.dev/gitops
│   ├── go.sum
│   ├── vendor/                go-git 全部源碼，14 MB，支援離線編譯
│   ├── types.go               FileChange / Status / CommitInfo / ChangedFile / CommitDetail
│   ├── repo.go                Open / Status / Add / AddAll / Commit / Checkout /
│   │                          RestorePaths / RestoreFromRef
│   └── log.go                 Log / CommitDetail / ResolveRef / ParentOf / ReadBlob /
│                              IsMissingBlob
└── app/                       [Module #2] CLI + HTTP server + SQLite + React
    ├── go.mod                 module local.dev/my-git-tool
    │                          require local.dev/gitops + modernc.org/sqlite
    │                          replace local.dev/gitops => ../gitops
    ├── go.sum
    ├── main.go                CLI 子命令分派器
    ├── cli.go                 add / commit / status / checkout（呼叫 gitops）
    ├── cli_auth.go            CLI login / logout / 本機 session 檔
    ├── server.go              HTTP API（status / stage / unstage / commit / discard / diff）
    ├── server_history.go      HTTP API（history / commit/detail / restore）
    ├── sqldump.go             modernc.org/sqlite → SQL 文字 dumper
    ├── auth.go                HMAC-SHA256 驗證 INI、多帳號目錄、簽名 session cookie
    ├── embed.go               //go:embed all:web/dist
    └── web/                   React + Vite + TypeScript
        ├── package.json
        ├── vite.config.ts
        ├── tsconfig.json
        ├── index.html
        ├── dist/              build 產物（已納入 git）
        └── src/
            ├── main.tsx
            ├── App.tsx
            ├── api.ts
            ├── styles.css
            └── components/
                ├── Header.tsx
                ├── ChangeList.tsx
                ├── CommitForm.tsx
                ├── DiffViewer.tsx
                ├── ContextMenu.tsx
                ├── History.tsx
                └── LoginForm.tsx
```

### 模組職責拆分


| 模組                      | 直接依賴                                      | vendor              | 用途                                                |
| ----------------------- | ----------------------------------------- | ------------------- | ------------------------------------------------- |
| `local.dev/gitops`      | `github.com/go-git/go-git/v5`             | **是**（14 MB，離線就緒）   | 對 go-git 的穩定 API；`my-git-tool` 不再直接 import go-git |
| `local.dev/my-git-tool` | `local.dev/gitops` + `modernc.org/sqlite` | 否（從 module cache 取） | CLI / HTTP server / SQLite SQL dump / React       |


`my-git-tool` 完全透過 `gitops.Repo` 操作，go-git 永遠透過 `gitops` 進來。

### 為什麼用 `local.dev/...` 開頭

Go module path 規定第一個元素必須含 `.`（避免和 stdlib 衝突），所以單純 `gitops` 不行。`local.dev` 只是本機慣例前綴；要發布 GitHub 時改成 `github.com/<your>/gitops` 即可。Package 名稱仍然是 `gitops`：

```go
import "local.dev/gitops"

repo, _ := gitops.Open(".")
```

## 手動編譯

需求環境：

- Go 1.25+（用了 generics、`any`、`min`、`0o755` 等新語法）
- Node 18+ 與 npm（編 React 前端）

### 1. 第一次設定（同時拉 npm 套件）

```bash
cd app/web
npm install
cd ../..
```

### 2. 編前端 → 內嵌進 Go binary

```bash
cd app/web
npm run build           # 產出 app/web/dist/
cd ../..
```

`app/embed.go` 裡的 `//go:embed all:web/dist` 會把 build 產物全部包進二進位裡。

### 3. 編 Go 主程式

```bash
cd app
go build -o my-git-tool .
```

> Workspace 模式下，Go 會自動透過 `../gitops` 找到 `local.dev/gitops`。`app/go.mod` 也帶了 `replace local.dev/gitops => ../gitops`，所以即使沒有 go.work 或在 CI 上也能編。

### 4. 離線編 `gitops`（純 vendor）

```bash
cd gitops
GOWORK=off GOPROXY=off go build -mod=vendor ./...
```

這條指令證實 `gitops/vendor/` 完整，能在斷網環境下編。

### 5. 跨平台編譯

從 `app/` 執行：


| 目標                          | 指令                                                             |
| --------------------------- | -------------------------------------------------------------- |
| Windows 64-bit              | `GOOS=windows GOARCH=amd64 go build -o my-git-tool.exe .`      |
| Linux 64-bit                | `GOOS=linux GOARCH=amd64 go build -o my-git-tool-linux .`      |
| macOS Apple Silicon         | `GOOS=darwin GOARCH=arm64 go build -o my-git-tool-mac-arm64 .` |
| Windows ARM (Surface Pro X) | `GOOS=windows GOARCH=arm64 go build -o my-git-tool-arm.exe .`  |


### 6. 一鍵腳本（可選）

如果不想記指令，下面一段照順序跑就好：

```bash
cd app/web && npm install && npm run build && cd ../..
cd app && go build -o my-git-tool . && cd ..
echo "binary: $(pwd)/app/my-git-tool"
```

## 使用

### CLI

```bash
# 在任意 git repo 內：
./my-git-tool add file.txt          # 暫存
./my-git-tool add -A                # 暫存所有變動
./my-git-tool commit -m "message"   # 提交
./my-git-tool status                # 看狀態
./my-git-tool checkout main         # 切分支
./my-git-tool checkout -b feature   # 開新分支
./my-git-tool checkout -- file.txt  # 還原檔案

# 工具：
./my-git-tool sqldump db.sqlite     # 把 SQLite 印成可讀 SQL（給 git diff 的 textconv 用也可）
```

### Web GUI

```bash
./my-git-tool serve -addr :7891 -repo /path/to/your/repo
# 瀏覽器開 http://localhost:7891
```

#### Web 登入（可選，支援多帳號）

啟動時加上 `-auth-dir` 指向**資料夾**（內含多個 `*.ini`，每個檔案一個 `[auth]` 使用者，演算法與 `gen_credentials.py` 相同）：

```bash
mkdir -p credentials
python3 scripts/gen_credentials.py -u alice -p 'alice-pw' -o credentials/alice.ini
python3 scripts/gen_credentials.py -u bob   -p 'bob-pw'   -o credentials/bob.ini

./my-git-tool serve -addr :7891 -repo /path/to/repo -auth-dir ./credentials
```

- 瀏覽器會先出現登入頁；`POST /api/login` 驗證成功後下發 **HttpOnly** 簽名 cookie（HMAC-SHA256，與密碼 hash 不同 key domain）
- 預設 session **72 小時**（`-session-hours` 可改）；HTTPS 反向代理後可加 `-secure-cookie`
- 未帶 `-auth-dir` 時行為與以前相同（所有 API 匿名可用）
- 專案根目錄 `credentials/*.ini` 已列入 `.gitignore`，請勿把真實密碼檔 commit 進 git

操作：

- **Changes 分頁**：勾選 untracked/modified 檔案，下方寫 commit message，按綠色「Commit N files to main」
- **檔案右鍵（Changes）**：Checkout file from HEAD（modified/deleted 才可用）、Discard changes
- **History 分頁**：左側 commits（時間用本地格式 `2026-04-29 09:08:00 +08:00`，不是 ago）、中間檔案、右側 commit metadata + diff
- **檔案右鍵（History）**：Checkout file to `<commit-sha>` — 把該 commit 版本還原到工作目錄
- **`.sqlite` 自動 SQL diff**：點到 `.sqlite` 檔會看到「SQLite → SQL diff」標籤，內部跑 `modernc.org/sqlite` dump 兩邊後再 diff

### 把 SQLite SQL diff 接到系統 `git diff`

不用 GUI 也行，把工具設成 git 的 textconv 驅動：

```bash
git config diff.sqlite.textconv "/absolute/path/to/my-git-tool sqldump"
echo "*.sqlite diff=sqlite" >> .gitattributes

# 之後：
git diff data.sqlite     # 直接顯示 SQL 文字 diff
```

## HTTP API 速查


| Method | Path                                         | 用途                                                                           |
| ------ | -------------------------------------------- | ---------------------------------------------------------------------------- |
| GET    | `/api/me`                                    | `{authRequired}`；若需登入且未帶 cookie 則 `username: null`                               |
| POST   | `/api/login` `{username,password}`           | 驗證帳密、設 session cookie（僅 `-auth-dir` 啟用時註冊此路由）                                  |
| POST   | `/api/logout`                                | 清除 session cookie                                                            |
| GET    | `/api/status`                                | 工作目錄狀態 + branch + HEAD（`-auth-dir` 時需已登入，否則 401）                               |
| POST   | `/api/stage` `{paths}`                       | 暫存                                                                           |
| POST   | `/api/unstage` `{paths}`                     | 取消暫存（mixed reset）                                                            |
| POST   | `/api/discard` `{paths}`                     | 丟棄變更（hard reset for paths）                                                   |
| POST   | `/api/commit` `{message, paths?, stageAll?}` | commit                                                                       |
| GET    | `/api/diff?path=&commit=&from=&to=`          | 三種模式：HEAD vs worktree、單個 commit vs parent、任意 from/to                         |
| GET    | `/api/history?limit=N`                       | commits（hash / subject / body / authorName / authorEmail / time / timeLocal） |
| GET    | `/api/commit/detail?hash=...`                | 該 commit 對 parent 的變更檔案；root commit 全部視為 added                               |
| POST   | `/api/restore` `{path, ref}`                 | 把任意 ref 的 blob 還原到工作目錄                                                       |


## 帳密 INI（HMAC-SHA256 共享密鑰）

不想把帳密明文放檔案、又要讓 Go 與 Python 雙方都能驗證，採用：

```
HMAC-SHA256(
    key = SECRET_KEY,
    msg = salt || 0x00 || username || 0x00 || password
)
```

雙方各自硬編碼同一個 `SECRET_KEY`：

| 端 | 位置 |
|---|---|
| Go | `app/auth.go` 的 `const SECRET_KEY = "..."` |
| Python | `scripts/gen_credentials.py` 的 `SECRET_KEY = b"..."` |

**位元組級必須完全相同**。要輪換 key 就同步改兩邊，並重新發行所有 INI 檔。

### INI 格式

```ini
[auth]
username = admin
salt = b61761fd59a6af86e21db9fe20100e39           ; 16 bytes hex
password_hash = 5591a0756a720346c72f8cbef7b4b...  ; HMAC-SHA256 hex
algorithm = hmac-sha256-v1
```

salt 預設 16 個隨機 bytes（`secrets.token_hex(16)`），以便同一組 username/password 每次產生不同 hash。

### 多帳號（同一資料夾多個 INI）

`LoadCredentialsDir` 會讀目錄內所有 `*.ini`，以檔內 `username =` 為鍵；**同一個 username 只能出現在一個檔**，重複會啟動失敗。

### Python 產 INI

```bash
# 互動式（會 prompt 兩次密碼，不回顯）
python3 scripts/gen_credentials.py -u admin -o auth.ini

# 一次到位（適合 CI / script）
python3 scripts/gen_credentials.py -u admin -p 's3cret' -o auth.ini

# 印到 stdout
python3 scripts/gen_credentials.py -u admin -p 's3cret' -o -

# 固定 salt（測試重現性用，正式請勿）
python3 scripts/gen_credentials.py -u admin -p 's3cret' \
    --salt 0123456789abcdef0123456789abcdef -o auth.ini
```

產出檔在 POSIX 系統會自動 `chmod 600`。Windows 不支援 POSIX 模式，請自行 ACL。

### Go 驗證

```bash
./my-git-tool verify-cred -file auth.ini -username admin -password 's3cret'
# stdout: OK: credentials match    (exit 0)

./my-git-tool verify-cred -file auth.ini -username admin -password 'WRONG'
# stderr: error: FAIL: credentials do NOT match    (exit 1)
```

比較使用 `hmac.Equal`（constant-time），不會被 timing attack 推測 prefix。

### CLI 登入（docker login 風格）

多數 CLI 子命令（`add` / `commit` / `status` / `checkout` / `serve` / `sqldump`）**必須先登入**；不需登入的有：`login`、`logout`、`verify-cred`、`-h` / `--help` / `help`。

```bash
# 與 Web 相同：指向放多個 *.ini 的資料夾
my-git-tool login -auth-dir ./credentials
# 互動輸入帳密；TTY 下密碼不回顯

# 或（腳本／CI，密碼會進 shell 歷史，慎用）
my-git-tool login -auth-dir ./credentials -username alice -password 'secret'

my-git-tool status
my-git-tool logout
```

登入成功後會在本機寫入**簽名 token**（與 Web session 相同的 `SignSession` / `ParseSession` 演算法，**不含明文密碼**）：

- **macOS**：`~/Library/Application Support/my-git-tool/cli-session`
- **Linux**：`$XDG_CONFIG_HOME/my-git-tool/cli-session`（未設則 `~/.config/my-git-tool/cli-session`）
- **Windows**：`%AppData%\my-git-tool\cli-session`

預設有效期 **72 小時**（`-session-hours` 可改）。過期後須重新 `login`。

### 在程式內呼叫（Go）

```go
creds, err := LoadCredentials("auth.ini")
if err != nil {
    return err
}
if !creds.Verify(username, password) {
    return errors.New("auth failed")
}
```

`LoadCredentials` 會驗證：
- `[auth]` section 存在且 `username/salt/password_hash` 都填了
- `algorithm` 沒填或等於 `hmac-sha256-v1`（防止跨版本誤用）
- `salt` / `password_hash` 都是合法 hex

### 安全性備註

- **不可逆**：INI 內只有 hash，拿到檔案無法還原密碼，但仍會洩漏 username
- **暴力破解抵抗**：因為加上 `SECRET_KEY` pepper，攻擊者沒有 key 就算抓到 INI + salt 也無法離線字典攻擊；風險全壓在 `SECRET_KEY` 不外洩
- **可驗證但不可遠端登入**：這個 INI 是「本機程式驗證使用者」用的，不要當 OAuth/JWT 在網路上傳
- **PBKDF / bcrypt 升級路徑**：若要抗 GPU 暴力，把 `ComputeHash` 改成 `pbkdf2_hmac("sha256", password, salt+SECRET_KEY, iterations=200000)` 並把 `algoName` 改成 `pbkdf2-sha256-v1`，雙端同步

## 升級依賴

```bash
# 升級 go-git
cd gitops
GOWORK=off go get github.com/go-git/go-git/v5@latest
GOWORK=off go mod tidy
GOWORK=off go mod vendor

# 升級 sqlite 或其他 app 用的依賴
cd app
go get modernc.org/sqlite@latest
go mod tidy

# 同步整個 workspace
cd ..
go work sync
```

## 把 `gitops` 拆成獨立 GitHub 專案

當 `gitops` 穩定到值得獨立發布時：

1. 把 `gitops/` 整個搬到新的 git repo（例如 `github.com/<you>/gitops`）
2. `gitops/go.mod` 第一行改成 `module github.com/<you>/gitops`
3. `app/go.mod`：
  - `require local.dev/gitops v0.0.0` → `require github.com/<you>/gitops vX.Y.Z`
  - 移除 `replace local.dev/gitops => ../gitops`
4. `app/*.go` 內 `import "local.dev/gitops"` → `import "github.com/<you>/gitops"`
5. 刪掉根目錄的 `go.work`
6. `cd app && go mod tidy`

## 其他備註

- **離線打包**：只要 `gitops/vendor/` 在 git 裡就保證 go-git 永遠可編；`modernc.org/sqlite` 一旦在開發機 `go build` 過一次就會留在 module cache，CI 第一次編譯需要網路
- **體積**：完整 repo 約 97 MB，其中 14 MB 是 `gitops/vendor/`、其餘是 `node_modules`（不入 git）和 build 產物
- **embed**：`//go:embed all:web/dist` 用 `all:` 前綴，會包含 dotfiles
- **二進位大小**：macOS amd64 約 18 MB（含 React UI、go-git、sqlite engine）

## 授權

go-git 為 Apache-2.0；modernc.org/sqlite 為 BSD-3-Clause；本專案自身採 MIT（如需明確 LICENSE 檔請另外加）。