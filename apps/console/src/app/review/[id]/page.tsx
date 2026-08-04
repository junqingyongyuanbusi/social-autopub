'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { ContentItem, fetchContent, patchAction, postAction } from '@/lib/api';
import { StatusBadge } from '@/components/status-badge';

const PLATFORM_LABEL: Record<string, string> = { x: 'X', instagram: 'Instagram', facebook: 'Facebook' };

interface Draft {
  content: string;
  media: string[];
}

// 审核详情：左侧原文，右侧各平台预览卡（文案 + 图片均可编辑），底部保存/通过/驳回
export default function ReviewDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [item, setItem] = useState<ContentItem | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [mediaInput, setMediaInput] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  const load = useCallback(() => {
    fetchContent(id)
      .then((data) => {
        setItem(data);
        setDrafts(
          Object.fromEntries(
            data.generations.map((g) => [g.platform, { content: g.content, media: [...(g.media ?? [])] }]),
          ),
        );
      })
      .catch(() => setNotice({ kind: 'error', text: '加载失败，请刷新重试' }));
  }, [id]);

  useEffect(load, [load]);

  if (!item) return <p className="text-sm text-muted-foreground">{notice?.text ?? '加载中…'}</p>;

  const isDirty = (platform: string) => {
    const gen = item.generations.find((g) => g.platform === platform);
    const draft = drafts[platform];
    if (!gen || !draft) return false;
    return draft.content !== gen.content || JSON.stringify(draft.media) !== JSON.stringify(gen.media ?? []);
  };

  const saveDrafts = async () => {
    for (const gen of item.generations) {
      if (isDirty(gen.platform)) {
        const draft = drafts[gen.platform];
        await patchAction(`/v1/contents/${item.id}/generations/${gen.platform}`, {
          content: draft.content,
          media: draft.media,
        });
      }
    }
  };

  const saveOnly = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await saveDrafts();
      setNotice({ kind: 'success', text: '已保存' });
      load();
    } catch {
      setNotice({ kind: 'error', text: '保存失败，请重试' });
    } finally {
      setBusy(false);
    }
  };

  const saveAndApprove = async () => {
    // IG 无图会发布失败，前置拦截提示
    const igDraft = drafts['instagram'];
    if (igDraft && igDraft.media.length === 0 && !confirm('Instagram 文案没有图片，发布会失败。仍要继续？')) return;
    setBusy(true);
    setNotice(null);
    try {
      await saveDrafts();
      await postAction(`/v1/contents/${item.id}/approve`);
      router.push('/review');
    } catch {
      setNotice({ kind: 'error', text: '操作失败，请重试' });
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!confirm('确认驳回这条内容？驳回后不会发布。')) return;
    setBusy(true);
    try {
      await postAction(`/v1/contents/${item.id}/reject`);
      router.push('/review');
    } finally {
      setBusy(false);
    }
  };

  const addMedia = (platform: string) => {
    const url = (mediaInput[platform] ?? '').trim();
    if (!/^https?:\/\//.test(url)) {
      setNotice({ kind: 'error', text: '请输入 http(s) 开头的图片地址' });
      return;
    }
    setDrafts((d) => ({ ...d, [platform]: { ...d[platform], media: [...d[platform].media, url] } }));
    setMediaInput((m) => ({ ...m, [platform]: '' }));
    setNotice(null);
  };

  const removeMedia = (platform: string, index: number) => {
    setDrafts((d) => ({
      ...d,
      [platform]: { ...d[platform], media: d[platform].media.filter((_, i) => i !== index) },
    }));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">审核：{item.title}</h1>
        <StatusBadge status={item.status} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">
            原文（{item.source} / {item.language.toUpperCase()}）
          </h2>
          <p dir="auto" className="whitespace-pre-wrap text-sm leading-relaxed">
            {item.body}
          </p>
        </section>

        <section className="space-y-4">
          {item.generations.map((gen) => {
            const draft = drafts[gen.platform];
            if (!draft) return null;
            return (
              <div key={gen.platform} className="rounded-lg border border-border bg-card p-4">
                <h3 className="mb-2 text-sm font-medium">
                  {PLATFORM_LABEL[gen.platform] ?? gen.platform}
                  {gen.platform === 'instagram' && draft.media.length === 0 && (
                    <span className="ml-2 text-xs font-normal text-warning">⚠ IG 发布必须有图片</span>
                  )}
                </h3>
                <textarea
                  dir="auto"
                  className="min-h-32 w-full resize-y rounded-md border border-border p-3 text-sm leading-relaxed focus:border-primary focus:outline-none"
                  value={draft.content}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [gen.platform]: { ...d[gen.platform], content: e.target.value } }))
                  }
                />
                <p className="mt-1 text-right text-xs tabular-nums text-muted-foreground">{draft.content.length} 字符</p>

                {draft.media.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {draft.media.map((url, i) => (
                      <div key={`${url}-${i}`} className="group relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt={`配图 ${i + 1}`} className="h-20 w-20 rounded-md border border-border object-cover" />
                        <button
                          onClick={() => removeMedia(gen.platform, i)}
                          aria-label="删除图片"
                          className="absolute -right-1.5 -top-1.5 hidden rounded-full bg-destructive p-0.5 text-white group-hover:block"
                        >
                          <X className="size-3" aria-hidden />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-2 flex gap-2">
                  <input
                    value={mediaInput[gen.platform] ?? ''}
                    onChange={(e) => setMediaInput((m) => ({ ...m, [gen.platform]: e.target.value }))}
                    placeholder="粘贴图片 URL 添加配图"
                    className="flex-1 rounded-md border border-border px-2.5 py-1.5 text-xs focus:border-primary focus:outline-none"
                  />
                  <button
                    onClick={() => addMedia(gen.platform)}
                    className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-primary hover:text-primary"
                  >
                    添加
                  </button>
                </div>
              </div>
            );
          })}
        </section>
      </div>

      {notice && (
        <p className={`text-sm ${notice.kind === 'error' ? 'text-destructive' : 'text-success'}`}>{notice.text}</p>
      )}
      {item.status === 'REVIEW' && (
        <div className="flex gap-3">
          <button
            onClick={saveAndApprove}
            disabled={busy}
            className="rounded-md bg-accent px-5 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? '处理中…' : '通过并发布'}
          </button>
          <button
            onClick={saveOnly}
            disabled={busy}
            className="rounded-md border border-border px-5 py-2 text-sm hover:border-primary hover:text-primary disabled:opacity-50"
          >
            仅保存修改
          </button>
          <button
            onClick={reject}
            disabled={busy}
            className="rounded-md border border-border px-5 py-2 text-sm text-muted-foreground hover:border-destructive hover:text-destructive disabled:opacity-50"
          >
            驳回
          </button>
        </div>
      )}
    </div>
  );
}
