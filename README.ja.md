[English](README.md) | **日本語**

# Next.js + TypeScript + ASP.NET Core ToDoアプリ

フロントエンドとバックエンドを分離した構成のフルスタックToDoアプリです。Next.js(TypeScript)のフロントエンドが ASP.NET Core Web API と通信し、データは SQLite に保存されます。

![スクリーンショット(日本語)](docs/screenshot-ja.png)

## 主な機能

- タイトル・URL(任意)・期限を入力してタスクを追加
- 完了チェック、名前の変更(タイトルをダブルクリック)、削除(**元に戻す**に対応)
- 進捗サマリー:完了率のリングと、完了・残り・今日が期限・期限切れの件数
- タブでの絞り込み(すべて/未完了/完了済み)、検索、期限での並べ替え
- 期限バッジで「今日が期限」「期限切れ」を色分け表示
- **英語/日本語** の切り替え(ヘッダーの `EN` / `JA` ボタン)
- ライト/ダークテーマ
- キーボードショートカット:`N` 新規タスク、`/` 検索、`Esc` 編集をキャンセル
- **デモモード**:APIに接続できない場合は、ブラウザ(`localStorage`)に保存するサンプルデータで動作します

## 技術スタック

- **フロントエンド:** Next.js 13(Pages Router)、React 18、TypeScript、axios
- **バックエンド:** ASP.NET Core 7 Web API、Entity Framework Core
- **データベース:** SQLite

## ディレクトリ構成

```
.
├── backend/                 ASP.NET Core Web API
│   ├── Controllers/ToDoController.cs
│   ├── Data/ToDoContext.cs
│   ├── Models/ToDoItem.cs
│   ├── Migrations/
│   └── todo.db              SQLite データベース
├── frontend/                Next.js アプリ(画面)
│   ├── pages/index.tsx      メイン画面
│   ├── lib/i18n.ts          英語/日本語の文言
│   ├── lib/todoUtils.ts     日付・URL・保存まわりの処理
│   └── styles/globals.css
└── docs/                    スクリーンショット
```

## セットアップ

### 必要なもの

- [.NET 7 SDK](https://dotnet.microsoft.com/download/dotnet/7.0)
- [Node.js](https://nodejs.org/) 16.8 以上

### 1. バックエンドを起動

```bash
cd backend
dotnet run --launch-profile http
```

API は `http://localhost:5082` で起動します。Swagger UI は `http://localhost:5082/swagger` で確認できます。

### 2. フロントエンドを起動

```bash
cd frontend
npm install
npm run dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開きます。
バックエンドの CORS は `http://localhost:3000` からのアクセスだけを許可しているため、フロントエンドはこのポートで起動してください。

## 言語の切り替え

ヘッダーの `EN` / `JA` ボタンで切り替えられます。選んだ言語はブラウザに保存されます。
`http://localhost:3000/?lang=ja` のように、クエリパラメータで言語を指定して開くこともできます。

## API

| メソッド | パス             | 内容               |
| -------- | ---------------- | ------------------ |
| GET      | `/api/todo`      | タスク一覧を取得   |
| GET      | `/api/todo/{id}` | タスクを1件取得    |
| POST     | `/api/todo`      | タスクを追加       |
| PUT      | `/api/todo/{id}` | タスクを更新       |
| DELETE   | `/api/todo/{id}` | タスクを削除       |

タスクの例:

```json
{
  "id": 1,
  "title": "READMEにセットアップ手順を書く",
  "url": "https://example.com",
  "dueDate": "2026-11-18T00:00:00",
  "isComplete": false
}
```
