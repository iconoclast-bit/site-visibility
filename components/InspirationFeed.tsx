"use client";

import { useState } from "react";
import type { FeedPost } from "@/lib/feed";
import { InterestButton } from "./InterestButton";
import { PhotoGrid } from "./PhotoGrid";

const PAGE = 6;

/** The inspiration feed: newest posts first, six at a time. Posts not yet shown render no images. */
export function InspirationFeed({ posts, token, interested }: { posts: FeedPost[]; token: string; interested: string[] }) {
  const [shown, setShown] = useState(PAGE);
  return (
    <>
      {posts.slice(0, shown).map((post) => (
        <article className="update" key={post.id} data-testid="feed-post">
          <div className="row between">
            <span className="strong" data-testid="feed-label">{post.label}</span>
            <span className={`badge ${post.progress === "Completed" ? "ok" : "info"}`}>{post.progress}</span>
          </div>
          <div className="small muted" style={{ margin: "2px 0 6px" }}>{post.stageNames.join(" · ")} · {post.dateLabel}</div>
          {post.caption && <p className="small" style={{ margin: "0 0 4px" }}>{post.caption}</p>}
          <PhotoGrid photos={post.photos} />
          <InterestButton token={token} postId={post.id} initiallySent={interested.includes(post.id)} label={post.label} />
        </article>
      ))}
      {shown < posts.length && (
        <button type="button" className="btn block" style={{ marginTop: 12 }} onClick={() => setShown((n) => n + PAGE)} data-testid="feed-more">
          Show more ({posts.length - shown} more)
        </button>
      )}
    </>
  );
}
