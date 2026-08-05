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
    <span className={`avatar ${className}`.trim()} aria-hidden="true">
      {showImage ? (
        <img
          src={avatarUrl}
          alt=""
          title={name}
          onError={() => setFailedUrl(avatarUrl)}
        />
      ) : (
        initials
      )}
    </span>
  );
}
