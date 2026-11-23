# dsh-next-actions

[English](README.md) | 中文

有后续工作时，插件会在 DeepSeek Harness 的回复末尾附上至多三条下一步建议。
点一条就把完整指令填进输入框，你可以编辑后再发，也可以原样发送。

![回复末尾的三条下一步建议](assets/screen-card-zh.svg)

## 安装

在 DSH 的「插件」页安装最新版的「下一步建议」，然后重启 DSH。

## 停用

在 profile 的 `cordis.patch.yml` 中，将 `dsh-next-actions` 条目的 `config.enabled` 设为 `false`，再重启 DSH。
[配置示例](docs/development.md#停用配置)

[操作示例与项目文档](docs/README.md) · [MIT 许可证](LICENSE) · [第三方署名](NOTICE)
