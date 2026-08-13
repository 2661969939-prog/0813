# 卵巢肿瘤影像数据平台

## 直接打开已上线网站

### [点击这里进入卵巢肿瘤影像数据平台](https://ovary-imaging-platform.2661969939.workers.dev)

> GitHub 仓库首页显示的是源码和本说明文档，不是网站页面。要在 GitHub 上显示网页，请按下方“GitHub Pages 显示网页”的步骤操作。

这是适合上传到 GitHub 的严格免费部署包，包含粉色原版 UI、四级角色权限、跨账号病例同步，以及当前浏览器内的文件上传、预览、下载、审核及入库功能。

## GitHub Pages 显示网页

1. 把本包内容全部上传到 GitHub 仓库根目录，包括 `.github` 文件夹。
2. 打开仓库的 `Settings → Pages`。
3. 在 `Build and deployment` 的 `Source` 中选择 `GitHub Actions`。
4. 打开仓库的 `Actions`，等待 `Deploy GitHub Pages Preview` 变为绿色。
5. 返回 `Settings → Pages`，即可看到 GitHub Pages 网站地址。

GitHub Pages 会显示完整界面，并连接上方已部署的 Cloudflare 接口同步病例资料。严格免费模式下，大影像文件仍只保存在上传者当前浏览器中。

## 先看这里

- GitHub 用来保存和管理源码。
- 网站通过 GitHub Actions 自动发布到 Cloudflare Workers。
- 多人病例数据保存在 Cloudflare D1。
- 严格免费模式不启用 R2：影像文件仅保存在上传者当前浏览器，不会跨设备共享。
- GitHub Pages 用于直接展示网站界面；Cloudflare Workers 用于运行多人共享接口。
- 包内所有文件均小于 25MB，`node_modules` 和构建缓存不会上传。

完整上线步骤请阅读 [GITHUB部署说明.md](./GITHUB部署说明.md)。

## 本地运行

需要 Node.js 22.13 或更高版本。

```bash
npm install
npm run dev
```

浏览器访问 `http://localhost:3000`。

默认演示账号：

- 用户名：`管理员`
- 密码：`12345678`

## 目录说明

- `public/index.html`：网站主界面及业务内容。
- `public/styles.css`：粉色主题样式。
- `public/assets/`：界面素材。
- `public/script.js`：角色权限、病例流程和文件操作。
- `worker/index.ts`：共享病例及文件存储接口。
- `db/`、`drizzle/`：数据库结构和迁移。
- `.github/workflows/deploy-cloudflare.yml`：GitHub 自动部署流程。
- `.github/workflows/deploy-github-pages.yml`：GitHub Pages 网页自动发布流程。
- `index.html`：从 GitHub Pages 仓库根目录进入网站的兼容入口。

## 安全提示

当前版本适合功能展示和内部测试。默认管理员密码公开，浏览器端账号体系也不是医疗生产级认证。在完成服务端身份认证、权限校验、操作审计、备份、加密和合规评估前，请勿上传真实患者身份信息或未脱敏医疗资料。
