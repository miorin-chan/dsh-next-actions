# dsh-next-actions

[English](README.md) | 中文

有后续工作时，插件会在 DeepSeek Harness 的回复末尾附上至多三条下一步建议。
点一条就把完整指令填进输入框，你可以编辑后再发，也可以原样发送。

![回复末尾的三条下一步建议](assets/screen-card-zh.svg)

## 安装

需要 DSH 0.2.2-rc.1 或更高版本。使用 Desktop 时，先打开应用初始化 profile，再完全退出。
在仓库根目录运行下面的命令。使用 Web 时，将 `desktop` 换成你的 profile 名称。

```sh
dsh plugin --profile desktop add "link:$PWD"
```

安装后重启 DSH。

插件页也可以安装已发布的 `dsh-next-actions` 0.1.7。
[npm 安装命令](docs/development.md#已发布版本)

## 停用

在 profile 的 `cordis.patch.yml` 中，将 `dsh-next-actions` 条目的 `config.enabled` 设为 `false`，再重启 DSH。
[配置示例](docs/development.md#停用配置)

[操作示例与项目文档](docs/README.md) · [MIT 许可证](LICENSE) · [第三方署名](NOTICE)
