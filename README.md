# dsh-next-actions

English | [中文](README.zh.md)

When there’s follow-up work, the plugin adds up to three suggested next actions below a DeepSeek Harness reply.
Click a suggestion to put the full instruction in your draft.
Edit it or send it as is when you’re ready.

![A reply with three suggested next actions at the bottom](assets/screen-card-en.svg)

## Install

Requires DSH 0.2.2-rc.1 or later.
On Desktop, open the app once to create its profile, then quit it before installing.
Run the command below from the checkout root.
On Web, replace `desktop` with your profile name.

```sh
dsh plugin --profile desktop add "link:$PWD"
```

Restart DSH after installing.

The earlier `dsh-next-actions` 0.1.7 release is available from the Plugins page.
[Registry install command](docs/development.md#已发布版本)

## Turn off

Set `config.enabled` to `false` on the `dsh-next-actions` entry in your profile’s `cordis.patch.yml`, then restart DSH.
[Configuration example](docs/development.md#停用配置)

[Usage examples and project docs](docs/README.md) · [MIT license](LICENSE) · [Third-party notices](NOTICE)
