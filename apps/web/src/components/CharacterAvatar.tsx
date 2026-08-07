"use client";

import { useState } from "react";

export function CharacterAvatar({
  avatarUrl,
  name,
  initials,
  className = "",
}: {
  avatarUrl?: string;
  name: string;
  initials: string;
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState("");
  const showImage = avatarUrl && failedUrl !== avatarUrl;

  return (
    <span
      className={`inline-flex size-[42px] shrink-0 items-center justify-center overflow-hidden rounded-[4px] bg-[var(--surface-strong)] text-ink font-black ${className}`.trim()}
      aria-hidden="true"
    >
      {showImage ? (
        <img
          src={avatarUrl}
          alt=""
          title={name}
          loading="lazy"
          decoding="async"
          className="size-full object-cover [image-rendering:pixelated]"
          onError={() => setFailedUrl(avatarUrl)}
        />
      ) : (
        initials
      )}
    </span>
  );
}
