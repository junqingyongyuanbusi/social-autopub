---
title: Meta 开发者准备
description: 注册 Meta 开发者、创建应用、申请权限、把成员加入授权名单
---

:::note[这一页归管理员]
本页操作**整个团队只做一次**，由管理员完成。运营只需要看最后一节
[把成员加入授权名单](#把成员加入授权名单必做否则运营绑不上号)，了解你需要提供什么。
:::

Facebook 和 Instagram 都由 Meta 管，**共用同一个应用**，不需要建两个。

## 第一步：注册 Meta 开发者账号

1. 打开 <a href="https://developers.facebook.com/" target="_blank" rel="noreferrer">developers.facebook.com</a>，用**公司的** Facebook 账号登录
2. 点右上角「开始使用」/「Get Started」，按引导完成开发者注册（要验证手机号）

:::caution
用来注册的 Facebook 账号会成为应用的所有者。**用公司账号，不要用个人小号** ——
人一离职应用就失控了。
:::

## 第二步：创建应用

1. 打开 <a href="https://developers.facebook.com/apps/creation/" target="_blank" rel="noreferrer">应用创建页</a>
2. 先选一个**商业组合**（business portfolio）。没有就现场建一个
3. 到「添加用例」界面时，把左侧筛选切到 **「全部」/「All」**
4. **列出来的用例全部跳过** —— 往下滚到「**没找到想要的？**」/「Looking for something else?」，选 **「其他」/「Other」**，继续
5. 应用类型选 **「商务」/「business」**
6. 填应用名称等信息，创建

:::tip[为什么要选"其他"而不是现成用例]
现成用例会自动锁定一套权限组合，反而拿不到发帖需要的那几个。选「其他」+「商务」才能自己挑权限。
:::

## 第三步：加产品并配回调地址

### Facebook

1. 在应用里添加 **「Facebook 登录」/「Login with Facebook」** 产品，配置方式选 **「商务版登录」/「login for business」**
2. 设置 OAuth 回调地址（按你的 Postiz 部署方式选一个）：

| 部署方式 | 回调地址 |
| --- | --- |
| 生产（有域名） | `https://你的postiz域名/integrations/social/facebook` |
| 本地开发 | `http://localhost:4200/integrations/social/facebook` |
| Docker | `http://localhost:5000/integrations/social/facebook` |

### Instagram

Instagram 有两条路，**选一条**：

| 方案 | 前提 | 回调地址 | 凭据变量 |
| --- | --- | --- | --- |
| **A. 走 Facebook 主页**（推荐，本系统按此配置） | IG 必须**关联一个 Facebook 主页** | `https://你的postiz域名/integrations/social/instagram` | 与 Facebook 共用 `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` |
| B. IG 独立登录 | 不要主页，但 IG 必须是**专业号** | `https://你的postiz域名/integrations/social/instagram-standalone` | 单独的 `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` |

方案 B 需要额外添加 **Instagram** 产品并开启 **Instagram 商务登录**。

## 第四步：申请权限（advanced access）

在应用的「权限和功能」里为下列权限申请 **advanced access**：

**Facebook 发帖需要：**

```
pages_show_list
business_management
pages_manage_posts
pages_manage_engagement
pages_read_engagement
read_insights
```

**Instagram 发帖额外需要（方案 A）：**

```
instagram_basic
instagram_content_publish
instagram_manage_comments
instagram_manage_insights
```

:::note[自用实例可以先不申请]
Meta 官方文档说明：如果只是**自己内部用**、不打算给外部用户使用，这些 advanced 权限不是 Postiz 运行的硬性前提。
但**在 Meta 正式批准之前，只有被加进应用角色名单的账号才能发帖** —— 也就是必须做好下面的[授权名单](#把成员加入授权名单必做否则运营绑不上号)。
公开上架的应用则必须完成**商业验证**（business verification）。
:::

## 第五步：把凭据配进 Postiz

在应用「设置 → 基本」里拿到 **应用编号（App ID）** 和 **应用密钥（App Secret）**，写进 Postiz 的环境变量：

```env
FACEBOOK_APP_ID="你的 App ID"
FACEBOOK_APP_SECRET="你的 App Secret"
```

方案 B 的 Instagram 独立登录再加：

```env
INSTAGRAM_APP_ID="你的 IG App ID"
INSTAGRAM_APP_SECRET="你的 IG App Secret"
```

:::danger[密钥纪律]
App Secret 等同于账号密码。只允许写进 Postiz 的服务端环境变量，**不写进本仓库、不发群里、不截图**。
本系统这一侧完全接触不到它 —— 详见[架构边界 · 凭据最小暴露](/project/architecture/#必须遵守的边界)。
:::

## 开发模式 vs 上线模式

这是**最容易踩的坑**，务必搞清楚：

| 应用模式 | 谁能授权成功 | 帖子谁能看见 |
| --- | --- | --- |
| **开发（Development）** | 只有应用角色名单里的账号（管理员 / 开发者 / 测试人员） | **只有你自己看得到**；别人看到的帖子还会**缺图** |
| **上线（Live）** | 所有人 | 所有人 |

:::caution[症状与对策]
运营反馈"帖子发出去了但同事刷不到"、"图片没了"，**99% 是应用还在开发模式**。
把应用从 Development 切到 **Live** 即可解除限制。
:::

## 把成员加入授权名单（必做，否则运营绑不上号）

应用在开发模式下，运营账号必须先被加进角色名单，才能在控制台完成绑定。

### Facebook：加为测试人员

1. 进入应用后台 → **「应用角色」/「App Roles」→「角色」/「Roles」**
2. 点 **「添加测试人员」/「Add Testers」**（也可加为 Developer，权限更大，按需选）
3. 输入运营提供的 **Facebook 用户名或数字 ID**，搜索并添加
4. **告知运营去接受邀请** —— 邀请不会自动生效

### Instagram：加为 Instagram 测试人员

1. 同样在 **「应用角色」/「App Roles」** 里，找到 **Instagram 测试人员 / Instagram Testers**
2. 输入运营的 **Instagram 用户名**并添加
3. **告知运营**：在 Instagram App 里打开 **设置 → 网站许可 / 应用和网站**，找到邀请并**接受**

:::tip[让运营提供什么]
一张可以直接转发给运营的清单见 [提交给管理员的信息清单](/prepare/account-info/)。
简版：**Facebook 个人主页链接 + 用户名 + 数字 ID**，Instagram 另加**专业号用户名**。
:::

### 怎么确认加成功了

| 检查项 | 通过标准 |
| --- | --- |
| 名单里有人 | 应用角色页能看到该账号，状态是**已接受**（不是"待处理"） |
| 运营能绑号 | 运营在控制台「账号健康」点「绑定新账号」，跳转授权页不报错 |
| 帖子对外可见 | 用未登录的浏览器打开帖子链接能看到，且**图片在** |

## 常见失败原因对照表

| 现象 | 原因 | 怎么修 |
| --- | --- | --- |
| 点「绑定新账号」跳转后报权限错误 | 该账号不在应用角色名单，或邀请没接受 | 加进名单 + 让运营接受邀请 |
| Instagram 授权后选不到账号 | IG 不是专业号，或没关联 Facebook 主页 | IG 切专业号并关联主页（方案 A 必须） |
| 授权成功但发帖失败 | 主页权限不足，或权限没申请全 | 确认运营在 Page 里是管理员；补齐权限 |
| 帖子只有自己可见 / 图片丢失 | 应用还在**开发模式** | 切到 **Live** |
| 回调报 redirect_uri 不匹配 | 回调地址与 Postiz 实际域名不一致 | 逐字符核对回调地址，注意 http/https 与结尾无斜杠 |

## 参考

- <a href="https://docs.postiz.com/self-host/providers/facebook" target="_blank" rel="noreferrer">Postiz 官方 · Facebook 接入</a>
- <a href="https://docs.postiz.com/self-host/providers/instagram" target="_blank" rel="noreferrer">Postiz 官方 · Instagram 接入</a>

:::note[平台后台会改版]
Meta 后台的菜单名称和位置变动频繁。本页步骤以 Postiz 官方文档为准整理；
若界面与描述不一致，以**上面两个官方链接**为最新依据，并在[变更台账](/project/changelog/)里记录差异。
:::
