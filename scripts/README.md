# 排班表系統

一個現代化的員工排班表管理系統，使用 React + TypeScript + Vite 構建。

## 功能特色

- ✅ **導航欄**：頂部提供 Overview 和 Shift Settings 兩個標籤頁
- ✅ **Overview（排班表）**：
  - 月份選擇器：點擊月份可彈出選擇器，或使用左右箭頭切換月份
  - Today 按鈕：快速跳轉到今天
  - 員工列表：左側顯示員工名稱（預設10位員工）
  - 日期顯示：上方顯示當前月份的所有日期
  - 排班選擇：點擊日期可選擇排班類型
  - **拖拽功能**：可以拖動已存在的排班到不同的日期
    - 拖到空白位置：移動排班
    - 拖到已有排班位置：交換兩個排班
  - **刪除功能**：點擊已有排班可顯示編輯菜單，選擇刪除
- ✅ **Shift Settings（排班設定）**：
  - **+ Shift Type 按鈕**：新增自定義排班類型
  - 支援完全自定義排班類型（名稱和顏色）
  - 可以新增例如：喪假、病假、年假、特休等任何類型
  - 編輯和刪除已定義的排班類型
  - 顏色選擇器（提供15種預設顏色和自定義顏色）
  - 數據自動保存到瀏覽器本地存儲

## 安裝與運行

### 安裝依賴

```bash
npm install
```

### 開發模式

```bash
npm run dev
```

應用將會在 http://localhost:5173 啟動

### 構建生產版本

```bash
npm run build
```

### 預覽生產版本

```bash
npm run preview
```

## 使用說明

### Overview 頁面（排班表）

1. **切換月份**：
   - 點擊月份/年份文字可以打開月份選擇器
   - 使用左右箭頭（‹ ›）可以快速切換月份
   - 點擊 "Today" 按鈕可以快速回到當前月份

2. **排班操作**：
   - **新增排班**：點擊任意員工和日期的交叉格，選擇排班類型
   - **編輯排班**：點擊已有排班的彩色標籤，可以更改類型或刪除
   - **拖拽移動**：直接拖動排班標籤到其他日期，可以移動或交換排班
     - 拖到空白格：移動排班到新位置
     - 拖到已有排班：兩個排班會交換位置
   - **刪除排班**：點擊已有排班，在菜單中選擇「🗑️ 刪除」按鈕
   - 點擊「取消」按鈕可以關閉選擇菜單

### Shift Settings 頁面（排班設定）

1. **新增排班類型**：
   - 點擊「+ Shift Type」按鈕
   - 輸入類型名稱（例如：喪假、病假、年假、特休等）
   - 選擇顏色（可以使用顏色選擇器或從15種預設顏色中選擇）
   - 點擊「新增」完成

2. **編輯排班類型**：
   - 點擊排班類型卡片上的「✏️」按鈕
   - 修改名稱或顏色
   - 點擊「更新」保存

3. **刪除排班類型**：
   - 點擊排班類型卡片上的「🗑️」按鈕
   - 確認刪除（至少需要保留一個排班類型）

### 視覺提示
   - 今天的日期會用藍色圓圈標示
   - 已排班的日期會顯示彩色標籤
   - 底部圖例顯示各排班類型的顏色

## 技術棧

- React 18
- TypeScript
- Vite
- CSS3

## 項目結構

```
├── src/
│   ├── components/
│   │   ├── ShiftScheduler.tsx    # 主排班表組件
│   │   └── ShiftScheduler.css    # 排班表樣式
│   ├── App.tsx                    # 應用主組件
│   ├── App.css                    # 應用樣式
│   ├── main.tsx                   # 入口文件
│   └── index.css                  # 全局樣式
├── index.html                     # HTML 模板
├── package.json                   # 項目配置
├── vite.config.ts                 # Vite 配置
└── tsconfig.json                  # TypeScript 配置
```

```
BEGIN TRANSACTION;

ALTER TABLE users RENAME TO users_old;

CREATE TABLE users (
    user_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    employee_id   TEXT NOT NULL UNIQUE,
    shift_type    TEXT CHECK(shift_type IN ('A', 'B', '7')),
    site          TEXT CHECK(site IN ('P1', 'P2', 'P3', 'P4')),
    password_hash TEXT NOT NULL,
    role          TEXT DEFAULT 'user' CHECK(role IN ('user', 'manager', 'admin')),
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    day_night     TEXT CHECK(day_night IN ('D', 'N')),
    "group"       TEXT NOT NULL DEFAULT "",
    monthly_overtime_cap_hours INTEGER
);

INSERT INTO users (
    user_id,
    name,
    employee_id,
    shift_type,
    site,
    password_hash,
    role,
    created_at,
    day_night,
    "group",
    monthly_overtime_cap_hours
)
SELECT
    user_id,
    name,
    employee_id,
    shift_type,
    site,
    password_hash,
    role,
    created_at,
    day_night,
    "group",
    monthly_overtime_cap_hours
FROM users_old;

DROP TABLE users_old;

COMMIT;
```

