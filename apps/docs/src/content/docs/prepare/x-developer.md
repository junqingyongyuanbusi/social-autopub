---
title: X 开发者准备
description: 注册 X 开发者、创建应用、设置 Native App 与回调、拿到 API Key
---

:::note[这一页归管理员]
本页操作**整个团队只做一次**。X 这边**不需要**像 Meta 那样把每个运营加进名单 ——
运营直接在控制台点「绑定新账号」，用自己的 X 账号登录授权即可。
:::

## 第一步：注册开发者账号

1. 打开 <a href="https://developer.twitter.com/en/portal/dashboard" target="_blank" rel="noreferrer">X 开发者后台</a>
2. 注册一个**免费账号**即可 —— Postiz 官方文档的接入流程就是按免费层级写的

:::caution[免费层级的额度会变]
X 对免费层级的发帖量、图片上传、数据分析权限调整过多次。
上线前请到 X 开发者后台**自行确认当前额度**是否够用，不要照搬任何文档里的旧数字。
如果账号计划没有数据分析权限，可以在 Postiz 侧设 `DISABLE_X_ANALYTICS=true` 关掉那个失败请求，避免日志噪音。
:::

## 第二步：创建应用并改设置

创建一个新应用，然后打开它的设置进行编辑。**三项设置必须按下表填**：

| 设置项 | 必须填的值 | 填错的后果 |
| --- | --- | --- |
| **App Permission**（应用权限） | `Read and Write` | 只有 Read 会发不出帖 |
| **Type of App**（应用类型） | **`Native App`** | 见下方警告 |
| **Callback URI / Redirect URL** | 见下表 | 授权回调失败 |

:::danger[Type of App 必须选 Native App]
选成 **Web App、Automated App 或 Bot** 会导致授权失败并报 **错误码 32**。
Postiz 走的是 OAuth 1.0a 流程（因为图片上传还依赖 X 的 v1 接口），**只有 Native App 能正常工作**。
:::

## 第三步：配置回调地址

按 Postiz 的部署方式选一个：

| 部署方式 | 回调地址 |
| --- | --- |
| 生产（有域名） | `https://你的postiz域名/integrations/social/x` |
| 本地开发 | `http://localhost:4200/integrations/social/x` |
| Docker | `http://localhost:5000/integrations/social/x` |
| 本地但平台强制 HTTPS | `https://redirectmeto.com/http://localhost:4200/integrations/social/x` |

## 第四步：拿 API Key 配进 Postiz

1. 保存设置后，打开应用的 **「Keys and Tokens」** 标签页
2. 在 **Consumer Keys** 区域点 **「Regenerate」**
3. 复制 **API Key** 和 **API Key Secret**（只显示一次，当场存好）
4. 写进 Postiz 环境变量：

```env
X_API_KEY=""
X_API_SECRET=""
```

可选变量：

| 变量 | 作用 |
| --- | --- |
| `X_URL` | 指向自建的 X 兼容 API |
| `DISABLE_X_ANALYTICS=true` | 关掉 X 数据分析请求（计划无该权限时用，消除日志噪音） |
| `STRIP_LINKS_FROM_X_POSTS=true` | 发布前全局剥掉文案里的链接 |

:::danger[密钥纪律]
API Key Secret 等同密码，只写进 Postiz 服务端环境变量。**不写进本仓库、不发群里、不截图。**
:::

## X 账号的长文能力（本系统特有）

X 免费账号单帖 **280 加权字符**，订阅账号（Premium）可到 **4000**。系统会**自动探测**，不需要手填：

- 首次发布一条超过 280 加权字符的内容，发布**成功** → 判定为订阅账号（4000）
- 被平台以长度为由**拒绝** → 判定为免费账号（280）
- 也可以在「账号健康」页手动填「文本上限」覆盖探测结果；清空则重新探测

详见 [账号与路由 · 编辑台账](/console/accounts-routing/#编辑台账仅管理员)。

## 常见失败原因对照表

| 现象 | 原因 | 怎么修 |
| --- | --- | --- |
| 授权报 **错误码 32** | Type of App 选错了 | 改成 **Native App** |
| 授权回调 404 / 地址不匹配 | 回调地址与 Postiz 域名不一致 | 逐字符核对，注意 http/https |
| 能授权但发帖 403 | App Permission 只有 Read | 改成 **Read and Write**，改完**重新授权一次** |
| 长文被拒 | 账号是免费层级 | 属正常；系统会自动记为 280 上限 |
| 日志刷数据分析失败 | 账号计划无分析权限 | 设 `DISABLE_X_ANALYTICS=true` |

:::tip[改了权限要重新授权]
在 X 后台把权限从 Read 改成 Read and Write 后，**旧的授权令牌不会自动升级**。
必须回到控制台「账号健康」重新绑定一次该账号。
:::

## 参考

- <a href="https://docs.postiz.com/self-host/providers/x-twitter" target="_blank" rel="noreferrer">Postiz 官方 · X 接入</a>
