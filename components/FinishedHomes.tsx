"use client";

import { useState } from "react";
import type { FinishedHome } from "@/lib/feed";
import { AmcBadge } from "./AmcBadge";
import { InterestButton } from "./InterestButton";
import { PhotoGrid } from "./PhotoGrid";

const PAGE = 4;

/** The common gallery of finished homes: one card per home, with the AMC tag and social proof. */
export function FinishedHomes({ homes, token, interested }: { homes: FinishedHome[]; token: string; interested: string[] }) {
  const [shown, setShown] = useState(PAGE);
  return (
    <>
      {homes.slice(0, shown).map((h) => (
        <article className="update" key={h.id} data-testid="finished-home">
          <div className="row between">
            <span className="strong" data-testid="finished-label">{h.label}</span>
            <span className="badge ok">Finished · {h.completedOn}</span>
          </div>
          <div style={{ margin: "6px 0" }}><AmcBadge amc={h.amc} /></div>
          {h.caption && <p className="small" style={{ margin: "0 0 4px" }}>{h.caption}</p>}
          <PhotoGrid photos={h.photos} />
          {h.wants > 0 && <p className="small muted" style={{ margin: "8px 0 0" }} data-testid="finished-wants">{h.wants === 1 ? "1 client has" : `${h.wants} clients have`} asked for a similar design</p>}
          <InterestButton token={token} postId={h.id} initiallySent={interested.includes(h.id)} label={h.label} />
        </article>
      ))}
      {shown < homes.length && (
        <button type="button" className="btn block" style={{ marginTop: 12 }} onClick={() => setShown((n) => n + PAGE)} data-testid="finished-more">
          Show more homes ({homes.length - shown} more)
        </button>
      )}
    </>
  );
}
