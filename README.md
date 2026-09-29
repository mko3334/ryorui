# 療育支援記録・専門的支援実施計画 管理システム

児童発達支援・放課後等デイサービスなどの施設向けに、日々の療育記録（Tree Kids School Search）や、専門的支援実施計画の作成・管理・エクセル出力を行うためのWebアプリケーションです。

## 主な機能
- **児童管理**: 児童ごとの基本情報、受給者証番号、所属事業所の管理
- **日々の療育記録（支援記録）の登録**: 
  - 日付ごとの療育内容（複数選択可）
  - 療育結果、今後の予定の入力
  - AI(Gemini API)を用いた文章の自動生成・要約機能
- **専門的支援実施計画のエクセル一括・個別出力**:
  - 登録された日々の記録から、対象月のデータを抽出してエクセルに出力。
  - Excelの元のフォーマット（罫線やプルダウン等の設定）を維持したまま、データだけを安全に上書きします。
  - アプリ側に療育内容がない場合は、エクセル側のプルダウン設定をそのまま残します。
  - 指定月のデータのみを正しくフィルタリングし、日付や療育内容を若い順（①、②、③...）にソートして出力します。
- **データのエクスポート・インポート**:
  - バックアップ作成や復元機能

## 使用技術 (Tech Stack)
- **Frontend**: React (v19), TypeScript, Vite
- **Styling**: Tailwind CSS
- **Routing**: React Router
- **Database & Hosting**: Firebase (Firestore, Firebase Hosting)
- **Excel Processing**: ExcelJS, xlsx (シートのコピー、スタイル維持、データ上書き)
- **AI Integration**: Google Gemini API (@google/genai)
- **Icons**: Lucide React

## 開発環境のセットアップ (Development Setup)

1. 依存関係のインストール
```bash
npm install
```

2. 環境変数の設定
プロジェクトルートに `.env.local` などの環境変数ファイルを作成し、Firebase設定やGemini APIキーを設定してください。

3. ローカルサーバーの起動
```bash
npm run dev
```
ブラウザで `http://localhost:5173` にアクセスして動作を確認します。

## ビルドとデプロイ (Build & Deploy)

ビルド:
```bash
npm run build
```

Firebaseへのデプロイ:
```bash
npx firebase deploy
```
