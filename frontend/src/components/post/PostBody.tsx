import { Fragment, useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import PostImage from './PostImage';
import PostGalleryLayout from './PostGalleryLayout';
import { YoutubeFacade } from './PostYoutube';
import PostVideo from './PostVideo';
import PostPoll from './PostPoll';
import type { PollView } from '@/lib/postPoll';
import { imageRatio } from '@/lib/postLayout';
import { resolveSiteLink } from '@/lib/siteLink';
import {
  safeLinkHref, collectPostImages, type FigureAttrs, type GalleryAttrs, type PollAttrs, type PostDoc, type PostImageAttrs, type PostImageRef, type PostMark,
  type PostNode, type VideoAttrs,
} from '@/lib/postDoc';

/**
 * 커뮤니티 글 문서를 **편집기 없이** 그린다(2026-11-13) — 읽는 사람은 TipTap(편집기, 약 400KB)을 받지 않는다.
 * ⚠️ 이 파일은 `@tiptap/*` 를 import 하지 않는다(테스트가 소스를 읽어 막는다).
 * ⚠️ `dangerouslySetInnerHTML` 을 쓰지 않는다 — 모든 노드를 React 요소로 만든다. 모르는 노드는 건너뛴다(던지지 않는다).
 * 클래스(`post-body`·`post-figure` …)는 편집기와 같다 — index.css 한 곳이 두 화면을 같이 칠한다(쓰는 모양 = 보이는 모양).
 */
export type PostBodyImage = PostImageRef;

export default function PostBody({ doc, onOpenImage, poll, className = '' }: {
  doc: PostDoc;
  /** 사진을 누르면 — 글 안 사진 전체(순서대로)와 누른 번호 */
  onOpenImage?: (images: PostBodyImage[], index: number) => void;
  /** 글 화면 — 투표를 누를 수 있게(없으면 미리보기처럼 정의만 그린다) */
  poll?: { postId: number; view: PollView | null; loggedIn: boolean; onNeedLogin: () => void };
  className?: string;
}) {
  // 크게 보기용 — 글 안 사진을 순서대로 한 번만 모은다
  const images = useMemo(() => collectPostImages(doc), [doc]);
  const indexOf = (src: string) => images.findIndex((i) => i.src === src);
  // 첫 사진만 먼저 받는다(나머지는 화면에 가까워질 때) — 렌더 중에 값을 바꾸지 않게 주소로 가른다
  const firstSrc = images[0]?.src ?? null;
  const priority = (src: string) => src === firstSrc;

  const open = (src: string | null | undefined) => (src && onOpenImage ? () => onOpenImage(images, Math.max(0, indexOf(src))) : undefined);

  const block = (n: PostNode, key: number | string): ReactNode => {
    const a = n.attrs ?? {};
    switch (n.type) {
      case 'paragraph':
        return <p key={key} style={a.textAlign === 'center' ? { textAlign: 'center' } : undefined}>{inline(n.content)}</p>;
      case 'heading': {
        const Tag = a.level === 3 ? 'h3' : 'h2';
        return <Tag key={key} style={a.textAlign === 'center' ? { textAlign: 'center' } : undefined}>{inline(n.content)}</Tag>;
      }
      case 'bulletList':
        return <ul key={key}>{(n.content ?? []).map((li, i) => <li key={i}>{(li.content ?? []).map(block)}</li>)}</ul>;
      case 'orderedList':
        return <ol key={key} start={typeof a.start === 'number' && a.start > 1 ? a.start : undefined}>{(n.content ?? []).map((li, i) => <li key={i}>{(li.content ?? []).map(block)}</li>)}</ol>;
      case 'blockquote':
        return <blockquote key={key} data-variant={a.variant === 'pull' ? 'pull' : undefined}>{(n.content ?? []).map(block)}</blockquote>;
      case 'callout':
        return <aside key={key} className="post-block post-callout" data-callout={a.tone === 'note' ? 'note' : 'tip'}>{(n.content ?? []).map(block)}</aside>;
      case 'horizontalRule':
        return <hr key={key} />;
      case 'figure': {
        const f = a as unknown as FigureAttrs;
        if (!f.src) return null;
        const size = f.size ?? 'text';
        const click = open(f.src);
        const img = <PostImage attrs={f} size={size} alt={f.alt || f.caption || ''} priority={priority(f.src)} />;
        return (
          <figure key={key} className={`post-block post-figure size-${size}`} data-size={size}>
            <div className="post-figure-frame" style={{ aspectRatio: String(imageRatio(f)) }}>
              {click ? <button type="button" className="post-zoom" onClick={click} aria-label="사진 크게 보기">{img}</button> : img}
            </div>
            {f.caption ? <figcaption>{f.caption}</figcaption> : null}
          </figure>
        );
      }
      case 'gallery': {
        const g = a as unknown as GalleryAttrs;
        const items = (g.items ?? []).filter((i): i is PostImageAttrs & { src: string } => !!i.src);
        if (items.length === 0) return null;
        const size = g.size ?? 'text';
        return (
          <figure key={key} className={`post-block post-gallery size-${size}`} data-size={size}>
            <PostGalleryLayout
              items={items}
              layout={g.layout ?? 'row'}
              label={g.caption || '사진 모음'}
              renderCell={(it, i, columns) => {
                const img = <PostImage attrs={it} size={size} columns={columns} alt={it.alt || `${g.caption || '사진'} ${i + 1}`} priority={priority(it.src)} className="object-cover" />;
                const click = open(it.src);
                return click ? <button type="button" className="post-zoom" onClick={click} aria-label={`사진 ${i + 1} 크게 보기`}>{img}</button> : img;
              }}
            />
            {g.caption ? <figcaption>{g.caption}</figcaption> : null}
          </figure>
        );
      }
      case 'youtube': {
        const id = typeof a.videoId === 'string' ? a.videoId : '';
        return (
          <figure key={key} className="post-block post-youtube size-text">
            <YoutubeFacade videoId={id} title={(a.caption as string) || '유튜브 영상'} />
            {a.caption ? <figcaption>{String(a.caption)}</figcaption> : null}
          </figure>
        );
      }
      case 'video': {
        const v = a as unknown as VideoAttrs;
        if (!v.src) return null;
        return (
          <figure key={key} className="post-block post-video size-text">
            <PostVideo src={v.src} width={v.width} height={v.height} title={v.caption || '동영상'} />
            {v.caption ? <figcaption>{v.caption}</figcaption> : null}
          </figure>
        );
      }
      case 'poll':
        return (
          <div key={key} className="post-block post-poll size-text">
            <PostPoll attrs={a as unknown as PollAttrs} live={poll} />
          </div>
        );
      default:
        return null;   // 모르는 노드 — 그리지 않는다(던지지 않는다)
    }
  };

  return <div className={`post-body ${className}`}>{(doc?.content ?? []).map(block)}</div>;
}

function inline(nodes: PostNode[] | undefined): ReactNode {
  if (!nodes?.length) return <br />;   // 빈 문단 — 편집기처럼 한 줄 높이
  return nodes.map((n, i) => {
    if (n.type === 'hardBreak') return <br key={i} />;
    if (n.type !== 'text' || !n.text) return null;
    return <Fragment key={i}>{wrapMarks(n.text, n.marks ?? [])}</Fragment>;
  });
}

const MARK_ORDER = ['link', 'bold', 'italic', 'underline', 'strike', 'highlight'];

function wrapMarks(text: string, marks: PostMark[]): ReactNode {
  const sorted = [...marks].sort((a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type)).reverse();
  let out: ReactNode = text;
  for (const m of sorted) {
    switch (m.type) {
      case 'bold': out = <strong>{out}</strong>; break;
      case 'italic': out = <em>{out}</em>; break;
      case 'underline': out = <u>{out}</u>; break;
      case 'strike': out = <s>{out}</s>; break;
      case 'highlight': out = <mark>{out}</mark>; break;
      case 'link': out = <PostLink href={m.attrs?.href}>{out}</PostLink>; break;
      default: break;
    }
  }
  return out;
}

/** 글 속 링크 — 우리 사이트면 같은 탭(앱 안 이동), 바깥이면 새 창 + noopener. 위험한 주소는 글자만 */
function PostLink({ href, children }: { href?: string; children: ReactNode }) {
  const safe = safeLinkHref(href);
  if (!safe) return <>{children}</>;
  if (safe.startsWith('mailto:')) return <a href={safe}>{children}</a>;
  const site = resolveSiteLink(safe);
  if (site?.kind === 'route') return <Link to={site.path}>{children}</Link>;
  return <a href={safe} target="_blank" rel="noopener noreferrer nofollow">{children}</a>;
}

