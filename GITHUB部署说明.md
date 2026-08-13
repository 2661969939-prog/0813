# GitHub + Cloudflare 上线说明

本方案将源码放在 GitHub，由 GitHub Actions 自动部署网站。最终访问地址由 Cloudflare 提供，例如：

`https://ovary-imaging-platform.<你的子域名>.workers.dev`

## 重要：GitHub 仓库页不是网站页

GitHub 仓库首页会显示 README 和文件列表，这是正常的源码管理页面。它不会自动把 `index.html` 渲染为网站。

如果需要通过 GitHub 查看网站界面：

1. 进入仓库 `Settings → Pages`。
2. 在 `Build and deployment → Source` 选择 `GitHub Actions`。
3. 进入仓库 `Actions`，运行或等待 `Deploy GitHub Pages Preview`。
4. 发布成功后，在 `Settings → Pages` 复制网站地址。

这个 Pages 地址可显示完整界面，前端会连接已部署的 Cloudflare Workers 地址进行多人 D1 病例同步。

## 一、准备账号

需要：

1. 一个 GitHub 账号。
2. 一个 Cloudflare 账号。
3. 在电脑上安装 Node.js 22.13 或更高版本。

## 二、在 Cloudflare 创建免费数据库

安装依赖并登录：

```bash
npm install
npx wrangler login
```

创建病例数据库：

```bash
npx wrangler d1 create ovary-platform-db
```

命令会返回 `database_id`，请复制保存。

## 三、创建 Cloudflare API Token

在 Cloudflare 控制台创建 API Token，授权它部署 Workers 和使用 D1。另请在 Cloudflare 账户首页复制 Account ID。

## 四、上传到 GitHub

1. 在 GitHub 新建一个私有仓库。
2. 将本文件夹里的全部内容上传到仓库根目录。
3. 不要上传 `node_modules`、`dist` 或 `.wrangler`，它们已在 `.gitignore` 中排除。

也可以在本目录执行：

```bash
git init
git add .
git commit -m "初始化卵巢肿瘤影像数据平台"
git branch -M main
git remote add origin 你的GitHub仓库地址
git push -u origin main
```

## 五、配置 GitHub

进入 GitHub 仓库的：

`Settings → Secrets and variables → Actions`

在 **Repository secrets** 中新增：

- `CLOUDFLARE_API_TOKEN`：Cloudflare API Token。
- `CLOUDFLARE_ACCOUNT_ID`：Cloudflare Account ID。
- `CLOUDFLARE_D1_DATABASE_ID`：第二步创建 D1 时返回的 database_id。

在 **Repository variables** 中新增：

- `CLOUDFLARE_D1_DATABASE_NAME`：填写 `ovary-platform-db`。
## 六、自动发布 Cloudflare 多人版

向 `main` 分支推送代码后，GitHub 会运行 `Deploy to Cloudflare`。

可在仓库的 `Actions` 页面查看进度。部署成功后，日志会显示网站地址。以后每次推送到 `main`，网站都会自动更新。

## 七、本地检查

```bash
npm install
npm run dev
```

打开 `http://localhost:3000`。

正式构建检查：

```bash
npm run build
```

## 重要限制

- GitHub Pages 无法运行本项目的数据库、文件上传和多人同步接口，因此本包使用 Cloudflare Workers。
- 严格免费模式保留多人病例同步，但不提供跨设备影像文件共享；如需共享大文件，需要另行启用 R2 并承担超额计费风险。
- 默认管理员账号和密码仅供演示，正式使用前必须改造为服务端认证。
- 当前用户注册信息和上传文件主要保存在各自浏览器；病例数据通过云端共享。
- 在医疗场景正式投入使用前，必须完成脱敏、访问控制、审计、备份与适用法规评估。
