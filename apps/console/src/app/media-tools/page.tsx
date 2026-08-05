'use client';

import { useState } from 'react';
import {
  Download,
  Image as ImageIcon,
  LoaderCircle,
  WandSparkles,
} from 'lucide-react';
import { InstagramPreview, previewInstagramImage } from '@/lib/api';

export default function MediaToolsPage() {
  const [url, setUrl] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [preview, setPreview] = useState<InstagramPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const generate = async () => {
    const value = url.trim();
    if (!/^https?:\/\//.test(value)) {
      setError('请输入有效的 http(s) 图片 URL');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await previewInstagramImage(value);
      setSourceUrl(value);
      setPreview(result);
    } catch {
      setError('图片下载或转换失败，请确认 URL 可公开访问且未过期');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-6xl">
      <div className="mb-5">
        <h1 className="text-xl font-semibold">媒体工具</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Instagram Feed · 4:5
        </p>
      </div>

      <div className="mb-5 flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="image-url">
          图片 URL
        </label>
        <input
          id="image-url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void generate();
          }}
          placeholder="粘贴 16:9 图片 URL"
          className="min-h-11 flex-1 rounded-md border border-border bg-card px-3 text-sm focus:border-primary focus:outline-none"
        />
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
          ) : (
            <WandSparkles className="size-4" aria-hidden />
          )}
          {loading ? '正在转换' : '生成预览'}
        </button>
      </div>

      {error && (
        <p className="mb-4 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex h-11 items-center justify-between border-b border-border px-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ImageIcon className="size-4 text-muted-foreground" aria-hidden />
              原图
            </div>
            {preview?.originalWidth && preview.originalHeight && (
              <span className="text-xs tabular-nums text-muted-foreground">
                {preview.originalWidth} × {preview.originalHeight}
              </span>
            )}
          </div>
          <div className="flex aspect-[4/5] items-center justify-center bg-muted p-4">
            {sourceUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={sourceUrl}
                alt="原始配图"
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <span className="text-sm text-muted-foreground">等待图片</span>
            )}
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex h-11 items-center justify-between border-b border-border px-4">
            <div>
              <span className="text-sm font-medium">Instagram 4:5</span>
              <span className="ml-2 text-xs text-muted-foreground">
                发布输出 1080 × 1350 JPEG
              </span>
            </div>
            {preview && (
              <a
                href={preview.dataUrl}
                download="instagram-4x5-preview.jpg"
                className="flex min-h-9 items-center gap-1.5 rounded-md px-2 text-xs text-primary hover:bg-muted"
              >
                <Download className="size-3.5" aria-hidden />
                下载预览
              </a>
            )}
          </div>
          <div className="flex aspect-[4/5] items-center justify-center bg-muted">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview.dataUrl}
                alt="Instagram 4:5 转换预览"
                className="h-full w-full object-contain"
              />
            ) : (
              <span className="text-sm text-muted-foreground">等待转换</span>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
