# Clerk Authentication Setup

## 设置环境变量

### 方法 1: 使用 .env.local 文件（推荐）

1. 编辑 `.env.local` 文件（如果不存在，从 `.env.example` 复制）：
```bash
cp .env.example .env.local
```

2. 在 `.env.local` 中设置你的 Clerk Publishable Key：
```env
VITE_CLERK_PUBLISHABLE_KEY=pk_test_你的实际密钥
```

3. 获取你的 Clerk Publishable Key：
   - 登录 [Clerk Dashboard](https://dashboard.clerk.com)
   - 选择你的应用
   - 在 "API Keys" 部分找到 "Publishable key"
   - 复制并粘贴到 `.env.local` 文件中

### 方法 2: 在命令行中设置（临时）

**Linux/Mac:**
```bash
VITE_CLERK_PUBLISHABLE_KEY=pk_test_你的密钥 npm run electron:dev
```

**Windows (PowerShell):**
```powershell
$env:VITE_CLERK_PUBLISHABLE_KEY="pk_test_你的密钥"; npm run electron:dev
```

**Windows (CMD):**
```cmd
set VITE_CLERK_PUBLISHABLE_KEY=pk_test_你的密钥 && npm run electron:dev
```

### 方法 3: 使用 cross-env（跨平台）

1. 安装 cross-env：
```bash
npm install --save-dev cross-env
```

2. 修改 `package.json` 中的脚本：
```json
{
  "scripts": {
    "electron:dev": "cross-env VITE_CLERK_PUBLISHABLE_KEY=pk_test_你的密钥 concurrently \"npm run dev\" \"wait-on http://localhost:5173 && electron .\""
  }
}
```

## 环境变量说明

| 变量名 | 说明 | 示例值 |
|--------|------|--------|
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk 公开密钥 | `pk_test_...` 或 `pk_live_...` |
| `VITE_BACKEND_URL` | 后端 API 地址 | `http://localhost:8787` 或 `https://sokuji-api.kizuna.ai` |

## 注意事项

1. **不要提交密钥到 Git**：
   - `.env.local` 已经在 `.gitignore` 中
   - 永远不要提交包含真实密钥的文件

2. **开发环境 vs 生产环境**：
   - 开发环境使用 `pk_test_` 开头的测试密钥
   - 生产环境使用 `pk_live_` 开头的生产密钥

3. **Chrome Extension 特殊配置**：
   - Chrome Extension 需要在 `manifest.json` 中配置 Clerk 的域名权限

## 验证配置

启动应用后，打开浏览器控制台，如果看到以下信息说明配置成功：
- 没有 Clerk 相关的错误
- 可以看到 Clerk 的认证组件加载

如果遇到问题：
1. 检查环境变量是否正确设置
2. 确认密钥格式正确（`pk_test_` 或 `pk_live_` 开头）
3. 查看浏览器控制台的错误信息