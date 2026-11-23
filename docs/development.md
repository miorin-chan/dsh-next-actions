# 开发与发布

## 构建与测试

在新检出的仓库根目录使用 Node.js 24 安装开发依赖并检查。
`prepare` 会在安装依赖时构建插件。测试借助 Node.js 内置的 TypeScript 支持直接加载规范化源码。
[规范化模块](../src/lib/normalize.ts)

```sh
pnpm install --frozen-lockfile
npm run check
```

构建生成 `index.js` 和 `client.js`，并将参数规范化模块内联到 Host 入口。
Git 忽略这两个产物，npm 发布包包含它们。修改源码后可用 `npm run build` 更新产物。
[Host 源码](../src/host/index.ts) · [Client 源码](../src/client/index.ts)

源码与产物的目录结构详见[项目约定](../AGENTS.local.md#结构)。
宣传片源码、封面和渲染脚本位于仓库的 `assets/promo/`，成片由脚本在本地生成。

`npm run check` 依次运行 `node --test`、`tsc -p tsconfig.json`、
`node scripts/build.mjs --check` 和 `node scripts/sync-types.mjs --check`，检查行为、
类型、构建产物一致性和 DSH 类型包版本。
升级 DSH 后，运行 `node scripts/sync-types.mjs`，按输出的安装命令更新类型依赖，再运行 `npm run check`。
从 DSH 默认工作区根目录检查插件骨架。

```sh
node tools/new-dsh-plugin/cli.mjs --check plugins/dsh-next-actions
```

## 本地安装

本仓库使用包名 `@miorin/dsh-next-actions`。支持的 DSH 版本见包清单中的 `engines.dsh`。
[包清单](../package.json)

先在新检出的仓库根目录运行 `pnpm install --frozen-lockfile` 安装依赖并构建插件。
使用 Desktop 时，打开应用初始化 profile，再完全退出。
使用 Web 时，将 `desktop` 换成你的 profile 名称。
将下面示例中的路径替换为本地仓库的绝对路径。

```sh
dsh plugin --profile desktop add link:/path/to/dsh-next-actions
```

也可以通过 `plugin_manager` 的 `install_bundle` 安装，通过 `remove_bundle` 卸载。
验证安装、升级或卸载时，给 `dsh plugin` 命令设置临时 `DSH_HOME`。
安装或重新构建 Host 后重启 DSH。重新构建 Client 后刷新页面。

## 停用配置

在 profile 的 `cordis.patch.yml` 中，将插件条目的 `config.enabled` 设为 `false`，即可关闭工具和常驻提示。
停用后常驻 token 开销为零。将示例中的 `name` 设为 profile 中已安装的包名。

```yaml
- id: dsh-next-actions
  name: '@miorin/dsh-next-actions'
  config: { enabled: false }
```

保存后重启 DSH。

## 发布

更新版本号和版本日志后，按[构建与测试](#构建与测试)准备仓库，再运行检查、打包预览并发布。
[package.json](../package.json) · [版本日志](../CHANGELOG.md)

```sh
npm run check
npm pack --dry-run
release_version="$(node -p 'require("./package.json").version')"
git tag -a "v$release_version" -m "v$release_version"
git push origin main --tags
npm publish --access public
npm view @miorin/dsh-next-actions version   # 确认 latest 指向新版本
```

发布后在临时 `DSH_HOME` 中从 npm registry 安装一次。
本地 `link:` 安装继续使用仓库路径。
