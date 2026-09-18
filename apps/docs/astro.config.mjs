// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLlmsTxt from 'starlight-llms-txt';

// 站点地址：Cloudflare Pages 项目名确定后可改为自定义域名（同步更新 README 与本文件）
const site = 'https://social-autopub-docs.pages.dev';

export default defineConfig({
  site,
  trailingSlash: 'always',
  integrations: [
    starlight({
      title: '社媒自动发布',
      description:
        'Notion / HTTP / WikiFX 多语言内容 → LLM 生成 → 人工审核 → Postiz 发布到 X / Instagram / Facebook',
      defaultLocale: 'root',
      locales: {
        root: { label: '简体中文', lang: 'zh-CN' },
      },
      lastUpdated: true,
      editLink: {
        baseUrl:
          'https://github.com/junqingyongyuanbusi/social-autopub/edit/dev/apps/docs/',
      },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/junqingyongyuanbusi/social-autopub',
        },
      ],
      customCss: ['./src/styles/custom.css'],
      plugins: [starlightLlmsTxt()],
      sidebar: [
        {
          label: '开始',
          items: [
            { label: '概述', slug: 'start/overview' },
            { label: '核心概念', slug: 'start/concepts' },
            { label: '本地开发', slug: 'start/local-development' },
          ],
        },
        {
          label: '控制台',
          items: [
            { label: '总览', slug: 'console/dashboard' },
            { label: '热点选题', slug: 'console/topics' },
            { label: '撰写发布', slug: 'console/compose' },
            { label: '内容队列与审核', slug: 'console/queue-review' },
            { label: '发布记录与日历', slug: 'console/records-calendar' },
            { label: '数据分析', slug: 'console/analytics' },
            { label: '账号与路由', slug: 'console/accounts-routing' },
            { label: 'Prompt 与设置', slug: 'console/prompts-settings' },
          ],
        },
        {
          label: '数据来源',
          items: [
            { label: 'Notion 接入', slug: 'sources/notion' },
            { label: 'HTTP 推送', slug: 'sources/http-ingest' },
            { label: 'WikiFX 热点', slug: 'sources/wikifx' },
          ],
        },
        {
          label: '部署',
          items: [
            { label: '自托管 Docker', slug: 'deploy/self-hosted' },
            { label: 'Railway 环境', slug: 'deploy/railway' },
            { label: '环境变量速查', slug: 'deploy/env-vars' },
            { label: '运维手册', slug: 'deploy/operations' },
          ],
        },
        {
          label: '项目',
          items: [
            { label: '架构边界', slug: 'project/architecture' },
            { label: '交付流程', slug: 'project/delivery-workflow' },
            { label: '变更台账', slug: 'project/changelog' },
          ],
        },
      ],
    }),
  ],
});
